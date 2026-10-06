// The canvas iframe (PRODUCT.md §5): a same-origin iframe that only renders. It is sandboxed without scripts, has
// no event handler of its own and takes no pointer event: every pointer input arrives on the overlay above it
// (src/editor/input/pointer.ts). The renderer (src/editor/canvas/render/render.ts) builds the page into its document
// once and
// then applies each change of the document to it. One exception while a text is edited in place: the keymap listens
// for keys on the frame's window (the page itself still carries no event handler or event attribute), and the frame
// is not aria-hidden, as it holds the focus. The frame is scaled with the standard CSS zoom (Chrome 128+), so
// the page lays out at its breakpoint's width and the stage shows it at the canvas zoom.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCanvasMotion } from '../motion/use-canvas-motion.ts';
import { PageRenderer, renderModelFromManifest } from './render/render.ts';
import { applyInlineChange, plainText, type TextRange } from '../../core/text/inline.ts';
import { canvasValue } from '../../core/files/values.ts';
import { openedPage } from '../../core/project/pages.ts';
import { canvasDraft, registerDraftCapture, saveCanvasDraft } from '../persistence/drafts.ts';
import { installOsFileDrop } from '../input/pointer.ts';
import { manifest } from '../../manifest/runtime.ts';
import { activeState } from '../view/style-state.ts';
import { installPlayingLoop, timelinePreview } from '../timeline/preview.ts';
import { installKeymap } from '../input/keymap.ts';
import { useEditorState, useStore } from '../store.ts';
import { CanvasChrome } from './chrome.tsx';
import { Guides } from './guides.tsx';
import { SnapLines } from './snap-lines.tsx';
import { keepPagePoint, registerFrame, scrollPageBy } from './coordinates.ts';
import { TEXT_EDITING, openLinkPrompt, registerEditReader } from './text-edit.ts';
import { pageChanged } from './page-clock.ts';
import { wiring } from '../wiring.ts';

const MODEL = renderModelFromManifest(manifest.elements, manifest.properties, manifest.interactions);
// an empty page the renderer fills: no script, no style of the editor
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

// screen is the breakpoint's screen (its height, from properties.json): the page inside the frame takes it as its
// viewport, so vh, svh and dvh measure it whatever the zoom, and the page scrolls inside the frame as it does on the
// site (the user's real-use audit, item 2.3)
export function CanvasFrame({ width, screen, zoom }: { readonly width: number; readonly screen: number; readonly zoom: number }) {
  const store = useStore();
  const view = useRef<HTMLDivElement>(null);
  // the overlay over the page, where the chrome and the guides are drawn
  const overlay = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  // a layout measure (the height the view leaves the page), not editor state
  const [height, setHeight] = useState(0);
  // while a text is edited in place the frame holds the focus, so assistive technology must reach it
  const editing = useEditorState((s) => s.ui.textEdit.node !== null);
  // the page the editor shows (pages.switch): the renderer is built for it and rebuilt when it changes
  const page = useEditorState((s) => openedPage(s));
  // the page's motion (spec motion-preview): run mode and the Timeline's preview, inside this frame's page; called
  // before the renderer's effect so its listener lets go of the page before every render
  const frameWindow = useCallback(() => iframe.current?.contentWindow ?? null, []);
  useCanvasMotion(frameWindow, page);

  useEffect(() => {
    const element = view.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const frame = iframe.current;
    if (!frame) return;
    let stop = () => {};
    let stopFileDrop = () => {};
    const start = () => {
      const target = frame.contentDocument;
      if (!target) return;
      // the breakpoint's screen: the canvas resolves vh, svh, dvh and lvh against it (item 2.3); a source that names a
      // file of the project draws as its object URL (spec explorer-assets-use)
      const renderer = new PageRenderer(target, MODEL, page, { height: screen, width }, (name, value) => canvasValue(store.getState().document, name, value));
      renderer.mount(store.getState().document);
      // an image file dragged in from the operating system lands on the frame too: its own window reports the drag
      // the previous start's listeners go first (a load after a ready start runs start twice), then this one's drop
      stop();
      stopFileDrop = target.defaultView !== null ? installOsFileDrop(store, target.defaultView, true) : () => {};
      const stopDocument = store.subscribeDocument((change) => {
        renderer.apply(change.before, change.after, change.patches);
        pageChanged();
      });
      // the page may have changed for its readers (canvas/page-clock.ts): the store changed (a selection, a breakpoint,
      // a zoom), a resource of the page loaded (an image, which sizes its box; load does not bubble, so it is heard as
      // it goes down), a font arrived; and it was just mounted
      const stopTicks = store.subscribe(pageChanged);
      target.addEventListener('load', pageChanged, true);
      // a scroll of the page moves every box on it
      target.addEventListener('scroll', pageChanged, { passive: true });
      // so does the frame itself, resized (the fit zoom follows the stage, which no command changes)
      const framed = new ResizeObserver(pageChanged);
      framed.observe(frame);
      target.fonts.addEventListener('loadingdone', pageChanged);
      // a value read while the page's own transition ran is read again once it ends
      target.addEventListener('transitionend', pageChanged);
      target.addEventListener('animationend', pageChanged);
      pageChanged();
      // A text edited in place (text-edit.ts): the renderer marks, focuses and reads the edited element, and while the
      // edit lasts the keymap reads the keys on the frame's window, where they arrive; once it ends, the focus leaves
      // the frame for the editor's page body (the canvas key context).
      let edited: string | null = null;
      let lineBreaks = store.getState().ui.textEdit.lineBreaks;
      let selectAlls = store.getState().ui.textEdit.selectAlls;
      let changes = store.getState().ui.textEdit.changes;
      // while the link prompt holds the focus, the text selection it acts on, as a range of the edited text's
      // characters
      let prompting = false;
      let kept: TextRange | null = null;
      let stopKeys = () => {};
      const captureDraft = () => {
        const node = store.getState().ui.textEdit.node;
        const content = renderer.editedContent();
        if (node && content) saveCanvasDraft(node, content.runs, content.range);
      };
      target.addEventListener('input', captureDraft);
      const stopDraftCapture = registerDraftCapture(captureDraft);
      target.addEventListener('selectionchange', captureDraft);
      const followEdit = () => {
        const ui = store.getState().ui;
        const edit = ui.textEdit;
        if (edit.node !== edited) {
          edited = edit.node;
          stopKeys();
          stopKeys = () => {};
          renderer.editText(store.getState().document, edit.node, TEXT_EDITING);
          const recovered = edit.node === null ? null : canvasDraft(edit.node);
          if (recovered) renderer.showEdited(recovered.runs, recovered.range ?? { start: 0, end: 0 });
          const view = frame.contentWindow;
          if (edit.node !== null && view) stopKeys = installKeymap(store, view);
          else if (frame.ownerDocument.activeElement === frame) frame.blur();
        }
        if (edit.lineBreaks !== lineBreaks) {
          lineBreaks = edit.lineBreaks;
          if (edit.node !== null) {
            renderer.insertLineBreak();
            captureDraft();
          }
        }
        if (edit.selectAlls !== selectAlls) {
          selectAlls = edit.selectAlls;
          if (edit.node !== null) renderer.selectEditedText();
        }
        // the link prompt opens: the selection it acts on is kept, as the prompt takes the focus
        const open = openLinkPrompt(ui) !== null;
        if (open && !prompting) kept = renderer.editedContent()?.range ?? null;
        // a change of the marks (spec text-inline-formatting): applied to the edited text's runs over its selection (or
        // the one the link prompt kept), and drawn with the range it leaves selected
        if (edit.changes !== changes) {
          changes = edit.changes;
          const content = edit.node !== null && edit.change !== null ? renderer.editedContent() : null;
          if (content !== null && edit.change !== null) {
            const end = plainText(content.runs).length;
            const after = applyInlineChange(content.runs, (prompting ? kept : null) ?? content.range ?? { start: end, end }, edit.change);
            renderer.showEdited(after.runs, after.range);
            captureDraft();
          }
        } else if (prompting && !open && edit.node !== null) renderer.focusEdited(kept);
        if (!open) kept = null;
        prompting = open;
      };
      const stopEdit = store.subscribe(followEdit);
      // a closed Details or Dialog is drawn open while it or something inside it is selected (editor-only)
      const reveal = () => renderer.reveal(store.getState().document, store.getState().selection);
      const stopReveal = store.subscribe(reveal);
      reveal();
      // the selected elements drawn as if the state the editor edits held (editor-only, spec state-styles), and the
      // animation the timeline previews drawn at its playhead (editor-only, spec timeline-preview)
      const preview = () => {
        const s = store.getState();
        const state = activeState(s.ui);
        renderer.previewState(s.document, s.selection, state.pseudo === null ? null : state.id);
        renderer.previewTimeline(s.document, timelinePreview(s));
      };
      const stopPreview = store.subscribe(preview);
      preview();
      const stopReader = registerEditReader(() => renderer.editedContent());
      followEdit();
      stop = () => {
        stopTicks();
        target.removeEventListener('load', pageChanged, true);
        target.removeEventListener('scroll', pageChanged);
        framed.disconnect();
        target.fonts.removeEventListener('loadingdone', pageChanged);
        target.removeEventListener('transitionend', pageChanged);
        target.removeEventListener('animationend', pageChanged);
        stopDraftCapture();
        target.removeEventListener('input', captureDraft);
        target.removeEventListener('selectionchange', captureDraft);
        stopDocument();
        stopReveal();
        stopPreview();
        stopEdit();
        stopReader();
        stopKeys();
        stopFileDrop();
      };
    };
    // the srcdoc page may be ready already (a fast load) or still loading
    if (frame.contentDocument?.readyState === 'complete' && frame.contentDocument.body) start();
    frame.addEventListener('load', start);
    return () => {
      frame.removeEventListener('load', start);
      stop();
    };
  }, [store, screen, width, page]);

  useEffect(() => registerFrame(iframe.current), []);

  // the playhead walks while the timeline plays (spec timeline-preview): the loop is the frame's own, so the marker
  // follows the running animation and Pause freezes where the eye left it
  useEffect(() => installPlayingLoop(store), [store]);

  // A new zoom keeps the page point under its pivot there, the middle of the view without one (the camera keeps the
  // horizontal place); a pan's scroll of the page is carried out once. The page inside the frame lays itself out a
  // frame after the zoom (its own document), which drops the scroll written before it: the point is held again on the
  // next frames until it stays (the user's real-use audit, A3.21: the point under the cursor drifted down the page).
  const shown = useRef(zoom);
  const held = useRef<{ readonly pageY: number; readonly at: number; readonly zoom: number } | null>(null);
  const pivot = useEditorState((s) => s.ui.camera.pivot);
  useLayoutEffect(() => {
    const frame = iframe.current;
    if (!frame || shown.current === zoom) return;
    const at = pivot !== null ? pivot.y - frame.getBoundingClientRect().top : height / 2;
    const view = frame.contentWindow;
    // the point this zoom keeps: the one the running gesture already holds, else the one under the pivot now (a wheel's
    // notches arrive faster than the frames, and a write into a layout that has not settled is dropped)
    const carried = held.current !== null && Math.abs(held.current.zoom - shown.current) < 1e-6 ? held.current : null;
    const pageY = carried !== null && Math.abs(carried.at - at) < 0.5 ? carried.pageY : view === null ? 0 : view.scrollY + at / shown.current;
    keepPagePoint(frame, shown.current, zoom, at);
    held.current = { pageY, at, zoom };
    shown.current = zoom;
    let left = 8;
    let request = requestAnimationFrame(function again() {
      const inside = frame.contentWindow;
      // a pan's scroll ended the hold (below): the point is no longer the zoom's to keep, or the hold scrolled the
      // page back over the pan (the open quick panel's move to its label after a zoom never took: DEC-75)
      if (inside === null || left <= 0 || held.current === null) return;
      left -= 1;
      const wanted = pageY - at / zoom;
      if (Math.abs(inside.scrollY - wanted) <= 0.5) {
        held.current = null;
        return;
      }
      inside.scrollTo(inside.scrollX, wanted);
      request = requestAnimationFrame(again);
    });
    return () => cancelAnimationFrame(request);
  }, [zoom, height, pivot]);
  const scroll = useEditorState((s) => s.ui.camera.scroll);
  const scrolled = useRef(scroll.count);
  useLayoutEffect(() => {
    const frame = iframe.current;
    if (frame && scroll.count !== scrolled.current) {
      // a scroll of the page by a pan or a wheel ends a zoom's hold (the two would fight over the scroll)
      held.current = null;
      scrollPageBy(frame, scroll.by);
    }
    scrolled.current = scroll.count;
  }, [scroll]);

  return (
    <div className="frame__view" ref={view}>
      <iframe ref={iframe} className="frame__page" srcDoc={PAGE} sandbox="allow-same-origin" tabIndex={-1} aria-hidden={editing ? undefined : true} style={{ width, height: zoom > 0 ? height / zoom : 0, zoom }} />
      <div className="frame__overlay" data-canvas-overlay ref={overlay}>
        <CanvasChrome />
        <Guides overlay={overlay} />
        <SnapLines overlay={overlay} />
        {/* the layers the installed modules draw over the page (app/modules-view.ts) */}
        {wiring().canvasLayers.map((Layer, i) => (
          <Layer key={i} />
        ))}
      </div>
    </div>
  );
}

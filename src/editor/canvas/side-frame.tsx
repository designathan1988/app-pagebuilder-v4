// A side frame (spec side-by-side-view; drawn by shell/side-by-side.tsx): one of the project's other breakpoints, a
// live page at its width scaled to its column. Its own renderer (editor/canvas/render/render.ts) is mounted in its own
// frame and
// follows every change of the document, so it shows the page through its own media queries; the renderer outlines
// the selection in it. Nothing in it is edited in place: a click on it, or on its head, makes its breakpoint the one
// the canvas edits (view.setBreakpoint). Like the canvas frame, it reaches its page only to hand it to the renderer.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { breakpointName, type ProjectBreakpoint } from '../../core/document/breakpoints.ts';
import { canvasValue } from '../../core/files/values.ts';
import { openedPage } from '../../core/project/pages.ts';
import { PageRenderer, renderModelFromManifest } from './render/render.ts';
import type { NodeId } from '../../generated/commands.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { Icon, useDoor } from '../doors/door.tsx';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';

const MODEL = renderModelFromManifest(manifest.elements, manifest.properties, manifest.interactions);
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

export function SideFrame({ entry, breakpoint }: { readonly entry: DoorEntry; readonly breakpoint: ProjectBreakpoint }) {
  const t = useT();
  const store = useStore();
  const door = useDoor(entry, { breakpoint: breakpoint.id });
  const name = breakpointName(breakpoint, t);
  const body = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const page = useEditorState((s) => openedPage(s));
  const selection = useEditorState((s) => s.selection.join(' '));
  // the column's room: the page's scale is the column's width over the breakpoint's
  useLayoutEffect(() => {
    const element = body.current;
    if (element === null) return;
    const observer = new ResizeObserver(([found]) => {
      if (found) setSize({ width: found.contentRect.width, height: found.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // the page, rendered once the frame is ready and kept in step with every change of the document
  const renderer = useRef<PageRenderer | null>(null);
  // a count of the mounts, so the selection is outlined again in a page mounted anew
  const [mounted, setMounted] = useState(0);
  useEffect(() => {
    const frame = iframe.current;
    if (frame === null) return;
    let stop = () => {};
    const start = () => {
      const target = frame.contentDocument;
      if (target === null) return;
      stop();
      const made = new PageRenderer(target, MODEL, page, { height: breakpoint.height, width: breakpoint.width }, (attribute, value) => canvasValue(store.getState().document, attribute, value));
      made.mount(store.getState().document);
      renderer.current = made;
      setMounted((n) => n + 1);
      stop = store.subscribeDocument((change) => made.apply(change.before, change.after, change.patches));
    };
    if (frame.contentDocument?.readyState === 'complete') start();
    frame.addEventListener('load', start);
    return () => {
      frame.removeEventListener('load', start);
      stop();
      renderer.current = null;
    };
  }, [page, breakpoint.height, breakpoint.width, store]);
  // the selection, outlined in the canvas's selection colour of the editor's theme (the renderer writes it)
  useEffect(() => {
    const colour = getComputedStyle(document.documentElement).getPropertyValue('--color-canvas-selection').trim();
    renderer.current?.outline(selection === '' ? [] : (selection.split(' ') as NodeId[]), colour);
  }, [selection, mounted]);
  const zoom = size.width > 0 ? size.width / breakpoint.width : 0;
  return (
    <section className="side-frame" data-side-frame={breakpoint.id}>
      <button type="button" className={`door door--tab side-frame__head${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify({ breakpoint: breakpoint.id })} title={door.title} aria-disabled={door.available ? undefined : true} onClick={door.run}>
        {entry.door.icon === null ? null : <Icon name={entry.door.icon} size="sm" />}
        <span className="door__label">{name}</span>
        <span className="frame-tab__width">{breakpoint.width}</span>
      </button>
      {/* the page itself takes no press: a click anywhere on it edits its breakpoint, as its head does */}
      <div className="side-frame__body" ref={body} onClick={door.run} aria-hidden>
        <iframe ref={iframe} className="side-frame__page" srcDoc={PAGE} sandbox="allow-same-origin" tabIndex={-1} title={name} style={{ width: breakpoint.width, height: zoom > 0 ? size.height / zoom : 0, zoom }} />
      </div>
    </section>
  );
}

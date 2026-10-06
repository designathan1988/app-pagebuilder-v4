// The centre column: the file tabs, the canvas toolbar with the Canvas /
// Split / Code switch, the rulers, and the frame with its breakpoint tabs along the cascade from the base breakpoint,
// and the page's iframe (src/editor/canvas/frame.tsx) at the camera's zoom (src/editor/view/camera.ts): the chosen one,
// or in Fit mode the one that fits the frame to the stage; the frame is placed at the camera's pan.
import { useContext, useLayoutEffect, useRef, useState } from 'react';
import type { MessageId } from '../../generated/ids.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { CanvasFrame } from '../canvas/frame.tsx';
import { editMode, NO_MODE } from '../canvas/edit-mode.ts';
import { Rulers } from '../canvas/rulers.tsx';
import { DoorControl, Icon } from '../doors/door.tsx';
import { MenuButton } from '../doors/menu.tsx';
import { GLYPHS, doorSlots, slotsIn } from '../doors/placement.ts';
import { codeTabs } from '../explorer/file-tabs.ts';
import { useEditorState } from '../store.ts';
import { FIT_MARGIN, fitZoom, panOf, registerStage } from '../view/camera.ts';
import { activeBreakpoint, viewportWidth } from '../view/breakpoints.ts';
import { activeState } from '../view/style-state.ts';
import { editorView } from '../view/editor-view.ts';
import { CodePane } from './code-pane.tsx';
import { SideBySide } from './side-by-side.tsx';
import { breakpointTabSlot } from './breakpoint-tabs.tsx';
import { breakpointName, breakpointsOf } from '../../core/document/breakpoints.ts';
import { isPanelOpen } from '../workspace/panels.ts';
import { useT } from '../text.ts';
import { ReportFitZoom, Slots, useFitZoom } from './slots.tsx';
import { QuickPanel } from '../canvas/quick-panel.tsx';
import { AnchorTabs } from '../canvas/anchor-tabs.tsx';
import { usePointerValue } from '../input/pointer/use-views.ts';

const PAGE_ICON = manifest.elements.elements.find((e) => e.tag === 'body')?.icon ?? null;
const NO_CODE: readonly string[] = [];

const drawnAs = (entry: DoorEntry): string | null => (entry.door.kind === 'toolbar' || entry.door.kind === 'panel-control' ? entry.door.drawnAs : null);

// The file tabs (DEC-13: always drawn, a single page's tab too, as the canonical frame stands it over the canvas; the
// audit's A3.18 had kept the row for two files and more). Every open page gets its tab, and the page on the canvas is
// marked by its door's own current state (pages.switch); a click opens that page ("Files, tabs and
// code": the tabs list the open pages and code files, and a page tab shows the page on the canvas)
function FileTabs() {
  const pages = useEditorState((s) => s.document.pages);
  // the code files the pane holds open (explorer/file-tabs.ts), in the order they were opened
  const code = useEditorState((s) => codeTabs(s.ui)?.open ?? NO_CODE);
  const fileTab = doorSlots('file-tabs').find((d) => d.door.kind === 'panel-control' && d.door.control === 'file-tab');
  const fileClose = doorSlots('file-tabs').find((d) => d.door.kind === 'panel-control' && d.door.control === 'close');
  // the region's first item is a page's tab (1 page tab), its close button drawn inside it
  const tab = doorSlots('file-tabs').find((d) => drawnAs(d) === 'item');
  // drawn with one page too (the canonical frame: the page's tab always stands over the canvas)
  if (!tab) return null;
  return (
    <div className="file-tabs" data-region="file-tabs" role="tablist" data-key-context="tab-strip">
      {pages.map((one) => (
        <div className="file-tab" key={one.id}>
          <DoorControl entry={tab} args={{ page: one.tree.id }} className="file-tab__main">
            {PAGE_ICON !== null ? <Icon name={PAGE_ICON} size="sm" /> : null}
            <span className="file-tab__name">{one.name}</span>
            <span className="file-tab__file">{one.file}</span>
          </DoorControl>
        </div>
      ))}
      {/* the code files the pane holds: a click shows one, its close button takes it out of the strip */}
      {code.map((path) => (
        <div className="file-tab" key={path}>
          {fileTab === undefined ? null : (
            <DoorControl entry={fileTab} args={{ path }} className="file-tab__main">
              <span className="file-tab__name">{path.slice(path.lastIndexOf('/') + 1)}</span>
              <span className="file-tab__file">{path}</span>
            </DoorControl>
          )}
          {fileClose === undefined ? null : <DoorControl entry={fileClose} args={{ path }} />}
        </div>
      ))}
    </div>
  );
}

function ZoomValue() {
  const zoom = useFitZoom();
  const t = useT();
  return <span className="zoom-value">{t('view.zoomValue', { zoom: Math.round(zoom * 100) })}</span>;
}

// The keys of a drag, in the canvas toolbar while one goes on (the user's real-use audit, item 3.3)
function DragHint() {
  const t = useT();
  const dragging = usePointerValue('drag');
  return dragging === null ? null : (
    <span className="canvas-toolbar__hint" data-chrome="drag-hint">
      {t('canvas.drag.hint')}
    </span>
  );
}

// The Edit on canvas mode in force, in the same toolbar (the audit's item 4.1: "Mode: Padding · Esc exits"): the mode
// itself, and how to leave it. A drag's own hint takes its place while one goes on.
function ModeHint() {
  const t = useT();
  const mode = useEditorState((s) => editMode(s.ui));
  const dragging = usePointerValue('drag');
  // a text edited in place: its keys (the canonical toolbar's hint while text is edited)
  const editing = useEditorState((s) => s.ui.textEdit.node !== null);
  const altMeasuring = usePointerValue('measuring');
  if (editing && dragging === null) return <span className="canvas-toolbar__hint" data-chrome="text-hint">{t('canvas.textEdit.hint')}</span>;
  // Alt held over the canvas: the distances are measured (the canonical toolbar's hint)
  if (altMeasuring && dragging === null) return <span className="canvas-toolbar__hint" data-chrome="measure-hint">{t('canvas.measure.hint')}</span>;
  if (mode === NO_MODE || dragging !== null) return null;
  return (
    <span className="canvas-toolbar__hint" data-chrome="mode-hint">
      {t('canvas.editMode.hint', { mode: t(`canvas.editMode.${mode}` as MessageId) })}
    </span>
  );
}

function CanvasToolbar() {
  const toolsOpen = useEditorState((s) => isPanelOpen(s.ui, 'canvas-tools'));
  // the canvas tools, and the toolbar door that shows or hides them (the one that opens their panel)
  const tools = slotsIn('canvas-toolbar').filter((s) => s.kind === 'door' && s.entry.door.kind === 'panel-control' && s.entry.door.panel === 'canvas-tools').map((s) => s.order);
  const toggleOrder = slotsIn('canvas-toolbar').find((s) => s.kind === 'door' && s.entry.door.args.panel === 'canvas-tools')?.order ?? 0;
  // the canvas tools come first (Select, Layout): what the toolbar holds before its view segments
  const firstSegment = slotsIn('canvas-toolbar').find((s) => s.kind === 'door' && drawnAs(s.entry) === 'segment')?.order ?? 1;
  return (
    <div className="canvas-toolbar" data-region="canvas-toolbar" data-key-context="toolbar">
      {firstSegment > 1 ? (
        <>
          <div className="canvas-toolbar__tools" role="group">
            <Slots region="canvas-toolbar" to={firstSegment - 1} />
          </div>
          <span className="separator" />
        </>
      ) : null}
      <div className="segmented" role="group">
        <Slots region="canvas-toolbar" render={(slot) => (slot.kind === 'door' && drawnAs(slot.entry) === 'segment' ? undefined : null)} />
      </div>
      <span className="separator" />
      <Slots
        region="canvas-toolbar"
        from={toggleOrder}
        render={(slot) => {
          if (slot.kind === 'door' && tools.includes(slot.order) && !toolsOpen) return null;
          if (slot.kind === 'menu' && slot.anchor.drawnAs === 'button') {
            return (
              <MenuButton key={slot.menu} menu={slot.menu} anchor={slot.anchor} indicator className="canvas-toolbar__zoom">
                <ZoomValue />
              </MenuButton>
            );
          }
          return undefined;
        }}
      />
      <DragHint />
      <ModeHint />
    </div>
  );
}

// the frame's edge: dragged, the screen the canvas shows follows the pointer (view/frame-edge.ts)
const FRAME_EDGE = manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'frame-edge');

// The right edge of the frame (spec breakpoints-switch): a separator the pointer drags (the pointer owner runs it, as
// it runs the splitters); the width field and its range stay the keyboard's way to the same width.
function FrameEdge({ width }: { readonly width: number }) {
  const t = useT();
  if (FRAME_EDGE === undefined) return null;
  return <div className="frame__edge" role="separator" aria-orientation="vertical" aria-label={t('command.resizeViewport')} title={t('command.resizeViewport')} aria-valuenow={width} data-door={FRAME_EDGE.ref} />;
}

// The breakpoint tabs stand on the part of the frame the stage shows (`seen`, in the frame's pixels: from its left
// edge to its right, both clipped to the stage), so a frame panned or zoomed past the stage's edge never takes its tabs
// out of reach; and where their names do not fit that width, every tab shows its icon alone, its name kept for
// readers and as its tooltip, and the current one its icon and its name (the user's request of 2026-10-05: the tabs
// broke over two lines). The width the names take is read while they are drawn whole, for the tabs and words drawn now.
function BreakpointTabs({ seen }: { readonly seen: { readonly from: number; readonly to: number } }) {
  const t = useT();
  const row = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const whole = useRef<{ readonly words: string; readonly width: number } | null>(null);
  const room = Math.max(0, seen.to - seen.from);
  // what the tabs say: the project's breakpoints, the one in view and the words of the interface's language
  const said = useEditorState((s) => JSON.stringify([breakpointsOf(s.document), activeBreakpoint(s).id]));
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) return;
    const words = [...element.querySelectorAll('.frame-tab')].map((tab) => `${tab.textContent ?? ''}${tab.classList.contains('is-current') ? '*' : ''}`).join('|');
    if (!compact) {
      whole.current = { words, width: element.scrollWidth };
      if (element.scrollWidth > room + 0.5) setCompact(true);
    } else if (whole.current === null || whole.current.words !== words || whole.current.width <= room + 0.5) {
      // other names, or room enough again: drawn whole once more, and measured
      setCompact(false);
    }
  }, [compact, room, said, t]);
  return (
    <div ref={row} className={`frame-tabs${compact ? ' is-compact' : ''}`} data-region="canvas-breakpoints" role="tablist" style={{ marginLeft: seen.from, width: compact ? undefined : room }}>
      <Slots
        region="canvas-breakpoints"
        render={(slot) => {
          if (slot.kind !== 'door') return undefined;
          return breakpointTabSlot('canvas-breakpoints', slot, (entry, breakpoint, args) => (
            <DoorControl key={`${entry.ref}:${breakpoint.id}`} entry={entry} args={args} className="frame-tab" title={breakpointName(breakpoint, t)}>
              <span className="door__label">{breakpointName(breakpoint, t)}</span>
              <span className="frame-tab__width">{breakpoint.width}</span>
              {breakpoint.base ? (
                <span className="frame-tab__base" title={t('canvas.baseTip')}>
                  {t('canvas.base')}
                </span>
              ) : null}
            </DoorControl>
          ));
        }}
      />
    </div>
  );
}

// While a state other than Base is edited (spec state-styles), a badge over the frame names it: "Editing Hover".
function StateBadge() {
  const t = useT();
  const state = useEditorState((s) => activeState(s.ui));
  if (state.pseudo === null) return null;
  return (
    <div className="canvas-state-badge" data-canvas-badge="state">
      {t('canvas.badge.editingState', { state: t(state.labelKey as MessageId) })}
    </div>
  );
}

// While a breakpoint other than the base is edited (spec breakpoint-overrides; jornada03 J22), a band over the frame
// says where the edits go: "Tablet · 834 px — edits apply to this screen and narrower ones".
function BreakpointBadge() {
  const t = useT();
  const breakpoint = useEditorState((s) => activeBreakpoint(s));
  if (breakpoint.base) return null;
  return (
    // the breakpoint and its width always, what the edits reach where the band has room for it (canvas.css: a phone's
    // frame cut it with an ellipsis, a narrower one broke it over two lines); the whole sentence is its tooltip
    <div className="canvas-breakpoint-badge" data-canvas-badge="breakpoint" title={t('canvas.badge.editingBreakpoint', { breakpoint: breakpointName(breakpoint, t), width: breakpoint.width })}>
      <Icon name={GLYPHS.warning} size="sm" />
      <span className="canvas-breakpoint-badge__name">{t('canvas.badge.breakpoint', { breakpoint: breakpointName(breakpoint, t), width: breakpoint.width })}</span>
      <span className="canvas-breakpoint-badge__scope">{t('canvas.badge.breakpointScope')}</span>
    </div>
  );
}

export function CanvasColumn() {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // whether the stage is drawn: the Code view draws none, and coming back draws a new one, which the measure, the
  // observer and the camera must follow (the audit's U-005: Fit stayed at 100 % after the Code view)
  const stageShown = useEditorState((s) => editorView(s.ui) !== 'code');
  // measured before the first paint, so the canvas never shows an unfitted frame (at zoom 1) before it fits: a layout
  // read right after the editor appears must see the fitted canvas; the observer then follows every later resize
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const first = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const width = first.width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0);
    const height = first.height - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0) - (parseFloat(style.borderTopWidth) || 0) - (parseFloat(style.borderBottomWidth) || 0);
    setSize({ width, height });
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageShown]);
  // the camera's zoom: the chosen one, or the one that fits the base breakpoint's width with the fit margin on both
  // sides; the stage's width is reported to the camera, whose handlers pivot and fit on it
  const chosen = useEditorState((s) => s.ui.preferences.zoom);
  // the page's width: the active breakpoint's (view/breakpoints.ts)
  const pageWidth = useEditorState((s) => viewportWidth(s));
  // the breakpoint's screen height: what vh measures in the page and where the fold lines fall (item 2.3)
  const pageHeight = useEditorState((s) => activeBreakpoint(s).height);
  const zoom = chosen !== undefined ? chosen / 100 : fitZoom(size.width, pageWidth);
  const pan = useEditorState((s) => panOf(s, zoom, size.width));
  useLayoutEffect(() => registerStage(stage.current), [stageShown]);
  const report = useContext(ReportFitZoom);
  useLayoutEffect(() => report(zoom), [report, zoom]);
  // Space held over the stage, or a pan in progress: the grab cursor (spec zoom-wheel-pan)
  const panning = usePointerValue('panState');
  const rulersHidden = useEditorState((s) => s.ui.preferences.rulersHidden === true);
  // the view (view/editor-view.ts): the canvas, the canvas with the code pane beside it, or the code pane alone
  const view = useEditorState((s) => editorView(s.ui));
  return (
    <>
      {/* the canvas's keys belong to the stage and its rulers alone: the file tabs, the toolbar and the code pane beside
          it are no canvas, so Delete in the code pane never deletes the selected element (spec code-panel) */}
      <main className={`centre centre--${view}`}>
        <FileTabs />
        {/* the toolbar stands in every view: the Canvas / Split / Code segments are the way back */}
        <CanvasToolbar />
        <div className="centre__work">
          {view === 'code' ? null : (
            <div className="centre__column">
              <div className={`stage-wrap${rulersHidden ? ' stage-wrap--no-rulers' : ''}`} data-key-context="canvas">
                <Rulers />
                {/* the stage around the page: a press here is on no node (pointer.ts) */}
                <div className={`stage${panning !== 'idle' ? ` stage--${panning}` : ''}`} ref={stage} data-canvas-stage data-region="canvas-stage">
                  <div className="frame" data-region="canvas-frame" style={{ width: pageWidth * zoom, left: FIT_MARGIN + pan }}>
                    {/* the breakpoints, a row of tabs attached to the frame they switch (the owner's decision D-1; the
                        canonical frame): their row takes its own width, so at a small zoom the tabs run past the
                        frame's edge instead of being cut or overlapping (the audit's A3.18) */}
                    <BreakpointTabs seen={{ from: Math.max(0, -(FIT_MARGIN + pan)), to: Math.min(pageWidth * zoom, size.width - (FIT_MARGIN + pan)) }} />
                    <StateBadge />
                    <BreakpointBadge />
                    {/* the edge first: the page's overlay (its handles at the page's edge) is drawn over it */}
                    <FrameEdge width={pageWidth} />
                    <CanvasFrame width={pageWidth} screen={pageHeight} zoom={zoom} />
                  </div>
                  {/* the quick panel of the selection, over the stage (canvas/quick-panel.tsx) */}
                  <QuickPanel stage={stage} />
                  {/* the anchor tabs of a positioned selection (canvas/anchor-tabs.tsx) */}
                  <AnchorTabs stage={stage} />
                </div>
              </div>
            </div>
          )}
          {view === 'code' ? null : <SideBySide />}
          {view === 'canvas' ? null : <CodePane />}
        </div>
      </main>
    </>
  );
}

export { ZoomValue };

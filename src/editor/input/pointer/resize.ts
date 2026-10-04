// Resizing and moving on the canvas (plan I.12): a resize handle, a positioned element moved freely, snapping, and
// the handle gestures let go.
import type { Gesture } from '../../../core/store/store.ts';
import type { CommandId } from '../../../generated/ids.ts';
import type { Point } from '../../canvas/coordinates.ts';
import { snapMode, snapMove, snapResize, snapShown } from '../../canvas/snapping.ts';
import { SPLITTERS, type SplitterId } from '../../workspace/layout.ts';
import { FREE_DRAG } from './common.ts';
import type { PointerOwner } from './owner.ts';

export function pointerResize(p: PointerOwner): Pick<PointerOwner, 'resize' | 'positionedNow' | 'snappedResize' | 'moveFree' | 'dropHandleGestures'> {
  const { ps, shared, store } = p;
  const { setBanding, setResizing, setGuideOnRuler, setPanView } = p.views;
  // The splitter follows the pointer from the press on: its travel along the splitter's own axis is handed to the
  // command, which sizes the panel from the size it held at the press (spec panel-resize); the gesture is cancelled
  // back to that size first, so Escape puts it back
  const resize = (at: Point) => {
    if (ps.splitting === null) return;
    const { press, start, from } = ps.splitting;
    const axis = SPLITTERS[String(press.args.splitter ?? '') as SplitterId]?.axis ?? 'x';
    const distance = axis === 'x' ? Math.round(at.x - start.x) : Math.round(at.y - start.y);
    shared.open?.cancel();
    shared.open = store.gesture();
    shared.open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, size: from, distance } as never);
  };
  // While a drag goes on, each pointer position proposes a drop; a new proposal replaces the pointer's own only once
  // the pointer is drag.hysteresis screen pixels from where that one was taken. A creation drag proposes a drop only
  // over the page (the canvas overlay): over the stage around it or over a panel it proposes none (spec
  // palette-drag-insert, "Hit zones").
  // whether the selection is one a free drag moves: its command's predicate holds (a lock still refuses the move,
  // which the status bar says)
  const positionedNow = () => {
    if (FREE_DRAG === null) return false;
    const why = store.refusal(FREE_DRAG.command.id as CommandId, { ...FREE_DRAG.door.args, dx: 0, dy: 0 } as never);
    return why === null || why.key !== FREE_DRAG.command.availability.refusalKey;
  };
  // A resize's travel in page px: with snap on and Ctrl not held, the dragged edges are pulled to the nearest enabled
  // target first (canvas/snapping.ts); with smart guides on, what they align with is drawn. Alt (from the centre) and
  // Shift (the aspect) keep their own meanings.
  const snappedResize = (r: NonNullable<typeof ps.resizing>, dx: number, dy: number, suspended: boolean): Point => {
    const state = store.getState();
    const mode = snapMode(state, suspended);
    if ((!mode.apply && !mode.hint) || r.box === null) {
      snapShown.set(null);
      return { x: dx, y: dy };
    }
    const sides = r.handle.slice(r.handle.lastIndexOf('-') + 1);
    const east = sides.includes('e');
    const west = sides.includes('w');
    const south = sides.includes('s');
    const north = sides.includes('n');
    const box = { x: r.box.x + (west ? dx : 0), y: r.box.y + (north ? dy : 0), width: r.box.width + (east ? dx : west ? -dx : 0), height: r.box.height + (south ? dy : north ? -dy : 0) };
    const snapped = snapResize(state, r.node, box, sides, r.zoom, mode.apply);
    snapShown.set(mode.hint ? snapped : null);
    return { x: dx + snapped.offset.x, y: dy + snapped.offset.y };
  };
  // a free drag follows the pointer: the travel since the press, in whole page px, less what already ran; with snap on
  // and Ctrl not held, the moved box is pulled to the nearest enabled target or equal gap first (canvas/snapping.ts);
  // with smart guides on, what it aligns with and the gaps it repeats are drawn
  const moveFree = (at: Point, suspended: boolean) => {
    if (ps.freeing === null || shared.open === null || FREE_DRAG === null) return;
    const travel = { x: (at.x - ps.freeing.start.x) / ps.freeing.zoom, y: (at.y - ps.freeing.start.y) / ps.freeing.zoom };
    const state = store.getState();
    const mode = snapMode(state, suspended);
    const freeing = ps.freeing;
    const snapped = (mode.apply || mode.hint) && freeing.node !== null && freeing.box !== null ? snapMove(state, freeing.node, { ...freeing.box, x: freeing.box.x + travel.x, y: freeing.box.y + travel.y }, freeing.zoom, mode.apply) : null;
    snapShown.set(mode.hint ? snapped : null);
    const total = { x: Math.round(travel.x + (snapped?.offset.x ?? 0)), y: Math.round(travel.y + (snapped?.offset.y ?? 0)) };
    const dx = total.x - ps.freeing.applied.x;
    const dy = total.y - ps.freeing.applied.y;
    if (dx === 0 && dy === 0) return;
    ps.freeing.applied = total;
    shared.open.dispatch(FREE_DRAG.command.id as CommandId, { ...FREE_DRAG.door.args, dx, dy } as never);
  };
  const dropHandleGestures = () => {
    p.dropTool();
    const opened = [ps.spacing?.gesture, ps.guiding?.gesture, ps.rotating?.gesture, ps.resizing?.gesture].filter((g): g is Gesture => g != null);
    const panned = shared.panning !== null;
    ps.spacing = null;
    setBanding(null);
    ps.guiding = null;
    ps.rotating = null;
    setResizing(null);
    ps.resizing = null;
    shared.panning = null;
    ps.pickingColor = null;
    setGuideOnRuler(null);
    snapShown.set(null);
    if (panned) setPanView(shared.spaceDown ? 'armed' : 'idle');
    for (const gesture of opened) {
      if (shared.open === gesture) shared.open = null;
      gesture.cancel();
    }
  };
  return { resize, positionedNow, snappedResize, moveFree, dropHandleGestures };
}

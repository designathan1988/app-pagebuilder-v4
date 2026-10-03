// The Select tool on a region the Layout tool drew (spec layout-composer, "With the Select tool"): a region is a cell
// of the grid its container is laid out in, so a width written on it or its element moved among its siblings changes
// nothing the person sees. While the Layout tool is off, a press on a region's element (or on a resize handle of the
// one selected region) is this tool's: the drag runs layout.place at every move, through the gesture the pointer owner
// opened, so the page follows the pointer and the release keeps one undo step; the region's box in the layout moves or
// resizes, snapped as the Layout tool snaps, and the grid is laid out again from it. A press and release in place on a
// region selects it as a click does. Any other press is the Select tool's own.
import { activeBreakpoint, canvasFrame, geometryOf, locate, manifest, nodeAt, numberConstant, pageShown } from '../../../editor/host.ts';
import type { CommandId, NodeId, PointerTool, ToolPoint, ToolSession } from '../../../editor/host.ts';
import type { PlaceEdges } from '../gestures/recognize.ts';
import { HEIGHT, WIDTH } from '../geometry/keys.ts';
import { regionOf } from '../host/handlers.ts';
import { composerOf } from '../host/state.ts';

// a press that travels less than this (screen px) is a click
const CLICK_TRAVEL = numberConstant('drag.threshold');

// the command a region's drag runs (its doors: manifest/commands/layout-composer.json), and the click's
const PLACE = (manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.gesture === 'layout-place')?.command.id ?? '') as CommandId;
const CLICK: CommandId | null = manifest.doors.find((d) => d.door.kind === 'canvas-click' && d.door.button === 'primary' && d.door.count === 1 && d.door.modifier === null && d.command.args.target?.type === 'node')?.command.id ?? null;

// the Select tool's resize handles (the canvas handles that write a width or a height), by their door, and the edges
// each moves: the compass point its handle id ends with
const RESIZE_HANDLES = new Map<string, PlaceEdges>(
  manifest.doors
    .filter((d) => d.door.kind === 'canvas-handle' && d.door.adapter.writes.some((w) => w === WIDTH || w === HEIGHT))
    .map((d) => [d.ref, (d.door.kind === 'canvas-handle' ? d.door.handle : '').split('-').at(-1) as PlaceEdges]),
);

export const placeTool: PointerTool = {
  id: 'layout-place',
  press(at, target, state): ToolSession | null {
    // the Layout tool draws on its own stage; a narrower screen keeps the layout its own way
    if (composerOf(state.ui) !== null || !activeBreakpoint(state).base || at.shift || at.alt || at.ctrl) return null;
    const tree = pageShown(state)?.tree;
    const frame = canvasFrame();
    if (tree === undefined || frame === null) return null;
    const handle = target.closest('[data-door]')?.getAttribute('data-door') ?? null;
    const resized = handle === null ? undefined : RESIZE_HANDLES.get(handle);
    let node: string | null;
    let edges: PlaceEdges;
    if (resized !== undefined) {
      // a resize handle of the one selected element
      if (state.selection.length !== 1) return null;
      node = state.selection[0] as string;
      edges = resized;
    } else {
      // a press on any other control of the canvas (a label, a button) is that control's
      if (handle !== null) return null;
      node = nodeAt(frame, { x: at.x, y: at.y })?.node ?? null;
      edges = 'move';
    }
    if (node === null || regionOf(tree, node) === null || locate(state.document, node as NodeId) === null) return null;
    const zoom = geometryOf(frame)?.zoom ?? 1;
    const id = node;
    let travelled = false;
    const travel = (next: ToolPoint) => ({ target: id, edges, dx: Math.round((next.x - at.x) / zoom), dy: Math.round((next.y - at.y) / zoom) });
    return {
      move(next) {
        if (!travelled && Math.hypot(next.x - at.x, next.y - at.y) < CLICK_TRAVEL) return null;
        travelled = true;
        return { command: PLACE, args: travel(next) };
      },
      release(_next, gesture) {
        // a click on a region selects it, as anywhere on the page
        if (!travelled) {
          if (edges === 'move' && CLICK !== null) gesture.dispatch(CLICK as never, { target: id } as never);
          return;
        }
        // the last move placed the region where it is let go (each move runs layout.place anew from the press)
        // the region dragged is selected after, as a dragged element is
        if (CLICK !== null && !(state.selection.length === 1 && state.selection[0] === id)) gesture.dispatch(CLICK as never, { target: id } as never);
      },
      cancel() {},
    };
  },
};

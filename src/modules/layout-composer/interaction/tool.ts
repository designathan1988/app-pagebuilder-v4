// The Layout Composer's canvas tool (editor/input/pointer-tools.ts): while a container is composed, a primary press on
// its stage (ui/overlay.tsx, [data-layout-stage]) is the composer's. The press, its moves and its release are read in
// the container's own px (the stage's screen box over the intent's viewport); the moves only draw the preview
// (preview.ts); the release dispatches the one door it means through the gesture the pointer owner opened, so it is
// one undo step:
//  - a press and release in place, on no handle or on a region's label: a click — layout.select (layout-region,
//    -add with Shift, -cycle with Alt) on the deepest region under it, or the empty selection;
//  - a drag from a handle ([data-layout-handle]): layout.stroke with the handle (layout-boundary, -gap, -repeat,
//    -vertex, -move: a region's label);
//  - any other drag: layout.stroke (layout-stage) with the tool's mode, or the mode the key held gives (Ctrl moves the
//    region dragged, Shift selects the regions boxed, S held splits, M held merges, Alt subtracts: interactions.json
//    layout-stroke).
import { canvasFrame, geometryOf, locate, manifest, numberConstant, textOf } from '../../../editor/host.ts';
import type { CommandId, Gesture, KeyContextId, MessageId, PointerTool, ToolPoint, ToolSession } from '../../../editor/host.ts';
import { hitRegions } from '../geometry/geometry.ts';
import { handleOf, readStroke, type StrokeMode } from '../gestures/recognize.ts';
import { cycleSelection } from '../gestures/structural.ts';
import type { Point } from '../intent/model.ts';
import { hitRadius, namingWith } from '../host/handlers.ts';
import { recordOf } from '../host/record.ts';
import { composerOf } from '../host/state.ts';
import { preview } from './preview.ts';

// a press that travels less than this (screen px) is a click: the drag threshold the editor's drags share
const CLICK_TRAVEL = numberConstant('drag.threshold');

// the meanings of the keys held during a stroke, from the gesture (interactions.json layout-stroke)
const STROKE_KEYS: Readonly<Record<string, StrokeMode>> = { 'move-dragged-region': 'move', 'select-boxed-regions': 'select', 'cut-along-stroke': 'cut', 'merge-swept-regions': 'merge', 'subtract-dragged-box': 'subtract' };
const KEYED = Object.fromEntries((manifest.interactions.gestures.find((g) => g.id === 'layout-stroke')?.modifiers ?? []).map((m) => [m.key, STROKE_KEYS[m.meaning]])) as Readonly<Record<string, StrokeMode | undefined>>;

// the commands a click and a stroke run: the doors' own (manifest/commands/layout-composer.json)
const commandOf = (find: (entry: (typeof manifest.doors)[number]) => boolean): CommandId => (manifest.doors.find(find)?.command.id ?? '') as CommandId;
const SELECT = commandOf((d) => d.door.kind === 'canvas-click' && d.door.gesture === 'layout-click');
const STROKE = commandOf((d) => d.door.kind === 'canvas-drag' && d.door.gesture === 'layout-stroke');

// The mode a stroke is read in: the letter held, else the modifier held, else the tool chosen.
function modeOf(at: ToolPoint, tool: StrokeMode): StrokeMode {
  // a letter held is a spring-loaded tool (S splits, M merges), as a tool's key held in a design tool switches to it
  for (const letter of at.letters) if (KEYED[letter] !== undefined) return KEYED[letter];
  if (at.ctrl && KEYED.Ctrl !== undefined) return KEYED.Ctrl;
  if (at.shift && KEYED.Shift !== undefined) return KEYED.Shift;
  if (at.alt && KEYED.Alt !== undefined) return KEYED.Alt;
  return tool;
}

// A point of the stroke on the container's whole px (regions are drawn on the pixel grid): what the command receives
// is what the preview read.
const rounded = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

// the composer's own key context (interactions.json): Escape leaves it, Delete deletes the selected regions
const KEY_CONTEXT = 'layout-composer' as KeyContextId;

export const layoutTool: PointerTool = {
  id: 'layout-composer',
  keyContext: (ui) => (composerOf(ui) === null ? null : KEY_CONTEXT),
  press(at, target, state): ToolSession | null {
    const composer = composerOf(state.ui);
    if (composer === null) return null;
    const stage = target.closest<HTMLElement>('[data-layout-stage]');
    if (stage === null) return null;
    const container = locate(state.document, composer.target)?.node;
    const record = container === undefined ? null : recordOf(container);
    if (record === null) return null;
    const box = stage.getBoundingClientRect();
    const measured = stage.hasAttribute('data-measured');
    // at the drawing's width the stage is the intent's viewport; narrower, it is the container where the page lays it
    // out, in the page's px under the frame's zoom
    const frame = canvasFrame();
    const scale = measured ? (frame === null ? 1 : (geometryOf(frame)?.zoom ?? 1)) : box.width / record.intent.viewport.width;
    if (!(scale > 0)) return null;
    const local = (p: ToolPoint): Point => rounded({ x: (p.x - box.left) / scale, y: (p.y - box.top) / scale });
    const handleText = target.closest('[data-layout-handle]')?.getAttribute('data-layout-handle') ?? null;
    const handle = handleText === null ? null : handleOf(handleText);
    const locale = state.ui.preferences.locale;
    const naming = namingWith((key, params) => textOf(locale, key as MessageId, params));
    const radius = hitRadius(state);
    const points: Point[] = [local(at)];
    let travelled = false;
    const read = (mode: StrokeMode) => readStroke(record.intent, { points, mode, handle, radius, selected: composer.selection }, naming);
    return {
      move(next) {
        if (!travelled && Math.hypot(next.x - at.x, next.y - at.y) < CLICK_TRAVEL) return null;
        travelled = true;
        points.push(local(next));
        // narrower than the drawing the page lays the regions out its own way: no preview, the command says why
        if (measured) return null;
        preview.set({ points: [...points], reading: read(handle === null ? modeOf(next, composer.tool) : 'auto') });
        return null;
      },
      release(next: ToolPoint, gesture: Gesture) {
        preview.set(null);
        if (!travelled && (handle === null || handle.kind === 'move')) {
          const point = points[0] as Point;
          const mode = next.alt ? 'cycle' : next.shift ? 'add' : 'replace';
          // narrower than the drawing, the region is the one drawn under the pointer where the page lays it out
          const under = target.closest('[data-layout-region]')?.getAttribute('data-layout-region') ?? null;
          const picked = measured ? under : mode === 'cycle' ? cycleSelection(record.intent, point, composer.selection.at(-1) ?? null) : (hitRegions(record.intent.regions, point)[0]?.id ?? null);
          gesture.dispatch(SELECT as never, { regions: picked === null ? [] : [picked], mode } as never);
          return;
        }
        if (travelled) points.push(local(next));
        gesture.dispatch(STROKE as never, { mode: handle === null ? modeOf(next, composer.tool) : 'auto', points: [...points], ...(handleText === null ? {} : { handle: handleText }) } as never);
      },
      cancel() {
        preview.set(null);
      },
    };
  },
};

// The gesture state machine (split out of src/editor/input/pointer.ts, which keeps the installer): what a press lands
// on, the states a gesture passes through, and the transition that turns a press into a drag once the pointer has
// moved drag.threshold screen pixels. Pure: it reads the manifest's constants and holds no state of its own, so it can
// be read (and tested) on its own.
import type { DoorEntry } from '../../../manifest/runtime.ts';
import type { Point } from '../../canvas/coordinates.ts';
import type { Panel } from '../../workspace/panel-catalogue.ts';
import { manifest } from '../../../manifest/runtime.ts';

const threshold = manifest.interactions.constants.find((c) => c.id === 'drag.threshold')?.value;
export const DRAG_THRESHOLD = typeof threshold === 'number' ? threshold : 4;
const hysteresis = manifest.interactions.constants.find((c) => c.id === 'drag.hysteresis')?.value;
if (typeof hysteresis !== 'number') throw new Error('interactions.json has no number drag.hysteresis');
export const DRAG_HYSTERESIS = hysteresis;

// What a press lands on: a node of the page (an element, or the page root where no element is), or the stage
// around the page.
// A press on the canvas chrome's label of an element is a press on that element (`label`: never a marquee).
// A press on a palette tile carries the tile's door and the arguments the tile stands for (its entry).
// A press on a number field's label carries the scrub door, the arguments the label stands for (its field's property)
// and the text the field holds at the press.
export type Press =
  | { readonly on: 'node'; readonly node: string; readonly root: boolean; readonly label?: boolean }
  | { readonly on: 'stage' }
  | { readonly on: 'tile'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>> }
  // a press on a Layers row: it selects on its click (shell/sidebar/layers.tsx) and arms the row's drag (spec
  // layers-drag)
  | { readonly on: 'row'; readonly node: string }
  | { readonly on: 'scrub'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly value: string }
  // a press on a stop of the gradient bar: the stop drag's door, the arguments the stop stands for, its index and the
  // bar it moves along (spec gradient-editor)
  | { readonly on: 'stop'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly index: number; readonly bar: { readonly left: number; readonly width: number } }
  // a press on a shadow's light pad: the pad's drag door, the arguments the pad stands for (its property and layer) and
  // the pad's centre (spec shadow-editor)
  | { readonly on: 'pad'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly centre: Point; readonly element: HTMLElement }
  // a press on the quick panel's grip: its drag door, the arguments the grip stands for (the element) and the offset
  // the panel is drawn at now (spec quick-panel)
  | { readonly on: 'grip'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly base: Point }
  // a press on a splitter: its drag door and the splitter it stands for (spec panel-resize)
  | { readonly on: 'splitter'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>> }
  // a press on a shadow editor's layer row (A3.34): its move door, the arguments the row stands for (the layer's
  // index) and the rows' boxes as they were drawn, to work the target index out of the pointer's y
  | { readonly on: 'layer'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly index: number; readonly rows: readonly { readonly top: number; readonly bottom: number }[] }
  // a press on a row of the Explorer's file tree (spec explorer-file-system): its move door and the path the row
  // stands for; the release moves it into the folder row the pointer is over
  | { readonly on: 'explorer'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly path: string }
  // a press on a column of the Data panel (spec content-data, "binding"): its drag door and the field it stands for;
  // the release binds the element's part the pointer is over to that field
  | { readonly on: 'column'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly field: string }
  // a press on the timeline's ruler or on a keyframe of its track (specs timeline-preview, timeline-keyframes): the
  // drag's door, the arguments the keyframe stands for (its animation and offset), and the track's box
  | { readonly on: 'playhead'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly track: { readonly left: number; readonly width: number } }
  | { readonly on: 'keyframe'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly track: { readonly left: number; readonly width: number } }
  // a press on a panel's header (spec floating-panels): its drag door and the panel it moves; the release runs the
  // door of the place the pointer is in (workspace/panel-drag.ts)
  | { readonly on: 'panel'; readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly panel: Panel };

// The gesture state machine. A press becomes a drag once the pointer has moved drag.threshold screen pixels from
// where it went down; below that, the release ends a click.
export type Machine =
  | { readonly phase: 'idle' }
  | { readonly phase: 'pressed' | 'dragging'; readonly pointer: number; readonly start: Point; readonly press: Press };

export type MachineEvent =
  | { readonly type: 'down'; readonly pointer: number; readonly at: Point; readonly press: Press }
  | { readonly type: 'move'; readonly pointer: number; readonly at: Point }
  | { readonly type: 'up'; readonly pointer: number }
  | { readonly type: 'cancel' };

// what the owner does on a transition: open the gesture's transaction and run the press's door, start the drag of
// the press's source, commit the transaction, or cancel it
export type Effect = 'press' | 'drag' | 'commit' | 'cancel' | null;

export const IDLE: Machine = { phase: 'idle' };

export function step(machine: Machine, event: MachineEvent, dragThreshold = DRAG_THRESHOLD): { readonly machine: Machine; readonly effect: Effect } {
  if (event.type === 'cancel') return machine.phase === 'idle' ? { machine, effect: null } : { machine: IDLE, effect: 'cancel' };
  if (machine.phase === 'idle') {
    if (event.type !== 'down') return { machine, effect: null };
    return { machine: { phase: 'pressed', pointer: event.pointer, start: event.at, press: event.press }, effect: 'press' };
  }
  // another pointer (a second finger, a pen) does not join the gesture
  if (event.type === 'down' || event.pointer !== machine.pointer) return { machine, effect: null };
  if (event.type === 'up') return { machine: IDLE, effect: 'commit' };
  if (machine.phase === 'pressed' && Math.hypot(event.at.x - machine.start.x, event.at.y - machine.start.y) >= dragThreshold) {
    return { machine: { ...machine, phase: 'dragging' }, effect: 'drag' };
  }
  return { machine, effect: null };
}

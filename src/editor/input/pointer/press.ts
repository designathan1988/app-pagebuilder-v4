// Which door a canvas press runs (split out of src/editor/input/pointer.ts, which keeps the installer): the facts a
// press is judged by, the manifest's own canvas-click doors with the target each one takes, the modifier held, and the
// arguments a door is dispatched with. It reads the manifest and the live canvas, holds no state and installs nothing.
import type { DoorEntry } from '../../../manifest/runtime.ts';
import { manifest } from '../../../manifest/runtime.ts';
import { computedValues } from '../../canvas/coordinates.ts';
import { MODEL_RULES } from '../../store.ts';
import type { Press } from './machine.ts';

// What the canvas knows of a press beyond where it lands: whether its node is a text element, and the node whose text
// is edited in place (text-edit.ts), if any.
export interface PressFacts {
  readonly textual: boolean;
  // whether its node lays its children out as a grid (a double click opens the canvas grid editor on it)
  readonly grid?: boolean;
  readonly edited: string | null;
  // whether its node is a form control whose value is edited in the inspector, never on the canvas (spec
  // elements-form-inputs-rules, Problems in Pager 1)
  readonly formControl?: boolean;
}
const NO_FACTS: PressFacts = { textual: false, edited: null };
// The value predicate that says a node lays its children out as a grid, and the property it reads (the manifest's own
// data): what a double click on the canvas asks before it opens the grid editor.
const GRID_CONTAINER = 'gridContainer';
const GRID_DISPLAY = MODEL_RULES.valuePredicates.get(GRID_CONTAINER)?.property ?? '';
export const laysGrid = (id: string): boolean => {
  const values = GRID_DISPLAY === '' ? null : computedValues(id, [GRID_DISPLAY], new Map());
  return (values?.[GRID_DISPLAY] ?? '').includes('grid');
};

// The canvas-click doors of the manifest, and whether one's target takes a press: "element-or-page" any node,
// "element" a node that is not the page root, "stage-outside-page" the stage, "text-element" a text element,
// "outside-edited-element" anywhere but the element whose text is edited (while one is). The other targets (an
// interaction's target being picked, a form control) arrive with their features.
const CLICKS = manifest.doors.filter((d) => d.door.kind === 'canvas-click');

// What is being picked now, if anything: an interaction's target (its index; spec events-actions) or a motion action's
// target (its timeline and its id; spec motion-timeline). A press on an element then gives that element.
export interface Picking {
  readonly interaction: number | null;
  readonly motion: { readonly timeline: string; readonly action: string } | null;
}
export const NOT_PICKING: Picking = { interaction: null, motion: null };
const OUTSIDE_EDIT = 'outside-edited-element';
function takes(target: string, press: Press, facts: PressFacts, picking: Picking): boolean {
  if (target === 'element-or-page') return press.on === 'node';
  if (target === 'element') return press.on === 'node' && !press.root;
  if (target === 'stage-outside-page') return press.on === 'stage';
  if (target === 'text-element') return press.on === 'node' && !press.root && facts.textual;
  if (target === 'form-control') return press.on === 'node' && !press.root && facts.formControl === true;
  // an interaction's target being picked (spec events-actions): the press lands on the element it names
  if (target === 'pick-target') return press.on === 'node' && picking.interaction !== null;
  // a motion action's target being picked (spec motion-timeline)
  if (target === 'pick-motion-target') return press.on === 'node' && picking.motion !== null;
  if (target === 'grid-container') return press.on === 'node' && !press.root && facts.grid === true;
  // an element of a captured page (spec capture-url): its captured node, never an authored one
  if (target === 'captured-element') return press.on === 'captured';
  // a press on a palette tile or on a field's label is no press on the canvas: it keeps no text
  if (target === OUTSIDE_EDIT) return (press.on === 'node' || press.on === 'stage' || press.on === 'row') && facts.edited !== null && !(press.on === 'node' && press.node === facts.edited);
  return false;
}

export type Button = 'primary' | 'secondary';
const matches = (d: DoorEntry, button: Button, count: number, modifier: string | null) => d.door.kind === 'canvas-click' && d.door.button === button && d.door.count === count && d.door.modifier === modifier;
// The door a press runs.
export function clickDoor(press: Press, button: Button, count: number, modifier: string | null, facts: PressFacts = NO_FACTS, picking: Picking = NOT_PICKING): DoorEntry | null {
  return CLICKS.find((d) => matches(d, button, count, modifier) && d.door.kind === 'canvas-click' && d.door.target !== OUTSIDE_EDIT && takes(d.door.target, press, facts, picking)) ?? null;
}
// The door a press outside the edited text runs first, keeping the text (spec text-edit-inline: a click elsewhere
// keeps it, and selects there): null when no text is edited or the press is on it.
export function editEndDoor(press: Press, button: Button, count: number, modifier: string | null, facts: PressFacts): DoorEntry | null {
  return CLICKS.find((d) => matches(d, button, count, modifier) && d.door.kind === 'canvas-click' && d.door.target === OUTSIDE_EDIT && takes(d.door.target, press, facts, NOT_PICKING)) ?? null;
}

// A door's arguments for a press: its own, and the node it acts on when its adapter acts on the gesture's target. The
// pick of an interaction's target carries the interaction being picked and the node the press landed on.
export function argsFor(entry: DoorEntry, press: Press, picking: Picking): Record<string, unknown> {
  if (entry.door.kind === 'canvas-click' && entry.door.target === 'pick-target' && press.on === 'node') {
    return picking.interaction === null ? { ...entry.door.args } : { ...entry.door.args, interaction: picking.interaction, changes: { target: press.node } };
  }
  if (entry.door.kind === 'canvas-click' && entry.door.target === 'pick-motion-target' && press.on === 'node') {
    return picking.motion === null ? { ...entry.door.args } : { ...entry.door.args, timeline: picking.motion.timeline, action: picking.motion.action, value: { kind: 'element', node: press.node } };
  }
  return entry.door.adapter.selection === 'target' && (press.on === 'node' || press.on === 'captured') ? { ...entry.door.args, target: press.node } : { ...entry.door.args };
}

const MODIFIERS = [
  ['shiftKey', 'Shift'],
  ['ctrlKey', 'Ctrl'],
  ['altKey', 'Alt'],
  ['metaKey', 'Meta'],
] as const;
// the one modifier held, as the manifest names it; null for none (two held match no door). A panel control drawn
// for several doors of one gesture told apart by their modifier (a Layers row: click, Shift+click, Ctrl+click) runs
// the door of the modifier its click holds, read the same way.
export function modifierOf(event: Readonly<Record<(typeof MODIFIERS)[number][0], boolean>>): string | null {
  const held = MODIFIERS.filter(([key]) => event[key]).map(([, name]) => name);
  return held.length === 1 ? (held[0] ?? null) : held.length === 0 ? null : 'several';
}

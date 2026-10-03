// The canvas handles of the Edit on canvas modes (INVENTORY.md, owners; spec spacing-handles,
// radius-border-gap-handles): the one owner of what a handle's door stands for, what value it drags and how that value
// reaches its command, for the chrome that draws it (edit-handles.tsx), the pointer owner that drags it (pointer.ts)
// and handle.step, the arrows of a focused handle.
//  - What a handle stands for (handleArgs), read from its door: a spacing band its box and side (padding-top: padding,
//    top); the radius corner every corner (style.setRadius's first corners value, all); a border handle its side (its
//    border-*-width longhand's place in border-width, a side of style.setBorder); a gap band the property it writes
//    (the gap composite when it writes row-gap and column-gap, else its longhand).
//  - The argument its value goes in (valueArg): its command's first text argument it does not stand for.
//  - The shadow a shadow handle edits (shadowOf, spec shadow-handles): the first layer of the element's text shadow
//    when it holds one (Problems in Pager 4), else of its box shadow; none when it holds neither.
//  - handle.step: the focused handle's value (the one the primary selected element holds for the handle's first
//    property, a px length, else 0) one handle.keyStep more or less, never below 0, written with the handle's command,
//    one undo step; on a shadow handle its first layer's X (offset) or blur; nothing for a key with no handle focused.
import { registerHandler, type Outcome } from '../../core/commands/registry.ts';
import { locate } from '../../core/document/model.ts';
import { setBorderCommand, setRadiusCommand } from '../../core/style/border.ts';
import { setStyleCommand } from '../../core/style/set.ts';
import { storedValue } from '../../core/style/stored.ts';
import { setSpacingCommand } from '../../core/style/spacing.ts';
import { setShadowsCommand } from '../../core/style/shadows.ts';
import { storedLayers } from '../../core/style/stored.ts';
import type { DocNode } from '../../core/document/model.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import type { DoorId } from '../../generated/ids.ts';
import { manifest, numberConstant, type DoorEntry } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';

const COMPOSITES = manifest.properties.composites;
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// the argument of a handle's command its value goes in: its first text argument the handle does not stand for (value;
// a border's width, the first of its aspects)
export const valueArg = (entry: DoorEntry): string => {
  const stands = handleArgs(entry);
  return Object.entries(entry.command.args).find(([name, arg]) => arg.type === 'string' && !(name in stands))?.[0] ?? '';
};

// What a handle's door stands for: the arguments of its command besides the value.
export function handleArgs(entry: DoorEntry): Readonly<Record<string, string>> {
  const args = entry.command.args;
  const writes = entry.door.adapter.writes;
  const first = writes[0] ?? '';
  // the boundary between two children of a row (element.setDivider): the place itself, which the chrome draws into the
  // handle's own arguments (edit-handles.tsx); the handle stands for nothing besides it
  if ('index' in args) return {};
  // a box of the box model (style.setSpacing): the composite whose longhands hold the side's
  if ('box' in args) {
    const box = COMPOSITES.find((c) => c.longhands.includes(first) && (args.box?.values ?? []).includes(c.id));
    return box === undefined ? {} : { box: box.id, sides: first.slice(box.id.length + 1) };
  }
  // the corners of a radius: every corner
  if ('corners' in args) return { corners: args.corners?.values[0] ?? '' };
  // the side of a border: its width longhand's place among border-width's, a side of style.setBorder
  if ('sides' in args) {
    const widths = COMPOSITES.find((c) => c.longhands.includes(first) && c.longhands.length === 4);
    const at = widths?.longhands.indexOf(first) ?? -1;
    return { sides: args.sides?.values[at + 1] ?? '' };
  }
  // a property of style.set: the composite of everything the handle writes, else its one longhand
  const composite = COMPOSITES.find((c) => sameList(c.longhands, writes));
  return { property: composite?.id ?? first };
}

// The shadow a shadow handle edits on a node: the last of the properties it writes (box-shadow, then text-shadow) that
// holds layers there, with its first layer; null when none does.
export interface EditedShadow {
  readonly property: string;
  readonly layer: Readonly<Record<string, unknown>>;
}
export function shadowOf(entry: DoorEntry, node: DocNode, rules: ModelRules): EditedShadow | null {
  const held = entry.door.adapter.writes.map((property) => ({ property, layer: storedLayers(node, property, rules)[0] })).filter((s) => s.layer !== undefined);
  const last = held.at(-1);
  return last === undefined || last.layer === undefined ? null : { property: last.property, layer: last.layer };
}
// whether a shadow handle moves the layer's offset (its fields name the offset) or its blur
export const movesOffset = (entry: DoorEntry): boolean => entry.door.adapter.fields.length > 1;
const lengthOf = (value: unknown): number => {
  const n = Number.parseFloat(typeof value === 'string' ? value : '');
  return Number.isFinite(n) ? n : 0;
};
export const shadowLength = lengthOf;

const RUNS = new Map<string, (context: Parameters<typeof setStyleCommand.run>[0], args: never) => Outcome<never>>([
  [setSpacingCommand.command, setSpacingCommand.run as never],
  [setRadiusCommand.command, setRadiusCommand.run as never],
  [setBorderCommand.command, setBorderCommand.run as never],
  [setStyleCommand.command, setStyleCommand.run as never],
]);
const KEY_STEP = numberConstant('handle.keyStep');
// the names style.setShadows's edit gives the X of a layer and its blur
const OFFSET_EDIT = 'x';
const BLUR_EDIT = 'blur';
export const SHADOW_EDITS = { x: OFFSET_EDIT, y: 'y', blur: BLUR_EDIT } as const;
const INCREASE = 'increase';

export const stepHandle = registerHandler<'handle.step', EditorUi>('handle.step', (context, { direction, handle }) => {
  const entry = handle === undefined ? undefined : manifest.doorByRef.get(handle as DoorId);
  const run = entry === undefined ? undefined : RUNS.get(entry.command.id);
  if (entry === undefined || entry.door.kind !== 'canvas-handle' || run === undefined) return { kind: 'change' };
  const { state, rules } = context;
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null) return { kind: 'change' };
  // a shadow handle: its first layer's X (offset) or blur, one step
  if (entry.command.id === setShadowsCommand.command) {
    const shadow = shadowOf(entry, primary.node, rules);
    if (shadow === null) return { kind: 'change' };
    const offset = movesOffset(entry);
    const [field = '', name = ''] = offset ? [entry.door.adapter.fields[0], OFFSET_EDIT] : [entry.door.adapter.fields[0], BLUR_EDIT];
    const held = lengthOf(shadow.layer[field]);
    const next = offset ? held + (direction === INCREASE ? KEY_STEP : -KEY_STEP) : Math.max(0, held + (direction === INCREASE ? KEY_STEP : -KEY_STEP));
    return setShadowsCommand.run(context as never, { property: shadow.property, edit: { layer: 0, [name]: `${next}px` } } as never) as Outcome<EditorUi>;
  }
  const held = Number.parseFloat(storedValue(primary.node, entry.door.adapter.writes[0] ?? '', rules) ?? '0');
  const current = Number.isFinite(held) ? held : 0;
  const next = Math.max(0, current + (direction === INCREASE ? KEY_STEP : -KEY_STEP));
  return run(context as never, { ...entry.door.args, ...handleArgs(entry), [valueArg(entry)]: `${next}px` } as never) as Outcome<EditorUi>;
});

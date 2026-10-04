// Shadows (INVENTORY.md, owners; spec shadow-editor): style.setShadows writes the layers of a box shadow or
// a text shadow into every selected element, one undo step. A shadow is stored as its layers' typed fields (the
// structure of its property, properties.json structures: colour, X, Y, blur, and for a box shadow spread and inset;
// hidden), never as CSS text: a hidden layer stays in the document and its editor, only the CSS leaves it out
// (Problems in Pager 1); the output writes the CSS (src/core/render/output.ts structuredCss). The command applies an
// edit to the layers the primary selected element holds: add a layer, set a layer's field, hide or show it, remove it,
// remove them all, or nudge its X and Y (the light pad's keys). A length that is no length, a negative blur, and layers
// the browser does not take (a colour it does not know) are refused naming what was typed; a locked element refuses it.
import { message, registerHandler } from '../commands/registry.ts';
import { locate, type StructuredLayer } from '../document/model.ts';
import type { ModelRules, StructureField } from '../document/validate.ts';
import { structuredCss } from '../render/output.ts';
import { propertyName, typedText, withTargets, writeStyle } from './set.ts';
import { storedLayers } from './stored.ts';

// the layer Add a shadow appends (spec, "Trigger"): its colour, its lengths, its flags off
const DEFAULT_COLOUR = 'rgba(15, 23, 42, 0.24)';
const DEFAULT_LENGTHS: Readonly<Record<string, string>> = { offsetX: '0px', offsetY: '4px', blur: '12px', spread: '0px' };
// the edit's name for the colour typed
const [COLOUR_EDIT = ''] = Object.keys({ color: 0 } satisfies Partial<Record<keyof ShadowEdit, number>>);
// the length fields an edit names by x, y, blur and spread
const LENGTH_OF: Readonly<Record<string, string>> = { x: 'offsetX', y: 'offsetY', blur: 'blur', spread: 'spread' };

export interface ShadowEdit {
  readonly add?: boolean;
  readonly reset?: boolean;
  readonly layer?: number;
  readonly x?: string;
  readonly y?: string;
  readonly blur?: string;
  readonly spread?: string;
  readonly color?: string;
  readonly inset?: boolean;
  readonly hidden?: boolean;
  readonly remove?: boolean;
  readonly nudge?: { readonly x?: number; readonly y?: number };
  // the layer at `from` takes the place of the layer at `to` (a row dragged up or down; the others close the gap, the
  // output writes the new order: the user's real-use audit, item A3.34)
  readonly move?: { readonly from: number; readonly to: number };
  // every layer at once, as CSS text (the text shadow's text field; spec shadow-editor, Problems in Pager 4)
  readonly css?: string;
}

const LENGTH = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|em|rem)?$/i;
// a length as the shadow stores it (px when no unit is typed), or null
function lengthOf(text: string, least: number | null): string | null {
  const typed = LENGTH.exec(text.trim());
  if (typed === null) return null;
  const n = Number(typed[1]);
  if (least !== null && n < least) return null;
  return `${Math.round(n * 100) / 100}${(typed[2] ?? 'px').toLowerCase()}`;
}

// A shadow's layers read from its CSS text (spec shadow-editor, Problems in Pager 4): layers part at the commas outside
// parentheses; in each, the lengths in order are X, Y, blur and (a box shadow's) spread, `inset` sets inset, and what
// is left is the colour (currentcolor when nothing is); null when a layer has fewer than two lengths or more than the
// structure takes, or a length is no length. `shadowLayersFromCss` is the one reader of a shadow's CSS text: the text
// field of the shadow editor and the import both read through it (core/import/import.ts).
export function shadowLayersFromCss(text: string, fields: readonly StructureField[]): StructuredLayer[] | null {
  const parts: string[][] = [[]];
  let word = '';
  let depth = 0;
  const push = () => {
    if (word !== '') parts[parts.length - 1]?.push(word);
    word = '';
  };
  for (const c of text) {
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (depth === 0 && (c === ',' || /\s/.test(c))) {
      push();
      if (c === ',') parts.push([]);
      continue;
    }
    word += c;
  }
  push();
  const lengths = Object.values(LENGTH_OF).filter((id) => fields.some((f) => f.id === id));
  const colour = fields.find((f) => f.type !== 'length' && f.type !== 'boolean')?.id;
  const layers: StructuredLayer[] = [];
  for (const words of parts) {
    const inset = words.some((w) => w.toLowerCase() === 'inset');
    const rest = words.filter((w) => w.toLowerCase() !== 'inset');
    const typed = rest.filter((w) => LENGTH.test(w));
    if (typed.length < 2 || typed.length > lengths.length) return null;
    const read = typed.map((w, i) => lengthOf(w, lengths[i] === 'blur' ? 0 : null));
    if (read.some((l) => l === null)) return null;
    const named = rest.filter((w) => !LENGTH.test(w)).join(' ');
    const layer: Record<string, string | boolean> = {};
    for (const field of fields) {
      if (field.id === colour) layer[field.id] = named === '' ? 'currentcolor' : named;
      else if (field.type === 'boolean') layer[field.id] = field.id === 'inset' ? inset : false;
      else layer[field.id] = read[lengths.indexOf(field.id)] ?? '0px';
    }
    layers.push(layer);
  }
  return layers;
}

// The layers once the edit is made, or the name of what the edit typed that is refused (layer: no such layer).
export function editedLayers(layers: readonly StructuredLayer[], fields: readonly StructureField[], edit: ShadowEdit): { readonly layers: readonly StructuredLayer[] } | { readonly refused: string } {
  if (edit.reset === true) return { layers: [] };
  if (typeof edit.css === 'string') {
    if (edit.css.trim() === '') return { layers: [] };
    const read = shadowLayersFromCss(edit.css, fields);
    return read === null ? { refused: 'css' } : { layers: read };
  }
  // the colour field: the one that is neither a length nor a flag (the structure's closed list of types)
  const isColour = (f: StructureField) => f.type !== 'length' && f.type !== 'boolean';
  const colour = fields.find(isColour)?.id;
  if (edit.add === true) return { layers: [...layers, Object.fromEntries(fields.map((f) => [f.id, f.type === 'boolean' ? false : isColour(f) ? DEFAULT_COLOUR : (DEFAULT_LENGTHS[f.id] ?? '0px')]))] };
  if (edit.move !== undefined) {
    // a move names both ends; both are clamped to the layers held (a drag past either end puts the layer first or last)
    if (!Number.isFinite(edit.move.from) || !Number.isFinite(edit.move.to)) return { refused: 'move' };
    const from = Math.max(0, Math.min(layers.length - 1, Math.trunc(edit.move.from)));
    const to = Math.max(0, Math.min(layers.length - 1, Math.trunc(edit.move.to)));
    const next = [...layers];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return { refused: 'layer' };
    next.splice(to, 0, moved);
    return { layers: next };
  }
  const i = edit.layer;
  const layer = i === undefined ? undefined : layers[i];
  if (i === undefined || layer === undefined) return { refused: 'layer' };
  if (edit.remove === true) return { layers: layers.filter((_, n) => n !== i) };
  let next: Record<string, string | boolean> = { ...layer };
  for (const [name, field] of Object.entries(LENGTH_OF)) {
    const text = edit[name as keyof ShadowEdit];
    if (typeof text !== 'string' || !fields.some((f) => f.id === field)) continue;
    const length = lengthOf(text, field === 'blur' ? 0 : null);
    if (length === null) return { refused: name };
    next = { ...next, [field]: length };
  }
  if (typeof edit.color === 'string' && colour !== undefined) {
    if (edit.color.trim() === '') return { refused: COLOUR_EDIT };
    next = { ...next, [colour]: edit.color.trim() };
  }
  const flag = (id: string) => fields.some((f) => f.id === id && f.type === 'boolean');
  if (typeof edit.inset === 'boolean' && flag('inset')) next = { ...next, inset: edit.inset };
  if (typeof edit.hidden === 'boolean' && flag('hidden')) next = { ...next, hidden: edit.hidden };
  if (edit.nudge !== undefined) {
    for (const [axis, field] of [
      ['x', 'offsetX'],
      ['y', 'offsetY'],
    ] as const) {
      const by = edit.nudge[axis];
      if (by === undefined) continue;
      const held = LENGTH.exec(String(next[field] ?? ''));
      if (held === null || (held[2] ?? 'px').toLowerCase() !== 'px') return { refused: axis };
      next = { ...next, [field]: `${Math.round((Number(held[1]) + by) * 100) / 100}px` };
    }
  }
  return { layers: layers.map((l, n) => (n === i ? next : l)) };
}

export const setShadowsCommand = registerHandler('style.setShadows', (asked, { property, edit, modifier, targets }) => {
  const context = withTargets(asked, targets);
  if (context === null) return { kind: 'change' };
  const { state, rules, css } = context;
  const fields = rules.structures.get(property);
  if (fields === undefined) throw new Error(`properties.json: ${property} has no structured value`);
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null || edit === null || typeof edit !== 'object' || Array.isArray(edit)) return { kind: 'change' };
  const refuse = (typed: unknown) => ({ kind: 'refused' as const, message: message('status.value.invalid', { property: propertyName(property, rules), value: typedText(typed ?? edit) }) });
  // Shift with a key of the light pad moves the light ten pixels (the gesture shadow-pad-keys)
  const given = edit as ShadowEdit;
  const stepped = modifier === 'Shift' && given.nudge !== undefined ? { ...given, nudge: { ...(given.nudge.x === undefined ? {} : { x: given.nudge.x * 10 }), ...(given.nudge.y === undefined ? {} : { y: given.nudge.y * 10 }) } } : given;
  const result = editedLayers(storedLayers(primary.node, property, rules), fields, stepped);
  if ('refused' in result) return refuse((edit as Record<string, unknown>)[result.refused]);
  const text = structuredCss(result.layers, fields);
  // the browser takes the layers as the output writes them, or they are refused (a colour it does not know)
  if (!css.supports(property, text)) return refuse((edit as ShadowEdit).color ?? text);
  return writeStyle(context, property, text, { [property]: result.layers });
});

// the CSS a shadow's layers make (the editor's rows show it)
export function shadowCss(layers: readonly StructuredLayer[], property: string, rules: ModelRules): string {
  return structuredCss(layers, rules.structures.get(property) ?? []);
}

// Positioning (INVENTORY.md, owners; specs props-position, absolute-free-drag): position.setMode writes how an
// element is positioned (static, relative, absolute, fixed, sticky) into its field's property of every selected
// element, one undo step, through writeStyle, so the couplings of the property run: absolute (or fixed) keeps the
// element where it is drawn (keepVisualPlace writes top and left from its current place) and makes a static parent
// relative (setParentValue), so the coordinates are its parent's. A locked element refuses it.
//
// position.move (predicate positionedSelection: every selected element is absolute or fixed, properties.json
// valuePredicates) moves the selection's roots by dx and dy page px, each axis through the inset it is anchored to
// (movedInsets: left or top, else right or bottom), from its value in px, else where the element lies now (the layout
// port, measuredPlace), plus the travel, rounded to whole px; align-distribute moves elements the same way.
// The free drag of the canvas runs it once per pointer move inside one gesture (one undo step); the arrows of the
// canvas-positioned key context nudge (spec absolute-nudge), and a quick burst of them on the same selection is one
// undo step (history.coalesce, history.nudgeBurstWindow). `modifier` is the key held with the gesture: the keymap has
// already made Shift's travel the larger step (interactions.json nudge.shiftStep); Ctrl suspends snapping
// (snap-while-moving). The status bar names the element, its coordinates and the parent they are measured from. A
// locked element refuses it (status.locked.move).
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, registerPredicate, type HandlerContext } from '../commands/registry.ts';
import { locate, type DocNode } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import type { Patch } from '../history/transaction.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import { selectionRoots } from '../structure/remove.ts';
import { valuePredicateHolds } from '../style/couplings.ts';
import { propertyName, readValue, writeDeclarations, writeStyle } from '../style/set.ts';
import { storedValue } from '../style/stored.ts';

export const setPositionModeCommand = registerHandler('position.setMode', (context, { property, mode }) => {
  const read = readValue(context, property, mode);
  if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(property, context.rules), value: mode }) };
  // back in the flow, the coordinates and the stacking of a positioned element are inert: they leave the document
  // with the mode, so the export holds no dead declarations (the user's real-use audit, item A3.31)
  if (mode === 'static' || mode === 'relative') {
    const { breakpoint, state: base } = context.rules.base;
    const removed = context.state.selection.flatMap((id) => {
      const found = locate(context.state.document, id);
      if (found === null) return [];
      const inert = [INSET].flatMap((composite) => context.rules.compositeFacts.get(composite)?.longhands ?? []).filter((p) => p !== property && storedValue(found.node, p, context.rules) !== undefined);
      return inert.map((p) => ({ op: 'remove' as const, path: [...found.path, 'styles', breakpoint, base, p] }));
    });
    if (removed.length > 0) {
      const written = writeStyle(context, property, read.css);
      if (written.kind !== 'change') return written;
      return { ...written, patches: [...(written.patches ?? []), ...removed] };
    }
  }
  return writeStyle(context, property, read.css);
});

const POSITIONED = 'positionedSelection';
const FIXED = 'fixed';
const INSET = 'inset';
const AUTO = 'auto';

export const positionedSelection = registerPredicate('positionedSelection', (state, rules) => {
  const nodes = state.selection.map((id) => locate(state.document, id)?.node);
  return nodes.length > 0 && nodes.every((node) => node !== undefined && valuePredicateHolds(node, POSITIONED, rules, state.document.classes));
});

// a value in whole px, or null for any other (a percentage, auto)
const pixels = (value: string | undefined): number | null => (value !== undefined && /^-?\d+(?:\.\d+)?px$/.test(value.trim()) ? Number.parseFloat(value) : null);

// Where a positioned element lies now (the layout port): from its parent's padding edges, the viewport's when it is
// fixed; null when nothing measures the page.
export function measuredPlace(context: HandlerContext<unknown>, node: DocNode): Readonly<Record<string, number>> | null {
  const { rules, layout } = context;
  const mode = rules.valuePredicates.get(POSITIONED)?.property;
  const within = mode !== undefined && storedValue(node, mode, rules) === FIXED ? 'viewport' : 'parent';
  return layout.place(node.id as NodeId, within) as Readonly<Record<string, number>> | null;
}

// The insets that move a positioned element by dx and dy page px, each axis through the edge it is anchored to (the
// inset composite's longhands: its start edge, left or top, unless only its end edge, right or bottom, is set; both
// when both are, so an element anchored on both sides — a stretched one, a dialog centred by inset 0 and auto margins —
// moves whole and keeps its size), from the value it holds in px, else where it lies now; and its left and top
// afterwards, for the status bar.
export function movedInsets(node: DocNode, rules: ModelRules, place: Readonly<Record<string, number>> | null, dx: number, dy: number): { readonly writes: Record<string, string>; readonly x: number; readonly y: number } {
  const [top = '', right = '', bottom = '', left = ''] = rules.compositeFacts.get(INSET)?.longhands ?? [];
  const writes: Record<string, string> = {};
  const set = (property: string) => {
    const value = storedValue(node, property, rules);
    return value !== undefined && value !== AUTO;
  };
  const moved = (start: string, end: string, delta: number): number => {
    const from = (property: string) => pixels(storedValue(node, property, rules)) ?? place?.[property] ?? 0;
    if (set(end) && !set(start)) {
      writes[end] = `${Math.round(from(end) - delta)}px`;
      return Math.round((place?.[start] ?? 0) + delta);
    }
    if (set(end)) writes[end] = `${Math.round(from(end) - delta)}px`;
    const next = Math.round(from(start) + delta);
    writes[start] = `${next}px`;
    return next;
  };
  const x = moved(left, right, dx);
  const y = moved(top, bottom, dy);
  return { writes, x, y };
}

export const movePositionedCommand = registerHandler('position.move', (context, { dx, dy }) => {
  const { state, rules } = context;
  const roots = selectionRoots(state.document, state.selection);
  const primary = roots[0];
  if (primary === undefined) return { kind: 'change' };
  const locked = firstLockRefusal(state.document, roots.map((at) => at.node.id as NodeId), 'status.locked.move');
  if (locked !== null) return { kind: 'refused', message: locked };
  const patches: Patch[] = [];
  let shown = { x: 0, y: 0 };
  for (const at of roots) {
    const moved = movedInsets(at.node, rules, measuredPlace(context as HandlerContext<unknown>, at.node), dx, dy);
    if (at === primary) shown = { x: moved.x, y: moved.y };
    patches.push(...writeDeclarations(at.node, at.path, rules.base, moved.writes));
  }
  return { kind: 'change', patches, message: message('status.position.moved', { name: primary.node.name, parent: primary.parent?.name ?? '', x: shown.x, y: shown.y }) };
});

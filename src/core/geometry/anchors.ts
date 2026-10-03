// Anchors (INVENTORY.md, owners; spec absolute-anchors): which edges of its containing block a positioned
// element keeps its distances to, per axis: the start edge (left, top), the end edge (right, bottom), both (its size
// then follows the containing block) or the centre (both insets 0 with auto margins and a fit-content size: centred
// without translate, which belongs to Move X/Y). The properties are the inset composite's longhands (top, right,
// bottom, left), the margin composite's and the size section's (width, height), read from properties.json.
//
// position.setAnchors (predicate positionedSelection; one element) toggles an edge (the keys, the canvas's tabs) or
// sets an axis's anchors (the inspector's control: an edge alone, the centre, both edges). Toggling off the only
// anchored edge anchors the opposite one. The element never moves: the distances are measured where it lies now (the
// layout port's place, from its parent's padding edges, the viewport's for a fixed element) and a size the axis loses
// (both edges, the centre) is written as it is drawn; the other axis is never touched (Problems in Pager 4). One undo
// step; the status bar says the anchors of both axes. A locked element refuses it.
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, type Message, type MessageParam } from '../commands/registry.ts';
import { locate, type DocNode } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import { writeDeclarations } from '../style/set.ts';
import { storedValue } from '../style/stored.ts';

type Side = 'start' | 'end';
type Anchors = { readonly kind: 'edges'; readonly sides: ReadonlySet<Side> } | { readonly kind: 'center' };
interface Axis {
  readonly start: string;
  readonly end: string;
  readonly marginStart: string;
  readonly marginEnd: string;
  readonly size: string;
  // the words of each state (the catalogue): the start edge, the end edge, both, the centre
  readonly words: { readonly start: Message['key']; readonly end: Message['key']; readonly both: Message['key']; readonly center: Message['key'] };
}

// the two axes, from properties.json: the inset composite (top, right, bottom, left), the margin composite, the size
function axes(rules: ModelRules): { readonly horizontal: Axis; readonly vertical: Axis } {
  const inset = rules.compositeFacts.get('inset')?.longhands ?? [];
  const margin = rules.compositeFacts.get('margin')?.longhands ?? [];
  const [width = '', height = ''] = rules.boxSize;
  const [top = '', right = '', bottom = '', left = ''] = inset;
  const [marginTop = '', marginRight = '', marginBottom = '', marginLeft = ''] = margin;
  return {
    horizontal: { start: left, end: right, marginStart: marginLeft, marginEnd: marginRight, size: width, words: { start: 'anchors.left', end: 'anchors.right', both: 'anchors.leftRight', center: 'anchors.horizontalCenter' } },
    vertical: { start: top, end: bottom, marginStart: marginTop, marginEnd: marginBottom, size: height, words: { start: 'anchors.top', end: 'anchors.bottom', both: 'anchors.topBottom', center: 'anchors.verticalCenter' } },
  };
}

// what each edge argument acts on: its axis, and its side, the centre or both edges
const EDGES: Readonly<Record<string, { readonly axis: 'horizontal' | 'vertical'; readonly side: Side | 'center' | 'both' }>> = {
  left: { axis: 'horizontal', side: 'start' },
  right: { axis: 'horizontal', side: 'end' },
  top: { axis: 'vertical', side: 'start' },
  bottom: { axis: 'vertical', side: 'end' },
  'horizontal-center': { axis: 'horizontal', side: 'center' },
  'vertical-center': { axis: 'vertical', side: 'center' },
  'horizontal-stretch': { axis: 'horizontal', side: 'both' },
  'vertical-stretch': { axis: 'vertical', side: 'both' },
};

const AUTO = 'auto';
const ZERO = new Set(['0', '0px']);
const FIXED = 'fixed';
const FIT = 'fit-content';
const isSet = (value: string | undefined) => value !== undefined && value !== AUTO;
// a measure in whole px down or up, a measure within a thousandth of a px of a whole one being that one (a layout's
// arithmetic leaves 12.0000001 where 12 was meant)
const NEAR = 0.001;
const roundedDown = (px: number) => Math.floor(px + NEAR);
const roundedUp = (px: number) => Math.ceil(px - NEAR);

// The anchors an element holds on an axis: the centre, else the edges whose insets it sets (the start edge when none:
// where an absolute element's static position leaves it)
export function anchorsOf(node: DocNode, axis: Axis, rules: ModelRules): Anchors {
  const value = (property: string) => storedValue(node, property, rules);
  const start = value(axis.start);
  const end = value(axis.end);
  if (start !== undefined && end !== undefined && ZERO.has(start) && ZERO.has(end) && value(axis.marginStart) === AUTO && value(axis.marginEnd) === AUTO) return { kind: 'center' };
  const sides = new Set<Side>([...(isSet(start) ? ['start' as const] : []), ...(isSet(end) ? ['end' as const] : [])]);
  return { kind: 'edges', sides: sides.size === 0 ? new Set<Side>(['start']) : sides };
}

const words = (anchors: Anchors, axis: Axis): MessageParam => {
  if (anchors.kind === 'center') return { key: axis.words.center };
  if (anchors.sides.size === 2) return { key: axis.words.both };
  return { key: anchors.sides.has('end') ? axis.words.end : axis.words.start };
};

// the anchors an edge argument leaves: a side toggled (the opposite one when none is left) or set alone, both, the
// centre
function nextAnchors(current: Anchors, side: Side | 'center' | 'both', mode: 'toggle' | 'set'): Anchors {
  if (side === 'center') return { kind: 'center' };
  if (side === 'both') return { kind: 'edges', sides: new Set<Side>(['start', 'end']) };
  if (mode === 'set') return { kind: 'edges', sides: new Set<Side>([side]) };
  const held = current.kind === 'edges' ? current.sides : new Set<Side>();
  const next = new Set<Side>(held);
  if (next.has(side)) next.delete(side);
  else next.add(side);
  return { kind: 'edges', sides: next.size === 0 ? new Set<Side>([side === 'start' ? 'end' : 'start']) : next };
}

export const setAnchorsCommand = registerHandler(
  'position.setAnchors',
  (context, { edge, mode }) => {
    const { state, rules, layout } = context;
    if (state.selection.length !== 1) return { kind: 'refused', message: message('status.needsSingleSelection') };
    const found = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
    if (found === null) return { kind: 'change' };
    const locked = firstLockRefusal(state.document, [found.node.id as NodeId], 'status.locked.edit');
    if (locked !== null) return { kind: 'refused', message: locked };
    const target = EDGES[edge];
    if (target === undefined) throw new Error(`position.setAnchors: no edge ${edge}`);
    const both = axes(rules);
    const axis = both[target.axis];
    const current = anchorsOf(found.node, axis, rules);
    const next = nextAnchors(current, target.side, mode);
    // the property positionedSelection reads (position): a fixed element is measured from the viewport
    const positioning = rules.valuePredicates.get('positionedSelection')?.property;
    const fixed = positioning !== undefined && storedValue(found.node, positioning, rules) === FIXED;
    const place = layout.place(found.node.id as NodeId, fixed ? 'viewport' : 'parent') as Readonly<Record<string, number>> | null;
    const exact = (property: string) => place?.[property] ?? 0;
    const writes: Record<string, string | null> = {};
    // the margins of a centre it leaves go
    const leavesCenter = current.kind === 'center' && next.kind !== 'center';
    if (next.kind === 'center') {
      Object.assign(writes, { [axis.start]: '0px', [axis.end]: '0px', [axis.marginStart]: AUTO, [axis.marginEnd]: AUTO, [axis.size]: FIT });
    } else {
      if (leavesCenter) Object.assign(writes, { [axis.marginStart]: null, [axis.marginEnd]: null });
      // whole px, and never a box smaller than the one drawn: a size a hair narrower than its text wraps the text (the
      // audit's AUD-35 found a one-line paragraph turned two lines by two rounded insets). Both edges: the start inset
      // rounded, the end inset what is left of the drawn distances, rounded down; one edge: its inset rounded, and a
      // size it now holds rounded up
      const start = Math.round(exact(axis.start));
      const both = next.sides.size === 2;
      writes[axis.start] = next.sides.has('start') ? `${start}px` : null;
      writes[axis.end] = !next.sides.has('end') ? null : `${both ? roundedDown(exact(axis.end) + exact(axis.start) - start) : Math.round(exact(axis.end))}px`;
      // both edges: the size follows the containing block; one edge: the size it is drawn at, when it followed them
      const followed = current.kind === 'center' || current.sides.size === 2;
      if (both) writes[axis.size] = null;
      else if (followed) writes[axis.size] = `${roundedUp(exact(axis.size))}px`;
    }
    const other = target.axis === 'horizontal' ? both.vertical : both.horizontal;
    const horizontal = target.axis === 'horizontal' ? next : anchorsOf(found.node, other, rules);
    const vertical = target.axis === 'vertical' ? next : anchorsOf(found.node, other, rules);
    return {
      kind: 'change',
      patches: writeDeclarations(found.node, found.path, rules.base, writes),
      message: message('status.anchors.set', { name: found.node.name, horizontal: words(horizontal, both.horizontal), vertical: words(vertical, both.vertical) }),
    };
  },
  // a door stands for the anchors held now: an edge anchored, the centre, both edges
  (state, args, rules) => {
    const [only] = state.selection;
    const node = only === undefined || rules === undefined ? null : (locate(state.document, only)?.node ?? null);
    const target = EDGES[String(args.edge)];
    if (node === null || target === undefined || rules === undefined) return false;
    const held = anchorsOf(node, axes(rules)[target.axis], rules);
    if (target.side === 'center') return held.kind === 'center';
    if (held.kind === 'center') return false;
    if (target.side === 'both') return held.sides.size === 2;
    return held.sides.has(target.side) && (args.mode !== 'set' || held.sides.size === 1);
  },
);

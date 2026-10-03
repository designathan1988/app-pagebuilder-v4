// element.moveTo (INVENTORY.md, owners): moves the selection's roots (the selected nodes without those an
// ancestor of which is selected too, remove.ts) to one parent at one index, in document order. The index counts
// the parent's children without the moved nodes, so it is the position the first moved node ends at (spec
// drag-reorder-canvas, "Result in the document": the dragged node is removed from its parent and inserted at the
// proposal's parent and index). The moved nodes stay selected; the status bar says "Moved … to position" among its
// siblings and "Moved … into" another parent (spec drag-drop-inside). A moved node that is locked or inside a locked
// element, a locked parent or one inside a locked element (spec lock-element, src/core/nodes/flags.ts), a parent
// inside a moved node (the node itself included), a parent that holds no children, a parent the content model
// does not let hold a moved node and a Link Block (or an element inside one) for an interactive element, moved or
// inside a moved node (spec elements-structure, Problems in Pager 5), refuse the move, in that order, and nothing
// changes. A
// move that leaves every node where it was changes nothing and records no history (the store drops it).
//
// element.moveUp and element.moveDown (INVENTORY.md, owners; spec move-up-down): the selection's roots
// (the doors' adapter.selection "roots-same-parent") swap places with their previous (up) or next (down) sibling that
// is not selected, in one transaction; the relative order of the selected nodes is kept and they never leave their
// parent. One command for every door (spec, Problems 2). Roots that do not share one parent are refused, and so is a
// locked root or one inside a locked element (spec lock-element); so is a press that moves nothing: the first (last)
// place says "Already at the start (end) of <parent>" and adds no history entry. The status bar names the one moved
// node with its new position among its siblings, or counts several (spec, Problems 1). The selection stays as it is.
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, registerPredicate, type Message, type Outcome } from '../commands/registry.ts';
import { instanceMoveRefusal } from '../design/components.ts';
import { locate, walk, type DocNode, type DocumentJson, type Selection, type StoredValue } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import type { Layout } from '../ports/layout.ts';
import { placementRefusal } from '../elements/content-model.ts';
import { applyPatches, type Patch } from '../history/transaction.ts';
import { firstLockRefusal, lockRefusal } from '../nodes/flags.ts';
import { selectionRoots } from './remove.ts';
import { writeDeclarations } from '../style/set.ts';
import { storedValue } from '../style/stored.ts';
import { valuePredicateHolds } from '../style/couplings.ts';

export const moveToCommand = registerHandler('element.moveTo', ({ state, rules, layout }, { parent, index }): Outcome<never> => moveSelectionTo(state, rules, layout, parent, index));

// The manifest's own names for positioning (nothing written by hand): the value predicate that says an element is
// positioned (absolute or fixed) names the property, and the inset composite lists the four insets in CSS order
// (top, right, bottom, left), each measuring from one edge of the containing block's padding box.
const POSITIONED = 'positionedSelection';
const INSET = 'inset';
// the axis each inset lies on and the edge of the padding box it measures from, in the composite's CSS order
const SIDES: readonly (readonly ['x' | 'y', '-' | '+'])[] = [
  ['y', '-'],
  ['x', '+'],
  ['y', '+'],
  ['x', '-'],
];
const positionProperty = (rules: ModelRules): string => rules.valuePredicates.get(POSITIONED)?.property ?? '';
const insetProperties = (rules: ModelRules): readonly string[] => rules.compositeFacts.get(INSET)?.longhands ?? [];
const px = (value: unknown): number | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^-?\d+(\.\d+)?px$/.test(text) ? Number.parseFloat(text) : null;
};
// whether a node lays out of the flow where it is drawn (the value predicate's own values)
const isPositioned = (node: DocNode, rules: ModelRules): boolean => valuePredicateHolds(node, POSITIONED, rules);
// whether a node's own stored position makes it a containing block for positioned children (any but the initial one)
function holdsPosition(node: DocNode, rules: ModelRules): boolean {
  const held = storedValue(node, positionProperty(rules), rules);
  return held !== undefined && held !== 'static';
}

// The containing block of a positioned node: the nearest ancestor whose stored position is not static — its own
// padding box measures its positioned children's insets — or the page's root (the initial containing block) when none
// is. A receiver asks about itself (a positioned receiver is its new children's containing block).
function containingBlockOf(document: DocumentJson, id: NodeId, rules: ModelRules, self = false): NodeId {
  const page = document.pages.find((p) => [...walk(p.tree)].some((n) => n.id === id));
  const root = page?.tree.id ?? null;
  for (let up = self ? (locate(document, id)?.node ?? null) : (locate(document, id)?.parent ?? null); up !== null; up = locate(document, up.id)?.parent ?? null) {
    if (holdsPosition(up, rules)) return up.id as NodeId;
  }
  if (root === null) throw new Error('move.ts: the document has no page holding the node');
  return root as NodeId;
}

// The move element.moveTo makes, which every command that moves the selection into a parent at an index makes too
// (nest-into-previous, promote-out): one rule for the index, the refusals and the status.
export function moveSelectionTo(
  state: { readonly document: DocumentJson; readonly selection: Selection },
  rules: ModelRules,
  layout: Layout,
  parent: NodeId,
  index: number,
): Outcome<never> {
  const moved = selectionRoots(state.document, state.selection);
  // every door moves what is selected (its adapter acts on the selection's roots), never the page itself
  if (moved.length === 0) return { kind: 'refused', message: message('refusal.nothingSelected') };
  const receiver = locate(state.document, parent);
  if (!receiver) throw new Error(`element.moveTo: the document has no node ${parent}`);
  // a page cannot move: its root stands for the page itself
  for (const at of moved) if (!at.parent) return { kind: 'refused', message: message('status.element.notApplicable', { command: { key: 'command.moveTo' }, name: at.node.name }) };
  const roots = moved.map((at) => at.node.id);

  // a locked node, or one inside a locked element, stays where it is, and a locked parent takes no new child (spec
  // lock-element: locked containers and what they hold are no drop receivers)
  const locked = firstLockRefusal(state.document, roots, 'status.locked.move') ?? lockRefusal(state.document, parent, 'status.locked.insert');
  if (locked !== null) return { kind: 'refused', message: locked };
  // a parent inside a moved node first: a moved leaf itself is refused as that, not as a leaf
  for (const at of moved) for (const inner of walk(at.node)) if (inner.id === parent) return { kind: 'refused', message: message('status.refused.intoItself') };
  // the one rule of where elements may go (content-model.ts placementRefusal), a move among its siblings keeping them
  const refused = placementRefusal(state.document, rules, parent, moved.map((at) => at.node), new Set(moved.filter((at) => at.parent?.id === parent).map((at) => at.node.id)));
  if (refused !== null) return { kind: 'refused', message: refused };
  // a part stays in its instance, and no instance goes inside another (the audit's AUD-04)
  const instanced = instanceMoveRefusal(state.document, moved.map((at) => at.node), parent);
  if (instanced !== null) return { kind: 'refused', message: instanced };

  // each moved node leaves its place, found again in the document the earlier removals left
  const patches: Patch[] = [];
  let document = state.document;
  for (const at of moved) {
    const now = locate(document, at.node.id);
    if (!now) continue;
    const patch: Patch = { op: 'remove', path: now.path };
    patches.push(patch);
    document = applyPatches(document, [patch]).document;
  }
  // then they arrive, in selection order, from the index on
  const target = locate(document, parent);
  if (!target) throw new Error(`element.moveTo: ${parent} is gone once the moved nodes left`);
  const start = Math.max(0, Math.min(index, target.node.children.length));
  for (const [i, at] of moved.entries()) {
    patches.push({ op: 'add', path: [...target.path, 'children', start + i], value: at.node });
  }

  // A positioned moved node whose containing block changes keeps where it is drawn (the user's real-use audit, item
  // A3.13): each inset it holds in px is read from where it lay (the old containing block's padding box) and written
  // again from the new one. A node the canvas does not draw, or an inset in another unit, is left as it is.
  for (const [i, at] of moved.entries()) {
    if (!isPositioned(at.node, rules)) continue;
    const oldCb = containingBlockOf(state.document, at.node.id as NodeId, rules);
    const newCb = containingBlockOf(state.document, receiver.node.id as NodeId, rules, true);
    if (newCb === oldCb) continue;
    const from = layout.paddingBox(oldCb);
    const into = layout.paddingBox(newCb);
    if (from === null || into === null) continue;
    const values: Record<string, StoredValue | null> = {};
    insetProperties(rules).forEach((property, edge) => {
      const side = SIDES[edge];
      const value = side === undefined ? null : px(storedValue(at.node, property, rules));
      if (side === undefined || value === null) return;
      const [axis, which] = side;
      const start = axis === 'x' ? from.x : from.y;
      const end = axis === 'x' ? from.x + from.width : from.y + from.height;
      const page = which === '-' ? start + value : end - value;
      const nextStart = axis === 'x' ? into.x : into.y;
      const nextEnd = axis === 'x' ? into.x + into.width : into.y + into.height;
      values[property] = `${Math.round(which === '-' ? page - nextStart : nextEnd - page)}px`;
    });
    if (Object.keys(values).length === 0) continue;
    patches.push(...writeDeclarations(at.node, [...target.path, 'children', start + i], rules.base, values));
  }

  // a move that lands every node where it already stands (a drop on the dragged element's own place) changes nothing
  // and says nothing: patches that leave the document as it was are no change (the store's empty-change incident)
  if (JSON.stringify(applyPatches(state.document, patches).document) === JSON.stringify(state.document)) return { kind: 'change', selection: roots };
  const count = target.node.children.length + moved.length;
  const first = moved[0];
  // one node: moved among its siblings or out to an ancestor ("to position … in"), or into another parent (spec
  // drag-drop-inside, "into"); the ancestors are its parent's chain up to the page root
  const outward = new Set<string>();
  for (let up = first?.parent ?? null; up !== null; up = locate(state.document, up.id)?.parent ?? null) outward.add(up.id);
  const said =
    moved.length !== 1 || !first
      ? message('status.movedMany', { count: moved.length, parent: receiver.node.name })
      : outward.has(parent)
        ? message('status.moved', { name: first.node.name, position: start + 1, count, parent: receiver.node.name })
        : message('status.movedInto', { name: first.node.name, receiver: receiver.node.name, position: start + 1, count });
  return { kind: 'change', patches, selection: roots, message: said };
}

// element.nestIntoPrevious (spec nest-into-previous): the one selected element goes into its previous sibling, a
// container, as its last child, through the move above (its refusals and its "Moved … into" status). Available only
// when there is such a sibling (canNestIntoPrevious, Problems in Pager 1): otherwise the door is disabled and the key
// says there is no previous element that can hold it.
function previousContainer(state: { readonly document: DocumentJson; readonly selection: Selection }, rules: ModelRules): DocNode | null {
  const [only, ...others] = state.selection;
  if (only === undefined || others.length > 0) return null;
  const at = locate(state.document, only);
  const previous = at?.parent?.children[at.index - 1];
  return previous !== undefined && rules.elements.get(previous.type)?.content === 'children' ? previous : null;
}

// the instances' refusal of nesting the selected element into its previous container (AUD-04), or null
function nestRefusal(state: { readonly document: DocumentJson; readonly selection: Selection }, receiver: DocNode): Message | null {
  const node = state.selection[0] === undefined ? undefined : locate(state.document, state.selection[0])?.node;
  return node === undefined ? null : instanceMoveRefusal(state.document, [node], receiver.id as NodeId);
}

export const canNestIntoPrevious = registerPredicate(
  'canNestIntoPrevious',
  (state, rules) => {
    const receiver = previousContainer(state, rules);
    return receiver !== null && nestRefusal(state, receiver) === null;
  },
  (state, rules) => {
    const receiver = previousContainer(state, rules);
    return (receiver === null ? null : nestRefusal(state, receiver)) ?? message('status.nest.noPrevious');
  },
);

export const nestIntoPreviousCommand = registerHandler('element.nestIntoPrevious', ({ state, rules, layout }): Outcome<never> => {
  const receiver = previousContainer(state, rules);
  // the availability predicate (canNestIntoPrevious) keeps anything else from reaching here
  if (receiver === null) throw new Error('element.nestIntoPrevious: the selection has no previous container');
  return moveSelectionTo(state, rules, layout, receiver.id, receiver.children.length);
});

// element.promote (spec promote-out): the one selected element leaves its parent and lands right after it, in its
// grandparent, through the move above; a direct child of the page root cannot go higher (status.promote.topLevel).
// canPromote: one element selected that has a grandparent to land in, and that may leave its parent there (a part stays
// in its instance: AUD-04). The door is disabled, and the context menu leaves it out, when it may not.
function promoteRefusal(state: { readonly document: DocumentJson; readonly selection: Selection }): Message | null {
  const [only, ...others] = state.selection;
  const at = only === undefined || others.length > 0 ? null : locate(state.document, only);
  if (at === null) return message('status.needsSingleSelection');
  const parent = at.parent === null ? null : locate(state.document, at.parent.id);
  if (parent === null || parent.parent === null) return message('status.promote.topLevel');
  return instanceMoveRefusal(state.document, [at.node], parent.parent.id as NodeId);
}
export const canPromote = registerPredicate(
  'canPromote',
  (state) => promoteRefusal(state) === null,
  (state) => promoteRefusal(state) ?? message('status.promote.topLevel'),
);

export const promoteCommand = registerHandler('element.promote', ({ state, rules, layout }): Outcome<never> => {
  const [only] = state.selection;
  const at = only === undefined ? null : locate(state.document, only);
  // the availability predicate (singleSelection) keeps anything else from reaching here
  if (at === null) throw new Error('element.promote: the selection is not one node of the document');
  const parent = at.parent === null ? null : locate(state.document, at.parent.id);
  if (parent === null || parent.parent === null) return { kind: 'refused', message: message('status.promote.topLevel') };
  return moveSelectionTo(state, rules, layout, parent.parent.id, parent.index + 1);
});

type Direction = 'up' | 'down';

// The patches that move every selected child of the parent one place towards its direction, past the sibling it
// meets there when that sibling is not selected, and the new index of each child that moved.
function shiftAmongSiblings(parent: DocNode, parentPath: readonly (string | number)[], selected: ReadonlySet<string>, direction: Direction): { patches: Patch[]; moved: Map<string, number> } {
  const order = parent.children.slice();
  const patches: Patch[] = [];
  const moved = new Map<string, number>();
  const step = direction === 'up' ? -1 : 1;
  // up walks from the first child, down from the last, so a block of selected siblings at the edge stays put and a
  // node never passes another selected one
  const indexes = order.map((_, i) => i);
  if (direction === 'down') indexes.reverse();
  for (const i of indexes) {
    const node = order[i];
    const other = order[i + step];
    if (node === undefined || other === undefined || !selected.has(node.id) || selected.has(other.id)) continue;
    order[i] = other;
    order[i + step] = node;
    // the child leaves its index and comes back one place further, as the reorder of one list (applied in order)
    patches.push({ op: 'remove', path: [...parentPath, 'children', i] }, { op: 'add', path: [...parentPath, 'children', i + step], value: node });
    moved.set(node.id, i + step);
  }
  return { patches, moved };
}

// Why the selection cannot move one place up or down among its siblings, before anything is written: nothing selected,
// elements of different parents, or nothing would move, the selected standing together against the edge (a page root
// has no siblings: it is already at the start and the end of its page). The commands' availability (canMoveUp,
// canMoveDown) and the commands themselves both ask it, so a menu draws the move disabled with the words its press
// would say (the canonical Arrange menu: Move up disabled on a first child).
function moveRefusal(document: DocumentJson, selection: Selection, direction: Direction): Message | null {
  const roots = selectionRoots(document, selection);
  const first = roots[0];
  if (first === undefined) return message('refusal.nothingSelected');
  const parent = first.parent;
  if (roots.some((r) => r.parent !== parent)) return message('status.wrap.needsSameParent');
  const within = parent?.name ?? document.pages[first.page]?.name ?? '';
  const edge = message(direction === 'up' ? 'status.move.alreadyFirst' : 'status.move.alreadyLast', { parent: within });
  if (parent === null) return edge;
  const chosen = new Set(roots.map((r) => r.node.id));
  const places = parent.children.map((child, i) => (chosen.has(child.id) ? i : -1)).filter((i) => i >= 0);
  // nothing moves when the selected stand together against the edge they would pass (one at the edge with others apart
  // stays while those move)
  const count = parent.children.length;
  const blocked = places.every((place, i) => place === (direction === 'up' ? i : count - places.length + i));
  return blocked ? edge : null;
}

export const canMoveUp = registerPredicate('canMoveUp', (state) => moveRefusal(state.document, state.selection, 'up') === null, (state) => moveRefusal(state.document, state.selection, 'up') ?? message('status.move.alreadyFirst', { parent: '' }));
export const canMoveDown = registerPredicate('canMoveDown', (state) => moveRefusal(state.document, state.selection, 'down') === null, (state) => moveRefusal(state.document, state.selection, 'down') ?? message('status.move.alreadyLast', { parent: '' }));

function move(document: DocumentJson, selection: Selection, direction: Direction): Outcome<never> {
  const roots = selectionRoots(document, selection);
  const first = roots[0];
  // the availability predicate (canMoveUp, canMoveDown) lets no door run without a selection; a selection of nodes the
  // document lacks is a defect of the store
  if (first === undefined) throw new Error(`element.move${direction === 'up' ? 'Up' : 'Down'}: the selection names no node of the document`);
  const refused = moveRefusal(document, selection, direction);
  if (refused !== null) return { kind: 'refused', message: refused };
  const parent = first.parent;
  if (parent === null) throw new Error('element.move: a page root reached the move past its refusal');
  const edge = message(direction === 'up' ? 'status.move.alreadyFirst' : 'status.move.alreadyLast', { parent: parent.name });
  // a locked node, or one inside a locked element, keeps its place (spec lock-element)
  const locked = firstLockRefusal(document, roots.map((r) => r.node.id), 'status.locked.move');
  if (locked !== null) return { kind: 'refused', message: locked };
  const { patches, moved } = shiftAmongSiblings(parent, first.path.slice(0, -2), new Set(roots.map((r) => r.node.id)), direction);
  if (patches.length === 0) return { kind: 'refused', message: edge };
  const only = roots.length === 1 ? moved.get(first.node.id) : undefined;
  return {
    kind: 'change',
    patches,
    message:
      only !== undefined
        ? message('status.moved', { name: first.node.name, position: only + 1, count: parent.children.length, parent: parent.name })
        : message('status.movedMany', { count: roots.length, parent: parent.name }),
  };
}

export const moveUpCommand = registerHandler('element.moveUp', ({ state }): Outcome<never> => move(state.document, state.selection, 'up'));
export const moveDownCommand = registerHandler('element.moveDown', ({ state }): Outcome<never> => move(state.document, state.selection, 'down'));

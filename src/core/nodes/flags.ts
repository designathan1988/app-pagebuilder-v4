// Node flags (INVENTORY.md, owners): what a node carries for the editor beside its content.
//
// element.toggleHidden (spec hide-element): hides a node on the canvas with its whole subtree, or shows it again. The
// node stays in the document and in Layers, where it can still be selected; only its hidden flag changes (model.ts:
// true, absent while it shows), so showing it again gives back exactly the layout it had. The page root is never
// hidden: the status bar says why and nothing changes.
//
// element.toggleLock (spec lock-element): locks a node with its whole subtree, or unlocks it. Only its locked flag
// changes (model.ts: true, absent while it is unlocked); a locked node can still be selected and inspected, and every
// command that would move, delete or edit it, or anything inside it, refuses it and names the lock (`lockRefusal`
// below, the one answer to "what locks this node", which every such command asks). The page root is never locked
// (locking it would lock the whole page): the status bar says why and nothing changes.
//
// Both flags: a Layers row's control acts on the node it stands for (its target) and leaves the selection as it is;
// the other doors act on the primary selected node. Each toggle is one undo step, and the status bar says which it was
// for every door (the specs' Problems in Pager 2). A node's own flags stay its own to toggle, except inside a locked
// element, where the toggle is refused with status.locked.byAncestor naming the lock (spec lock-element: only the
// node that carries a lock can be unlocked).
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { message, registerHandler, registerPredicate, type Message, type Outcome } from '../commands/registry.ts';
import type { Patch } from '../history/transaction.ts';
import { lineage, locate, type DocNode, type DocumentJson, type Location, type Selection } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { stateStandsOn } from '../style/state-elements.ts';

// The keys a command refuses a node it would change with, when the node carries the lock itself (en.json
// status.locked.*): "Unlock {name} before deleting it", "… before moving it", and so on.
export type LockedKey = 'status.locked.delete' | 'status.locked.edit' | 'status.locked.editText' | 'status.locked.insert' | 'status.locked.move' | 'status.locked.rename';

// The lock over a node: the outermost locked node among the node itself and its ancestors, or null when nothing locks
// it. The outermost, because it is the one lock that can be taken off first (inside it, a toggle is refused).
export function lockOver(document: DocumentJson, id: NodeId): DocNode | null {
  return lineage(document, id).find((n) => n.locked === true) ?? null;
}

// Why a command may not change a node (spec lock-element, Problems in Pager 1: the message names the lock and says
// what to do), or null when nothing locks it: inside a locked element, status.locked.byAncestor names the node and
// that element; a node that carries the lock itself, with none above it, is refused with the command's own key.
export function lockRefusal(document: DocumentJson, id: NodeId, key: LockedKey): Message | null {
  const chain = lineage(document, id);
  const node = chain.at(-1);
  const lock = chain.find((n) => n.locked === true);
  if (node === undefined || lock === undefined) return null;
  return lock === node ? message(key, { name: node.name }) : message('status.locked.byAncestor', { name: node.name, ancestor: lock.name });
}

// The first refusal over several nodes a command would change, in their order, or null when none is locked.
export function firstLockRefusal(document: DocumentJson, ids: readonly NodeId[], key: LockedKey): Message | null {
  for (const id of ids) {
    const refused = lockRefusal(document, id, key);
    if (refused !== null) return refused;
  }
  return null;
}

// The style fields' doors are usable only while no selected element is locked or inside a locked element (the audit's
// A3.11; spec lock-element, Problems in Pager 3): drawn disabled, their reason is the lock's refusal (naming the lock),
// before anything is typed. With nothing selected nothing is locked.
// the elements a command edits: the one its door names (`args.target`: custom declarations of the element the field
// stands for), else the selection — the lock that matters is theirs (the audit's M-02: the selection's was read)
const edited = (selection: readonly NodeId[], args: unknown): readonly NodeId[] => {
  const target = args !== null && typeof args === 'object' ? (args as { readonly target?: unknown }).target : undefined;
  return typeof target === 'string' ? [target as NodeId] : selection;
};
// Why a style write may not go to the state the editor edits (the layer's state, `rules.base`): one of the nodes it
// would change does not stand on that state (Visited on a heading), and the validator would refuse the result (the
// audit's AUD-03: nine writers broke the document this way). Null when the state stands on all of them.
export function stateRefusal(document: DocumentJson, ids: readonly NodeId[], rules: Pick<ModelRules, 'base' | 'stateElements' | 'stateLabels' | 'elements'>): Message | null {
  const state = rules.base.state;
  for (const id of ids) {
    const node = locate(document, id)?.node;
    if (node === undefined || stateStandsOn(state, node.type, rules)) continue;
    const label = rules.stateLabels.get(state);
    const element = rules.elements.get(node.type)?.labelKey;
    return message('status.styleState.notApplicable', { state: label === undefined ? state : { key: label }, element: element === undefined ? node.type : { key: element } });
  }
  return null;
}

const editRefusal = (state: { readonly document: DocumentJson; readonly selection: Selection }, rules: ModelRules, args: unknown): Message | null => {
  const ids = edited(state.selection, args);
  return firstLockRefusal(state.document, ids, 'status.locked.edit') ?? stateRefusal(state.document, ids, rules);
};
export const editableSelection = registerPredicate(
  'editableSelection',
  (state, rules, args) => editRefusal(state, rules, args) === null,
  (state, rules, args) => editRefusal(state, rules, args) ?? message('status.locked.edit', { name: '' }),
);

// Why a node's own flag may not be toggled: a locked element above it (status.locked.byAncestor), or null.
function ancestorLockRefusal(document: DocumentJson, id: NodeId): Message | null {
  const chain = lineage(document, id);
  const node = chain.at(-1);
  const lock = chain.slice(0, -1).find((n) => n.locked === true);
  return node === undefined || lock === undefined ? null : message('status.locked.byAncestor', { name: node.name, ancestor: lock.name });
}

// the node a door acts on: the one it names, else the primary selected node
function flagged(document: DocumentJson, selection: Selection, target: unknown): Location | null {
  const id = typeof target === 'string' ? (target as NodeId) : selection[0];
  return id === undefined ? null : locate(document, id);
}

// sets a flag of the node, or removes it when it is set, and says which
function toggled(at: Location, flag: 'hidden' | 'locked', on: MessageId, off: MessageId): Outcome<never> {
  const path = [...at.path, flag];
  const name = at.node.name;
  if (at.node[flag] === true) return { kind: 'change', patches: [{ op: 'remove', path }], message: message(off, { name }) };
  return { kind: 'change', patches: [{ op: 'add', path, value: true }], message: message(on, { name }) };
}

export const toggleHiddenCommand = registerHandler(
  'element.toggleHidden',
  ({ state }, { target }): Outcome<never> => {
    const at = flagged(state.document, state.selection, target);
    // the availability predicate (targetOrSelection) lets no door run without a node it names or a selection, and a
    // row's eye names a node of the document; anything else is a defect of the door
    if (at === null) throw new Error(`element.toggleHidden: the document has no node ${String(target ?? state.selection[0])}`);
    if (at.parent === null) return { kind: 'refused', message: message('status.hide.root') };
    const locked = ancestorLockRefusal(state.document, at.node.id);
    if (locked !== null) return { kind: 'refused', message: locked };
    return toggled(at, 'hidden', 'status.hidden', 'status.visible');
  },
  // a door stands for the hidden state of the node it acts on: a row's eye is pressed while its node is hidden
  (state, args) => flagged(state.document, state.selection, args.target)?.node.hidden === true,
);

export const toggleLockCommand = registerHandler(
  'element.toggleLock',
  ({ state }, { target }): Outcome<never> => {
    const at = flagged(state.document, state.selection, target);
    // the availability predicate (targetOrSelection) lets no door run without a node it names or a selection, and a
    // row's lock names a node of the document; anything else is a defect of the door
    if (at === null) throw new Error(`element.toggleLock: the document has no node ${String(target ?? state.selection[0])}`);
    if (at.parent === null) return { kind: 'refused', message: message('status.lock.root') };
    const locked = ancestorLockRefusal(state.document, at.node.id);
    if (locked !== null) return { kind: 'refused', message: locked };
    return toggled(at, 'locked', 'status.locked', 'status.unlocked');
  },
  // a door stands for the locked state of the node it acts on: a row's lock is pressed while its node carries a lock
  (state, args) => flagged(state.document, state.selection, args.target)?.node.locked === true,
);

// element.setLayerColor (spec layers-row-colours; INVENTORY.md, owners): the label colour of a node, which
// tints its Layers row and draws the element's selection on the canvas in it. The colour belongs to the page the node
// is on and is stored on that page's root (model.ts layerColors), never on the element and never in the export: it is
// the person's own note about a layer, not a style of the page. A colour replaces the one there; an empty colour takes
// it away, which is the row's own way of saying none. One undo step, and the status bar names the node and the colour.
// The CSS of a label colour, wherever the editor draws it (a Layers row, its dot, the canvas selection): a colour as it
// is, and a design token's name (the palette's swatches hold `--color-canvas-margin`) as the token it names. Drawn
// bare, a name is no colour, and the row, its dot and the selection drew none (LC2).
export const layerColourCss = (colour: string): string => (colour.startsWith('--') ? `var(${colour})` : colour);

export const setLayerColorCommand = registerHandler('element.setLayerColor', ({ state }, { target, color }): Outcome<never> => {
  const at = flagged(state.document, state.selection, target);
  if (at === null) throw new Error(`element.setLayerColor: the document has no node ${String(target ?? state.selection[0])}`);
  if (typeof color !== 'string') throw new Error('element.setLayerColor: a colour is a string');
  const root = state.document.pages[at.page]?.tree;
  if (root === undefined) throw new Error(`element.setLayerColor: the document has no page ${at.page}`);
  const list = root.layerColors ?? [];
  const held = list.findIndex((one) => one.node === at.node.id);
  const path = ['pages', at.page, 'tree', 'layerColors'];
  const typed = color.trim();
  if (typed === '') {
    const removed = message('status.layerColor.removed', { name: at.node.name });
    if (held < 0) return { kind: 'change', message: removed };
    // the page's last colour takes the list with it: the model keeps no empty list (absent while there is none; LC1,
    // found by AUD-35's scenarios: taking the only colour away was refused as an invalid state)
    return { kind: 'change', patches: [{ op: 'remove', path: list.length === 1 ? path : [...path, held] }], message: removed };
  }
  const said = message('status.layerColor.set', { name: at.node.name });
  if (held >= 0 && list[held]?.colour === typed) return { kind: 'change', message: said };
  // the list keeps its order: the first colour a page holds is added whole, another is inserted or replaced
  const patches: Patch[] = list.length === 0 ? [{ op: 'add', path, value: [{ node: at.node.id, colour: typed }] }] : held < 0 ? [{ op: 'add', path: [...path, list.length], value: { node: at.node.id, colour: typed } }] : [{ op: 'replace', path: [...path, held, 'colour'], value: typed }];
  return { kind: 'change', patches, message: said };
});

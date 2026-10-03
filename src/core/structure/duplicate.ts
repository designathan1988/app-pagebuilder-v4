// element.duplicate (INVENTORY.md, owners): every root of the selection (the manifest's adapter.selection
// "roots") is copied whole, with its texts, classes, attributes and styles, and the copy goes right after its
// original in one transaction (spec duplicate, "Result in the document"). Every node of a copy gets a fresh id and a
// name no node of the document has (spec, Problems 1: Pager kept the children's names). The copies become the
// selection, the primary's copy first; undo takes them away and gives back the selection from before (history.ts).
// The page root is never duplicated, nor a locked element or one inside a locked element (spec lock-element): the
// status bar says why and nothing changes.
import { message, registerHandler, type Outcome } from '../commands/registry.ts';
import { numberConstant } from '../../manifest/runtime.ts';
import type { ModelRules } from '../document/validate.ts';
import type { StoredValue, Styles } from '../document/model.ts';
import { writeDeclarations } from '../style/set.ts';
import { storedValue } from '../style/stored.ts';
import { valuePredicateHolds } from '../style/couplings.ts';
import { allNodes, walk, type DocNode, type Location } from '../document/model.ts';
import { refreshCopiedIdentities } from '../document/clone.ts';
import type { Patch } from '../history/transaction.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import type { IdGenerator } from '../ports/ids.ts';
import { selectionRoots } from './remove.ts';

// The name a copy of a node named `name` takes, given the names already taken: the name followed by the first free
// number from 2 ("CardA" → "CardA 2"); a name that already ends in a number counts on from it ("Intro 2" → "Intro 3"),
// so copies of copies do not pile numbers up ("Intro 2 2").
export function copyName(name: string, taken: ReadonlySet<string>): string {
  const space = name.lastIndexOf(' ');
  const tail = space < 0 ? '' : name.slice(space + 1);
  const numbered = tail !== '' && [...tail].every((c) => c >= '0' && c <= '9');
  const stem = numbered ? name.slice(0, space) : name;
  let n = numbered ? Number(tail) + 1 : 2;
  while (taken.has(`${stem} ${n}`)) n += 1;
  return `${stem} ${n}`;
}

// The offset a copy of a positioned element takes, in px (interactions.json: duplicate.offset): the copy stands off
// the original instead of exactly over it (the user's real-use audit, item A3.13).
const OFFSET = numberConstant('duplicate.offset');
// The value predicate that says an element is positioned, and the inset composite whose longhands (CSS order: top,
// right, bottom, left) it measures with — both from the manifest, so no property name is written by hand here.
const POSITIONED = 'positionedSelection';
const INSET = 'inset';
const px = (value: unknown): number | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^-?\d+(\.\d+)?px$/.test(text) ? Number.parseFloat(text) : null;
};

// the styles of a copy of a positioned node: each inset it holds in px at the base layer moved by OFFSET (read and
// written through the one writer, so the document keeps its shape); an inset in another unit is left as it is
function offsetStyles(node: DocNode, rules: ModelRules): Styles {
  if (!valuePredicateHolds(node, POSITIONED, rules)) return node.styles;
  const layer = { breakpoint: rules.baseLayer.breakpoint, state: rules.baseLayer.state };
  const values: Record<string, StoredValue> = {};
  for (const property of rules.compositeFacts.get(INSET)?.longhands ?? []) {
    const value = px(storedValue(node, property, rules));
    if (value !== null) values[property] = `${Math.round(value + OFFSET)}px`;
  }
  if (Object.keys(values).length === 0) return node.styles;
  const written = writeDeclarations(node, [], layer, values)[0];
  return written !== undefined && written.op === 'replace' ? (written.value as Styles) : node.styles;
}

// A deep copy of a node with a fresh id and a new name for every node, in document order; each new name is taken as
// soon as it is given, so no two nodes of the copies share one. The copy of a positioned node is offset, so it does
// not stand exactly over its original — the copied root only: a positioned element inside it keeps its place in its
// own (copied) parent.
function copyOf(node: DocNode, ids: IdGenerator, taken: Set<string>, rules: ModelRules, root = true): DocNode {
  const name = copyName(node.name, taken);
  taken.add(name);
  return { ...node, styles: root ? offsetStyles(node, rules) : node.styles, id: ids.next(), name, children: node.children.map((child) => copyOf(child, ids, taken, rules, false)) };
}

export const duplicateCommand = registerHandler('element.duplicate', ({ state, ids, rules }): Outcome<never> => {
  const roots = selectionRoots(state.document, state.selection);
  // the availability predicate (hasSelection) lets no door run without a selection; a selection of nodes the document
  // lacks is a defect of the store
  if (roots.length === 0) throw new Error('element.duplicate: the selection names no node of the document');
  if (roots.some((r) => r.parent === null)) return { kind: 'refused', message: message('status.duplicate.root') };
  // a locked root, or one inside a locked element, is not copied (spec lock-element)
  const locked = firstLockRefusal(state.document, roots.map((r) => r.node.id), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };

  const taken = new Set<string>();
  for (const node of allNodes(state.document)) taken.add(node.name);
  // named in document order, so the first root's copy takes the first free number
  const raw = roots.map((r) => ({ source: r.node, copy: copyOf(r.node, ids, taken, rules) }));
  const repaired = refreshCopiedIdentities(state.document, raw);
  const copies = roots.map((root, index) => {
    const copy = repaired[index];
    if (copy === undefined) throw new Error('element.duplicate: a copied root is missing');
    return { root, copy };
  });
  // the last root first, so every path taken from the document before the duplicate still points at its node: a copy
  // shifts only the nodes after its original in document order
  const patches: Patch[] = copies
    .slice()
    .reverse()
    .map(({ root, copy }) => ({ op: 'add', path: [...root.path.slice(0, -1), root.index + 1], value: copy }));

  // the primary's copy first: the copy of the root that is, or holds, the primary node
  const primaryId = state.selection[0];
  const holdsPrimary = (r: Location) => primaryId !== undefined && [...walk(r.node)].some((n) => n.id === primaryId);
  const primary = copies.find(({ root }) => holdsPrimary(root)) ?? copies[0];
  if (primary === undefined) throw new Error('element.duplicate: no root to copy');
  const selection = [primary.copy.id, ...copies.filter((c) => c !== primary).map((c) => c.copy.id)];
  return {
    kind: 'change',
    patches,
    selection,
    message: copies.length === 1 ? message('status.duplicated', { name: primary.root.node.name, copy: primary.copy.name }) : message('status.duplicatedMany', { count: copies.length }),
  };
});

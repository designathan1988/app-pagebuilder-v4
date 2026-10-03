// Materializing the content (spec content-data): the document as its collections say it is. Every bound list holds one
// repeated item per item of its query, in the query's order, each showing its item; every page made for an item shows
// it. One pure function, used by the commands that bind, fill and make pages, and by the derivation that follows any
// other change (derive.ts), so a list never shows anything but its collection.
//
// The repeated items of a list are the list element's children that are instances of the list's component, in order;
// its other children stay where they are. The n-th repeated item keeps its own nodes (ids, names, unbound content) and
// shows the n-th item; an item past the last repeated one gets a new instance of the component after the last one,
// named as a repeat names it; a repeated item past the last item goes, and every reference to it is released.
import type { NodeId } from '../../generated/commands.ts';
import { refreshCopiedIdentities } from '../document/clone.ts';
import { walk, type ComponentDefinition, type DocNode, type DocumentJson } from '../document/model.ts';
import { releaseReferencesPatch } from '../document/tree.ts';
import { copied, marked } from '../design/components.ts';
import { placementRefusal } from '../elements/content-model.ts';
import { applyPatches, deepEqual } from '../history/transaction.ts';
import { copyName } from '../structure/duplicate.ts';
import { nodeMaker, type NodeMaker } from '../structure/node-maker.ts';
import { collectionNamed, queryItems, refuse, DataRefusal } from './collections.ts';
import { fillTree, itemPagesOf, type DataContext, type ItemPages } from './bindings.ts';
import type { Collection, DataList } from './model.ts';

// A new repeated item: a copy of the component's definition with new ids, its root named after the item before it (a
// repeat's rule: "Card", "Card 2"…) and every element inside named so no other element shares its name.
export function newInstance(document: DocumentJson, definition: ComponentDefinition, after: string, make: NodeMaker): DocNode {
  const name = copyName(after, make.taken);
  make.taken.add(name);
  const plain = copied(definition.tree, () => make.ids.next() as NodeId, make, true);
  const tree = refreshCopiedIdentities(document, [{ source: definition.tree, copy: plain }])[0];
  if (tree === undefined) throw new Error('data: the copied instance is missing');
  return marked({ ...tree, name }, [], definition.name);
}

// The list element's children once the list shows its rows, or the same array when nothing changes.
function listChildren(document: DocumentJson, node: DocNode, list: DataList, collection: Collection, definition: ComponentDefinition, pages: ItemPages, context: DataContext, make: NodeMaker): readonly DocNode[] {
  const rows = queryItems(collection, list.query);
  const instances = node.children.filter((child) => child.component === list.component);
  const filled = (instance: DocNode, row: number): DocNode => {
    const item = rows[row];
    if (item === undefined) return instance;
    // the row a person sees: the item's place in the collection, as the Data grid numbers it
    const place = { collection, item, row: collection.items.indexOf(item) + 1 };
    return fillTree(document, instance, place, pages, context);
  };
  const kept: DocNode[] = [];
  let index = 0;
  for (const child of node.children) {
    if (child.component !== list.component) {
      kept.push(child);
      continue;
    }
    if (index < rows.length) kept.push(filled(child, index));
    index += 1;
  }
  // the items past the last repeated one: new instances after the last one (at the end when the list holds none)
  const last = kept.findLastIndex((child) => child.component === list.component);
  const added: DocNode[] = [];
  let before = instances.at(-1)?.name ?? definition.name;
  for (let row = instances.length; row < rows.length; row += 1) {
    const fresh = newInstance(document, definition, before, make);
    before = fresh.name;
    added.push(filled(fresh, row));
  }
  if (added.length > 0) {
    const refused = placementRefusal(document, context.rules, node.id as NodeId, added);
    if (refused !== null) throw new DataRefusal(refused);
    kept.splice(last < 0 ? kept.length : last + 1, 0, ...added);
  }
  const same = kept.length === node.children.length && kept.every((child, i) => child === node.children[i]);
  return same ? node.children : kept;
}

// The document with every bound list and every item page showing its collection. A list whose collection or component
// is gone, and a page whose item is gone, lose their mark and keep what they show. A change inside a locked element is
// refused, as any command's is.
export function materialize(document: DocumentJson, context: DataContext): DocumentJson {
  const pages = itemPagesOf(document);
  const make = nodeMaker(document, context.rules, context.ids, context.words);
  const removed = new Set<NodeId>();
  const visit = (node: DocNode): DocNode => {
    let next = node;
    const list = node.dataList;
    if (list !== undefined) {
      const collection = collectionNamed(document, list.collection);
      const definition = document.components?.find((c) => c.name === list.component);
      if (collection === undefined || definition === undefined) {
        const { dataList: _gone, ...plain } = next;
        void _gone;
        next = plain;
      } else {
        const children = listChildren(document, node, list, collection, definition, pages, context, make);
        if (children !== node.children) {
          const kept = new Set(children.map((child) => child.id));
          for (const child of node.children) if (!kept.has(child.id)) for (const inner of walk(child)) removed.add(inner.id as NodeId);
          next = { ...next, children };
        }
      }
    }
    const children = next.children.map(visit);
    return children.every((child, i) => child === next.children[i]) ? next : { ...next, children };
  };
  let working: DocumentJson = {
    ...document,
    pages: document.pages.map((page) => {
      let tree = visit(page.tree);
      const mark = tree.dataItem;
      if (mark !== undefined) {
        const collection = collectionNamed(document, mark.collection);
        const index = collection?.items.findIndex((item) => item.id === mark.item) ?? -1;
        const item = collection?.items[index];
        if (collection === undefined || item === undefined) {
          const { dataItem: _gone, ...plain } = tree;
          void _gone;
          tree = plain;
        } else {
          tree = fillTree(document, tree, { collection, item, row: index + 1 }, pages, context);
        }
      }
      if (tree === page.tree) return page;
      // what a lock holds stays as it is: a list or a page it would change refuses the whole change
      const lock = changedLock(page.tree, tree);
      if (lock !== null) refuse('status.data.locked', { name: lock.name });
      return { ...page, tree };
    }),
  };
  // what went with the removed repeated items: every reference to them (a link to an element, an interaction's target)
  if (removed.size > 0) working = applyPatches(working, releaseReferencesPatch(working, removed)).document;
  return working;
}

// The outermost locked element of a tree that a change of it reaches (changed, or gone), or null.
function changedLock(before: DocNode, after: DocNode): DocNode | null {
  const now = new Map([...walk(after)].map((node) => [node.id, node]));
  for (const node of walk(before)) if (node.locked === true && !deepEqual(now.get(node.id), node)) return node;
  return null;
}

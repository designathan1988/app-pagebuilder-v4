// The content commands (INVENTORY.md, owners; spec content-data): the collections and their fields and
// items, the bindings of elements, bound lists, pages made from a page, and shared regions. Each handler computes the
// document its change leads to with the content module's pure functions — the derivation included (derive.ts), so a
// list, an item page and a shared region already follow the change — and hands the store the difference as patches:
// one undo step. A predictable refusal (a value its field cannot hold, an image no file answers to, a locked element)
// is answered before any patch, naming the row, the column or the element at fault.
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { message, registerHandler, type HandlerContext, type Message, type Outcome } from '../commands/registry.ts';
import { locate, walk, type ComponentDefinition, type DocNode, type DocumentJson, type Page } from '../document/model.ts';
import { refreshCopiedIdentities } from '../document/clone.ts';
import { componentName, copied, createRefusal, marked } from '../design/components.ts';
import { componentHolders } from '../design/instances.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { copyPage, openedPage, type WithPage } from '../project/pages.ts';
import type { Patch } from '../history/transaction.ts';
import { boundIn, targetsOf, type DataContext } from './bindings.ts';
import {
  DataRefusal,
  addField,
  addItem,
  canonicalQuery,
  cellText,
  collectionNamed,
  collectionsOf,
  createCollection,
  deleteItems,
  keyFor,
  moveItem,
  nameRefusal,
  queryItems,
  queryRefusal,
  refuse,
  removeField,
  setCell,
  setField,
} from './collections.ts';
import { derivedDocument } from './derive.ts';
import { FIELD_TYPES, ITEM_PAGE, type BindTarget, type Bound, type Collection, type FieldType, type Query } from './model.ts';
import { documentPatches } from './patches.ts';
import { detachRegion, shareRegion, stopSharing } from './regions.ts';

// The editor state's part the content commands follow: the collection the Data panel shows (the editor's own state is
// wider: src/editor/data/state.ts).
export interface WithCollection {
  readonly data?: { readonly collection?: string | undefined } | undefined;
}

const contextOf = <Ui>(context: HandlerContext<Ui>): DataContext => ({ ids: context.ids, rules: context.rules, words: (key, params) => context.words(key, params) });

// A content change as the store takes it: the patches from the document before to the one the change and its
// derivation lead to; a DataRefusal thrown on the way is the command's refusal.
export function contentChange<Ui>(
  context: HandlerContext<Ui>,
  compute: (document: DocumentJson, data: DataContext) => { readonly document: DocumentJson; readonly message: Message; readonly ui?: Ui; readonly selection?: readonly NodeId[] }
): Outcome<Ui> {
  try {
    const before = context.state.document;
    const data = contextOf(context);
    const result = compute(before, data);
    const after = derivedDocument(before, result.document, data);
    const patches: Patch[] = documentPatches(before, after);
    // the selection keeps only what is still there (a card whose item went goes with its item)
    const chosen = result.selection ?? context.state.selection;
    const selection = chosen.filter((id) => locate(after, id) !== null);
    const moved = result.selection !== undefined || selection.length !== chosen.length;
    return { kind: 'change', patches, message: result.message, ...(result.ui === undefined ? {} : { ui: result.ui }), ...(moved ? { selection } : {}) };
  } catch (error) {
    if (error instanceof DataRefusal) return { kind: 'refused', message: error.refusal };
    throw error;
  }
}

// The collection a door names (a door stands for a collection that exists, so a missing one is a defect of the door).
function named(document: DocumentJson, name: unknown): Collection {
  const found = typeof name === 'string' ? collectionNamed(document, name) : undefined;
  if (found === undefined) throw new Error(`data: the project has no collection ${String(name)}`);
  return found;
}

// The document with one collection replaced (its name may change).
const withCollection = (document: DocumentJson, name: string, next: Collection): DocumentJson => ({ ...document, collections: collectionsOf(document).map((c) => (c.name === name ? next : c)) });

const fieldType = (value: unknown): FieldType => {
  if (!(FIELD_TYPES as readonly unknown[]).includes(value)) throw new Error(`data: ${String(value)} is not a field type`);
  return value as FieldType;
};

// The collection the Data panel shows: the one chosen (data.select), else the project's first.
export function shownCollection(document: DocumentJson, ui: WithCollection | undefined): Collection | undefined {
  const chosen = ui?.data?.collection;
  return (chosen === undefined ? undefined : collectionNamed(document, chosen)) ?? collectionsOf(document)[0];
}

// A JSON argument read as a query (a door hands its canonical form).
function queryOf(value: unknown): Query {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? canonicalQuery(value as Query) : {};
}

// ---------------------------------------------------------------- collections

// data.createCollection: a new collection with one text field, named as typed, else "Collection" (numbered when taken);
// the Data panel shows it.
export function createCollectionCommand<Ui extends WithCollection>() {
  return registerHandler<'data.createCollection', Ui>('data.createCollection', (context, { name }) =>
    contentChange(context, (document) => {
      const typed = typeof name === 'string' ? name.trim() : '';
      const base = typed === '' ? context.words('data.defaultCollection') : typed;
      let chosen = base;
      if (typed === '') for (let n = 2; nameRefusal(collectionsOf(document), chosen) !== null; n += 1) chosen = `${base} ${n}`;
      const label = context.words('data.defaultField');
      const collection = createCollection(collectionsOf(document), chosen, [{ key: keyFor(label, []), label, type: 'text' }]);
      return {
        document: { ...document, collections: [...collectionsOf(document), collection] },
        message: message('status.data.created', { name: collection.name }),
        ui: { ...context.state.ui, data: { ...context.state.ui?.data, collection: collection.name } },
      };
    }),
  );
}

// data.renameCollection: a new name, which every list and item page bound to it follows.
export function renameCollectionCommand<Ui extends WithCollection>() {
  return registerHandler<'data.renameCollection', Ui>('data.renameCollection', (context, { collection, name }) =>
    contentChange(context, (document) => {
      const held = named(document, collection);
      const typed = name.trim();
      if (typed === held.name) return { document, message: message('status.data.renamed', { name: typed }) };
      const refused = nameRefusal(collectionsOf(document), typed, held.name);
      if (refused !== null) throw new DataRefusal(refused);
      const follow = (node: DocNode): DocNode => {
        let next = node;
        if (node.dataList?.collection === held.name) next = { ...next, dataList: { ...node.dataList, collection: typed } };
        if (node.dataItem?.collection === held.name) next = { ...next, dataItem: { ...node.dataItem, collection: typed } };
        const children = next.children.map(follow);
        return children.every((child, i) => child === next.children[i]) ? next : { ...next, children };
      };
      const renamed = withCollection(document, held.name, { ...held, name: typed });
      return {
        document: {
          ...renamed,
          pages: renamed.pages.map((page) => ({ ...page, tree: follow(page.tree) })),
          ...(renamed.components === undefined ? {} : { components: renamed.components.map((c) => ({ ...c, tree: follow(c.tree) })) }),
        },
        message: message('status.data.renamed', { name: typed }),
        ui: context.state.ui?.data?.collection === held.name ? { ...context.state.ui, data: { ...context.state.ui.data, collection: typed } } : context.state.ui,
      };
    }),
  );
}

// Where a collection is shown: its bound lists and its item pages.
function usesOf(document: DocumentJson, name: string): number {
  let uses = 0;
  for (const page of document.pages) for (const node of walk(page.tree)) if (node.dataList?.collection === name || node.dataItem?.collection === name) uses += 1;
  return uses;
}

// data.deleteCollection: asked first (with how many lists and pages show it); the lists and item pages it fed keep
// what they show as ordinary content.
export function deleteCollectionCommand<Ui extends WithCollection>() {
  return registerHandler<'data.deleteCollection', Ui>('data.deleteCollection', (context, { collection }) => {
    const held = named(context.state.document, collection);
    if (context.confirmed !== true) return { kind: 'confirm', params: { name: held.name, count: usesOf(context.state.document, held.name) } };
    return contentChange(context, (document) => {
      const release = (node: DocNode): DocNode => {
        let next = node;
        if (node.dataList?.collection === held.name) {
          const { dataList: _list, ...plain } = next;
          void _list;
          next = plain;
        }
        if (node.dataItem?.collection === held.name) {
          const { dataItem: _item, ...plain } = next;
          void _item;
          next = plain;
        }
        const children = next.children.map(release);
        return children.every((child, i) => child === next.children[i]) ? next : { ...next, children };
      };
      const rest = collectionsOf(document).filter((c) => c.name !== held.name);
      const { collections: _all, ...without } = document;
      void _all;
      const base: DocumentJson = rest.length === 0 ? without : { ...without, collections: rest };
      const ui = context.state.ui?.data?.collection === held.name ? { ...context.state.ui, data: { ...context.state.ui.data, collection: rest[0]?.name } } : context.state.ui;
      return {
        document: { ...base, pages: base.pages.map((page) => ({ ...page, tree: release(page.tree) })), ...(base.components === undefined ? {} : { components: base.components.map((c) => ({ ...c, tree: release(c.tree) })) }) },
        message: message('status.data.deleted', { name: held.name }),
        ui,
      };
    });
  });
}

// ---------------------------------------------------------------- fields

// data.addField (the form under the fields): a new field of the collection the Data panel shows, labelled as typed,
// its key made from its label.
export function addFieldCommand<Ui extends WithCollection>() {
  return registerHandler<'data.addField', Ui>('data.addField', (context, { label, type }) =>
    contentChange(context, (document) => {
      const held = shownCollection(document, context.state.ui);
      if (held === undefined) refuse('status.data.noCollection');
      if (label.trim() === '') refuse('status.data.fieldLabelEmpty', { collection: held.name });
      const next = addField(held, label, fieldType(type));
      return { document: withCollection(document, held.name, next), message: message('status.data.fieldAdded', { collection: held.name, label: label.trim() }) };
    }),
  );
}

export const setFieldCommand = registerHandler('data.setField', (context, { collection, field, label, type }) =>
  contentChange(context, (document) => {
    const held = named(document, collection);
    const next = setField(held, field, { ...(typeof label === 'string' ? { label } : {}), ...(type === undefined ? {} : { type: fieldType(type) }) });
    const shown = next.fields.find((f) => f.key === field)?.label ?? field;
    return { document: withCollection(document, held.name, next), message: message('status.data.fieldChanged', { collection: held.name, label: shown }) };
  }),
);

// How many places use a field of a collection: the bindings of its lists' components and of its item pages, and the
// filters and orders of its lists.
function fieldUses(document: DocumentJson, collection: string, key: string): number {
  let uses = 0;
  const usesKey = (node: DocNode) => (node.bind ?? []).some((bound) => bound.field === key);
  for (const page of document.pages) {
    for (const node of walk(page.tree)) {
      const list = node.dataList;
      if (list?.collection === collection) {
        const definition = document.components?.find((c) => c.name === list.component);
        if (definition !== undefined) uses += [...walk(definition.tree)].filter(usesKey).length;
        uses += [...(list.query.filters ?? []), ...(list.query.order ?? [])].filter((entry) => entry.field === key).length;
      }
      if (node.dataItem?.collection === collection) uses += boundIn(node).filter(usesKey).length;
    }
  }
  return uses;
}

export const removeFieldCommand = registerHandler('data.removeField', (context, { collection, field }) =>
  contentChange(context, (document) => {
    const held = named(document, collection);
    const label = held.fields.find((f) => f.key === field)?.label ?? field;
    const uses = fieldUses(document, held.name, field);
    if (uses > 0) refuse('status.data.fieldInUse', { collection: held.name, label, count: { plural: 'data.places', count: uses } });
    return { document: withCollection(document, held.name, removeField(held, field)), message: message('status.data.fieldRemoved', { collection: held.name, label }) };
  }),
);

// ---------------------------------------------------------------- items

export const addItemCommand = registerHandler('data.addItem', (context, { collection }) =>
  contentChange(context, (document) => {
    const held = named(document, collection);
    const next = addItem(held, context.ids.next());
    return { document: withCollection(document, held.name, next), message: message('status.data.itemAdded', { collection: held.name, row: next.items.length }) };
  }),
);

export const setCellCommand = registerHandler('data.setCell', (context, { collection, item, field, value }) =>
  contentChange(context, (document) => {
    const held = named(document, collection);
    const next = setCell(held, item, field, value);
    const row = held.items.findIndex((one) => one.id === item) + 1;
    const label = held.fields.find((f) => f.key === field)?.label ?? field;
    return { document: withCollection(document, held.name, next), message: message('status.data.cellSet', { collection: held.name, row, column: label }) };
  }),
);

export const deleteItemsCommand = registerHandler('data.deleteItems', (context, { collection, items }) =>
  contentChange(context, (document) => {
    const held = named(document, collection);
    const ids = Array.isArray(items) ? items.filter((id): id is string => typeof id === 'string') : [];
    if (ids.length === 0) throw new Error('data.deleteItems: no item');
    return { document: withCollection(document, held.name, deleteItems(held, ids)), message: message('status.data.itemsDeleted', { collection: held.name, count: { plural: 'data.items', count: ids.length } }) };
  }),
);

export const moveItemCommand = registerHandler('data.moveItem', (context, { collection, item, to }) =>
  contentChange(context, (document) => {
    const held = named(document, collection);
    const next = moveItem(held, item, to);
    return { document: withCollection(document, held.name, next), message: message('status.data.itemMoved', { collection: held.name, row: next.items.findIndex((one) => one.id === item) + 1 }) };
  }),
);

// ---------------------------------------------------------------- bindings

// The node a binding is written on, and the same node of every instance of its component with the definition's: a
// binding in a repeated item is the component's, as a style is (componentHolders).
function bindingHolders(document: DocumentJson, id: NodeId): { readonly node: DocNode; readonly path: readonly (string | number)[] }[] {
  const holders = componentHolders(document, id);
  if (holders !== null) return holders;
  const found = locate(document, id);
  return found === null ? [] : [{ node: found.node, path: found.path }];
}

// data.bindElement: an element shows a field of its item in one of its parts (its text, an image's source or
// alternative text, a link's address, or the address of the item's own page); an empty field removes the binding of
// that part. Run by the field's menu in the Data panel and by a column dropped on an element there.
export const bindElementCommand = registerHandler('data.bindElement', (context, { node, field, to }): Outcome<never> => {
  const document = context.state.document;
  const found = locate(document, node);
  if (found === null) throw new Error(`data.bindElement: the document has no node ${node}`);
  const locked = lockRefusal(document, node, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const target = to as BindTarget;
  if (!targetsOf(found.node, context.rules).includes(target)) return { kind: 'refused', message: message('status.data.cannotShow', { name: found.node.name, target: { key: `data.target.${target}` as MessageId } }) };
  if (field === ITEM_PAGE && target !== 'link') return { kind: 'refused', message: message('status.data.cannotShow', { name: found.node.name, target: { key: `data.target.${target}` as MessageId } }) };
  const bound = (held: readonly Bound[] | undefined): readonly Bound[] => [...(held ?? []).filter((b) => b.to !== target), ...(field === '' ? [] : [{ field, to: target }])];
  return contentChange(context, (current) => {
    let working = current;
    for (const holder of bindingHolders(current, node)) {
      const next = bound(holder.node.bind);
      const { bind: _old, ...plain } = holder.node;
      void _old;
      const value: DocNode = next.length === 0 ? plain : { ...plain, bind: next };
      working = replaceAt(working, holder.path, value);
    }
    return { document: working, message: field === '' ? message('status.data.unbound', { name: found.node.name, target: { key: `data.target.${target}` as MessageId } }) : message('status.data.bound', { name: found.node.name, field: field === ITEM_PAGE ? { key: 'data.itemPage' } : field, target: { key: `data.target.${target}` as MessageId } }) };
  });
});

// A document with the node at a path (pages/…/tree/children/… or components/…/tree/…) replaced.
function replaceAt(document: DocumentJson, path: readonly (string | number)[], value: DocNode): DocumentJson {
  const put = (at: unknown, rest: readonly (string | number)[]): unknown => {
    if (rest.length === 0) return value;
    const [key, ...more] = rest as [string | number, ...(string | number)[]];
    if (Array.isArray(at)) return at.map((item, i) => (i === key ? put(item, more) : item));
    const record = at as Record<string, unknown>;
    return { ...record, [key]: put(record[key], more) };
  };
  return put(document, path) as DocumentJson;
}

// data.fill (the Data panel's labelled Fill button): the selected element repeats the items of a collection, as many as
// its query shows, inside its parent, each showing its item through the bindings it carries. An element that is not
// an instance yet becomes a component (named after it), its first item; its parent becomes the bound list, which
// follows the collection from now on (derive.ts). Refused, naming what is at fault: an element with no binding, a
// binding to a field the collection does not have, an image no project file answers to, a locked element.
export const fillCommand = registerHandler('data.fill', (context, { node, collection, query }): Outcome<never> =>
  contentChange(context, (document, data) => {
    const held = named(document, collection);
    const asked = queryOf(query);
    const refusedQuery = queryRefusal(held, asked);
    if (refusedQuery !== null) throw new DataRefusal(refusedQuery);
    const found = locate(document, node);
    if (found === null) throw new Error(`data.fill: the document has no node ${node}`);
    if (found.parent === null) refuse('status.data.fillRoot', { name: found.node.name });
    const parent = found.parent;
    for (const id of [parent.id, found.node.id]) {
      const locked = lockRefusal(document, id as NodeId, 'status.locked.edit');
      if (locked !== null) throw new DataRefusal(locked);
    }
    // an element that is not an instance becomes one: what components.create refuses (an element inside an instance,
    // one that holds an instance, a locked one) is refused here too
    if (found.node.component === undefined) {
      const refused = createRefusal(document, found.node.id as NodeId);
      if (refused !== null) throw new DataRefusal(refused);
    }
    let working = document;
    let definition: ComponentDefinition | undefined = found.node.component === undefined ? undefined : document.components?.find((c) => c.name === found.node.component);
    if (definition === undefined) {
      // the element becomes a component, named after it, and the list's first item, as components.repeat makes one
      const name = componentName(document, found.node.name);
      const plain = copied(found.node, () => data.ids.next() as NodeId, null);
      const tree = refreshCopiedIdentities(document, [{ source: found.node, copy: plain }], false)[0];
      if (tree === undefined) throw new Error('data.fill: the definition copy is missing');
      definition = { name, tree };
      working = { ...working, components: [...(working.components ?? []), definition], pages: working.pages };
      working = replaceAt(working, found.path, marked(found.node, [], name));
    }
    const bound = boundIn(definition.tree).flatMap((n) => n.bind ?? []);
    if (bound.length === 0) refuse('status.data.noBindings', { name: found.node.name });
    const unknown = bound.find((b) => b.field !== ITEM_PAGE && !held.fields.some((f) => f.key === b.field));
    if (unknown !== undefined) refuse('status.data.unknownField', { collection: held.name, field: unknown.field });
    const other = parent.dataList;
    if (other !== undefined && other.component !== definition.name) refuse('status.data.otherList', { name: parent.name, collection: other.collection });
    const list = { collection: held.name, component: definition.name, query: asked };
    const parentAt = locate(working, parent.id as NodeId);
    if (parentAt === null) throw new Error('data.fill: the parent is missing');
    working = replaceAt(working, parentAt.path, { ...parentAt.node, dataList: list });
    const count = queryItems(held, asked).length;
    return { document: working, message: message('status.data.listFilled', { name: definition.name, collection: held.name, count: { plural: 'data.items', count } }), selection: [found.node.id as NodeId] };
  }),
);

// data.unbind: a bound list stops following its collection; its items stay, ordinary instances of the component.
export const unbindCommand = registerHandler('data.unbind', (context, { node }): Outcome<never> =>
  contentChange(context, (document) => {
    const found = locate(document, node);
    if (found === null) throw new Error(`data.unbind: the document has no node ${node}`);
    // the list element itself, or one of its repeated items
    const listAt = found.node.dataList !== undefined ? found : found.parent?.dataList !== undefined ? locate(document, found.parent.id as NodeId) : null;
    if (listAt === null || listAt.node.dataList === undefined) refuse('status.data.notList', { name: found.node.name });
    const locked = lockRefusal(document, listAt.node.id as NodeId, 'status.locked.edit');
    if (locked !== null) throw new DataRefusal(locked);
    const { dataList, ...plain } = listAt.node;
    return { document: replaceAt(document, listAt.path, plain), message: message('status.data.listUnbound', { name: listAt.node.name, collection: dataList.collection }) };
  }),
);

// ---------------------------------------------------------------- pages from a page

const withPageAfter = (document: DocumentJson, after: number, made: readonly Page[]): DocumentJson => ({ ...document, pages: [...document.pages.slice(0, after + 1), ...made, ...document.pages.slice(after + 1)] });

// pages.fromNames: one page per name (one per line), each a copy of the open page, named and filed as a duplicate is;
// the first opens. Pages made later receive the shared regions that ask for it.
export function pagesFromNamesCommand<Ui extends WithPage>() {
  return registerHandler<'pages.fromNames', Ui>('pages.fromNames', (context, { names }) =>
    contentChange(context, (document, data) => {
      const at = openedPage(context.state);
      const source = document.pages[at] as Page;
      const wanted = names.split(/\r?\n/).map((name) => name.trim()).filter((name) => name !== '');
      if (wanted.length === 0) refuse('status.pages.noNames', { name: source.name });
      const made: Page[] = [];
      for (const name of wanted) made.push(copyPage(withPageAfter(document, at, made), source, name, () => data.ids.next() as NodeId));
      const first = made[0] as Page;
      return {
        document: withPageAfter(document, at, made),
        message: message('status.pages.madeFromNames', { name: source.name, count: { plural: 'data.pages', count: made.length } }),
        ui: { ...context.state.ui, page: first.id },
        selection: [],
      };
    }),
  );
}

// pages.fromCollection: one page per item of a collection, each a copy of the page named by the item's field, its
// root naming the item: the page's bindings show the item, and links bound to the item's page lead there. An item
// that has its page already keeps it (its file stays: a link to it never breaks); the first new page opens.
export function pagesFromCollectionCommand<Ui extends WithPage>() {
  return registerHandler<'pages.fromCollection', Ui>('pages.fromCollection', (context, { collection, nameField }) =>
    contentChange(context, (document, data) => {
      const at = openedPage(context.state);
      const source = document.pages[at] as Page;
      const held = named(document, collection);
      if (source.tree.dataItem !== undefined) refuse('status.data.templateIsItemPage', { name: source.name });
      const field = held.fields.find((f) => f.key === nameField);
      if (field === undefined) refuse('status.stale');
      const existing = new Set(document.pages.flatMap((p) => (p.tree.dataItem?.collection === held.name ? [p.tree.dataItem.item] : [])));
      const made: Page[] = [];
      held.items.forEach((item, index) => {
        if (existing.has(item.id)) return;
        const name = cellText(item.values[field.key], { yes: context.words('data.yes'), no: context.words('data.no') }).trim();
        if (name === '') refuse('status.data.emptyName', { collection: held.name, row: index + 1, column: field.label });
        const copy = copyPage(withPageAfter(document, at, made), source, name, () => data.ids.next() as NodeId);
        made.push({ ...copy, tree: { ...copy.tree, dataItem: { collection: held.name, item: item.id } } });
      });
      const first = made[0];
      return {
        document: withPageAfter(document, at, made),
        message: made.length === 0 ? message('status.pages.itemPagesCurrent', { collection: held.name }) : message('status.pages.madeFromCollection', { collection: held.name, count: { plural: 'data.pages', count: made.length } }),
        ...(first === undefined ? {} : { ui: { ...context.state.ui, page: first.id }, selection: [] }),
      };
    }),
  );
}

// ---------------------------------------------------------------- shared regions

const pagesList = (value: unknown): readonly string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []);

// regions.share (the Shared form of the Data panel): the selected element, directly inside its page's root, is shown
// on the pages chosen (their files) and, with "new" among them, on every page made later.
export const shareRegionCommand = registerHandler('regions.share', (context, { pages }): Outcome<never> =>
  contentChange(context, (document, data) => {
    const node = context.state.selection[0];
    if (node === undefined || context.state.selection.length !== 1) refuse('status.needsSingleSelection');
    const shared = shareRegion(document, node, pagesList(pages), data);
    return { document: shared.document, message: message('status.regions.shared', { name: shared.name, count: { plural: 'data.pages', count: shared.count } }) };
  }),
);

export const detachRegionCommand = registerHandler('regions.detach', (context, { node }): Outcome<never> =>
  contentChange(context, (document) => {
    const page = document.pages.find((p) => [...walk(p.tree)].some((n) => n.id === node));
    const detached = detachRegion(document, node);
    return { document: detached.document, message: message('status.regions.detached', { name: detached.name, page: page?.name ?? '' }) };
  }),
);

export const stopSharingCommand = registerHandler('regions.stopSharing', (context, { component }): Outcome<never> =>
  contentChange(context, (document) => ({ document: stopSharing(document, component), message: message('status.regions.stopped', { name: component }) })),
);

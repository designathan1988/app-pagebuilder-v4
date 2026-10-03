// Shared regions (spec content-data, "shared regions"; jornada03 C3/H13): a header, a footer or a menu that every
// page shows, edited once. A shared region is a component whose definition is marked shared: its instances are the
// region on each page, and they hold the same content. Styles already reach every instance through the component
// (core/design/components.ts componentHolders); what this module adds is the rest — a text, an attribute, an element
// added or removed in one instance reaches the definition and every other instance in the same transaction
// (syncRegions, run by the derivation after any change), and a page made later receives the region when the person
// asked for it. Detaching a page's instance leaves that page an ordinary copy that no longer follows.
import type { NodeId } from '../../generated/commands.ts';
import { refreshCopiedIdentities } from '../document/clone.ts';
import { locate, walk, type ComponentDefinition, type DocNode, type DocumentJson } from '../document/model.ts';
import { componentName, copied, createRefusal, marked, unmarked } from '../design/components.ts';
import { placementRefusal } from '../elements/content-model.ts';
import { deepEqual } from '../history/transaction.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { freshName, nodeMaker, type NodeMaker } from '../structure/node-maker.ts';
import { DataRefusal, refuse } from './collections.ts';
import type { DataContext } from './bindings.ts';
import { newInstance } from './materialize.ts';
import type { SharedRegion } from './model.ts';

// A page's file standing for the pages that will be made later, in the list of pages a region is shared with.
export const NEW_PAGES = 'new';

// What an instance holds that its region's copies must hold too: everything but its identities (ids and names, which
// each copy keeps its own), the component marks (which say where the copy comes from) and the editor's flags (hidden
// and locked are the person's choice on each page, spec hide-element and lock-element).
function content(node: DocNode): unknown {
  const { id: _id, name: _name, component: _component, componentPart: _part, hidden: _hidden, locked: _locked, children, ...own } = node;
  void _id;
  void _name;
  void _component;
  void _part;
  void _hidden;
  void _locked;
  return { ...own, children: children.map(content) };
}

// A tree holding `truth`'s content, keeping the identities and the flags of `old` place by place (its ids, its names,
// hidden and locked); a place `old` does not have gets a new id and a name no element has.
function conform(truth: DocNode, old: DocNode | undefined, make: NodeMaker): DocNode {
  const { id: _id, name, component: _component, componentPart: _part, hidden: _hidden, locked: _locked, children, ...own } = truth;
  void _id;
  void _component;
  void _part;
  void _hidden;
  void _locked;
  return {
    ...own,
    id: old?.id ?? (make.ids.next() as NodeId),
    name: old?.name ?? freshName(make, name),
    ...(old?.hidden === true ? { hidden: true as const } : {}),
    ...(old?.locked === true ? { locked: true as const } : {}),
    children: children.map((child, i) => conform(child, old?.children[i], make)),
  } as DocNode;
}

const sharedOf = (definition: ComponentDefinition): SharedRegion | undefined => definition.shared;

// Every instance of a component in the pages, with the page it stands on.
function instancesOf(document: DocumentJson, component: string): { readonly node: DocNode; readonly page: number }[] {
  const found: { node: DocNode; page: number }[] = [];
  document.pages.forEach((page, index) => {
    for (const node of walk(page.tree)) if (node.component === component) found.push({ node, page: index });
  });
  return found;
}

// A tree with one node replaced (by id).
function replaced(tree: DocNode, id: string, next: DocNode): DocNode {
  if (tree.id === id) return next;
  const children = tree.children.map((child) => replaced(child, id, next));
  return children.every((child, i) => child === tree.children[i]) ? tree : { ...tree, children };
}

// The instance a page receives: placed first or last among its root's children, as the region says.
function received(document: DocumentJson, pageIndex: number, definition: ComponentDefinition, region: SharedRegion, make: NodeMaker, context: DataContext): DocumentJson {
  const page = document.pages[pageIndex];
  if (page === undefined) return document;
  const locked = lockRefusal(document, page.tree.id as NodeId, 'status.locked.insert');
  if (locked !== null) throw new DataRefusal(locked);
  const instance = newInstance(document, definition, definition.name, make);
  const refused = placementRefusal(document, context.rules, page.tree.id as NodeId, [instance]);
  if (refused !== null) throw new DataRefusal(refused);
  const children = region.at === 'start' ? [instance, ...page.tree.children] : [...page.tree.children, instance];
  return { ...document, pages: document.pages.map((one, i) => (i === pageIndex ? { ...one, tree: { ...one.tree, children } } : one)) };
}

// regions.share: an element directly inside a page (a header, a footer, a menu) becomes a shared region, placed on the
// chosen pages (their files) and, with NEW_PAGES among them, on every page made later. An element that is not an
// instance yet becomes a component first, named after it, as components.create makes one; one that is already an
// instance shares its component. A page that holds an instance of it already keeps it.
export function shareRegion(document: DocumentJson, id: NodeId, pages: readonly string[], context: DataContext): { readonly document: DocumentJson; readonly name: string; readonly count: number } {
  const found = locate(document, id);
  if (found === null) throw new Error(`regions.share: the document has no node ${id}`);
  const grand = found.parent === null ? null : locate(document, found.parent.id as NodeId);
  if (found.parent === null || grand === null || grand.parent !== null) refuse('status.regions.notTopLevel', { name: found.node.name });
  const locked = lockRefusal(document, id, 'status.locked.edit');
  if (locked !== null) throw new DataRefusal(locked);
  const newPages = pages.includes(NEW_PAGES);
  const chosen = document.pages.map((page, index) => ({ page, index })).filter(({ page }) => pages.includes(page.file));
  if (chosen.length === 0 && !newPages) refuse('status.regions.noPages', { name: found.node.name });
  const at: SharedRegion['at'] = found.index < found.parent.children.length / 2 ? 'start' : 'end';
  const region: SharedRegion = { newPages, at };
  let working = document;
  let name = found.node.component;
  if (name === undefined) {
    // the element becomes the component's definition (new ids) and its first instance, as components.create does, and
    // what it refuses is refused here too (an element that holds an instance)
    const refused = createRefusal(document, id);
    if (refused !== null) throw new DataRefusal(refused);
    name = componentName(document, found.node.name);
    const plain = copied(found.node, () => context.ids.next() as NodeId, null);
    const tree = refreshCopiedIdentities(document, [{ source: found.node, copy: plain }], false)[0];
    if (tree === undefined) throw new Error('regions.share: the definition copy is missing');
    const definition: ComponentDefinition = { name, tree, shared: region };
    working = { ...working, components: [...(working.components ?? []), definition] };
    const own = document.pages.findIndex((page) => [...walk(page.tree)].some((node) => node.id === id));
    working = { ...working, pages: working.pages.map((page, i) => (i === own ? { ...page, tree: replaced(page.tree, id, marked(found.node, [], name as string)) } : page)) };
  } else {
    const component = name;
    working = { ...working, components: (working.components ?? []).map((c) => (c.name === component ? { ...c, shared: region } : c)) };
  }
  const definition = working.components?.find((c) => c.name === name) as ComponentDefinition;
  const make = nodeMaker(working, context.rules, context.ids, context.words);
  let count = 0;
  for (const { index } of chosen) {
    const holds = working.pages[index]?.tree.children.some((child) => child.component === name) ?? false;
    if (holds) continue;
    working = received(working, index, definition, region, make, context);
    count += 1;
  }
  return { document: working, name, count };
}

// regions.detach: a page's instance of a shared region becomes an ordinary copy, which no longer follows the region.
export function detachRegion(document: DocumentJson, id: NodeId): { readonly document: DocumentJson; readonly name: string } {
  const found = locate(document, id);
  const definition = found?.node.component === undefined ? undefined : document.components?.find((c) => c.name === found.node.component);
  if (found === null || definition === undefined || sharedOf(definition) === undefined) refuse('status.regions.notShared', { name: found?.node.name ?? '' });
  const locked = lockRefusal(document, id, 'status.locked.edit');
  if (locked !== null) throw new DataRefusal(locked);
  const pages = document.pages.map((page) => {
    const tree = replaced(page.tree, id, unmarked(found.node));
    return tree === page.tree ? page : { ...page, tree };
  });
  return { document: { ...document, pages }, name: definition.name };
}

// regions.stopSharing: the region's instances stay instances of an ordinary component (their styles still shared,
// their content their own from now on).
export function stopSharing(document: DocumentJson, component: string): DocumentJson {
  const definition = document.components?.find((c) => c.name === component);
  if (definition === undefined || definition.shared === undefined) refuse('status.regions.notShared', { name: component });
  return {
    ...document,
    components: (document.components ?? []).map((c) => {
      if (c.name !== component) return c;
      const { shared: _shared, ...plain } = c;
      void _shared;
      return plain;
    }),
  };
}

// The regions once a change is done: when the change edited one instance of a shared region (or its definition),
// that content reaches the definition and every other instance; when it edited two instances differently, the change
// is refused (nothing can tell which one is meant). A page made by the change receives every region shared with new
// pages. A locked instance that would have to follow refuses the change.
export function syncRegions(before: DocumentJson, after: DocumentJson, context: DataContext): DocumentJson {
  const shared = (after.components ?? []).filter((c) => sharedOf(c) !== undefined);
  if (shared.length === 0) return after;
  let working = after;
  const make = nodeMaker(after, context.rules, context.ids, context.words);
  const previous = new Map<string, DocNode>();
  for (const page of before.pages) for (const node of walk(page.tree)) if (node.component !== undefined) previous.set(node.id, node);
  for (const definition of shared) {
    const region = sharedOf(definition) as SharedRegion;
    const instances = instancesOf(working, definition.name);
    const truthOf = (): DocNode | null => {
      const edited = instances.filter(({ node }) => {
        const old = previous.get(node.id);
        return old !== undefined && !deepEqual(content(old), content(node));
      });
      if (edited.length > 0) {
        const first = edited[0] as { node: DocNode };
        if (edited.some(({ node }) => !deepEqual(content(node), content(first.node)))) refuse('status.regions.conflict', { name: definition.name });
        return first.node;
      }
      return null;
    };
    const truth = truthOf() ?? definition.tree;
    const wanted = content(truth);
    // the definition follows the edited instance (its own ids kept)
    if (!deepEqual(content(definition.tree), wanted)) {
      const tree = unmarked(conform(truth, definition.tree, make));
      working = { ...working, components: (working.components ?? []).map((c) => (c.name === definition.name ? { ...c, tree } : c)) };
    }
    for (const { node, page } of instances) {
      if (deepEqual(content(node), wanted)) continue;
      const locked = lockRefusal(working, node.id as NodeId, 'status.locked.edit');
      if (locked !== null) refuse('status.regions.locked', { name: definition.name, page: working.pages[page]?.name ?? '' });
      const next = marked(conform(truth, node, make), [], definition.name);
      working = { ...working, pages: working.pages.map((one, i) => (i === page ? { ...one, tree: replaced(one.tree, node.id, next) } : one)) };
    }
    // a page the change made receives the region when it was shared with new pages
    if (region.newPages) {
      const known = new Set(before.pages.map((page) => page.id));
      const updated = working.components?.find((c) => c.name === definition.name) ?? definition;
      working.pages.forEach((page, index) => {
        if (known.has(page.id) || page.tree.children.some((child) => child.component === definition.name)) return;
        working = received(working, index, updated, region, make, context);
      });
    }
  }
  return working;
}

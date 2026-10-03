// The project's components (INVENTORY.md, owners; spec reusable-components): a component is a named
// definition, a tree of elements kept with the project (the document's `components`), whose instances are real
// subtrees of pages. An instance's root names its component (`component`); each of its elements records the place of
// the definition element it comes from (`componentPart`, the child indexes from the definition's root). The one owner
// of:
//  - components.create: the one selected element and its subtree become a new component's definition (new ids), named
//    after the element (numbered when the project has a component of that name); the element becomes its first
//    instance. The page root (status.components.root), an instance or an element inside one
//    (status.components.inInstance) and a locked element (status.locked.edit) are refused.
//  - components.insertInstance: a new instance (the definition's elements, each with a new id and a name no element
//    has) placed as element.insert places a tile (core/structure/insert.ts placement), refused as an element is
//    (content-model.ts placementRefusal, a locked parent); it becomes the selection.
//  - components.detach (predicate instanceSelected): the instance's elements forget their component and their parts.
//  - components.repeat (spec repeat-element): the one selected element gains a linked copy right after it, a new
//    instance of its component; an element that is not one yet first becomes a component (as components.create makes
//    one, named after it) and its first instance. The new item becomes the selection, so the command run again adds
//    the next. Styles are the component's, so a style written on any repeated item reaches them all; a text or an
//    attribute stays on its item.
//  - components.fillFromData (spec repeat-element, Fill from data): the repeated items of the selected one (the
//    instances of its component in its parent, in order) take the rows of a project data file (core/design/data.ts),
//    one row each: a field of an item (an element that holds text, an image's source) takes the value named like its
//    definition element, else the value at its place; rows beyond the items add new items after the last one.
// Where a style write on an element of an instance goes, and the root of an instance, are read by
// core/design/instances.ts.
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, registerPredicate, type Message, type Outcome } from '../commands/registry.ts';
import { locate, walk, type ComponentDefinition, type DocNode, type DocumentJson } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { refreshCopiedIdentities } from '../document/clone.ts';
import { placementRefusal } from '../elements/content-model.ts';
import type { Patch } from '../history/transaction.ts';
import { deepEqual } from '../history/transaction.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { placement } from '../structure/insert.ts';
import { nodeMaker, type NodeMaker } from '../structure/node-maker.ts';
import { copyName } from '../structure/duplicate.ts';
import { fileAt, imageFiles, isProjectPath } from '../files/files.ts';
import { readAddress } from '../elements/address.ts';
import { dataRows, type DataRow } from './data.ts';
import { registerReferenceKind } from '../store/references.ts';
import { componentsOf, instanceRootOf } from './instances.ts';

// Why these elements may not go into this receiver, by the instances' own rules, or null (the audit's AUD-04: Remove
// wrapper, Move out of parent and Make child of previous layer left parts outside their instance or an instance
// inside another, which the model refuses): a part of an instance stays inside that instance, and an element that is
// or holds an instance goes into no instance. The one owner of the rule for every structure command that moves
// elements (core/structure/move.ts, wrap.ts).
export function instanceMoveRefusal(document: DocumentJson, moved: readonly DocNode[], receiver: NodeId): Message | null {
  const host = instanceRootOf(document, receiver);
  for (const node of moved) {
    // every part the moved subtree holds, the moved element or one inside it (a wrapper made inside an instance holds
    // parts without being one), stays in its instance
    // (a part of an instance that moves whole, its root inside the moved subtree, goes with its instance)
    const subtree = new Set([...walk(node)].map((inner) => inner.id));
    for (const inner of walk(node)) {
      if (inner.componentPart === undefined || inner.component !== undefined) continue;
      const own = instanceRootOf(document, inner.id as NodeId);
      if (own !== null && !subtree.has(own.id) && own.id !== host?.id) return message('status.instance.partLeaves', { name: node.name, instance: own.name });
    }
    if (host !== null && [...walk(node)].some((inner) => inner.component !== undefined)) return message('status.instance.nested', { name: node.name, instance: host.name });
  }
  return null;
}

// An element of a tree as the elements of an instance: its part given, its children's after it; the root names the
// component.
export function marked(node: DocNode, part: readonly number[], component: string | null): DocNode {
  const { component: _c, componentPart: _p, ...plain } = node;
  void _c;
  void _p;
  return { ...plain, ...(component !== null ? { component } : {}), componentPart: part, children: node.children.map((child, i) => marked(child, [...part, i], null)) };
}

// An element of an instance as an ordinary element: no component, no part, down its subtree.
export function unmarked(node: DocNode): DocNode {
  const { component: _c, componentPart: _p, ...plain } = node;
  void _c;
  void _p;
  return { ...plain, children: node.children.map(unmarked) };
}

// Why an element cannot become a component, or null when it can (the audit's A3.12: the prompt asks the same question
// the create answers): the page root, an element inside an instance, a locked element, or one inside a locked one.
export function createRefusal(document: DocumentJson, id: NodeId): Message | null {
  const found = locate(document, id);
  if (found === null) return null;
  if (found.parent === null) return message('status.components.root');
  if (instanceRootOf(document, found.node.id as NodeId) !== null) return message('status.components.inInstance', { name: found.node.name });
  if ([...walk(found.node)].some((inner) => inner !== found.node && inner.component !== undefined)) return message('status.components.holdsInstance', { name: found.node.name });
  return lockRefusal(document, found.node.id as NodeId, 'status.locked.edit');
}

// A copy of a tree with new ids (and, given a maker, names no element has), with no instance marks. A copy's name is
// the name a duplicate's copy takes (core/structure/duplicate.ts copyName: a name that ends in a number counts on, so
// "Button 4" copies to "Button 5" and never to "Button 4 2" — the user's real-use audit, item A3.12). The root's name
// is the caller's (an instance is named after its component): `root` leaves it for the caller to set.
export function copied(node: DocNode, next: () => NodeId, make: NodeMaker | null, root = false): DocNode {
  const plain = unmarked(node);
  const name = make === null || root ? plain.name : copyName(plain.name, make.taken);
  if (make !== null && !root) make.taken.add(name);
  const children = node.children.map((child) => copied(child, next, make));
  return { ...plain, id: next(), name, children };
}

// the next free component name: the base, else the base and the first free number from 2
export function componentName(document: DocumentJson, base: string): string {
  const taken = new Set(componentsOf(document).map((c) => c.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export const createComponentCommand = registerHandler('components.create', ({ state, ids }, { name: typed }): Outcome<never> => {
  const primary = state.selection[0];
  const found = primary === undefined ? null : locate(state.document, primary);
  if (found === null) return { kind: 'change' };
  const refusedHere = createRefusal(state.document, found.node.id as NodeId);
  if (refusedHere !== null) return { kind: 'refused', message: refusedHere };
  // the name the prompt asked for (the audit's A3.12), the element's own when it asked for none or typed none
  const asked = typeof typed === 'string' ? typed.trim() : '';
  const name = componentName(state.document, asked === '' ? found.node.name : asked);
  const plainCopy = copied(found.node, () => ids.next() as NodeId, null);
  const definitionTree = refreshCopiedIdentities(state.document, [{ source: found.node, copy: plainCopy }], false)[0];
  if (definitionTree === undefined) throw new Error('components.create: the definition copy is missing');
  const definition: ComponentDefinition = { name, tree: definitionTree };
  const added: Patch = state.document.components === undefined ? { op: 'add', path: ['components'], value: [definition] } : { op: 'add', path: ['components', componentsOf(state.document).length], value: definition };
  return { kind: 'change', patches: [added, { op: 'replace', path: found.path, value: marked(found.node, [], name) }], message: message('status.components.created', { name }) };
});

export const insertInstanceCommand = registerHandler('components.insertInstance', ({ state, ids, rules, words }, { component, parent, index }): Outcome<never> => {
  const definition = componentsOf(state.document).find((c) => c.name === component);
  // every tile stands for a component of the project, so an unknown one is a defect of the door
  if (definition === undefined) throw new Error(`components.insertInstance: the project has no component ${component}`);
  const at = placement(state, state.selection, rules, parent, index);
  if (at === null) throw new Error(`components.insertInstance: the document has no node ${String(parent)}`);
  const receiver = at.parent.node;
  const locked = lockRefusal(state.document, receiver.id, 'status.locked.insert');
  if (locked !== null) return { kind: 'refused', message: locked };
  const make = nodeMaker(state.document, rules, ids, words);
  // the instance is named after its component, with a simple number (the audit's A3.12): "Card", "Card 2", "Card 3"
  const name = copyName(definition.name, make.taken);
  make.taken.add(name);
  const plainCopy = copied(definition.tree, () => ids.next() as NodeId, make, true);
  const copiedTree = refreshCopiedIdentities(state.document, [{ source: definition.tree, copy: plainCopy }])[0];
  if (copiedTree === undefined) throw new Error('components.insertInstance: the instance copy is missing');
  const node = marked({ ...copiedTree, name }, [], definition.name);
  // an instance lies inside no other instance
  const host = instanceRootOf(state.document, receiver.id);
  if (host !== null) return { kind: 'refused', message: message('status.components.inInstance', { name: receiver.name }) };
  const refused = placementRefusal(state.document, rules, receiver.id, [node]);
  if (refused !== null) return { kind: 'refused', message: refused };
  return {
    kind: 'change',
    patches: [{ op: 'add', path: [...at.parent.path, 'children', at.index], value: node }],
    selection: [node.id],
    message: message('status.placed', { element: node.name, parent: receiver.name, position: at.index + 1, count: receiver.children.length + 1 }),
  };
});

export const repeatCommand = registerHandler('components.repeat', ({ state, ids, rules, words }): Outcome<never> => {
  const primary = state.selection[0];
  const found = primary === undefined ? null : locate(state.document, primary);
  if (found === null) return { kind: 'change' };
  if (found.parent === null) return { kind: 'refused', message: message('status.components.root') };
  const patches: Patch[] = [];
  let definition = found.node.component === undefined ? undefined : componentsOf(state.document).find((c) => c.name === found.node.component);
  if (definition === undefined) {
    // not an instance yet: it becomes a component and its first instance, as components.create makes it
    const refusedHere = createRefusal(state.document, found.node.id as NodeId);
    if (refusedHere !== null) return { kind: 'refused', message: refusedHere };
    const name = componentName(state.document, found.node.name);
    const plainCopy = copied(found.node, () => ids.next() as NodeId, null);
    const tree = refreshCopiedIdentities(state.document, [{ source: found.node, copy: plainCopy }], false)[0];
    if (tree === undefined) throw new Error('components.repeat: the definition copy is missing');
    definition = { name, tree };
    patches.push(state.document.components === undefined ? { op: 'add', path: ['components'], value: [definition] } : { op: 'add', path: ['components', componentsOf(state.document).length], value: definition });
    patches.push({ op: 'replace', path: found.path, value: marked(found.node, [], name) });
  } else {
    const locked = lockRefusal(state.document, found.node.id as NodeId, 'status.locked.edit');
    if (locked !== null) return { kind: 'refused', message: locked };
  }
  const receiver = found.parent;
  const lockedParent = lockRefusal(state.document, receiver.id, 'status.locked.insert');
  if (lockedParent !== null) return { kind: 'refused', message: lockedParent };
  const make = nodeMaker(state.document, rules, ids, words);
  const name = copyName(found.node.name, make.taken);
  make.taken.add(name);
  const plainCopy = copied(definition.tree, () => ids.next() as NodeId, make, true);
  const copiedTree = refreshCopiedIdentities(state.document, [{ source: definition.tree, copy: plainCopy }])[0];
  if (copiedTree === undefined) throw new Error('components.repeat: the instance copy is missing');
  const node = marked({ ...copiedTree, name }, [], definition.name);
  const refused = placementRefusal(state.document, rules, receiver.id, [node]);
  if (refused !== null) return { kind: 'refused', message: refused };
  patches.push({ op: 'add', path: [...found.path.slice(0, -1), found.index + 1], value: node });
  // the items the parent holds now: the instances of the component among its children, the new one with them
  const count = receiver.children.filter((child) => child.id === found.node.id || child.component === definition.name).length + 1;
  return { kind: 'change', patches, selection: [node.id], message: message('status.components.repeated', { name: definition.name, count }) };
});

// The fields an item fills (jornada03 J1/C4: the first column went into the image source by position and the whole
// fill failed silently): an element holding text and an image's source, in document order, each named by the
// definition element it comes from.
interface Field {
  readonly part: string;
  readonly name: string;
  readonly image: boolean;
}
function fieldsOf(definition: ComponentDefinition, rules: ModelRules): readonly Field[] {
  const found: Field[] = [];
  const visit = (node: DocNode, part: readonly number[]) => {
    const content = rules.elements.get(node.type)?.content;
    if (node.type === IMAGE) found.push({ part: JSON.stringify(part), name: node.name.trim().toLowerCase(), image: true });
    else if (content === 'text' && node.children.length === 0) found.push({ part: JSON.stringify(part), name: node.name.trim().toLowerCase(), image: false });
    node.children.forEach((child, index) => visit(child, [...part, index]));
  };
  visit(definition.tree, []);
  return found;
}

// What a cell names as an image: a file of the project by its path, a project image by its file name (any case, with
// or without its extension: "graos.png" or "graos" for img/graos.png), or an address of the web; null for anything
// else.
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/iu;
const WEB_ADDRESS = /^https?:\/\//iu;
export function imageSource(document: DocumentJson, value: string): string | null {
  const typed = value.trim();
  if (typed === '') return null;
  if (isProjectPath(document, typed)) return typed;
  const lowered = typed.toLowerCase();
  const named = imageFiles(document).find((file) => {
    const name = (file.path.split('/').pop() ?? '').toLowerCase();
    return name === lowered || name.replace(/\.[^.]+$/u, '') === lowered;
  });
  if (named !== undefined) return named.path;
  return WEB_ADDRESS.test(typed) && readAddress(typed).ok ? typed : null;
}

// Which column each field takes, the same for every row: the column named like the field (any case), else the next
// column not taken yet of the field's kind (a column whose every filled cell names an image goes to images, any other
// to texts), in the columns' order.
function columnsOf(fields: readonly Field[], rows: readonly DataRow[], document: DocumentJson): ReadonlyMap<string, number> {
  const names = (rows[0]?.names ?? []).map((name) => name.trim().toLowerCase());
  const width = Math.max(names.length, ...rows.map((row) => row.values.length));
  const imageColumn = (column: number): boolean => {
    const cells = rows.map((row) => (row.values[column] ?? '').trim()).filter((cell) => cell !== '');
    return cells.length > 0 && cells.every((cell) => imageSource(document, cell) !== null || IMAGE_NAME.test(cell));
  };
  const kinds = Array.from({ length: width }, (_, column) => imageColumn(column));
  const taken = new Set<number>();
  const chosen = new Map<string, number>();
  for (const field of fields) {
    const named = field.name === '' ? -1 : names.indexOf(field.name);
    if (named >= 0 && !taken.has(named)) {
      taken.add(named);
      chosen.set(field.part, named);
    }
  }
  for (const field of fields) {
    if (chosen.has(field.part)) continue;
    const next = kinds.findIndex((image, column) => image === field.image && !taken.has(column));
    if (next < 0) continue;
    taken.add(next);
    chosen.set(field.part, next);
  }
  return chosen;
}

// An item filled with a row: each field takes its column's cell; a field the row has no value for keeps its own. An
// image cell that names no image of the project nor of the web is refused, naming the row, the column and the cell,
// before any patch (never a source the model refuses).
function filled(item: DocNode, row: DataRow, at: number, columns: ReadonlyMap<string, number>, document: DocumentJson, rules: ModelRules): DocNode | Message {
  let refusal: Message | null = null;
  const visit = (node: DocNode): DocNode => {
    const content = rules.elements.get(node.type)?.content;
    const column = columns.get(JSON.stringify(node.componentPart ?? []));
    const value = column === undefined ? undefined : row.values[column];
    let next: DocNode = node;
    if (node.type === IMAGE) {
      if (value !== undefined && value.trim() !== '') {
        const source = imageSource(document, value);
        if (source === null) refusal ??= message('status.data.imageNotFound', { row: at + 1, column: row.names[column ?? 0] || String((column ?? 0) + 1), value: value.trim() });
        else next = { ...node, attributes: { ...node.attributes, src: source } };
      }
    } else if (content === 'text' && node.children.length === 0 && value !== undefined) {
      next = { ...node, text: value };
    }
    return { ...next, children: next.children.map(visit) };
  };
  const result = visit(item);
  return refusal ?? result;
}
const IMAGE = 'image';
const isMessage = (value: DocNode | Message): value is Message => !('children' in value);

export const fillFromDataCommand = registerHandler('components.fillFromData', ({ state, ids, rules, words }, { path }): Outcome<never> => {
  const primary = state.selection[0];
  const found = primary === undefined ? null : locate(state.document, primary);
  if (found === null || found.parent === null || found.node.component === undefined) return { kind: 'refused', message: message('status.components.notInstance') };
  const definition = componentsOf(state.document).find((c) => c.name === found.node.component);
  if (definition === undefined) return { kind: 'refused', message: message('status.components.notInstance') };
  const file = fileAt(state.document, path);
  const rows = file === null ? null : dataRows(file);
  if (rows === null) return { kind: 'refused', message: message('status.data.unreadable', { path }) };
  const parent = found.parent;
  const lockedParent = lockRefusal(state.document, parent.id, 'status.locked.edit');
  if (lockedParent !== null) return { kind: 'refused', message: lockedParent };
  const parentPath = found.path.slice(0, -1);
  const items = parent.children.map((child, index) => ({ child, index })).filter(({ child }) => child.component === definition.name);
  const columns = columnsOf(fieldsOf(definition, rules), rows, state.document);
  const patches: Patch[] = [];
  for (const [i, { child, index }] of items.entries()) {
    const row = rows[i];
    if (row === undefined) continue;
    const next = filled(child, row, i, columns, state.document, rules);
    if (isMessage(next)) return { kind: 'refused', message: next };
    if (!deepEqual(next, child)) patches.push({ op: 'replace', path: [...parentPath, index], value: next });
  }
  // rows beyond the items: new items after the last one, each a fresh instance filled with its row
  const last = items.at(-1)?.index ?? found.index;
  const make = nodeMaker(state.document, rules, ids, words);
  let before = found.node.name;
  for (const [i, row] of rows.slice(items.length).entries()) {
    const name = copyName(before, make.taken);
    make.taken.add(name);
    before = name;
    const plainCopy = copied(definition.tree, () => ids.next() as NodeId, make, true);
    const tree = refreshCopiedIdentities(state.document, [{ source: definition.tree, copy: plainCopy }])[0];
    if (tree === undefined) throw new Error('components.fillFromData: the instance copy is missing');
    const next = filled(marked({ ...tree, name }, [], definition.name), row, items.length + i, columns, state.document, rules);
    if (isMessage(next)) return { kind: 'refused', message: next };
    patches.push({ op: 'add', path: [...parentPath, last + 1 + i], value: next });
  }
  return { kind: 'change', patches, message: message('status.data.filled', { name: definition.name, count: rows.length, path }) };
});

// the one selected element is an instance's root
export const instanceSelected = registerPredicate('instanceSelected', (state) => {
  const [only, ...others] = state.selection;
  return only !== undefined && others.length === 0 && locate(state.document, only)?.node.component !== undefined;
});

export const detachInstanceCommand = registerHandler('components.detach', ({ state }): Outcome<never> => {
  const primary = state.selection[0];
  const found = primary === undefined ? null : locate(state.document, primary);
  if (found === null || found.node.component === undefined) return { kind: 'change' };
  return { kind: 'change', patches: [{ op: 'replace', path: found.path, value: unmarked(found.node) }], message: message('status.components.detached', { name: found.node.name }) };
});

// components.updateFromInstance (the plan's stage 7, "modo de edição do mestre"; journey D2): an instance edited in
// place — elements added, removed or moved, styles of its own — becomes its component's definition, and every other
// instance of the component takes the new structure and styles, keeping its own texts, attributes and names wherever an
// element of the edited instance came from one it has (the same part); one undo step. The edited instance is the
// master while it is edited; nothing else changes until this command runs.
export const updateFromInstanceCommand = registerHandler('components.updateFromInstance', ({ state, ids }): Outcome<never> => {
  const primary = state.selection[0];
  const source = primary === undefined ? null : instanceRootOf(state.document, primary);
  if (source === null || source.component === undefined) return { kind: 'refused', message: message('status.components.notInstance') };
  const name = source.component;
  const index = componentsOf(state.document).findIndex((c) => c.name === name);
  if (index < 0) return { kind: 'refused', message: message('status.components.notInstance') };
  const next = () => ids.next() as NodeId;
  // the new definition: the edited instance, plain, with ids of its own
  const definitionTree = copied(source, next, null, true);
  const taken = new Set(state.document.pages.flatMap((page) => [...walk(page.tree)].map((one) => one.name)));
  // an instance rebuilt on the edited one's structure: each element keeps the id, name, text and attributes of the
  // instance's element of the part it came from, else a new id
  // each element of another instance is kept once: two elements of the edited instance with the same part (one
  // duplicated inside it) would both take its id (the random probe found the ids twice)
  const kept = new Set<string>();
  const rebuilt = (from: DocNode, instance: DocNode | null): DocNode => {
    const ownPart = from.componentPart;
    const mine = instance === null || ownPart === undefined ? undefined : [...walk(instance)].find((one) => one.componentPart !== undefined && deepEqual(one.componentPart, ownPart) && !kept.has(one.id));
    if (mine !== undefined) kept.add(mine.id);
    const plain = unmarked({ ...from, children: [] });
    // an element new to the edited instance reaches the others as a copy does: a new id and a name no element has
    const element =
      mine === undefined
        ? instance === null
          ? plain
          : { ...plain, id: next(), name: copyName(plain.name, taken) }
        : { ...plain, id: mine.id, name: mine.name, text: mine.text, attributes: mine.attributes };
    if (mine === undefined && instance !== null) taken.add(element.name);
    return { ...element, children: from.children.map((child) => rebuilt(child, instance)) };
  };
  const patches: Patch[] = [{ op: 'replace', path: ['components', index, 'tree'], value: definitionTree }];
  let count = 0;
  const visit = (at: DocNode, atPath: (string | number)[]) => {
    if (at.component === name) {
      const tree = at.id === source.id ? rebuilt(source, null) : rebuilt(source, at);
      patches.push({ op: 'replace', path: atPath, value: marked({ ...tree, name: at.name }, [], name) });
      if (at.id !== source.id) count += 1;
      return;
    }
    at.children.forEach((child, i) => visit(child, [...atPath, 'children', i]));
  };
  state.document.pages.forEach((page, i) => visit(page.tree, ['pages', i, 'tree']));
  return { kind: 'change', patches, message: message('status.components.updated', { name, count }) };
});

export const insideInstance = registerPredicate('insideInstance', (state) => {
  const [only, ...others] = state.selection;
  return only !== undefined && others.length === 0 && instanceRootOf(state.document, only) !== null;
});

// Variants (the plan's stage 7, "variantes"; journey D2): a component's variant is a class named after it with the
// variant as a BEM modifier (component Plan, variant gold: .plan--gold), holding the styles in which the variant
// differs; an instance chooses one by listing its class on its root. The one owner of:
//  - variantBase / variantsOf: the modifier's base for a component, and the variants the project's classes give it;
//  - components.setVariant: the selected instance (its root) lists the variant's class and no other variant of its
//    component — a variant the project lacks is made, empty, to be styled with the class as the target; an empty
//    variant takes every variant off; one undo step.
export function variantBase(component: string): string {
  const slug = component.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `c-${slug}`;
}
export function variantsOf(document: DocumentJson, component: string): readonly string[] {
  const prefix = `${variantBase(component)}--`;
  return (document.classes ?? []).filter((one) => one.name.startsWith(prefix)).map((one) => one.name.slice(prefix.length));
}

export const setVariantCommand = registerHandler('components.setVariant', ({ state }, { variant }): Outcome<never> => {
  const primary = state.selection[0];
  const root = primary === undefined ? null : instanceRootOf(state.document, primary);
  if (root === null || root.component === undefined) return { kind: 'refused', message: message('status.components.notInstance') };
  const found = locate(state.document, root.id as NodeId);
  if (found === null) return { kind: 'change' };
  const typed = variant.trim().toLowerCase();
  if (typed !== '' && !/^[a-z][a-z0-9-]*$/.test(typed)) return { kind: 'refused', message: message('status.components.badVariant', { variant: variant.trim() }) };
  const locked = lockRefusal(state.document, root.id as NodeId, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const prefix = `${variantBase(root.component)}--`;
  const className = `${prefix}${typed}`;
  const classes = [...root.classes.filter((one) => !one.startsWith(prefix)), ...(typed === '' ? [] : [className])];
  const patches: Patch[] = [];
  const held = state.document.classes ?? [];
  if (typed !== '' && !held.some((one) => one.name === className)) {
    patches.push(state.document.classes === undefined ? { op: 'add', path: ['classes'], value: [{ name: className, styles: {} }] } : { op: 'add', path: ['classes', held.length], value: { name: className, styles: {} } });
  }
  if (!deepEqual(classes, root.classes)) patches.push({ op: 'replace', path: [...found.path, 'classes'], value: classes });
  return { kind: 'change', patches, message: typed === '' ? message('status.components.variantCleared', { name: root.name }) : message('status.components.variantSet', { name: root.name, variant: typed }) };
});

// a component an argument names (manifest refers: component), by its name
registerReferenceKind('component', (document, name) => componentsOf(document).some((definition) => definition.name === name));

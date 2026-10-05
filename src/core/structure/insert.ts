// element.insert (INVENTORY.md, owners): a new element of a palette entry, placed where the arguments say
// or, without them, where the selection says (spec palette-click-insert, "Hit zones"): with nothing selected, the last
// child of the shown page's root; with a container selected, its last child; with a leaf selected, right after it in
// its parent. The placement follows the content model (src/core/elements/content-model.ts): a parent that does not
// accept the element refuses it and nothing changes, never wrapped in another element (spec, Problems 1 and 2), and so
// does a Link Block, or an element inside one, for an interactive element (spec elements-structure, Problems 5); so
// does a locked parent or one inside a locked element (spec lock-element). The
// new element is named by its type in the person's language, with a number when a node already has that name, holds
// its default text and styles (elements.json), and becomes the selection.
import type { NodeId } from '../../generated/commands.ts';
import type { ElementType, MessageId } from '../../generated/ids.ts';
import type { TemplateNode } from '../../manifest/schema.ts';
import type { WrapperId } from '../document/validate.ts';
import { message, registerHandler, registerPredicate, type Message, type Outcome } from '../commands/registry.ts';
import { allNodes, locate, walk, type DocNode, type DocumentJson, type Location, type Selection, type Styles } from '../document/model.ts';
import { releaseReferencesPatch } from '../document/tree.ts';
import type { ModelRules } from '../document/validate.ts';
import { placementRefusal } from '../elements/content-model.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { pageShown } from '../project/pages.ts';
import { startingParts } from '../elements/table.ts';
import { COLUMNS_PROPERTY, tracksForChildren } from '../style/tracks.ts';
import { registerReferenceKind } from '../store/references.ts';
import { newElement, nodeMaker, type NodeMaker } from './node-maker.ts';

// A name no node of the document has: the base itself, else the base followed by the first free number from 2.
export function uniqueName(document: DocumentJson, base: string): string {
  const taken = new Set<string>();
  for (const node of allNodes(document)) taken.add(node.name);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

// The tree a template inserts (elements.json palette entries of kind "template"; features templates-layout,
// templates-content, templates-sections, templates-components): each node a new element of its type, then given the
// template's tag, name and text (catalogue keys, in the person's language), the styles of its wrapper (the wrap
// commands' Row, Column, Container and Grid, so a template's layout is the wrap commands' layout) and its own, its
// attributes, and its children (when the template names none, the parts a new element of its type starts with: a
// table's head and body, else its natural children). The root is named by the template's label. A wrapper that lays
// one equal track per child (the grid) writes grid-template-columns for the children it holds, with its breakpoint
// overrides (the same rule the wrap command writes: tracksForChildren, the user's real-use audit item A1.4).
function templateElement(make: NodeMaker, spec: TemplateNode, rootNameKey?: MessageId): DocNode {
  const { rules } = make;
  const nameKey = (spec.nameKey as MessageId | undefined) ?? rootNameKey;
  const base = newElement(make, spec.element, spec.children === undefined ? startingParts(spec.element) : (m) => (spec.children ?? []).map((child) => templateElement(m, child)), nameKey);
  const wrapper = spec.wrapper === undefined ? undefined : rules.wrappers.get(spec.wrapper as WrapperId);
  const perChild = wrapper?.perChildTracks === true ? tracksForChildren(base.children.length, rules) : null;
  const styles = { ...(rules.elements.get(spec.element as ElementType)?.defaultStyles ?? {}), ...(wrapper?.styles ?? {}), ...(spec.styles ?? {}), ...(perChild === null ? {} : { [perChild.property]: perChild.columns }) };
  const layer = (held: Readonly<Record<string, string>>): Record<string, Readonly<Record<string, string>>> => ({ [rules.baseLayer.state]: held });
  const all = {
    ...(Object.keys(styles).length > 0 ? { [rules.baseLayer.breakpoint]: layer(styles) } : {}),
    ...Object.fromEntries(Object.entries(perChild?.layers ?? {}).map(([breakpoint, columns]) => [breakpoint, layer({ [perChild?.property ?? '']: columns })])),
  } as Styles;
  return {
    ...base,
    tag: spec.tag ?? base.tag,
    text: spec.textKey === undefined ? base.text : make.words(spec.textKey as MessageId),
    styles: all,
    attributes: { ...base.attributes, ...(spec.attributes ?? {}) } as DocNode['attributes'],
  };
}

// element.createNaturalChild (feature natural-child-command): a new natural child inside the one selected element
// (elements.json naturalChild), where HTML's permitted order puts it (after the children that come before it or with
// it, so the last of its kind): the first of its natural children that the element may hold only once and lacks (a
// figure's caption), else the first it may hold many of (a list's item, a table body's row); refused when it has none
// (status.naturalChild.none) or holds every one it may hold once and no other (status.naturalChild.present: a details'
// summary). One undo step; the new child becomes the selection; a locked element refuses. The context menu's label
// names the tag it creates ("Create <li> inside").
function naturalChildToCreate(state: { readonly document: DocumentJson; readonly selection: Selection }, rules: ModelRules): { readonly at: Location; readonly type: string | null } | null {
  const [only, ...others] = state.selection;
  if (only === undefined || others.length > 0) return null;
  const at = locate(state.document, only);
  const natural = at === null ? [] : (rules.elements.get(at.node.type)?.naturalChildren ?? []);
  if (at === null || natural.length === 0) return null;
  const tagOf = (type: string) => rules.elements.get(type as ElementType)?.tags[0] ?? '';
  const holds = (type: string) => at.node.children.some((child) => child.type === type);
  const once = natural.filter((type) => rules.contentModel.unique(at.node.tag ?? '', tagOf(type)));
  const missing = once.find((type) => !holds(type));
  const many = natural.find((type) => !once.includes(type));
  return { at, type: missing ?? many ?? null };
}

// why the selected element takes no new natural child: it has none, or it holds each of them it may hold once
function naturalRefusal(state: { readonly document: DocumentJson; readonly selection: Selection }, rules: ModelRules): Message {
  const [only] = state.selection;
  const at = only === undefined ? null : locate(state.document, only);
  const natural = at === null ? [] : (rules.elements.get(at.node.type)?.naturalChildren ?? []);
  if (at === null || natural.length === 0) return message('status.naturalChild.none', { name: at?.node.name ?? '' });
  const first = rules.elements.get(natural[0] as ElementType)?.tags[0] ?? '';
  return message('status.naturalChild.present', { parent: at.node.name, child: `<${first}>` });
}

export const hasNaturalChild = registerPredicate(
  'hasNaturalChild',
  (state, rules) => naturalChildToCreate(state, rules)?.type != null,
  (state, rules) => naturalRefusal(state, rules),
);

export const createNaturalChildCommand = registerHandler(
  'element.createNaturalChild',
  ({ state, rules, ids, words }): Outcome<never> => {
    const found = naturalChildToCreate(state, rules);
    if (found === null || found.type === null) return { kind: 'refused', message: naturalRefusal(state, rules) };
    const { at, type } = found;
    const locked = lockRefusal(state.document, at.node.id, 'status.locked.insert');
    if (locked !== null) return { kind: 'refused', message: locked };
    const node = newElement(nodeMaker(state.document, rules, ids, words), type);
    const index = rules.contentModel.slotIn(at.node.tag ?? '', at.node.children.map((c) => c.tag ?? ''), node.tag ?? '');
    return {
      kind: 'change',
      patches: [{ op: 'add', path: [...at.path, 'children', index], value: node }],
      selection: [node.id],
      message: message('status.placed', { element: node.name, parent: at.node.name, position: index + 1, count: at.node.children.length + 1 }),
    };
  },
);
createNaturalChildCommand.labelParams = (state, rules) => {
  const type = naturalChildToCreate(state, rules)?.type;
  const tag = type == null ? '' : (rules.elements.get(type as ElementType)?.tags[0] ?? '');
  return { tag: tag === '' ? '' : `<${tag}>` };
};

// Where the new element goes: the parent and the index among its children; null when the parent given is no node.
// With nothing selected the element goes at the end of the root of the page the editor shows (openedPage, its one
// owner), never of the project's first page: an insert with another page open lands on that page. A page block coming
// in (`incoming`: a section, a header, a footer; elements.json pageBlock) lands right after the page block that is or
// holds the selection, so a page is built by clicking its blocks in order (spec palette-click-insert, Problems 4).
export function placement(
  state: { readonly document: DocumentJson; readonly ui?: unknown },
  selection: Selection,
  rules: ModelRules,
  parent: NodeId | undefined,
  index: number | undefined,
  incoming?: DocNode
): { readonly parent: Location; readonly index: number } | null {
  const document = state.document;
  const root = pageShown(state)?.tree ?? null;
  if (parent !== undefined) {
    const at = locate(document, parent);
    if (!at) return null;
    const count = at.node.children.length;
    return { parent: at, index: index === undefined ? count : Math.max(0, Math.min(index, count)) };
  }
  const primary = selection[0] === undefined ? null : locate(document, selection[0]);
  const isBlock = (node: DocNode): boolean => rules.elements.get(node.type)?.pageBlock === true;
  if (primary && incoming !== undefined && isBlock(incoming)) {
    let at: Location | null = primary;
    while (at !== null && !isBlock(at.node)) at = at.parent === null ? null : locate(document, at.parent.id);
    const up = at?.parent ? locate(document, at.parent.id) : null;
    if (at && up) return { parent: up, index: at.index + 1 };
  }
  if (primary && rules.elements.get(primary.node.type)?.content === 'children') return { parent: primary, index: primary.node.children.length };
  if (primary?.parent) {
    const up = locate(document, primary.parent.id);
    if (up) return { parent: up, index: primary.index + 1 };
  }
  const at = root === null ? null : locate(document, root.id);
  return at === null ? null : { parent: at, index: at.node.children.length };
}

// The new node of a palette entry (elements.json palette): a template's tree, else a new element of the entry's type
// with the parts it starts with; an input tile's node takes its kind of input (the attribute inputType, written type).
export function paletteNode(make: NodeMaker, entry: string): DocNode {
  const item = make.rules.palette.get(entry);
  // every door offers an entry of the palette, so an unknown one is a defect of the door
  if (item === undefined || make.rules.elements.get(item.element) === undefined) throw new Error(`the palette has no entry ${entry}`);
  const made = item.template === null ? newElement(make, item.element, startingParts(item.element)) : templateElement(make, item.template, item.labelKey);
  return item.inputType === null ? made : { ...made, attributes: { ...made.attributes, inputType: item.inputType } };
}

// A new element takes the classes every sibling of its kind already shares (the plan's stage 7, "novo elemento herda o
// visual dos irmãos"; journey C3: a new link in a menu of styled links came out plain): the classes common to all the
// receiver's children of the same type, when there is at least one such child and they share any.
function withSiblingClasses(node: DocNode, siblings: readonly DocNode[]): DocNode {
  const kin = siblings.filter((one) => one.type === node.type);
  if (kin.length === 0 || node.classes.length > 0) return node;
  const [first, ...rest] = kin as [DocNode, ...DocNode[]];
  const shared = first.classes.filter((name) => rest.every((one) => one.classes.includes(name)));
  return shared.length === 0 ? node : { ...node, classes: shared };
}

// The first empty cell of a grid, which an element placed at the grid's end takes instead (the audit's AUD-20: Insert ›
// Grid, then Insert › Card, left the grid's three empty cells above the card): a child of a parent that writes its
// columns (a grid: the Grid template's, the grid wrapper's) that is a container holding nothing, untouched — no styles,
// classes or attributes of its own, neither locked, hidden nor a component's. -1 when the parent has none.
function emptyCell(parent: DocNode, rules: ModelRules): number {
  const base = (parent.styles as Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>)[rules.baseLayer.breakpoint]?.[rules.baseLayer.state];
  if (base?.[COLUMNS_PROPERTY] === undefined) return -1;
  const untouched = (child: DocNode): boolean =>
    rules.elements.get(child.type)?.content === 'children' &&
    child.children.length === 0 &&
    Object.keys(child.styles).length === 0 &&
    child.classes.length === 0 &&
    Object.keys(child.attributes).length === 0 &&
    child.locked !== true &&
    child.hidden !== true &&
    child.component === undefined &&
    child.componentPart === undefined;
  return parent.children.findIndex(untouched);
}

export const insertCommand = registerHandler('element.insert', ({ state, ids, rules, words }, { entry, parent, index }): Outcome<never> => {
  const node = paletteNode(nodeMaker(state.document, rules, ids, words), entry);
  const at = placement(state, state.selection, rules, parent, index, node);
  if (at === null) throw new Error(`element.insert: the document has no node ${String(parent)}`);
  const receiver = at.parent.node;
  // a locked parent, or one inside a locked element, takes no new child (spec lock-element)
  const locked = lockRefusal(state.document, receiver.id, 'status.locked.insert');
  if (locked !== null) return { kind: 'refused', message: locked };
  // the one rule of where elements may go (content-model.ts placementRefusal): the same for every door that inserts
  const refused = placementRefusal(state.document, rules, receiver.id, [node]);
  if (refused !== null) return { kind: 'refused', message: refused };
  const placed = withSiblingClasses(node, receiver.children);
  // placed at a grid's end with no place asked for: it takes the grid's first empty cell (emptyCell)
  const cell = index === undefined && at.index === receiver.children.length ? emptyCell(receiver, rules) : -1;
  if (cell >= 0) {
    const path = [...at.parent.path, 'children', cell];
    // the cell leaves: what pointed at it lets go in the same change (the audit's RF2), as a delete releases it
    const replaced = receiver.children[cell];
    const leaving = new Set(replaced === undefined ? [] : [...walk(replaced)].map((one) => one.id as NodeId));
    return {
      kind: 'change',
      patches: [...releaseReferencesPatch(state.document, leaving), { op: 'remove', path }, { op: 'add', path, value: placed }],
      selection: [node.id],
      message: message('status.placed', { element: node.name, parent: receiver.name, position: cell + 1, count: receiver.children.length }),
    };
  }
  return {
    kind: 'change',
    patches: [{ op: 'add', path: [...at.parent.path, 'children', at.index], value: placed }],
    selection: [node.id],
    message: message('status.placed', { element: node.name, parent: receiver.name, position: at.index + 1, count: receiver.children.length + 1 }),
  };
});

// an entry of the palette an argument names (manifest refers: palette-entry)
registerReferenceKind('palette-entry', (_document, entry, rules) => rules.palette.has(entry));

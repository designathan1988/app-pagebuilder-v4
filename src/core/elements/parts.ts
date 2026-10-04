// parts.toggle (INVENTORY.md, owners; feature elements-tables): the optional parts of the selected table
// (the table itself or any node inside it): its caption, its head and its foot. A part the table lacks is added in its
// place (the caption first, the head after the caption, the foot last), with a row of as many cells as the table has
// columns (header cells in the head); a part it has is removed with what it holds. A table has at most one of each, so
// the toggle is always one of the two. One undo step; a locked table refuses (spec lock-element).
import { message, registerHandler, type Outcome } from '../commands/registry.ts';
import { locate, type DocNode, type DocumentJson } from '../document/model.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { newElement, nodeMaker } from '../structure/node-maker.ts';
import { newRow } from './table.ts';
import { geometryAttributes, shapeGeometry, sizeForShapes, svgMarkupOf } from './svg.ts';
import { resizeCommand } from '../geometry/resize.ts';
import { argumentRefused } from '../store/args.ts';
import { releaseReferencesPatch, subtreeIds } from '../document/tree.ts';

const TABLE = 'table';
const CAPTION = 'caption';
const HEAD = 'tableHead';

function tableOf(document: DocumentJson, selection: readonly string[]) {
  const [only, ...others] = selection;
  if (only === undefined || others.length > 0) return null;
  for (let at = locate(document, only); at !== null; at = at.parent === null ? null : locate(document, at.parent.id)) if (at.node.type === TABLE) return at;
  return null;
}

// the number of columns: the most cells of any row of the table
function columns(table: DocNode): number {
  return Math.max(1, ...table.children.flatMap((group) => group.children.map((row) => (row.type === 'tableRow' ? row.children.length : 0))));
}

// where a part goes among the table's children: the caption first, the head after the caption, the foot last
function slotOf(table: DocNode, type: string): number {
  if (type === CAPTION) return 0;
  if (type === HEAD) return table.children[0]?.type === CAPTION ? 1 : 0;
  return table.children.length;
}

export const togglePartCommand = registerHandler('parts.toggle', ({ state, rules, ids, words }, { type }): Outcome<never> => {
  const table = tableOf(state.document, state.selection);
  if (table === null) return { kind: 'refused', message: message('status.table.selectPart') };
  const locked = lockRefusal(state.document, table.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const index = table.node.children.findIndex((child) => child.type === type);
  if (index >= 0) {
    const part = table.node.children[index] as DocNode;
    // what pointed into the part goes with it, in the same undo step, as parts.remove and a delete release it (RF1)
    const released = releaseReferencesPatch(state.document, subtreeIds(part));
    return { kind: 'change', patches: [...released, { op: 'remove', path: [...table.path, 'children', index] }], selection: [table.node.id], message: message('status.table.partRemoved', { part: part.name, table: table.node.name }) };
  }
  const make = nodeMaker(state.document, rules, ids, words);
  const part = type === CAPTION ? newElement(make, CAPTION) : newElement(make, type, (m) => [newRow(m, type, columns(table.node))]);
  return {
    kind: 'change',
    patches: [{ op: 'add', path: [...table.path, 'children', slotOf(table.node, type)], value: part }],
    selection: [table.node.id],
    message: message('status.table.partAdded', { part: part.name, table: table.node.name }),
  };
},
  // a toggle stands for the part: pressed while the selected table holds it
  (state, args) => tableOf(state.document, state.selection)?.node.children.some((child) => child.type === args.type) === true,
);

// The parts an element's editor lists and adds (parts.add, parts.move, parts.remove; features elements-form-controls,
// elements-media-images, elements-media-embeds): the children an element's permitted content names by tag (a
// <select>'s options and option groups, an <optgroup>'s options, a <picture>'s sources, a <video>'s or an <audio>'s
// sources and tracks, an <svg>'s shapes). parts.add adds a new one to the one selected element, where HTML's permitted
// order puts it (a shape with its geometry inside its SVG, core/elements/svg.ts);
// parts.move moves a part one place up or down among its parent's children; parts.remove removes it. The selection
// stays on the element whose parts are edited. A locked element, or one inside a locked element, refuses.
function selectedOne(document: DocumentJson, selection: readonly string[]) {
  const [only, ...others] = selection;
  return only === undefined || others.length > 0 ? null : locate(document, only);
}

export const addPartCommand = registerHandler('parts.add', ({ state, rules, ids, words }, { type }): Outcome<never> => {
  const at = selectedOne(state.document, state.selection);
  if (at === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const part = rules.elements.get(type);
  const parentTag = at.node.tag ?? '';
  const partTag = part?.tags[0] ?? '';
  if (part === undefined || !rules.contentModel.names(parentTag, partTag)) return { kind: 'refused', message: message('status.refused.noChildren', { parent: at.node.name }) };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.insert');
  if (locked !== null) return { kind: 'refused', message: locked };
  // an SVG that draws a pasted markup holds no shape parts: its content has one owner at a time (the audit's A3.6)
  if (parentTag === 'svg' && svgMarkupOf(at.node) !== '') return { kind: 'refused', message: message('status.svg.holdsMarkup', { name: at.node.name }) };
  const made = newElement(nodeMaker(state.document, rules, ids, words), type);
  // a shape of an SVG takes its geometry inside it (spec elements-svg-shapes)
  const geometry = geometryAttributes(rules, type, resizeCommand.command);
  const size = geometry.length > 0 ? sizeForShapes(at.node, rules) : null;
  const node = size === null ? made : { ...made, attributes: { ...made.attributes, ...shapeGeometry(partTag, geometry, size) } };
  const index = rules.contentModel.slotIn(parentTag, at.node.children.map((c) => c.tag ?? ''), partTag);
  return { kind: 'change', patches: [{ op: 'add', path: [...at.path, 'children', index], value: node }], selection: [at.node.id], message: message('status.parts.added', { part: node.name, name: at.node.name }) };
});

export const movePartCommand = registerHandler('parts.move', ({ state }, { target, delta }): Outcome<never> => {
  const at = locate(state.document, target);
  if (at === null || at.parent === null) return { kind: 'refused', message: argumentRefused('target') };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.move');
  if (locked !== null) return { kind: 'refused', message: locked };
  const to = Math.max(0, Math.min(at.parent.children.length - 1, at.index + delta));
  const said = message('status.parts.moved', { part: at.node.name, position: to + 1, count: at.parent.children.length });
  if (to === at.index) return { kind: 'change', message: said };
  const parentPath = at.path.slice(0, -1);
  return { kind: 'change', patches: [{ op: 'remove', path: at.path }, { op: 'add', path: [...parentPath, to], value: at.node }], selection: [at.parent.id], message: said };
});

export const removePartCommand = registerHandler('parts.remove', ({ state }, { target }): Outcome<never> => {
  const at = locate(state.document, target);
  if (at === null || at.parent === null) return { kind: 'refused', message: argumentRefused('target') };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  // what pointed at the part or inside it goes with it, in the same undo step, as a delete does (a label's for, a
  // motion action's target: the random probe found a timeline left acting on a removed part)
  const released = releaseReferencesPatch(state.document, subtreeIds(at.node));
  return { kind: 'change', patches: [...released, { op: 'remove', path: at.path }], selection: [at.parent.id], message: message('status.parts.removed', { part: at.node.name, name: at.parent.name }) };
});

// The part types the selected element's editor adds (the parts.add doors whose type its permitted content names).
export function partTypesOf(rules: { readonly elements: ReadonlyMap<string, { readonly tags: readonly (string | null)[] }>; readonly contentModel: { names(p: string, c: string): boolean } }, node: DocNode): (type: string) => boolean {
  return (type) => rules.contentModel.names(node.tag ?? '', rules.elements.get(type)?.tags[0] ?? '');
}

// Whether the one selected node is a table or inside one (the Settings tab draws the part toggles then).
export function selectionInTable(document: DocumentJson, selection: readonly string[]): boolean {
  return tableOf(document, selection) !== null;
}

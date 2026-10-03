// Tables (INVENTORY.md, owners; features elements-tables and table-commands): the parts a new table starts
// with, and the commands that add and remove its columns and rows. A table is a <table> holding, in order, an optional
// caption, an optional head (thead), one body (tbody) and an optional foot (tfoot); each group holds rows (tr) and each
// row cells: header cells (th) in the head, cells (td) elsewhere. Every cell holds a paragraph, so its text is edited
// like any text. The caption, head and foot are added and removed by parts.toggle (core/elements/parts.ts).
//  - A new table (element.insert of the Table tile) holds a head row of two header cells and a body of two rows of two
//    cells.
//  - table.addColumnAfter / table.removeColumn act on the column of the one selected cell (or the cell holding the
//    selection); table.addColumnEnd on the table of the selection. A column is the cell at the same index of every row
//    of the table; a new one is a header cell in head rows and a cell elsewhere. The last column is never removed
//    (status.table.lastColumn).
//  - table.addRowAfter adds after the selected cell's row a row of the same number of cells, empty; table.removeRow
//    removes that row, except the last row of a body (status.table.lastRow).
//  - A locked table, or one inside a locked element, refuses every change (spec lock-element).
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, registerPredicate, type Outcome } from '../commands/registry.ts';
import { locate, type DocNode, type DocumentJson, type Location } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { newElement, nodeMaker, type NodeMaker } from '../structure/node-maker.ts';

const TABLE = 'table';
const HEAD = 'tableHead';
const BODY = 'tableBody';
const FOOT = 'tableFoot';
const ROW = 'tableRow';
const HEADER_CELL = 'headerCell';
const CELL = 'cell';
const GROUPS = new Set([HEAD, BODY, FOOT]);
const CELLS = new Set([HEADER_CELL, CELL]);

// a row of `count` cells of the group's kind (header cells in a head), each holding its paragraph
export function newRow(make: NodeMaker, group: string, count: number): DocNode {
  const kind = group === HEAD ? HEADER_CELL : CELL;
  return newElement(make, ROW, (m) => Array.from({ length: count }, () => newElement(m, kind)));
}

// The parts a new element of a type starts with instead of its natural children, or undefined: a table's head row of
// two header cells and its body of two rows of two cells.
export function startingParts(type: string): ((make: NodeMaker) => DocNode[]) | undefined {
  if (type !== TABLE) return undefined;
  return (make) => [newElement(make, HEAD, (m) => [newRow(m, HEAD, 2)]), newElement(make, BODY, (m) => [newRow(m, BODY, 2), newRow(m, BODY, 2)])];
}

interface CellAt {
  readonly table: Location;
  readonly group: Location;
  readonly row: Location;
  readonly cell: Location;
}

// the nearest ancestor-or-self of a node whose type is one of `types`
function upTo(document: DocumentJson, id: NodeId, types: ReadonlySet<string>): Location | null {
  for (let at = locate(document, id); at !== null; at = at.parent === null ? null : locate(document, at.parent.id)) if (types.has(at.node.type)) return at;
  return null;
}

// the cell holding the one selected node (itself a cell, or inside one), with its row, group and table
function selectedCell(state: { readonly document: DocumentJson; readonly selection: readonly NodeId[] }): CellAt | null {
  const [only, ...others] = state.selection;
  if (only === undefined || others.length > 0) return null;
  const cell = upTo(state.document, only, CELLS);
  const row = cell?.parent ? locate(state.document, cell.parent.id) : null;
  const group = row?.parent ? locate(state.document, row.parent.id) : null;
  const table = group?.parent ? locate(state.document, group.parent.id) : null;
  if (cell === null || row === null || group === null || table === null || !GROUPS.has(group.node.type) || table.node.type !== TABLE) return null;
  return { table, group, row, cell };
}

// the table holding the one selected node (itself the table, or one of its parts)
function selectedTable(state: { readonly document: DocumentJson; readonly selection: readonly NodeId[] }): Location | null {
  const [only, ...others] = state.selection;
  if (only === undefined || others.length > 0) return null;
  return upTo(state.document, only, new Set([TABLE]));
}

export const cellSelected = registerPredicate('cellSelected', (state) => selectedCell(state) !== null);
export const inTable = registerPredicate('inTable', (state) => selectedTable(state) !== null);

// every row of a table, with its group, in order
function rowsOf(table: Location): { readonly group: DocNode; readonly groupIndex: number; readonly row: DocNode; readonly rowIndex: number }[] {
  return table.node.children.flatMap((group, groupIndex) => (GROUPS.has(group.type) ? group.children.map((row, rowIndex) => ({ group, groupIndex, row, rowIndex })) : []));
}

// a new cell for the column at `index` of every row of the table (a header cell in head rows)
function addColumn(table: Location, make: NodeMaker, index: (row: DocNode) => number): Patch[] {
  return rowsOf(table).map(({ group, groupIndex, row, rowIndex }): Patch => ({
    op: 'add',
    path: [...table.path, 'children', groupIndex, 'children', rowIndex, 'children', index(row)],
    value: newElement(make, group.type === HEAD ? HEADER_CELL : CELL),
  }));
}

function locked(document: DocumentJson, table: Location) {
  return lockRefusal(document, table.node.id, 'status.locked.edit');
}

export const addColumnAfterCommand = registerHandler('table.addColumnAfter', ({ state, rules, ids, words }): Outcome<never> => {
  const at = selectedCell(state);
  if (at === null) return { kind: 'refused', message: message('status.table.selectCell') };
  const refused = locked(state.document, at.table);
  if (refused !== null) return { kind: 'refused', message: refused };
  const patches = addColumn(at.table, nodeMaker(state.document, rules, ids, words), (row) => Math.min(at.cell.index + 1, row.children.length));
  return { kind: 'change', patches, message: message('status.table.columnCreated', { count: patches.length }) };
});

export const addColumnEndCommand = registerHandler('table.addColumnEnd', ({ state, rules, ids, words }): Outcome<never> => {
  const table = selectedTable(state);
  if (table === null) return { kind: 'refused', message: message('status.table.selectPart') };
  const refused = locked(state.document, table);
  if (refused !== null) return { kind: 'refused', message: refused };
  const patches = addColumn(table, nodeMaker(state.document, rules, ids, words), (row) => row.children.length);
  return { kind: 'change', patches, message: message('status.table.columnCreated', { count: patches.length }) };
});

export const removeColumnCommand = registerHandler('table.removeColumn', ({ state }): Outcome<never> => {
  const at = selectedCell(state);
  if (at === null) return { kind: 'refused', message: message('status.table.selectCell') };
  const refused = locked(state.document, at.table);
  if (refused !== null) return { kind: 'refused', message: refused };
  if (at.row.node.children.length <= 1) return { kind: 'refused', message: message('status.table.lastColumn') };
  const index = at.cell.index;
  const patches = rowsOf(at.table)
    .filter(({ row }) => index < row.children.length)
    .map(({ groupIndex, rowIndex }): Patch => ({ op: 'remove', path: [...at.table.path, 'children', groupIndex, 'children', rowIndex, 'children', index] }));
  // the selection moves to the cell that takes the removed one's place in its row, else the one before it
  const row = at.row.node.children;
  const next = row[index + 1] ?? row[index - 1];
  return { kind: 'change', patches, selection: next === undefined ? [] : [next.id], message: message('status.table.columnRemoved', { count: patches.length }) };
});

export const addRowAfterCommand = registerHandler('table.addRowAfter', ({ state, rules, ids, words }): Outcome<never> => {
  const at = selectedCell(state);
  if (at === null) return { kind: 'refused', message: message('status.table.selectCell') };
  const refused = locked(state.document, at.table);
  if (refused !== null) return { kind: 'refused', message: refused };
  const row = newRow(nodeMaker(state.document, rules, ids, words), at.group.node.type, at.row.node.children.length);
  return { kind: 'change', patches: [{ op: 'add', path: [...at.group.path, 'children', at.row.index + 1], value: row }], message: message('status.table.rowCreated', { name: row.name }) };
});

export const removeRowCommand = registerHandler('table.removeRow', ({ state }): Outcome<never> => {
  const at = selectedCell(state);
  if (at === null) return { kind: 'refused', message: message('status.table.selectCell') };
  const refused = locked(state.document, at.table);
  if (refused !== null) return { kind: 'refused', message: refused };
  if (at.group.node.type === BODY && at.group.node.children.length <= 1) return { kind: 'refused', message: message('status.table.lastRow') };
  // the selection moves to the same column of the row after, else the row before, else the table
  const rows = at.group.node.children;
  const next = rows[at.row.index + 1] ?? rows[at.row.index - 1];
  const cell = next?.children[Math.min(at.cell.index, next.children.length - 1)];
  return {
    kind: 'change',
    patches: [{ op: 'remove', path: at.row.path }],
    selection: [cell?.id ?? at.table.node.id],
    message: message('status.table.rowRemoved', { name: at.row.node.name }),
  };
});

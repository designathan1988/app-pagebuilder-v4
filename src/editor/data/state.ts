// The Data panel's part of the editor state (spec content-data): the collection it shows, the query its grid and its
// Fill use, and the preview of a data file being imported. The document's content is the core's
// (src/core/data/commands.ts); this module owns what the panel shows, and the two imports that read the preview —
// the rows of the file the person checked, as a new collection or into one.
import { message, registerHandler, type Message, type MessageParam } from '../../core/commands/registry.ts';
import { contentChange, shownCollection } from '../../core/data/commands.ts';
import { DataRefusal, canonicalQuery, collectionNamed, collectionsOf, createCollection, guessType, importRows, keyFor, queryItems, queryRefusal, refuse, type ImportMode } from '../../core/data/collections.ts';
import type { DataFile, Sheet } from '../../core/data/readers.ts';
import { FIELD_TYPES, FILTER_OPERATORS, type Field, type FieldType, type FilterOperator, type Query, type Sort } from '../../core/data/model.ts';
import { fold } from '../../core/text/fold.ts';
import type { MessageId } from '../../generated/ids.ts';
import type { EditorUi } from '../state.ts';
import { argumentRefused } from '../../core/store/args.ts';

// A data file read for import: its sheets, the one shown, and the type each of its columns will take (guessed, then
// the person's choice).
export interface DataPreview {
  readonly file: string;
  readonly sheets: readonly Sheet[];
  readonly sheet: number;
  readonly types: Readonly<Record<string, FieldType>>;
}

export interface DataUi {
  readonly collection?: string | undefined;
  readonly query?: Query | undefined;
  readonly preview?: DataPreview | undefined;
}

const NO_DATA: DataUi = {};
export const dataOf = (ui: EditorUi): DataUi => ui.data ?? NO_DATA;
const withData = (ui: EditorUi, change: Partial<DataUi>): EditorUi => ({ ...ui, data: { ...dataOf(ui), ...change } });

// The columns' types as the file's values suggest them.
const guessed = (sheet: Sheet | undefined): Record<string, FieldType> => Object.fromEntries((sheet?.columns ?? []).map((column) => [column, guessType(sheet?.rows.map((row) => row[column]) ?? [])]));

// The sheet the preview shows.
export const previewSheet = (preview: DataPreview): Sheet | undefined => preview.sheets[preview.sheet];

// ---------------------------------------------------------------- what the panel shows

// data.select: the collection the panel shows (its query starts empty), saying how many items it holds.
export const selectCollection = registerHandler<'data.select', EditorUi>(
  'data.select',
  ({ state }, { collection }) => {
    const held = collectionNamed(state.document, collection);
    if (held === undefined) throw new Error(`data.select: the project has no collection ${collection}`);
    return { kind: 'change', ui: withData(state.ui, { collection, query: undefined }), message: message('status.data.shown', { collection, count: { plural: 'data.items', count: held.items.length } }) };
  },
  (state, { collection }) => shownCollection(state.document, state.ui)?.name === collection,
);

// A sort a menu hands ("nome:desc"): the field and the direction (ascending when it names none); none for "".
function sortOf(chosen: string): Sort | null {
  const [field = '', direction] = chosen.split(':');
  return field === '' ? null : { field, direction: direction === 'desc' ? 'desc' : 'asc' };
}

// A count typed (an offset, a limit): a whole number from 0, or null.
const countOf = (typed: string): number | null => (/^\d+$/.test(typed) ? Number(typed) : null);

// The query with one of its parts changed, as a control hands it: the filter's field, operator or compared text, the
// first or second sort key, the offset, the limit, or all of it cleared.
function queryWith(query: Query, part: string, typed: string, collection: string): Query {
  const filter = query.filters?.[0];
  switch (part) {
    case 'filterField':
      return { ...query, filters: typed === '' ? [] : [{ field: typed, operator: filter?.operator ?? 'contains', ...(filter?.value === undefined ? {} : { value: filter.value }) }] };
    case 'filterOperator':
      if (filter === undefined) refuse('status.data.noFilter', { collection });
      if (!(FILTER_OPERATORS as readonly string[]).includes(typed)) refuse('status.data.badOperator', { value: typed });
      return { ...query, filters: [{ ...filter, operator: typed as FilterOperator }] };
    case 'filterValue':
      if (filter === undefined) refuse('status.data.noFilter', { collection });
      return { ...query, filters: [{ ...filter, value: typed }] };
    case 'sortFirst': {
      const sort = sortOf(typed);
      return { ...query, order: sort === null ? [] : [sort, ...(query.order ?? []).slice(1, 2)] };
    }
    case 'sortSecond': {
      const sort = sortOf(typed);
      return { ...query, order: [...(query.order ?? []).slice(0, 1), ...(sort === null ? [] : [sort])] };
    }
    case 'offset':
    case 'limit': {
      if (typed === '' && part === 'limit') {
        const { limit: _limit, ...rest } = query;
        void _limit;
        return rest;
      }
      const count = countOf(typed);
      if (count === null) refuse('status.data.badCount', { collection });
      return { ...query, [part]: count };
    }
    default:
      return {};
  }
}

// data.setQuery: what the grid shows and what Fill repeats — a part of its filter, its order, its offset or its limit
// — saying how many items it shows.
export const setQuery = registerHandler<'data.setQuery', EditorUi>('data.setQuery', ({ state }, { part, value }) => {
  const collection = shownCollection(state.document, state.ui);
  if (collection === undefined) return { kind: 'refused', message: message('status.data.noCollection') };
  try {
    const asked = canonicalQuery(queryWith(dataOf(state.ui).query ?? {}, part, typeof value === 'string' ? value.trim() : '', collection.name));
    const refused = queryRefusal(collection, asked);
    if (refused !== null) return { kind: 'refused', message: refused };
    const shown = queryItems(collection, asked).length;
    return { kind: 'change', ui: withData(state.ui, { query: asked }), message: message('status.data.queryApplied', { collection: collection.name, count: { plural: 'data.items', count: shown }, total: collection.items.length }) };
  } catch (error) {
    if (error instanceof DataRefusal) return { kind: 'refused', message: error.refusal };
    throw error;
  }
});

// ---------------------------------------------------------------- the preview of a data file

// What the file door hands over (door.tsx, fileReading "data": core/data/readers.ts readDataFileSafely as JSON): the
// file's sheets, or the problem that stopped its reading.
function handedFile(text: string): DataFile | { readonly name: string; readonly problem: Message } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || typeof (parsed as { name?: unknown }).name !== 'string') return null;
  const handed = parsed as { name: string; sheets?: unknown; problem?: unknown };
  if (handed.problem !== undefined) {
    const problem = handed.problem as { key?: unknown; params?: unknown };
    return typeof problem.key === 'string' && problem.key.startsWith('status.data.') ? { name: handed.name, problem: { key: problem.key as MessageId, params: (problem.params ?? {}) as Readonly<Record<string, MessageParam>> } } : null;
  }
  return Array.isArray(handed.sheets) ? (handed as DataFile) : null;
}

// data.preview: the file the person chose, read (door.tsx): its first sheet shown with the type each column will take;
// a file that cannot be read is refused with what is wrong.
export const previewFile = registerHandler<'data.preview', EditorUi>('data.preview', ({ state }, { file }) => {
  const handed = handedFile(file);
  if (handed === null) return { kind: 'refused', message: message('status.data.fileSheet', { name: '' }) };
  if ('problem' in handed) return { kind: 'refused', message: handed.problem };
  const sheet = handed.sheets[0];
  const preview: DataPreview = { file: handed.name, sheets: handed.sheets, sheet: 0, types: guessed(sheet) };
  return { kind: 'change', ui: withData(state.ui, { preview }), message: message('status.data.previewed', { name: handed.name, count: { plural: 'data.rows', count: sheet?.rows.length ?? 0 } }) };
});

// data.previewSheet: another sheet of a workbook.
export const choosePreviewSheet = registerHandler<'data.previewSheet', EditorUi>(
  'data.previewSheet',
  ({ state }, { sheet }) => {
    const preview = dataOf(state.ui).preview;
    const index = preview?.sheets.findIndex((one) => one.name === sheet) ?? -1;
    if (preview === undefined || index < 0) return { kind: 'refused', message: argumentRefused('sheet') };
    const shown = preview.sheets[index];
    return { kind: 'change', ui: withData(state.ui, { preview: { ...preview, sheet: index, types: guessed(shown) } }), message: message('status.data.sheetShown', { name: sheet, count: { plural: 'data.rows', count: shown?.rows.length ?? 0 } }) };
  },
  (state, { sheet }) => {
    const preview = dataOf(state.ui).preview;
    return preview !== undefined && previewSheet(preview)?.name === sheet;
  },
);

// data.previewType: the type a column of the file will take in a new collection.
export const setPreviewType = registerHandler<'data.previewType', EditorUi>('data.previewType', ({ state }, { column, type }) => {
  const preview = dataOf(state.ui).preview;
  if (preview === undefined || !(previewSheet(preview)?.columns ?? []).includes(column)) return { kind: 'refused', message: argumentRefused('column') };
  if (!(FIELD_TYPES as readonly string[]).includes(type)) throw new Error(`data.previewType: ${type} is not a field type`);
  return { kind: 'change', ui: withData(state.ui, { preview: { ...preview, types: { ...preview.types, [column]: type as FieldType } } }), message: message('status.data.columnTyped', { column, type: { key: `data.type.${type}` as MessageId } }) };
});

export const closePreview = registerHandler<'data.closePreview', EditorUi>('data.closePreview', ({ state }) => {
  const preview = dataOf(state.ui).preview;
  return { kind: 'change', ui: withData(state.ui, { preview: undefined }), ...(preview === undefined ? {} : { message: message('status.data.previewClosed', { name: preview.file }) }) };
});

// ---------------------------------------------------------------- importing the preview

// The sheet a person imports, refused while it cannot be read.
function importedSheet(ui: EditorUi): { readonly preview: DataPreview; readonly sheet: Sheet } {
  const preview = dataOf(ui).preview;
  const sheet = preview === undefined ? undefined : previewSheet(preview);
  if (preview === undefined || sheet === undefined) refuse('status.data.noPreview');
  if (sheet.problem !== undefined) refuse(sheet.problem.key, sheet.problem.params);
  if (sheet.rows.length === 0) refuse('status.data.fileEmpty', { name: preview.file });
  return { preview, sheet };
}

// The file's name without its extension: a new collection's name when the person types none.
const stem = (file: string): string => file.replace(/\.[^.]+$/, '').trim();

// data.importNew: the previewed sheet becomes a new collection: a field per column (its label the column's name, its
// type the one the preview shows), an item per row. The Data panel shows it.
export const importNew = registerHandler<'data.importNew', EditorUi>('data.importNew', (context, { name }) =>
  contentChange(context, (document, data) => {
    const { preview, sheet } = importedSheet(context.state.ui);
    const taken: string[] = [];
    const fields: Field[] = sheet.columns.map((column) => {
      const key = keyFor(column, taken);
      taken.push(key);
      return { key, label: column, type: preview.types[column] ?? 'text' };
    });
    const typed = name.trim() === '' ? stem(preview.file) : name.trim();
    const empty = createCollection(collectionsOf(document), typed, fields);
    const rows = sheet.rows.map((row) => Object.fromEntries(fields.map((field, i) => [field.key, row[sheet.columns[i] as string]])));
    const collection = importRows(empty, rows, 'append', null, () => data.ids.next());
    return {
      document: { ...document, collections: [...collectionsOf(document), collection] },
      message: message('status.data.imported', { collection: collection.name, count: { plural: 'data.items', count: collection.items.length } }),
      ui: withData(context.state.ui, { collection: collection.name, preview: undefined, query: undefined }),
    };
  }),
);

// Which field of a collection each column of a file fills: the field labelled like the column (accents and case
// aside), else the field whose key it is; a column that names none is not imported (the preview says so).
export function columnFields(columns: readonly string[], fields: readonly Field[]): ReadonlyMap<string, Field> {
  const matched = new Map<string, Field>();
  for (const column of columns) {
    const field = fields.find((f) => fold(f.label.trim()) === fold(column.trim())) ?? fields.find((f) => f.key === column);
    if (field !== undefined && ![...matched.values()].includes(field)) matched.set(column, field);
  }
  return matched;
}

// data.importInto: the previewed sheet's rows go into a collection — after its items, in place of them, or updating
// the item whose first matched field holds the row's value there (the file's first column is the key).
export const importInto = registerHandler<'data.importInto', EditorUi>('data.importInto', (context, { collection, mode }) =>
  contentChange(context, (document, data) => {
    const { sheet } = importedSheet(context.state.ui);
    const held = collectionNamed(document, collection);
    if (held === undefined) throw new Error(`data.importInto: the project has no collection ${collection}`);
    const matched = columnFields(sheet.columns, held.fields);
    if (matched.size === 0) refuse('status.data.noColumnMatches', { collection: held.name });
    const first = sheet.columns[0];
    const key = mode === 'update' ? (first === undefined ? undefined : matched.get(first)?.key) : null;
    if (key === undefined) refuse('status.data.keyNeeded', { collection: held.name });
    const rows = sheet.rows.map((row) => Object.fromEntries([...matched].map(([column, field]) => [field.key, row[column]])));
    const next = importRows(held, rows, mode as ImportMode, key, () => data.ids.next());
    return {
      document: { ...document, collections: collectionsOf(document).map((c) => (c.name === held.name ? next : c)) },
      message: message('status.data.importedInto', { collection: held.name, count: { plural: 'data.items', count: rows.length }, mode: { key: `data.mode.${mode}` as MessageId } }),
      ui: withData(context.state.ui, { collection: held.name, preview: undefined }),
    };
  }),
);

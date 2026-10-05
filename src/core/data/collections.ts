// The project's collections (spec content-data): a collection is a named table of typed fields and items. This module
// owns what a value of each type may be (its canonical form), the schema's rules, the import of rows (append, replace,
// update by key), the edits of fields and items, and the query a list shows. Everything here is pure: a function
// returns the collection after the change, or throws a DataRefusal naming the row, the column and the value at fault,
// in the words of the catalogue, before anything is changed.
import { message, type Message, type MessageParam } from '../commands/registry.ts';
import type { MessageId } from '../../generated/ids.ts';
import { readAddress } from '../elements/address.ts';
import { canonical, parseInline, plainText, type InlineRun } from '../text/inline.ts';
import { fold } from '../text/fold.ts';
import { FIELD_TYPES, type Cell, type Collection, type Field, type FieldType, type Filter, type Item, type Query } from './model.ts';
import { registerReferenceKind } from '../store/references.ts';

// A predictable refusal of a content operation: the message the status bar says. Handlers catch it and answer
// `refused`; anything else a content function throws is a defect.
export class DataRefusal extends Error {
  override name = 'DataRefusal';
  // (a field, not a parameter property: the tools run this module with Node's type stripping, which takes none)
  readonly refusal: Message;
  constructor(refusal: Message) {
    super(refusal.key);
    this.refusal = refusal;
  }
}
export function refuse(key: MessageId, params: Readonly<Record<string, MessageParam>> = {}): never {
  throw new DataRefusal(message(key, params));
}

const NONE: readonly Collection[] = [];
export const collectionsOf = (document: { readonly collections?: readonly Collection[] }): readonly Collection[] => document.collections ?? NONE;
export const collectionNamed = (document: { readonly collections?: readonly Collection[] }, name: string): Collection | undefined => collectionsOf(document).find((c) => c.name === name);

// ---------------------------------------------------------------- values

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
// a decimal written with a comma, as pt-BR writes it ("42,5"), with no other separator
const COMMA_NUMBER = /^[+-]?\d+,\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRUE_WORDS = ['true', 'yes', '1', 'sim', 'verdadeiro'];
const FALSE_WORDS = ['false', 'no', '0', 'nao', 'falso'];
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const PAGE_PATH = /^[\w-]+(\/[\w-]+)*\.html?(#[\w-]*)?$/i;

// A calendar date that exists (2026-02-30 does not).
function realDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

// The canonical value a field takes for what a person typed or a file held, `undefined` for an empty one, or `null`
// when the value is not one of the field's type. Text is trimmed at its ends; a number keeps the number it reads as; a
// date is a real YYYY-MM-DD date; a link is an address the link rule allows; an image is a project path, a file name
// or a web address (which one it names is resolved when an element shows it: core/design/components.ts imageSource).
export function readCell(type: FieldType, value: unknown): Cell | undefined | null {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const text = typeof value === 'string' ? value.trim() : null;
  switch (type) {
    case 'text':
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : text;
    case 'richtext': {
      if (text !== null) return [text];
      const runs = parseInline(value);
      if (runs === null || runs === 'unsafe') return null;
      const runsCanonical = canonical(runs);
      return plainText(runsCanonical).trim() === '' ? undefined : runsCanonical;
    }
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (text === null) return null;
      const written = COMMA_NUMBER.test(text) ? text.replace(',', '.') : text;
      if (!NUMBER.test(written)) return null;
      const number = Number(written);
      return Number.isFinite(number) ? number : null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
      const word = text === null ? '' : fold(text);
      if (TRUE_WORDS.includes(word)) return true;
      if (FALSE_WORDS.includes(word)) return false;
      return null;
    }
    case 'date':
      return text !== null && realDate(text) ? text : null;
    case 'link': {
      if (text === null) return null;
      // a page of the project by its file ("about.html", "blog/post.html#top") is a path, never a domain
      if (PAGE_PATH.test(text)) return text;
      const address = readAddress(text);
      return address.ok ? address.value : null;
    }
    case 'image': {
      if (text === null) return null;
      // a web address must be one the link rule allows; a path or a file name is resolved by the element that shows it
      if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return readAddress(text).ok ? text : null;
      return /\s$|^\s/.test(text) ? null : text;
    }
  }
}

// The same value as the cell holds it, for a field of this type; a stored value that is not canonical is a defect.
export function isCanonical(type: FieldType, value: unknown): boolean {
  if (value === undefined) return false;
  const read = readCell(type, value);
  if (read === null || read === undefined) return false;
  return JSON.stringify(read) === JSON.stringify(value);
}

// A cell as text: what a grid cell, a preview and a bound text show (a boolean in the person's words).
export function cellText(value: Cell | undefined, words: { readonly yes: string; readonly no: string }): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? words.yes : words.no;
  if (Array.isArray(value)) return plainText(value as readonly InlineRun[]);
  return String(value);
}

// The kind of value a column of a file holds, guessed from its filled cells: every one a yes/no, a number, a date, an
// image file or address, a web address; else text. The person can change every guess before importing.
export function guessType(values: readonly unknown[]): FieldType {
  const filled = values.filter((value) => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === ''));
  if (filled.length === 0) return 'text';
  const all = (type: FieldType) => filled.every((value) => readCell(type, value) !== null);
  if (filled.every((value) => typeof value === 'boolean') || (all('boolean') && filled.every((value) => typeof value === 'string' && !/^[01]$/.test(value.trim())))) return 'boolean';
  if (all('number')) return 'number';
  if (all('date')) return 'date';
  if (filled.every((value) => typeof value === 'string' && IMAGE_FILE.test(value.trim().split(/[?#]/)[0] ?? ''))) return 'image';
  if (filled.every((value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim()) && readCell('link', value) !== null)) return 'link';
  return 'text';
}

// ---------------------------------------------------------------- the schema

const FIELD_KEY = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const RESERVED = ['__proto__', 'constructor', 'prototype'];

// The key a new field takes from its label: the label's letters and digits, without accents, joined by "_", and a
// number when it is taken ("nome", "nome_2"). A key never changes once made, so renaming a field keeps its bindings.
export function keyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const words = fold(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const base = words === '' ? 'field' : /^[0-9]/.test(words) ? `f_${words}` : words;
  let key = base;
  for (let n = 2; used.has(key) || RESERVED.includes(key); n += 1) key = `${base}_${n}`;
  return key;
}

// Why a schema is not one, or null: at least one field, keys unique and well formed, labels present and unique (a
// person tells two columns apart by their labels), types known.
export function schemaRefusal(collection: string, fields: readonly Field[]): Message | null {
  if (fields.length === 0) return message('status.data.noFields', { collection });
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const field of fields) {
    if (!FIELD_KEY.test(field.key) || RESERVED.includes(field.key) || keys.has(field.key)) return message('status.data.badField', { collection, field: field.key });
    const label = fold(field.label.trim());
    if (label === '') return message('status.data.fieldLabelEmpty', { collection });
    if (labels.has(label)) return message('status.data.fieldLabelTaken', { collection, label: field.label.trim() });
    if (!(FIELD_TYPES as readonly string[]).includes(field.type)) return message('status.data.badField', { collection, field: field.key });
    keys.add(field.key);
    labels.add(label);
  }
  return null;
}

// Why a name cannot be a collection's (empty, or another collection's), or null.
export function nameRefusal(collections: readonly Collection[], name: string, except?: string): Message | null {
  const trimmed = name.trim();
  if (trimmed === '') return message('status.data.nameEmpty');
  if (collections.some((c) => c.name !== except && fold(c.name) === fold(trimmed))) return message('status.data.nameTaken', { name: trimmed });
  return null;
}

// ---------------------------------------------------------------- items

// The values of an item read from a row (field key → what the row holds), each in its canonical form; a value that is
// not one of its field's type is refused naming the row (counted from 1, as a person counts the rows of a file), the
// column and the value.
function valuesOf(collection: string, fields: readonly Field[], row: Readonly<Record<string, unknown>>, rowNumber: number): Record<string, Cell> {
  const values: Record<string, Cell> = {};
  for (const field of fields) {
    if (!Object.hasOwn(row, field.key)) continue;
    const read = readCell(field.type, row[field.key]);
    if (read === null) refuse('status.data.badValue', { collection, row: rowNumber, column: field.label, value: shownValue(row[field.key]), type: { key: `data.type.${field.type}` as MessageId } });
    if (read !== undefined) values[field.key] = read;
  }
  return values;
}
const shownValue = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value) ?? '');

export function createCollection(collections: readonly Collection[], name: string, fields: readonly Field[]): Collection {
  const named = nameRefusal(collections, name);
  if (named !== null) throw new DataRefusal(named);
  const schema = schemaRefusal(name.trim(), fields);
  if (schema !== null) throw new DataRefusal(schema);
  return { name: name.trim(), fields: fields.map((f) => ({ key: f.key, label: f.label.trim(), type: f.type })), items: [] };
}

export type ImportMode = 'append' | 'replace' | 'update';

// The collection with the rows imported (each row: field key → value): appended after its items, in place of them,
// or updating the item whose key field holds the row's key (rows with a new key are appended). An update needs a key
// that is filled and unique in the collection and in the rows; the whole import is refused at its first bad row.
export function importRows(collection: Collection, rows: readonly Readonly<Record<string, unknown>>[], mode: ImportMode, key: string | null, next: () => string): Collection {
  const keyField = key === null ? undefined : collection.fields.find((f) => f.key === key);
  if (mode === 'update' && (keyField === undefined || keyField.type === 'richtext')) refuse('status.data.keyNeeded', { collection: collection.name });
  const items: Item[] = mode === 'replace' ? [] : [...collection.items];
  const at = new Map<string, number>();
  if (keyField !== undefined && mode === 'update') {
    items.forEach((item, index) => {
      const held = item.values[keyField.key];
      if (held !== undefined) at.set(JSON.stringify(held), index);
    });
  }
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const values = valuesOf(collection.name, collection.fields, row, rowNumber);
    if (mode !== 'update' || keyField === undefined) {
      items.push({ id: next(), values });
      return;
    }
    const keyValue = values[keyField.key];
    if (keyValue === undefined) refuse('status.data.keyEmpty', { collection: collection.name, row: rowNumber, column: keyField.label });
    const identity = JSON.stringify(keyValue);
    if (seen.has(identity)) refuse('status.data.keyRepeated', { collection: collection.name, row: rowNumber, column: keyField.label, value: cellText(keyValue, { yes: 'true', no: 'false' }) });
    seen.add(identity);
    const existing = at.get(identity);
    const previous = existing === undefined ? undefined : items[existing];
    if (existing === undefined || previous === undefined) items.push({ id: next(), values });
    else items[existing] = { id: previous.id, values: { ...previous.values, ...values } };
  });
  return { ...collection, items };
}

// The collection with one value of an item set from what a person typed ('' empties it).
export function setCell(collection: Collection, itemId: string, fieldKey: string, typed: unknown): Collection {
  const field = collection.fields.find((f) => f.key === fieldKey);
  const index = collection.items.findIndex((item) => item.id === itemId);
  const item = collection.items[index];
  // a name of an item or a field the collection does not hold went stale under its door (the random probe)
  if (field === undefined || item === undefined) refuse('status.stale');
  const read = readCell(field.type, typed);
  if (read === null) refuse('status.data.badValue', { collection: collection.name, row: index + 1, column: field.label, value: shownValue(typed), type: { key: `data.type.${field.type}` as MessageId } });
  const { [field.key]: _old, ...others } = item.values;
  void _old;
  const values = read === undefined ? others : { ...others, [field.key]: read };
  return { ...collection, items: collection.items.map((one) => (one.id === itemId ? { id: one.id, values } : one)) };
}

export function addItem(collection: Collection, id: string): Collection {
  return { ...collection, items: [...collection.items, { id, values: {} }] };
}

export function deleteItems(collection: Collection, ids: readonly string[]): Collection {
  const gone = new Set(ids);
  for (const id of gone) if (!collection.items.some((item) => item.id === id)) refuse('status.stale');
  return { ...collection, items: collection.items.filter((item) => !gone.has(item.id)) };
}

// The item moved to a place of the collection (0 first), the others keeping their order.
export function moveItem(collection: Collection, id: string, to: number): Collection {
  const from = collection.items.findIndex((item) => item.id === id);
  const moved = collection.items[from];
  if (moved === undefined) refuse('status.stale');
  const rest = collection.items.filter((item) => item.id !== id);
  const place = Math.max(0, Math.min(rest.length, Math.trunc(to)));
  return { ...collection, items: [...rest.slice(0, place), moved, ...rest.slice(place)] };
}

// ---------------------------------------------------------------- fields

export function addField(collection: Collection, label: string, type: FieldType): Collection {
  const field: Field = { key: keyFor(label, collection.fields.map((f) => f.key)), label: label.trim(), type };
  const fields = [...collection.fields, field];
  const refused = schemaRefusal(collection.name, fields);
  if (refused !== null) throw new DataRefusal(refused);
  return { ...collection, fields };
}

// A field relabelled or given another type: every value it holds is read again as the new type, and the change is
// refused at the first item whose value the new type cannot hold (nothing is converted silently or dropped).
export function setField(collection: Collection, key: string, change: { readonly label?: string; readonly type?: FieldType }): Collection {
  const field = collection.fields.find((f) => f.key === key);
  if (field === undefined) refuse('status.stale');
  const next: Field = { key, label: change.label === undefined ? field.label : change.label.trim(), type: change.type ?? field.type };
  const fields = collection.fields.map((f) => (f.key === key ? next : f));
  const refused = schemaRefusal(collection.name, fields);
  if (refused !== null) throw new DataRefusal(refused);
  if (next.type === field.type) return { ...collection, fields };
  const items = collection.items.map((item, index) => {
    const held = item.values[key];
    if (held === undefined) return item;
    // a value goes to the new type through the text it shows (a number 42 becomes the text "42", the text "42" the
    // number 42); rich text keeps its runs only as rich text
    const source = Array.isArray(held) && next.type !== 'richtext' ? plainText(held as readonly InlineRun[]) : held;
    const read = readCell(next.type, source);
    if (read === null) refuse('status.data.badValue', { collection: collection.name, row: index + 1, column: next.label, value: cellText(held, { yes: 'true', no: 'false' }), type: { key: `data.type.${next.type}` as MessageId } });
    const { [key]: _old, ...others } = item.values;
    void _old;
    return { id: item.id, values: read === undefined ? others : { ...others, [key]: read } };
  });
  return { ...collection, fields, items };
}

export function removeField(collection: Collection, key: string): Collection {
  const fields = collection.fields.filter((f) => f.key !== key);
  const refused = schemaRefusal(collection.name, fields);
  if (refused !== null) throw new DataRefusal(refused);
  const items = collection.items.map((item) => {
    const { [key]: _old, ...values } = item.values;
    void _old;
    return { id: item.id, values };
  });
  return { ...collection, fields, items };
}

// ---------------------------------------------------------------- the query

// How two values of a field compare: empty last, then by the field's type (texts as a person sorts them, accents and
// case set aside); null when they do not compare (two rich texts compare by their text).
function compare(a: Cell | undefined, b: Cell | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const left = Array.isArray(a) ? plainText(a as readonly InlineRun[]) : String(a);
  const right = Array.isArray(b) ? plainText(b as readonly InlineRun[]) : String(b);
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

function holds(filter: Filter, field: Field, value: Cell | undefined): boolean {
  if (filter.operator === 'empty') return value === undefined;
  if (filter.operator === 'filled') return value !== undefined;
  if (value === undefined) return false;
  const typed = filter.value ?? '';
  if (filter.operator === 'contains') return fold(cellText(value, { yes: 'true', no: 'false' })).includes(fold(typed.trim()));
  // the other operators compare with the typed text read as the field's type
  const other = readCell(field.type, typed);
  if (other === null || other === undefined) return false;
  const order = compare(value, other);
  switch (filter.operator) {
    case 'eq':
      return order === 0;
    case 'neq':
      return order !== 0;
    case 'lt':
      return order < 0;
    case 'lte':
      return order <= 0;
    case 'gt':
      return order > 0;
    case 'gte':
      return order >= 0;
  }
}

// Why a query cannot be read for this collection (a field it names is not one, a count is not a whole number), or null.
export function queryRefusal(collection: Collection, query: Query): Message | null {
  const named = [...(query.filters ?? []).map((f) => f.field), ...(query.order ?? []).map((s) => s.field)];
  const unknown = named.find((key) => !collection.fields.some((f) => f.key === key));
  if (unknown !== undefined) return message('status.data.unknownField', { collection: collection.name, field: unknown });
  for (const count of [query.offset, query.limit]) if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) return message('status.data.badCount', { collection: collection.name });
  return null;
}

// The items a query shows, in order: the filters (every one, or any one), then a stable sort by each order key in
// turn (items equal on every key keep the collection's order), then offset and limit.
export function queryItems(collection: Collection, query: Query): readonly Item[] {
  const refused = queryRefusal(collection, query);
  if (refused !== null) throw new DataRefusal(refused);
  const fieldOf = (key: string): Field => collection.fields.find((f) => f.key === key) as Field;
  const filters = query.filters ?? [];
  const kept = collection.items.filter((item) => {
    if (filters.length === 0) return true;
    const results = filters.map((filter) => holds(filter, fieldOf(filter.field), item.values[filter.field]));
    return query.match === 'any' ? results.some(Boolean) : results.every(Boolean);
  });
  const order = query.order ?? [];
  const sorted = kept
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      for (const sort of order) {
        const by = compare(a.item.values[sort.field], b.item.values[sort.field]);
        // an empty value stays last whichever the direction
        const empty = a.item.values[sort.field] === undefined || b.item.values[sort.field] === undefined;
        if (by !== 0) return sort.direction === 'desc' && !empty ? -by : by;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
  const offset = query.offset ?? 0;
  return sorted.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
}

// A query in its canonical form: no empty list, no default, so two equal queries are the same JSON.
export function canonicalQuery(query: Query): Query {
  return {
    ...(query.filters !== undefined && query.filters.length > 0 ? { filters: query.filters.map((f) => (f.value === undefined || f.operator === 'empty' || f.operator === 'filled' ? { field: f.field, operator: f.operator } : { field: f.field, operator: f.operator, value: f.value })) } : {}),
    ...(query.match === 'any' ? { match: 'any' as const } : {}),
    ...(query.order !== undefined && query.order.length > 0 ? { order: query.order.map((s) => ({ field: s.field, direction: s.direction })) } : {}),
    ...(query.offset !== undefined && query.offset > 0 ? { offset: query.offset } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  };
}

// a collection an argument names (manifest refers: collection), by its name
registerReferenceKind('collection', (document, name) => collectionNamed(document, name) !== undefined);

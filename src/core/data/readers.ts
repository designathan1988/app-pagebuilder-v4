// Reading a data file a person hands over (spec content-data, "import"): CSV, TSV, JSON and XLSX become sheets of
// named columns and rows, ready for the import preview. One parser per format, each the project's own: the CSV lines
// are core/design/data.ts's (the parser Fill from data reads project files with), the JSON list rule is the same
// module's, and a spreadsheet is read through the project's ZIP reader (core/project/zip.ts) and an XML reader the
// editor injects (the core has no DOM). A spreadsheet's formulas are never run: a cell keeps the value the
// spreadsheet saved with it, and a formula saved without one is refused.
//
// A file that cannot be read is refused with what is wrong and where (the row, the cell), in the catalogue's words; a
// sheet of a workbook that cannot be read keeps its problem, so the other sheets stay importable.
import type { Message } from '../commands/registry.ts';
import { message } from '../commands/registry.ts';
import { csvLines, jsonRowList } from '../design/data.ts';
import { ARCHIVE_LIMITS, ArchiveError, unzip, type ArchiveLimits } from '../project/zip.ts';
import { DataRefusal, refuse } from './collections.ts';

export interface XmlElement {
  // the element's local name, without its namespace prefix
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly XmlElement[];
}
// The editor's XML reader (src/editor/data/read-file.ts, the browser's DOMParser): a document's root element.
export type XmlReader = (source: string) => XmlElement;

// A value a file holds in a cell: text, a number, a yes/no (a spreadsheet's boolean or a JSON one).
type FileValue = string | number | boolean;
export interface Sheet {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, FileValue>>[];
  // why this sheet cannot be imported, when it cannot (the other sheets of the workbook still can)
  readonly problem?: Message;
}
export interface DataFile {
  readonly name: string;
  readonly sheets: readonly Sheet[];
}

// What a file may be at most: its bytes, a spreadsheet's bytes once unpacked, its rows.
const DATA_LIMITS = { bytes: 32 * 1024 * 1024, unpacked: 128 * 1024 * 1024, rows: 100_000, entries: 10_000 } as const;
const DATA_EXTENSIONS = ['csv', 'tsv', 'json', 'xlsx'] as const;

const extension = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const isDataName = (name: string): boolean => (DATA_EXTENSIONS as readonly string[]).includes(extension(name));
const decoder = new TextDecoder('utf-8', { fatal: true });

// The columns of a table from its header row: every one named, no name twice (accents and case aside, as a person
// reads them), none of the names an object cannot hold.
function headerOf(file: string, cells: readonly unknown[]): string[] {
  const names = cells.map((cell) => String(cell ?? '').trim());
  // trailing empty header cells are no columns (a spreadsheet's formatting often reaches past the table)
  while (names.length > 0 && names.at(-1) === '') names.pop();
  if (names.length === 0) refuse('status.data.fileEmpty', { name: file });
  const blank = names.indexOf('');
  if (blank >= 0) refuse('status.data.fileHeaderBlank', { name: file, column: blank + 1 });
  const seen = new Set<string>();
  for (const name of names) {
    const folded = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (seen.has(folded) || ['__proto__', 'constructor', 'prototype'].includes(name)) refuse('status.data.fileHeaderTaken', { name: file, label: name });
    seen.add(folded);
  }
  return names;
}

// A table (its first row the header) as a sheet: each row a record by column name; a row longer than the header is
// refused (a cell with no column would be lost), a shorter one leaves its last columns empty.
function sheetOf(file: string, name: string, table: readonly (readonly FileValue[])[]): Sheet {
  const [head, ...body] = table;
  if (head === undefined) refuse('status.data.fileEmpty', { name: file });
  const columns = headerOf(file, head);
  if (body.length > DATA_LIMITS.rows) refuse('status.data.fileTooLarge', { name: file });
  const rows = body.map((cells, index) => {
    const filled = cells.length - [...cells].reverse().findIndex((cell) => cell !== '');
    if (cells.some((cell) => cell !== '') && filled > columns.length) refuse('status.data.fileWide', { name: file, row: index + 2, count: columns.length });
    const row: Record<string, FileValue> = {};
    columns.forEach((column, i) => {
      const cell = cells[i];
      if (cell !== undefined && cell !== '') row[column] = cell;
    });
    return row;
  });
  return { name, columns, rows };
}

// A sheet read as far as it can be: its problem kept when it cannot.
function attempt(name: string, read: () => Sheet): Sheet {
  try {
    return read();
  } catch (error) {
    if (error instanceof DataRefusal) return { name, columns: [], rows: [], problem: error.refusal };
    throw error;
  }
}

// ---------------------------------------------------------------- CSV, TSV, JSON

function textOf(file: string, bytes: Uint8Array): string {
  try {
    // the decoder drops a byte-order mark at the start (its ignoreBOM is false)
    return decoder.decode(bytes);
  } catch {
    return refuse('status.data.fileEncoding', { name: file });
  }
}

export function readDelimited(file: string, source: string, delimiter: ',' | '\t'): Sheet {
  // a quote opened and never closed swallows the rest of the file into one cell: an odd count of quotes says so
  if (((source.match(/"/g) ?? []).length & 1) === 1) refuse('status.data.fileQuote', { name: file });
  return sheetOf(file, file, csvLines(source, delimiter));
}

// A JSON list of objects (or an object holding one, as Fill from data reads it): its keys are the columns, in the
// order they first appear; a nested value is kept as its JSON text.
export function readJson(file: string, source: string): Sheet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return refuse('status.data.fileJson', { name: file });
  }
  const list = jsonRowList(parsed);
  if (list === undefined || list.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))) refuse('status.data.fileJson', { name: file });
  const objects = list as readonly Record<string, unknown>[];
  if (objects.length === 0) refuse('status.data.fileEmpty', { name: file });
  const columns = headerOf(file, [...new Set(objects.flatMap((row) => Object.keys(row)))]);
  if (objects.length > DATA_LIMITS.rows) refuse('status.data.fileTooLarge', { name: file });
  const rows = objects.map((object) => {
    const row: Record<string, FileValue> = {};
    for (const column of columns) {
      const value = object[column];
      if (value === null || value === undefined || value === '') continue;
      row[column] = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : JSON.stringify(value);
    }
    return row;
  });
  return { name: file, columns, rows };
}

// ---------------------------------------------------------------- XLSX

const descendants = (node: XmlElement, name: string): XmlElement[] => [...(node.name === name ? [node] : []), ...node.children.flatMap((child) => descendants(child, name))];

// The index of a cell's column from its reference ("C7" is 2).
function columnIndex(file: string, reference: string): number {
  const letters = /^([A-Z]{1,3})\d+$/.exec(reference)?.[1];
  if (letters === undefined) return refuse('status.data.fileSheet', { name: file });
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return value - 1;
}

// A spreadsheet is an archive read within the data limits (core/project/zip.ts checks the directory before anything
// is unpacked and counts the bytes as they inflate): too many entries or more unpacked bytes than the limit refuse the
// file as too large, a path that climbs out of the archive or a broken one as no spreadsheet.
const SHEET_LIMITS: ArchiveLimits = { ...ARCHIVE_LIMITS, entries: DATA_LIMITS.entries, entryBytes: DATA_LIMITS.unpacked, totalBytes: DATA_LIMITS.unpacked };

// The built-in number formats that show a date (ECMA-376 18.8.30), and a custom format that writes a day or a year.
const DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
const dateFormat = (code: string): boolean => /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));

// A spreadsheet date serial as YYYY-MM-DD: days from 1899-12-30 (the 1900 system, whose day 60 is the 29 February 1900
// that never was), or from 1904-01-01.
function dateOf(file: string, cell: string, serial: number, from1904: boolean): string {
  if (!from1904 && serial >= 60 && serial < 61) refuse('status.data.fileCellError', { name: file, cell, error: '#VALUE!' });
  const days = Math.floor(from1904 ? serial : serial < 60 ? serial + 1 : serial);
  const date = new Date((from1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + days * 86_400_000);
  if (Number.isNaN(date.valueOf())) refuse('status.data.fileCellError', { name: file, cell, error: '#NUM!' });
  return date.toISOString().slice(0, 10);
}

async function readSpreadsheet(file: string, bytes: Uint8Array, xml: XmlReader): Promise<DataFile> {
  let archive: Map<string, Uint8Array>;
  try {
    archive = await unzip(bytes, SHEET_LIMITS);
  } catch (error) {
    return refuse(error instanceof ArchiveError && error.limit ? 'status.data.fileTooLarge' : 'status.data.fileSheet', { name: file });
  }
  const part = (path: string): XmlElement | null => {
    const entry = archive.get(path);
    if (entry === undefined) return null;
    const source = textOf(file, entry);
    // a document type or an entity is never a spreadsheet's: refused before any XML reader sees it
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) refuse('status.data.fileSheet', { name: file });
    try {
      return xml(source);
    } catch {
      return refuse('status.data.fileSheet', { name: file });
    }
  };
  const workbook = part('xl/workbook.xml');
  const relations = part('xl/_rels/workbook.xml.rels');
  if (workbook === null || relations === null) return refuse('status.data.fileSheet', { name: file });
  const shared = (() => {
    const strings = part('xl/sharedStrings.xml');
    return strings === null ? [] : descendants(strings, 'si').map((si) => descendants(si, 't').map((t) => t.text).join(''));
  })();
  const styles = part('xl/styles.xml');
  const custom = new Map((styles === null ? [] : descendants(styles, 'numFmt')).map((f) => [Number(f.attributes.numFmtId), f.attributes.formatCode ?? '']));
  const cellFormats = styles === null ? [] : (descendants(styles, 'cellXfs')[0]?.children ?? []).map((xf) => Number(xf.attributes.numFmtId ?? 0));
  const isDate = (style: number): boolean => {
    const format = cellFormats[style] ?? 0;
    return DATE_FORMATS.has(format) || dateFormat(custom.get(format) ?? '');
  };
  const from1904 = ['1', 'true'].includes(descendants(workbook, 'workbookPr')[0]?.attributes.date1904 ?? '');

  const sheets = descendants(workbook, 'sheet').map((sheet): Sheet => {
    const name = sheet.attributes.name ?? '';
    return attempt(name, () => {
      const relation = Object.entries(sheet.attributes).find(([key]) => key === 'r:id' || key.endsWith(':id'))?.[1];
      const target = descendants(relations, 'Relationship').find((r) => r.attributes.Id === relation);
      if (target === undefined) refuse('status.data.fileSheet', { name: file });
      if (target.attributes.TargetMode === 'External') refuse('status.data.fileExternal', { name: file });
      const path = (target.attributes.Target ?? '').replace(/^\//, '');
      const worksheet = part(path.startsWith('xl/') ? path : `xl/${path}`);
      if (worksheet === null) refuse('status.data.fileSheet', { name: file });
      const table = descendants(worksheet, 'row').map((row) => {
        const cells: FileValue[] = [];
        for (const cell of row.children.filter((child) => child.name === 'c')) {
          const reference = cell.attributes.r ?? '';
          const index = columnIndex(file, reference);
          const raw = descendants(cell, 'v')[0]?.text ?? '';
          const kind = cell.attributes.t ?? 'n';
          const formula = descendants(cell, 'f').length > 0;
          if (formula && raw === '' && kind !== 'inlineStr') refuse('status.data.fileFormula', { name: file, cell: reference });
          let value: FileValue = '';
          if (kind === 's') {
            const text = shared[Number(raw)];
            if (text === undefined) refuse('status.data.fileSheet', { name: file });
            value = text;
          } else if (kind === 'inlineStr') value = descendants(cell, 't').map((t) => t.text).join('');
          else if (kind === 'str' || kind === 'd') value = raw;
          else if (kind === 'b') value = raw === '1';
          else if (kind === 'e') refuse('status.data.fileCellError', { name: file, cell: reference, error: raw });
          else if (raw !== '') {
            const number = Number(raw);
            if (!Number.isFinite(number)) refuse('status.data.fileSheet', { name: file });
            value = isDate(Number(cell.attributes.s ?? 0)) ? dateOf(file, reference, number, from1904) : number;
          }
          // a sparse row leaves the cells it skips empty
          while (cells.length < index) cells.push('');
          cells[index] = value;
        }
        return cells;
      });
      const filled = table.filter((cells) => cells.some((cell) => cell !== ''));
      return sheetOf(file, name, filled);
    });
  });
  if (sheets.length === 0) refuse('status.data.fileEmpty', { name: file });
  return { name: file, sheets };
}

// ---------------------------------------------------------------- one entry

// A data file by its name's extension: its sheets (one for CSV, TSV and JSON), or a refusal saying why it cannot be
// read. The XML reader is needed for a spreadsheet only.
export async function readDataFile(name: string, bytes: Uint8Array, xml: XmlReader): Promise<DataFile> {
  if (!isDataName(name)) refuse('status.data.fileType', { name });
  if (bytes.length > DATA_LIMITS.bytes) refuse('status.data.fileTooLarge', { name });
  switch (extension(name)) {
    case 'xlsx':
      return readSpreadsheet(name, bytes, xml);
    case 'json':
      return { name, sheets: [readJson(name, textOf(name, bytes))] };
    default:
      return { name, sheets: [readDelimited(name, textOf(name, bytes), extension(name) === 'tsv' ? '\t' : ',')] };
  }
}

// The same, for the door that hands the file over (door.tsx, fileReading "data"): never throws, a refusal is kept as
// the file's problem, which the preview command says.
export async function readDataFileSafely(name: string, bytes: Uint8Array, xml: XmlReader): Promise<DataFile | { readonly name: string; readonly problem: Message }> {
  try {
    return await readDataFile(name, bytes, xml);
  } catch (error) {
    if (error instanceof DataRefusal) return { name, problem: error.refusal };
    return { name, problem: message('status.data.fileSheet', { name }) };
  }
}

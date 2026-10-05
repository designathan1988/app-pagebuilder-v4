// The project's breakpoints (spec project-breakpoints; the plan's stage 2): the screen widths a project's styles
// cascade through, wider to narrower. properties.json's table is the default every project starts with; a project that
// adds, renames, resizes or removes a breakpoint keeps its own table in the document (DocumentJson.breakpoints) and
// every reader takes that one: the validator, the cascade, the canvas, the export's media queries, the editor's tabs.
//  - A breakpoint is an id (stable: styles are stored under it), a name (null for a default, which is named in the
//    person's language; a person's own name otherwise), a width (the widest screen it holds; the base holds every
//    width above the others), a height (the screen the canvas shows it at) and whether it is the base.
//  - The table is ordered from the widest: the base first, then descending widths, each width once.
//  - A project without a table of its own uses the default, so a document saved before this existed opens as it was.
import { manifest } from '../../manifest/runtime.ts';
import type { MessageId } from '../../generated/ids.ts';
import { MAX_BREAKPOINT_WIDTH, MIN_BREAKPOINT_WIDTH, type ProjectBreakpoint, type Tabled } from './breakpoint-rules.ts';

export * from './breakpoint-rules.ts';

// the default table (properties.json), the same object every time so the rules derived from it are cached once
export const DEFAULT_BREAKPOINTS: readonly ProjectBreakpoint[] = manifest.properties.breakpoints.map(({ id, width, height, base }) => ({ id, name: null, width, height, base }));

// the table the project uses: its own, else the default
export const breakpointsOf = (document: Tabled): readonly ProjectBreakpoint[] => document.breakpoints ?? DEFAULT_BREAKPOINTS;

export const baseBreakpointOf = (document: Tabled): ProjectBreakpoint => {
  const base = breakpointsOf(document).find((b) => b.base);
  if (base === undefined) throw new Error('the project has no base breakpoint');
  return base;
};

export const breakpointById = (document: Tabled, id: string): ProjectBreakpoint | undefined => breakpointsOf(document).find((b) => b.id === id);

// The breakpoint a screen of this width is shown with: the narrowest whose width still holds it, else the base.
export function breakpointAtWidth(document: Tabled, width: number): ProjectBreakpoint {
  const table = breakpointsOf(document);
  return [...table].reverse().find((b) => !b.base && width <= b.width) ?? baseBreakpointOf(document);
}

// A default's catalogue label (properties.json), null for a breakpoint the person made
const defaultLabelOf = (id: string): MessageId | null => (manifest.properties.breakpoints.find((b) => b.id === id)?.labelKey as MessageId | undefined) ?? null;

// The words that name a breakpoint in a message: a default's catalogue label, else the person's name.
export function breakpointWords(breakpoint: ProjectBreakpoint): { readonly key: MessageId } | string {
  if (breakpoint.name !== null) return breakpoint.name;
  const label = defaultLabelOf(breakpoint.id);
  return label === null ? breakpoint.id : { key: label };
}

// Those words in the person's language.
export const wordsOf = (said: { readonly key: MessageId } | string, words: (key: MessageId) => string): string => (typeof said === 'string' ? said : words(said.key));

// The name a breakpoint is shown with, in the person's language.
export const breakpointName = (breakpoint: ProjectBreakpoint, words: (key: MessageId) => string): string => wordsOf(breakpointWords(breakpoint), words);

// ---- Changing the table (the editor's breakpoint commands: editor/view/breakpoint-table.ts) ----

// Why a change of the table is refused: a message key of the status bar and its parameters.
export interface TableRefusal {
  readonly refused: 'widthRange' | 'widthTaken' | 'widthOrder' | 'nameEmpty' | 'nameTaken' | 'baseStays' | 'usedByMotion';
  readonly params: Readonly<Record<string, string | number | { readonly key: MessageId }>>;
}

const refuse = (refused: TableRefusal['refused'], params: TableRefusal['params'] = {}): TableRefusal => ({ refused, params });

// The widths a breakpoint may take where it stands: above the next narrower one and below the next wider one (the base
// holds every width above the others, up to the widest screen the canvas shows).
function widthRangeOf(table: readonly ProjectBreakpoint[], id: string): { readonly min: number; readonly max: number } {
  const at = table.findIndex((b) => b.id === id);
  const wider = table[at - 1];
  const narrower = table[at + 1];
  return { min: narrower === undefined ? MIN_BREAKPOINT_WIDTH : narrower.width + 1, max: wider === undefined ? MAX_BREAKPOINT_WIDTH : wider.width - 1 };
}

// A breakpoint added at a width: placed by its width among the others, below the base, with the screen height of the
// nearest one and a fresh id; `name` is the person's, else `named` (the catalogue's "Screen 834").
export function addedTable(
  table: readonly ProjectBreakpoint[],
  width: number,
  name: string | null,
  named: string,
  words: (key: MessageId) => string
): { readonly table: readonly ProjectBreakpoint[]; readonly added: ProjectBreakpoint } | TableRefusal {
  const base = table.find((b) => b.base) ?? table[0];
  if (base === undefined) throw new Error('breakpoints: the table has no base');
  const max = base.width - 1;
  if (!Number.isInteger(width) || width < MIN_BREAKPOINT_WIDTH || width > max) return refuse('widthRange', { min: MIN_BREAKPOINT_WIDTH, max });
  const same = table.find((b) => b.width === width);
  if (same !== undefined) return refuse('widthTaken', { width, name: breakpointWords(same) });
  const typed = name?.trim() ?? '';
  const taken = new Set(table.map((b) => breakpointName(b, words).toLocaleLowerCase()));
  if (typed !== '' && taken.has(typed.toLocaleLowerCase())) return refuse('nameTaken', { name: typed });
  let chosen = typed !== '' ? typed : named;
  for (let n = 2; taken.has(chosen.toLocaleLowerCase()); n += 1) chosen = `${named} ${n}`;
  const ids = new Set(table.map((b) => b.id));
  let id = `screen-${width}`;
  for (let n = 2; ids.has(id); n += 1) id = `screen-${width}-${n}`;
  const nearest = [...table].sort((a, b) => Math.abs(a.width - width) - Math.abs(b.width - width))[0] ?? base;
  const added: ProjectBreakpoint = { id, name: chosen, width, height: nearest.height, base: false };
  return { table: [...table, added].sort((a, b) => (a.base ? -1 : b.base ? 1 : b.width - a.width)), added };
}

// A breakpoint renamed: a name no other breakpoint shows; a default given its own catalogue label back is a default
// again (it follows the person's language).
export function renamedTable(table: readonly ProjectBreakpoint[], id: string, name: string, words: (key: MessageId) => string): readonly ProjectBreakpoint[] | TableRefusal {
  const typed = name.trim();
  if (typed === '') return refuse('nameEmpty');
  if (table.some((b) => b.id !== id && breakpointName(b, words).toLocaleLowerCase() === typed.toLocaleLowerCase())) return refuse('nameTaken', { name: typed });
  const label = defaultLabelOf(id);
  const next = label !== null && words(label) === typed ? null : typed;
  return table.map((b) => (b.id === id ? { ...b, name: next } : b));
}

// A breakpoint given another width, between its neighbours (the cascade's order stays: styles keep their meaning).
export function resizedTable(table: readonly ProjectBreakpoint[], id: string, width: number): readonly ProjectBreakpoint[] | TableRefusal {
  const held = table.find((b) => b.id === id);
  if (held === undefined) throw new Error(`breakpoints: no breakpoint ${id}`);
  const { min, max } = widthRangeOf(table, id);
  if (!Number.isInteger(width) || width < min || width > max) return refuse('widthOrder', { name: breakpointWords(held), min, max });
  return table.map((b) => (b.id === id ? { ...b, width } : b));
}

// What a document holds at a breakpoint, when it goes: every styles record (elements, classes, components) and every
// grid setting at it is dropped, or moved `into` another breakpoint (where that one sets nothing of its own: its own
// values win); a motion's list of breakpoints forgets it or names the other one instead. Without `into`, refused
// while a motion runs only there or is started by it (a person removes that first, or moves it).
export function documentWithout(document: DocumentLike, id: string, into: string | null = null): { readonly document: DocumentLike } | TableRefusal {
  let used = false;
  const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  // a record by breakpoint (an element's styles, a grid's settings) without the breakpoint, its values moved `into`
  // the other one under what that one holds (by state, or by setting)
  const byBreakpoint = (record: Record<string, unknown>, deep: boolean): Record<string, unknown> => {
    const { [id]: held, ...rest } = record;
    if (into === null || held === undefined) return rest;
    const there = rest[into];
    if (!isRecord(held) || !isRecord(there)) return { ...rest, [into]: there ?? held };
    const merged: Record<string, unknown> = { ...held, ...there };
    if (deep) for (const [state, values] of Object.entries(held)) if (isRecord(values) && isRecord(there[state])) merged[state] = { ...values, ...there[state] };
    return { ...rest, [into]: merged };
  };
  const strip = (value: unknown, key: string | null): unknown => {
    if (Array.isArray(value)) {
      if (key === 'breakpoints' && value.every((v) => typeof v === 'string')) {
        if (!value.includes(id)) return value;
        if (into !== null) return value.includes(into) ? value.filter((v) => v !== id) : value.map((v) => (v === id ? into : v));
        if (value.length === 1) used = true;
        return value.filter((v) => v !== id);
      }
      return value.map((v) => strip(v, null));
    }
    if (!isRecord(value)) return value;
    if (value.kind === 'breakpoint' && value.breakpoint === id) {
      if (into === null) used = true;
      else return { ...value, breakpoint: into };
    }
    // a page's grids: each grid's settings by breakpoint (a grid left with no breakpoint goes, and the record with it
    // when no grid is left)
    if (key === 'grid')
      return Object.fromEntries(
        Object.entries(value)
          .map(([grid, held]) => [grid, isRecord(held) ? byBreakpoint(held, false) : held] as const)
          .filter(([, held]) => !(isRecord(held) && Object.keys(held).length === 0)),
      );
    if (key === 'styles') return Object.fromEntries(Object.entries(byBreakpoint(value, true)).map(([name, held]) => [name, strip(held, name)]));
    const out: Record<string, unknown> = {};
    for (const [name, held] of Object.entries(value)) {
      const kept = strip(held, name);
      if (name === 'grid' && isRecord(kept) && Object.keys(kept).length === 0) continue;
      out[name] = kept;
    }
    return out;
  };
  const { breakpoints: _table, ...rest } = document;
  void _table;
  const next = strip(rest, null) as DocumentLike;
  return used ? refuse('usedByMotion', {}) : { document: next };
}

// the document as the table's changes read it: any JSON record with its pages
export type DocumentLike = Readonly<Record<string, unknown>>;

export const isRefusal = (value: unknown): value is TableRefusal => value !== null && typeof value === 'object' && 'refused' in value;

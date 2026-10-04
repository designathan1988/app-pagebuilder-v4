// The page's layout grids (INVENTORY.md, owners; spec layout-grid-overlay): the column grid, the row grid
// and the dot grid, each shown or hidden by its toggle. Whether one is shown is a setting of the page, stored on the
// page root (the attributes gridColumns, gridRows, gridDots of elements.json, which write nothing to the HTML), so
// it is saved with the document, undone as one step and never exported. Each toggle stands for its grid being shown.
// The grids are drawn by the canvas chrome (src/editor/canvas/grid-overlay.tsx) at the page's settings (below).
import { openedPage, pageShown } from '../project/pages.ts';
import { message, registerHandler, type Outcome } from '../commands/registry.ts';
import type { DocumentJson } from '../document/model.ts';
import type { MessageId } from '../../generated/ids.ts';
import { numberConstant, numberConstantAt, pairConstant } from '../../manifest/runtime.ts';
import { settingOf, settingsOf, type GridName } from './grid-settings.ts';
import { baseBreakpointOf, breakpointName } from '../document/breakpoints.ts';
import { argumentRefused } from '../store/args.ts';

export type Grid = 'gridColumns' | 'gridRows' | 'gridDots' | 'foldLines';

export const gridShown = (state: { readonly document: DocumentJson; readonly ui?: unknown }, grid: Grid): boolean => pageShown(state)?.tree.attributes[grid] === true;

function toggled(state: { readonly document: DocumentJson; readonly ui?: unknown }, grid: Grid, shown: MessageId, hidden: MessageId): Outcome<never> {
  const at = openedPage(state);
  if (state.document.pages[at] === undefined) throw new Error('grid: the document has no page');
  const path = ['pages', at, 'tree', 'attributes', grid];
  return gridShown(state, grid) ? { kind: 'change', patches: [{ op: 'remove', path }], message: message(hidden) } : { kind: 'change', patches: [{ op: 'add', path, value: true }], message: message(shown) };
}

export const toggleColumns = registerHandler(
  'grid.toggleColumns',
  ({ state }) => toggled(state, 'gridColumns', 'status.grid.columnsShown', 'status.grid.columnsHidden'),
  (state) => gridShown(state, 'gridColumns'),
);
export const toggleRows = registerHandler(
  'grid.toggleRows',
  ({ state }) => toggled(state, 'gridRows', 'status.grid.rowsShown', 'status.grid.rowsHidden'),
  (state) => gridShown(state, 'gridRows'),
);
export const toggleDots = registerHandler(
  'grid.toggleDots',
  ({ state }) => toggled(state, 'gridDots', 'status.grid.dotsShown', 'status.grid.dotsHidden'),
  (state) => gridShown(state, 'gridDots'),
);
// the fold lines (the user's real-use audit, item 2.3): where each screen ends, drawn by the canvas chrome
export const toggleFolds = registerHandler(
  'grid.toggleFolds',
  ({ state }) => toggled(state, 'foldLines', 'status.grid.foldsShown', 'status.grid.foldsHidden'),
  (state) => gridShown(state, 'foldLines'),
);
// The fold lines a page of this height has: one at each whole screen, the first at the first screen's end (a page
// 3000px tall on a 900px screen has folds at 900, 1800 and 2700, labelled Fold 1, Fold 2 and Fold 3).
export function foldLines(pageHeight: number, screen: number): readonly number[] {
  if (screen <= 0 || pageHeight <= 0) return [];
  const folds: number[] = [];
  for (let at = screen; at < pageHeight; at += screen) folds.push(at);
  return folds;
}

// The grids' settings (spec workspace-settings-dialog): the page's `grid` holds those a person set in Guides & Grids;
// the others take their defaults of interactions.json. grid.setSettings keeps one setting of one grid, a number
// within its range (whole, for a count of columns); outside it, refused naming the setting and its range, and nothing
// changes (Problems in Pager 1: Pager clamped it silently). One undo step.
export function gridSetting(document: DocumentJson, grid: GridName, setting: string, breakpoint: string, page: number): number {
  const facts = settingOf(grid, setting);
  if (facts === undefined) throw new Error(`grid: the ${grid} grid has no setting ${setting}`);
  return heldIn(document, page, grid, setting, breakpoint) ?? defaultOf(facts.byDefault, breakpoint);
}

// The default of a setting at a breakpoint: its own constant where interactions.json has one (grid.columns.tablet),
// else the base one — the one reader of the per-breakpoint naming is runtime's numberConstantAt. The user's real-use
// audit, A1.6: one setting for every breakpoint left the Phone and the Tablet with no column grid at all.
const defaultOf = (byDefault: string, breakpoint: string): number => numberConstantAt(byDefault, breakpoint) ?? numberConstant(byDefault);

// Where a setting is held: the breakpoint's own record, or, in a document written before the grids went per
// breakpoint, the flat record (which then reads as the base breakpoint's).
function heldIn(document: DocumentJson, page: number, grid: GridName, setting: string, breakpoint: string): number | undefined {
  const held = document.pages[page]?.tree.grid?.[grid] as Readonly<Record<string, unknown>> | undefined;
  const at = held?.[breakpoint] as Readonly<Record<string, number>> | undefined;
  const flat = baseBreakpointId() === breakpoint ? (held?.[setting] as number | undefined) : undefined;
  const value = typeof at?.[setting] === 'number' ? at[setting] : flat;
  return typeof value === 'number' ? value : undefined;
}
// the breakpoint the base styles live at (the base is the same in every project's table): where a document's flat grid
// settings read from
const baseBreakpointId = (): string => baseBreakpointOf({}).id;

export const setGridSettings = registerHandler('grid.setSettings', ({ state, rules, words }, { grid, setting, value }): Outcome<never> => {
  // the write lands at the breakpoint in force, as every style write does (A3.8; A1.6)
  const facts = settingOf(grid, setting);
  const page = pageShown(state);
  if (facts === undefined) return { kind: 'refused', message: argumentRefused('setting') };
  if (page === undefined) throw new Error('grid: the document has no page');
  const label = words(facts.labelKey as MessageId);
  const [min, max] = pairConstant(facts.range);
  const next = setting === 'count' ? Math.round(value) : value;
  if (!Number.isFinite(next) || next < min || next > max) return { kind: 'refused', message: message('status.grid.outOfRange', { setting: label, min, max }) };
  const breakpoint = rules.base.breakpoint;
  const shown = rules.breakpointTable.find((b) => b.id === breakpoint);
  const said = breakpoint === rules.baseLayer.breakpoint || shown === undefined ? message('status.grid.set', { setting: label, value: next }) : message('status.grid.setAt', { setting: label, value: next, breakpoint: breakpointName(shown, words) });
  if (page === null) throw new Error('grid: the document has no page');
  const held = page.tree.grid;
  const at = (held?.[grid] as Readonly<Record<string, Readonly<Record<string, number>>>> | undefined)?.[breakpoint];
  if (at?.[setting] === next) return { kind: 'change', message: said };
  const settings = { ...held, [grid]: { ...held?.[grid], [breakpoint]: { ...at, [setting]: next } } };
  const path = ['pages', openedPage(state), 'tree', 'grid'];
  return { kind: 'change', patches: [held === undefined ? { op: 'add', path, value: settings } : { op: 'replace', path, value: settings }], message: said };
});

// The grids' lines in page px from the page's top-left corner, at the page's settings (the overlay draws them, the
// snapping pulls edges to them).
interface Columns {
  readonly count: number;
  readonly width: number;
  readonly gutter: number;
  readonly margin: number;
}

// the column bands across a page this wide
export function columnBands(pageWidth: number, grid: Columns): { readonly x: number; readonly width: number }[] {
  const inset = Math.max(grid.margin, (pageWidth - grid.width) / 2);
  const band = pageWidth - 2 * inset;
  const width = (band - grid.gutter * (grid.count - 1)) / grid.count;
  if (width <= 0) return [];
  return Array.from({ length: grid.count }, (_, i) => ({ x: inset + i * (width + grid.gutter), width }));
}

// each grid's settings now, by name (the defaults where the page sets none)
const settingsNow = (document: DocumentJson, grid: GridName, breakpoint: string, page: number): Readonly<Record<string, number>> => Object.fromEntries(settingsOf(grid).map(([name]) => [name, gridSetting(document, grid, name, breakpoint, page)]));
export const columnsOf = (document: DocumentJson, breakpoint: string, page: number): Columns => settingsNow(document, 'columns', breakpoint, page) as unknown as Columns;
export const rowsOf = (document: DocumentJson, breakpoint: string, page: number): { readonly height: number; readonly gutter: number } => settingsNow(document, 'rows', breakpoint, page) as unknown as { height: number; gutter: number };
export const dotsOf = (document: DocumentJson, breakpoint: string, page: number): { readonly spacing: number } => settingsNow(document, 'dots', breakpoint, page) as unknown as { spacing: number };

// the row bands down a page this tall: each band's top
export function rowBands(pageHeight: number, height: number, gutter: number): number[] {
  const tops: number[] = [];
  if (!(height + gutter > 0)) return tops;
  for (let y = 0; y < pageHeight; y += height + gutter) tops.push(y);
  return tops;
}

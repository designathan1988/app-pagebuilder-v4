// The scenario runner (PRODUCT.md §5): npm run e2e is generated from the manifest's scenarios. One Playwright test
// per scenario and per door of its `doors`, on the installed Chrome: the fixture loaded through File › Open, the setup
// through doors (the language, the selection clicked on the canvas or, for a node its children cover whole, reached
// with ArrowUp from inside it or through its Layers row, the breakpoint, the style state, the zoom),
// every step through its door with the real mouse and keyboard (a click on the node it targets, a drag released
// where its drop says or held across the next steps, a marquee drawn from its target's empty area to its drop's node,
// the characters it types, into the text edited in place or the field a door opened, such as the link prompt; an
// inspector field clicked, what it holds selected, then typed into; a paste reads the system clipboard, which the
// setup allows and empties), then the end terminals the scenario
// names: the document diff, the selection and the history read through the read-only test port, computed style and
// geometry inside the frame, the feedback in the status bar, the editor's regions, storage after an immediate
// reload, and the refusals. After the setup and after the steps the canvas must draw the document the port reads;
// when it does not, the test fails on that assertion, never on a timeout.
// A feature runs once it is registered as built in the feature table (src/app/features.ts); the others are reported
// as not built by the status reporter (tools/runner/status.ts), which derives each feature's status from the results.
// A registered feature must have scenarios, every command it lists built (a registered handler) and every door its
// scenarios' setups, steps and Undo and Redo run working (`blockers`): the census fails one that does not. The tooth
// proof (tools/runner/tooth.ts) runs a feature's tests with its handlers, or the module it names, made no-ops
// (tools/runner/tooth-plugin.ts) and requires every one of them to fail on an assertion.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Locator, type Page } from '../../tests/support/test.ts';
import { isFeatureBuilt } from '../../src/app/features.ts';
import { shortcutRuns } from '../../src/editor/input/shortcut-rule.ts';
import type { FeatureId } from '../../src/generated/ids.ts';
import { EMPTY_FIXTURE, applyDiff, matchDocument, refusalCheck, resolveNode, type DiffOp } from '../../src/manifest/scenario.ts';
import type { CapturedNode, CapturedPage } from '../../src/core/document/captured.ts';
import { capturedAt } from '../../src/core/render/captured.ts';
import { barLabel, control, door as doorData, focusContext, inQuickPanel, keys, modifiedControl, openCommandBar, openMenu, openQuickPanel, openStyleControl, openValueMenu, runDoor, standingControl, type Door } from '../../tests/e2e/door.ts';
import { openEditor } from '../../tests/support/editor.ts';
import { unzip } from './unzip.ts';
import { COMPANION_KEY, startCompanion } from './companion.ts';
import { LAYOUT_GESTURES, driveLayout } from './layout-composer.ts';
import { headlessProven, leftOut, PROVEN_HEADLESS, runName } from './balance.ts';

type Measure = 'x' | 'y' | 'width' | 'height';
type Relation = 'equals' | 'less-than' | 'greater-than';
interface Drop {
  readonly placement: 'before' | 'after' | 'inside';
  readonly reference: string;
  // over the node's Layers row instead of the canvas (a palette tile dropped on a row)
  readonly on?: 'canvas' | 'layers-row';
}
interface Step {
  readonly door: string;
  // a pause after the step, for a held drag at an edge to scroll (spec drag-autoscroll)
  readonly wait?: number;
  readonly args: Record<string, unknown>;
  readonly target: string | null;
  readonly drop: Drop | null;
  readonly action: boolean;
  readonly hold?: boolean;
  readonly type?: string | null;
  // the button the step presses in the confirmation its command asks
  readonly answer?: 'confirm' | 'cancel' | null;
}
interface Scenario {
  readonly id: string;
  readonly setup: { fixture: string; selection: string[]; context: string; breakpoint: string; state: string; locale: string; viewport: string; zoom: 'fit' | number; storage?: 'corrupt-current-record'; tabs?: 'another-tab-editing'; clipboard?: 'denied' | { html?: string; text?: string }; companion?: 'running' | 'paired' };
  readonly steps: readonly Step[];
  readonly doors: readonly string[];
  readonly expect: {
    document: DiffOp[];
    selection: string[];
    history: { undoSteps: number };
    render: {
      computed: { node: string; property: string; value: string }[];
      geometry: { node: string; measure: Measure; relation: Relation; value: number; reference: string | null }[];
      feedback: { key: string; params: Record<string, string | number> }[];
    } | null;
    // the pointer resting on a node once the steps are done (spec hover-measure; schema.ts)
    hover?: { node: string; at: 'centre' | 'corner'; alt: boolean; shows: { region: string; key: string; params: Record<string, string | number> }[] };
    editor: { regions: { region: string; measure: Measure; relation: Relation; value: number; reference: string | null }[]; computed: { region: string; property: string; value: string }[] } | null;
    persistence: { document: 'same' | null; preferences: 'same' | null; selection?: 'same' | null; workspace?: 'same' | null } | null;
    // the files inside the archive the action step handed out: each holds every `present` text and no `absent` one
    export: { files: { path: string; present: string[]; absent: string[]; absentPattern?: string[] }[] } | null;
  };
  readonly refusals: { key: string }[];
}
export interface Feature {
  readonly id: string;
  readonly commands: readonly string[];
  readonly toothProof?: string;
  readonly scenarios: readonly Scenario[];
}

const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
export const FEATURES: Feature[] = fs
  .readdirSync('manifest/features')
  .filter((f) => /^\d\d-.*\.json$/.test(f))
  .sort()
  .flatMap((f) => (read(path.join('manifest/features', f)) as { features: Feature[] }).features);
const references = (read('manifest/references.json') as { references: { kind: string; id: string; status: string }[] }).references;
const BUILT = new Set(references.filter((r) => r.kind === 'handler' && r.status === 'registered').map((r) => r.id));
const environment = read('manifest/environment.json') as { viewports: { id: string; width: number; height: number }[]; locales: { default: string } };
const properties = read('manifest/properties.json') as { breakpoints: { id: string; base: boolean }[]; states: { id: string; pseudo: string | null }[] };
const elements = read('manifest/elements.json') as { elements: { id: string; content: string }[] };
const interactions = read('manifest/interactions.json') as {
  keyContexts: { id: string; inherits: string | null; absorbsFields: boolean }[];
  constants: { id: string; value: unknown; source: string }[];
  gestures: { id: string; source: string; modifiers: { key: string; meaning: string }[] }[];
};
const COMMANDS = fs
  .readdirSync('manifest/commands')
  .flatMap(
    (f) =>
      (
        read(path.join('manifest/commands', f)) as {
          commands: { id: string; introducedBy: string; args: Record<string, { type: string }>; refusals: string[]; availability: { refusalKey: string | null }; history: { undoable: boolean }; entryPoints: Door[] }[];
        }
      ).commands,
  );
// The commands that replace the whole document, the only actions whose page and root ids are not compared (the user's
// order of 2026-09-26): File › Open, File › New blank page, the recovery dialog's Restore (each loads a document:
// outcome `load`), and Open folder, which replaces the project with a folder's files.
// How often a poll asks again: every frame or two, not Playwright's 100, 250, 500 then 1000 ms, which made a setup
// that waits for File › Open or the canvas wait a quarter of a second more than the editor took (the timeout still
// bounds every poll)
const POLL = [16, 32, 64, 100];
const DOCUMENT_REPLACING: ReadonlySet<string> = new Set(['project.open', 'project.newBlankPage', 'project.restoreVersion', 'project.openFolder']);

// a document with its pages' and their roots' ids left out, so a match does not compare them
function withoutPageIds(document: unknown): unknown {
  const doc = document as { pages?: { id?: unknown; tree?: { id?: unknown } }[] };
  if (!Array.isArray(doc.pages)) return document;
  return {
    ...doc,
    pages: doc.pages.map((page) => {
      const { id: _page, tree, ...rest } = page;
      void _page;
      if (tree === undefined) return rest;
      const { id: _root, ...root } = tree;
      void _root;
      return { ...rest, tree: root };
    }),
  };
}
const BASE_BREAKPOINT = properties.breakpoints.find((b) => b.base)?.id;
const BASE_STATE = properties.states.find((s) => s.pseudo === null)?.id;
const CONTENT = new Map(elements.elements.map((e) => [e.id, e.content]));
// the splitters layout.json declares, by name (spec panel-resize): what a splitter drag drags along
const SPLITTERS = (read('manifest/layout.json') as { splitters: Record<string, { axis: 'x' | 'y' }> }).splitters;
// the panel-drag zones a gesture travels vertically in (the shadow editor's layer rows: the pointer climbs the rows)
const VERTICAL_ZONES: ReadonlySet<string> = new Set(['shadow-rows', 'file-tree']);
const DRAG_THRESHOLD = interactions.constants.find((c) => c.id === 'drag.threshold')?.value;
// Ctrl+wheel multiplies the zoom by exp(−deltaY × this) per event (spec zoom-wheel-pan)
const WHEEL_FACTOR = Number(interactions.constants.find((c) => c.id === 'zoom.wheelFactor')?.value);
// how far inside a child's edge the runner points to reach its escape band: half the band's floor, in screen pixels
const ESCAPE_FLOOR = interactions.constants.find((c) => c.id === 'drop.escapeBandFloor')?.value;
const EDGE_INSET = typeof ESCAPE_FLOOR === 'number' ? ESCAPE_FLOOR / 2 : 3;
// the least extent an empty container is aimed at through, in screen pixels (spec drag-drop-inside, Problems in Pager
// 5)
const EMPTY_AIM = Number(interactions.constants.find((c) => c.id === 'drop.emptyAimMin')?.value);
const commandOf = (ref: string) => ref.split('#')[0] ?? '';
const argTypes = (ref: string) => COMMANDS.find((c) => c.id === commandOf(ref))?.args ?? {};
// whether a door's command takes what the system clipboard holds (clipboard.paste): its door reads the clipboard, which
// the browser answers later, and runs the command then
const readsClipboard = (ref: string) => Object.values(argTypes(ref)).some((arg) => arg.type === 'clipboard');

// the first door of a command whose own arguments set `arg` to `value` (the breakpoint tab of Tablet, the zoom item
// 200)
function settingDoor(command: string, arg: string, value: unknown): string {
  const found = COMMANDS.find((c) => c.id === command)?.entryPoints.find((d) => d.args[arg] === value);
  if (!found) throw new Error(`no door of ${command} sets ${arg} ${String(value)}`);
  return `${command}#${found.id}`;
}
// the canvas click that selects one node, and the one that adds a node to the selection
function canvasClick(command: string): string {
  const found = COMMANDS.find((c) => c.id === command)?.entryPoints.find((d) => d.kind === 'canvas-click' && d.button === 'primary' && d.count === 1);
  if (!found) throw new Error(`${command} has no canvas click`);
  return `${command}#${found.id}`;
}
const SELECT_DOOR = canvasClick('selection.select');
const ADD_DOOR = canvasClick('selection.add');
// the Layers row click that selects one node, and the one that adds a node to the selection (its key held)
function layersRowClick(command: string, modifier: string | null): string {
  const found = COMMANDS.find((c) => c.id === command)?.entryPoints.find((d) => d.kind === 'panel-control' && d.gesture === 'layers-row-click' && (d.modifier ?? null) === modifier);
  if (!found) throw new Error(`${command} has no Layers row click${modifier === null ? '' : ` with ${modifier}`}`);
  return `${command}#${found.id}`;
}
// a node added to the selection through its Layers row: the row's Ctrl+click (selection.toggle, which adds a row not
// selected yet); Shift+click on a row selects the run of rows between (selection.range, jornada03 J17)
const ADD_ROW_DOOR = layersRowClick('selection.toggle', doorData(canvasClick('selection.toggle')).modifier ?? null);
// The door of a canvas click's command on a node's Layers row, pressed with the same button and the same key: how a
// person reaches a node its children cover whole, which has no point of its own on the canvas (spec select-click,
// "Nested elements": the Layers panel). Null when the command has none.
function layersRowDoorOf(ref: string): string | null {
  const d = doorData(ref);
  const found = COMMANDS.find((c) => c.id === commandOf(ref))?.entryPoints.find(
    (o) => o.kind === 'panel-control' && o.panel === 'layers' && (o.modifier ?? null) === (d.modifier ?? null) && (o.button === 'secondary') === (d.button === 'secondary'),
  );
  return found ? `${commandOf(ref)}#${found.id}` : null;
}
// a command's shortcut in a key context
function shortcutIn(command: string, context: string): string {
  const found = COMMANDS.find((c) => c.id === command)?.entryPoints.find((d) => d.kind === 'shortcut' && d.context === context);
  if (!found) throw new Error(`${command} has no shortcut in ${context}`);
  return `${command}#${found.id}`;
}
// ArrowUp on the canvas: the selection's parent; Escape in Layers: the focus back to the canvas
const WALK_UP_DOOR = shortcutIn('selection.walkParent', 'canvas');
const BACK_TO_CANVAS_DOOR = shortcutIn('focus.canvas', 'layers-tree');
const UNDO_DOOR = 'history.undo#toolbar-top-bar';
const REDO_DOOR = 'history.redo#toolbar-top-bar';
// a modal dialog's close button (archive/DESIGN.md "Regions": dialog)
const DIALOG_CLOSE_DOOR = 'ui.dismiss#dialog-close';

// The doors a scenario's setup runs, in order: File › Open for a fixture, the language, the selection (the first node
// clicked, the others added, on the canvas; a node its children cover whole is reached through ArrowUp or its Layers
// row, which the test's annotations name once it runs, ranAlso and ranInstead), the breakpoint, the style state and
// the zoom.
function setupDoors(s: Scenario): string[] {
  const doors: string[] = [];
  if (s.setup.fixture !== EMPTY_FIXTURE) doors.push('project.open#menu-file');
  if (s.setup.locale !== environment.locales.default) doors.push(settingDoor('preferences.setLanguage', 'locale', s.setup.locale));
  s.setup.selection.forEach((_, i) => doors.push(i === 0 ? SELECT_DOOR : ADD_DOOR));
  if (s.setup.breakpoint !== BASE_BREAKPOINT) doors.push(settingDoor('view.setBreakpoint', 'breakpoint', s.setup.breakpoint));
  if (s.setup.state !== BASE_STATE) doors.push(settingDoor('view.setStyleState', 'state', s.setup.state));
  if (s.setup.zoom !== 'fit') doors.push(settingDoor('view.zoomTo', 'percent', s.setup.zoom));
  return doors;
}
// every door a test of the scenario runs through one of its action doors: the setup, the steps, and Undo and Redo,
// which prove every undo step restores the document
function doorsRun(s: Scenario, action: string): string[] {
  return [...setupDoors(s), ...s.steps.map((step) => (step.action ? action : step.door)), ...(s.expect.history.undoSteps > 0 ? [UNDO_DOOR, REDO_DOOR] : [])];
}

// a feature runs once every command it lists, and every command its scenarios' setups, steps and doors run, is built
// a door the scenario runs works: its command is built, and a shortcut runs by the keymap's own rule
const doorWorks = (ref: string) => {
  const command = COMMANDS.find((c) => c.id === commandOf(ref));
  const d = doorData(ref);
  if (command === undefined || !BUILT.has(command.id)) return false;
  return d.kind !== 'shortcut' || shortcutRuns({ command: command.id, introducedBy: command.introducedBy, feature: d.feature }, (id) => BUILT.has(id), (feature) => isFeatureBuilt(feature as FeatureId));
};
// Whether a feature is registered as built (the feature table).
export const registered = (f: Feature) => isFeatureBuilt(f.id as FeatureId);
// Why a feature's scenarios cannot all run: it has none, a command it lists is not built, or a door they run does not
// work yet. Empty when every test of every scenario and door can run.
export function blockers(f: Feature): string[] {
  const found: string[] = [];
  if (f.scenarios.length === 0) found.push('it has no scenarios');
  for (const c of f.commands) if (!BUILT.has(c)) found.push(`its command ${c} is not built`);
  for (const s of f.scenarios) for (const d of s.doors) for (const ref of doorsRun(s, d)) if (!doorWorks(ref)) found.push(`${s.id} runs ${ref}, which does not work yet`);
  return [...new Set(found)];
}
export const runnable = (f: Feature) => registered(f) && blockers(f).length === 0;
export const FEATURE_TAG = (id: string) => `@feature:${id}`;

// the language the editor shows now (the shell writes it on the document element)
const uiLocale = (page: Page) => page.evaluate(() => document.documentElement.lang);
// the language the scenario expects after its steps (the action step run through `action`): the one the last step
// that chooses a language chooses (its door's or its own `locale`), else the setup's
function localeAfter(s: Scenario, action: string, last = s.steps.length - 1): string {
  for (const step of s.steps.slice(0, last + 1).reverse()) {
    const ref = step.action ? action : step.door;
    if (commandOf(ref) !== 'preferences.setLanguage') continue;
    const chosen = doorData(ref).args.locale ?? step.args.locale;
    if (typeof chosen === 'string') return chosen;
  }
  return s.setup.locale;
}

// a message's text, as the app's own i18n runtime writes it (src/i18n/index.ts, re-exported by the served build's
// /proofs.js: tests/support/proofs.ts)
const text = (page: Page, locale: string, key: string, params: Record<string, string | number>) =>
  page.evaluate(
    async ([module, l, k, p]) => {
      const i18n = (await import(/* @vite-ignore */ module)) as { translate: (locale: string, key: string, params: unknown) => string };
      return i18n.translate(l, k, p);
    },
    ['/proofs.js', locale, key, params] as const,
  );

// the region whose door starts the tab again (layout.json: the tab guard's notice)
const TAB_GUARD_REGION = 'tab-guard';
// what the read-only test port reads (src/editor/test-port.ts)
const port = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => unknown; selection: () => string[]; history: () => { undoSteps: number; redoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    return { document: p.document(), selection: p.selection(), history: p.history() };
  });

// The preferences the editor applies, read from what it draws: its language (the document element's lang), its theme
// (data-theme, absent while it follows the system), the inspector sections it draws collapsed, the canvas zoom and
// what the Layers rows show beside their names (layers-row-details). Comparing these before and after a reload proves
// the editor restores its preferences; comparing the stored text with itself would not (the editor writes the
// preferences only when a command changes them).
const SECTION_TOGGLE = 'inspector.toggleSection';
const appliedPreferences = (page: Page) =>
  page.evaluate(
    (toggle) => ({
      locale: document.documentElement.lang,
      theme: document.documentElement.dataset.theme ?? 'system',
      collapsed: [...document.querySelectorAll(`[data-door^="${toggle}#"][aria-expanded="false"]`)].map((el) => (JSON.parse(el.getAttribute('data-args') ?? '{}') as { section?: string }).section ?? ''),
      // the Style tab's concept rows drawn open (inspector.toggleRow)
      openRows: [...document.querySelectorAll('[data-door="inspector.toggleRow#inspector-row-disclosure"][aria-expanded="true"]')].map((el) => (JSON.parse(el.getAttribute('data-args') ?? '{}') as { row?: string }).row ?? ''),
      // the canvas zoom: the CSS zoom of the page's frame (Fit mode refits to the same stage after the reload)
      // and the view switches the canvas draws (Outlines, Zones)
      outlines: document.querySelector('[data-region="canvas-outlines"]') !== null,
      zones: document.querySelector('[data-region="canvas-zones"]') !== null,
      zoom: getComputedStyle(document.querySelector('.frame__page') ?? document.body).zoom,
      // the inspector's mode: the segment pressed (Essentials only, All properties)
      inspectorMode: document.querySelector('[data-door^="inspector.setMode#"][aria-pressed="true"]')?.getAttribute('data-door') ?? null,
      // null while no Layers tree is drawn (another sidebar view is shown): its rows are then compared with nothing
      rowDetails: document.querySelector('[data-region="layers-row"]') === null ? null : [...document.querySelectorAll('[data-region="layers-row-details"]')].map((el) => el.textContent),
    }),
    SECTION_TOGGLE,
  );
// the preferences applied after a reload, with the Layers rows left out when either side draws none, and the
// inspector's mode when either side draws no Style tab (another tab, or no inspector)
const appliedAgain = async (page: Page, before: Awaited<ReturnType<typeof appliedPreferences>>) => {
  const now = await appliedPreferences(page);
  const rows = now.rowDetails === null || before.rowDetails === null ? { ...now, rowDetails: before.rowDetails } : now;
  return rows.inspectorMode === null || before.inspectorMode === null ? { ...rows, inspectorMode: before.inspectorMode } : rows;
};

const compare = (actual: number, relation: Relation, expected: number) =>
  relation === 'equals' ? Math.abs(actual - expected) <= 0.5 : relation === 'less-than' ? actual < expected : actual > expected;

// whether an editor measure holds now (false while a region it names is not laid out): what a reloaded workspace is
// polled for
const editorMeasureHolds = async (page: Page, r: { readonly region: string; readonly measure: 'x' | 'y' | 'width' | 'height'; readonly relation: Relation; readonly value: number; readonly reference: string | null }) => {
  const box = async (id: string) => page.locator(`[data-region="${id}"]`).first().boundingBox();
  const actual = await box(r.region);
  const base = r.reference === null ? { x: 0, y: 0, width: 0, height: 0 } : await box(r.reference);
  return actual !== null && base !== null && compare(actual[r.measure], r.relation, base[r.measure] + r.value);
};

interface Node {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly children: readonly Node[];
}
// the node at a path of the document the port reads
// A scenario names a file its steps hand over by the scheme the chooser and the drop use ("png:photo.png"); what the
// document stores is the bytes the runner handed over, so an expected document names the file and never base64 text.
// the bytes an expected document names: the runner's own PNG or font, or a file of tests/support/folders
// ("file:<id>/<path>", what a folder the steps opened holds; spec explorer-open-folder)
function expectedBytes(value: string): string {
  if (value.startsWith('png:')) return PNG_4x3.toString('base64');
  if (value.startsWith('woff2:')) return WOFF2_TEST.toString('base64');
  if (value.startsWith('file:')) return fs.readFileSync(path.join('tests/support/folders', value.slice('file:'.length))).toString('base64');
  return value;
}

function resolveFileValues<T>(value: T, document?: unknown): T {
  if (Array.isArray(value)) return value.map((each) => resolveFileValues(each, document)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(value as Record<string, unknown>)) out[key] = key === 'bytes' && typeof held === 'string' ? expectedBytes(held) : resolveFileValues(held, document);
    return out as T;
  }
  if (typeof value === 'string' && value.startsWith('@/') && document !== undefined) return nodeAt(document, value.slice(1)).id as unknown as T;
  // '#@/path': a link's anchor as the document keeps it — the fragment with the target's node id (the page writes
  // the target's id attribute instead; the export terminal proves that)
  if (typeof value === 'string' && value.startsWith('#@/') && document !== undefined) return `#${nodeAt(document, value.slice(2)).id}` as unknown as T;
  return value;
}

function nodeAt(document: unknown, nodePath: string): Node {
  const resolved = resolveNode(document, nodePath.split('/').filter((s) => s !== ''));
  if (typeof resolved === 'string') throw new Error(`${nodePath}: ${resolved}`);
  const node = resolved.node as unknown as Node;
  if (typeof node.id !== 'string') throw new Error(`${nodePath} has no id`);
  return node;
}
const idOf = (document: unknown, nodePath: string) => nodeAt(document, nodePath).id;
const isRoot = (document: unknown, nodePath: string) => (resolveNode(document, nodePath.split('/').filter((s) => s !== '')) as { parent: unknown }).parent === null;

// A step's arguments as the app takes them: a node path becomes the node's id in the document now.
function resolveArgs(ref: string, args: Record<string, unknown>, document: unknown): Record<string, unknown> {
  const types = argTypes(ref);
  return Object.fromEntries(Object.entries(args).map(([name, value]) => [name, (types[name]?.type === 'node' || types[name]?.type === 'path') && typeof value === 'string' && value.startsWith('/') ? idOf(document, value) : value]));
}

// The canvas draws one whole page of the document the port reads: the page whose root it draws (pages.switch opens
// one, and the canvas follows it — the manifest's explorer-pages), every node of it and nothing else, in order. No
// canvas drawn at all (the Code view shows the code pane alone) has nothing to check: the frame is the editor's, and
// what the centre column shows there is the pane's own business.
async function canvasProblems(page: Page, document: unknown): Promise<string[]> {
  const pages = (document as { pages: { tree: Node; capture?: CapturedPage }[] }).pages;
  if ((await page.locator('.frame__page').count()) === 0) return [];
  const frame = page.frameLocator('.frame__page');
  if (await frame.locator('html[data-builder-capture]').count() > 0) {
    const width = await frame.locator('html').evaluate((element) => element.clientWidth);
    const drawn = await frame.locator('[data-capture-node]').evaluateAll((els) => els.map((el) => el.getAttribute('data-capture-node')));
    const shown = pages.flatMap((one) => (one.capture === undefined ? [] : [one.capture])).find((one) => one.root.id === drawn[0]);
    if (shown === undefined) return ['a captured page absent from the document is drawn'];
    // the page as the observed width nearest the canvas's showed it (core/render/captured.ts capturedAt)
    const expected: string[] = [];
    const walk = (node: CapturedNode): void => {
      if (node.kind !== 'element') return;
      expected.push(node.id);
      node.children.forEach(walk);
    };
    walk(capturedAt(shown, width));
    return drawn.join() === expected.join() ? [] : [`captured DOM IDs differ: expected ${expected.join(',')}; drawn ${drawn.join(',')}`];
  }
  const drawn = await frame.locator('[data-node]').evaluateAll((els) => els.map((el) => el.getAttribute('data-node')));
  const shown = pages.find((p) => drawn.includes(p.tree.id));
  const problems: string[] = [];
  if (shown === undefined) {
    // nothing of any page is drawn: the canvas draws none, or something the document does not hold
    problems.push(...(drawn.length === 0 ? pages.filter((p) => p.tree !== undefined).slice(0, 1).map((p) => `/${p.tree.name} is not drawn`) : drawn.map((id) => `an element of no page (${id ?? ''}) is drawn`)));
    return problems.length > 0 ? problems : ['no page is drawn'];
  }
  const expected: { id: string; path: string }[] = [];
  const walk = (n: Node, at: string) => {
    expected.push({ id: n.id, path: `${at}/${n.name}` });
    for (const c of n.children) walk(c, `${at}/${n.name}`);
  };
  walk(shown.tree, '');
  problems.push(...expected.filter((e) => !drawn.includes(e.id)).map((e) => `${e.path} is not drawn`));
  const known = new Set(expected.map((e) => e.id));
  problems.push(...drawn.filter((id) => !known.has(id ?? '')).map((id) => `an element of no node (${id ?? ''}) is drawn`));
  if (problems.length === 0 && drawn.join() !== expected.map((e) => e.id).join()) problems.push('the elements are not in the order of the nodes');
  return problems;
}
async function expectCanvasDraws(page: Page, when: string): Promise<void> {
  const { document } = await port(page);
  await expect.poll(() => canvasProblems(page, document), { message: `${when}, the canvas draws the document the test port reads`, timeout: 5000, intervals: POLL }).toEqual([]);
}

// the page element of a node, once the canvas draws it
async function frameElement(page: Page, id: string, nodePath: string) {
  const element = page.frameLocator('.frame__page').locator(`[data-node="${id}"]`);
  await expect(element, `the canvas draws ${nodePath}`).toHaveCount(1, { timeout: 5000 });
  return element;
}
async function frameBox(page: Page, id: string, nodePath: string) {
  return (await frameElement(page, id, nodePath)).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

interface Point {
  readonly x: number;
  readonly y: number;
}
type CanvasQuery =
  // a point that hits the node itself (not one of its children), nearest its centre or, for the press of a marquee,
  // nearest its top-left corner, where a band starts; the page root is hit wherever no element is
  | { readonly kind: 'node'; readonly id: string; readonly root: boolean; readonly near: 'centre' | 'start' }
  // where a drag is released for a drop before, after or inside the node
  | { readonly kind: 'drop'; readonly id: string; readonly placement: Drop['placement']; readonly container: boolean; readonly slot: number | null; readonly edgeInset: number; readonly aim: number };

// A screen point on the canvas, measured in the page as the pointer owner measures it (coordinates.ts): the iframe's
// content box scaled by its CSS zoom; the point must land on the canvas overlay. Or why there is none.
//  - A node: the centre when it hits the node, else the point nearest the centre on a grid over its visible box (for
//    the press of a marquee, the point of that grid nearest the box's top-left corner).
//  - A drop, by the zones of the drag specs (drag-reorder-canvas, drag-drop-inside; the flow read as the app reads it:
//    a grid along its auto-flow, a flex along its direction, inline children along x, before and after as shown in a
//    reverse flex, Problems in Pager 5): along the parent's flow axis a
//    leaf splits in halves; a container keeps an edge band at each end (min(8, 0.25 S) when empty,
//    min(clamp(0.25 S, 8, 32), 0.4 S) with children, S its extent on the screen, in screen pixels; an empty one shorter
//    than the aim is measured on its box widened to the aim: Problems in Pager 6 and drag-drop-inside Problems in Pager
//    5) and is "inside" between them, at the slot the step's index
//    gives: in the free gap between its children there, or, with no gap, over the half of the neighbouring child
//    that stands for the same slot (after the child before it, before the child after it), or, with no room there,
//    just inside the edge of a container child that stands for it (its escape band).
function canvasPoint(page: Page, query: CanvasQuery): Promise<Point | string> {
  return page.evaluate((q) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !(iframe.currentCSSZoom > 0)) return 'the canvas has no page';
    const zoom = iframe.currentCSSZoom;
    const box = iframe.getBoundingClientRect();
    const style = getComputedStyle(iframe);
    const left = box.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
    const top = box.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
    const screen = (x: number, y: number) => ({ x: left + x * zoom, y: top + y * zoom });
    const onOverlay = (p: { x: number; y: number }) => document.elementFromPoint(p.x, p.y)?.closest('.frame__overlay') != null;
    const el = doc.querySelector(`[data-node="${CSS.escape(q.id)}"]`);
    if (!el) return 'the canvas does not draw it';
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    if (q.kind === 'node') {
      const r = q.root ? { left: 0, top: 0, right: vw, bottom: vh } : el.getBoundingClientRect();
      const [x0, x1, y0, y1] = [Math.max(r.left, 0), Math.min(r.right, vw), Math.max(r.top, 0), Math.min(r.bottom, vh)];
      if (x1 - x0 < 1 || y1 - y0 < 1) return 'it is outside the visible page';
      // a node's own room may be a band a few px tall (the gaps between a container's children, where the margins
      // between them fall): the search steps finely, from the middle outwards one region at a time
      const along = (a: number, b: number) => [0.5, 0.35, 0.65, 0.2, 0.8, 0.05, 0.95, ...Array.from({ length: 19 }, (_, i) => 0.05 * (i + 1))].map((f) => a + f * (b - a)).concat([a + 1.5, b - 1.5]);
      const points = along(x0, x1).flatMap((x) => along(y0, y1).map((y) => ({ x, y })));
      const [cx, cy] = q.near === 'start' ? [x0, y0] : [(x0 + x1) / 2, (y0 + y1) / 2];
      points.sort((p, o) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(o.x - cx, o.y - cy));
      for (const p of points) {
        const hit = doc.elementFromPoint(p.x, p.y);
        const itself = hit?.closest('[data-node]') === el || (q.root && hit === doc.documentElement);
        const at = screen(p.x, p.y);
        if (itself && onOverlay(at)) return at;
      }
      return 'no point of it on the canvas hits it rather than a child';
    }
    // the flow a container lays its children along, as the app reads it (coordinates.ts flowAxis, flowReversed): a
    // grid along its auto-flow, a flex along its direction, inline-level children along x; reversed in a reverse flex
    const alongX = (e: Element) => {
      const s = getComputedStyle(e);
      if (s.display.includes('grid')) return !s.gridAutoFlow.startsWith('column');
      if (s.display.includes('flex')) return !s.flexDirection.startsWith('column');
      const children = [...e.children].filter((c) => c.hasAttribute('data-node'));
      return children.length > 0 && children.every((c) => getComputedStyle(c).display.startsWith('inline'));
    };
    const reversedFlow = (e: Element) => {
      const s = getComputedStyle(e);
      return s.display.includes('flex') && s.flexDirection.endsWith('-reverse');
    };
    const parent = el.parentElement;
    const row = parent !== null && alongX(parent);
    const r = el.getBoundingClientRect();
    const kids = [...el.children].filter((c) => c.hasAttribute('data-node'));
    // an empty container shorter than the aim on the screen: its extent widened to the aim around its centre
    const aimed = q.container && kids.length === 0 ? (s: number) => Math.max(s, q.aim / zoom) : (s: number) => s;
    const [start, size] = row ? [r.left + (r.width - aimed(r.width)) / 2, aimed(r.width)] : [r.top + (r.height - aimed(r.height)) / 2, aimed(r.height)];
    let cross = row ? r.top + r.height / 2 : r.left + r.width / 2;
    // the band in screen pixels, on the extent on the screen, back in the page's pixels
    const screenSize = size * zoom;
    const band = (!q.container ? screenSize / 2 : kids.length === 0 ? Math.min(8, 0.25 * screenSize) : Math.min(Math.max(8, Math.min(0.25 * screenSize, 32)), 0.4 * screenSize)) / zoom;
    let along: number;
    let x: boolean = row;
    // before and after as shown: in a parent that shows its children reversed, before in the document is after
    const shownBefore = (q.placement === 'before') !== (parent !== null && reversedFlow(parent));
    if (q.placement === 'before' || q.placement === 'after') {
      along = shownBefore ? start + band / 2 : start + size - band / 2;
      // A container: just inside its edge, whatever its content covers there — that is the one point that reads as
      // before or after the container itself (its escape band; drag-reorder-canvas, "Hit zones": the escape ladder).
      // The band inside it reads as a drop into it at the end instead.
      if (q.container) along = shownBefore ? start + q.edgeInset / zoom : start + size - q.edgeInset / zoom;
    } else if (!q.container) return 'a leaf takes nothing inside';
    else if (kids.length === 0) along = start + size / 2;
    else {
      // inside, at the slot, on the line of children the slot lies on, along the container's own flow (drag-reorder-
      // canvas, Problems in Pager 5): after the child before the slot, in the free space beside it on its line (up to
      // the slot's child when it shares the line, else to the container's end); at slot 0 before the first child. With
      // no free space there, over that child: its half on the slot's side, or just inside its edge when it is a
      // container (its escape band)
      x = alongX(el);
      const reversed = reversedFlow(el);
      const slot = q.slot ?? kids.length;
      const boxes = kids.map((k) => k.getBoundingClientRect());
      const lo = (b: DOMRect) => (x ? b.left : b.top);
      const hi = (b: DOMRect) => (x ? b.right : b.bottom);
      const sameLine = (a: DOMRect, b: DOMRect) => (x ? a.top < b.bottom && a.bottom > b.top : a.left < b.right && a.right > b.left);
      const [limitLo, limitHi] = x === row ? [start + band, start + size - band] : x ? [r.left + 1, r.right - 1] : [r.top + 1, r.bottom - 1];
      const prev = boxes[slot - 1];
      const next = boxes[slot];
      const beside = prev !== undefined && next !== undefined && sameLine(prev, next) ? next : undefined;
      const [from, to] =
        prev !== undefined
          ? reversed
            ? [beside !== undefined ? hi(beside) : limitLo, lo(prev)]
            : [hi(prev), beside !== undefined ? lo(beside) : limitHi]
          : next !== undefined
            ? reversed
              ? [hi(next), limitHi]
              : [limitLo, lo(next)]
            : [limitLo, limitHi];
      const near = prev ?? next;
      if (near !== undefined) cross = x ? near.top + near.height / 2 : near.left + near.width / 2;
      if (x !== row) cross = Math.min(Math.max(cross, start + band), start + size - band);
      if (to - from >= 1) along = (from + to) / 2;
      else {
        const child = prev !== undefined ? kids[slot - 1] : kids[slot];
        if (near === undefined || child === undefined) return `no room inside it at slot ${slot}`;
        // the side of that child the slot is on, as shown: after the child before it, before the child after it
        const trailing = (prev !== undefined) !== reversed;
        const inset = q.edgeInset / zoom;
        const extent = hi(near) - lo(near);
        // an empty child (a card holding nothing) has no extent to aim at: the point goes just inside the container's
        // own end, which is where a drop at that slot belongs
        if (extent < inset) along = trailing ? limitHi : limitLo;
        else if (child.hasAttribute('data-container')) along = trailing ? hi(near) - inset : lo(near) + inset;
        else along = lo(near) + extent * (trailing ? 0.75 : 0.25);
      }
    }
    const at = x ? screen(along, cross) : screen(cross, along);
    return onOverlay(at) ? at : 'the drop point is not on the canvas';
  }, query);
}

// canvasPoint's answer for a node its children cover whole (the same text as in the page script above)
const NO_OWN_POINT = 'no point of it on the canvas hits it rather than a child';

// The doors a test names are listed before it runs (Playwright's list, which the door census reads), where the canvas
// cannot be measured: a setup names the canvas click, its first choice. When the setup reaches a node another way,
// the test's own annotations say so from then on (its results, the status reporter).
function ranAlso(ran: string) {
  test.info().annotations.push({ type: 'door', description: ran });
}
function ranInstead(listed: string, ran: string) {
  const annotations = test.info().annotations;
  const at = annotations.findIndex((a) => a.type === 'door' && a.description === listed);
  if (at >= 0) annotations.splice(at, 1, { type: 'door', description: ran });
  else ranAlso(ran);
}

// Where an element's drag is pressed: a point of its own, unless every point of its own is the marquee's (a container
// with children, whose empty area the marquee door's zone "page-or-container" takes, spec marquee-select); then its
// name label on the canvas, which shows once the element is selected: clicked first when it is not, as a person
// would (spec select-click, "Hit zones": the element's selection label selects or drags the element it names).
const MARQUEE_DOOR = COMMANDS.flatMap((c) => c.entryPoints).find((d) => d.kind === 'canvas-drag' && d.source === 'empty-area');
// the gesture of a region dragged with the Select tool (manifest/interactions.json), and the Select tool's resize
// handle that moves the edges named (the canvas handle whose id ends with them: n, e, se…)
const LAYOUT_PLACE = 'layout-place';
function resizeHandleRef(edges: string): string | null {
  for (const command of COMMANDS)
    for (const door of command.entryPoints)
      if (door.kind === 'canvas-handle' && typeof door.handle === 'string' && door.handle.endsWith(`-${edges}`) && door.handle.split('-').length === 2) return `${command.id}#${door.id}`;
  return null;
}

async function elementDragPoint(page: Page, document: unknown, nodePath: string): Promise<Point> {
  const node = nodeAt(document, nodePath);
  const own = await nodePoint(page, node.id, isRoot(document, nodePath), nodePath);
  const marqueeArea = MARQUEE_DOOR?.zone === 'page-or-container' && CONTENT.get(node.type) === 'children' && node.children.length > 0;
  if (!marqueeArea) {
    // inside a selected element (not the page root), a drag drags that element (spec drag-reorder-canvas, Problems in
    // Pager 12): the node is clicked first, as a person selects what they mean to drag
    const segments = nodePath.split('/').filter((part) => part !== '');
    const ancestors = segments.slice(1, -1).map((_, i) => idOf(document, `/${segments.slice(0, i + 2).join('/')}`));
    const { selection } = await port(page);
    if (!selection.includes(node.id) && selection.some((id) => ancestors.includes(id))) {
      await withModifier(page, doorData(SELECT_DOOR).modifier, () => page.mouse.click(own.x, own.y));
      ranAlso(SELECT_DOOR);
    }
    return own;
  }
  const { selection } = await port(page);
  if (selection.length !== 1 || selection[0] !== node.id) {
    await withModifier(page, doorData(SELECT_DOOR).modifier, () => page.mouse.click(own.x, own.y));
    ranAlso(SELECT_DOOR);
  }
  const label = page.locator(`[data-chrome="label"][data-label-for="${node.id}"]`);
  await expect(label, `${nodePath}: its label shows on the canvas once it is selected`).toBeVisible({ timeout: 5000 });
  const box = await label.boundingBox();
  if (box === null) throw new Error(`${nodePath}: its label is not laid out`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// the nearest node inside a node its children cover whole that has a point of its own on the canvas (depth first, in
// the children's order), and how many levels below the node it sits; null when there is none
async function ownPointBelow(page: Page, node: Node, levels: number): Promise<{ readonly point: Point; readonly levels: number } | null> {
  for (const child of node.children) {
    const at = await canvasPoint(page, { kind: 'node', id: child.id, root: false, near: 'centre' });
    if (typeof at !== 'string') return { point: at, levels };
    if (at !== NO_OWN_POINT) continue;
    const deeper = await ownPointBelow(page, child, levels + 1);
    if (deeper !== null) return deeper;
  }
  return null;
}

async function nodePoint(page: Page, id: string, root: boolean, nodePath: string, near: 'centre' | 'start' = 'centre'): Promise<Point> {
  await frameElement(page, id, nodePath);
  const found = await canvasPoint(page, { kind: 'node', id, root, near });
  if (typeof found === 'string') throw new Error(`${nodePath}: ${found}`);
  return found;
}

// A screen point inside a node's box that the canvas shows, whichever element lies under it: what a pan needs, since
// the middle button pans wherever it presses. The page's own free band (its root's only own point) lies below what a
// zoomed canvas shows, and a pan over a child travels exactly the same way.
// A captured page's element is named by its data-capture-node (spec capture-url), an authored node by its data-node.
async function nodeInsidePoint(page: Page, id: string, attribute: 'data-node' | 'data-capture-node' = 'data-node'): Promise<Point | string> {
  return page.evaluate(([nodeId, named]) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !(iframe.currentCSSZoom > 0)) return 'the canvas has no page';
    const zoom = iframe.currentCSSZoom;
    const box = iframe.getBoundingClientRect();
    const style = getComputedStyle(iframe);
    const left = box.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
    const top = box.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
    const screen = (x: number, y: number) => ({ x: left + x * zoom, y: top + y * zoom });
    const el = doc.querySelector(`[${named}="${CSS.escape(nodeId)}"]`);
    if (!el) return 'the canvas does not draw it';
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    const r = el.getBoundingClientRect();
    const [x0, x1, y0, y1] = [Math.max(r.left, 0), Math.min(r.right, vw), Math.max(r.top, 0), Math.min(r.bottom, vh)];
    if (x1 - x0 < 1 || y1 - y0 < 1) return 'it is outside the visible page';
    const at = screen((x0 + x1) / 2, (y0 + y1) / 2);
    return document.elementFromPoint(at.x, at.y)?.closest('.frame__overlay') != null ? at : 'the canvas does not show it';
  }, [id, attribute] as const);
}

// A screen point of the stage outside the page: in the gap around the frame, where the stage itself is hit.
async function stagePoint(page: Page): Promise<Point> {
  const found = await page.evaluate(() => {
    const stage = document.querySelector('.stage');
    const frame = document.querySelector('.frame');
    if (!stage || !frame) return 'the canvas has no stage';
    const s = stage.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const candidates = [
      { x: (s.left + f.left) / 2, y: f.top + f.height / 2 },
      { x: (f.right + s.right) / 2, y: f.top + f.height / 2 },
      { x: f.left + f.width / 2, y: (f.bottom + s.bottom) / 2 },
      { x: s.left + 2, y: s.bottom - 2 },
    ];
    return candidates.find((p) => document.elementFromPoint(p.x, p.y) === stage) ?? 'no point of the stage lies outside the page';
  });
  if (typeof found === 'string') throw new Error(found);
  return found;
}

// A Layers row outside its panel's window is not drawn (A3.28): the tree is scrolled from its top down, one window at a
// time, until the row is there, as a person scrolls to reach it. Each step waits for the editor to draw the rows of the
// new scroll: a step taken before it overshoots the row.
async function scrollTreeTo(page: Page, target: Locator): Promise<void> {
  const tree = page.locator('.layers-tree');
  const settle = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await tree.evaluate((el) => el.scrollTo(0, 0));
  await settle();
  for (let i = 0; i < 60; i += 1) {
    if ((await target.count()) > 0) return;
    await tree.evaluate((el) => el.scrollBy(0, el.clientHeight * 0.8));
    await settle();
  }
}

// A screen point of a drawn control: at a fraction of its height (a Layers row's zones), across its middle.
async function controlPoint(page: Page, ref: string, args: Record<string, unknown>, at = 0.5): Promise<Point> {
  const target = control(page, ref, { args });
  // a Layers row outside its panel's window is not drawn (A3.28: the tree draws only the rows in its view)
  if (ref.includes('layers-') && (await page.locator('.layers-tree').count()) === 1 && (await target.count()) === 0) await scrollTreeTo(page, target);
  await expect(target, `${ref} ${JSON.stringify(args)} is drawn`).toHaveCount(1, { timeout: 5000 });
  await target.scrollIntoViewIfNeeded();
  // the tree lays its rows out for the new scroll a frame after it (A3.28): the box is read once it has, so the point
  // is on the row the step names and not on the one it was drawn over before
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = await target.boundingBox();
  if (box === null) throw new Error(`${ref} ${JSON.stringify(args)} is not laid out`);
  return { x: box.x + box.width / 2, y: box.y + box.height * at };
}

// Scrolls the canvas page so a node stands clear of the band along the frame's top and bottom edges where a held drag
// scrolls it (interactions.json drop.autoscrollZone, in screen pixels), when it lies in that band; nothing otherwise.
// how far above its slot a tile's drop into a container starts its last approach, in screen pixels
const APPROACH = 24;

async function keepAwayFromEdges(page: Page, id: string): Promise<void> {
  const zone = Number(interactions.constants.find((c) => c.id === 'drop.autoscrollZone')?.value ?? 0);
  const moved = await page.evaluate(
    ({ node, band }) => {
      const iframe = window.document.querySelector<HTMLIFrameElement>('.frame__page');
      const el = iframe?.contentDocument?.querySelector(`[data-node="${node}"]`);
      const view = iframe?.contentWindow;
      if (!iframe || !el || !view) return false;
      const inPage = band / iframe.currentCSSZoom;
      const r = el.getBoundingClientRect();
      if (r.top >= inPage && r.bottom <= view.innerHeight - inPage) return false;
      if (r.height >= view.innerHeight - 2 * inPage) return false;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      return true;
    },
    { node: id, band: zone },
  );
  if (moved) await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function canvasDropPoint(page: Page, document: unknown, drop: Drop, index: number | null): Promise<Point> {
  const reference = nodeAt(document, drop.reference);
  await frameElement(page, reference.id, drop.reference);
  // An empty reference (a card holding nothing) has no extent to aim before or after: its slot point goes just inside
  // the container it sits in, which is where a drop at that slot belongs — a point at its own edge would fall on
  // whatever the canvas draws next.
  const resolved = resolveNode(document, drop.reference.split('/').filter((s) => s !== ''));
  const parent = typeof resolved === 'string' ? null : (resolved.parent as { id?: unknown } | null);
  if (index !== null && parent !== null && typeof parent.id === 'string') {
    const box = await frameBox(page, reference.id, drop.reference);
    if (box.width < 1 || box.height < 1) {
      const inside = await canvasPoint(page, { kind: 'drop', id: parent.id, placement: 'inside', container: true, slot: index, edgeInset: EDGE_INSET, aim: EMPTY_AIM });
      if (typeof inside !== 'string') return inside;
    }
  }
  const found = await canvasPoint(page, { kind: 'drop', id: reference.id, placement: drop.placement, container: CONTENT.get(reference.type) === 'children', slot: index, edgeInset: EDGE_INSET, aim: EMPTY_AIM });
  if (typeof found === 'string') throw new Error(`drop ${drop.placement} ${drop.reference}: ${found}`);
  return found;
}

// Where a side drop lands (a canvas-drag door of the side-band zone, spec drag-layout row 5): inside the side strip of
// its reference, 3 screen pixels from the edge of the drop's side, across its middle: the left or the right edge when
// the reference's parent lays its children vertically, the top or the bottom in a row.
async function sideDropPoint(page: Page, document: unknown, drop: Drop): Promise<Point> {
  const reference = nodeAt(document, drop.reference);
  await frameElement(page, reference.id, drop.reference);
  const found = await page.evaluate(
    ({ id, placement }) => {
      const iframe = window.document.querySelector<HTMLIFrameElement>('.frame__page');
      const el = iframe?.contentDocument?.querySelector(`[data-node="${id}"]`);
      const view = iframe?.contentWindow;
      if (!iframe || !el || !view || !el.parentElement) return 'the canvas does not draw it';
      const style = view.getComputedStyle(el.parentElement);
      const row = style.display.includes('flex') && !style.flexDirection.startsWith('column');
      const zoom = iframe.currentCSSZoom;
      const frame = iframe.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const box = { x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, w: r.width * zoom, h: r.height * zoom };
      const before = placement === 'before';
      return row ? { x: box.x + box.w / 2, y: before ? box.y + 3 : box.y + box.h - 3 } : { x: before ? box.x + 3 : box.x + box.w - 3, y: box.y + box.h / 2 };
    },
    { id: reference.id, placement: drop.placement },
  );
  if (typeof found === 'string') throw new Error(`side drop ${drop.placement} ${drop.reference}: ${found}`);
  return found;
}

// Where a marquee's band ends (a drag from the empty area): inside its reference, on the point nearest the
// reference's centre that hits it rather than a child, so the band runs from the press to there.
async function marqueeEndPoint(page: Page, document: unknown, drop: Drop): Promise<Point> {
  if (drop.placement !== 'inside') throw new Error(`a marquee ends inside a node, not ${drop.placement} ${drop.reference}`);
  return nodePoint(page, nodeAt(document, drop.reference).id, isRoot(document, drop.reference), drop.reference);
}

// The Style tab draws a section collapsed while the selected element holds no value in it (the user's real-use audit,
// item 5.1: the panel stays short; archive/DESIGN.md "Inspector"). A step that runs a door of a field in such a section
// opens it first, through the section's own header door, as a person does — a door the editor does not draw cannot be
// reached through the real mouse and keyboard. The header's door records the section's state only: nothing in the
// document, the selection or the history changes.
async function openCollapsedSection(page: Page, ref: string, args: Record<string, unknown>): Promise<void> {
  if ((await control(page, ref, { args }).count()) > 0) return;
  if (ref.includes('layers-')) return;
  // its section's header, then its concept row's disclosure, as a person opens them (tests/e2e/door.ts)
  if (await openStyleControl(page, ref, args)) await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// The Layers row of a node and where on it a drop lands (layers-drag): a container row is "inside" in its middle
// half, a leaf row splits in halves.
const LAYERS_ROW = COMMANDS.find((c) => c.id === 'selection.select')?.entryPoints.find((d) => d.kind === 'panel-control' && d.gesture === 'layers-row-click');
const layersRowRef = `selection.select#${LAYERS_ROW?.id ?? ''}`;
async function layersDropPoint(page: Page, document: unknown, drop: Drop): Promise<Point> {
  const reference = nodeAt(document, drop.reference);
  const container = CONTENT.get(reference.type) === 'children';
  const at = drop.placement === 'inside' ? 0.5 : drop.placement === 'before' ? (container ? 0.125 : 0.25) : container ? 0.875 : 0.75;
  return controlPoint(page, layersRowRef, { target: reference.id }, at);
}

// The tile a palette drag is pressed on (palette-drag-insert): the door of the same command drawn as a palette tile,
// whose control stands for the step's entry.
// The palette tile a creation drag presses: its own command's tile, else the palette's (element.insert's), which every
// drag from a tile starts from (a side drop's wrapBeside has no tile of its own).
function paletteTileDoor(ref: string): string {
  const own = COMMANDS.find((c) => c.id === commandOf(ref))?.entryPoints.find((d) => d.kind === 'panel-control' && d.control === 'tile');
  if (own) return `${commandOf(ref)}#${own.id}`;
  for (const c of COMMANDS) for (const d of c.entryPoints) if (d.kind === 'panel-control' && d.control === 'tile') return `${c.id}#${d.id}`;
  throw new Error(`step ${ref}: no palette tile to press`);
}

// A component's tile (spec reusable-components): the drag source of components.insertInstance, the door of the same
// command drawn as the tile of that control
const COMPONENT_TILE = 'component-tile';
// a positioned element's free drag (spec absolute-free-drag): the source of position.move's canvas-drag door
const POSITIONED_ELEMENT = 'positioned-element';
// the guide drags (spec guides-manual): out of the top or the left ruler, or of a guide
const GUIDE_SOURCES: readonly string[] = ['top-ruler', 'left-ruler', 'guide'];
function tileDoorOf(ref: string, control: string): string {
  const own = COMMANDS.find((c) => c.id === commandOf(ref))?.entryPoints.find((d) => d.kind === 'panel-control' && d.control === control);
  if (own === undefined) throw new Error(`step ${ref}: no ${control} to press`);
  return `${commandOf(ref)}#${own.id}`;
}

const MODIFIER_KEY: Record<string, string> = { Ctrl: 'Control', Shift: 'Shift', Alt: 'Alt', Meta: 'Meta' };
async function withModifier(page: Page, modifier: string | null | undefined, act: () => Promise<void>) {
  const key = modifier ? MODIFIER_KEY[modifier] : undefined;
  if (key) await page.keyboard.down(key);
  await act();
  if (key) await page.keyboard.up(key);
}

// the key context of the text edited in place on the canvas (interactions.json), which the edited element names
const EDIT_CONTEXT = 'text-editing';
// the key context of the keyboard's hand (interactions.json): while it holds an element, the canvas's keys are its
// own (keymap.ts), and the canvas draws its aim as a drop (spec hand-keyboard-move)
const HAND_CONTEXT = 'hand';
// the key context of a dialog (interactions.json), which an open dialog names
const DIALOG_CONTEXT = 'dialog';
// the key context of the canvas (interactions.json), which the frame's page and the page body name
const CANVAS_CONTEXT = 'canvas';
// the key context of the inspector's text field (interactions.json), which the field names: its keys (Enter, Escape)
// act on what the field holds (spec inspector-panel)
const FIELD_TEXT_CONTEXT = 'element-text-field';
// the key context of a number field of the inspector (interactions.json), which its input names: its keys (Enter,
// Escape, the arrows, PageUp and PageDown) act on the field's property and the text it holds (spec
// inspector-number-fields)
const NUMBER_FIELD_CONTEXT = 'number-field';
// a side of the spacing box: its keys act on the side that holds the focus, as a number field's do
const SPACING_FIELD_CONTEXT = 'spacing-field';
// a field its own command keeps (a border, a background image): its Escape acts on the field that holds the focus
const COMMAND_FIELD_CONTEXT = 'command-field';
// the key context of the quick panel (interactions.json), which the open panel names and whose fields it absorbs
// (keymap.ts): its Escape closes the panel wherever the focus inside it is (spec quick-panel)
const QUICK_PANEL_CONTEXT = 'quick-panel';
// A step's `modifier` argument (a number field's step or scrub: Shift, Alt) is the key held while its door runs, and
// a panel drag's `distance` argument is the pointer's horizontal travel in screen pixels; neither is something the
// drawn control stands for.
const MODIFIER_ARG = 'modifier';
const TRAVEL_ARG = 'distance';
const heldKey = (step: Step): string | undefined => {
  const modifier = step.args[MODIFIER_ARG];
  return typeof modifier === 'string' ? MODIFIER_KEY[modifier] : undefined;
};
// Sets the step's arguments in the inputs of the form a button submits, named after them, with the real mouse and
// keyboard: a list ticks the checkboxes whose values it holds and unticks the others; a number or a text is typed in
// place of what its field held. False, touching nothing, when the button submits no form or an argument names none of
// its inputs.
async function fillForm(page: Page, button: Locator, args: Record<string, unknown>): Promise<boolean> {
  if (Object.keys(args).length === 0 || (await button.count()) !== 1 || (await button.getAttribute('type')) !== 'submit') return false;
  const form = button.locator('xpath=ancestor::form[1]');
  if ((await form.count()) !== 1) return false;
  for (const name of Object.keys(args)) if ((await form.locator(`[name="${name}"]`).count()) === 0) return false;
  for (const [name, value] of Object.entries(args)) {
    const inputs = form.locator(`[name="${name}"]`);
    if (Array.isArray(value)) {
      for (let i = 0; i < (await inputs.count()); i += 1) {
        const box = inputs.nth(i);
        const want = value.includes(await box.getAttribute('value'));
        if ((await box.isChecked()) !== want) await box.click();
      }
    } else {
      const field = inputs.first();
      if ((await field.evaluate((el) => el.tagName)) === 'SELECT') {
        await field.selectOption(String(value));
        continue;
      }
      await field.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(String(value));
    }
  }
  return true;
}
const withoutGestureArgs = (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).filter(([name]) => name !== MODIFIER_ARG && name !== TRAVEL_ARG));
// the control of the colour picker's eyedropper (manifest style.set#color-picker-eyedropper)
const EYEDROPPER_CONTROL = 'eyedropper';
// the gestures of the Edit on canvas handles (interactions.json), which the runner drags by the value they make
const EDIT_GESTURES: readonly string[] = ['spacing-band', 'property-handle', 'shadow-handle'];
// the gestures of the canvas handles that are clicked, not dragged (interactions.json): the anchor tabs
const CLICK_HANDLES: readonly string[] = ['anchor-tab'];
// the rotation handle's gesture (interactions.json): the one whose Shift snaps the angle to steps
const ROTATE_GESTURE = interactions.gestures.find((g) => g.modifiers.some((m) => m.meaning === 'snap-to-15-degree-steps'))?.id;
// what a step's `type` writes for Tab (schema.ts stepSchema)
const TAB = '\t';
// what a step's `type` writes for Shift+Enter (schema.ts stepSchema): U+2028, the line separator
const LINE_BREAK = ' ';

// the focused key context and the contexts it inherits (keymap.ts): the text edited in place names its own, and so may
// a field (the inspector's text field), any other field keeps its keys, a region names its context, the page body is
// the canvas's; a field inside a region whose context absorbs fields (the quick panel: interactions.json) runs the
// region's context first and keeps the field's own after it
async function focusedContexts(page: Page): Promise<string[]> {
  const named = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { own: 'canvas', field: false };
    // the focus inside the canvas frame: the edited element (marked by the renderer) or the frame's page
    if (el instanceof HTMLIFrameElement) {
      const inner = el.contentDocument?.activeElement;
      const view = el.contentWindow as (Window & typeof globalThis) | null;
      if (inner && view && inner instanceof view.HTMLElement && inner.isContentEditable) return { own: inner.getAttribute('data-key-context') ?? 'field', field: true };
      return { own: 'canvas', field: false };
    }
    if (el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return { own: el.getAttribute('data-key-context') ?? 'field', field: true };
    return { own: el.closest('[data-key-context]')?.getAttribute('data-key-context') ?? 'global', field: false };
  });
  // the region above the field, never the field itself (a number field names its own context on its own input)
  const absorbs = named.field
    ? ((await page.evaluate(() => document.activeElement?.parentElement?.closest('[data-key-context]')?.getAttribute('data-key-context') ?? null)) as string | null)
    : null;
  const chain: string[] = [];
  if (absorbs !== null && interactions.keyContexts.find((c) => c.id === absorbs)?.absorbsFields === true) chain.push(absorbs);
  for (let at: string | null | undefined = named.own; at; at = interactions.keyContexts.find((c) => c.id === at)?.inherits) chain.push(at);
  return chain;
}

// Brings the keyboard focus onto the control a shortcut acts on (the palette tile its Enter inserts), with Tab as a
// person would, when the step names what it acts on: the drawn door of the same command that stands for those
// arguments.
async function focusControlFor(page: Page, ref: string, args: Record<string, unknown>) {
  const command = commandOf(ref);
  const drawn = COMMANDS.find((c) => c.id === command)?.entryPoints.map((d) => `${command}#${d.id}`) ?? [];
  const candidates = [];
  for (const other of drawn) if ((await control(page, other, { args }).count()) === 1) candidates.push(control(page, other, { args }));
  // no control of the command stands for them: the one control of another door that does (a canvas handle, whose arrows
  // are handle.step's)
  if (candidates.length === 0 && (await standingControl(page, args).count()) === 1) candidates.push(standingControl(page, args));
  const target = candidates[0];
  if (candidates.length !== 1 || target === undefined) throw new Error(`${ref}: ${candidates.length} controls of ${command} stand for ${JSON.stringify(args)}, not one`);
  // a Layers row outside the tree's window is not drawn (A3.28): the tree is scrolled to it before Tab reaches it
  if (ref.includes('layers-') && (await page.locator('.layers-tree').count()) === 1 && (await target.count()) === 0) await scrollTreeTo(page, target);
  const focused = () => target.evaluate((el) => el === document.activeElement);
  // A row of the Layers tree: Tab reaches the tree, and its rows are walked with the arrows, as a person walks them
  // (spec layers-keyboard-navigation: the arrows move the focus in the tree, a row does not take a Tab stop of its
  // own). Tabbing to a row directly was the flake of finding 56: the tree draws only the rows in its window (A3.28),
  // so a Tab walk from outside scrolled it and the row it looked for was redrawn away.
  if (ref.includes('layers-') && !(await focused())) {
    const tree = page.locator('.layers-tree');
    if ((await tree.count()) === 1) {
      const inTree = () => page.evaluate(() => document.activeElement?.closest('.layers-tree') !== null);
      for (let i = 0; i < 400 && !(await inTree()); i += 1) await page.keyboard.press('Tab');
      const wanted = target.evaluate((el) => el.getAttribute('data-args'));
      const atWanted = async () => (await page.evaluate(() => document.activeElement?.closest('[data-door]')?.getAttribute('data-args') ?? null)) === (await wanted);
      for (let i = 0; i < 400 && (await inTree()) && !(await atWanted()); i += 1) await page.keyboard.press('ArrowDown');
      for (let i = 0; i < 400 && (await inTree()) && !(await atWanted()); i += 1) await page.keyboard.press('ArrowUp');
    }
  }
  // A tile of the palette: Tab reaches its group (a group's tiles are one Tab stop, its first tile), and the arrows
  // walk the group to it, as a person does
  if (!(await focused()) && (await target.evaluate((el) => el.closest('[data-key-context="palette"]') !== null && (el as HTMLElement).tabIndex < 0))) {
    const inGroup = () => target.evaluate((el) => el.parentElement?.contains(document.activeElement) === true);
    for (let i = 0; i < 400 && !(await inGroup()); i += 1) await page.keyboard.press('Tab');
    for (let i = 0; i < 200 && (await inGroup()) && !(await focused()); i += 1) await page.keyboard.press('ArrowRight');
  }
  for (let i = 0; i < 400 && !(await focused()); i += 1) await page.keyboard.press('Tab');
  expect(await focused(), `${ref}: Tab reaches the control of ${JSON.stringify(args)}`).toBe(true);
}

// A drag held across steps: its door, and whether the drag's Escape (drag.cancel in the drag key context) ended it in
// the app while the button stays down; the person lets go of it once the steps are over, and that release must drop
// nothing (spec drag-level-keys-escape, palette-drag-insert).
interface Held {
  readonly door: string;
  readonly cancelled?: boolean;
}
const CANCEL_DOOR = shortcutIn('drag.cancel', 'drag');

// A step that only leads to the action (not the door the scenario proves) clicking a node its children cover whole
// runs its command's door on the node's Layers row instead, as a person would, and the test's annotations say so
// (ranInstead); the action step's own door is never replaced.
async function rowInsteadOfCanvas(page: Page, ref: string, document: unknown, nodePath: string, action: boolean): Promise<boolean> {
  const node = nodeAt(document, nodePath);
  await frameElement(page, node.id, nodePath);
  const at = await canvasPoint(page, { kind: 'node', id: node.id, root: isRoot(document, nodePath), near: 'centre' });
  const row = layersRowDoorOf(ref);
  if (action || at !== NO_OWN_POINT || row === null) return false;
  await runDoor(page, row, { args: { target: node.id } });
  ranInstead(ref, row);
  return true;
}

// The file a step's file argument hands the browser's file chooser (schema.ts, stepSchema): a fixture's JSON, the file
// the steps downloaded last (File › Save project's archive), or a project.json holding the given text.
// a real 4x3 PNG, so a scenario's upload carries an image with an intrinsic size (spec explorer-assets)
const PNG_4x3 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGP8z8Dwn4EIwESMokGtCAAxKQIBlZ8cWQAAAABJRU5ErkJggg==', 'base64');

// A file dragged in from the operating system and released (spec explorer-assets/-use): the page gets a real
// DataTransfer holding the real bytes, and the drag enters, moves over and drops where the step says — at a screen
// point on the canvas frame (the drop's own clientX/clientY are the frame's, as a browser reports them) or on the
// Explorer's folder zone.
async function dropOsFile(page: Page, value: string, at: Point | null): Promise<void> {
  const chosen = await chosenFile(value, []);
  await page.evaluate(
    ({ name, mimeType, base64, point }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: mimeType }));
      const fire = (element: Element, x: number, y: number) => {
        for (const type of ['dragenter', 'dragover', 'drop']) element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
      };
      if (point === null) {
        const zone = document.querySelector('[data-drop-zone="explorer-folder"]');
        if (zone === null) throw new Error('the Explorer folder zone is missing');
        fire(zone, 0, 0);
        return;
      }
      const frame = document.querySelector<HTMLIFrameElement>('.frame__page');
      if (frame?.contentDocument === null || frame?.contentDocument === undefined) throw new Error('the canvas frame is missing');
      const rect = frame.getBoundingClientRect();
      const zoom = frame.currentCSSZoom;
      const inner = { x: (point.x - rect.left) / zoom, y: (point.y - rect.top) / zoom };
      const element = frame.contentDocument.elementFromPoint(inner.x, inner.y) ?? frame.contentDocument.body;
      fire(element, inner.x, inner.y);
    },
    { name: chosen.name, mimeType: chosen.mimeType, base64: chosen.buffer.toString('base64'), point: at },
  );
}

// a real woff2 font, drawn from scratch by the scratch script that built it (every glyph a rectangle with its own
// advance, so "Heading" is 4.4 em wide at any size and a scenario can prove a custom font is the face the page draws
// with; spec custom-fonts). Null-transformed tables in one Brotli stream, as the WOFF2 spec writes them.
export const WOFF2_TEST = Buffer.from(
  'd09GMgABAAAAAAHMAAoAAAAAC7QAAAGEAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAAPMqOdAE2AiQDgVjLgVwEIAWBJgcgFwMLEJ4Hti1nC0aqpvB9K3aOHaGSE1XD1rMXPhHca7ImK8pjHMLgBE7gBBbhwX2AIMZRezATwHSJ5HRzOsAQxX/DRE61eQDw+QnL/+DddceHC3x+vt0faWJpmHJoiaehp0lbKBlcMPRAD7aXE0niYxBpbXWBv8ygkxSvkxd9Ve3iCJq+IwTkd4ULDAuNwAmde1iypOBClKojXPCWeET9WsJO4RHZqTREIPGYAQ4FoNb2QnhEfQb3tNbY+2FM3dL85iDNRATwcf72T3umjqZfa1hSBIJXyGwpAPj71/z2GDM0fTa+oCIggDev9w6f8IVv/GCH6CN+SAbSQ1bJHflPaaO8UCmoDmqRuqJ+09TR3NAS0Fpos7Qz2jddGd0JPQa9gT5JP6K/M+Qx7DAiMGowRhl7jGemNNMKMwSzAnOQucW8ZyHOwgyLACxKCMArYQIUAAB0XgkR4ZWwxeHijC137hjDPBN/PkplypEiVZEQqYqVCJIqXakciYpCvX6FzIsQI3a8Rw==',
  'base64',
);

// A file dragged in from the operating system and released (spec explorer-assets/-use): the page gets a real
// DataTransfer holding the real bytes, and the drag enters, moves over and drops where the step says — at a screen
// point on the canvas frame (the drop's own clientX/clientY are the frame's, as a browser reports them) or on the
// Explorer's folder zone.

interface ChosenFile {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
  // a whole folder (File › Open folder): the directory the chooser is handed instead of a file (spec
  // explorer-open-folder)
  readonly folder?: string;
}

async function chosenFile(value: string, downloads: readonly Download[]): Promise<ChosenFile> {
  const fixture = /^fixture:(.+)$/.exec(value)?.[1];
  if (fixture !== undefined) return { name: `${fixture}.json`, mimeType: 'application/json', buffer: fs.readFileSync(path.join('manifest/features/fixtures', `${fixture}.json`)) };
  const png = /^png:(.+)$/.exec(value)?.[1];
  if (png !== undefined) return { name: png, mimeType: 'image/png', buffer: PNG_4x3 };
  const woff2Name = /^woff2:(.+)$/.exec(value)?.[1];
  if (woff2Name !== undefined) return { name: woff2Name, mimeType: 'font/woff2', buffer: WOFF2_TEST };
  const folder = /^folder:([a-z0-9-]+)$/.exec(value)?.[1];
  if (folder !== undefined) {
    const at = path.join('tests/support/folders', folder);
    if (!fs.existsSync(at)) throw new Error(`file argument ${value}: there is no folder ${at}`);
    return { name: folder, mimeType: 'application/x-directory', buffer: Buffer.alloc(0), folder: at };
  }
  // a file of the import fixtures (File › Import HTML): an HTML page, a stylesheet, an image… by its name
  const imported = /^import:(.+)$/.exec(value)?.[1];
  if (imported !== undefined) {
    const ext = path.extname(imported).toLowerCase();
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : ext === '.png' ? 'image/png' : 'application/octet-stream';
    return { name: imported, mimeType: type, buffer: fs.readFileSync(path.join('manifest/features/fixtures/import', imported)) };
  }
  if (value === 'download') {
    const last = downloads.at(-1);
    if (last === undefined) throw new Error('the step opens the last download, and nothing was downloaded');
    return { name: last.suggestedFilename(), mimeType: 'application/zip', buffer: fs.readFileSync(await last.path()) };
  }
  if (value.startsWith('json:')) return { name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(value.slice('json:'.length), 'utf8') };
  throw new Error(`file argument ${value}: it is not fixture:<id>, download, json:<text> or import:<name>`);
}

async function runStep(page: Page, step: Step, ref: string, held: { current: Held | null }, action = false, downloads: readonly Download[] = []) {
  const d = doorData(ref);
  // a key of the text edited in place needs the focus in the edited text, before anything else of the step
  if (d.kind === 'shortcut' && d.context === EDIT_CONTEXT) expect((await focusedContexts(page))[0], `step ${ref}: the focus is in the text edited in place`).toBe(EDIT_CONTEXT);
  // a key of the inspector's text field needs the focus in that field, which a step before it typed into
  if (d.kind === 'shortcut' && d.context === FIELD_TEXT_CONTEXT) expect((await focusedContexts(page))[0], `step ${ref}: the focus is in the text field`).toBe(FIELD_TEXT_CONTEXT);
  // a key of a number field needs the focus in that field's input, which a step before it typed into
  if (d.kind === 'shortcut' && d.context === NUMBER_FIELD_CONTEXT) expect((await focusedContexts(page))[0], `step ${ref}: the focus is in a number field`).toBe(NUMBER_FIELD_CONTEXT);
  if (d.kind === 'shortcut' && d.context === SPACING_FIELD_CONTEXT) expect((await focusedContexts(page))[0], `step ${ref}: the focus is in a side of the spacing box`).toBe(SPACING_FIELD_CONTEXT);
  if (d.kind === 'shortcut' && d.context === COMMAND_FIELD_CONTEXT) expect((await focusedContexts(page))[0], `step ${ref}: the focus is in a field of its own command`).toBe(COMMAND_FIELD_CONTEXT);
  // a key of the quick panel needs the focus inside it, which the chip or the shortcut before it gave (the context
  // absorbs the fields inside it, so a field's focus counts too: keymap.ts). The drawn panel is measured a frame
  // before it is placed, and a hidden panel can take no focus, so the focus arrives a frame after it opens.
  if (d.kind === 'shortcut' && d.context === QUICK_PANEL_CONTEXT) await expect.poll(async () => (await focusedContexts(page)).includes(QUICK_PANEL_CONTEXT), { message: `step ${ref}: the focus is in the quick panel`, intervals: POLL }).toBe(true);
  // a key of the hand needs the focus where the hand was taken — the canvas, or the Layers tree (M on a row: the focus
  // stays in the tree and the arrows aim, as in Chrome by hand) — and an element in the hand, whose aim the canvas
  // draws as a drop
  if (d.kind === 'shortcut' && d.context === HAND_CONTEXT) {
    expect(['canvas', 'layers-tree'], `step ${ref}: the focus is on the canvas or in the Layers tree`).toContain((await focusedContexts(page))[0]);
    await expect(page.locator('[data-chrome="drop"]'), `step ${ref}: the hand holds an element (the canvas draws its aim)`).toHaveCount(1);
  }
  // a key of the canvas acting on the element the step names, pressed while a control elsewhere holds the focus (the
  // Layers lock a step before clicked): the person gives the canvas the focus back by clicking that element on it,
  // which leaves the selection as it is only when it is that element alone
  if (d.kind === 'shortcut' && d.context === CANVAS_CONTEXT && step.target !== null && !(await focusedContexts(page)).includes(CANVAS_CONTEXT)) {
    const before = await port(page);
    const node = nodeAt(before.document, step.target);
    expect(before.selection, `step ${ref}: the focus is off the canvas, and a click on ${step.target} gives it back only when it is the selection alone`).toEqual([node.id]);
    const at = await nodePoint(page, node.id, isRoot(before.document, step.target), step.target);
    await page.mouse.click(at.x, at.y);
    expect((await focusedContexts(page)).includes(CANVAS_CONTEXT), `step ${ref}: a click on ${step.target} gives the canvas the focus`).toBe(true);
    expect((await port(page)).selection, `step ${ref}: the click leaves the selection as it was`).toEqual(before.selection);
  }
  const { document } = await port(page);
  const args = resolveArgs(ref, step.args, document);
  // a field of the Style tab may sit in a section drawn collapsed (nothing set in it): the step opens it first
  await openCollapsedSection(page, ref, args);
  // a file argument is what the step hands the file chooser the door opens, never what a control stands for; a step
  // dragging a file in from the operating system opens no chooser (the file rides the drop's DataTransfer). Several
  // files at once (an argument of type "files", File › Import HTML): one value per file, all chosen in the one picker
  const fileArg = Object.entries(argTypes(ref)).find(([, a]) => a.type === 'file' || a.type === 'files')?.[0];
  const fileValue = fileArg === undefined ? undefined : step.args[fileArg];
  const dragsFile = d.gesture === 'file-drag';
  const filesValue = Array.isArray(fileValue) ? (fileValue as readonly string[]) : typeof fileValue === 'string' ? [fileValue] : null;
  const chooser = filesValue !== null && !dragsFile ? page.waitForEvent('filechooser') : null;
  // what the status bar said before a file is chosen: the command, which reads the file after the chooser closes, has
  // run once it says something else or asks its confirmation
  const saidBefore = chooser === null ? null : await page.getByRole('status').textContent();
  // the arguments a drawn control stands for, beyond those its door fixes; of an object argument both give, the keys
  // its door does not fix (the keymap joins the two: a gradient stop's { edit: { stop } } with its key's edit)
  const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = Object.fromEntries(
    Object.entries(args).flatMap(([name, value]): [string, unknown][] => {
      const fixed = (d.args as Record<string, unknown>)[name];
      if (name === fileArg || (chooser !== null && ref.startsWith('project.importHtml#') && name === 'destination')) return [];
      if (!(name in d.args)) return [[name, value]];
      // a door that declares an argument as the empty string hands it to the item it is drawn for: the drawing gives
      // the real value (a file tab's page, the top bar's page switcher — DoorControl merges the item's arguments over
      // the door's). The step's value is what the control stands for, so the step finds that one item.
      if (fixed === '') return [[name, value]];
      if (!isObject(fixed) || !isObject(value)) return [];
      const rest = Object.entries(value).filter(([key]) => !(key in fixed));
      return rest.length === 0 ? [] : [[name, Object.fromEntries(rest)]];
    }),
  );
  const target = step.target === null ? null : nodeAt(document, step.target);
  // a door of the quick panel (its fields, More actions, its grip) is reached by opening the panel from its chip (the
  // panel's own control door, which a step of such a scenario runs on its own); a field of it is typed into like an
  // inspector field, a button of it clicked like a panel control
  if (inQuickPanel(d)) await openQuickPanel(page);
  const quickField = d.kind === 'quick-panel' && (await control(page, ref).locator('input, textarea').count()) > 0;

  if ((d.kind === 'canvas-drag' || d.kind === 'canvas-handle') && d.gesture === LAYOUT_PLACE) {
    // a region the Layout tool drew, dragged with the Select tool (layout.place): by its body, pressed where an element
    // drag presses it, or by the resize handle of the edges the step names; moved past the threshold and then by the
    // step's travel in page px times the zoom, released
    if (step.target === null) throw new Error(`step ${ref}: a region placed names its target`);
    const dx = args.dx;
    const dy = args.dy;
    if (typeof dx !== 'number' || typeof dy !== 'number') throw new Error(`step ${ref}: a region placed names its dx and dy`);
    let from: Point;
    if (d.kind === 'canvas-drag') from = await elementDragPoint(page, document, step.target);
    else {
      const handle = resizeHandleRef(String(args.edges));
      const box = handle === null ? null : await page.locator(`[data-door="${handle}"]`).first().boundingBox();
      if (box === null) throw new Error(`step ${ref}: the resize handle ${String(args.edges)} is not drawn`);
      from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    const zoom = await page.locator('.frame__page').evaluate((frame) => (frame as HTMLIFrameElement).currentCSSZoom);
    const threshold = typeof DRAG_THRESHOLD === 'number' ? DRAG_THRESHOLD : 4;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + Math.sign(dx || 1) * (threshold + 2), from.y, { steps: 3 });
    await page.mouse.move(from.x + dx * zoom, from.y + dy * zoom, { steps: 12 });
    await page.mouse.up();
  } else if ((d.kind === 'canvas-click' || d.kind === 'canvas-drag' || d.kind === 'canvas-handle') && LAYOUT_GESTURES.includes(d.gesture ?? '')) {
    // a door of the Layout Composer: a stroke on its stage, a handle of it, a region of it (layout-composer.ts)
    await driveLayout(page, ref, d.gesture ?? '', d.kind === 'canvas-click' ? (d.modifier ?? null) : null, args);
  } else if (d.kind === 'canvas-click' && d.target === 'captured-element') {
    // an element of a captured page, pressed where the canvas shows it (its captured id is the step's target argument)
    if (typeof args.target !== 'string') throw new Error(`step ${ref}: a captured element is named by its target argument`);
    await page.locator('.frame__page').evaluate((iframe: HTMLIFrameElement, id) => iframe.contentDocument?.querySelector(`[data-capture-node="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }), args.target);
    const at = await nodeInsidePoint(page, args.target, 'data-capture-node');
    if (typeof at === 'string') throw new Error(`step ${ref}: ${args.target}: ${at}`);
    await page.mouse.click(at.x, at.y);
  } else if (d.kind === 'canvas-click' && d.target !== 'stage-outside-page' && step.target !== null && (await rowInsteadOfCanvas(page, ref, document, step.target, action))) {
    // reached through the node's Layers row
  } else if (d.kind === 'canvas-click') {
    if (step.hold === true || step.drop !== null) throw new Error(`step ${ref}: a click neither drops nor holds`);
    const at =
      d.target === 'stage-outside-page'
        ? await stagePoint(page)
        : target !== null && step.target !== null
          ? await nodePoint(page, target.id, isRoot(document, step.target), step.target)
          : null;
    if (at === null) throw new Error(`step ${ref}: a click on ${d.target ?? 'the canvas'} needs a target`);
    const button = d.button === 'secondary' ? 'right' : 'left';
    await withModifier(page, d.modifier, () => (d.count === 2 ? page.mouse.dblclick(at.x, at.y, { button }) : page.mouse.click(at.x, at.y, { button })));
  } else if (d.kind === 'canvas-wheel') {
    // a wheel over the step's node, with the door's modifier held: Ctrl+wheel's factor is the notch
    // exp(−deltaY × zoom.wheelFactor) gives; a pan's travel (dx, dy) is the page's, so the wheel turns the other way
    // (Shift turns it down, as a mouse without a horizontal wheel does)
    if (target === null || step.target === null) throw new Error(`step ${ref}: a wheel acts over the node it names`);
    // the node's own point where it has one; else a point of its box the canvas shows (a wheel over a zoomed page has
    // to land on the stage for the canvas to hear it, and the page's own free band lies below what the canvas shows)
    const ownPoint = await canvasPoint(page, { kind: 'node', id: target.id, root: isRoot(document, step.target), near: 'centre' });
    const at = typeof ownPoint === 'string' ? await nodeInsidePoint(page, target.id) : ownPoint;
    if (typeof at === 'string') throw new Error(`${step.target}: ${at}`);
    const factor = typeof args.factor === 'number' ? args.factor : null;
    const dx = typeof args.dx === 'number' ? args.dx : 0;
    const dy = typeof args.dy === 'number' ? args.dy : 0;
    const deltaX = factor === null && d.modifier === null ? -dx : 0;
    const deltaY = factor !== null ? -Math.log(factor) / WHEEL_FACTOR : d.modifier === 'Shift' ? -dx : -dy;
    const key = d.modifier ? MODIFIER_KEY[d.modifier] : undefined;
    await page.mouse.move(at.x, at.y);
    if (key) await page.keyboard.down(key);
    await page.mouse.wheel(deltaX, deltaY);
    if (key) await page.keyboard.up(key);
  } else if (d.kind === 'canvas-handle' && held.current !== null && held.current.door === ref && step.target === null) {
    // the release of the held handle, where the pointer is
    await page.mouse.up();
    held.current = null;
  } else if (d.kind === 'canvas-handle' && EDIT_GESTURES.includes(d.gesture ?? '')) {
    // a spacing band of the Edit on canvas mode (canvas/edit-handles.tsx), drawn once per side: pressed at its middle
    // and dragged along the way that grows it (its data-normal) by the travel that makes the step's value from the
    // value it starts from (its data-start), times the zoom, with the step's key held (Shift: all four sides; Alt: the
    // opposite too), and released. A step that types (and names no value to drag to) clicks the band, which opens its
    // typed field, and types there.
    if (step.hold === true || step.drop !== null) throw new Error(`step ${ref}: a band's drag is whole: it neither drops nor holds`);
    // the element is scrolled clear of the frame's edge bands first, where a held drag scrolls the page from under it
    if (target !== null) await keepAwayFromEdges(page, target.id);
    // (a gap band is drawn once per gap: the first)
    const band = page.locator(`[data-canvas-overlay] [data-door="${ref}"]`).first();
    await expect(band, `step ${ref}: the band is drawn`).toBeVisible();
    const box = await band.boundingBox();
    if (box === null) throw new Error(`step ${ref}: the band is not laid out`);
    const from = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    if (typeof step.type === 'string') {
      await page.mouse.click(from.x, from.y);
    } else {
      const facts = await band.evaluate((el) => ({
        valueArg: el.getAttribute('data-value-arg') ?? '',
        start: Number(el.getAttribute('data-start')),
        normal: (el.getAttribute('data-normal') ?? '0,0').split(',').map(Number),
        shadow: el.getAttribute('data-shadow'),
        startX: Number(el.getAttribute('data-start-x')),
        startY: Number(el.getAttribute('data-start-y')),
        zoom: el.ownerDocument.querySelector<HTMLIFrameElement>('.frame__page')?.currentCSSZoom ?? 1,
      }));
      // a shadow handle moves by the layer's X and Y (offset) or its blur that the step's edit names; any other handle
      // by the value the step names, in the argument the handle says its value goes in (value; a border's width)
      const shadowEdit = facts.shadow !== null && args.edit !== null && typeof args.edit === 'object' ? (args.edit as Record<string, unknown>) : null;
      const length = (value: unknown) => (typeof value === 'string' ? Number.parseFloat(value) : Number.NaN);
      const named = args[facts.valueArg];
      const [dx, dy] =
        shadowEdit !== null
          ? facts.shadow === 'offset'
            ? [(length(shadowEdit.x) - facts.startX) * facts.zoom, (length(shadowEdit.y) - facts.startY) * facts.zoom]
            : [(length(shadowEdit.blur) - facts.start) * facts.zoom, 0]
          : [(length(named) - facts.start) * facts.zoom * (facts.normal[0] ?? 0), (length(named) - facts.start) * facts.zoom * (facts.normal[1] ?? 0)];
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error(`step ${ref}: a handle's drag names the value it makes`);
      const key = heldKey(step);
      await page.mouse.move(from.x, from.y);
      if (key !== undefined) await page.keyboard.down(key);
      await page.mouse.down();
      await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
      await page.mouse.up();
      if (key !== undefined) await page.keyboard.up(key);
    }
  } else if (d.kind === 'canvas-handle' && d.gesture === ROTATE_GESTURE) {
    // the rotation zones (spec rotation-handle; item 4.4: one outside each corner, the same door): the first is taken,
    // pressed at its middle and moved along the circle around the selected element's centre by the turn from the angle
    // it holds to the step's, then released
    const handle = page.locator(`[data-canvas-overlay] [data-door="${ref}"]`).first();
    await expect(handle, `step ${ref}: the handle is drawn`).toBeVisible();
    const box = await handle.boundingBox();
    if (box === null) throw new Error(`step ${ref}: the handle is not laid out`);
    const facts = await page.evaluate(() => {
      const iframe = window.document.querySelector<HTMLIFrameElement>('.frame__page');
      const selected = (window as unknown as { __builderTestPort?: { selection: () => string[] } }).__builderTestPort?.selection()[0];
      const element = selected === undefined ? null : iframe?.contentDocument?.querySelector(`[data-node="${selected}"]`);
      if (!iframe || !element || !iframe.contentWindow) return null;
      const frame = iframe.getBoundingClientRect();
      const style = getComputedStyle(iframe);
      const zoom = iframe.currentCSSZoom;
      const r = element.getBoundingClientRect();
      const left = frame.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
      const top = frame.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
      return { x: left + (r.left + r.width / 2) * zoom, y: top + (r.top + r.height / 2) * zoom, rotate: iframe.contentWindow.getComputedStyle(element).rotate };
    });
    if (facts === null) throw new Error(`step ${ref}: no element is selected on the canvas`);
    const wanted = typeof args.value === 'string' ? parseFloat(args.value) : Number.NaN;
    if (!Number.isFinite(wanted)) throw new Error(`step ${ref}: the step names the angle it turns to`);
    const held = facts.rotate === 'none' ? 0 : parseFloat(facts.rotate);
    const turn = ((((wanted - held + 180) % 360) + 360) % 360) - 180;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const radius = Math.hypot(from.x - facts.x, from.y - facts.y);
    const start = Math.atan2(from.y - facts.y, from.x - facts.x);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const steps = 24;
    for (let i = 1; i <= steps; i += 1) {
      const angle = start + ((turn * Math.PI) / 180) * (i / steps);
      await page.mouse.move(facts.x + radius * Math.cos(angle), facts.y + radius * Math.sin(angle));
    }
    await page.mouse.up();
  } else if (d.kind === 'canvas-handle' && CLICK_HANDLES.includes(d.gesture ?? '')) {
    // a tab of the selection clicked (an anchor tab, spec absolute-anchors): pressed and released at its middle, where
    // the canvas draws it
    const tab = page.locator(`[data-door="${ref}"]`);
    await expect(tab, `step ${ref}: the tab is drawn`).toBeVisible();
    await expect(tab, `step ${ref}: the tab takes a click`).toBeEnabled();
    await tab.click();
  } else if (d.kind === 'canvas-handle') {
    // a handle of the one selected element, dragged by the travel that gives the size the step asks: its width and
    // height are the element's declared size (its content under content-box), so the travel is the difference between
    // that border box and the one drawn now, on the handle's sides, times the zoom
    if (target !== null) await keepAwayFromEdges(page, target.id);
    const handle = page.locator(`[data-canvas-overlay] [data-door="${ref}"]`);
    await expect(handle, `step ${ref}: the handle is drawn`).toBeVisible();
    // the chrome redraws the handles every frame (a selection that moved, a canvas that panned): the box is read once
    // the frame has settled, or the press lands where the handle stood a frame ago
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const box = await handle.boundingBox();
    if (box === null) throw new Error(`step ${ref}: the handle is not laid out`);
    const basis = await page.evaluate(() => {
      const iframe = window.document.querySelector<HTMLIFrameElement>('.frame__page');
      const selected = (window as unknown as { __builderTestPort?: { selection: () => string[] } }).__builderTestPort?.selection()[0];
      const element = selected === undefined ? null : iframe?.contentDocument?.querySelector(`[data-node="${selected}"]`);
      if (!iframe || !element || !iframe.contentWindow) return null;
      const style = iframe.contentWindow.getComputedStyle(element);
      const px = (value: string) => parseFloat(value) || 0;
      const r = element.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        extraX: px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth),
        extraY: px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth),
        contentBox: style.boxSizing === 'content-box',
        zoom: iframe.currentCSSZoom,
      };
    });
    if (basis === null) throw new Error(`step ${ref}: no element is selected on the canvas`);
    const side = (d.handle ?? '').slice((d.handle ?? '').lastIndexOf('-') + 1);
    const wanted = (value: unknown, extra: number) => (typeof value === 'string' ? parseFloat(value) + (basis.contentBox ? extra : 0) : null);
    const width = wanted(args.width, basis.extraX);
    const height = wanted(args.height, basis.extraY);
    const dx = width === null ? 0 : side.includes('e') ? width - basis.width : side.includes('w') ? basis.width - width : 0;
    const dy = height === null ? 0 : side.includes('s') ? height - basis.height : side.includes('n') ? basis.height - height : 0;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // the key the step holds (Ctrl: no snapping) is pressed once the handle is taken, as a person holds it during the
    // drag
    const key = heldKey(step);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    if (key !== undefined) await page.keyboard.down(key);
    await page.mouse.move(from.x + dx * basis.zoom, from.y + dy * basis.zoom, { steps: 12 });
    if (step.hold === true) held.current = { door: ref };
    else await page.mouse.up();
    if (key !== undefined) await page.keyboard.up(key);
  } else if ((d.kind === 'canvas-drag' || d.kind === 'panel-drag') && d.gesture === 'file-drag') {
    // a file dragged in from the operating system (spec explorer-assets/-use): the page is handed a real DataTransfer
    // holding the step's file and the drag enters, moves and is released — on the frame over the node the step's drop
    // names (the canvas drop), or on the Explorer's folder zone (the folder drop, which names no node)
    const named = Object.entries(argTypes(ref)).find(([, a]) => a.type === 'file')?.[0];
    const carried = named === undefined ? undefined : step.args[named];
    if (typeof carried !== 'string') throw new Error(`step ${ref}: a file drag hands the file its "${named ?? 'file'}" argument names`);
    const at = d.kind === 'panel-drag' || step.drop === null ? null : await nodePoint(page, nodeAt(document, step.drop.reference).id, isRoot(document, step.drop.reference), step.drop.reference);
    // the command reads the dropped file after the drop, as it reads a chosen one after the chooser closes: it has run
    // once the status bar says something else (the drop itself only hands the events over)
    const saidBeforeDrop = await page.getByRole('status').textContent();
    await dropOsFile(page, carried, at);
    await expect.poll(() => page.getByRole('status').textContent(), { message: `step ${ref}: the dropped file is stored`, intervals: POLL }).not.toBe(saidBeforeDrop);
  } else if (d.kind === 'canvas-drag' && d.gesture === 'space-pan') {
    // a pan: pressed over the step's node with Space held (or with the middle button) and moved by the page's travel
    if (target === null || step.target === null) throw new Error(`step ${ref}: a pan starts over the node it names`);
    // the node's own point where it has one; else a point of its box the canvas shows (a pan need not hit the node)
    const own = await canvasPoint(page, { kind: 'node', id: target.id, root: isRoot(document, step.target), near: 'centre' });
    const from = typeof own === 'string' ? await nodeInsidePoint(page, target.id) : own;
    if (typeof from === 'string') throw new Error(`${step.target}: ${from}`);
    const dx = typeof args.dx === 'number' ? args.dx : 0;
    const dy = typeof args.dy === 'number' ? args.dy : 0;
    const button = d.source === 'middle-button' ? 'middle' : 'left';
    await page.mouse.move(from.x, from.y);
    if (d.source === 'space-held') await page.keyboard.down('Space');
    await page.mouse.down({ button });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
    await page.mouse.up({ button });
    if (d.source === 'space-held') await page.keyboard.up('Space');
  } else if (d.kind === 'canvas-drag' || d.kind === 'layers-drag') {
    if (held.current !== null && held.current.door === ref && step.target === null && step.drop === null && step.hold !== true) {
      // the release of the held drag, where the pointer is
      await page.mouse.up();
      held.current = null;
    } else if (held.current !== null) {
      // a door acting during the held drag: the pointer rests on the row it names for the dwell its gesture waits
      if (step.target === null || !d.zone?.endsWith('dwell')) throw new Error(`step ${ref}: a drag is held; only its release or a dwell may follow`);
      const gesture = interactions.gestures.find((g) => g.id === d.gesture);
      const dwell = interactions.constants.find((c) => c.id.toLowerCase().includes('dwell') && c.source === gesture?.source)?.value;
      if (typeof dwell !== 'number') throw new Error(`step ${ref}: no dwell constant for gesture ${d.gesture ?? ''}`);
      const on = await controlPoint(page, layersRowRef, { target: target?.id });
      await page.mouse.move(on.x, on.y, { steps: 4 });
      await page.waitForTimeout(dwell + 150);
    } else if (d.source !== undefined && GUIDE_SOURCES.includes(d.source)) {
      // a guide drag (spec guides-manual): out of a ruler, pressed at its middle, to where the page's coordinate is the
      // step's place on the guide's axis; a guide pressed on its line, to its new place over the page or onto its own
      // ruler (its zone own-ruler)
      const facts = await page.evaluate(() => {
        const iframe = window.document.querySelector<HTMLIFrameElement>('.frame__page');
        if (!iframe?.contentWindow) return null;
        const f = iframe.getBoundingClientRect();
        const style = getComputedStyle(iframe);
        const zoom = iframe.currentCSSZoom;
        return {
          left: f.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom,
          top: f.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom,
          zoom,
          scrollX: iframe.contentWindow.scrollX,
          scrollY: iframe.contentWindow.scrollY
        };
      });
      if (facts === null) throw new Error(`step ${ref}: the canvas has no page`);
      const middle = async (selector: string) => {
        const box = await page.locator(selector).boundingBox();
        if (box === null) throw new Error(`step ${ref}: ${selector} is not drawn`);
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const guideId = typeof args.guide === 'string' ? args.guide : null;
      // a guide pressed must be drawn: a step fails on that assertion, never on a timeout
      if (d.source === 'guide') await expect(page.locator(`[data-guide="${guideId ?? ''}"]`), `step ${ref}: the guide is drawn`).toBeVisible();
      const axis = d.source === 'top-ruler' ? 'horizontal' : d.source === 'left-ruler' ? 'vertical' : await page.locator(`[data-guide="${guideId ?? ''}"]`).getAttribute('data-axis');
      const from = d.source === 'guide' ? await middle(`[data-guide="${guideId ?? ''}"]`) : await middle(`[data-ruler="${axis ?? ''}"]`);
      const at = typeof args.at === 'number' ? args.at : null;
      const to =
        d.zone === 'own-ruler'
          ? await middle(`[data-ruler="${axis ?? ''}"]`)
          : at === null
            ? null
            : axis === 'horizontal'
              ? { x: from.x, y: facts.top + (at - facts.scrollY) * facts.zoom }
              : { x: facts.left + (at - facts.scrollX) * facts.zoom, y: from.y };
      if (to === null) throw new Error(`step ${ref}: a guide drag over the page names its place`);
      const threshold = typeof DRAG_THRESHOLD === 'number' ? DRAG_THRESHOLD : 4;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + (axis === 'vertical' ? threshold + 2 : 0), from.y + (axis === 'horizontal' ? threshold + 2 : 0), { steps: 3 });
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
    } else if (d.source === POSITIONED_ELEMENT) {
      // the free drag of a positioned element (spec absolute-free-drag): pressed on the step's target where an element
      // drag presses it, moved past the threshold and then by the step's travel in page px times the zoom, released
      if (target === null || step.target === null) throw new Error(`step ${ref}: a free drag names its target`);
      const dx = step.args.dx;
      const dy = step.args.dy;
      if (typeof dx !== 'number' || typeof dy !== 'number') throw new Error(`step ${ref}: a free drag names its dx and dy`);
      const from = await elementDragPoint(page, document, step.target);
      const zoom = await page.locator('.frame__page').evaluate((frame) => (frame as HTMLIFrameElement).currentCSSZoom);
      const threshold = typeof DRAG_THRESHOLD === 'number' ? DRAG_THRESHOLD : 4;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + threshold + 2, from.y, { steps: 3 });
      // the key the step holds (Ctrl: no snapping) is pressed once the drag has begun: pressed with the press, it would
      // make the press a Ctrl+click on the element
      const key = heldKey(step);
      if (key !== undefined) await page.keyboard.down(key);
      await page.mouse.move(from.x + dx * zoom, from.y + dy * zoom, { steps: 12 });
      await page.mouse.up();
      if (key !== undefined) await page.keyboard.up(key);
    } else {
      if (step.drop === null) throw new Error(`step ${ref}: a drag names its drop`);
      // a drop onto the canvas is aimed as a person aims it: the place it lands is scrolled into view first when it
      // lies in the band along the frame's top or bottom edge where a held drag scrolls the page (drop.autoscrollZone),
      // so the drag does not scroll the page from under the pointer; a step that waits at an edge wants that scroll
      if (step.drop.on !== 'layers-row' && d.kind !== 'layers-drag' && step.wait === undefined) await keepAwayFromEdges(page, nodeAt(document, step.drop.reference).id);
      const from =
        d.source === 'palette-tile'
          ? await controlPoint(page, paletteTileDoor(ref), { entry: args.entry })
          : d.source === COMPONENT_TILE
            ? await controlPoint(page, tileDoorOf(ref, COMPONENT_TILE), { component: args.component })
            : d.source === 'layers-row' && target !== null
            ? await controlPoint(page, layersRowRef, { target: target.id })
            : target !== null && step.target !== null && d.source === 'canvas-element'
              ? await elementDragPoint(page, document, step.target)
              : target !== null && step.target !== null && d.source === 'empty-area'
                ? await nodePoint(page, target.id, isRoot(document, step.target), step.target, 'start')
                : target !== null && step.target !== null && d.source === 'element'
                  ? await nodePoint(page, target.id, isRoot(document, step.target), step.target)
                  : null;
      if (from === null) throw new Error(`step ${ref}: the runner cannot press a ${d.source ?? ''} source`);
      const to =
        d.kind === 'layers-drag' || step.drop.on === 'layers-row'
          ? await layersDropPoint(page, document, step.drop)
          : d.source === 'empty-area' || d.source === 'element'
            ? await marqueeEndPoint(page, document, step.drop)
            : d.zone === 'side-band'
              ? await sideDropPoint(page, document, step.drop)
              : await canvasDropPoint(page, document, step.drop, typeof step.args.index === 'number' ? step.args.index : null);
      // a gesture's modifier stands for the mode the step asks (the marquee's Shift adds to the selection); a gesture
      // whose modifier is held for the whole drag (a meaning "held-…": the duplicate's Alt, spec drag-duplicate) holds
      // it
      const gesture = interactions.gestures.find((g) => g.id === d.gesture);
      const mode = typeof step.args.mode === 'string' ? step.args.mode : null;
      const modifier = mode === null ? (gesture?.modifiers.find((m) => m.meaning.startsWith('held-'))?.key ?? null) : (gesture?.modifiers.find((m) => m.meaning.startsWith(`${mode}-`))?.key ?? null);
      const threshold = typeof DRAG_THRESHOLD === 'number' ? DRAG_THRESHOLD : 4;
      // the key a band takes the leaves with (spec marquee-select, Problems in Pager 3; the step's `leaves`): pressed
      // once the band has begun, since the band reads it live
      const leavesKey = step.args.leaves === true ? gesture?.modifiers.find((m) => m.meaning === 'take-leaves')?.key : undefined;
      const leaves = leavesKey === undefined ? undefined : MODIFIER_KEY[leavesKey];
      await page.mouse.move(from.x, from.y);
      const key = modifier ? MODIFIER_KEY[modifier] : undefined;
      if (key) await page.keyboard.down(key);
      await page.mouse.down();
      await page.mouse.move(from.x + threshold + 2, from.y + threshold + 2, { steps: 3 });
      // a drag lives across frames: the app's per-frame work reads the pointer where it passes (the autoscroll arms
      // only once the pointer has been properly inside the scroller, spec drag-autoscroll), so it rests a frame on the
      // way before the drop's place
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (leaves) await page.keyboard.down(leaves);
      // a tile dropped into a container's slot comes down onto it from just above, as a hand aims at a gap: a straight
      // line from the sidebar grazes the side band of the container on the way (drag-layout: a side offer met on the
      // way stays while the pointer is near its pill), which the drop is not about
      if (d.source === 'palette-tile' && step.drop.placement === 'inside' && step.drop.on !== 'layers-row') await page.mouse.move(to.x, to.y - APPROACH, { steps: 12 });
      await page.mouse.move(to.x, to.y, { steps: d.source === 'palette-tile' && step.drop.placement === 'inside' && step.drop.on !== 'layers-row' ? 4 : 12 });
      if (step.hold === true) held.current = { door: ref };
      else await page.mouse.up();
      if (leaves) await page.keyboard.up(leaves);
      if (key) await page.keyboard.up(key);
    }
  } else if (d.kind === 'shortcut') {
    // a key of the text edited in place (the focus there was asserted above) acts on the edit: its arguments (the
    // node, the text) are what the edit holds, which the document diff checks; no control stands for them. A key of
    // the hand (asserted above too) acts at the hand's aim: its arguments (Enter: element.moveTo's parent and index)
    // are where the steps before it aimed, which the document diff checks as well. A key of the inspector's text field
    // (asserted above) acts on the field: its arguments (the node, the text) are what the field holds
    // (a key held with it, the step's modifier, is no argument a control stands for)
    const standsFor = withoutGestureArgs(own);
    if (
      d.context !== EDIT_CONTEXT &&
      d.context !== HAND_CONTEXT &&
      d.context !== FIELD_TEXT_CONTEXT &&
      d.context !== NUMBER_FIELD_CONTEXT &&
      d.context !== SPACING_FIELD_CONTEXT &&
      d.context !== 'captured-value' &&
      d.context !== COMMAND_FIELD_CONTEXT &&
      Object.keys(standsFor).length > 0
    ) {
      await focusControlFor(page, ref, standsFor);
      // the control the key acts on lies in the door's key context (a palette tile in the palette's)
      const chain = await focusedContexts(page);
      if (d.context !== undefined && !chain.includes(d.context)) throw new Error(`step ${ref}: the focus is in ${chain[0] ?? 'nothing'}, the door waits in ${d.context}`);
    }
    if (d.chord === undefined) throw new Error(`shortcut ${ref} has no chord`);
    // a key of a region of controls (a toolbar, a tab strip, the palette, the Layers tree) is pressed with the focus in
    // that region, as a person puts it there first (tests/e2e/door.ts focusContext)
    await focusContext(page, d.context);
    // the key the step holds with it (Shift+ArrowUp in a number field)
    const key = heldKey(step);
    await page.keyboard.press(key === undefined ? keys(d.chord) : `${key}+${keys(d.chord)}`);
    if (held.current !== null && ref === CANCEL_DOOR) held.current = { ...held.current, cancelled: true };
  } else if (d.kind === 'inspector-field' || quickField || (d.kind === 'panel-control' && d.drawnAs === 'field')) {
    // A field. An inspector field is drawn once, for the selection, so its control is the door's only one: its
    // arguments are what it acts on (the selection, by its adapter) and what the step types, which the document diff
    // checks. A panel field is drawn once per node (a Layers row's name field, while its node is renamed): its control
    // stands for every argument of the step but the one text argument it keeps (its data-args name the others: a
    // custom attribute's value field stands for its name, the add field for the empty value it adds). A field not shown
    // (a tab not chosen, a node not renamed) fails the step on an assertion. The runner clicks the field's editable
    // element (an input, a text area, an editable element; the control itself when it is one) and selects what it holds
    // with Control+A (a field keeps its own keys). An inspector field then takes the step's `type` below ("\n" is
    // Enter); a panel field takes the text argument it keeps, typed in place of what it held and kept with Enter.
    if (step.hold === true || step.drop !== null) throw new Error(`step ${ref}: a field neither drops nor holds`);
    // an inspector field drawn as one button per value (keyword buttons: text-align) with nothing to type: the button
    // that stands for the step's value is clicked
    const valueButton = d.kind === 'inspector-field' && typeof step.type !== 'string' ? control(page, ref, { args: own }) : null;
    // (keyword buttons drawn as a keyword menu, their words too long for the row: the menu is opened first)
    if (valueButton !== null) await openValueMenu(page, ref, own);
    if (valueButton !== null && (await valueButton.count()) === 1) {
      await valueButton.click();
      return;
    }
    const types = argTypes(ref);
    // a panel control's kept text argument; a quick panel field without a  is the same kind of field
    const text = d.kind === 'panel-control' || (d.kind === 'quick-panel' && typeof step.type !== 'string') ? Object.entries(own).filter(([name]) => types[name]?.type !== 'node') : null;
    const standing = (keptName: string) => control(page, ref, { args: Object.fromEntries(Object.entries(own).filter(([name]) => name !== keptName)) });
    let kept: [string, unknown] | undefined;
    for (const candidate of text ?? []) {
      const found = standing(candidate[0]);
      if ((await found.count()) === 1 && !Object.hasOwn(JSON.parse((await found.getAttribute('data-args')) ?? '{}') as object, candidate[0])) kept = candidate;
    }
    const value = kept?.[1];
    // (a number argument, a grid setting's value, is typed as its decimal)
    if (text !== null && (kept === undefined || (typeof value !== 'string' && typeof value !== 'number') || typeof step.type === 'string')) throw new Error(`step ${ref}: a panel field keeps the one text argument its control does not stand for, typed into it, and takes no \`type\`; none of ${JSON.stringify(Object.fromEntries(text))} is`);
    const field = text === null || kept === undefined ? control(page, ref) : standing(kept[0]);
    await expect(field, `step ${ref}: its control is drawn`).toBeVisible();
    const menu = field.locator('select');
    if ((await menu.count()) > 0 && (typeof value === 'string' || typeof value === 'number')) {
      await expect(menu.first(), `step ${ref}: its menu takes a choice`).toBeEnabled();
      await menu.first().selectOption(String(value));
      return;
    }
    const editable = field.locator('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
    const typedInto = (await editable.count()) > 0 ? editable.first() : field;
    // a field that takes nothing now (disabled: its gradient not there yet) fails the step on an assertion, never on
    // the click's timeout
    await expect(typedInto, `step ${ref}: its field takes input`).toBeEnabled();
    await typedInto.click();
    // a slider (the colour picker's hue and alpha): the click at its middle sets it; the value that makes is what the
    // step names and the document diff checks, and nothing is typed
    if (await typedInto.evaluate((el) => el instanceof HTMLInputElement && el.type === 'range')) return;
    // a field with nothing to type into (the gradient bar: a click adds a stop where it lands) takes the click alone
    if (!(await typedInto.evaluate((el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)))) return;
    await page.keyboard.press('Control+A');
    if (typeof value === 'string' || typeof value === 'number') {
      await page.keyboard.press('Backspace');
      if (value !== '') await page.keyboard.type(String(value));
      await page.keyboard.press('Enter');
    }
  } else if (d.kind === 'toolbar' || d.kind === 'menu' || d.kind === 'panel-control' || d.kind === 'context-menu' || d.kind === 'quick-panel') {
    // a control drawn only in some states (the toast's Undo after a delete, an item of the open context menu) fails the
    // step on an assertion that says it is not drawn, never on the click's timeout. The control is the one runDoor
    // clicks: a panel control's door with a key held (a Layers row's Shift+click) or pressed with the secondary button
    // (its secondary click) is its plain control clicked that way (modifiedControl). A Layers row's part whose step
    // names no argument for it (a row's name, whose double-click renames the selection the first click made) is the
    // part of the row of the step's target: shell/sidebar/layers.tsx writes each part's row node as `target`.
    const clicked = modifiedControl(ref)?.drawn ?? ref;
    // (a Layers row's control is drawn on every row: it stands for the row's node too, whatever else it stands for)
    const plain = d.kind === 'panel-control' && d.panel === 'layers' && target !== null ? { ...withoutGestureArgs(own), target: target.id } : withoutGestureArgs(own);
    // an area (the colour picker's) stands for part of its step's arguments: the press gives the rest (the colour at
    // the point runDoor presses), which the document diff checks
    // the colour picker's eyedropper stands for its property: the colour is the one the browser's EyeDropper answers,
    // which the runner makes the step's value, as a person picks it on the screen (the browser's own eyedropper waits
    // for a pointer the test does not move)
    const asksBrowser = d.kind === 'panel-control' && d.control === EYEDROPPER_CONTROL;
    if (asksBrowser) {
      const picked = own.value;
      if (typeof picked !== 'string') throw new Error(`step ${ref}: the eyedropper's step names the colour it picks`);
      await page.evaluate((hex) => {
        (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
          open() {
            return Promise.resolve({ sRGBHex: hex });
          }
        };
      }, picked);
    }
    const areaStands = (d.kind === 'panel-control' && d.drawnAs === 'area') || asksBrowser ? ((await control(page, clicked).count()) === 1 ? Object.keys(JSON.parse((await control(page, clicked).getAttribute('data-args')) ?? '{}') as object) : null) : null;
    const standsFor = areaStands === null ? plain : Object.fromEntries(Object.entries(plain).filter(([name]) => areaStands.includes(name)));
    // A control that opens a field for a text argument (Save the styles as a class: the class's name) stands for the
    // other arguments: the step types that argument (its `type`, then Enter). While no control stands for them all, the
    // opener is clicked, the field it opens must take the focus, and the typing below fills it; the opener is not
    // clicked again.
    // A dialog's button that keeps what its form holds (Snap settings' Apply) stands for no argument itself: the step's
    // arguments are set first, as a person sets them, in the form's inputs named after them (a list: the checkboxes
    // whose values it holds ticked, the others not; a number or a text typed in place of what the field held), then the
    // button is clicked.
    // (a travel `distance` is a panel drag's gesture, never a form's: the arguments are the step's own but its held
    // key)
    if (d.kind === 'panel-control' && d.drawnAs === 'button' && (await fillForm(page, control(page, clicked), Object.fromEntries(Object.entries(own).filter(([name]) => name !== MODIFIER_ARG))))) {
      await control(page, clicked).click();
      return;
    }
    // (a number argument, a guide's place, is typed as its decimal)
    const typedArg = typeof step.type === 'string' ? Object.entries(standsFor).find(([, v]) => ((typeof v === 'string' && v !== '') || typeof v === 'number') && step.type === `${String(v)}\n`)?.[0] : undefined;
    if (d.kind === 'panel-control' && typedArg !== undefined && (await control(page, clicked, { args: standsFor }).count()) === 0) {
      const others = Object.fromEntries(Object.entries(standsFor).filter(([name]) => name !== typedArg));
      const opener = control(page, clicked, { args: others }).and(page.locator('[aria-haspopup]'));
      await expect(opener, `step ${ref}: its control is drawn`).toBeVisible();
      await expect(opener, `step ${ref}: its control takes a click`).not.toHaveAttribute('aria-disabled', 'true');
      await opener.click();
      await expect(page.locator(':focus'), `step ${ref}: the field its control opens takes the typing`).toBeEditable();
    } else {
      // A control that opens the list of its values (a number field's unit menu) stands for fewer arguments than its
      // step names: while no control stands for them all, the one that opens a list and stands for part of them is
      // clicked first, then the item that stands for them all (the top bar's page switcher opens its list of pages).
      if ((d.kind === 'panel-control' || d.kind === 'quick-panel' || d.kind === 'toolbar') && (await control(page, clicked, { args: standsFor }).count()) === 0) {
        const openers = page.locator(`[data-door="${clicked}"][aria-haspopup]`);
        const at = await openers.evaluateAll(
          (els, want) => els.findIndex((el) => Object.entries(JSON.parse(el.getAttribute('data-args') ?? '{}') as Record<string, unknown>).every(([name, value]) => JSON.stringify(want[name]) === JSON.stringify(value))),
          standsFor,
        );
        if (at >= 0) await openers.nth(at).click();
      }
      // a Layers row below the tree's fold is not drawn (A3.28: the tree draws only the rows in its window): the tree
      // is scrolled to it, as a person scrolls to reach it, before the step's control is looked for
      if (d.kind === 'panel-control' && d.panel === 'layers' && target !== null && (await control(page, clicked, { args: standsFor }).count()) === 0) await scrollTreeTo(page, control(page, clicked, { args: standsFor }));
      // a unit the menu keeps behind "More units" (the user's real-use audit, item 5.2): a person opens the rest, and
      // so does the runner, before the step's own item is looked for
      if (d.kind === 'panel-control' && d.control === 'unit-menu' && (await control(page, clicked, { args: standsFor }).count()) === 0) {
        const more = page.locator('[data-menu-more]');
        if ((await more.count()) > 0) await more.first().click();
      }
      if (d.kind === 'toolbar' || d.kind === 'panel-control' || d.kind === 'context-menu' || d.kind === 'quick-panel') await expect(control(page, clicked, { args: standsFor }), `step ${ref}: its control is drawn`).toBeVisible();
      // a quick panel control that takes nothing now (an Edit on canvas mode with nothing to edit) fails the step on an
      // assertion, never on the click's timeout
      if (d.kind === 'quick-panel') await expect(control(page, clicked, { args: standsFor }), `step ${ref}: its control takes a click`).toBeEnabled();
      // a toolbar or panel control drawn unavailable (a field's Reset with nothing to reset) fails the step on an
      // assertion, never on the click's timeout
      if (d.kind === 'toolbar' || d.kind === 'panel-control') await expect(control(page, clicked, { args: standsFor }), `step ${ref}: its control takes a click`).not.toHaveAttribute('aria-disabled', 'true');
      // the key the step holds with the click (Shift on a number field's step button)
      const key = heldKey(step);
      if (key !== undefined) await control(page, clicked, { args: standsFor }).click({ modifiers: [key as 'Shift' | 'Alt' | 'Control' | 'Meta'] });
      else await runDoor(page, ref, { args: standsFor });
    }
  } else if (d.kind === 'command-bar') {
    // the bar opened with its shortcut, the entry's label typed and its row clicked (door.ts); an entry the bar does
    // not offer now (its command cannot run on the selection) fails the step on an assertion, never on the click's
    // timeout
    await openCommandBar(page);
    // an item of the project (a page, an element) is typed by the name it holds in the document (command-bar-find)
    const pages = (document as { pages: { name: string; tree: Node }[] }).pages;
    const nameOf = (id: string): string | undefined => {
      const opened = pages.find((one) => one.tree.id === id);
      if (opened !== undefined) return opened.name;
      const find = (n: Node): string | undefined => (n.id === id ? n.name : n.children.map(find).find((x) => x !== undefined));
      return pages.map((one) => find(one.tree)).find((x) => x !== undefined);
    };
    await page.keyboard.type(barLabel(d, { ...d.args, ...own }, nameOf));
    await expect(control(page, ref, { args: own }), `step ${ref}: the command bar offers it`).toBeVisible();
    await control(page, ref, { args: own }).click();
  } else if (d.kind === 'panel-drag' && d.source === 'data-column') {
    // A column of the Data panel dragged onto an element's part in Connect fields (spec content-data, "binding"):
    // pressed on the column the step's field names, moved onto the part its node and target stand for, released there.
    const from = await controlPoint(page, ref, { field: args.field });
    const part = page.locator(`[data-data-target][data-args='${JSON.stringify({ node: args.node, to: args.to })}']`);
    await expect(part, `step ${ref}: the part the column is dropped on is drawn`).toHaveCount(1);
    await part.scrollIntoViewIfNeeded();
    const box = await part.boundingBox();
    if (box === null) throw new Error(`step ${ref}: the part the column is dropped on is not laid out`);
    await page.mouse.move(Math.round(from.x), Math.round(from.y));
    await page.mouse.down();
    await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), { steps: 12 });
    await page.mouse.up();
  } else if (d.kind === 'panel-drag') {
    // A panel drag (a number field's label scrubbed): pressed at the middle of the control that stands for the step's
    // arguments (rounded to whole pixels, so its travel is exact), moved `distance` screen pixels to the right (left
    // when negative) with the step's key held, and released, or held across the next steps; a later step on the same
    // door with nothing held after it releases a held one.
    if (held.current !== null && held.current.door === ref && step.hold !== true) {
      await page.mouse.up();
      held.current = null;
    } else {
      if (held.current !== null) throw new Error(`step ${ref}: a drag is held; only its release may follow`);
      const travel = step.args[TRAVEL_ARG];
      if (typeof travel !== 'number') throw new Error(`step ${ref}: a panel drag names its ${TRAVEL_ARG}`);
      const middle = await controlPoint(page, ref, withoutGestureArgs(own));
      const from = { x: Math.round(middle.x), y: Math.round(middle.y) };
      // a splitter is dragged along the axis layout.json declares for it (a vertical one up or down); a shadow
      // editor's layer rows too (a layer climbs over the row above, A3.34); every other panel drag travels horizontally
      // (a number field's label scrubbed)
      // the Explorer's file tree too: a row is dragged onto a folder row above or below it (spec explorer-file-system)
      const along = SPLITTERS[String(step.args.splitter ?? '')]?.axis === 'y' || VERTICAL_ZONES.has(String(d.zone)) || (d.kind === 'panel-drag' && d.source === 'explorer-row') ? 'y' : 'x';
      const key = heldKey(step);
      await page.mouse.move(from.x, from.y);
      if (key !== undefined) await page.keyboard.down(key);
      await page.mouse.down();
      await page.mouse.move(along === 'y' ? from.x : from.x + travel, along === 'y' ? from.y + travel : from.y, { steps: 10 });
      if (step.hold === true) held.current = { door: ref };
      else await page.mouse.up();
      if (key !== undefined) await page.keyboard.up(key);
    }
  } else {
    throw new Error(`step ${ref}: the runner cannot run a ${d.kind} door yet`);
  }
  // the file (or files) the door asked for, chosen as a person chooses them in the one picker
  if (chooser !== null) {
    // a whole folder (File › Open folder) is handed over as the directory itself: the [webkitdirectory] input takes a
    // path, never a file list (spec explorer-open-folder)
    const picked = await Promise.all((filesValue as readonly string[]).map(async (one) => chosenFile(one, downloads)));
    const folders = picked.flatMap((one) => (one.folder === undefined ? [] : [one.folder]));
    await (await chooser).setFiles(folders.length > 0 ? folders : picked.map((one) => ({ name: one.name, mimeType: one.mimeType, buffer: one.buffer })));
    await expect
      .poll(async () => (await page.locator('[data-confirmation-dialog], [data-region="html-import"]').count()) > 0 || (await page.getByRole('status').textContent()) !== saidBefore, { message: `step ${ref}: the command reads the chosen file` })
      .toBe(true);
    // Import now asks for a destination. A step with no destination leaves that choice to its next explicit door.
    if (typeof step.args.destination === 'string' && await page.locator('[data-region="html-import"]').count()) {
      await page.locator(`[data-region="html-import"] [data-args*='"destination":"${step.args.destination}"']`).click();
    }
  }
  // the confirmation the command asks, answered as the step says; none may be left waiting
  const dialog = page.locator('[data-confirmation-dialog]');
  if (step.answer === 'confirm' || step.answer === 'cancel') {
    await expect(dialog, `step ${ref}: a confirmation asks`).toBeVisible();
    await dialog.locator(`[data-confirmation="${step.answer}"]`).click();
    await expect(dialog, `step ${ref}: the answer closes the confirmation`).toHaveCount(0);
  } else await expect(dialog, `step ${ref}: no confirmation waits for an answer the step does not give`).toHaveCount(0);
  // the characters the step types with the real keyboard ("\n" is Enter); U+2028, the line separator, is Shift+Enter,
  // the line break a person types in a text field; "\t" is Tab, the key that leaves a field (the keyboard's type would
  // write a tab character into a text area)
  if (typeof step.type === 'string') {
    for (const [i, line] of step.type.split(LINE_BREAK).entries()) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      for (const [j, part] of line.split(TAB).entries()) {
        if (j > 0) await page.keyboard.press('Tab');
        if (part !== '') await page.keyboard.type(part);
      }
    }
  }
}

async function setUp(page: Page, s: Scenario): Promise<unknown> {
  const viewport = environment.viewports.find((v) => v.id === s.setup.viewport);
  if (!viewport) throw new Error(`no viewport ${s.setup.viewport}`);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // another tab of the editor open first, editing, with the fixture opened there and saved (spec multi-tab-guard):
  // the scenario's tab opens second, reading the saved project
  if (s.setup.tabs === 'another-tab-editing') {
    const other = await page.context().newPage();
    await other.setViewportSize({ width: viewport.width, height: viewport.height });
    await openEditor(other);
    if (s.setup.fixture !== EMPTY_FIXTURE) {
      await openMenu(other, 'file');
      const chooser = other.waitForEvent('filechooser');
      await other.locator('[data-door="project.open#menu-file"]').click();
      await (await chooser).setFiles(path.join('manifest/features/fixtures', `${s.setup.fixture}.json`));
      await expect(other.locator('[data-save-state]'), 'the other tab saved the fixture').toHaveAttribute('data-save-state', 'saved');
    }
    await page.bringToFront();
  }
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
  // the system clipboard as the editor reads it (a paste in the text edited in place, spec text-inline-formatting):
  // allowed, as a person allows it once when the browser asks, and empty, whatever an earlier test in this browser
  // copied (the browser's clipboard outlives a test's context). A setup naming `clipboard: "denied"` withdraws the
  // permission instead, as a person refusing the browser's prompt: copy and paste must then work inside the editor
  // alone (the user's real-use audit, item 3.8)
  if (s.setup.clipboard === 'denied') await page.context().clearPermissions();
  else {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    // an object holds what the clipboard carries from outside the editor (spec clipboard-paste-external): its text/html
    // markup and its text/plain text, written as an application writes them, so a paste reads them through the door a
    // person's Ctrl+V does; absent (or the empty string) leaves the clipboard empty, whatever an earlier test copied
    const carried = typeof s.setup.clipboard === 'object' ? s.setup.clipboard : {};
    await page.evaluate(
      ({ html, text }) =>
        html === undefined
          ? navigator.clipboard.writeText(text ?? '').catch(() => undefined)
          : navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text ?? ''], { type: 'text/plain' }) })]).catch(() => undefined),
      { html: carried.html, text: carried.text },
    );
  }
  if (s.setup.locale !== environment.locales.default) await runDoor(page, settingDoor('preferences.setLanguage', 'locale', s.setup.locale));
  // the editor shows the setup's language, whether a door switched it or it is the default
  await expect.poll(() => uiLocale(page), { message: `setup locale ${s.setup.locale}`, intervals: POLL }).toBe(s.setup.locale);
  if (s.setup.fixture !== EMPTY_FIXTURE && s.setup.tabs === 'another-tab-editing') {
    // the fixture the other tab opened and saved, which this tab reads
    const fixture = read(path.join('manifest/features/fixtures', `${s.setup.fixture}.json`));
    await expect.poll(async () => (await port(page)).document, { message: `this tab reads ${s.setup.fixture}, saved by the other tab`, intervals: POLL }).toEqual(fixture);
  } else if (s.setup.fixture !== EMPTY_FIXTURE) {
    // File › Open, with the browser's file chooser, as a user opens a project
    await openMenu(page, 'file');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-door="project.open#menu-file"]').click();
    await (await chooser).setFiles(path.join('manifest/features/fixtures', `${s.setup.fixture}.json`));
    const fixture = read(path.join('manifest/features/fixtures', `${s.setup.fixture}.json`));
    await expect.poll(async () => (await port(page)).document, { message: `File › Open loads ${s.setup.fixture}`, intervals: POLL }).toEqual(fixture);
  }
  await expectCanvasDraws(page, s.setup.fixture === EMPTY_FIXTURE ? 'at the start' : 'after File › Open');
  // the saved record made unreadable once autosave has saved the fixture, and the editor started again on it (spec
  // autosave-corruption-recovery): the versions it keeps are the ones the editor wrote
  if (s.setup.storage === 'corrupt-current-record') {
    await expect(page.locator('[data-save-state]'), 'autosave saved the fixture').toHaveAttribute('data-save-state', 'saved');
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('work');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('projects', 'readwrite');
            tx.objectStore('projects').put({ revision: 1000, format: 1, document: 'this is not a project', selection: [] }, 'current');
            tx.oncomplete = () => {
              open.result.close();
              window.localStorage.removeItem('work-journal');
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.reload();
    await expect(page.locator('.workbench')).toBeVisible();
  }
  // a local Companion for the assistant (spec assistant-chat): started, and with "paired" this editor's key saved and
  // the editor connected through the preferences, as a person does before asking anything
  if (s.setup.companion !== undefined) {
    await startCompanion(page);
    if (s.setup.companion === 'paired') {
      await runDoor(page, 'workspace.setPanelOpen#toolbar-activity-bar-assistant');
      await runDoor(page, 'assistant.setPreferences#assistant-preferences');
      await control(page, 'assistant.editKey#assistant-key').locator('input').fill(COMPANION_KEY);
      await runDoor(page, 'assistant.saveKey#assistant-save-key');
      await expect(page.locator('[data-region="assistant-panel"]'), 'the key is saved').toContainText(await text(page, s.setup.locale, 'assistant.keySaved', {}));
      await runDoor(page, 'assistant.connect#assistant-bridge-connect');
      await expect(page.locator('.assistant-connection__state'), 'the editor is connected').toHaveText(await text(page, s.setup.locale, 'assistant.connection.connected', {}));
      await runDoor(page, 'assistant.setPreferences#assistant-close-preferences');
    }
  }
  const loaded = (await port(page)).document;
  // the selection, clicked on the canvas as a person selects: the first node, then each other added. A node its
  // children cover whole has no point of its own on the canvas; a person reaches it another way (spec select-click,
  // "Nested elements": its padding, the breadcrumb, ArrowUp or the Layers panel). The first node: a click on its
  // nearest descendant that has a point of its own, then ArrowUp once per level, which leaves the focus on the canvas.
  // A node added: its Layers row with the key held, then Escape, which gives the focus back to the canvas.
  for (const [i, nodePath] of s.setup.selection.entries()) {
    const node = nodeAt(loaded, nodePath);
    await frameElement(page, node.id, nodePath);
    const at = await canvasPoint(page, { kind: 'node', id: node.id, root: isRoot(loaded, nodePath), near: 'centre' });
    const door = i === 0 ? SELECT_DOOR : ADD_DOOR;
    if (typeof at !== 'string') {
      await withModifier(page, doorData(door).modifier, () => page.mouse.click(at.x, at.y));
      continue;
    }
    if (at !== NO_OWN_POINT) throw new Error(`${nodePath}: ${at}`);
    if (i === 0) {
      const below = await ownPointBelow(page, node, 1);
      if (below === null) throw new Error(`${nodePath}: neither it nor any node inside it has a point of its own on the canvas`);
      await page.mouse.click(below.point.x, below.point.y);
      for (let level = 0; level < below.levels; level += 1) await runDoor(page, WALK_UP_DOOR);
      ranAlso(WALK_UP_DOOR);
    } else {
      await runDoor(page, ADD_ROW_DOOR, { args: { target: node.id } });
      ranInstead(door, ADD_ROW_DOOR);
      if (!doorWorks(BACK_TO_CANVAS_DOOR)) throw new Error(`${nodePath}: added through its Layers row, the focus stays there until ${BACK_TO_CANVAS_DOOR} is built`);
      await runDoor(page, BACK_TO_CANVAS_DOOR);
      ranAlso(BACK_TO_CANVAS_DOOR);
    }
  }
  expect((await port(page)).selection, 'setup: the selection').toEqual(s.setup.selection.map((p) => idOf(loaded, p)));
  for (const [command, arg, value, base] of [
    ['view.setBreakpoint', 'breakpoint', s.setup.breakpoint, BASE_BREAKPOINT],
    ['view.setStyleState', 'state', s.setup.state, BASE_STATE],
    ['view.zoomTo', 'percent', s.setup.zoom, 'fit'],
  ] as const) {
    if (value !== base) await runDoor(page, settingDoor(command, arg, value));
  }
  // the dialog context: a dialog the editor opened at its start (the recovery dialog) holds the focus
  if (s.setup.context === DIALOG_CONTEXT) {
    expect(await page.evaluate(() => document.activeElement?.closest('[data-key-context="dialog"]') !== null && document.activeElement !== null), 'setup context dialog: an open dialog holds the focus').toBe(true);
    return loaded;
  }
  // the global context: no control holds the focus
  if (s.setup.context !== 'global') throw new Error(`setup context ${s.setup.context}: no door brings the focus there yet`);
  expect(await page.evaluate(() => document.activeElement === null || document.activeElement === document.body), 'setup context global: no control holds the focus').toBe(true);
  return loaded;
}

// every scenario of every feature that runs, once per door of its action step
// The browser runs the fast runner already proved on this tree (balance.ts), none while the tooth proof switches
// handlers off (every run must then fail) or E2E_BALANCE=0 asks for every run.
function runsLeftOut(): ReadonlySet<string> {
  const tooth = (process.env.TOOTH_COMMANDS ?? '') !== '' || (process.env.TOOTH_MODULE ?? '') !== '';
  if (tooth || process.env.E2E_BALANCE === '0') return new Set();
  const proven = headlessProven();
  return proven === null ? new Set() : leftOut(FEATURES.filter(runnable), proven);
}

export function registerScenarioTests(): void {
  const left = runsLeftOut();
  for (const feature of FEATURES.filter(runnable)) {
    for (const s of feature.scenarios) {
      for (const door of s.doors) {
        if (left.has(runName(feature.id, s.id, door))) {
          // proven by the fast runner on this tree; the door's gesture runs in another browser test
          test.skip(`${feature.id} › ${s.id} › ${door}`, { tag: FEATURE_TAG(feature.id), annotation: [{ type: 'feature', description: feature.id }, { type: PROVEN_HEADLESS, description: 'the fast runner passed this run on this tree' }] }, () => {});
          continue;
        }
        test(`${feature.id} › ${s.id} › ${door}`, { tag: FEATURE_TAG(feature.id), annotation: [{ type: 'feature', description: feature.id }, ...doorsRun(s, door).map((d) => ({ type: 'door', description: d }))] }, async ({ page }) => {
          // every file the editor hands out during the test, as the browser downloads it (the export terminal)
          const downloads: Download[] = [];
          page.on('download', (d) => downloads.push(d));
          const fixture = await setUp(page, s);
          const held = { current: null as Held | null };
          // each refusal is checked right after its refused step (refusalCheck), against the document just before it
          const refusalsAt = s.refusals.map((refusal) => ({ refusal, ...refusalCheck(s.steps, refusal.key, COMMANDS) }));
          const before = new Map<number, unknown>();
          // the downloads the steps before the action made: the export terminal reads the archive the action hands out
          let downloadsBeforeAction = 0;
          for (const [index, step] of s.steps.entries()) {
            if (refusalsAt.some((r) => r.unchangedFrom === index)) before.set(index, (await port(page)).document);
            if (step.action) downloadsBeforeAction = downloads.length;
            // a step whose command reads the clipboard is done once the command has run, which it always says in the
            // status bar (pasted, nothing to paste, the clipboard denied)
            const ref = step.action ? door : step.door;
            const said = readsClipboard(ref) ? await page.getByRole('status').textContent() : null;
            // the tab guard's door starts the tab again (Take over editing reloads it once the lock is stolen, spec
            // multi-tab-guard): the next step waits for the editor to be back, never reading the page as it goes
            const placed = doorData(ref).placement;
            const restarts = typeof placed === 'object' && placed !== null && placed.region === TAB_GUARD_REGION;
            const navigated = restarts ? page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() }) : null;
            await runStep(page, step, ref, held, step.action, downloads);
            if (navigated !== null) {
              // a tab that never starts again fails the step on an assertion, never on the wait's timeout (the tooth
              // proof found the take-over scenario failing on time with the command switched off)
              const restarted = await navigated.then(
                () => true,
                () => false,
              );
              expect(restarted, `step ${ref}: the tab starts again`).toBe(true);
              await page.locator('.workbench').waitFor();
            }
            if (step.wait !== undefined) await page.waitForTimeout(step.wait);
            if (said !== null) await expect.poll(() => page.getByRole('status').textContent(), { message: `step ${ref}: the command runs once the clipboard is read`, intervals: POLL }).not.toBe(said);
            // a refusal names its key; the words it fills in ("No next sibling in {parent}.") are those of the feedback
            // of the same key
            for (const { refusal, unchangedFrom } of refusalsAt.filter((r) => r.after === index)) {
              const params = s.expect.render?.feedback.find((f) => f.key === refusal.key)?.params ?? {};
              await expect(page.getByRole('status'), 'refusal').toHaveText(await text(page, localeAfter(s, door, index), refusal.key, params));
              expect(matchDocument((await port(page)).document, before.get(unchangedFrom)), 'refused: the refused step leaves the document unchanged').toEqual([]);
            }
          }
          // a drag its Escape cancelled is let go where the pointer is; any other drag still held is a scenario's error
          if (held.current?.cancelled === true) {
            await page.mouse.up();
            held.current = null;
          }
          if (held.current !== null) throw new Error(`the drag of ${held.current.door} is still held after the last step`);
          const after = await port(page);
          await expectCanvasDraws(page, 'after the steps');

          // the document diff and the selection, through the test port
          const expected = applyDiff(fixture, s.expect.document);
          if ('error' in expected && expected.error) throw new Error(String(expected.error));
          // An action that replaces the whole document (File › Open and the commands that do the same): the page and
          // its root come with the ids the new project gives them, which the diff does not name (the user's decision),
          // so they are not compared; for every other action, they are.
          const replacing = DOCUMENT_REPLACING.has(commandOf(door));
          const whole = resolveFileValues((expected as { document: unknown }).document, after.document);
          const compared = replacing ? withoutPageIds(whole) : whole;
          expect(matchDocument(after.document, compared), 'document').toEqual([]);
          expect(after.selection, 'selection').toEqual(s.expect.selection.map((p) => idOf(after.document, p)));
          expect(after.history.undoSteps, 'history: undo steps').toBe(s.expect.history.undoSteps);

          const render = s.expect.render;
          if (render) {
            for (const c of render.computed) {
              const value = await (await frameElement(page, idOf(after.document, c.node), c.node)).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), c.property);
              expect(value, `${c.node} ${c.property}`).toBe(c.value);
            }
            for (const g of render.geometry) {
              const actual = (await frameBox(page, idOf(after.document, g.node), g.node))[g.measure];
              const base = g.reference === null ? 0 : (await frameBox(page, idOf(after.document, g.reference), g.reference))[g.measure];
              expect(compare(actual, g.relation, base + g.value), `${g.node} ${g.measure} ${actual} ${g.relation} ${base + g.value}`).toBe(true);
            }
            const last = render.feedback.at(-1);
            if (render.feedback.length > 1) throw new Error('the status bar shows the last message only');
            // a refusal a step before the last showed is checked there (refusalCheck); a later step may replace it
            const shownEarlier = last !== undefined && refusalsAt.some((r) => r.refusal.key === last.key && r.after < s.steps.length - 1);
            // in the language the scenario expects after its steps: a step may choose one (ui-language)
            if (last && !shownEarlier) await expect(page.getByRole('status'), 'feedback').toHaveText(await text(page, localeAfter(s, door), last.key, last.params));
          }

          const editor = s.expect.editor;
          if (editor) {
            // a region the editor does not draw (a tab not chosen) fails on an assertion, never on a thrown error
            const regionBox = async (id: string) => {
              const region = page.locator(`[data-region="${id}"]`).first();
              await expect(region, `region ${id} is drawn`).toBeVisible();
              const box = await region.boundingBox();
              if (box === null) throw new Error(`region ${id} is not laid out`);
              return box;
            };
            for (const r of editor.regions) {
              const actual = (await regionBox(r.region))[r.measure];
              const base = r.reference === null ? 0 : (await regionBox(r.reference))[r.measure];
              expect(compare(actual, r.relation, base + r.value), `${r.region} ${r.measure} ${actual} ${r.relation} ${base + r.value}`).toBe(true);
            }
            for (const c of editor.computed) {
              const value = await page.locator(`[data-region="${c.region}"]`).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), c.property);
              expect(value, `${c.region} ${c.property}`).toBe(c.value);
            }
          }

          // the pointer resting on a node (spec hover-measure): the mouse on it (its centre or inside its top-left
          // corner), Alt held when the scenario says, and each text a region of the chrome then shows, in the language
          // the scenario expects
          const hovering = s.expect.hover;
          if (hovering !== undefined) {
            // a point of the node itself on the zoomed canvas (nodePoint: the iframe's CSS zoom applied, never a
            // child's)
            const point = await nodePoint(page, idOf(after.document, hovering.node), false, hovering.node, hovering.at === 'corner' ? 'start' : 'centre');
            if (hovering.alt) await page.keyboard.down('Alt');
            await page.mouse.move(point.x, point.y, { steps: 4 });
            for (const show of hovering.shows) {
              const wanted = await text(page, localeAfter(s, door), show.key, show.params);
              const exactly = new RegExp(`^\\s*${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
              await expect(page.locator(`[data-region="${show.region}"]`).filter({ hasText: exactly }), `${show.region} shows "${wanted}"`).not.toHaveCount(0);
            }
            if (hovering.alt) await page.keyboard.up('Alt');
            await page.mouse.move(0, 0);
          }

          // the files inside the archive the action step handed out (File › Save project, the export), read as any
          // unzip tool reads them: the first download after the action began, never one a step before it made
          const exported = s.expect.export;
          if (exported !== null) {
            await expect.poll(() => downloads.length, { message: 'the action downloaded a file', intervals: POLL }).toBeGreaterThan(downloadsBeforeAction);
            const saved = await (downloads[downloadsBeforeAction] as Download).path();
            const files = unzip(fs.readFileSync(saved));
            for (const f of exported.files) {
              const data = files.get(f.path);
              expect(data === undefined ? null : f.path, `the archive holds ${f.path} (it holds ${[...files.keys()].join(', ')})`).toBe(f.path);
              const text = (data as Buffer).toString('utf8');
              for (const p of f.present) expect(text, `${f.path} holds ${p}`).toContain(p);
              for (const a of f.absent) expect(text, `${f.path} does not hold ${a}`).not.toContain(a);
              for (const pattern of f.absentPattern ?? []) expect(text, `${f.path} holds no ${pattern}`).not.toMatch(new RegExp(pattern));
            }
          }

          // undo and redo restore the document through their doors
          if (s.expect.history.undoSteps > 0) {
            // a modal dialog still open (Guides & Grids) keeps the top bar out of reach: a person closes it first, with
            // its close button (closing it changes nothing in the document nor in the history)
            if ((await page.locator('[role="dialog"][aria-modal="true"]').count()) > 0) await runDoor(page, DIALOG_CLOSE_DOOR);
            for (let i = 0; i < s.expect.history.undoSteps; i += 1) await runDoor(page, UNDO_DOOR);
            expect(matchDocument((await port(page)).document, fixture), 'undo restores').toEqual([]);
            for (let i = 0; i < s.expect.history.undoSteps; i += 1) await runDoor(page, REDO_DOOR);
            expect(matchDocument((await port(page)).document, after.document), 'redo restores').toEqual([]);
          }

          const persistence = s.expect.persistence;
          if (persistence) {
            const stored = await page.evaluate(() => window.localStorage.getItem('preferences'));
            // the workspace, kept under its own key (src/editor/workspace/persist.ts): stored once the step left it so
            const workspace = await page.evaluate(() => window.localStorage.getItem('workspace'));
            if (persistence.workspace === 'same') expect(workspace, 'the workspace is stored').not.toBeNull();
            const applied = await appliedPreferences(page);
            if (persistence.preferences === 'same') {
              // what is stored is what the editor shows: its language and its theme
              const kept = JSON.parse(stored ?? 'null') as { locale?: string; theme?: string } | null;
              expect({ locale: kept?.locale, theme: kept?.theme }, 'the stored preferences are those the editor shows').toEqual({ locale: applied.locale, theme: applied.theme });
            }
            await page.reload();
            await expect(page.locator('.workbench')).toBeVisible();
            if (persistence.document === 'same') expect(matchDocument((await port(page)).document, after.document), 'document after reload').toEqual([]);
            if (persistence.preferences === 'same') {
              expect(await page.evaluate(() => window.localStorage.getItem('preferences')), 'preferences after reload').toBe(stored);
              // the reloaded editor applies them: the same language, theme and collapsed sections as before the reload
              await expect.poll(() => appliedAgain(page, applied), { message: 'the editor applies after the reload the preferences it had before', intervals: POLL }).toEqual(applied);
            }
            if (persistence.selection === 'same') expect((await port(page)).selection, 'selection after reload').toEqual(after.selection);
            if (persistence.workspace === 'same') {
              expect(await page.evaluate(() => window.localStorage.getItem('workspace')), 'workspace after reload').toBe(workspace);
              // the reloaded editor draws it: the regions the scenario measures measure the same again
              for (const g of s.expect.editor?.regions ?? []) await expect.poll(() => editorMeasureHolds(page, g), { message: `after the reload, ${g.region} ${g.measure} ${g.relation} ${g.value}`, intervals: POLL }).toBe(true);
            }
          }
        });
      }
    }
  }
}

// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// The scenarios' fast runner: the logic of every scenario, without a browser. The editor's own store (the commands,
// the predicates, the editor state that follows a selection or a command) runs each step's command with the arguments
// its door and the step give it, on the fixture the scenario names, and the document diff, the selection, the undo
// steps, the feedback, the refusals, and undo and redo are checked as the browser runner checks them
// (tools/runner/scenarios.ts) — in seconds, on every commit. What only a browser can prove stays with that runner,
// which remains the contract (every scenario through every door, in the real app): a pointer gesture, a drop, a held
// drag, what the page lays out and draws (computed values, geometry), the editor's regions, a reload, the export's
// archive, the clipboard and the files a door reads. A scenario that needs one of those in its steps is left to it;
// its end terminals the fast runner cannot read are skipped, the others checked.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runName, writeHeadlessResults } from './balance.ts';
import type { Layout } from '../../src/core/ports/layout.ts';
import type { CssSupport } from '../../src/core/ports/css.ts';
import { keyContextIn } from '../../src/editor/canvas/edit-mode.ts';
import type { KeyContextId } from '../../src/generated/ids.ts';
import { isFeatureBuilt } from '../../src/app/features.ts';
import { sequentialIds } from '../../src/core/ports/ids.ts';
import { manualClock } from '../../src/core/ports/clock.ts';
import type { Message } from '../../src/core/commands/registry.ts';
import type { DocumentJson } from '../../src/core/document/model.ts';
import type { FeatureId, CommandId } from '../../src/generated/ids.ts';
import { translate, type Locale } from '../../src/i18n/index.ts';
import { manifest } from '../../src/manifest/runtime.ts';
import { EMPTY_FIXTURE, applyDiff, emptyProject, matchDocument, refusalCheck, resolveNode, type DiffOp, type RefusingCommand } from '../../src/manifest/scenario.ts';
import { createEditorStore, MODEL_RULES, type EditorStore } from '../../src/editor/store.ts';
import { textOf } from '../../src/editor/text.ts';

interface Step {
  readonly door: string;
  readonly args: Record<string, unknown>;
  readonly target: string | null;
  readonly drop: unknown;
  readonly action: boolean;
  readonly hold?: boolean;
  readonly type?: string | null;
  readonly answer?: 'confirm' | 'cancel' | null;
}
interface Scenario {
  readonly id: string;
  readonly setup: { fixture: string; selection: string[]; breakpoint: string; state: string; locale: string; storage?: string; tabs?: string; clipboard?: unknown; companion?: string };
  readonly steps: readonly Step[];
  readonly doors: readonly string[];
  readonly expect: {
    document: DiffOp[];
    selection: string[];
    history: { undoSteps: number };
    render: { feedback: { key: string; params: Record<string, unknown> }[] } | null;
  };
  readonly refusals: { key: string; document?: string }[];
}
interface Feature {
  readonly id: string;
  readonly scenarios: readonly Scenario[];
}

const FEATURES: readonly Feature[] = fs
  .readdirSync('manifest/features')
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(fs.readFileSync(path.join('manifest/features', f), 'utf8')) as { features: Feature[] }).features);

// the doors that are pointer gestures or read what only a browser hands (the clipboard, picked files, a rect or a point
// the pointer measures): a scenario with one in its steps is the browser runner's
const GESTURE_KINDS = new Set(['canvas-drag', 'canvas-handle', 'layers-drag', 'panel-drag']);
const BROWSER_ARG_TYPES = new Set(['clipboard', 'files', 'file', 'rect', 'point']);
// the commands that replace the whole document or read storage and the file system
const BROWSER_COMMANDS = new Set(['project.open', 'project.importHtml', 'project.openFolder', 'project.restoreVersion', 'project.newBlankPage', 'project.save', 'project.export', 'files.upload', 'codePanel.copyPane', 'codePanel.downloadPane', 'view.enterPreview',
  // the stage's size (Fit), the text editor's own range (bold, italic), the focus a key moves in a menu or a list, the
  // colour picker's session (one gesture the pointer owner opens with the picker: src/editor/inspector/color-picker.ts)
  'view.zoomFit', 'colorPicker.open', 'text.toggleBold', 'text.toggleItalic', 'focus.first', 'focus.last', 'focus.next', 'focus.previous', 'focus.activate',
  // the assistant's requests, which its controller carries out in the browser (the credential store, the Companion's
  // socket and its model: src/editor/assistant/controller.ts) and says when they are done
  'assistant.saveKey', 'assistant.deleteKey', 'assistant.connect', 'assistant.disconnect', 'assistant.selectSession', 'assistant.send', 'assistant.cancel']);
// the one command whose field hands the typed text as it is (a value of style.set): every other field shapes what is
// typed into its command's arguments itself (a border's width and style, an image's address, an attribute), which the
// browser runner proves through the field
const TYPED_AS_IS = new Set(['style.set']);

const commandOf = (ref: string): string => ref.split('#')[0] ?? '';
const doorOf = (ref: string) => manifest.doorByRef.get(ref as never);
const argsOf = (command: string) => manifest.commands.find((c) => c.id === command)?.args ?? {};

// why a step is the browser runner's, or null
function browserOnly(step: Step, ref: string): string | null {
  const door = doorOf(ref);
  if (door === undefined) return `unknown door ${ref}`;
  if (GESTURE_KINDS.has(door.door.kind)) return `gesture ${door.door.kind}`;
  if (step.drop !== null && step.drop !== undefined) return 'a drop';
  if (step.hold === true) return 'a held drag';
  if (BROWSER_COMMANDS.has(commandOf(ref))) return `command ${commandOf(ref)}`;
  const types = Object.values(argsOf(commandOf(ref))).map((a) => a.type);
  if (types.some((t) => BROWSER_ARG_TYPES.has(t))) return 'an argument a browser hands';
  if (typeof step.type === 'string' && !TYPED_AS_IS.has(commandOf(ref))) return 'text a field shapes';
  // typed text a field holds without Enter is kept or put back by the field itself
  if (typeof step.type === 'string' && !/[\n\t]$/.test(step.type)) return 'text a field holds';
  const args = argsOf(commandOf(ref));
  const given = new Set([...Object.keys(door.door.args ?? {}), ...Object.keys(step.args)]);
  if (typeof step.type === 'string') given.add('typed');
  if (step.target !== null) given.add('target');
  // a control that composes its command's arguments from what it shows (a pane's text, a checkbox's next state, a
  // picked target) hands the command what the step leaves out
  const control = (door.door as { control?: unknown }).control;
  // (a door's empty text argument is a place its control fills: the code pane's Apply hands the pane's text)
  const placeholders = Object.entries(door.door.args ?? {}).filter(([name, value]) => value === '' && !(name in step.args)).map(([name]) => name);
  if (!given.has('typed') && (placeholders.length > 0 || Object.entries(args).some(([name, a]) => !a.optional && !given.has(name)))) return 'arguments its control fills';
  if (control !== undefined && Object.keys(args).length > 0 && given.size === 0) return 'arguments its control composes';
  return null;
}

function scenarioBrowserOnly(s: Scenario, door: string): string | null {
  if (s.setup.storage !== undefined || s.setup.tabs !== undefined || s.setup.clipboard !== undefined || s.setup.companion !== undefined) return 'a setup a browser makes';
  for (const step of s.steps) {
    const why = browserOnly(step, step.action ? door : step.door);
    if (why !== null) return why;
  }
  return null;
}

function fixtureOf(name: string, locale: Locale): DocumentJson {
  if (name !== EMPTY_FIXTURE) return JSON.parse(fs.readFileSync(path.join('manifest/features/fixtures', `${name}.json`), 'utf8')) as DocumentJson;
  const rootLabel = manifest.elements.elements.find((e) => e.id === MODEL_RULES.root.type)?.labelKey ?? 'element.page.label';
  return emptyProject({ page: translate(locale, 'pages.defaultHome'), root: translate(locale, rootLabel as 'element.page.label') }, MODEL_RULES.root);
}

const idOf = (document: unknown, nodePath: string): string => {
  const resolved = resolveNode(document, nodePath.split('/').filter((s) => s !== ''));
  if (typeof resolved === 'string') throw new Error(`${nodePath}: ${resolved}`);
  return (resolved.node as unknown as { id: string }).id;
};

// a step's arguments as the app takes them: the door's own, the step's (a node path becomes the node's id), and the
// text the step types into the field its door opens, in the command's one text argument the others do not give
function stepArgs(ref: string, step: Step, document: unknown): Record<string, unknown> {
  const command = commandOf(ref);
  const types = argsOf(command);
  const given = Object.fromEntries(
    Object.entries(step.args).map(([name, value]) => {
      const type = types[name]?.type;
      if ((type === 'node' || type === 'path') && typeof value === 'string' && value.startsWith('/')) return [name, idOf(document, value)];
      if (type === 'nodes' && Array.isArray(value)) return [name, value.map((one) => (typeof one === 'string' && one.startsWith('/') ? idOf(document, one) : one))];
      return [name, value];
    }),
  );
  const args: Record<string, unknown> = { ...(doorOf(ref)?.door.args ?? {}), ...given };
  if (typeof step.type === 'string') {
    const text = Object.entries(types).filter(([name, arg]) => (arg.type === 'string' || arg.type === 'json') && !(name in args));
    const into = text.length === 1 ? text[0]?.[0] : undefined;
    if (into !== undefined) args[into] = step.type.replace(/\n$/, '');
  }
  // a door that stands for a node the step targets (a Layers row, a canvas click) hands that node
  if (step.target !== null && types.target?.type === 'node' && args.target === undefined) args.target = idOf(document, step.target);
  return args;
}

type Dispatch = (id: CommandId, args: unknown) => { status: string };

// what a run asked of the page and the browser: a layout measured, a value the browser parses. The fast runner answers
// neither as a browser would (nothing is drawn, every value is taken), so a run whose terminals differ after it asked
// is the browser runner's to prove, and is reported as skipped with the reason; a run that holds anyway is checked.
interface Asked {
  layout: boolean;
  css: boolean;
}
const layoutAsking = (asked: Asked): Layout => ({
  box: () => ((asked.layout = true), null),
  paddingBox: () => ((asked.layout = true), null),
  place: () => ((asked.layout = true), null),
  fontPx: () => ((asked.layout = true), null),
});
const cssAsking = (asked: Asked): CssSupport => ({ supports: () => ((asked.css = true), true) });

function storeFor(s: Scenario, asked: Asked): { readonly store: EditorStore; readonly fixture: DocumentJson } {
  const locale = s.setup.locale as Locale;
  const fixture = fixtureOf(s.setup.fixture, locale);
  // the preferences and the workspace a fresh profile holds: nothing, kept in memory for the run
  const memory = (): { read(): string | null; write(text: string): void } => {
    let held: string | null = null;
    return { read: () => held, write: (text) => void (held = text) };
  };
  const store = createEditorStore({
    storage: memory(),
    workspace: memory(),
    clock: manualClock(1_000_000),
    ids: sequentialIds('h'),
    restored: { document: fixture, selection: [] },
    ports: { layout: layoutAsking(asked), css: cssAsking(asked), readOnly: () => false },
    freeze: true,
  });
  const dispatch = store.dispatch as unknown as Dispatch;
  const setting = (command: string, args: Record<string, unknown>) => dispatch(command as CommandId, args);
  if (locale !== manifest.environment.locales.default) setting('preferences.setLanguage', { locale });
  s.setup.selection.forEach((nodePath, i) => setting(i === 0 ? 'selection.select' : 'selection.add', { target: idOf(fixture, nodePath) }));
  if (s.setup.breakpoint !== manifest.properties.breakpoints[0]?.id) setting('view.setBreakpoint', { breakpoint: s.setup.breakpoint });
  if (s.setup.state !== 'base') setting('view.setStyleState', { state: s.setup.state });
  return { store, fixture };
}

// a message's text as the status bar writes it: its parameters, a message of their own included, in the locale
const shown = (locale: string, message: Message | null | undefined): string | null => (message === null || message === undefined ? null : textOf(locale as Locale, message.key as never, message.params as never));

// the key contexts the canvas hands its keys to while one of its modes is on (edit-mode.ts keyContextIn)
const MODE_CONTEXTS = new Set<KeyContextId>(['grid-edit', 'canvas-edit-mode'] as KeyContextId[]);
const REFUSING = manifest.commands as unknown as readonly RefusingCommand[];

// A run of a scenario through one door: its steps, each refusal right after its refused step (refusalCheck, as the
// browser runner checks it), then the end terminals — the document, the selection, the undo steps, the last feedback,
// and undo and redo over every step. Returns why the run is the browser runner's when a step shows it, else null.
function run(s: Scenario, door: string, store: EditorStore, fixture: DocumentJson): string | null {
  const dispatch = store.dispatch as unknown as Dispatch;
  const refusalsAt = s.refusals.map((refusal) => ({ refusal, ...refusalCheck(s.steps, refusal.key, REFUSING) }));
  const before = new Map<number, unknown>();
  for (const [index, step] of s.steps.entries()) {
    const ref = step.action ? door : step.door;
    // a key of a canvas mode (the grid editor, Edit on canvas) reaches its door only while the mode is on; once it is
    // off the canvas takes the key
    const shape = doorOf(ref)?.door as { kind: string; context?: KeyContextId } | undefined;
    if (shape?.kind === 'shortcut' && MODE_CONTEXTS.has(shape.context as KeyContextId) && keyContextIn(store.getState().ui, 'canvas' as KeyContextId) !== shape.context) return `a key of ${String(shape.context)} after the mode closed`;
    if (refusalsAt.some((r) => r.unchangedFrom === index)) before.set(index, store.getState().document);
    const result = dispatch(commandOf(ref) as CommandId, stepArgs(ref, step, store.getState().document));
    if (result.status === 'confirm') store.answer(step.answer !== 'cancel');
    for (const { refusal, unchangedFrom } of refusalsAt.filter((r) => r.after === index)) {
      const params = s.expect.render?.feedback.find((f) => f.key === refusal.key)?.params ?? {};
      const locale = store.getState().ui.preferences.locale;
      expect(shown(locale, store.getState().message), 'refusal').toBe(textOf(locale as Locale, refusal.key as never, params as never));
      expect(matchDocument(store.getState().document, before.get(unchangedFrom)), 'refused: the refused step leaves the document unchanged').toEqual([]);
    }
  }
  const after = store.getState();
  const expected = applyDiff(fixture, s.expect.document);
  if ('error' in expected && expected.error) throw new Error(String(expected.error));
  expect(matchDocument(after.document, (expected as { document: unknown }).document), 'document').toEqual([]);
  expect(after.selection, 'selection').toEqual(s.expect.selection.map((p) => idOf(after.document, p)));
  expect(after.history.past.length, 'history: undo steps').toBe(s.expect.history.undoSteps);
  const last = s.expect.render?.feedback.at(-1);
  // a refusal a step before the last showed is checked there; a later step may replace it
  const shownEarlier = last !== undefined && refusalsAt.some((r) => r.refusal.key === last.key && r.after < s.steps.length - 1);
  const locale = after.ui.preferences.locale;
  if (last !== undefined && !shownEarlier) expect(shown(locale, after.message), 'feedback').toBe(textOf(locale as Locale, last.key as never, last.params as never));
  if (s.expect.history.undoSteps > 0) {
    for (let i = 0; i < s.expect.history.undoSteps; i += 1) dispatch('history.undo' as CommandId, {});
    expect(matchDocument(store.getState().document, fixture), 'undo restores').toEqual([]);
    for (let i = 0; i < s.expect.history.undoSteps; i += 1) dispatch('history.redo' as CommandId, {});
    expect(matchDocument(store.getState().document, after.document), 'redo restores').toEqual([]);
  }
  return null;
}

const RUNNABLE = FEATURES.filter((f) => isFeatureBuilt(f.id as FeatureId));
let checked = 0;
let left = 0;
// the runs it passed, which the browser runner may leave out on this tree (balance.ts)
const passed: string[] = [];

describe('scenarios, without a browser (the logic of each step and its end terminals)', () => {
  for (const feature of RUNNABLE) {
    for (const s of feature.scenarios) {
      for (const door of s.doors) {
        const why = scenarioBrowserOnly(s, door);
        if (why !== null) {
          left += 1;
          continue;
        }
        checked += 1;
        it(`${feature.id} › ${s.id} › ${door}`, (ctx) => {
          const asked: Asked = { layout: false, css: false };
          const { store, fixture } = storeFor(s, asked);
          let browser: string | null;
          try {
            browser = run(s, door, store, fixture);
          } catch (failed) {
            // the run asked the page for a layout, or the browser whether it takes a value, and the fast runner's
            // answer (nothing drawn, every value taken) is not the browser's: the browser runner proves it
            if (asked.layout) ctx.skip('reads the page layout');
            if (asked.css && s.refusals.length > 0) ctx.skip('the browser refuses the value');
            throw failed;
          }
          if (browser !== null) ctx.skip(browser);
          passed.push(runName(feature.id, s.id, door));
        });
      }
    }
  }
  afterAll(() => writeHeadlessResults(passed));
  it('reports how many scenario runs it checks and leaves to the browser runner', () => {
    expect(checked + left).toBeGreaterThan(0);
    console.log(`headless: ${checked} scenario runs checked, ${left} left to the browser runner`);
  });
});

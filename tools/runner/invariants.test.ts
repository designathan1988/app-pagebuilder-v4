// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// The invariant probe in the gate (the audit's phase 3, promoted from its scratch probe; plan phase C5). The editor's
// own store, frozen as in development, where a model breach throws:
//  - random sequences of commands, drawn from every built door that runs without a browser, with arguments taken from
//    what the document holds (and sometimes not): no throw, no refusal without words, no refusal that changed the
//    document, a document the model takes after every step, and undoing everything returns exactly to the start. The
//    sequences come from fast-check (fixed seed): a failure prints the shortest sequence it shrank to and its seed.
//  - every command with bad arguments (absent, null, the wrong type, a node or a name of nothing, numbers that are no
//    numbers, enum values it does not list): refused with words or done, never a throw, never a refusal that changed
//    the document.
// The audit found 525 breaches in 100,000 random commands (AUD-03, AUD-04) and 2,409 throws in 8,178 bad-argument
// tries (AUD-08, AUD-09); this keeps them found.
import fs from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isFeatureBuilt } from '../../src/app/features.ts';
import { walk, type DocumentJson } from '../../src/core/document/model.ts';
import { validateDocument } from '../../src/core/document/validate.ts';
import { deepEqual } from '../../src/core/history/transaction.ts';
import { manualClock } from '../../src/core/ports/clock.ts';
import { sequentialIds } from '../../src/core/ports/ids.ts';
import { InvalidStateError } from '../../src/core/store/store.ts';
import { createEditorStore, MODEL_RULES, type EditorStore } from '../../src/editor/store.ts';
import type { CommandId, FeatureId } from '../../src/generated/ids.ts';
import { manifest } from '../../src/manifest/runtime.ts';

type Dispatch = (id: CommandId, args: unknown) => { readonly status: string };
interface ArgShape { readonly type: string; readonly values: readonly string[]; readonly optional: boolean; readonly refers?: string }
interface DoorShape { readonly kind: string; readonly feature: string; readonly args: Readonly<Record<string, unknown>> }
interface CommandShape { readonly id: string; readonly args: Readonly<Record<string, ArgShape>>; readonly entryPoints: readonly DoorShape[] }

const COMMANDS = manifest.commands as unknown as readonly CommandShape[];
// what only a browser hands or does (a file the person picks, the system clipboard, a gesture's rect, the window)
const BROWSER_ARG_TYPES = new Set(['clipboard', 'files', 'file', 'rect', 'point']);
const BROWSER_COMMANDS = new Set(['project.open', 'project.importHtml', 'project.openFolder', 'project.restoreVersion', 'project.newBlankPage', 'project.save', 'codePanel.copyPane', 'codePanel.downloadPane', 'view.enterPreview', 'view.zoomFit', 'colorPicker.open', 'text.toggleBold', 'text.toggleItalic', 'focus.first', 'focus.last', 'focus.next', 'focus.previous', 'focus.activate', 'assistant.saveKey', 'assistant.deleteKey', 'assistant.connect', 'assistant.disconnect', 'assistant.selectSession', 'assistant.send', 'assistant.cancel', 'project.captureUrl', 'project.takeOverEditing']);
const GESTURE_KINDS = new Set(['canvas-drag', 'canvas-handle', 'layers-drag', 'panel-drag']);
const builtDoor = (door: DoorShape): boolean => isFeatureBuilt(door.feature as FeatureId);
const headless = (command: CommandShape): boolean => !BROWSER_COMMANDS.has(command.id) && !Object.values(command.args).some((arg) => BROWSER_ARG_TYPES.has(arg.type)) && command.entryPoints.some(builtDoor);

const FIXTURES = ['aurora', 'client-site', 'catalog', 'content-site', 'motion', 'grid-page', 'table', 'form-controls', 'project-breakpoints', 'responsive-sections'].filter((name) => fs.existsSync(`manifest/features/fixtures/${name}.json`));
const fixture = (name: string): DocumentJson => JSON.parse(fs.readFileSync(`manifest/features/fixtures/${name}.json`, 'utf8')) as DocumentJson;

const memory = (): { read(): string | null; write(text: string): void } => {
  let held: string | null = null;
  return { read: () => held, write: (text) => void (held = text) };
};
const storeOn = (document: DocumentJson): EditorStore =>
  createEditorStore({ storage: memory(), workspace: memory(), clock: manualClock(1_000_000), ids: sequentialIds('v'), restored: { document, selection: [] }, ports: { readOnly: () => false, downloads: { deliver: () => undefined }, clipboard: { write: () => undefined } as never }, freeze: true });

// ---------------------------------------------------------------- the arguments a random step hands
const TEXTS = ['', 'Hello', 'Título com acentos ção 😀', '12', '12px', '50%', 'auto', 'none', '#b9512a', 'red', 'var(--brand)', 'calc(100% - 8px)', 'a'.repeat(300), '<b>x</b>', 'Card', 'index', 'about.html', 'img/a.png'];
const NUMBERS = [-1, 0, 1, 2, 3, 8, 16, 100, 1000];
const PROPERTIES = manifest.properties.properties.map((p) => p.id);
const PALETTE = [...MODEL_RULES.palette.keys()];
// what the document holds under the names arguments use, so a step names something real most of the time
const HELD: Readonly<Record<string, (d: DocumentJson) => readonly string[]>> = {
  collection: (d) => (d.collections ?? []).map((c) => c.name),
  token: (d) => (d.tokens ?? []).map((t) => t.name),
  component: (d) => (d.components ?? []).map((c) => c.name),
  guide: (d) => (d.pages[0]?.tree.guides ?? []).map((g) => g.id),
  page: (d) => d.pages.map((p) => p.file),
  className: (d) => (d.classes ?? []).map((c) => c.name),
  name: (d) => [...(d.classes ?? []).map((c) => c.name), ...(d.tokens ?? []).map((t) => t.name)],
};
interface Choice { readonly command: string; readonly door: DoorShape; readonly args: Readonly<Record<string, ArgShape>> }
const CHOICES: readonly Choice[] = COMMANDS.filter(headless).flatMap((command) => command.entryPoints.filter((door) => builtDoor(door) && !GESTURE_KINDS.has(door.kind)).map((door) => ({ command: command.id, door, args: command.args })));

// a stream of draws, each a number in [0, 1); null when it runs out (the sequence ends there)
type Draw = () => number | null;
function argsFor(choice: Choice, document: DocumentJson, draw: Draw): Record<string, unknown> | null {
  const nodes = document.pages.flatMap((page) => [...walk(page.tree)].map((node) => node.id));
  const pick = <T,>(list: readonly T[]): T | undefined => {
    const r = draw();
    return r === null || list.length === 0 ? undefined : list[Math.floor(r * list.length)];
  };
  const chance = (p: number): boolean => (draw() ?? 1) < p;
  const args: Record<string, unknown> = { ...choice.door.args };
  for (const [name, arg] of Object.entries(choice.args)) {
    if (args[name] !== undefined && args[name] !== '') continue;
    if (arg.optional && chance(0.5)) continue;
    switch (arg.type) {
      case 'node': args[name] = chance(0.95) ? pick(nodes) : 'nope';
        break;
      case 'nodes': args[name] = [pick(nodes), pick(nodes)].filter((x) => x !== undefined);
        break;
      case 'path': args[name] = pick([...(document.files ?? []).map((f) => f.path), ...document.pages.map((p) => p.file)]) ?? 'index.html';
        break;
      case 'string': {
        const held = HELD[arg.refers ?? name]?.(document) ?? [];
        args[name] = arg.values.length > 0 ? pick(arg.values) : held.length > 0 && chance(0.75) ? pick(held) : pick(TEXTS);
        break;
      }
      case 'enum': args[name] = pick(arg.values);
        break;
      case 'integer': args[name] = pick(NUMBERS);
        break;
      case 'number': args[name] = (pick(NUMBERS) ?? 0) * (chance(0.3) ? 0.5 : 1);
        break;
      case 'boolean': args[name] = chance(0.5);
        break;
      case 'breakpoint': args[name] = pick(['desktop', 'laptop', 'tablet', 'phone', ...(document.breakpoints ?? []).map((b) => b.id)]);
        break;
      case 'state': args[name] = pick(['base', 'hover', 'focus', 'active', 'visited']);
        break;
      case 'color': args[name] = pick(['#ff0000', 'red', 'var(--brand)', 'oklch(0.6 0.1 200)', 'transparent']);
        break;
      case 'attribute': args[name] = pick(['href', 'alt', 'title', 'id', 'aria-label']);
        break;
      case 'property': args[name] = pick(PROPERTIES);
        break;
      case 'palette-entry': args[name] = pick(PALETTE);
        break;
      default: return null;
    }
  }
  return args;
}

// one step: what it broke, or null
function stepOn(store: EditorStore, command: string, args: Record<string, unknown>, confirm: boolean): string | null {
  const dispatch = store.dispatch as unknown as Dispatch;
  const before = store.getState();
  try {
    let result = dispatch(command as CommandId, args);
    if (result.status === 'confirm') result = store.answer(confirm) as { status: string };
    const after = store.getState();
    if (result.status === 'refused' && !deepEqual(after.document, before.document)) return `${command} was refused but changed the document`;
    if (result.status === 'refused' && after.message === null) return `${command} was refused without words`;
    const problems = validateDocument(after.document, after.selection, MODEL_RULES);
    if (problems.length > 0) return `${command} left a document the model refuses: ${problems[0]?.path} ${problems[0]?.message}`;
    return null;
  } catch (error) {
    return `${command} ${error instanceof InvalidStateError ? 'broke the model' : 'threw'}: ${String(error).slice(0, 300)}`;
  }
}

describe('the invariant probe', () => {
  it('random sequences of commands keep the model, say every refusal, and undo exactly to the start', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(fc.constantFrom(...FIXTURES), fc.array(fc.integer({ min: 0, max: 9_999 }), { minLength: 1, maxLength: 1500, size: 'max' }), (name, stream) => {
        const store = storeOn(fixture(name));
        const initial = store.getState().document;
        let at = 0;
        const draw: Draw = () => (at < stream.length ? (stream[at++] as number) / 10_000 : null);
        const steps: string[] = [];
        while (at < stream.length) {
          const r = draw();
          if (r === null) break;
          const choice = CHOICES[Math.floor(r * CHOICES.length)] as Choice;
          const args = argsFor(choice, store.getState().document, draw);
          if (args === null) continue;
          const confirm = (draw() ?? 0) < 0.5;
          steps.push(`${choice.command} ${JSON.stringify(args).slice(0, 160)}`);
          const broke = stepOn(store, choice.command, args, confirm);
          if (broke !== null) throw new Error(`${broke}\nafter, on ${name}:\n  ${steps.join('\n  ')}`);
        }
        const dispatch = store.dispatch as unknown as Dispatch;
        for (let i = store.getState().history.past.length; i > 0; i -= 1) dispatch('history.undo' as CommandId, {});
        if (!deepEqual(store.getState().document, initial)) throw new Error(`undoing everything did not return to the start of ${name}, after:\n  ${steps.join('\n  ')}`);
      }),
      { seed: 20261002, numRuns: 200 },
    );
  });

  it('bad arguments are refused with words or done, never thrown, never half applied', { timeout: 120_000 }, () => {
    const BAD_STRINGS = ['', ' ', 'x'.repeat(20_000), '<script>alert(1)</script>', '\u0000', 'não-existe', '../../etc/passwd', '{', 'NaN'];
    const BAD_NUMBERS = [Number.NaN, -1, -1e12, 1e12, 0.5, Number.POSITIVE_INFINITY];
    const variants = (command: CommandShape, valid: Record<string, unknown>): Record<string, unknown>[] => {
      const out: Record<string, unknown>[] = [{}, Object.fromEntries(Object.keys(command.args).map((n) => [n, null]))];
      for (const [name, arg] of Object.entries(command.args)) {
        const bad: unknown[] =
          arg.type === 'node' || arg.type === 'path' ? ['missing-node', '', 42]
          : arg.type === 'nodes' ? [['missing-node'], [], 'not-a-list']
          : arg.type === 'integer' || arg.type === 'number' ? [...BAD_NUMBERS, '12']
          : arg.type === 'boolean' ? ['yes', 1]
          : arg.type === 'enum' ? ['not-a-value', '']
          : arg.type === 'json' ? ['{', '[1,2', 'null', '"x"', '{"__proto__":{"x":1}}']
          : [...BAD_STRINGS, 7, {}];
        for (const value of bad) out.push({ ...valid, [name]: value });
      }
      return out;
    };
    const broken: string[] = [];
    for (const name of ['aurora', 'catalog', 'content-site']) {
      const base = fixture(name);
      const first = base.pages[0]?.tree.children[0]?.id ?? base.pages[0]?.tree.id;
      for (const command of COMMANDS.filter(headless)) {
        const door = command.entryPoints.find(builtDoor);
        const valid: Record<string, unknown> = { ...(door?.args ?? {}) };
        for (const [n, a] of Object.entries(command.args)) if (valid[n] === undefined && a.type === 'node') valid[n] = first;
        // every built door's own arguments, and each of them with one argument left out (the audit of 2026-10-04: every
        // argument of element.setLink is optional, and a call naming the element alone threw — the store's argument
        // check cannot say "one of these", so the handler has to refuse with words)
        // one element of each type the page holds, so a command that acts on one kind only is reached
        const kinds = [...new Map((base.pages[0] === undefined ? [] : [...walk(base.pages[0].tree)]).map((n) => [n.type, n.id])).values()];
        const partial: Record<string, unknown>[] = [];
        for (const one of command.entryPoints.filter(builtDoor)) {
          for (const node of Object.values(command.args).some((a) => a.type === 'node') ? kinds : [first]) {
            const own: Record<string, unknown> = { ...one.args };
            for (const [n, a] of Object.entries(command.args)) if (own[n] === undefined && a.type === 'node') own[n] = node;
            partial.push(own);
            for (const n of Object.keys(own)) if (command.args[n]?.optional === true) partial.push(Object.fromEntries(Object.entries(own).filter(([k]) => k !== n)));
          }
        }
        for (const args of [...variants(command, valid), ...partial]) {
          const store = storeOn(base);
          if (first !== undefined) (store.dispatch as unknown as Dispatch)('selection.select' as CommandId, { target: first });
          try {
            store.refusal(command.id as CommandId, args as never);
          } catch (error) {
            broken.push(`${command.id} ${JSON.stringify(args).slice(0, 120)}: its control's question threw ${String(error).slice(0, 160)}`);
          }
          const broke = stepOn(store, command.id, args, true);
          if (broke !== null) broken.push(`${JSON.stringify(args).slice(0, 120)}: ${broke.slice(0, 240)}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  // The first argument check refused a paste asked before its door read the clipboard, so the context menu stopped
  // drawing Paste and Paste style (the scenario run of phase C); a file the door has not read yet is never asked about,
  // and a run without it is refused with words.
  it('a command whose argument its door reads when it runs is asked without it, and refused without it', () => {
    const reads = COMMANDS.filter((command) => command.entryPoints.some(builtDoor) && Object.values(command.args).some((arg) => !arg.optional && BROWSER_ARG_TYPES.has(arg.type) && arg.type !== 'rect' && arg.type !== 'point'));
    const base = fixture('aurora');
    const first = base.pages[0]?.tree.children[0]?.id as string;
    const broken: string[] = [];
    for (const command of reads) {
      const store = storeOn(base);
      (store.dispatch as unknown as Dispatch)('selection.select' as CommandId, { target: first });
      const clipboard = Object.values(command.args).some((arg) => arg.type === 'clipboard');
      for (const door of command.entryPoints.filter(builtDoor)) {
        try {
          const why = store.refusal(command.id as CommandId, door.args as never);
          if (clipboard && why !== null) broken.push(`${command.id} asked before the clipboard was read: refused ${JSON.stringify(why)}`);
        } catch (error) {
          broken.push(`${command.id} asked before its door read: threw ${String(error).slice(0, 160)}`);
        }
      }
      const before = store.getState().document;
      const broke = stepOn(store, command.id, {}, true);
      if (broke !== null) broken.push(broke);
      else if (!clipboard && !deepEqual(store.getState().document, before)) broken.push(`${command.id} ran without the file its door reads`);
    }
    expect(reads.map((command) => command.id)).toContain('clipboard.paste');
    expect(broken).toEqual([]);
  });
});

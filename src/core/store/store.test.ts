import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMANDS, PREDICATES } from '../../app/commands.ts';
import type { CommandId, ConstantId, MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import { NOT_AVAILABLE_YET, isBuilt, message, registerHandler, registerPredicate, type CommandTable, type PredicateTable } from '../commands/registry.ts';
import { createEmptyDocument, locate, type DocNode, type DocumentJson, type Selection } from '../document/model.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { deepEqual } from '../history/transaction.ts';
import { manualClock, type ManualClock } from '../ports/clock.ts';
import { clearIncidents, incidents } from '../incidents.ts';
import { sequentialIds, type IdGenerator } from '../ports/ids.ts';
import { InvalidStateError, createStore, type Store } from './store.ts';
import { INITIAL_PREFERENCES } from '../../editor/preferences/preferences.ts';
import { initialEditorUi, type EditorUi } from '../../editor/state.ts';
import { messageText } from '../../editor/text.ts';

// The store under test: the real command table with small test handlers in place of a few commands, each one kind of
// history declaration of the manifest (undoable, coalescing, per-gesture, not undoable), so these tests exercise the
// store's own rules apart from what the real handlers do (their own tests: src/core/structure/*.test.ts, on frozen
// documents; the real handlers under the store's frozen states: src/editor/canvas/text-edit.test.ts).
// element.insert (per gesture): a Container under the parent (the first page's root by default), selected
const insert = registerHandler('element.insert', ({ state, ids }, args) => {
  const parentId = args.parent ?? state.document.pages[0]?.tree.id ?? '';
  const parent = locate(state.document, parentId);
  if (!parent) return { kind: 'refused', message: message('status.refused.intoItself') };
  const index = Math.min(args.index ?? parent.node.children.length, parent.node.children.length);
  const node: DocNode = { id: ids.next(), type: 'div', name: `Container ${args.entry}`, tag: 'div', attributes: {}, classes: [], styles: {}, text: null, children: [] };
  return { kind: 'change', patches: [{ op: 'add', path: [...parent.path, 'children', index], value: node }], selection: [node.id] };
});

// element.rename (per dispatch)
const rename = registerHandler('element.rename', ({ state }, args) => {
  const at = locate(state.document, args.target);
  if (!at) return { kind: 'refused', message: message('status.refused.intoItself') };
  return { kind: 'change', patches: [{ op: 'replace', path: [...at.path, 'name'], value: args.name }] };
});

// element.delete (per dispatch): the primary selected node, never a page root; its parent is selected after
const remove = registerHandler('element.delete', ({ state }) => {
  const at = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (!at?.parent) return { kind: 'refused', message: message('status.delete.root') };
  return { kind: 'change', patches: [{ op: 'remove', path: at.path }], selection: [at.parent.id] };
});

// selection.select (not undoable)
const select = registerHandler('selection.select', ({ state }, args) => {
  if (!locate(state.document, args.target)) return { kind: 'refused', message: message('status.refused.intoItself') };
  return { kind: 'change', selection: [args.target] };
});

// position.move (coalesces within history.nudgeBurstWindow): writes the selection's left
const move = registerHandler('position.move', ({ state }, args) => {
  const at = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (!at) return { kind: 'refused', message: message('status.position.notPositioned') };
  const current = parseFloat(String(at.node.styles.desktop?.base?.left ?? '0'));
  const base = at.node.styles.desktop?.base ?? {};
  return { kind: 'change', patches: [{ op: 'replace', path: [...at.path, 'styles'], value: { ...at.node.styles, desktop: { ...at.node.styles.desktop, base: { ...base, left: `${current + args.dx}px` } } } }] };
});

// geometry.resize (per gesture): writes the selection's width
const resize = registerHandler('geometry.resize', ({ state }, args) => {
  const at = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (!at || args.width === undefined) return { kind: 'refused', message: message('status.refused.intoItself') };
  return { kind: 'change', patches: [{ op: 'replace', path: [...at.path, 'styles'], value: { ...at.node.styles, desktop: { ...at.node.styles.desktop, base: { ...at.node.styles.desktop?.base, width: args.width } } } }] };
});

const TEST_COMMANDS = {
  ...COMMANDS,
  'element.insert': insert,
  'element.rename': rename,
  'element.delete': remove,
  'selection.select': select,
  'position.move': move,
  'geometry.resize': resize,
  // The marker's own path: every command of the manifest is built, so one entry stands for the ones a later feature
  // brings — the tests below keep proving what the store does with a command that is not built yet.
  'timeline.stop': NOT_AVAILABLE_YET,
} satisfies CommandTable<EditorUi>;

const TEST_PREDICATES = {
  ...PREDICATES,
  hasSelection: registerPredicate('hasSelection', (state) => state.selection.length > 0),
  positionedSelection: registerPredicate('positionedSelection', (state) => state.selection.length > 0),
} satisfies PredicateTable<EditorUi>;

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const MANIFEST_COMMANDS = new Map(manifest.commands.map((c) => [c.id as CommandId, c]));
const CONSTANTS = new Map(manifest.interactions.constants.map((c) => [c.id as ConstantId, c.value]));
const WORDS = (ui: EditorUi, key: MessageId) => translate(ui.preferences.locale, key);

interface TestStore {
  readonly store: Store<EditorUi>;
  readonly clock: ManualClock;
  readonly ids: IdGenerator;
  readonly root: string;
}

function emptyDocument(ids: IdGenerator): DocumentJson {
  return createEmptyDocument(ids, { page: 'Home', root: 'Page' }, RULES.root);
}

function testStore(table: CommandTable<EditorUi> = TEST_COMMANDS, predicates: PredicateTable<EditorUi> = TEST_PREDICATES, freeze = true): TestStore {
  const clock = manualClock(1_000_000);
  const ids = sequentialIds('n');
  const document = emptyDocument(ids);
  const store = createStore<EditorUi>({
    table,
    predicates,
    commands: MANIFEST_COMMANDS,
    constants: CONSTANTS,
    rules: RULES,
    clock,
    ids,
    words: WORDS,
    initial: { document, ui: initialEditorUi(INITIAL_PREFERENCES) },
    freeze,
  });
  return { store, clock, ids, root: document.pages[0]?.tree.id ?? '' };
}

const insertInto = (s: TestStore, parent?: string) => s.store.dispatch('element.insert', parent === undefined ? { entry: 'container' } : { entry: 'container', parent });
const nameOf = (doc: DocumentJson, id: string) => locate(doc, id)?.node.name;

describe('the store', () => {
  it('cancels a provisional command sequence with its original redo, selection and editor state intact', () => {
    const s = testStore();
    insertInto(s);
    s.store.dispatch('element.rename', { target: s.store.getState().selection[0] ?? '', name: 'Kept name' });
    s.store.dispatch('history.undo', {});
    const before = s.store.getState();
    const sequence = s.store.sequence();
    sequence.dispatch('element.rename', { target: before.selection[0] ?? '', name: 'Accidental name' });
    sequence.dispatch('hand.take', {});
    expect(s.store.getState().ui.hand).not.toBeNull();
    expect(s.store.sequenceOpen()).toBe(true);
    expect(sequence.cancel()).toBe(true);
    expect(s.store.getState()).toEqual(before);
    expect(s.store.sequenceOpen()).toBe(false);
    s.store.dispatch('history.redo', {});
    expect(nameOf(s.store.getState().document, before.selection[0] ?? '')).toBe('Kept name');
  });

  it('commits each provisional command as its own undo step and notifies persistence when settled', () => {
    const s = testStore();
    const sequence = s.store.sequence();
    const saved: unknown[] = [];
    s.store.subscribe(() => {
      if (!s.store.sequenceOpen()) saved.push(s.store.getState().document);
    });
    sequence.dispatch('element.insert', { entry: 'container' });
    sequence.dispatch('element.insert', { entry: 'container' });
    expect(s.store.getState().history.past).toHaveLength(2);
    expect(saved).toHaveLength(0);
    sequence.commit();
    expect(saved).toEqual([s.store.getState().document]);
    expect(sequence.cancel()).toBe(false);
  });

  it('never cancels through an intervening external dispatch, including a dispatch by a subscriber', () => {
    const s = testStore();
    const sequence = s.store.sequence();
    let redirected = false;
    s.store.subscribe(() => {
      if (redirected || s.store.getState().selection.length === 0) return;
      redirected = true;
      s.store.dispatch('selection.select', { target: s.root });
    });
    sequence.dispatch('element.insert', { entry: 'container' });
    const after = s.store.getState();
    expect(sequence.cancel()).toBe(false);
    expect(s.store.getState()).toBe(after);
    expect(after.selection).toEqual([s.root]);
    expect(after.document.pages[0]?.tree.children).toHaveLength(1);
  });

  it('settles a provisional sequence before a pointer gesture starts', () => {
    const s = testStore();
    const sequence = s.store.sequence();
    sequence.dispatch('element.insert', { entry: 'container' });
    const gesture = s.store.gesture();
    expect(sequence.cancel()).toBe(false);
    gesture.cancel();
    expect(s.store.getState().document.pages[0]?.tree.children).toHaveLength(1);
  });

  it('starts from a valid, frozen state with an empty history', () => {
    const { store } = testStore();
    const state = store.getState();
    expect(state.history).toEqual({ past: [], future: [] });
    expect(state.selection).toEqual([]);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.document.pages[0]?.tree)).toBe(true);
  });

  it('says whether a command would run now without changing anything', () => {
    const s = testStore();
    // not built (the marker entry of this table), its predicate fails (nothing selected), its handler refuses (the
    // page root cannot be deleted)
    expect(s.store.canRun('timeline.stop', {})).toBe(false);
    expect(s.store.canRun('element.duplicate', {})).toBe(false);
    expect(s.store.canRun('element.delete', {})).toBe(false);
    s.store.dispatch('selection.select', { target: s.root });
    expect(s.store.canRun('element.delete', {})).toBe(false);
    insertInto(s);
    const before = s.store.getState();
    expect(s.store.canRun('element.delete', {})).toBe(true);
    expect(s.store.getState()).toBe(before);
  });

  it('says why a command would not run now without changing anything', () => {
    const s = testStore();
    // not built; its predicate fails (nothing selected: the manifest's refusal key); its handler refuses (the page
    // root cannot be deleted); it would run
    expect(s.store.refusal('timeline.stop', {})).toEqual(message('common.notAvailableYet'));
    expect(s.store.refusal('element.delete', {})).toEqual(message('refusal.nothingSelected'));
    s.store.dispatch('selection.select', { target: s.root });
    const selected = s.store.getState();
    expect(s.store.refusal('element.delete', {})).toEqual(message('status.delete.root'));
    expect(s.store.getState()).toBe(selected);
    insertInto(s);
    const before = s.store.getState();
    expect(s.store.refusal('element.delete', {})).toBeNull();
    expect(s.store.getState()).toBe(before);
  });

  it('changes nothing for a command whose entry is NOT_AVAILABLE_YET', () => {
    const { store } = testStore();
    const before = store.getState();
    expect(store.dispatch('timeline.stop', {})).toEqual({ status: 'not-available-yet' });
    expect(store.getState()).toBe(before);
  });

  it('refuses a command whose availability predicate fails, says why, and records nothing', () => {
    const { store } = testStore();
    const before = store.getState();
    const result = store.dispatch('element.delete', {});
    expect(result).toEqual({ status: 'refused', message: { key: 'refusal.nothingSelected', params: {} } });
    expect(store.getState().document).toBe(before.document);
    expect(store.getState().history).toBe(before.history);
    expect(store.getState().message).toEqual({ key: 'refusal.nothingSelected', params: {} });
  });

  it("says a predicate's own refusal when it is one the manifest declares for the command, and refuses any other", () => {
    const own = registerPredicate<EditorUi>('hasSelection', () => false, () => message('status.delete.root', { name: 'Page' }));
    const { store } = testStore(TEST_COMMANDS, { ...TEST_PREDICATES, hasSelection: own });
    expect(store.dispatch('element.delete', {})).toEqual({ status: 'refused', message: { key: 'status.delete.root', params: { name: 'Page' } } });
    expect(store.getState().message).toEqual({ key: 'status.delete.root', params: { name: 'Page' } });
    const undeclared = registerPredicate<EditorUi>('hasSelection', () => false, () => message('status.undo.nothing'));
    const other = testStore(TEST_COMMANDS, { ...TEST_PREDICATES, hasSelection: undeclared });
    expect(() => other.store.dispatch('element.delete', {})).toThrow(/does not declare/);
  });

  it('records a transaction with its patches, inverses and the selection before and after', () => {
    const s = testStore();
    insertInto(s);
    const [tx] = s.store.getState().history.past;
    expect(tx?.command).toBe('element.insert');
    expect(tx?.selectionBefore).toEqual([]);
    expect(tx?.selectionAfter).toEqual(['n3']);
    expect(tx?.patches).toHaveLength(1);
    expect(tx?.inverses).toEqual([{ op: 'remove', path: ['pages', 0, 'tree', 'children', 0] }]);
    expect(tx?.at).toBe(1_000_000);
  });

  it('undoes to the document and the selection before the command, and redoes to the ones after it', () => {
    const s = testStore();
    const initial = s.store.getState().document;
    insertInto(s);
    const afterInsert = s.store.getState();
    // what the insert said it did, which undo and redo name (spec undo-redo, Problems in Pager 3)
    const said = afterInsert.message ?? { key: 'history.lastChange' };
    // the user selects the root afterwards: undo restores the selection of the insert's "before", not this one
    s.store.dispatch('selection.select', { target: s.root });
    s.store.dispatch('history.undo', {});
    expect(s.store.getState().document).toEqual(initial);
    expect(s.store.getState().selection).toEqual([]);
    expect(s.store.getState().message).toEqual({ key: 'status.undone', params: { action: said } });
    s.store.dispatch('history.redo', {});
    expect(s.store.getState().document).toEqual(afterInsert.document);
    expect(s.store.getState().selection).toEqual(afterInsert.selection);
    expect(s.store.getState().message).toEqual({ key: 'status.redone', params: { action: said } });
  });

  it('refuses undo and redo when there is nothing to undo or redo', () => {
    const s = testStore();
    expect(s.store.dispatch('history.undo', {})).toEqual({ status: 'refused', message: { key: 'status.undo.nothing', params: {} } });
    expect(s.store.dispatch('history.redo', {})).toEqual({ status: 'refused', message: { key: 'status.redo.nothing', params: {} } });
  });

  it('records no entry for a command that changes nothing', () => {
    const s = testStore();
    insertInto(s);
    const id = s.store.getState().selection[0] ?? '';
    const before = s.store.getState();
    const result = s.store.dispatch('element.rename', { target: id, name: nameOf(before.document, id) ?? '' });
    expect(result).toEqual({ status: 'done', changed: false });
    expect(s.store.getState()).toBe(before);
    expect(s.store.getState().history.past).toHaveLength(1);
  });

  it('empties the redo stack when a new command runs after an undo', () => {
    const s = testStore();
    insertInto(s);
    insertInto(s);
    s.store.dispatch('history.undo', {});
    expect(s.store.getState().history.future).toHaveLength(1);
    insertInto(s);
    expect(s.store.getState().history.future).toHaveLength(0);
    expect(s.store.dispatch('history.redo', {}).status).toBe('refused');
  });

  it('changes the selection through a command that is not undoable, without a history entry', () => {
    const s = testStore();
    s.store.dispatch('selection.select', { target: s.root });
    expect(s.store.getState().selection).toEqual([s.root]);
    expect(s.store.getState().history.past).toHaveLength(0);
  });

  it('never commits an invalid state: the whole tree is validated on every commit', () => {
    const s = testStore();
    insertInto(s);
    const before = s.store.getState();
    const id = before.selection[0] ?? '';
    expect(() => s.store.dispatch('element.rename', { target: id, name: '' })).toThrow(InvalidStateError);
    // nothing of the change is published; the status bar says the command's change was refused (jornada03 J1)
    const after = s.store.getState();
    expect(after.document).toBe(before.document);
    expect(after.selection).toBe(before.selection);
    expect(after.history).toBe(before.history);
    expect(after.message?.key).toBe('status.change.invalid');
    expect(after.refused).toBe(true);
  });

  it('throws when a command the manifest declares not undoable changes the document', () => {
    const rogue = registerHandler('selection.select', ({ state }) => ({ kind: 'change', patches: [{ op: 'replace', path: ['pages', 0, 'name'], value: `${state.document.pages[0]?.name ?? ''}!` }] }));
    const s = testStore({ ...TEST_COMMANDS, 'selection.select': rogue });
    const before = s.store.getState();
    expect(() => s.store.dispatch('selection.select', { target: s.root })).toThrow(/not undoable/);
    expect(s.store.getState()).toBe(before);
  });

  it('deep-freezes every committed state, so nothing can change it in place', () => {
    const s = testStore();
    insertInto(s);
    const state = s.store.getState();
    const node = state.document.pages[0]?.tree.children[0];
    expect(() => {
      (node as unknown as { name: string }).name = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      (state.selection as string[]).push('x');
    }).toThrow(TypeError);
  });

  it('merges moves of the same selection within history.nudgeBurstWindow into one entry', () => {
    const s = testStore();
    insertInto(s);
    const window = CONSTANTS.get('history.nudgeBurstWindow');
    expect(window).toBe(1000);
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    s.clock.advance(999);
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    s.clock.advance(1000);
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    expect(s.store.getState().history.past.map((t) => t.command)).toEqual(['element.insert', 'position.move']);
    s.clock.advance(1001);
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    expect(s.store.getState().history.past.map((t) => t.command)).toEqual(['element.insert', 'position.move', 'position.move']);
    const id = s.store.getState().selection[0] ?? '';
    expect(locate(s.store.getState().document, id)?.node.styles.desktop?.base?.left).toBe('4px');
    s.store.dispatch('history.undo', {});
    expect(locate(s.store.getState().document, id)?.node.styles.desktop?.base?.left).toBe('3px');
    s.store.dispatch('history.undo', {});
    expect(locate(s.store.getState().document, id)?.node.styles.desktop?.base).toBeUndefined();
  });

  it('never merges moves when another command came in between, even one that records nothing (spec absolute-nudge)', () => {
    const s = testStore();
    insertInto(s);
    const id = s.store.getState().selection[0] ?? '';
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    // selecting the node that is already selected changes nothing and records nothing
    s.store.dispatch('selection.select', { target: id });
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    // a command that is not available yet is a command in between as well
    s.store.dispatch('timeline.stop', {});
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    expect(s.store.getState().history.past.map((t) => t.command)).toEqual(['element.insert', 'position.move', 'position.move', 'position.move']);
  });

  it('refuses a command the manifest records per dispatch inside a gesture (history.transaction)', () => {
    const s = testStore();
    insertInto(s);
    const id = s.store.getState().selection[0] ?? '';
    const gesture = s.store.gesture();
    expect(() => gesture.dispatch('element.rename', { target: id, name: 'Inside' })).toThrow(/one transaction per dispatch/);
    gesture.cancel();
  });

  it('never merges moves of different selections', () => {
    const s = testStore();
    insertInto(s);
    const first = s.store.getState().selection[0] ?? '';
    insertInto(s);
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    s.store.dispatch('selection.select', { target: first });
    s.store.dispatch('position.move', { dx: 1, dy: 0 });
    expect(s.store.getState().history.past.map((t) => t.command)).toEqual(['element.insert', 'element.insert', 'position.move', 'position.move']);
  });

  it('makes one transaction and one entry of everything a gesture dispatches', () => {
    const s = testStore();
    const initial = s.store.getState();
    const gesture = s.store.gesture();
    gesture.dispatch('element.insert', { entry: 'container' });
    gesture.dispatch('geometry.resize', { width: '100px' });
    gesture.dispatch('geometry.resize', { width: '120px' });
    // the state follows the gesture as it goes, and the history waits for its end
    expect(s.store.getState().history.past).toHaveLength(0);
    expect(() => s.store.dispatch('history.undo', {})).toThrow(/gesture is open/);
    gesture.commit();
    const after = s.store.getState();
    expect(after.history.past).toHaveLength(1);
    expect(after.history.past[0]?.selectionBefore).toEqual([]);
    s.store.dispatch('history.undo', {});
    expect(s.store.getState().document).toEqual(initial.document);
    expect(s.store.getState().selection).toEqual([]);
    s.store.dispatch('history.redo', {});
    expect(s.store.getState().document).toEqual(after.document);
    expect(s.store.getState().selection).toEqual(after.selection);
  });

  // the audit's AUD-08: a gesture took a command's patches before the commit validated them, so in production a refused
  // commit inside a gesture left its patches in the gesture's history entry
  it('keeps a refused change out of the gesture it ran in', () => {
    clearIncidents();
    const twinResize = registerHandler('geometry.resize', ({ state }) => {
      const root = state.document.pages[0]?.tree;
      const at = root === undefined ? null : locate(state.document, root.id);
      if (at === null || root === undefined) return { kind: 'refused', message: message('status.refused.intoItself') };
      const twin: DocNode = { id: root.id, type: 'div', name: 'Twin', tag: 'div', attributes: {}, classes: [], styles: {}, text: null, children: [] };
      return { kind: 'change', patches: [{ op: 'add', path: [...at.path, 'children', 0], value: twin }] };
    });
    const s = testStore({ ...TEST_COMMANDS, 'geometry.resize': twinResize }, TEST_PREDICATES, false);
    const initial = s.store.getState();
    const gesture = s.store.gesture();
    gesture.dispatch('element.insert', { entry: 'container' });
    const inserted = s.store.getState().document;
    expect(gesture.dispatch('geometry.resize', { width: '100px' }).status).toBe('refused');
    gesture.commit();
    expect(s.store.getState().document).toEqual(inserted);
    s.store.dispatch('history.undo', {});
    expect(s.store.getState().document).toEqual(initial.document);
    // the redo replays the insert alone: the refused patches never joined the entry
    s.store.dispatch('history.redo', {});
    expect(s.store.getState().document).toEqual(inserted);
    clearIncidents();
  });

  // the audit's AUD-08: a predicate refusing with a key the command does not declare threw before anything was said
  it('says a predicate\'s undeclared refusal before reporting it as a defect', () => {
    clearIncidents();
    const odd = { ...TEST_PREDICATES, hasSelection: registerPredicate('hasSelection', (state) => state.selection.length > 0, () => message('status.pages.added', { file: 'x' })) };
    const loose = testStore(TEST_COMMANDS, odd, false);
    const answer = loose.store.dispatch('selection.clear', {});
    expect(answer.status).toBe('refused');
    expect(loose.store.getState().message?.key).toBe('status.pages.added');
    expect(incidents().map((i) => i.what)).toContain('selection.clear: its predicate refuses with status.pages.added, which the manifest does not declare for it');
    // development: the same words first, then the throw
    const strict = testStore(TEST_COMMANDS, odd, true);
    expect(() => strict.store.dispatch('selection.clear', {})).toThrow(/does not declare/);
    expect(strict.store.getState().message?.key).toBe('status.pages.added');
    clearIncidents();
  });

  // the audit's AUD-08: refusal() and canRun() let a handler's throw out into the control that asked
  it('answers a control that asks about a handler that throws with the failure, and records it', () => {
    clearIncidents();
    const throwing = registerHandler('element.insert', () => {
      throw new Error('a defect');
    });
    const s = testStore({ ...TEST_COMMANDS, 'element.insert': throwing }, TEST_PREDICATES, true);
    expect(s.store.refusal('element.insert', { entry: 'container' })?.key).toBe('status.change.failed');
    expect(s.store.canRun('element.insert', { entry: 'container' })).toBe(false);
    expect(incidents().some((i) => i.what === 'element.insert threw while its control asked whether it would run')).toBe(true);
    clearIncidents();
  });

  it('restores the state from before a cancelled gesture and records nothing', () => {
    const s = testStore();
    insertInto(s);
    const before = s.store.getState();
    const gesture = s.store.gesture();
    gesture.dispatch('geometry.resize', { width: '300px' });
    gesture.cancel();
    expect(s.store.getState().document).toEqual(before.document);
    expect(s.store.getState().selection).toEqual(before.selection);
    expect(s.store.getState().history).toEqual(before.history);
    expect(() => gesture.dispatch('geometry.resize', { width: '1px' })).toThrow(/closed/);
  });

  it('refuses to build a store where a built command has no registered availability predicate', () => {
    const ids = sequentialIds('n');
    const { hasSelection, ...withoutHasSelection } = TEST_PREDICATES;
    expect(hasSelection.id).toBe('hasSelection');
    expect(() =>
      createStore<EditorUi>({
        table: TEST_COMMANDS,
        predicates: withoutHasSelection,
        commands: MANIFEST_COMMANDS,
        constants: CONSTANTS,
        rules: RULES,
        clock: manualClock(),
        ids,
        words: WORDS,
        initial: { document: emptyDocument(ids), ui: initialEditorUi(INITIAL_PREFERENCES) },
        freeze: true,
      }),
    ).toThrow(/predicate "hasSelection" is not registered/);
  });

  it('notifies subscribers after each committed change, and stops when unsubscribed', () => {
    const s = testStore();
    let calls = 0;
    const off = s.store.subscribe(() => calls++);
    insertInto(s);
    s.store.dispatch('timeline.stop', {});
    expect(calls).toBe(1);
    off();
    insertInto(s);
    expect(calls).toBe(1);
  });

  // a command whose patches the model refuses: the page root's id used a second time (a bug, not a refusal)
  const twinInsert = registerHandler('element.insert', ({ state }) => {
    const root = state.document.pages[0]?.tree;
    const at = root === undefined ? null : locate(state.document, root.id);
    if (at === null || root === undefined) return { kind: 'refused', message: message('status.refused.intoItself') };
    const twin: DocNode = { id: root.id, type: 'div', name: 'Twin', tag: 'div', attributes: {}, classes: [], styles: {}, text: null, children: [] };
    return { kind: 'change', patches: [{ op: 'add', path: [...at.path, 'children', 0], value: twin }] };
  });

  it('keeps the previous state and records an incident when a commit fails validation (plan T2)', () => {
    clearIncidents();
    const s = testStore({ ...TEST_COMMANDS, 'element.insert': twinInsert });
    const before = s.store.getState();
    // development and tests: the defect is loud
    expect(() => s.store.dispatch('element.insert', { entry: 'container' })).toThrow(/invalid state/);
    // the broken state was never published, and the feed holds what happened
    expect(s.store.getState().document).toBe(before.document);
    const recorded = incidents();
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.kind).toBe('invariant');
    expect(recorded[0]?.what).toContain('element.insert');
    expect(recorded[0]?.detail).toContain('already used');
    // the person is told, even in development where it throws (jornada03 J1: the silent failures)
    expect(s.store.getState().message?.key).toBe('status.change.invalid');
    // production (no freeze): the dispatch answers that the change was refused and says so in the status bar, the
    // previous document stays, the incident is recorded for the UI
    clearIncidents();
    const loose = testStore({ ...TEST_COMMANDS, 'element.insert': twinInsert }, TEST_PREDICATES, false);
    const kept = loose.store.getState();
    const answer = loose.store.dispatch('element.insert', { entry: 'container' });
    expect(answer.status).toBe('refused');
    expect(answer.status === 'refused' ? answer.message.key : null).toBe('status.change.invalid');
    expect(loose.store.getState().document).toBe(kept.document);
    expect(loose.store.getState().history).toBe(kept.history);
    expect(loose.store.getState().message?.key).toBe('status.change.invalid');
    expect(incidents().length).toBe(1);
  });

  it('says a handler that threw failed and changed nothing, loud in development, a refusal in production (J1)', () => {
    const throwing = registerHandler('element.insert', () => {
      throw new Error('a defect');
    });
    const s = testStore({ ...TEST_COMMANDS, 'element.insert': throwing });
    const before = s.store.getState();
    expect(() => s.store.dispatch('element.insert', { entry: 'container' })).toThrow('a defect');
    expect(s.store.getState().document).toBe(before.document);
    expect(s.store.getState().message?.key).toBe('status.change.failed');
    clearIncidents();
    const loose = testStore({ ...TEST_COMMANDS, 'element.insert': throwing }, TEST_PREDICATES, false);
    const kept = loose.store.getState();
    const answer = loose.store.dispatch('element.insert', { entry: 'container' });
    expect(answer.status === 'refused' ? answer.message.key : answer.status).toBe('status.change.failed');
    expect(loose.store.getState().document).toBe(kept.document);
    expect(loose.store.getState().message?.key).toBe('status.change.failed');
    expect(incidents().map((i) => i.kind)).toEqual(['error']);
  });

  // the audit's AUD-01: "Insert {element}" named with none of its arguments threw where the status bar drew it, and the
  // whole editor went blank; a refused or failed change names the command by its name without placeholders
  it('names a refused or failed command in words every locale can format, whatever its label holds', () => {
    const throwing = registerHandler('element.insert', () => {
      throw new Error('a defect');
    });
    const failing = testStore({ ...TEST_COMMANDS, 'element.insert': throwing }, TEST_PREDICATES, false);
    failing.store.dispatch('element.insert', { entry: 'container' });
    const refusing = testStore({ ...TEST_COMMANDS, 'element.insert': twinInsert }, TEST_PREDICATES, false);
    refusing.store.dispatch('element.insert', { entry: 'container' });
    clearIncidents();
    const said = [failing, refusing].map((s) => s.store.getState().message);
    expect(said.map((m) => m?.key)).toEqual(['status.change.failed', 'status.change.invalid']);
    for (const m of said) {
      if (m === null || m === undefined) throw new Error('nothing said');
      expect(messageText('en', m)).toContain('Insert an element');
      expect(messageText('pt-BR', m)).toContain('Inserir um elemento');
    }
  });

  it('records an incident when a command answers with structural patches that leave the document as it was', () => {
    clearIncidents();
    // a delete that "removes" the root's children by replacing them with the same list: nothing changes, yet it says so
    const hollowDelete = registerHandler('element.delete', ({ state }) => {
      const root = state.document.pages[0]?.tree;
      const at = root === undefined ? null : locate(state.document, root.id);
      if (at === null || root === undefined) return { kind: 'refused', message: message('status.delete.root') };
      return { kind: 'change', patches: [{ op: 'replace', path: [...at.path, 'children'], value: root.children }], message: message('status.delete.root') };
    });
    const s = testStore({ ...TEST_COMMANDS, 'element.delete': hollowDelete });
    insertInto(s);
    s.store.dispatch('element.delete', {});
    const recorded = incidents();
    expect(recorded.map((i) => i.kind)).toEqual(['empty-change']);
    expect(recorded[0]?.what).toContain('element.delete');
    // a value written in place that equals the one held is not structural: no incident
    clearIncidents();
    const t = testStore();
    const made = insertInto(t);
    expect(made.status).toBe('done');
    const id = t.store.getState().selection[0] ?? '';
    t.store.dispatch('element.rename', { target: id, name: nameOf(t.store.getState().document, id) ?? '' });
    expect(incidents()).toEqual([]);
  });

  it('says something in the status bar without running a command (notice: the stale drop)', () => {
    const s = testStore();
    const before = s.store.getState();
    const result = s.store.notice(message('status.stale'));
    // what the status bar reads changes; the document, the selection and the history do not
    expect(result).toBeUndefined();
    expect(s.store.getState().message).toEqual(message('status.stale'));
    expect(s.store.getState().refused).toBe(false);
    expect(s.store.getState().document).toBe(before.document);
    expect(s.store.getState().selection).toBe(before.selection);
    expect(s.store.getState().history).toBe(before.history);
  });
});

// ---- property: any sequence of commands, undos and redos

type Step = { kind: 'insert'; parent: number } | { kind: 'rename'; target: number; name: string } | { kind: 'delete' } | { kind: 'select'; target: number } | { kind: 'noop' } | { kind: 'undo' } | { kind: 'redo' };

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('insert' as const), parent: fc.nat() }),
  fc.record({ kind: fc.constant('rename' as const), target: fc.nat(), name: fc.constantFrom('A', 'B', 'C') }),
  fc.constant({ kind: 'delete' as const }),
  fc.record({ kind: fc.constant('select' as const), target: fc.nat() }),
  fc.constant({ kind: 'noop' as const }),
  fc.constant({ kind: 'undo' as const }),
  fc.constant({ kind: 'redo' as const }),
);

const ids = (doc: DocumentJson): string[] => {
  const out: string[] = [];
  const visit = (node: DocumentJson['pages'][number]['tree']) => {
    out.push(node.id);
    node.children.forEach(visit);
  };
  doc.pages.forEach((p) => visit(p.tree));
  return out;
};

describe('the history, for any sequence of commands, undos and redos', () => {
  it('restores exactly the document and the selection of every earlier and later state, and records only changes', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const s = testStore();
        // the oracle: the states along the history (the document, the selection after the command that led there and
        // the selection just before it), and where the store stands in it
        const timeline: { document: DocumentJson; selection: Selection; before: Selection }[] = [{ document: s.store.getState().document, selection: s.store.getState().selection, before: [] }];
        let at = 0;
        for (const st of steps) {
          const state = s.store.getState();
          const all = ids(state.document);
          const pick = (n: number) => all[n % all.length] ?? s.root;
          const pastBefore = state.history.past.length;
          let moved = false;
          if (st.kind === 'undo') {
            const result = s.store.dispatch('history.undo', {});
            if (at === 0) expect(result.status).toBe('refused');
            else {
              at--;
              moved = true;
            }
          } else if (st.kind === 'redo') {
            const result = s.store.dispatch('history.redo', {});
            if (at === timeline.length - 1) expect(result.status).toBe('refused');
            else {
              at++;
              moved = true;
            }
          } else if (st.kind === 'select') {
            s.store.dispatch('selection.select', { target: pick(st.target) });
            expect(s.store.getState().history.past.length).toBe(pastBefore);
            continue;
          } else {
            const result =
              st.kind === 'insert'
                ? s.store.dispatch('element.insert', { entry: 'container', parent: pick(st.parent) })
                : st.kind === 'rename'
                  ? s.store.dispatch('element.rename', { target: pick(st.target), name: st.name })
                  : st.kind === 'delete'
                    ? s.store.dispatch('element.delete', {})
                    : s.store.dispatch('element.rename', { target: s.root, name: nameOf(state.document, s.root) ?? '' });
            const next = s.store.getState();
            const changed = !deepEqual(next.document, state.document);
            // an entry exactly when the document changed
            expect(next.history.past.length).toBe(changed ? pastBefore + 1 : pastBefore);
            if (result.status !== 'done' || !changed) {
              expect(next.document).toBe(state.document);
              continue;
            }
            timeline.splice(at + 1, timeline.length, { document: next.document, selection: next.selection, before: state.selection });
            at++;
            expect(next.history.future).toHaveLength(0);
          }
          const now = s.store.getState();
          if (moved) {
            expect(now.document).toEqual(timeline[at]?.document);
            // undo restores the selection from just before the undone command; redo the one right after the command
            expect(now.selection).toEqual(st.kind === 'undo' ? timeline[at + 1]?.before : timeline[at]?.selection);
          }
          expect(now.history.past.length).toBe(at);
          expect(now.history.future.length).toBe(timeline.length - 1 - at);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('the command table', () => {
  it('has an entry for every command of the manifest and no other', () => {
    expect(Object.keys(COMMANDS).sort()).toEqual([...MANIFEST_COMMANDS.keys()].sort());
  });

  it('holds, for every built command, the handler registered for that command, and NOT_AVAILABLE_YET for the others', () => {
    const entries = Object.entries(COMMANDS as CommandTable<EditorUi>);
    for (const [id, entry] of entries) {
      if (isBuilt(entry)) expect(entry.command).toBe(id);
    }
    expect(COMMANDS['history.undo']).not.toBe(NOT_AVAILABLE_YET);
    expect(COMMANDS['history.redo']).not.toBe(NOT_AVAILABLE_YET);
  });
});

// Family ST2 of the code audit (2026-10-04): patches that do not fit the document are a failure of the command, said in
// the status bar and recorded, as a handler that throws is; they escaped dispatch instead.
describe('a command whose patches do not fit the document', () => {
  it('fails with words in production, nothing changed', () => {
    const misfit = registerHandler('element.rename', () => ({ kind: 'change', patches: [{ op: 'replace', path: ['pages', 9, 'name'], value: 'x' }] }));
    const { store } = testStore({ ...TEST_COMMANDS, 'element.rename': misfit } as CommandTable<EditorUi>, TEST_PREDICATES, false);
    const before = store.getState().document;
    const result = store.dispatch('element.rename', { target: store.getState().document.pages[0]?.tree.id ?? '', name: 'x' } as never);
    expect(result).toMatchObject({ status: 'refused', message: { key: 'status.change.failed' } });
    expect(store.getState().document).toBe(before);
  });
});

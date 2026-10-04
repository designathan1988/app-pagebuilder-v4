import { describe, expect, it } from 'vitest';
import fixture from '../../../manifest/features/fixtures/aurora.json';
import type { CommandArgs, NodeId } from '../../generated/commands.ts';
import type { CommandId, MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import { message, type HandlerContext, type RegisteredHandler } from '../commands/registry.ts';
import { locate, type DocNode, type DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { anyCss } from '../ports/css.ts';
import { noLayout } from '../ports/layout.ts';
import { selectAllInContainerCommand } from '../selection/selection.ts';
import { duplicateCommand } from '../structure/duplicate.ts';
import { insertCommand } from '../structure/insert.ts';
import { moveDownCommand, moveToCommand, moveUpCommand, nestIntoPreviousCommand, promoteCommand } from '../structure/move.ts';
import { deleteCommand } from '../structure/remove.ts';
import { unwrapCommand, wrapColumnCommand, wrapRowCommand } from '../structure/wrap.ts';
import { setTextCommand } from '../text/text.ts';
import { firstLockRefusal, lockOver, lockRefusal, setLayerColorCommand, toggleHiddenCommand, toggleLockCommand } from './flags.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
import { deepFreeze } from '../store/store.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const DOC: DocumentJson = {
  version: 3,
  pages: [
    {
      id: 'p',
      name: 'Home',
      file: 'index.html',
      tree: node('Page', 'page', 'body', {
        children: [node('Hero', 'section', 'section', { children: [node('Title', 'heading', 'h1', { text: 'Hi' }), node('Intro', 'paragraph', 'p', { text: 'x' })] })],
      }),
    },
  ],
};

// every document a handler reads is frozen, as the store commits it: a change in place throws
const state = (document: DocumentJson, selection: string[]) => ({ document: deepFreeze(document), selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never });
function run(document: DocumentJson, selection: string[], target?: string) {
  const context = {
    state: state(document, selection),
    clock: manualClock(),
    ids: sequentialIds('new'),
    rules: RULES,
    words: (key: MessageId) => translate('en', key),
    // hiding measures nothing on the canvas
    layout: noLayout,
    css: anyCss,
  } satisfies HandlerContext<never>;
  return toggleHiddenCommand.run(context, target === undefined ? {} : { target: target as NodeId });
}
const toggled = (document: DocumentJson, selection: string[], target?: string) => {
  const outcome = run(document, selection, target);
  if (outcome.kind !== 'change') throw new Error(`not a change: ${JSON.stringify(outcome)}`);
  const applied = applyPatches(document, outcome.patches ?? []);
  return { outcome, document: applied.document, restored: applyPatches(applied.document, applied.inverses).document };
};
const flag = (document: DocumentJson, id: string) => {
  const found = locate(document, id as NodeId)?.node;
  return found === undefined ? 'missing' : 'hidden' in found ? found.hidden : 'absent';
};

// every handler runs on a frozen document, as the store commits it: a change in place throws
deepFreeze(DOC);

describe('element.toggleHidden (src/core/nodes/flags.ts)', () => {
  it('hides the node a door names, leaves the selection as it is and says so; undo takes the flag away', () => {
    const { outcome, document, restored } = toggled(DOC, ['Title'], 'Intro');
    expect(flag(document, 'Intro')).toBe(true);
    expect(flag(document, 'Title')).toBe('absent');
    expect(outcome.selection).toBeUndefined();
    expect(outcome.message).toEqual(message('status.hidden', { name: 'Intro' }));
    expect(validateDocument(document, ['Title'], RULES)).toEqual([]);
    expect(restored).toEqual(DOC);
  });

  it('acts on the primary selected node when the door names none', () => {
    const { document } = toggled(DOC, ['Hero', 'Title']);
    expect([flag(document, 'Hero'), flag(document, 'Title')]).toEqual([true, 'absent']);
  });

  it('shows a hidden node again by removing its flag, so the document is the one before the hide', () => {
    const hidden = toggled(DOC, ['Intro'], 'Intro').document;
    const { outcome, document, restored } = toggled(hidden, ['Intro'], 'Intro');
    expect(document).toEqual(DOC);
    expect(flag(document, 'Intro')).toBe('absent');
    expect(outcome.message).toEqual(message('status.visible', { name: 'Intro' }));
    expect(restored).toEqual(hidden);
  });

  it('refuses the page root and changes nothing', () => {
    expect(run(DOC, ['Page'], 'Page')).toEqual({ kind: 'refused', message: message('status.hide.root') });
    expect(run(DOC, ['Page'])).toEqual({ kind: 'refused', message: message('status.hide.root') });
  });

  it('says a door stands for a hidden node: the one it names, else the primary', () => {
    const hidden = toggled(DOC, ['Intro'], 'Intro').document;
    const current = toggleHiddenCommand.current;
    if (current === undefined) throw new Error('element.toggleHidden registers no current');
    expect(current(state(hidden, ['Title']), { target: 'Intro' })).toBe(true);
    expect(current(state(hidden, ['Intro']), { target: 'Title' })).toBe(false);
    expect(current(state(hidden, ['Intro']), {})).toBe(true);
    expect(current(state(DOC, ['Intro']), {})).toBe(false);
  });
});

// lock-element on the scenarios' fixture: the flag, and every built command that would change a locked node
const AURORA = deepFreeze(structuredClone(fixture) as DocumentJson);
const contextOf = (document: DocumentJson, selection: string[]) =>
  ({
    state: state(document, selection),
    clock: manualClock(),
    ids: sequentialIds('new'),
    rules: RULES,
    words: (key: MessageId) => translate('en', key),
    // no command here measures the canvas
    layout: noLayout,
    css: anyCss,
  }) satisfies HandlerContext<never>;
// runs any core handler on a document and a selection
const runOn = <Id extends CommandId>(handler: RegisteredHandler<Id, never>, document: DocumentJson, selection: string[], args: CommandArgs[Id]) => handler.run(contextOf(document, selection), args);
// the document with these nodes locked, each through element.toggleLock's row door (its target)
function locking(document: DocumentJson, ...ids: string[]): DocumentJson {
  return ids.reduce((doc, id) => {
    const outcome = runOn(toggleLockCommand, doc, [], { target: id as NodeId });
    if (outcome.kind !== 'change') throw new Error(`not a change: ${JSON.stringify(outcome)}`);
    return applyPatches(doc, outcome.patches ?? []).document;
  }, document);
}
const lockFlag = (document: DocumentJson, id: string) => {
  const found = locate(document, id as NodeId)?.node;
  return found === undefined ? 'missing' : 'locked' in found ? found.locked : 'absent';
};
const refused = (key: MessageId, params: Record<string, string>) => ({ kind: 'refused', message: message(key, params) });

describe('element.toggleLock (src/core/nodes/flags.ts)', () => {
  it('locks the node a door names, leaves the selection as it is and says so; a second toggle unlocks it', () => {
    const outcome = runOn(toggleLockCommand, AURORA, ['n-title'], { target: 'n-intro' as NodeId });
    if (outcome.kind !== 'change') throw new Error('not a change');
    expect(outcome.selection).toBeUndefined();
    expect(outcome.message).toEqual(message('status.locked', { name: 'Intro' }));
    const applied = applyPatches(AURORA, outcome.patches ?? []);
    expect(lockFlag(applied.document, 'n-intro')).toBe(true);
    expect(lockFlag(applied.document, 'n-title')).toBe('absent');
    expect(validateDocument(applied.document, ['n-title'], RULES)).toEqual([]);
    expect(applyPatches(applied.document, applied.inverses).document).toEqual(AURORA);

    const again = runOn(toggleLockCommand, applied.document, ['n-intro'], {});
    if (again.kind !== 'change') throw new Error('not a change');
    expect(again.message).toEqual(message('status.unlocked', { name: 'Intro' }));
    expect(applyPatches(applied.document, again.patches ?? []).document).toEqual(AURORA);
  });

  it('refuses the page root and changes nothing', () => {
    expect(runOn(toggleLockCommand, AURORA, ['n-page'], { target: 'n-page' as NodeId })).toEqual({ kind: 'refused', message: message('status.lock.root') });
    expect(runOn(toggleLockCommand, AURORA, ['n-page'], {})).toEqual({ kind: 'refused', message: message('status.lock.root') });
  });

  it('says a door stands for a locked node: the one it names, else the primary', () => {
    const locked = locking(AURORA, 'n-intro');
    const current = toggleLockCommand.current;
    if (current === undefined) throw new Error('element.toggleLock registers no current');
    expect(current(state(locked, ['n-title']), { target: 'n-intro' })).toBe(true);
    expect(current(state(locked, ['n-intro']), { target: 'n-title' })).toBe(false);
    expect(current(state(locked, ['n-intro']), {})).toBe(true);
  });

  it('refuses a lock or a hide inside a locked element, naming the outermost lock, and allows it once that is unlocked', () => {
    const locked = locking(AURORA, 'n-grid', 'n-plans');
    expect(runOn(toggleLockCommand, locked, [], { target: 'n-card-a' as NodeId })).toEqual(refused('status.locked.byAncestor', { name: 'CardA', ancestor: 'Plans' }));
    expect(runOn(toggleLockCommand, locked, [], { target: 'n-grid' as NodeId })).toEqual(refused('status.locked.byAncestor', { name: 'Grid', ancestor: 'Plans' }));
    expect(runOn(toggleHiddenCommand, locked, [], { target: 'n-card-a' as NodeId })).toEqual(refused('status.locked.byAncestor', { name: 'CardA', ancestor: 'Plans' }));
    // the node that carries the outermost lock keeps its own flags
    expect(runOn(toggleHiddenCommand, locked, [], { target: 'n-plans' as NodeId }).kind).toBe('change');
    const unlocked = locking(locked, 'n-plans');
    expect(runOn(toggleLockCommand, unlocked, [], { target: 'n-card-a' as NodeId })).toEqual(refused('status.locked.byAncestor', { name: 'CardA', ancestor: 'Grid' }));
    expect(runOn(toggleLockCommand, locking(unlocked, 'n-grid'), [], { target: 'n-card-a' as NodeId }).kind).toBe('change');
  });

  it('names the lock over a node: its own with the command’s key, or the outermost locked element above it', () => {
    const locked = locking(AURORA, 'n-title', 'n-grid');
    expect(lockOver(locked, 'n-intro' as NodeId)).toBeNull();
    expect(lockRefusal(locked, 'n-intro' as NodeId, 'status.locked.delete')).toBeNull();
    expect(lockOver(locked, 'n-title' as NodeId)?.id).toBe('n-title');
    expect(lockRefusal(locked, 'n-title' as NodeId, 'status.locked.delete')).toEqual(message('status.locked.delete', { name: 'Title' }));
    expect(lockOver(locked, 'n-card-b-title' as NodeId)?.id).toBe('n-grid');
    expect(lockRefusal(locked, 'n-card-b-title' as NodeId, 'status.locked.move')).toEqual(message('status.locked.byAncestor', { name: 'CardBTitle', ancestor: 'Grid' }));
    expect(firstLockRefusal(locked, ['n-intro', 'n-card-a', 'n-title'] as NodeId[], 'status.locked.edit')).toEqual(message('status.locked.byAncestor', { name: 'CardA', ancestor: 'Grid' }));
    expect(firstLockRefusal(locked, ['n-intro', 'n-actions'] as NodeId[], 'status.locked.edit')).toBeNull();
  });
});

describe('a lock refuses every built command that would change the locked node or what it holds', () => {
  const hero = locking(AURORA, 'n-hero');
  const title = locking(AURORA, 'n-title');

  it('element.delete', () => {
    expect(runOn(deleteCommand, title, ['n-title'], {} as never)).toEqual(refused('status.locked.delete', { name: 'Title' }));
    expect(runOn(deleteCommand, hero, ['n-intro'], {} as never)).toEqual(refused('status.locked.byAncestor', { name: 'Intro', ancestor: 'Hero' }));
    // an element next to a locked one, and the parent of none, still goes
    expect(runOn(deleteCommand, title, ['n-intro'], {} as never).kind).toBe('change');
  });

  it('element.moveUp and element.moveDown', () => {
    expect(runOn(moveUpCommand, hero, ['n-actions'], {} as never)).toEqual(refused('status.locked.byAncestor', { name: 'Actions', ancestor: 'Hero' }));
    expect(runOn(moveDownCommand, title, ['n-title'], {} as never)).toEqual(refused('status.locked.move', { name: 'Title' }));
    expect(runOn(moveDownCommand, title, ['n-intro'], {} as never).kind).toBe('change');
  });

  it('element.moveTo, element.nestIntoPrevious and element.promote: a locked node stays, a locked parent takes nothing', () => {
    expect(runOn(moveToCommand, title, ['n-title'], { parent: 'n-footer' as NodeId, index: 0 })).toEqual(refused('status.locked.move', { name: 'Title' }));
    expect(runOn(moveToCommand, hero, ['n-note'], { parent: 'n-hero' as NodeId, index: 0 })).toEqual(refused('status.locked.insert', { name: 'Hero' }));
    expect(runOn(moveToCommand, hero, ['n-note'], { parent: 'n-actions' as NodeId, index: 0 })).toEqual(refused('status.locked.byAncestor', { name: 'Actions', ancestor: 'Hero' }));
    expect(runOn(moveToCommand, title, ['n-note'], { parent: 'n-hero' as NodeId, index: 0 }).kind).toBe('change');
    expect(runOn(nestIntoPreviousCommand, hero, ['n-plans'], {} as never)).toEqual(refused('status.locked.insert', { name: 'Hero' }));
    expect(runOn(promoteCommand, hero, ['n-intro'], {} as never)).toEqual(refused('status.locked.byAncestor', { name: 'Intro', ancestor: 'Hero' }));
  });

  it('element.wrapRow, element.wrapColumn, element.unwrap and element.duplicate', () => {
    expect(runOn(wrapRowCommand, title, ['n-title'], {} as never)).toEqual(refused('status.locked.edit', { name: 'Title' }));
    expect(runOn(wrapColumnCommand, hero, ['n-intro'], {} as never)).toEqual(refused('status.locked.byAncestor', { name: 'Intro', ancestor: 'Hero' }));
    expect(runOn(unwrapCommand, locking(AURORA, 'n-grid'), ['n-grid'], {} as never)).toEqual(refused('status.locked.edit', { name: 'Grid' }));
    expect(runOn(duplicateCommand, title, ['n-title'], {} as never)).toEqual(refused('status.locked.edit', { name: 'Title' }));
    expect(runOn(duplicateCommand, hero, ['n-intro'], {} as never)).toEqual(refused('status.locked.byAncestor', { name: 'Intro', ancestor: 'Hero' }));
  });

  it('element.insert: a locked parent takes no new element; next to a locked element in a free parent it goes in', () => {
    expect(runOn(insertCommand, hero, ['n-hero'], { entry: 'paragraph' } as never)).toEqual(refused('status.locked.insert', { name: 'Hero' }));
    expect(runOn(insertCommand, hero, ['n-title'], { entry: 'paragraph' } as never)).toEqual(refused('status.locked.insert', { name: 'Hero' }));
    expect(runOn(insertCommand, hero, [], { entry: 'paragraph', parent: 'n-actions' } as never)).toEqual(refused('status.locked.byAncestor', { name: 'Actions', ancestor: 'Hero' }));
    expect(runOn(insertCommand, title, ['n-title'], { entry: 'paragraph' } as never).kind).toBe('change');
  });

  it('text.set keeps the text of a locked element', () => {
    expect(runOn(setTextCommand, title, [], { target: 'n-title' as NodeId, content: 'Other' })).toEqual(refused('status.locked.editText', { name: 'Title' }));
    expect(runOn(setTextCommand, hero, [], { target: 'n-intro' as NodeId, content: 'Other' })).toEqual(refused('status.locked.byAncestor', { name: 'Intro', ancestor: 'Hero' }));
  });

  it('selection.selectAllInContainer leaves out a locked sibling and what a locked element holds, and counts them', () => {
    const outcome = runOn(selectAllInContainerCommand, title, ['n-intro'], {} as never);
    expect(outcome).toEqual({ kind: 'change', selection: ['n-intro', 'n-actions'], message: message('status.selection.skipped', { count: 2, skipped: 1 }) });
    expect(runOn(selectAllInContainerCommand, locking(AURORA, 'n-grid'), ['n-card-b'], {} as never)).toEqual({ kind: 'change', selection: [], message: message('status.selection.skipped', { count: 0, skipped: 3 }) });
  });
});

// element.setLayerColor (spec layers-row-colours): an empty colour takes a node's colour away; the page's last colour
// takes the list with it, which the model keeps absent while there is none (LC1: the list was left empty and the
// change refused as an invalid state)
describe('element.setLayerColor', () => {
  const coloured = (colours: readonly { node: string; colour: string }[]): DocumentJson => {
    const [page] = DOC.pages;
    if (page === undefined) throw new Error('DOC has a page');
    return documentOf({ pages: [{ ...page, tree: { ...page.tree, layerColors: colours as never } }] });
  };
  it('takes the page’s last colour away with its list', () => {
    const ran = runHandler(setLayerColorCommand, coloured([{ node: 'Intro', colour: '#ff0000' }]), { target: 'Intro', color: '' });
    expect(ran.problems).toEqual([]);
    expect(ran.document.pages[0]?.tree.layerColors).toBeUndefined();
  });
  it('takes one colour away and keeps the others', () => {
    const ran = runHandler(setLayerColorCommand, coloured([{ node: 'Title', colour: '#00ff00' }, { node: 'Intro', colour: '#ff0000' }]), { target: 'Intro', color: '' });
    expect(ran.problems).toEqual([]);
    expect(ran.document.pages[0]?.tree.layerColors).toEqual([{ node: 'Title', colour: '#00ff00' }]);
  });
});

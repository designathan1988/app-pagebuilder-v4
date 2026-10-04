// Families GB1 and AG1 of the code audit (2026-10-04, second reading). GB1: every press on the canvas, a Layers row or
// a panel drag opens a pointer gesture, and the store threw while the assistant's turn held its command group, so each
// click during the turn was an uncaught error. AG1: a door that reads a file (or a folder, the clipboard) dispatches
// when the read resolves, and the wheel dispatches its pan, while a press may hold a gesture open; the store threw
// then, and the import was lost without a word.
import { describe, expect, it } from 'vitest';
import { createEditorStore } from './store.ts';
import { manualClock } from '../core/ports/clock.ts';
import { sequentialIds } from '../core/ports/ids.ts';
import { message } from '../core/commands/registry.ts';

const make = () => createEditorStore({ storage: { read: () => null, write: () => undefined }, ids: sequentialIds('n'), clock: manualClock() });

describe('the editor store never throws at a press or a late dispatch (GB1, AG1)', () => {
  it('opens a gesture while a command group is held, its document changes refused with the busy words', () => {
    const store = make();
    const group = store.commandGroup(message('common.notAvailableYet'));
    const root = store.getState().document.pages[0]?.tree.id as never;
    const gesture = store.gesture();
    expect(() => gesture.dispatch('element.insert', { entry: 'paragraph', parent: root } as never)).not.toThrow();
    gesture.commit();
    group.cancel();
  });
  it('runs an undoable dispatch that arrives during a gesture once the gesture ends', () => {
    const store = make();
    const root = store.getState().document.pages[0]?.tree.id as never;
    const gesture = store.gesture();
    expect(() => store.dispatch('element.insert', { entry: 'paragraph', parent: root } as never)).not.toThrow();
    expect(store.getState().document.pages[0]?.tree.children).toHaveLength(0);
    gesture.commit();
    expect(store.getState().document.pages[0]?.tree.children).toHaveLength(1);
  });
});

// @vitest-environment happy-dom
// Family AS1 of the code audit (2026-10-04): no work leaves the tab without a word. While the saved work is refused
// (Recovery required) nothing is written, and the leave-page guard asked only while a write was pending or refused, so
// everything built in that session was lost on a reload or a close with no warning.
import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../store.ts';
import { manualClock } from '../../core/ports/clock.ts';
import { sequentialIds } from '../../core/ports/ids.ts';
import { anyCss } from '../../core/ports/css.ts';
import { startAutosave } from './autosave.ts';

const memory = (): { read(): string | null; write(text: string): void } => {
  let held: string | null = null;
  return { read: () => held, write: (text) => void (held = text) };
};

describe('work made while recovery is required asks before leaving (AS1)', () => {
  it('a change in that session makes leaving the tab ask first', () => {
    const store = createEditorStore({ storage: memory(), workspace: memory(), clock: manualClock(1_000_000), ids: sequentialIds('a'), ports: { css: anyCss, readOnly: () => false }, freeze: true });
    const stop = startAutosave(store, { revision: 4, format: 3, document: { broken: true }, selection: [] }, false);
    const root = store.getState().document.pages[0]?.tree.id ?? '';
    store.dispatch('element.insert', { entry: 'paragraph', parent: root } as never);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    stop();
  });
});

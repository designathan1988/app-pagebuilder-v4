// @vitest-environment happy-dom
// Family KB1 of the code audit (2026-10-04): a key of an input method's composition is the composition's. The keymap
// ran the bindings of keydown events whose isComposing was true: the Enter that picks a candidate committed the field.
import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../store.ts';
import { manualClock } from '../../core/ports/clock.ts';
import { sequentialIds } from '../../core/ports/ids.ts';
import { anyCss } from '../../core/ports/css.ts';
import { installKeymap } from './keymap.ts';

const memory = (): { read(): string | null; write(text: string): void } => {
  let held: string | null = null;
  return { read: () => held, write: (text) => void (held = text) };
};

describe('the keymap leaves a composition alone (KB1)', () => {
  it('a bound chord pressed during a composition runs nothing', () => {
    const store = createEditorStore({ storage: memory(), workspace: memory(), clock: manualClock(1_000_000), ids: sequentialIds('k'), ports: { css: anyCss, readOnly: () => false }, freeze: true });
    const stop = installKeymap(store, window);
    const before = store.getState().ui.panels;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }));
    expect(store.getState().ui.panels).toBe(before);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(store.getState().ui.panels).not.toBe(before);
    stop();
  });
});

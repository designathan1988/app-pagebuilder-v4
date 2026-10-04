// Family ST1 of the code audit (2026-10-04): a refusal said beside a field lives until a command runs. An undo, a redo
// and a project loaded are commands that run, but they kept the refusal: after a refused value, Ctrl+Z left the old
// refusal under the field.
import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../../editor/store.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { anyCss } from '../ports/css.ts';
import { documentOf, node } from '../testing/handlers.ts';

const memory = (): { read(): string | null; write(text: string): void } => {
  let held: string | null = null;
  return { read: () => held, write: (text) => void (held = text) };
};

describe("a refusal goes with the next command that runs (ST1)", () => {
  it('an undo takes the refusal said beside a field away', () => {
    const document = documentOf({ pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Box', 'div', 'div')] }) }] });
    const store = createEditorStore({ storage: memory(), workspace: memory(), clock: manualClock(1_000_000), ids: sequentialIds('v'), restored: { document, selection: ['Box' as never] }, ports: { css: anyCss, readOnly: () => false, downloads: { deliver: () => undefined }, clipboard: { write: () => undefined } as never }, freeze: true });
    expect(store.dispatch('style.set', { property: 'width', value: '120px' }).status).toBe('done');
    expect(store.dispatch('style.set', { property: 'width', value: 'not a width' }).status).toBe('refused');
    expect(store.getState().refusal).not.toBeNull();
    store.dispatch('history.undo', {});
    expect(store.getState().refusal ?? null).toBeNull();
  });
});

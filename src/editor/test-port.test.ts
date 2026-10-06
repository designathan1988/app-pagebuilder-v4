// The read-only test port (PRODUCT.md §5): what a browser check reads of the app. Document, selection and history
// are copies of the store's state; `explain` answers why; `incidents` carries what the app recorded — so a check that
// only ever reads can still fail on something the app did wrong.
import { describe, expect, it } from 'vitest';
import { manualClock } from '../core/ports/clock.ts';
import { sequentialIds } from '../core/ports/ids.ts';
import { clearIncidents, reportError } from '../core/incidents.ts';
import { createEditorStore } from './store.ts';
import { createTestPort } from './test-port.ts';
import { listenToKeys, translate } from '../i18n/index.ts';

const port = () => {
  const store = createEditorStore({ storage: { read: () => null, write: () => undefined }, ids: sequentialIds('n'), clock: manualClock() });
  return createTestPort(store);
};

describe('the read-only test port', () => {
  it('carries the document, the selection and the history as copies', () => {
    const testPort = port();
    const document = testPort.document() as { pages: readonly unknown[] };
    expect(document.pages.length).toBe(1);
    expect(testPort.selection()).toEqual([]);
    expect(testPort.history()).toEqual({ undoSteps: 0, redoSteps: 0 });
  });

  it('answers why: a command that would not run, and what a node is', () => {
    const testPort = port();
    // nothing is selected: delete would not run, and the answer names the refusal a command would give
    expect(testPort.explain.command('element.delete', {})).toBe('refusal.nothingSelected');
    const root = (testPort.document() as { pages: { tree: { id: string } }[] }).pages[0]?.tree.id ?? '';
    const about = testPort.explain.node(root as never);
    expect(about.facts.found).toBe(true);
    expect(about.facts.type).toBe('page');
    expect(testPort.explain.node('nope' as never).facts.found).toBe(false);
  });

  it('carries what the incident feed holds', () => {
    clearIncidents();
    const testPort = port();
    expect(testPort.incidents()).toEqual([]);
    reportError('a test threw', 'Error: boom');
    const held = testPort.incidents();
    expect(held.length).toBe(1);
    expect(held[0]?.what).toBe('a test threw');
    clearIncidents();
  });

  it('carries the message keys translated, plural forms with their key (the coverage of the catalogues)', () => {
    const store = createEditorStore({ storage: { read: () => null, write: () => undefined }, ids: sequentialIds('n'), clock: manualClock() });
    const shown = new Set<string>();
    listenToKeys((key) => shown.add(key));
    try {
      const testPort = createTestPort(store, shown);
      translate('en', 'canvas.selectedCount', { count: 3 });
      expect(testPort.keys()).toEqual(expect.arrayContaining(['canvas.selectedCount']));
      expect(testPort.keys().some((key) => key.startsWith('canvas.selectedCount.'))).toBe(true);
    } finally {
      listenToKeys(null);
    }
  });
});

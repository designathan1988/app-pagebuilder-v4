// Family BP1 of the code audit (2026-10-04, second reading): the composer mapped its rules to the manifest's default
// breakpoints, while a project holds its own table (breakpoints.add and breakpoints.setWidth change it). With the
// tablet set to 900 px, a responsive edit recorded at 900 px found no default breakpoint of that width and was refused.
import { describe, expect, it } from 'vitest';
import type { DocNode, NodeId } from '../../../editor/host.ts';
import { anyCss, createEditorStore, manualClock, noLayout, sequentialIds } from '../../../editor/host-testing.ts';
import type { Layout, PreferenceStorage, Rect } from '../../../editor/host-testing.ts';

const memory = (): PreferenceStorage => ({ read: () => null, write: () => {} });
const PAGE: Rect = { x: 0, y: 0, width: 1440, height: 900 };

describe('the composer reads the project\'s own breakpoints (BP1)', () => {
  it('stacks a group at a tablet the project made 900 px wide', () => {
    let rootId = '';
    const layout: Layout = { ...noLayout, box: (id: NodeId) => (id === rootId ? PAGE : null) };
    const store = createEditorStore({ storage: memory(), ids: sequentialIds('n'), clock: manualClock(), ports: { layout, css: anyCss, readOnly: () => false }, freeze: true });
    const root = () => store.getState().document.pages[0]?.tree as DocNode;
    rootId = root().id;
    expect(store.dispatch('breakpoints.setWidth', { breakpoint: 'tablet', width: 900 } as never).status).toBe('done');
    store.dispatch('layout.enter', {});
    const stroke = (points: readonly { x: number; y: number }[], mode = 'auto') => {
      const gesture = store.gesture();
      gesture.dispatch('layout.stroke', { mode, points } as never);
      gesture.commit();
    };
    stroke([{ x: 40, y: 40 }, { x: 1400, y: 400 }]);
    stroke([{ x: 500, y: 20 }, { x: 500, y: 420 }], 'cut');
    store.dispatch('view.setBreakpoint', { breakpoint: 'tablet' } as never);
    store.dispatch('layout.select', { regions: [], mode: 'replace' } as never);
    expect(store.dispatch('layout.respond', { edit: 'stack' } as never).status).toBe('done');
    expect(JSON.stringify((root().styles as Record<string, unknown>).tablet)).toContain('"flex-direction":"column"');
  });
});

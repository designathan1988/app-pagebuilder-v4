// The Layout Composer's rules, suggestions, templates and reference image through the editor's real store (spec
// layout-composer): each change one undo step, each refusal a change of nothing.
import { describe, expect, it } from 'vitest';
import type { DocNode, DocumentJson, NodeId } from '../../../editor/host.ts';
import { anyCss, createEditorStore, manualClock, noLayout, sequentialIds } from '../../../editor/host-testing.ts';
import type { EditorStore, Layout, PreferenceStorage } from '../../../editor/host-testing.ts';
import type { Luminance } from '../adapters/reference.ts';
import { recordOf } from './record.ts';

const memory = (): PreferenceStorage => ({ read: () => null, write: () => {} });
// the page's root is composed at least as tall as the screen (900 at Desktop), so its intent is 1200 x 900
// a project image: its bytes are never decoded here (the panel reads the luminance in the browser)
const IMAGE = { path: 'img/wireframe.png', type: 'image/png', bytes: 'iVBORw0KGgo=', width: 240, height: 160 };

function composing(withImage = false): { readonly store: EditorStore; readonly root: () => DocNode } {
  let rootId = '';
  const layout: Layout = { ...noLayout, box: (id: NodeId) => (id === rootId ? { x: 0, y: 0, width: 1200, height: 800 } : null) };
  const ports = { layout, css: anyCss, readOnly: () => false };
  const first = createEditorStore({ storage: memory(), ids: sequentialIds('n'), clock: manualClock(), ports, freeze: true });
  const document: DocumentJson = withImage ? { ...first.getState().document, files: [IMAGE] } : first.getState().document;
  const store = createEditorStore({ storage: memory(), ids: sequentialIds('m'), clock: manualClock(), ports, freeze: true, restored: { document, selection: [] } });
  const root = () => store.getState().document.pages[0]?.tree as DocNode;
  rootId = root().id;
  store.dispatch('layout.enter', {});
  return { store, root };
}

const stroke = (store: EditorStore, points: readonly { x: number; y: number }[], mode = 'auto') => {
  const gesture = store.gesture();
  const result = gesture.dispatch('layout.stroke', { mode, points } as never);
  gesture.commit();
  return result;
};

const intent = (root: () => DocNode) => recordOf(root())?.intent;

describe('Layout Composer rules, suggestions and templates', () => {
  it('makes the selected regions equally wide with Equal widths, then removes the rule with its own door', () => {
    const { store, root } = composing();
    stroke(store, [{ x: 0, y: 0 }, { x: 300, y: 200 }]);
    stroke(store, [{ x: 400, y: 0 }, { x: 800, y: 200 }]);
    stroke(store, [{ x: 900, y: 0 }, { x: 1100, y: 200 }]);
    store.dispatch('layout.select', { regions: ['r1'], mode: 'replace' } as never);
    store.dispatch('layout.select', { regions: ['r2'], mode: 'add' } as never);
    store.dispatch('layout.select', { regions: ['r3'], mode: 'add' } as never);
    expect(store.dispatch('layout.configure', { field: 'equalize', value: 'equal-size' } as never).status).toBe('done');
    const rule = intent(root)?.constraints[0];
    expect(rule?.kind).toBe('equal-size');
    // one region alone cannot be made equal to anything, and an unknown rule is refused
    store.dispatch('layout.select', { regions: ['r1'], mode: 'replace' } as never);
    expect(store.dispatch('layout.configure', { field: 'equalize', value: 'gap' } as never).status).toBe('refused');
    expect(store.dispatch('layout.configure', { field: 'equalize', value: 'nothing' } as never).status).toBe('refused');
    expect(store.dispatch('layout.unrelate', { constraint: rule?.id } as never).status).toBe('done');
    expect(intent(root)?.constraints).toEqual([]);
    expect(store.dispatch('layout.unrelate', { constraint: 'c9' } as never).status).toBe('refused');
  });

  it('applies a suggestion the layout offers, and offers none that would change nothing', () => {
    const { store, root } = composing();
    // four alike cards already compile to a grid: "arrange them as a grid" would change nothing, so it is not offered
    for (let i = 0; i < 4; i += 1) stroke(store, [{ x: i * 250, y: 0 }, { x: i * 250 + 200, y: 200 }]);
    expect(store.dispatch('layout.suggest', { suggestion: 'repeat:$root' } as never).status).toBe('refused');
    expect(intent(root)?.preferences?.$root).toBeUndefined();
    // a region drawn exactly over another one's box inside it leaves a wrapper that changes nothing: it goes
    stroke(store, [{ x: 0, y: 300 }, { x: 600, y: 700 }]);
    stroke(store, [{ x: 0, y: 300 }, { x: 600, y: 700 }], 'draw');
    const wrapper = intent(root)?.regions.find((r) => r.box.y === 300 && r.parent === null)?.id ?? '';
    // the page reads the big region as its main content: a wrapper with a meaning is no inert wrapper; made a plain div
    // again by the person, it changes nothing and the suggestion takes it away
    expect(store.dispatch('layout.suggest', { suggestion: `remove-wrapper:${wrapper}` } as never).status).toBe('refused');
    store.dispatch('layout.select', { regions: [wrapper], mode: 'replace' } as never);
    expect(store.dispatch('layout.configure', { field: 'semantic', value: 'div' } as never).status).toBe('done');
    expect(store.dispatch('layout.suggest', { suggestion: `remove-wrapper:${wrapper}` } as never).status).toBe('done');
    expect(intent(root)?.regions.filter((r) => r.box.y === 300)).toHaveLength(1);
    expect(store.dispatch('layout.suggest', { suggestion: `remove-wrapper:${wrapper}` } as never).status).toBe('refused');
  });

  it('places a template over the empty container, scaled to it, in the person\'s words', () => {
    const { store, root } = composing();
    expect(store.dispatch('layout.template', { template: 'sidebar' } as never).status).toBe('done');
    expect(intent(root)?.regions.map((r) => r.name)).toEqual(['Sidebar', 'Content']);
    expect(root().children.map((c) => c.tag)).toEqual(['aside', 'main']);
    // a container that already holds regions takes a template only inside one empty selected region
    expect(store.dispatch('layout.template', { template: 'gallery' } as never).status).toBe('refused');
  });
});

describe('Layout Composer reference image', () => {
  it('chooses a project image, sets its opacity, removes it; a path that is no project image is refused', () => {
    const { store, root } = composing(true);
    expect(store.dispatch('layout.reference', { file: 'img/missing.png' } as never).status).toBe('refused');
    expect(store.dispatch('layout.reference', { file: IMAGE.path } as never).status).toBe('done');
    expect(intent(root)?.reference).toEqual({ file: IMAGE.path, box: { x: 0, y: 0, width: 1200, height: 900 }, opacity: 0.5, locked: true });
    expect(store.dispatch('layout.reference', { opacity: '30' } as never).status).toBe('done');
    expect(intent(root)?.reference?.opacity).toBe(0.3);
    expect(store.dispatch('layout.reference', { opacity: '300' } as never).status).toBe('refused');
    expect(store.dispatch('layout.reference', { file: '' } as never).status).toBe('done');
    expect(intent(root)?.reference).toBeUndefined();
  });

  it('traces the blocks of the image as regions over it, in one undo step', () => {
    const { store, root } = composing(true);
    expect(store.dispatch('layout.trace', { luminance: null } as never).status).toBe('refused');
    store.dispatch('layout.reference', { file: IMAGE.path } as never);
    // the wireframe: a dark header band and two dark columns on white (the same blocks as the scenario's image)
    const blocks = [
      [10, 10, 230, 40],
      [10, 55, 80, 150],
      [95, 55, 230, 150],
    ];
    const values: number[] = [];
    for (let y = 0; y < 160; y += 1) for (let x = 0; x < 240; x += 1) values.push(blocks.some(([x0, y0, x1, y1]) => x >= (x0 as number) && x < (x1 as number) && y >= (y0 as number) && y < (y1 as number)) ? 0.157 : 1);
    const luminance: Luminance = { width: 240, height: 160, values };
    const before = store.getState().history.past.length;
    expect(store.dispatch('layout.trace', { luminance } as never).status).toBe('done');
    expect(store.getState().history.past.length).toBe(before + 1);
    expect((intent(root)?.regions.length ?? 0) >= 3).toBe(true);
    expect(root().children.length).toBe(intent(root)?.regions.filter((r) => r.parent === null).length);
    expect(store.dispatch('layout.trace', { luminance: { width: 2, height: 2, values: [1] } } as never).status).toBe('refused');
  });
});

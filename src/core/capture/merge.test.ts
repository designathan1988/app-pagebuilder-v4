// The widths of a captured page reconciled into one tree (core/capture/merge.ts): projected at any observed width, the
// tree gives back exactly what that width showed, and the nodes widths share are one node.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CapturedElement, CapturedNode } from '../document/captured.ts';
import { sequentialIds } from '../ports/ids.ts';
import { capturedAt } from '../render/captured.ts';
import { mergeWidths } from './merge.ts';

const HTML = 'http://www.w3.org/1999/xhtml';
let next = 0;
const element = (tag: string, attributes: Record<string, string>, children: CapturedNode[] = []): CapturedElement => ({
  kind: 'element', id: `o${next++}`, namespace: HTML, tag, attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: null, value })), children,
});
const text = (value: string): CapturedNode => ({ kind: 'text', id: `o${next++}`, value });
const page = (...body: CapturedNode[]): CapturedElement => element('html', {}, [element('head', {}, [element('title', {}, [text('Shop')])]), element('body', {}, body)]);

// a tree without its ids, to compare what two trees hold
const shape = (node: CapturedNode): unknown => node.kind === 'element'
  ? { tag: node.tag, attributes: node.attributes.map((one) => [one.name, one.value]).sort(), children: node.children.map(shape), state: node.state }
  : { kind: node.kind, value: node.value };

describe('the widths of a page merged into one tree', () => {
  it('gives back every width exactly: added, removed, reordered, restyled and retexted nodes', () => {
    const wide = page(
      element('header', { class: 'top' }, [element('nav', { class: 'links' }, [text('Shop Wallets Bags')])]),
      element('section', { id: 'hero', style: 'height: 784px' }, [text('Proven. 16 years')]),
      element('ul', { class: 'cards' }, [element('li', {}, [text('A')]), element('li', {}, [text('B')]), element('li', {}, [text('C')])]),
    );
    const narrow = page(
      element('header', { class: 'top is-mobile' }, [element('button', { class: 'menu' }, [text('Menu')])]),
      element('section', { id: 'hero', style: 'height: 520px' }, [text('Proven.')]),
      element('ul', { class: 'cards' }, [element('li', {}, [text('B')]), element('li', {}, [text('A')])]),
      element('footer', {}, [text('Only on phones')]),
    );
    const merged = mergeWidths([{ width: 390, root: narrow }, { width: 1440, root: wide }], sequentialIds('m'));
    const capture = { widths: merged.widths, root: merged.root };
    expect(merged.widths).toEqual([1440, 390]);
    expect(shape(capturedAt(capture, 1440))).toEqual(shape(wide));
    expect(shape(capturedAt(capture, 390))).toEqual(shape(narrow));
  });

  it('keeps one node for what the widths share, with its values per width', () => {
    const wide = page(element('section', { id: 'hero', class: 'hero', style: 'height: 784px' }, [text('Proven. 16 years')]));
    const narrow = page(element('section', { id: 'hero', class: 'hero hero--small', style: 'height: 520px' }, [text('Proven.')]));
    const { root } = mergeWidths([{ width: 1440, root: wide }, { width: 390, root: narrow }], sequentialIds('m'));
    const body = root.children[1] as CapturedElement;
    expect(body.children).toHaveLength(1);
    const hero = body.children[0] as CapturedElement;
    expect(hero.attributes).toContainEqual({ name: 'style', namespace: null, value: 'height: 784px' });
    expect(hero.at?.['390']?.attributes).toContainEqual({ name: 'style', namespace: null, value: 'height: 520px' });
    expect(hero.children[0]).toMatchObject({ kind: 'text', value: 'Proven. 16 years', at: { 390: { value: 'Proven.' } } });
  });

  it('marks a node only one width has as absent at the others', () => {
    const wide = page(element('p', {}, [text('Both')]));
    const narrow = page(element('button', { class: 'menu' }, [text('Menu')]), element('p', {}, [text('Both')]));
    const { root } = mergeWidths([{ width: 1440, root: wide }, { width: 834, root: narrow }], sequentialIds('m'));
    const body = root.children[1] as CapturedElement;
    expect(body.children.map((one) => (one.kind === 'element' ? one.tag : one.kind))).toEqual(['button', 'p']);
    expect(body.children[0]?.at).toEqual({ 1440: { absent: true } });
    expect(body.children[1]?.at).toBeUndefined();
  });

  it('keeps a shadow root and the state of fields and scrolled boxes per width', () => {
    const host = (scroll: number) => ({ ...element('product-card', {}), shadow: { mode: 'open' as const, children: [element('slot', {})] }, state: { scrollLeft: scroll } });
    const { root, widths } = mergeWidths([{ width: 1440, root: page(host(0)) }, { width: 390, root: page(host(240)) }], sequentialIds('m'));
    const card = (root.children[1] as CapturedElement).children[0] as CapturedElement;
    expect(card.shadow?.children[0]).toMatchObject({ kind: 'element', tag: 'slot' });
    expect(card.at?.['390']?.state).toEqual({ scrollLeft: 240 });
    expect(capturedAt({ widths, root }, 390).children[1]).toMatchObject({ children: [{ state: { scrollLeft: 240 } }] });
  });

  it('gives back every width of random pages exactly', () => {
    const tags = ['div', 'p', 'span', 'section', 'li'];
    const tree: fc.Arbitrary<CapturedNode> = fc.letrec<{ node: CapturedNode }>((tie) => ({
      node: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        fc.string({ maxLength: 4 }).map(text),
        fc.record({ tag: fc.constantFrom(...tags), cls: fc.constantFrom('', 'a', 'b', 'a b'), id: fc.constantFrom('', 'x', 'y'), children: fc.array(tie('node'), { maxLength: 4 }) })
          .map(({ tag, cls, id, children }) => element(tag, { ...(cls === '' ? {} : { class: cls }), ...(id === '' ? {} : { id }) }, children)),
      ),
    })).node;
    fc.assert(fc.property(fc.array(fc.array(tree, { maxLength: 5 }), { minLength: 2, maxLength: 4 }), (bodies) => {
      const observations = bodies.map((body, index) => ({ width: 1440 - index * 300, root: page(...body) }));
      const { widths, root } = mergeWidths(observations, sequentialIds('m'));
      for (const observation of observations) expect(shape(capturedAt({ widths, root }, observation.width))).toEqual(shape(observation.root));
    }), { seed: 4111, numRuns: 300 });
  });
});

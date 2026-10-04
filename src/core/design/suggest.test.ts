// Repeated styles offered as one class (src/core/design/suggest.ts, spec style-suggestions).
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { suggestedName, suggestionsOf } from './suggest.ts';

const PAD = { 'padding-top': '56px', 'padding-left': '40px' };
const node = (id: string, type: string, base: Record<string, string>): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag: type, attributes: {}, classes: [], styles: { desktop: { base } } as DocNode['styles'], text: null, children: [] });
const project = (children: readonly DocNode[]): DocumentJson => ({ version: 2, pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: { ...node('Page', 'page', {}), tag: 'body', children: [...children] } }] });

describe('style suggestions', () => {
  it('offers what every element of a type repeats, and nothing it does not', () => {
    const found = suggestionsOf(project([node('A', 'section', { ...PAD, color: '#111111' }), node('B', 'section', { ...PAD, color: '#222222' }), node('C', 'paragraph', PAD)]));
    expect(found).toEqual([{ type: 'section', nodes: ['A', 'B'], declarations: PAD }]);
  });
  it('offers nothing for a lone element or when one element differs', () => {
    expect(suggestionsOf(project([node('A', 'section', PAD)]))).toEqual([]);
    expect(suggestionsOf(project([node('A', 'section', PAD), node('B', 'section', { 'padding-top': '8px' })]))).toEqual([]);
  });
  it('names the class after the type, the first free name', () => {
    expect(suggestedName({ ...project([]), classes: [{ name: 'section', styles: {} }] }, 'section')).toBe('section-2');
  });
});

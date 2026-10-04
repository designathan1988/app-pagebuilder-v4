// Family LK2 of the code audit (2026-10-04, second reading): components.fillFromData asked only whether the parent of
// the items was locked, so an item that was itself locked (or held a locked element) was rewritten with its row.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { fillFromDataCommand } from './components.ts';

const base64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const TREE = node('Item', 'div', 'div', { children: [node('Nome', 'heading', 'h3', { text: 'Nome' })] });
const instance = (id: string, locked: boolean) => ({ ...TREE, id: id as NodeId, component: 'Item', componentPart: [], ...(locked ? { locked: true as const } : {}), children: [{ ...TREE.children[0], id: `${id}-0` as NodeId, componentPart: [0] }] }) as never;
const doc = () =>
  documentOf({
    components: [{ name: 'Item', tree: TREE }] as never,
    files: [{ path: 'data/list.csv', type: 'text/csv', bytes: base64('nome\nUm\nDois\n') }],
    pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Grid', 'div', 'div', { children: [instance('A', false), instance('B', true)] })] }) }],
  });

describe('a fill from data never rewrites a locked item (LK2)', () => {
  it('refuses when an item it would rewrite is locked', () => {
    const ran = runHandler(fillFromDataCommand, doc(), { path: 'data/list.csv' }, { selection: ['A'] });
    expect(ran.outcome.kind).toBe('refused');
  });
});

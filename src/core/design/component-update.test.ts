// Family CS1 of the code audit (2026-10-04): Update component rebuilds every instance on the edited one, keeping each
// instance's own text and attributes where its element of the same part stands. A pasted or duplicated part keeps its
// part, so an element of another type stood at that part, and its text was given to the rebuilt element (the invariant
// probe, seed 4606: "a paragraph holds its text"), refusing the update.
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { updateFromInstanceCommand } from './components.ts';

describe('Update component keeps values of the same element only (CS1)', () => {
  it('an instance whose part is an element of another type takes the edited element whole', () => {
    const edited = node('A', 'div', 'div', { component: 'Card', componentPart: [], children: [node('A-t', 'paragraph', 'p', { text: 'Hello', componentPart: [0] })] });
    const other = node('B', 'div', 'div', { component: 'Card', componentPart: [], children: [node('B-box', 'div', 'div', { componentPart: [0] })] });
    const document = documentOf({
      pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [edited, other] }) }],
      components: [{ name: 'Card', tree: node('Def', 'div', 'div', { children: [node('Def-t', 'paragraph', 'p', { text: 'Hello' })] }) }],
    });
    const ran = runHandler(updateFromInstanceCommand, document, {}, { selection: ['A'] });
    expect(ran.problems).toEqual([]);
  });
});

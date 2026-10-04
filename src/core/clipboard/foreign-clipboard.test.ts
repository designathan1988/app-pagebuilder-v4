// Family CB1 of the code audit (2026-10-04, second reading): a paste read the editor's element format and style format
// from any clipboard text (another version of the editor, another project's breakpoints, a page that writes
// builder/elements), and what it held reached the validator only after the patches: a refused commit, which the store
// treats as a defect.
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { ELEMENTS_FORMAT, STYLES_FORMAT, pasteCommand, pasteStyleCommand } from './clipboard.ts';

const doc = () => documentOf({ pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Box', 'div', 'div')] }) }] });
const clip = (text: string) => ({ status: 'read', text, html: null }) as never;

describe('a foreign clipboard is refused before any patch (CB1)', () => {
  it('refuses elements the model refuses', () => {
    const text = JSON.stringify({ format: ELEMENTS_FORMAT, nodes: [{ type: 'nothing', name: 'X', tag: 'blink', attributes: {}, classes: [], styles: {}, text: null, children: [] }] });
    const ran = runHandler(pasteCommand, doc(), { clipboard: clip(text) }, { selection: ['Box'] });
    expect(ran.outcome.kind).toBe('refused');
  });
  it('refuses styles of a breakpoint the project does not have', () => {
    const text = JSON.stringify({ format: STYLES_FORMAT, styles: { 'no-such-screen': { base: { color: 'red' } } } });
    const ran = runHandler(pasteStyleCommand, doc(), { clipboard: clip(text) }, { selection: ['Box'] });
    expect(ran.outcome.kind).toBe('refused');
  });
});

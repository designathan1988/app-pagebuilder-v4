// Family UQ1 of the code audit (2026-10-04): an animation's @keyframes name is the document's once (one sheet holds
// every animation), so a copy takes a free name and its own interactions follow it. Duplicate, paste and a page
// duplicated kept the names: editing the copy's keyframes changed how the original moved in the export.
import { describe, expect, it } from 'vitest';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { walk } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { duplicateCommand } from '../structure/duplicate.ts';
import { duplicatePageCommand } from '../project/pages.ts';
import { pasteCommand } from '../clipboard/clipboard.ts';

const animation = { name: 'fade', settings: {}, keyframes: [{ offset: 0, easing: '', declarations: {} }, { offset: 100, easing: '', declarations: {} }] };
const animated = (): DocumentJson =>
  documentOf({ pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Card', 'div', 'div', { animations: [animation], interactions: [{ trigger: 'click', action: 'play-animation', animation: 'fade' }] })] }) }] });
const names = (document: DocumentJson): string[] => document.pages.flatMap((page) => [...walk(page.tree)].flatMap((one: DocNode) => (one.animations ?? []).map((a) => a.name)));

describe('a copy takes a free @keyframes name (UQ1)', () => {
  it('Duplicate names the copy\'s animation anew, its click following it', () => {
    const ran = runHandler(duplicateCommand, animated(), {}, { selection: ['Card'] });
    expect(new Set(names(ran.document)).size).toBe(2);
    const copy = [...walk(ran.document.pages[0]?.tree as DocNode)].find((one) => one.id !== 'Card' && one.animations !== undefined);
    expect(copy?.interactions?.[0]?.animation).toBe(copy?.animations?.[0]?.name);
  });

  it('a page duplicated names its animations anew', () => {
    const ran = runHandler(duplicatePageCommand, animated(), { page: 'home' });
    expect(new Set(names(ran.document)).size).toBe(2);
  });

  it('a pasted copy names its animations anew', () => {
    const copied = JSON.stringify({ format: 'builder/elements', nodes: [{ type: 'div', name: 'Card', tag: 'div', attributes: {}, classes: [], styles: {}, text: null, children: [], animations: [animation], copiedFrom: 'Card' }] });
    const ran = runHandler(pasteCommand, animated(), { clipboard: { status: 'read', text: copied, html: null, markup: null } });
    expect(new Set(names(ran.document)).size).toBe(2);
  });
});

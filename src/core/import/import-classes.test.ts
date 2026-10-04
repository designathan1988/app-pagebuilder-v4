// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// The code audit's B-04: a page exported and imported back keeps the project's classes.
import { describe, expect, it } from 'vitest';
import { siteFiles } from '../export/export.ts';
import { RULES, documentOf, node, runHandler } from '../testing/handlers.ts';
import { importHtmlCommand } from './import.ts';

const page = (id: string, name: string, file: string, children: ReturnType<typeof node>[] = []) => ({ id, name, file, tree: node(`${name}Root`, 'page', 'body', { children }) });
describe('export then import keeps the project’s classes (B-04)', () => {
  it('keeps a single author class on an element with no own styles through two exports', () => {
    const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    const document = documentOf({
      pages: [page('p', 'Home', 'index.html', [node('Only', 'article', 'article', { classes: ['brand'] })])],
      classes: [{ name: 'brand', styles: { desktop: { base: { color: 'red' } } } }],
    });
    const first = siteFiles(document, RULES);
    const files = [
      { name: 'index.html', type: 'text/html', bytes: base64(first.pages[0]?.html ?? '') },
      { name: 'css/styles.css', type: 'text/css', bytes: base64(first.css) },
    ];
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [page('p', 'Home', 'index.html')] }), { files }, { confirmed: true });
    expect(ran.problems).toEqual([]);
    expect(ran.document.classes?.find((one) => one.name === 'brand')?.styles.desktop?.base?.color).toBe('red');
    expect(ran.document.pages[0]?.tree.children[0]?.classes).toEqual(['brand']);
    expect(ran.document.pages[0]?.tree.children[0]?.styles).toEqual({});
    const second = siteFiles(ran.document, RULES);
    expect(second.pages[0]?.html).toBe(first.pages[0]?.html);
    expect(second.css).toBe(first.css);
  });

  it('a class two elements list comes back as a class definition, and its styles are not copied onto them', () => {
    const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    const card = (name: string) => node(name, 'article', 'article', { classes: ['card'], children: [node(`${name}Title`, 'heading', 'h3', { text: name })] });
    const document = documentOf({
      pages: [page('p', 'Home', 'index.html', [card('One'), card('Two')])],
      classes: [{ name: 'card', styles: { desktop: { base: { 'background-color': 'red' } } } }],
    });
    const site = siteFiles(document, RULES);
    const files = [
      { name: 'index.html', type: 'text/html', bytes: base64(site.pages[0]?.html ?? '') },
      { name: 'css/styles.css', type: 'text/css', bytes: base64(site.css) },
    ];
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [page('p', 'Home', 'index.html')] }), { files }, { confirmed: true });
    expect(ran.problems).toEqual([]);
    expect(ran.document.classes?.find((c) => c.name === 'card')?.styles.desktop?.base?.['background-color']).toBe('red');
    const articles = [...(ran.document.pages[0]?.tree.children ?? [])];
    expect(articles.map((a) => a.classes)).toEqual([['card'], ['card']]);
    expect(articles.map((a) => a.styles.desktop?.base?.['background-color'])).toEqual([undefined, undefined]);
  });

  // spec html-import, Problems 9: "card card--featured" on one element alone read like the class the export makes for
  // an element's own styles, and the person's variant came back as that element's values
  it('a class one element alone lists last comes back as a class, by the heading the export writes it under', () => {
    const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    const card = (name: string, classes: string[]) => node(name, 'article', 'article', { classes, children: [node(`${name}Title`, 'heading', 'h3', { text: name })] });
    const document = documentOf({
      pages: [page('p', 'Home', 'index.html', [card('One', ['card']), card('Two', ['card', 'card--featured'])])],
      classes: [
        { name: 'card', styles: { desktop: { base: { 'background-color': 'red' } } } },
        { name: 'card--featured', styles: { desktop: { base: { color: 'white' } } } },
      ],
    });
    const site = siteFiles(document, RULES);
    expect(site.css).toContain('/* Classes */\n.card {');
    const files = [
      { name: 'index.html', type: 'text/html', bytes: base64(site.pages[0]?.html ?? '') },
      { name: 'css/styles.css', type: 'text/css', bytes: base64(site.css) },
    ];
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [page('p', 'Home', 'index.html')] }), { files }, { confirmed: true });
    expect(ran.problems).toEqual([]);
    expect(ran.document.classes?.map((c) => [c.name, c.styles])).toEqual([
      ['card', { desktop: { base: { 'background-color': 'red' } } }],
      ['card--featured', { desktop: { base: { color: 'white' } } }],
    ]);
    const articles = [...(ran.document.pages[0]?.tree.children ?? [])];
    expect(articles.map((a) => a.classes)).toEqual([['card'], ['card', 'card--featured']]);
    expect(articles.map((a) => a.styles)).toEqual([{}, {}]);
    // a sheet written elsewhere, without the heading, is read as before: the last class one element lists is its own
    const elsewhere = files.map((file) => (file.name.endsWith('.css') ? { ...file, bytes: base64(site.css.replace('/* Classes */\n', '')) } : file));
    const read = runHandler(importHtmlCommand, documentOf({ pages: [page('p', 'Home', 'index.html')] }), { files: elsewhere }, { confirmed: true });
    expect(read.document.classes?.map((c) => c.name)).toEqual(['card']);
  });
});

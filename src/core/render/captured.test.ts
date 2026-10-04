// @vitest-environment happy-dom
// The written page of a captured tree (core/render/captured.ts): HTML that a parser following the HTML Standard reads
// back into the same tree (parse5, the WHATWG reference parser), what an exported page adds to its source, and the
// widest width as static HTML with a width script for the others.
import { HtmlValidate } from 'html-validate';
import fc from 'fast-check';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { describe, expect, it } from 'vitest';
import { captureTree, type CapturedElement, type CapturedNode } from '../document/captured.ts';
import { sequentialIds } from '../ports/ids.ts';
import { mergeWidths } from '../capture/merge.ts';
import { capturedAt, capturedExportHtml, capturedHtml, exportedCapturedRoot } from './captured.ts';

const HTML = 'http://www.w3.org/1999/xhtml';
const HEAD = { title: 'Captured', lang: 'en' };
let next = 0;
const element = (tag: string, attributes: Record<string, string> = {}, children: CapturedNode[] = []): CapturedElement => ({
  kind: 'element', id: `n${next++}`, namespace: HTML, tag, attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: null, value })), children,
});
const text = (value: string): CapturedNode => ({ kind: 'text', id: `n${next++}`, value });

type Parsed = DefaultTreeAdapterMap['node'];
// what a parsed document holds, in the shape of a captured tree without ids
function parsedShape(node: Parsed): unknown {
  if (node.nodeName === '#text') return { kind: 'text', value: (node as DefaultTreeAdapterMap['textNode']).value };
  if (node.nodeName === '#comment') return { kind: 'comment', value: (node as DefaultTreeAdapterMap['commentNode']).data };
  const element = node as DefaultTreeAdapterMap['element'];
  const children = element.tagName === 'template' ? (element as DefaultTreeAdapterMap['template']).content.childNodes : element.childNodes;
  return { tag: element.tagName, attributes: element.attrs.map((one) => [one.name, one.value]).sort(), children: children.map(parsedShape) };
}
const shape = (node: CapturedNode): unknown => node.kind === 'element'
  ? { tag: node.tag, attributes: node.attributes.map((one) => [one.name, one.value]).sort(), children: node.children.map(shape) }
  : { kind: node.kind, value: node.value };
const parsedRoot = (html: string): Parsed => parse(html).childNodes.find((one) => one.nodeName === 'html') as Parsed;

describe('a captured page written as HTML', () => {
  it('completes a source without language, title or mark, and the page is valid HTML', async () => {
    const root = captureTree('<!doctype html><html><head></head><body><p>Hello</p></body></html>', sequentialIds('c'));
    const html = capturedHtml(exportedCapturedRoot(root, HEAD));
    expect(html).toBe('<!DOCTYPE html>\n<html lang="en"><head><meta name="builder-capture" content="exported"><title>Captured</title></head><body><p>Hello</p></body></html>');
    const report = await new HtmlValidate({ extends: ['html-validate:recommended'] }).validateString(html);
    expect(report.results.flatMap((result) => result.messages.map((one) => one.message))).toEqual([]);
  });

  it('keeps the source’s own language, title and mark', () => {
    const source = '<!doctype html><html lang="fr"><head><meta name="builder-capture" content="exported"><title>Accueil</title></head><body></body></html>';
    const html = capturedHtml(exportedCapturedRoot(captureTree(source, sequentialIds('c')), HEAD));
    expect(html).toBe('<!DOCTYPE html>\n<html lang="fr"><head><meta name="builder-capture" content="exported"><title>Accueil</title></head><body></body></html>');
  });

  // A captured element that acts on the page instead of drawing: a refresh (sites put one in <noscript>, whose content
  // the editor's parser reads as elements), a <base>, an object whose data is a script address (document/captured.ts).
  it('never writes a refresh, a base or a script address a saved page holds', () => {
    const saved = element('html', {}, [element('head', {}, [
      element('meta', { 'http-equiv': 'refresh', content: '0' }),
      element('base', { href: 'https://elsewhere.test/' }),
    ])]);
    expect(capturedHtml(saved)).toBe('<!DOCTYPE html>\n<html><head></head></html>');
  });

  // allbirds: a script had put a <div> in <head>; written there, it ended the head, and the parser sent the 587 links
  // after it into the body (the project's body held 597 head nodes before its content).
  it('leaves out of <head> what would end it, so the head and the body parse back as they were', () => {
    const root = element('html', {}, [
      element('head', {}, [element('title', {}, [text('Shop')]), element('div', { id: 'portal' }), text('stray'), element('link', { rel: 'stylesheet', href: 'css/a.css' }), element('link', { rel: 'preconnect', href: 'https://cdn.test' })]),
      element('body', {}, [element('main', {}, [text('Wallets')])]),
    ]);
    const parsed = parsedRoot(capturedHtml(root)) as DefaultTreeAdapterMap['element'];
    const [head, body] = parsed.childNodes as DefaultTreeAdapterMap['element'][];
    expect(head?.childNodes.map((one) => one.nodeName)).toEqual(['title', 'link', 'link']);
    expect(body?.childNodes.map((one) => one.nodeName)).toEqual(['main']);
  });

  it('parses back into the same tree, for random bodies', () => {
    const tags = ['div', 'span', 'section', 'article', 'em', 'strong'];
    const node: fc.Arbitrary<CapturedNode> = fc.letrec<{ node: CapturedNode }>((tie) => ({
      node: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        fc.string({ minLength: 1, maxLength: 6 }).filter((value) => !value.includes('\r') && !value.includes('\0')).map(text),
        fc.record({ tag: fc.constantFrom(...tags), title: fc.string({ maxLength: 5 }).filter((value) => !value.includes('\r') && !value.includes('\0')), children: fc.array(tie('node'), { maxLength: 3 }) })
          .map(({ tag, title, children }) => element(tag, title === '' ? {} : { title }, children)),
      ),
    })).node;
    fc.assert(fc.property(fc.array(node, { maxLength: 5 }), (body) => {
      // adjacent text nodes are one text node to a parser: the generated bodies keep them apart with an element
      const separated = body.flatMap((one, index) => (index > 0 && one.kind === 'text' && body[index - 1]?.kind === 'text' ? [element('br'), one] : [one]));
      const root = element('html', {}, [element('head', {}, []), element('body', {}, separated)]);
      const parsed = parsedShape(parsedRoot(capturedHtml(root)));
      const expected = shape(root);
      // text inside elements may meet another text node only when the generator nested two; compare normalized
      expect(JSON.stringify(parsed).replaceAll('"},{"kind":"text","value":"', '')).toBe(JSON.stringify(expected).replaceAll('"},{"kind":"text","value":"', ''));
    }), { seed: 4112, numRuns: 300 });
  });

  it('writes an open shadow root as a declarative shadow root, first in its host', () => {
    const host = { ...element('product-card', { class: 'card' }, [text('light')]), shadow: { mode: 'open' as const, children: [element('slot'), element('style', {}, [text(':host{display:block}')])] } };
    const html = capturedHtml(element('html', {}, [element('head'), element('body', {}, [host])]));
    expect(html).toContain('<product-card class="card"><template shadowrootmode="open"><slot></slot><style>:host{display:block}</style></template>light</product-card>');
  });

  it('writes a field’s value, checked state and selection as the attributes that show them', () => {
    const input = { ...element('input', { type: 'text', value: 'old' }), state: { value: 'typed' } };
    const box = { ...element('input', { type: 'checkbox' }), state: { checked: true } };
    const area = { ...element('textarea', {}, [text('default')]), state: { value: 'written' } };
    const option = { ...element('option', {}, [text('B')]), state: { selected: true } };
    const html = capturedHtml(element('html', {}, [element('head'), element('body', {}, [input, box, area, element('select', {}, [option])])]));
    expect(html).toContain('<input type="text" value="typed">');
    expect(html).toContain('<input type="checkbox" checked="">');
    expect(html).toContain('<textarea>written</textarea>');
    expect(html).toContain('<option selected="">B</option>');
  });
});

describe('the exported file of a captured page', () => {
  const pageOf = (...body: CapturedNode[]) => element('html', {}, [element('head', {}, [element('title', {}, [text('Shop')])]), element('body', {}, body)]);

  it('is the page as written when one width was observed, with no width script', () => {
    const root = pageOf(element('p', {}, [text('One width')]));
    const html = capturedExportHtml({ widths: [1440], root }, HEAD);
    expect(html).not.toContain('<script>');
    expect(html).toContain('<p>One width</p>');
  });

  it('is the widest width as static HTML, with a script holding the other widths', () => {
    const wide = pageOf(element('nav', { class: 'links' }, [text('Shop Wallets')]), element('section', { id: 'hero', style: 'height: 784px' }, [text('Proven')]));
    const narrow = pageOf(element('button', { class: 'menu' }, [text('Menu')]), element('section', { id: 'hero', style: 'height: 520px' }, [text('Proven')]));
    const capture = mergeWidths([{ width: 1440, root: wide }, { width: 390, root: narrow }], sequentialIds('w'));
    const html = capturedExportHtml(capture, HEAD);
    const staticPart = html.slice(0, html.indexOf('<script>'));
    // seen without scripts: the widest width
    expect(staticPart).toContain('<nav class="links"');
    expect(staticPart).not.toContain('Menu');
    expect(staticPart).toMatch(/<section id="hero" style="height: 784px" data-capture-node="[^"]+">/);
    // the other width, held by the script
    expect(html).toContain('height: 520px');
    expect(html).toContain('Menu');
    expect(html.indexOf('<script>')).toBeLessThan(html.lastIndexOf('</body>'));
    // its static page parses back into the widest projection (marks aside)
    const parsed = JSON.stringify(parsedShape(parsedRoot(html.replace(/<script>[\s\S]*?<\/script>/g, '')))).replace(/,\["data-capture-node","[^"]+"\]|\["data-capture-node","[^"]+"\],?/g, '');
    expect(parsed).toBe(JSON.stringify(shape(exportedCapturedRoot(capturedAt(capture, 1440), HEAD))));
  });
});

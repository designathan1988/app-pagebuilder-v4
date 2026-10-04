// @vitest-environment happy-dom
// What an exported captured page adds to its source: the page's language, a title and the capture mark, never what
// the source already holds (core/render/captured.ts exportedCapturedRoot, spec capture-url).
import { HtmlValidate } from 'html-validate';
import { expect, it } from 'vitest';
import { captureTree } from '../document/captured.ts';
import { sequentialIds } from '../ports/ids.ts';
import { capturedHtml, capturedResponsiveHtml, exportedCapturedRoot } from './captured.ts';

const HEAD = { title: 'Captured', lang: 'en' };

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

it('gives the page of several observed widths the first width’s language and title', () => {
  const ids = sequentialIds('c');
  const wide = captureTree('<!doctype html><html lang="pt-BR"><head><title>Loja</title></head><body>wide</body></html>', ids);
  const narrow = captureTree('<!doctype html><html lang="pt-BR"><head><title>Loja</title></head><body>narrow</body></html>', ids);
  const html = capturedResponsiveHtml({ viewports: [{ width: 1440, root: wide }, { width: 390, root: narrow }] }, HEAD);
  expect(html.startsWith('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="builder-capture" content="exported variants"><title>Loja</title><script>')).toBe(true);
});

// A captured element that acts on the page instead of drawing: a refresh (sites put one in <noscript>, whose content
// the editor's parser reads as elements), a <base>, an object whose data is a script address (document/captured.ts).
it('leaves out a refresh, a base and a script address from a new capture, and never writes one a saved page holds', () => {
  const source = '<!doctype html><html><head><base href="https://elsewhere.test/"><meta http-equiv="refresh" content="0; url=/nojs"></head><body><noscript><meta http-equiv="refresh" content="0; url=/nojs"></noscript><object data="javascript:alert(1)"></object><p>Kept</p></body></html>';
  const html = capturedHtml(captureTree(source, sequentialIds('c')));
  expect(html).not.toMatch(/<base|http-equiv|javascript:/);
  expect(html).toContain('<p>Kept</p>');
  const saved = { kind: 'element', id: 'r', namespace: 'http://www.w3.org/1999/xhtml', tag: 'html', attributes: [], children: [
    { kind: 'element', id: 'h', namespace: 'http://www.w3.org/1999/xhtml', tag: 'head', attributes: [], children: [
      { kind: 'element', id: 'm', namespace: 'http://www.w3.org/1999/xhtml', tag: 'meta', attributes: [{ name: 'http-equiv', namespace: null, value: 'refresh' }, { name: 'content', namespace: null, value: '0' }], children: [] },
      { kind: 'element', id: 'b', namespace: 'http://www.w3.org/1999/xhtml', tag: 'base', attributes: [{ name: 'href', namespace: null, value: 'https://elsewhere.test/' }], children: [] },
    ] },
  ] } as const;
  expect(capturedHtml(saved)).toBe('<!DOCTYPE html>\n<html><head></head></html>');
});

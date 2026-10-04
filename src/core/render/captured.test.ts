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

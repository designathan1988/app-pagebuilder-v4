// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// An imported <svg> keeps its size and its drawing's coordinates (the audit's AUD-15: the MDN logo came in as an empty
// box). Its width and height attributes are presentation attributes (SVG 2, "Presentation attributes": CSS properties
// of specificity zero, before every rule of the author), so they become its size unless a rule of the sheets sets one;
// a viewBox other than its own size keeps the drawing's coordinates in an svg of its own inside, filling it.
import { describe, expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import type { DocNode } from '../document/model.ts';
import { walk } from '../document/model.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
import { importHtmlCommand } from './import.ts';

const file = (name: string, type: string, text: string): PickedFile => {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return { name, type, bytes: btoa(binary) };
};

function svgOf(body: string, sheet = ''): DocNode {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="css/site.css"></head><body>${body}</body></html>`;
  const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', html), file('css/site.css', 'text/css', sheet)] }, { confirmed: true });
  if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
  expect(ran.problems).toEqual([]);
  const svg = [...walk(ran.document.pages[0]?.tree as DocNode)].find((node) => node.type === 'svg');
  if (svg === undefined) throw new Error('no svg imported');
  return svg;
}
const base = (node: DocNode) => (node.styles as Record<string, Record<string, Record<string, string>>>).desktop?.base ?? {};
const markup = (node: DocNode) => String((node.attributes as Record<string, unknown>).svgMarkup ?? '');
const LOGO = '<path class="logo__letter" d="M9.4 0 2.81 21.17H.12L6.69 0H9.4Z"/>';

describe('an imported svg', () => {
  it('takes the size its width and height attributes give it, its drawing as it was', () => {
    const svg = svgOf(`<svg class="logo" width="83" height="24" viewBox="0 0 83 24" role="img">${LOGO}</svg>`);
    expect(base(svg).width).toBe('83px');
    expect(base(svg).height).toBe('24px');
    // the viewBox is its own size: the svg writes it again from the size (core/elements/svg.ts viewBoxOf)
    expect(markup(svg)).not.toContain('<svg');
    expect(markup(svg)).toContain('class="logo__letter"');
  });

  it('lets a rule of the sheets win over its width and height attributes', () => {
    const svg = svgOf(`<svg class="logo" width="83" height="24" viewBox="0 0 83 24">${LOGO}</svg>`, '.logo { width: 120px; }');
    expect(base(svg).width).toBe('120px');
    expect(base(svg).height).toBe('24px');
  });

  it('keeps a viewBox other than its own size in an svg of its own that fills it', () => {
    const svg = svgOf(`<svg width="24" height="24" viewBox="0 0 48 48" preserveAspectRatio="xMinYMin meet">${LOGO}</svg>`);
    expect(base(svg).width).toBe('24px');
    expect(markup(svg)).toContain('<svg viewBox="0 0 48 48" width="100%" height="100%" preserveAspectRatio="xMinYMin meet">');
    expect(markup(svg)).toContain('class="logo__letter"');
  });

  it('keeps SVG text containing an escaped angle bracket', () => {
    const svg = svgOf('<svg width="48" height="48" viewBox="0 0 48 48"><text><textPath>&lt;&gt;</textPath></text></svg>');
    expect(markup(svg)).toContain('<textPath>&lt;&gt;</textPath>');
  });

  it('keeps the intrinsic ratio of a viewBox when the stylesheet sets only the height', () => {
    const svg = svgOf('<div class="mandala"><svg viewBox="50 50 575 575"><path d="M50 50H625V625H50Z"/></svg></div>', '.mandala svg { height: 560px; }');
    expect(base(svg).height).toBe('560px');
    expect(base(svg)['aspect-ratio']).toBe('575 / 575');
  });
});

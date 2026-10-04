// Family S1 of the code audit (2026-10-04, second reading): markup kept by the editor never acts on its own. An SVG's
// markup is written inline in the exported page, where the HTML parser reads it: an HTML start tag such as <p>, <img>
// or <font> ends the SVG (the HTML Standard's rules for parsing tokens in foreign content), so an <iframe src> or a
// <form action> after it was a real HTML element; and a character reference (java&#115;cript:) is decoded before the
// address runs, so testing the raw text let it through.
import { describe, expect, it } from 'vitest';
import type { DocNode } from '../document/model.ts';
import { sanitizedSvgMarkup, svgMarkupOf } from './svg.ts';

const kept = (text: string): string => {
  const read = sanitizedSvgMarkup(text);
  return 'markup' in read ? read.markup : '';
};

describe('an SVG keeps only SVG elements and no address that runs code (S1)', () => {
  it('drops an HTML element with what it holds, so nothing leaves the SVG', () => {
    const markup = kept('<p/><iframe src="javascript:alert(1)"></iframe><img src="x" /><circle r="2"/>');
    expect(markup).toBe('<circle r="2"/>');
  });
  it('drops an address that runs code written with character references', () => {
    expect(kept('<a href="java&#115;cript:alert(1)"><text>a</text></a>')).toBe('<a><text>a</text></a>');
    expect(kept('<a href="javascript&colon;alert(1)"><text>a</text></a>')).toBe('<a><text>a</text></a>');
    expect(kept('<a xlink:href="&#x6A;avascript:alert(1)"><text>a</text></a>')).toBe('<a><text>a</text></a>');
    expect(kept('<a href="java&Tab;script:alert(1)"><text>a</text></a>')).toBe('<a><text>a</text></a>');
  });
  it('writes stored markup to a page only through the sanitizer (a project file is read as it was saved)', () => {
    const node = { id: 'n', type: 'svg', name: 'SVG', tag: 'svg', attributes: { svgMarkup: '<p/><iframe src="javascript:alert(1)"></iframe><circle r="2"/>' }, classes: [], styles: {}, text: null, children: [] } as unknown as DocNode;
    expect(svgMarkupOf(node)).toBe('<circle r="2"/>');
  });
  it('keeps the SVG elements of a drawing as they are written', () => {
    const drawing = '<defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><g><path d="M0 0"/><use href="#g"/><feGaussianBlur stdDeviation="2"/></g>';
    expect(kept(drawing)).toBe(drawing);
  });
});

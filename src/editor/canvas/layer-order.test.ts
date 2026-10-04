// Family CL1 of the code audit (2026-10-04, second reading): the canvas reads the border width a page declares by its
// cascade, layers included, but numbered the layers in the order their blocks appear, ignoring a layer statement
// (@layer a, b;), which sets their order too (CSS Cascade 5): with "@layer b, a;" first and a's block before b's, the
// width of the losing layer was read.
import { describe, expect, it } from 'vitest';
import { declaredWidth } from './coordinates.ts';

class CSSLayerStatementRule { constructor(readonly nameList: readonly string[]) {} }
class CSSLayerBlockRule { constructor(readonly name: string, readonly cssRules: readonly unknown[]) {} }
class CSSStyleRule {
  readonly style: { getPropertyValue: () => string; getPropertyPriority: () => string };
  constructor(readonly selectorText: string, width: string) {
    this.style = { getPropertyValue: () => width, getPropertyPriority: () => '' };
  }
}

describe('the cascade layers keep the order their statement gives (CL1)', () => {
  it('reads the width of the layer the statement puts last', () => {
    const view = { matchMedia: () => ({ matches: true }), CSS: { supports: () => true }, HTMLElement: class { readonly unused = true; } };
    const sheet = { cssRules: [
      new CSSLayerStatementRule(['b', 'a']),
      new CSSLayerBlockRule('a', [new CSSStyleRule('div', '7px')]),
      new CSSLayerBlockRule('b', [new CSSStyleRule('div', '3px')]),
    ] };
    const owner = { defaultView: view, styleSheets: [sheet] };
    const element = { ownerDocument: owner, matches: () => true } as unknown as Element;
    expect(declaredWidth(element, 'border-top-width')).toBe('7px');
  });
});

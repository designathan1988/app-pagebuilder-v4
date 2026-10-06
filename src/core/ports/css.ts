// The CSS support port: whether the browser takes a value for a property. The core has no browser; a handler that
// writes a value a person typed (style.set, the number fields) asks this port before it writes, so the browser is the
// truth of what a value means (a value the browser does not act on is never written).
// The editor gives the browser's own answer (src/editor/css-support.ts, CSS.supports); tests pass the answer they
// choose.

export interface CssSupport {
  // whether the browser parses `value` as a value of `property`
  supports(property: string, value: string): boolean;
}

// A browser that takes every value: the store's default when no browser answers (the core's own tests).
export const anyCss: CssSupport = {
  supports: () => true,
};

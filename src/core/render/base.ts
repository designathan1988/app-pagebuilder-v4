// The project's base style (spec base-style; the user's real-use audit, item 2.4): the rules every page starts from —
// the heading ladder (h1 32 px down to h6 14 px, the browser's own top two steps and a step between each below them),
// border-box sizing, so a height or a width the person sets is the size the element takes on screen, padding and
// border included, and a hero at 100vh measures the screen. One owner: the editor's canvas writes it into the page's
// document before every other rule (editor/canvas/render/render.ts) and every exported stylesheet carries it at its
// head (core/export/export.ts), so what the canvas shows is what the site does. A list keeps the browser's own indent
// (its
// rule once narrowed it to 1.5rem, and a list nested in an item then indented 24 px where the browser indents 40:
// spec elements-lists, Problems in Pager 6, "no style of the editor's own").
//
// A neutral starting point for page content belongs here, not in each node's stored styles. All presentation rules
// use :where() so a class or an element's own declaration wins without extra specificity.
// A function, not a constant: the tooth proof switches a module off by stubbing its exports (tools/runner/
// tooth-plugin.ts), and only a function can be stubbed.
export function baseCss(): string {
  return `*, *::before, *::after { box-sizing: border-box; }
:where(body) { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 16px; line-height: 1.5; }
:where(h1, h2, h3, h4, h5, h6) { margin: 0 0 0.6em; font-weight: 700; line-height: normal; }
:where(h1) { font-size: 2rem; }
:where(h2) { font-size: 1.5rem; }
:where(h3) { font-size: 1.25rem; }
:where(h4) { font-size: 1.125rem; }
:where(h5) { font-size: 1rem; }
:where(h6) { font-size: 0.875rem; }
:where(p, ul, ol, dl) { margin: 0 0 1rem; }
:where(a) { color: #2563eb; text-decoration-thickness: 1px; text-underline-offset: 2px; }
:where(blockquote) { margin: 0 0 1rem; padding: 0.75rem 1rem; border-inline-start: 3px solid #cbd5e1; background: #f8fafc; color: #475569; }
:where(pre) { max-width: 100%; margin: 0 0 1rem; padding: 1rem; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; }
:where(pre, code, kbd, samp) { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; }
:where(hr) { margin: 1.5rem 0; border: 0; border-top: 1px solid #cbd5e1; }
:where(table) { width: 100%; margin: 0 0 1rem; border-collapse: collapse; }
:where(th, td) { padding: 0.625rem 0.75rem; border: 1px solid #e2e8f0; text-align: start; }
:where(th) { background: #f8fafc; font-weight: 600; }
:where(figure) { margin: 0 0 1rem; }
:where(figcaption) { margin-top: 0.5rem; color: #64748b; font-size: 0.875rem; }
:where(img, video) { max-width: 100%; height: auto; }
:where(button, input, select, textarea) { font: inherit; color: inherit; }
:where(button, input[type="button"], input[type="submit"], input[type="reset"]) { padding: 0.625rem 1rem; border: 1px solid #cbd5e1; border-radius: 6px; background: #f1f5f9; cursor: pointer; }
:where([role="tab"][aria-selected="true"]) { background: #dbeafe; border-color: #93c5fd; }
:where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="image"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select) { max-width: 100%; min-height: 2.5rem; padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; }
:where(button, input, select, textarea):focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
:where(fieldset) { margin: 0 0 1rem; padding: 1rem; border: 1px solid #cbd5e1; border-radius: 6px; }
:where(legend) { padding-inline: 0.25rem; font-weight: 600; }
`;
}

// A captured site's own cascade layers must outrank the Builder's neutral starting rules. This layer is declared
// before the captured sheet's layers by its residual CSS, including when that sheet loads before the export CSS.
export const CAPTURE_BASE_LAYER = '__builder_base';
export function capturedBaseCss(): string {
  return `@layer ${CAPTURE_BASE_LAYER} {\n${baseCss()}}\n`;
}

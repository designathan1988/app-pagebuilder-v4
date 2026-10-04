// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// A captured page keeps what the model does not hold of its sheets (spec capture-url): the import maps what it can into
// classes and values, and the rest — a selector it does not read, an at-rule, a declaration the editor does not store —
// goes into the page's residual stylesheet, its addresses written from where that sheet is. A page that is no capture
// keeps no residual.
import { describe, expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
import { capturedPageCss } from './capture-styles.ts';
import { importHtmlCommand } from './import.ts';

const file = (name: string, type: string, text: string): PickedFile => {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return { name, type, bytes: btoa(binary) };
};
const SHEET = [
  '.brand { color: #f5e6d3; --accent: #b9512a; }',
  'nav a:hover > span { color: red; }',
  '@font-face { font-family: Serif; src: url("../fonts/serif.woff2"); }',
  '@media (prefers-color-scheme: dark) { .brand { color: white; } }',
].join('\n');
const page = (meta: string) => `<!doctype html><html><head>${meta}<link rel="stylesheet" href="css/site.css"></head><body><h1 class="brand">Hi</h1><nav><a href="/"><span>x</span></a></nav></body></html>`;

function imported(meta: string) {
  const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', page(meta)), file('css/site.css', 'text/css', SHEET)] }, { confirmed: true });
  if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
  expect(ran.problems).toEqual([]);
  return ran.document;
}

describe('the residual stylesheet of a captured page', () => {
  it('keeps the selectors, at-rules and declarations the model does not hold, and nothing it maps', () => {
    const document = imported('<meta name="builder-capture" content="https://example.com/">');
    const home = document.pages[0];
    if (home === undefined) throw new Error('no page');
    const css = capturedPageCss(document, home);
    expect(css).toContain('nav a:hover>span{color:red}');
    expect(css).toContain('--accent: #b9512a');
    expect(css).toContain('@font-face');
    expect(css).toContain('url(fonts/serif.woff2)');
    expect(css).toContain('@media (prefers-color-scheme:dark)');
    // the mapped declaration is the class's, not the residual's
    expect(css).not.toContain('color:#f5e6d3');
  });

  it('is not written for a page that is no capture', () => {
    const document = imported('');
    const home = document.pages[0];
    if (home === undefined) throw new Error('no page');
    expect(capturedPageCss(document, home)).toBe('');
  });
  it('keeps an author universal reset for every captured element', () => {
    const markup = '<!doctype html><html><head><meta name="builder-capture" content="https://example.com/"><style>*,:before{box-sizing:border-box}</style></head><body><div>Card</div></body></html>';
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', markup)] }, { confirmed: true });
    if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
    const home = ran.document.pages[0];
    if (home === undefined) throw new Error('no page');
    expect(capturedPageCss(ran.document, home)).toContain('*{box-sizing:border-box}');
  });

  it('keeps rules targeting the drawing inside an opaque SVG', () => {
    const markup = '<!doctype html><html><head><meta name="builder-capture" content="https://example.com/"><style>.mandala svg > text { fill: #51565d; }</style></head><body><div class="mandala"><svg viewBox="0 0 10 10"><text>x</text></svg></div></body></html>';
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', markup)] }, { confirmed: true });
    if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
    const home = ran.document.pages[0];
    if (home === undefined) throw new Error('no page');
    expect(capturedPageCss(ran.document, home)).toContain('svg>text{fill:#51565d}');
  });
});

describe('a state an element does not take', () => {
  it('is reported, and the import stays a valid document', () => {
    const markup = '<!doctype html><html><head><style>a:visited { color: red; }</style></head><body><a href="https://example.com/"><div>Card</div></a></body></html>';
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', markup)] }, { confirmed: true });
    expect(ran.outcome.kind).toBe('change');
    expect(ran.problems).toEqual([]);
  });
});

describe('what the importer keeps of a page', () => {
  const run = (markup: string) => {
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', markup)] }, { confirmed: true });
    if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
    expect(ran.problems).toEqual([]);
    return ran.document.pages[0]?.tree;
  };
  it('keeps what an unknown element holds, in its place', () => {
    const tree = run('<!doctype html><html><body><main><x-card><p>Kept</p></x-card></main></body></html>');
    expect(JSON.stringify(tree)).toContain('"text":"Kept"');
  });
  it('keeps images inside an unstyled inline wrapper', () => {
    const tree = run('<!doctype html><html><body><div><span><img src="shoe.png" alt="Shoe"><img src="shoe-hover.png" alt="Hover"></span></div></body></html>');
    const container = tree?.children[0];
    expect(container?.children.map((child) => child.type)).toEqual(['image', 'image']);
    expect(container?.children.map((child) => child.attributes)).toEqual([
      expect.objectContaining({ src: 'shoe.png', alt: 'Shoe' }),
      expect.objectContaining({ src: 'shoe-hover.png', alt: 'Hover' }),
    ]);
  });
  it('keeps a visual link inside an unstyled inline wrapper', () => {
    const tree = run('<!doctype html><html><body><div><span><a href="https://example.com/"><img src="logo.svg" alt="Logo"></a></span></div></body></html>');
    const container = tree?.children[0];
    expect(container?.children.map((child) => child.type)).toEqual(['linkBlock']);
    expect(container?.children[0]?.children.map((child) => child.type)).toEqual(['image']);
  });
  it('takes the hidden attribute as the element hidden', () => {
    const tree = run('<!doctype html><html><body><div hidden><p>Closed</p></div></body></html>');
    expect(tree?.children[0]?.hidden).toBe(true);
  });
  it('ranks a class above any number of types, as CSS does', () => {
    const tree = run('<!doctype html><html><head><style>.lead { color: rgb(1, 2, 3); } main p { color: rgb(9, 9, 9); }</style></head><body><main><p class="lead">A</p></main></body></html>');
    expect(JSON.stringify(tree)).toContain('rgb(1, 2, 3)');
    expect(JSON.stringify(tree)).not.toContain('rgb(9, 9, 9)');
  });
  it('matches a descendant rule on a class the element’s own rule took', () => {
    const tree = run('<!doctype html><html><head><style>.box { padding: 4px; } .box p { color: rgb(4, 5, 6); }</style></head><body><div class="box"><p>B</p></div></body></html>');
    expect(JSON.stringify(tree)).toContain('rgb(4, 5, 6)');
  });
  it('lets an important author class beat a less important element rule', () => {
    const markup = '<!doctype html><html><head><style>.VPNav{top:72px!important}.VPNav.nav-bar.stick{top:0}</style></head><body><header class="VPNav nav-bar stick">Navigation</header></body></html>';
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', markup)] }, { confirmed: true });
    if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
    const header = ran.document.pages[0]?.tree.children[0];
    expect(header?.classes).toContain('VPNav');
    expect(ran.document.classes?.find((one) => one.name === 'VPNav')?.styles.desktop?.base?.top).toBe('72px');
    expect(header?.styles.desktop?.base?.top).toBeUndefined();
  });
});

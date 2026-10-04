// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// A captured page's variable that its sheets define again under a condition (MDN: :root { --bg: … } then
// @supports (color: light-dark(red, red)) { :root { --bg: light-dark(…) } }) is no project token: written in the
// project's stylesheet, which the page links after its residual one, its first value would win over the condition the
// site wrote after it, and a dark header came out light (the capture corpus). It stays in the residual stylesheet,
// whose order is the site's. A page that is no capture keeps its tokens.
import { describe, expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
import { capturedPageCss } from './capture-styles.ts';
import { importHtmlCommand } from './import.ts';

const file = (name: string, type: string, text: string): PickedFile => ({ name, type, bytes: btoa(text) });
const SHEET = ':root { --bg: #ffffff; --ink: #111111; }\n@supports (color: light-dark(red, red)) { :root { --bg: light-dark(#ffffff, #1b1b1b); } }\nbody { background: var(--bg); color: var(--ink); }';

function imported(meta: string) {
  const html = `<!doctype html><html><head>${meta}<link rel="stylesheet" href="css/site.css"></head><body><h1>Hi</h1></body></html>`;
  const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', html), file('css/site.css', 'text/css', SHEET)] }, { confirmed: true });
  if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
  return ran.document;
}
const tokenNames = (document: ReturnType<typeof imported>) => (document.tokens ?? []).map((token) => token.name).sort();

describe('the variables of a captured page', () => {
  it('leaves a variable its sheets define again under a condition to the residual stylesheet', () => {
    const document = imported('<meta name="builder-capture" content="https://example.com/">');
    expect(tokenNames(document)).toEqual(['ink']);
    const css = capturedPageCss(document, document.pages[0] as never);
    expect(css).toContain('--bg');
    expect(css).toContain('light-dark(');
  });

  it('keeps every variable as a token on a page that is no capture', () => {
    expect(tokenNames(imported(''))).toEqual(['bg', 'ink']);
  });

  it('keeps a root variable rewritten on html after the source default', () => {
    const html = '<!doctype html><html><head><meta name="builder-capture" content="https://example.com/"><style>:root{--sk-banner-height:0px}</style><style>html{--sk-banner-height:4.2rem}</style></head><body><div class="banner">Summit</div></body></html>';
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', html)] }, { confirmed: true });
    if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
    expect((ran.document.tokens ?? []).map((token) => token.name)).not.toContain('sk-banner-height');
    const home = ran.document.pages[0];
    if (home === undefined) throw new Error('no page');
    expect(capturedPageCss(ran.document, home)).toContain('html{--sk-banner-height:4.2rem}');
  });
});

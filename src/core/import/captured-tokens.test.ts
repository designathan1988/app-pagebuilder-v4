// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// A format-3 captured page keeps the source sheet intact, including conditional variables. It does not
// publish its variables as later project tokens that could override the author's own cascade.
import { describe, expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import { documentOf, runHandler } from '../testing/handlers.ts';
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
  it('keeps both default and conditional variables in the same source sheet', () => {
    const document = imported('<meta name="builder-capture" content="https://example.com/">');
    expect(tokenNames(document)).toEqual([]);
    const sheet = document.files?.find((one) => one.path === 'css/site.css');
    const css = new TextDecoder().decode(Uint8Array.from(atob(sheet?.bytes ?? ''), (character) => character.charCodeAt(0)));
    expect(css).toBe(SHEET);
    expect(css).toContain('--bg');
    expect(css).toContain('--ink');
    expect(css).toContain('light-dark(');
    expect(document.pages[0]?.tree.children).toHaveLength(0);
  });

  it('keeps every variable as a token on a page that is no capture', () => {
    expect(tokenNames(imported(''))).toEqual(['bg', 'ink']);
  });

  it('keeps root variable declarations in their original sheet order', () => {
    const html = '<!doctype html><html><head><meta name="builder-capture" content="https://example.com/"><style>:root{--sk-banner-height:0px}</style><style>html{--sk-banner-height:4.2rem}</style></head><body><div class="banner">Summit</div></body></html>';
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files: [file('index.html', 'text/html', html)] }, { confirmed: true });
    if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
    expect((ran.document.tokens ?? []).map((token) => token.name)).not.toContain('sk-banner-height');
    const home = ran.document.pages[0];
    if (home === undefined) throw new Error('no page');
    const head = home.capture?.root.children.find((one) => one.kind === 'element' && one.tag === 'head');
    const styles = head?.kind === 'element' ? head.children.filter((one) => one.kind === 'element' && one.tag === 'style') : [];
    expect(styles).toHaveLength(2);
    expect(JSON.stringify(styles[0])).toContain(':root{--sk-banner-height:0px}');
    expect(JSON.stringify(styles[1])).toContain('html{--sk-banner-height:4.2rem}');
  });
});

// The project path a captured page takes from its address (tools/companion/capture.ts pagePath, spec capture-url).
import { describe, expect, it } from 'vitest';
import { captureSnapshot, pagePath, scopeCss } from './capture.ts';

describe('a captured page’s path', () => {
  it('follows its address', () => {
    expect(pagePath('https://example.com/')).toBe('index.html');
    expect(pagePath('https://example.com/plans/')).toBe('plans/index.html');
    expect(pagePath('https://example.com/about')).toBe('about.html');
    expect(pagePath('https://example.com/a/b.html?x=1#top')).toBe('a/b.html');
  });
});

// Custom elements keep their own tags in the captured DOM (DEC-53), so a shadow root's rules are scoped to the host's
// tag and the page's own sheets are left as they are.
describe('the rules of shadow roots', () => {
  it('keeps a shadow root’s rules within their host', () => {
    expect(scopeCss(':host { display: block } p { color: red } :host(.big) ::slotted(span) { margin: 0 }', 'x-badge')).toBe('x-badge{display:block}x-badge p{color:red}x-badge.big span{margin:0}');
  });
  it('leaves keyframes and a sheet outside a shadow root as they are', () => {
    expect(scopeCss('@keyframes spin { from { opacity: 0 } }', 'x-badge')).toContain('from{opacity:0}');
    expect(scopeCss('mdn-dropdown > a { color: red }', null)).toBe('mdn-dropdown > a { color: red }');
  });
});

it('keeps a whole CSS import when its quoted URL contains a semicolon', async () => {
  const sheet = '@import "https://fonts.test/inter.css?family=Inter:wght@100;900";h1{color:red}';
  const font = '@font-face{font-family:Inter;src:local("Inter")}';
  const result = await captureSnapshot({
    url: 'https://site.test/',
    read: { title: 'Site', html: '<!doctype html><html><head></head><body><h1>Site</h1></body></html>', sheets: [{ href: 'https://site.test/style.css', text: null, scope: null }], images: [], links: [] },
    resources: {
      'https://site.test/style.css': { status: 200, type: 'text/css', base64: Buffer.from(sheet).toString('base64') },
      'https://fonts.test/inter.css?family=Inter:wght@100;900': { status: 200, type: 'text/css', base64: Buffer.from(font).toString('base64') },
    },
  });
  const css = Buffer.from(result.files.find((file) => file.path === 'css/style-1.css')?.base64 ?? '', 'base64').toString('utf8');
  expect(css).toContain(font);
  expect(css).toContain('h1{color:red}');
  expect(css).not.toContain('900";');
});

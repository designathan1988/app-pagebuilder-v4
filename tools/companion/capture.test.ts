// The project path a captured page takes from its address (tools/companion/capture.ts pagePath, spec capture-url).
import { describe, expect, it } from 'vitest';
import { captureRecorded, captureSnapshot, pagePath } from './capture.ts';
import type { CapturedSnapshotPackage } from '../../src/core/document/captured.ts';
import type { ObservedElement } from './serialize.ts';

const HTML = 'http://www.w3.org/1999/xhtml';
const page = (body: ObservedElement['children'], headChildren: ObservedElement['children'] = []): ObservedElement => ({
  kind: 'element', id: 'k0', namespace: HTML, tag: 'html', attributes: [], children: [
    { kind: 'element', id: 'k1', namespace: HTML, tag: 'head', attributes: [], children: headChildren },
    { kind: 'element', id: 'k2', namespace: HTML, tag: 'body', attributes: [], children: body },
  ],
});

describe('a captured page’s path', () => {
  it('follows its address', () => {
    expect(pagePath('https://example.com/')).toBe('index.html');
    expect(pagePath('https://example.com/plans/')).toBe('plans/index.html');
    expect(pagePath('https://example.com/about')).toBe('about.html');
    expect(pagePath('https://example.com/a/b.html?x=1#top')).toBe('a/b.html');
  });
});

it('keeps a whole CSS import when its quoted URL contains a semicolon', async () => {
  const sheet = '@import "https://fonts.test/inter.css?family=Inter:wght@100;900";h1{color:red}';
  const font = '@font-face{font-family:Inter;src:local("Inter")}';
  const result = await captureSnapshot({
    url: 'https://site.test/',
    read: { title: 'Site', root: page([{ kind: 'element', id: 'k3', namespace: HTML, tag: 'h1', attributes: [], children: [{ kind: 'text', id: 'k4', value: 'Site' }] }], [{ kind: 'comment', id: 'k5', value: '__capture_sheet_0__' }]), sheets: [{ href: 'https://site.test/style.css', text: null }], images: [], links: [] },
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

it('packages a page as one tree: its sheets linked at their places, its images local, and a format 2 package', async () => {
  const root = page([
    { kind: 'element', id: 'k3', namespace: HTML, tag: 'img', attributes: [{ name: 'src', namespace: null, value: '__capture_image_0__' }, { name: 'alt', namespace: null, value: 'Wallet' }], children: [] },
    { kind: 'element', id: 'k4', namespace: HTML, tag: 'a', attributes: [{ name: 'href', namespace: null, value: '__capture_link__https://site.test/about__#team__' }], children: [{ kind: 'text', id: 'k5', value: 'About' }] },
  ], [{ kind: 'element', id: 'k6', namespace: HTML, tag: 'div', attributes: [{ name: 'id', namespace: null, value: 'portal' }], children: [] }, { kind: 'comment', id: 'k7', value: '__capture_sheet_0__' }]);
  const result = await captureSnapshot({
    url: 'https://site.test/',
    read: { title: 'Site', viewportWidth: 1280, root, sheets: [{ href: null, text: '.a{color:red}' }], images: [{ index: 0, src: 'https://site.test/w.png' }], links: ['https://site.test/about'] },
    resources: { 'https://site.test/w.png': { status: 200, type: 'image/png', base64: Buffer.from('png').toString('base64') } },
  });
  const pack = JSON.parse(Buffer.from(result.files.find((file) => file.path === 'index.html.capture.json')?.base64 ?? '', 'base64').toString('utf8')) as CapturedSnapshotPackage;
  if (pack.format !== 2) throw new Error('not a format 2 package');
  expect(pack.widths).toEqual([1280]);
  const json = JSON.stringify(pack.root);
  expect(json).toContain('"value":"img/img-1.png"');
  expect(json).toContain('"value":"css/inline-1.css"');
  expect(json).toContain('"value":"/about#team"');
  expect(json).toContain('builder-capture');
  // the head keeps what the page held there (written out of it only in the HTML file)
  expect(json).toContain('"value":"portal"');
  const html = Buffer.from(result.files.find((file) => file.path === 'index.html')?.base64 ?? '', 'base64').toString('utf8');
  expect(html).toContain('<link rel="stylesheet" href="css/inline-1.css">');
  expect(html).not.toContain('portal');
});

// bellroy's record held each font twice: the response with its bytes, then the same address again from the browser's
// cache, a 200 with no body (content.size -1). The empty one won, and every font of the page was 0 bytes.
it('keeps a recorded file\'s bytes when the record holds the same address again without them', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'har-'));
  const har = path.join(dir, 'site.har');
  const font = Buffer.from('wOF2-font-bytes');
  const entry = (text: string | undefined, size: number) => ({ request: { url: 'https://site.test/font.woff2' }, response: { status: 200, content: { mimeType: 'font/woff2', size, ...(text === undefined ? {} : { text, encoding: 'base64' }) } } });
  fs.writeFileSync(har, JSON.stringify({ log: { entries: [entry(font.toString('base64'), font.length), entry(undefined, -1)] } }));
  const root = page([], [{ kind: 'comment', id: 'k3', value: '__capture_sheet_0__' }]);
  const result = await captureRecorded('https://site.test/', [{ width: 1440, inline: [], read: { title: 'Site', root, sheets: [{ href: null, text: '@font-face{font-family:Brand;src:url("/font.woff2") format("woff2")}' }], images: [], links: [] } }], har);
  const saved = result.files.find((file) => file.path.startsWith('fonts/'));
  expect(Buffer.from(saved?.base64 ?? '', 'base64').toString()).toBe('wOF2-font-bytes');
});

// bellroy's section: --section-bg: url(…) set inline, used by a rule of its stylesheet (css/). A url() in a custom
// property resolves where var() uses it, so the background was looked for in css/img/ and never drawn.
it('writes a url() inside an inline custom property from the stylesheets\' folder, and any other from the page', async () => {
  const root = page([{ kind: 'element', id: 'k3', namespace: HTML, tag: 'section', attributes: [{ name: 'style', namespace: null, value: '--section-bg: url(https://site.test/grid.png); background-image: url("https://site.test/dots.png")' }], children: [] }]);
  const result = await captureSnapshot({
    url: 'https://site.test/',
    read: { title: 'Site', root, sheets: [], images: [], links: [] },
    resources: {
      'https://site.test/grid.png': { status: 200, type: 'image/png', base64: Buffer.from('grid').toString('base64') },
      'https://site.test/dots.png': { status: 200, type: 'image/png', base64: Buffer.from('dots').toString('base64') },
    },
  });
  const pack = JSON.parse(Buffer.from(result.files.find((file) => file.path === 'index.html.capture.json')?.base64 ?? '', 'base64').toString('utf8')) as CapturedSnapshotPackage;
  const style = JSON.stringify(pack.format === 2 ? pack.root : null).match(/--section-bg[^"]*/)?.[0] ?? '';
  expect(style).toContain('--section-bg: url(../img/img-1.png)');
  expect(style).toContain('background-image: url(img/img-2.png)');
});

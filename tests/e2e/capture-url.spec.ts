// Opening a web address (spec capture-url): the Builder Companion, started here as `npm run companion` starts it,
// captures a local site whose script adds a paragraph after load, whose stylesheet names a background image and whose
// page shows an image; the editor's File › Open a web address… sends the address, and the page arrives through Import
// HTML as its script left it, with its classes, colours, image and background files.
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Server as CompanionServer } from 'node:http';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs, openExplorer } from './door.ts';
import { startCompanion, stopCompanion } from '../../tools/companion/server.ts';
import { chromium } from '@playwright/test';
import { buildExtension } from '../../tools/companion/build-extension.ts';
import { unzip } from '../../tools/runner/unzip.ts';

const SITE_PORT = 5421;
// the signed-in site of the extension's test, and the token the Companion and the extension share
const LOGIN_PORT = 5422;
const TOKEN = 'the-companion-token-of-the-test';
// one site and one Companion for the file's tests: they run one after the other
test.describe.configure({ mode: 'serial' });
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml' };
let site: Server;
let companion: CompanionServer;

test.beforeAll(async () => {
  site = createServer((req, res) => {
    // a folder's address is its index.html, as a web server serves it
    const asked = (req.url ?? '/').split('?')[0] ?? '/';
    const file = join('tests/support/capture-site', asked.endsWith('/') ? `${asked}index.html` : asked);
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => site.listen(SITE_PORT, '127.0.0.1', () => resolve()));
  companion = await startCompanion(5410, { token: TOKEN });
});
test.afterAll(async () => {
  await stopCompanion(companion);
  await new Promise((resolve) => site.close(resolve));
});

type CapturedNode = { kind: 'element' | 'text' | 'comment'; tag?: string; value?: string; attributes?: { name: string; namespace: string | null; value: string }[]; children?: CapturedNode[] };
type Doc = { pages: { file: string; tree: unknown; capture?: { viewports: { root: CapturedNode }[] } }[]; files?: { path: string }[]; classes?: { name: string }[] };
const read = (page: Page) => page.evaluate(() => (window as unknown as { __builderTestPort: { document(): Doc } }).__builderTestPort.document());

test('a web address is captured as its script left it and imported as a page', runs('workspace.openDialog#menu-file-capture-url', 'project.captureUrl#capture-url-run'), async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
  const dialog = page.locator('[data-region="capture-url-dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="url"]').fill(`127.0.0.1:${SITE_PORT}/`);
  await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText(/Capturing http:\/\/127\.0\.0\.1:5421\//);
  // the import's own destinations, then a new page
  const destination = page.locator('[data-door="project.importHtml#destination-page"]');
  await expect(destination).toBeVisible({ timeout: 60_000 });
  await destination.click();
  const frame = page.frameLocator('.frame__page');
  await expect(frame.getByRole('heading', { name: 'Grão Norte' })).toBeVisible();
  // what the site's script added after load is there
  await expect(frame.getByText('Added by a script')).toBeVisible();
  // a web component's shadow DOM is flattened: its slot holds the light text, its own text and style come with it
  await expect(frame.getByText('Fresh beans')).toBeVisible();
  expect(await frame.getByText('Fresh beans').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(185, 81, 42)');
  // the stylesheet's rules, as classes: the brand colour, the lead's colour of the <style>
  expect(await frame.getByRole('heading', { name: 'Grão Norte' }).evaluate((el) => getComputedStyle(el).color)).toBe('rgb(245, 230, 211)');
  expect(await frame.getByText('Fresh coffee, roasted every week.').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(122, 62, 29)');
  // the image and the background were downloaded into the project
  const doc = await read(page);
  expect((doc.files ?? []).filter((f) => f.path.startsWith('img/')).length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => frame.locator('img').first().evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test('captured mixed DOM and source cascade survive canvas and export', runs('project.captureUrl#capture-url-run', 'project.export#menu-file', 'capture.select#captured-inspector-node', 'capture.edit#captured-apply', 'history.undo#toolbar-top-bar'), async ({ page, context }) => {
  test.setTimeout(120_000);
  const original = await context.newPage();
  await original.goto(`http://127.0.0.1:${SITE_PORT}/mixed-dom.html`);
  await original.screenshot({ path: '.cache/logs/captured-mixed-original.png' });
  const source = await original.locator('#story').evaluate((element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelector('img')?.removeAttribute('src');
    return {
      html: clone.innerHTML,
      imageSrc: element.querySelector('img')?.getAttribute('src') ?? '',
      color: getComputedStyle(element).color,
      width: Math.round(element.querySelector('img')?.getBoundingClientRect().width ?? 0),
    };
  });
  await original.close();
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
  const dialog = page.locator('[data-region="capture-url-dialog"]');
  await dialog.locator('input[name="url"]').fill(`127.0.0.1:${SITE_PORT}/mixed-dom.html`);
  await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
  const destination = page.locator('[data-door="project.importHtml#destination-page"]');
  await expect(destination).toBeVisible({ timeout: 60_000 });
  await destination.click();
  const frame = page.frameLocator('.frame__page');
  await page.screenshot({ path: '.cache/logs/captured-mixed-before.png' });
  await expect(frame.locator('#story img')).toBeVisible();
  await expect(frame.locator('brand-card#custom')).toHaveText('Custom element content');
  expect(await frame.locator('#story').evaluate((element) => getComputedStyle(element).color)).toBe(source.color);
  await page.screenshot({ path: '.cache/logs/captured-mixed-canvas.png' });
  await page.getByText('Formatted captured code').click();
  await expect(page.locator('.captured-inspector__code').first()).toContainText('<p class="story" id="story" data-capture-class="story">Before');
  await expect(page.locator('.captured-inspector__code').first()).not.toContainText('animation-play-state:paused!important');
  await page.screenshot({ path: '.cache/logs/captured-mixed-code.png' });
  await page.locator('[data-region="captured-inspector"] button').filter({ hasText: 'text: Before' }).click();
  await page.locator('[data-region="captured-edit"] textarea').fill('Changed ');
  await page.locator('[data-door="capture.edit#captured-apply"]').click();
  await expect(frame.locator('#story')).toContainText('Changed');
  await page.screenshot({ path: '.cache/logs/captured-mixed-edited.png' });
  await page.locator('[data-door="history.undo#toolbar-top-bar"]').click();
  await expect(frame.locator('#story')).toContainText('Before');
  const downloading = page.waitForEvent('download');
  await runDoor(page, 'project.export#menu-file');
  const files = unzip(fs.readFileSync(await (await downloading).path()));
  const exported = await context.newPage();
  await exported.route('http://made.capture.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const bytes = files.get(name);
    const contentType = name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    return bytes === undefined ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType, body: bytes });
  });
  await exported.goto('http://made.capture.test/mixed-dom.html');
  const result = await exported.locator('#story').evaluate((element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelector('img')?.removeAttribute('src');
    return {
      html: clone.innerHTML,
      imageSrc: element.querySelector('img')?.getAttribute('src') ?? '',
      color: getComputedStyle(element).color,
      width: Math.round(element.querySelector('img')?.getBoundingClientRect().width ?? 0),
    };
  });
  expect({ html: result.html, color: result.color, width: result.width }).toEqual({ html: source.html, color: source.color, width: source.width });
  expect(source.imageSrc).toMatch(/^data:image\/svg\+xml,/);
  expect(files.get(result.imageSrc)?.toString('utf8')).toBe(decodeURIComponent(source.imageSrc.slice(source.imageSrc.indexOf(',') + 1)));
  await expect.poll(() => exported.locator('#story img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(exported.locator('brand-card#custom')).toHaveText('Custom element content');
  await exported.screenshot({ path: '.cache/logs/captured-mixed-export.png' });
  await exported.close();
});

test('a script-driven width survives capture and export at every project viewport', runs('project.captureUrl#capture-url-run', 'project.export#menu-file'), async ({ page, context }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
  const dialog = page.locator('[data-region="capture-url-dialog"]');
  await dialog.locator('input[name="url"]').fill(`127.0.0.1:${SITE_PORT}/responsive.html`);
  await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
  const destination = page.locator('[data-door="project.importHtml#destination-page"]');
  await expect(destination).toBeVisible({ timeout: 60_000 });
  await destination.click();
  await expect(page.frameLocator('.frame__page').locator('#responsive-rail')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await runDoor(page, 'project.export#menu-file');
  const files = unzip(fs.readFileSync(await (await downloading).path()));
  const exported = await context.newPage();
  await exported.route('http://made.capture.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const bytes = files.get(name);
    return bytes === undefined ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'text/html', body: bytes });
  });
  for (const [width, expected] of [[1440, 480], [1180, 400], [834, 300], [390, 180]] as const) {
    await exported.setViewportSize({ width, height: 900 });
    await exported.goto('http://made.capture.test/responsive.html');
    expect(await exported.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), `${width}px print stylesheet stays off screen`).toBe('rgba(0, 0, 0, 0)');
    expect(await exported.locator('#responsive-rail').evaluate(el => Math.round(el.getBoundingClientRect().width)), `${width}px`).toBe(expected);
    expect(await exported.locator('#responsive-rail').evaluate(el => Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius))), `${width}px initial layout`).toBe(width === 390 ? 30 : 4);
  }
  await exported.close();
});

test('picture sources keep the selected artwork in the exported desktop and phone pages', runs('project.captureUrl#capture-url-run', 'project.export#menu-file'), async ({ page, context }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
  const dialog = page.locator('[data-region="capture-url-dialog"]');
  await dialog.locator('input[name="url"]').fill(`127.0.0.1:${SITE_PORT}/responsive-picture.html`);
  await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
  const destination = page.locator('[data-door="project.importHtml#destination-page"]');
  await expect(destination).toBeVisible({ timeout: 60_000 });
  await destination.click();
  const downloading = page.waitForEvent('download');
  await runDoor(page, 'project.export#menu-file');
  const files = unzip(fs.readFileSync(await (await downloading).path()));
  const exported = await context.newPage();
  await exported.route('http://made.capture.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const bytes = files.get(name);
    if (bytes === undefined) return route.fulfill({ status: 404, body: '' });
    const contentType = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ contentType, body: bytes });
  });
  for (const [width, colour] of [[1440, '#123456'], [390, '#abcdef']] as const) {
    await exported.setViewportSize({ width, height: 900 });
    await exported.goto('http://made.capture.test/responsive-picture.html');
    const picture = exported.locator('#responsive-picture');
    await expect.poll(() => picture.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(120);
    const source = await picture.evaluate(async (img) => (await fetch((img as HTMLImageElement).currentSrc)).text());
    expect(source, `${width}px uses its captured local picture source`).toContain(colour);
  }
  await exported.close();
});

test('a standalone responsive image retains the browser-selected local source at each width', runs('project.captureUrl#capture-url-run', 'project.export#menu-file'), async ({ page, context }) => {
  test.setTimeout(120_000);
  const original = await context.newPage();
  for (const [width, colour] of [[1440, '#123456'], [390, '#abcdef']] as const) {
    await original.setViewportSize({ width, height: 900 });
    await original.goto(`http://127.0.0.1:${SITE_PORT}/responsive-img.html`);
    const source = await original.locator('#responsive-img').evaluate(async (img) => (await fetch((img as HTMLImageElement).currentSrc)).text());
    expect(source, `${width}px original browser selection`).toContain(colour);
    await original.screenshot({ path: `.cache/logs/qa269-resp-img-original-${width}.png` });
  }
  await original.close();
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
  const dialog = page.locator('[data-region="capture-url-dialog"]');
  await dialog.locator('input[name="url"]').fill(`127.0.0.1:${SITE_PORT}/responsive-img.html`);
  await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
  const destination = page.locator('[data-door="project.importHtml#destination-page"]');
  await expect(destination).toBeVisible({ timeout: 60_000 });
  await destination.click();
  const canvasImage = page.frameLocator('.frame__page').locator('#responsive-img');
  await expect.poll(() => canvasImage.getAttribute('srcset')).toContain('blob:');
  await expect.poll(() => canvasImage.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(120);
  const downloading = page.waitForEvent('download');
  await runDoor(page, 'project.export#menu-file');
  const files = unzip(fs.readFileSync(await (await downloading).path()));
  const exported = await context.newPage();
  await exported.route('http://made.capture.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const bytes = files.get(name);
    if (bytes === undefined) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.css') ? 'text/css' : 'text/html', body: bytes });
  });
  for (const [width, colour] of [[1440, '#123456'], [390, '#abcdef']] as const) {
    await exported.setViewportSize({ width, height: 900 });
    await exported.goto('http://made.capture.test/responsive-img.html');
    const image = exported.locator('#responsive-img');
    await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(120);
    expect(await image.getAttribute('srcset'), `${width}px retains candidate selection`).not.toBeNull();
    const source = await image.evaluate(async (img) => (await fetch((img as HTMLImageElement).currentSrc)).text());
    await exported.screenshot({ path: `.cache/logs/qa269-resp-img-after-${width}.png` });
    expect(source, `${width}px uses its browser-selected local image candidate`).toContain(colour);
  }
  await exported.close();
});

test('the captured html root class keeps its inherited font in canvas and export', runs('project.captureUrl#capture-url-run', 'project.export#menu-file'), async ({ page, context }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
  const dialog = page.locator('[data-region="capture-url-dialog"]');
  await dialog.locator('input[name="url"]').fill(`127.0.0.1:${SITE_PORT}/root-classes.html`);
  await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
  const destination = page.locator('[data-door="project.importHtml#destination-page"]');
  await expect(destination).toBeVisible({ timeout: 60_000 });
  await destination.click();
  const root = page.frameLocator('.frame__page').locator('html');
  await expect.poll(() => root.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Courier New');
  const capturedPage = (await read(page)).pages[0];
  expect(capturedPage?.capture?.viewports[0]?.root.attributes).toContainEqual({ name: 'class', namespace: null, value: 'font-brand' });
  expect((capturedPage?.tree as { children: unknown[] }).children).toHaveLength(0);
  const downloading = page.waitForEvent('download');
  await runDoor(page, 'project.export#menu-file');
  const files = unzip(fs.readFileSync(await (await downloading).path()));
  const exported = await context.newPage();
  await exported.route('http://made.capture.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const bytes = files.get(name);
    return bytes === undefined ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'text/html', body: bytes });
  });
  for (const width of [1440, 390]) {
    await exported.setViewportSize({ width, height: 900 });
    await exported.goto('http://made.capture.test/root-classes.html');
    const state = await exported.locator('html').evaluate((element) => ({ classes: element.className, font: getComputedStyle(element).fontFamily, bodyClasses: document.body.className }));
    expect(state.classes, `${width}px html classes`).toContain('font-brand');
    expect(state.font, `${width}px inherited root font`).toContain('Courier New');
    expect(state.bodyClasses, `${width}px body keeps only its own classes`).not.toContain('font-brand');
  }
  await exported.close();
});

test('two pages of the site are captured, the link between them written from one file to the other', runs('project.captureUrl#capture-url-run'), async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
  const dialog = page.locator('[data-region="capture-url-dialog"]');
  await dialog.locator('input[name="url"]').fill(`127.0.0.1:${SITE_PORT}/`);
  await dialog.locator('input[name="pages"]').fill('2');
  await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
  const destination = page.locator('[data-door="project.importHtml#destination-page"]');
  await expect(destination).toBeVisible({ timeout: 60_000 });
  await destination.click();
  await expect.poll(async () => (await read(page)).pages.map((one) => one.file).sort()).toEqual(['index.html', 'plans/index.html']);
  const frame = page.frameLocator('.frame__page');
  await expect(frame.getByRole('link', { name: 'See the plans' })).toHaveAttribute('href', 'plans/index.html');
  const plans = (await read(page)).pages.find((one) => one.file === 'plans/index.html');
  await openExplorer(page);
  await runDoor(page, 'pages.switch#explorer-page-row', { args: { page: (plans?.tree as { id: string }).id } });
  await expect(frame.getByRole('heading', { name: 'Our plans' })).toBeVisible();
  // the shared stylesheet reached the second page too
  expect(await frame.getByRole('heading', { name: 'Our plans' }).evaluate((el) => getComputedStyle(el).color)).toBe('rgb(245, 230, 211)');
  // the links between the two pages name the project's pages (the export writes them from each page's folder)
  const hrefs: Record<string, string> = {};
  const content = (node: CapturedNode): string => node.kind === 'text' ? node.value ?? '' : (node.children ?? []).map(content).join('');
  const walk = (node: CapturedNode): void => {
    if (node.kind === 'element' && node.tag === 'a') {
      const href = node.attributes?.find((attribute) => attribute.name === 'href')?.value;
      if (href !== undefined) hrefs[content(node)] = href;
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const one of (await read(page)).pages) {
    const root = one.capture?.viewports[0]?.root;
    if (root !== undefined) walk(root);
  }
  expect(hrefs['See the plans']).toBe('plans/index.html');
  expect(hrefs['Back home']).toBe('../index.html');
});

test('without the Companion the status bar says how to start it', runs('project.captureUrl#capture-url-run'), async ({ page }) => {
  await stopCompanion(companion);
  try {
    await openEditor(page);
    await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
    const dialog = page.locator('[data-region="capture-url-dialog"]');
    await dialog.locator('input[name="url"]').fill('https://example.com');
    await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
    await expect(page.getByRole('status')).toHaveText('The Builder Companion does not answer: run npm run companion, then capture again.');
  } finally {
    companion = await startCompanion(5410, { token: TOKEN });
  }
});

// A page behind a login (STG-12.4): a site whose page, stylesheet and picture answer only a signed-in visitor (a cookie
// its /login sets). The Builder Capture extension (companion/extension), loaded in Playwright's own Chromium (Chrome
// no longer loads an unpacked extension from the command line: DEC-38), captures the signed-in tab and hands it to the
// Companion with its token; File › Open a web address… with that address then opens the page as the person saw it. The
// Companion's own Chrome, with no session there, could not have read it.
test('the browser extension captures a page behind a login, and the editor opens it', runs('project.captureUrl#capture-url-run'), async ({ page }) => {
  test.setTimeout(180_000);
  const signedIn = (req: { headers: { cookie?: string | undefined } }) => (req.headers.cookie ?? '').includes('session=ana');
  const login = createServer((req, res) => {
    const asked = (req.url ?? '/').split('?')[0];
    if (asked === '/login') {
      res.writeHead(302, { 'set-cookie': 'session=ana; Path=/; HttpOnly', location: '/account' }).end();
      return;
    }
    if (!signedIn(req)) {
      res.writeHead(401, { 'content-type': 'text/html' }).end('<h1>Sign in first</h1>');
      return;
    }
    if (asked === '/account') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><html lang="en"><head><title>Your account</title><link rel="stylesheet" href="/account.css"></head><body><h1 class="greeting">Welcome back, Ana</h1><img src="/avatar.svg" alt="Ana" width="40" height="40"></body></html>');
      return;
    }
    if (asked === '/account.css') {
      res.writeHead(200, { 'content-type': 'text/css' }).end('.greeting { color: rgb(12, 99, 51); }');
      return;
    }
    if (asked === '/avatar.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#0c6333"/></svg>');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => login.listen(LOGIN_PORT, '127.0.0.1', () => resolve()));
  const extension = await buildExtension();
  const browser = await chromium.launchPersistentContext('', { channel: 'chromium', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
    await worker.evaluate((token) => chrome.storage.local.set({ port: 5410, token }), TOKEN);
    const tab = browser.pages()[0] ?? (await browser.newPage());
    await tab.goto(`http://127.0.0.1:${LOGIN_PORT}/login`);
    await expect(tab.getByRole('heading', { name: 'Welcome back, Ana' })).toBeVisible();
    const answer = await worker.evaluate(async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      return (globalThis as unknown as { captureTab(tab: chrome.tabs.Tab): Promise<{ ok: boolean; said: string }> }).captureTab(active as chrome.tabs.Tab);
    });
    expect(answer, answer.said).toMatchObject({ ok: true });
  } finally {
    await browser.close();
    await new Promise((resolve) => login.close(resolve));
  }
  // the editor, in the installed Chrome, asks the Companion for the address the extension captured
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-file-capture-url');
  const dialog = page.locator('[data-region="capture-url-dialog"]');
  await dialog.locator('input[name="url"]').fill(`http://127.0.0.1:${LOGIN_PORT}/account`);
  await dialog.locator('[data-door="project.captureUrl#capture-url-run"]').click();
  const destination = page.locator('[data-door="project.importHtml#destination-page"]');
  await expect(destination).toBeVisible({ timeout: 60_000 });
  await destination.click();
  const frame = page.frameLocator('.frame__page');
  // the signed-in page, its stylesheet and its picture, all read with the person's session
  await expect(frame.getByRole('heading', { name: 'Welcome back, Ana' })).toBeVisible();
  expect(await frame.getByRole('heading', { name: 'Welcome back, Ana' }).evaluate((el) => getComputedStyle(el).color)).toBe('rgb(12, 99, 51)');
  await expect.poll(() => frame.locator('img').first().evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

// A captured stylesheet's min-width rule must survive an import/export at wide screens without leaking to phones.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openExplorer, runDoor, runs } from './door.ts';
import { unzip } from '../../tools/runner/unzip.ts';
import { markRuntime } from '../../tools/companion/capture.ts';
import { completeOpaquePaint } from '../../tools/companion/paint.ts';
import { serializePage } from '../../tools/companion/serialize.ts';

const IMPORT = 'project.importHtml#menu-file';
const EXPORT = 'project.export#toolbar-top-bar-export';
const ADD = 'pages.add#explorer-add-page';

test('a captured min-width rule keeps its wide and narrow heights after export', runs(IMPORT, EXPORT, ADD), async ({ page, context }) => {
  const html = '<!doctype html><html><head><meta name="builder-capture" content="https://source.test/"><link rel="stylesheet" href="site.css"></head><body><section class="hero" data-capture-class="hero"><img class="h-full" data-capture-class="h-full" src="pixel.svg" width="200" height="200" alt="Pixel"><a href="https://source.test/">Link</a></section><svg width="83" height="24" viewBox="0 0 83 24" role="img" aria-label="Vector logo"><rect width="83" height="24" fill="black"/></svg><svg class="conditional-svg" data-capture-class="conditional-svg" width="83" height="24" viewBox="0 0 83 24" role="img" aria-label="Conditional logo"><rect width="83" height="24" fill="black"/></svg><img src="pixel.svg" width="83" height="24" alt="Unstyled image"><p class="break-test" data-capture-class="break-test">One<span style="display:block"></span>Two</p><div class="dark" data-capture-class="dark"><blockquote>Quote</blockquote></div><div class="parent" data-capture-class="parent"><div class="variable-card" data-capture-class="variable-card" style="--surface:#123456">Variable</div></div><div class="sized" style="width:100px;padding:20px">Box</div><article><a href="https://source.test/">Source</a><time class="date" data-capture-class="date" datetime="2026-06-15">4 months ago</time></article><span class="mobile-visual" data-capture-class="mobile-visual"><img src="pixel.svg" alt="Mobile visual"></span><div class="hidden md:block" data-capture-class="hidden md:block">Wide only</div><div class="range" data-capture-class="range">Range</div></body></html>';
  const css = '*{box-sizing:border-box}.hero{height:16px;color:white}.h-full{height:100%}.break-test{line-height:30px}.dark{background:#202020;color:white}.parent .variable-card{--surface:#f7f7f8}.variable-card{background:var(--surface,#f7f7f8)}.date{display:block;line-height:20px}.hidden{display:none}.range{width:36px}.mobile-visual{display:none}@layer base{a{color:inherit}}@media(min-width:768px){.hero{height:250px}.conditional-svg{width:120px}.md\\:block{display:block}}@media(max-width:834px){.mobile-visual{display:block}}@media(width >= 50rem){.range{width:70px}}';
  await openEditor(page);
  const choosing = page.waitForEvent('filechooser');
  await runDoor(page, IMPORT);
  await (await choosing).setFiles([
    { name: 'index.html', mimeType: 'text/html', buffer: Buffer.from(html) },
    { name: 'site.css', mimeType: 'text/css', buffer: Buffer.from(css) },
    { name: 'pixel.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>') },
  ]);
  await page.locator('[data-door="project.importHtml#destination-replace"]').click();
  await page.locator('[data-confirmation="confirm"]').click();
  await expect(page.frameLocator('.frame__page').getByRole('img', { name: 'Pixel' })).toBeVisible();
  expect(await page.frameLocator('.frame__page').getByRole('link', { name: 'Link' }).evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  expect(await page.frameLocator('.frame__page').locator('[data-capture-class="variable-card"]').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(18, 52, 86)');
  const downloading = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const files = unzip(fs.readFileSync(await (await downloading).path()));
  const exported = await context.newPage();
  await exported.route('https://made.test/**', route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    const bytes = files.get(path);
    return bytes === undefined ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: bytes });
  });
  for (const [width, height] of [[1440, 250], [390, 16]] as const) {
    await exported.setViewportSize({ width, height: 900 });
    await exported.goto('https://made.test/index.html');
    expect(await exported.locator('body').evaluate(el => getComputedStyle(el).marginLeft), `${width}px captured body margin`).toBe('8px');
    expect(await exported.locator('blockquote').evaluate(el => getComputedStyle(el).backgroundColor), `${width}px quote background`).toBe('rgba(0, 0, 0, 0)');
    expect(await exported.locator('[data-capture-class="variable-card"]').evaluate(el => getComputedStyle(el).backgroundColor), `${width}px inline variable`).toBe('rgb(18, 52, 86)');
    expect(await exported.locator('.sized').evaluate(el => Math.round(el.getBoundingClientRect().width)), `${width}px site box sizing`).toBe(100);
    expect(await exported.locator('[data-capture-class="date"]').evaluate(el => ({ tag: el.tagName, height: Math.round(el.getBoundingClientRect().height), date: el.getAttribute('datetime') })), `${width}px date`).toEqual({ tag: 'TIME', height: 20, date: '2026-06-15' });
    expect(await exported.locator('section').evaluate(el => Math.round(el.getBoundingClientRect().height)), `${width}px`).toBe(height);
    expect(await exported.getByRole('img', { name: 'Pixel' }).evaluate(el => Math.round(el.getBoundingClientRect().height)), `${width}px image`).toBe(height);
    expect(await exported.getByRole('img', { name: 'Vector logo' }).evaluate(el => [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)]), `${width}px SVG size`).toEqual([83, 24]);
    expect(await exported.getByRole('img', { name: 'Conditional logo' }).evaluate(el => [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)]), `${width}px conditional SVG size`).toEqual([width === 1440 ? 120 : 83, 24]);
    expect(await exported.getByRole('img', { name: 'Unstyled image' }).evaluate(el => [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)]), `${width}px image size`).toEqual([83, 24]);
    expect(await exported.getByRole('link', { name: 'Link' }).evaluate(el => getComputedStyle(el).color), `${width}px layered link`).toBe('rgb(255, 255, 255)');
    expect(await exported.locator('[data-capture-class="break-test"]').evaluate(el => Math.round(el.getBoundingClientRect().height)), `${width}px block break`).toBe(60);
    expect(await exported.locator('img[alt="Mobile visual"]').count(), `${width}px mobile image retained`).toBe(1);
    expect(await exported.locator('img[alt="Mobile visual"]').evaluate(el => {
      if (el.parentElement === null) throw new Error('The mobile image has no wrapper');
      return getComputedStyle(el.parentElement).display;
    }), `${width}px mobile wrapper`).toBe(width === 1440 ? 'none' : 'block');
    expect(await exported.locator('[data-capture-class="hidden md:block"]').evaluate(el => getComputedStyle(el).display), `${width}px utility`).toBe(width === 1440 ? 'block' : 'none');
    expect(await exported.locator('[data-capture-class="range"]').evaluate(el => Math.round(el.getBoundingClientRect().width)), `${width}px range`).toBe(width === 1440 ? 70 : 36);
  }
  await exported.close();
  await openExplorer(page);
  await runDoor(page, ADD);
  await page.keyboard.press('Enter');
  const secondDownload = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const mixed = unzip(fs.readFileSync(await (await secondDownload).path()));
  const mixedPage = await context.newPage();
  await mixedPage.route('https://mixed.test/**', route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    const bytes = mixed.get(path);
    return bytes === undefined ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html', body: bytes });
  });
  await mixedPage.goto('https://mixed.test/index.html');
  expect(await mixedPage.locator('body').evaluate(el => getComputedStyle(el).marginLeft)).toBe('8px');
  await mixedPage.goto('https://mixed.test/page.html');
  expect(await mixedPage.locator('body').evaluate(el => getComputedStyle(el).marginLeft)).toBe('0px');
  await mixedPage.close();
});

// A video with no frame to show takes its poster's natural size (HTML Standard, the video element). Its poster is the
// screenshot cropped to the box, whole pixels: svelte's video came back 153 px tall where the video gave 152.14, and
// every row below it was a pixel off. The poster now keeps the video's own proportions.
test('a captured video\'s poster keeps the video\'s proportions, so the page keeps its height', async ({ page }) => {
  // a video of 1000 × 425, drawn 358 px wide: 152.15 px tall, no whole number (headless Chrome records no video, so the
  // box takes the video's proportions and the element reports the video's natural size)
  await page.setContent('<!doctype html><html><body style="margin:0"><video style="width:358px;aspect-ratio:1000/425;display:block;background:rgb(20,90,140)"></video><p>After</p></body></html>');
  await page.locator('video').evaluate((video) => {
    Object.defineProperty(video, 'videoWidth', { get: () => 1000 });
    Object.defineProperty(video, 'videoHeight', { get: () => 425 });
  });
  const height = await page.locator('video').evaluate((video) => video.getBoundingClientRect().height);
  expect(height).toBeCloseTo(358 * 425 / 1000, 1);
  await markRuntime(page);
  const read = await completeOpaquePaint(page, await page.evaluate(serializePage, 'http://video.test'), await page.screenshot({ fullPage: true }));
  const poster = read.images.at(-1)?.src ?? '';
  expect(poster.startsWith('data:image/png')).toBe(true);
  const size = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, poster);
  // exactly the video's proportions, at least as wide as drawn
  expect(size.width * 425).toBe(size.height * 1000);
  expect(size.width).toBeGreaterThanOrEqual(358);
  // the poster alone gives the video its height again
  await page.setContent(`<!doctype html><html><body style="margin:0"><video poster="${poster}" style="width:358px;display:block"></video></body></html>`);
  await expect.poll(() => page.locator('video').evaluate((video) => video.getBoundingClientRect().height)).toBeCloseTo(height, 2);
});

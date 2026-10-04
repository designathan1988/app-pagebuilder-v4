// A captured stylesheet's min-width rule must survive an import/export at wide screens without leaking to phones.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';
import { unzip } from '../../tools/runner/unzip.ts';

const IMPORT = 'project.importHtml#menu-file';
const EXPORT = 'project.export#toolbar-top-bar-export';

test('a captured min-width rule keeps its wide and narrow heights after export', runs(IMPORT, EXPORT), async ({ page, context }) => {
  const html = '<!doctype html><html><head><meta name="builder-capture" content="https://source.test/"><link rel="stylesheet" href="site.css"></head><body><section class="hero" data-capture-class="hero"><img class="h-full" data-capture-class="h-full" src="pixel.svg" width="200" height="200" alt="Pixel"><a href="https://source.test/">Link</a></section><span class="mobile-visual" data-capture-class="mobile-visual"><img src="pixel.svg" alt="Mobile visual"></span><div class="hidden md:block" data-capture-class="hidden md:block">Wide only</div><div class="range" data-capture-class="range">Range</div></body></html>';
  const css = '.hero{height:16px;color:white}.h-full{height:100%}.hidden{display:none}.range{width:36px}.mobile-visual{display:none}@layer base{a{color:inherit}}@media(min-width:768px){.hero{height:250px}.md\\:block{display:block}}@media(max-width:834px){.mobile-visual{display:block}}@media(width >= 50rem){.range{width:70px}}';
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
    expect(await exported.locator('section').evaluate(el => Math.round(el.getBoundingClientRect().height)), `${width}px`).toBe(height);
    expect(await exported.getByRole('img', { name: 'Pixel' }).evaluate(el => Math.round(el.getBoundingClientRect().height)), `${width}px image`).toBe(height);
    expect(await exported.getByRole('link', { name: 'Link' }).evaluate(el => getComputedStyle(el).color), `${width}px layered link`).toBe('rgb(255, 255, 255)');
    expect(await exported.locator('img[alt="Mobile visual"]').count(), `${width}px mobile image retained`).toBe(1);
    expect(await exported.locator('img[alt="Mobile visual"]').evaluate(el => {
      if (el.parentElement === null) throw new Error('The mobile image has no wrapper');
      return getComputedStyle(el.parentElement).display;
    }), `${width}px mobile wrapper`).toBe(width === 1440 ? 'none' : 'block');
    expect(await exported.locator('[data-capture-class="hidden md:block"]').evaluate(el => getComputedStyle(el).display), `${width}px utility`).toBe(width === 1440 ? 'block' : 'none');
    expect(await exported.locator('[data-capture-class="range"]').evaluate(el => Math.round(el.getBoundingClientRect().width)), `${width}px range`).toBe(width === 1440 ? 70 : 36);
  }
  await exported.close();
});

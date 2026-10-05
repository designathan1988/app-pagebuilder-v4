// The exported page matches the canvas at every breakpoint, not only the base one (the audit's AUD-02: the export
// merged identical rules into a place that broke the cascade, so on Marina's project the sections kept their desktop
// padding and the plans grid its three columns at 834 and 390 while the canvas drew them right). A project of two
// sections and a grid, each with its own tablet and phone values, identical between elements, is opened and exported
// once; at each breakpoint the canvas shows it at 100 %, and the archive's page is served at the width the frame's
// page has, and every element has the same computed styles on both (the page's elements in document order).
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { unzip } from '../../tools/runner/unzip.ts';
import { runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/responsive-sections.json';
const OPEN = 'project.open#menu-file';
const EXPORT = 'project.export#toolbar-top-bar-export';
const BREAKPOINTS = ['desktop', 'laptop', 'tablet', 'phone'] as const;
const tab = (breakpoint: string) => `view.setBreakpoint#toolbar-breakpoint-tabs-${breakpoint}`;
// what the fixture sets at each breakpoint, and what follows from it
const PROPERTIES = ['display', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'grid-template-columns', 'column-gap', 'row-gap', 'width'];

const styles = (root: Element, properties: readonly string[]) =>
  [root, ...root.querySelectorAll('*')].map((el) => {
    const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
    return [el.localName, ...properties.map((p) => `${p}: ${computed?.getPropertyValue(p) ?? ''}`)].join(' | ');
  });

test('the exported page has the canvas\'s computed styles at every breakpoint', runs(OPEN, EXPORT, ...BREAKPOINTS.map(tab)), async ({ page, context }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'responsive-sections.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  const frame = page.frameLocator('.frame__page');
  await expect(frame.locator('[data-node="n-card-c-title"]')).toHaveCount(1);

  const download = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const files = unzip(fs.readFileSync(await (await download).path()));
  const html = files.get('index.html')?.toString('utf8');
  const css = files.get('css/styles.css')?.toString('utf8');
  if (html === undefined || css === undefined) throw new Error('the archive lacks index.html or css/styles.css');
  const exported: Page = await context.newPage();
  await exported.route('https://site.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === '/css/styles.css' ? route.fulfill({ contentType: 'text/css', body: css }) : route.fulfill({ contentType: 'text/html', body: html });
  });

  for (const breakpoint of BREAKPOINTS) {
    // the frame fitted first, its tabs in view: at 100 % a frame wider than the stage stands centred on it, its tabs
    // panned out of view (with the 336 px inspector of DEC-66 the Laptop tab fell under the sidebar at 1600 px)
    await page.keyboard.press('Shift+1');
    await runDoor(page, tab(breakpoint));
    // the canvas at 100 %: the frame is the breakpoint wide and its page lays out in whole pixels
    await page.keyboard.press('Control+0');
    const width = await page.locator('.frame__page').evaluate((el) => (el as HTMLIFrameElement).contentWindow?.innerWidth ?? 0);
    const canvas = await frame.locator('body').evaluate(styles, PROPERTIES);
    // tall enough that the exported page does not scroll, as the frame's page does not
    await exported.setViewportSize({ width, height: 2000 });
    await exported.goto('https://site.test/index.html');
    const written = await exported.locator('body').evaluate(styles, PROPERTIES);
    expect(written.length, `the exported page has the canvas's elements at ${breakpoint}`).toBe(canvas.length);
    expect(written, `the exported page at ${breakpoint} (${width} px)`).toEqual(canvas);
  }
  await exported.close();
});

// layout-grid-overlay (spec/BEHAVIOUR.md#layout-grid-overlay) and the user's real-use audit: the column grid is drawn
// per breakpoint (A1.6: Desktop 12, Tablet 8, Phone 4, the Phone's margin 16) and covers the frame's whole height
// (A3.17: it used to stop at the body's content box). The scenario runner reads the document; this test counts the
// bands the chrome draws and measures them in the frame.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const COLUMNS = 'grid.toggleColumns#canvas-tools-column-grid';
const TABLET = 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet';
const PHONE = 'view.setBreakpoint#toolbar-breakpoint-tabs-phone';
const WHEEL = 'view.zoomAt#canvas-wheel-ctrl';
const ZOOM_MENU = 'view.zoomTo#menu-zoom-100';

const bands = (page: Page) => page.locator('[data-region="grid-columns"], .chrome__grid-column');

async function openAurora(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-grid"]')).toHaveCount(1);
}

test('the column grid follows the breakpoint: 12 at Desktop, 8 at Tablet, 4 at Phone', runs(OPEN, COLUMNS, TABLET, PHONE), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, COLUMNS);
  await expect(bands(page), 'the Desktop grid has twelve columns').toHaveCount(12);
  await runDoor(page, TABLET);
  await expect(bands(page), 'the Tablet grid has eight (A1.6: it had none)').toHaveCount(8);
  await runDoor(page, PHONE);
  await expect(bands(page), 'the Phone grid has four').toHaveCount(4);
  // the Phone's margin is 16 page px (grid.margin.phone): the first band starts there, the last ends there
  const frame = await page.locator('.frame__page').boundingBox();
  const body = await page.frameLocator('.frame__page').locator('[data-node="n-page"]').evaluate((el) => el.getBoundingClientRect().toJSON());
  const first = await bands(page).first().boundingBox();
  const last = await bands(page).last().boundingBox();
  if (frame === null || first === null || last === null) throw new Error('the bands or the frame are not laid out');
  const zoom = await page.locator('.frame__page').evaluate((el) => (el as HTMLIFrameElement).currentCSSZoom);
  expect(Math.abs(first.x - (frame.x + (body.x + 16) * zoom)), 'the first band starts at the Phone margin').toBeLessThan(1.5);
  expect(Math.abs(last.x + last.width - (frame.x + (body.x + body.width - 16) * zoom)), 'and the last ends at it').toBeLessThan(1.5);
});

test('the column grid covers the frame to its bottom, past the page s last element', runs(OPEN, COLUMNS), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, COLUMNS);
  const band = await bands(page).first().boundingBox();
  const frame = await page.locator('.frame__page').boundingBox();
  if (band === null || frame === null) throw new Error('the grid or the frame is not laid out');
  const bottomOfBand = band.y + band.height;
  const bottomOfFrame = frame.y + frame.height;
  expect(bottomOfBand, 'the band reaches the frame s bottom (A3.17: it stopped at the page s content)').toBeGreaterThan(bottomOfFrame - 2);
});

test('Ctrl+wheel keeps the page point under the pointer (A3.21)', runs(OPEN, ZOOM_MENU, WHEEL), async ({ page }) => {
  await openAurora(page);
  await openMenu(page, 'zoom');
  await control(page, ZOOM_MENU).click();
  const at = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const el = iframe?.contentDocument?.querySelector('[data-node="n-intro"]');
    if (!iframe || !el) throw new Error('the frame does not draw the Intro');
    const f = iframe.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const zoom = iframe.currentCSSZoom;
    return { x: f.left + (r.left + r.width / 2) * zoom, y: f.top + (r.top + r.height / 2) * zoom };
  });
  const pagePoint = () =>
    page.evaluate((point) => {
      const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
      if (!iframe || iframe.contentWindow === null) throw new Error('no frame');
      const f = iframe.getBoundingClientRect();
      const zoom = iframe.currentCSSZoom;
      return { x: (point.x - f.left) / zoom, y: iframe.contentWindow.scrollY + (point.y - f.top) / zoom };
    }, at);
  const before = await pagePoint();
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(400);
  await page.keyboard.up('Control');
  const after = await pagePoint();
  const moved = { x: after.x - before.x, y: after.y - before.y };
  expect(Math.abs(moved.x), 'the point stays across').toBeLessThan(2);
  expect(Math.abs(moved.y), 'and down the page (the audit: it drifted by dozens of px)').toBeLessThan(2);
});

// Each setting of Guides & Grids is a field row: its label in the card's column (the token; 116 px since LR2, 72 before),
// its field beside it on the same line (spec layout-grid-overlay; jornada02 pairing 5.2).
test('the Guides & Grids settings are field rows, the label beside its field', runs('workspace.openDialog#menu-view-guides-grids'), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await runDoor(page, 'workspace.openDialog#menu-view-guides-grids');
  const field = page.locator('.guides-grids__field').first();
  await expect(field).toBeVisible();
  const [label, input] = await Promise.all([field.locator('.guides-grids__label').boundingBox(), field.locator('input').boundingBox()]);
  if (label === null || input === null) throw new Error('the field is not laid out');
  const column = await field.evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue('--size-label-column-card')));
  expect(column).toBeGreaterThan(0);
  expect(Math.round(label.width)).toBeLessThanOrEqual(column);
  expect(input.x).toBeGreaterThan(label.x + label.width);
  expect(Math.abs(input.y + input.height / 2 - (label.y + label.height / 2))).toBeLessThan(4);
  expect(Math.round(input.height)).toBe(24);
});

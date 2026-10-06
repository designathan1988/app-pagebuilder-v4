// The status bar's messages (the audit's A3.41): a refusal's message goes with
// the next action, even one that says nothing of its own (a Layers branch folded); every preference change says what it
// set, the preference and the value by their labels, in the language shown (the theme, a view switch on and off, the
// language itself). The status bar is the end artifact here: what it says is the feature.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const WIDTH = 'style.set#inspector-width';
const CARET = 'layers.setExpanded#layers-caret';
const LIGHT = 'preferences.setTheme#menu-theme-light';
const DARK = 'preferences.setTheme#menu-theme-dark';
const OUTLINES = 'view.toggleOutlines#canvas-tools-outlines';
const PORTUGUESE = 'preferences.setLanguage#menu-language-pt-br';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-grid"]')).toHaveCount(1);
});

test('a refusal is replaced by the next action, even one that says nothing of its own', runs(OPEN, ROW, WIDTH, CARET), async ({ page }) => {
  const status = page.getByRole('status');
  await control(page, ROW, { args: { target: 'n-grid' } }).click();
  await control(page, WIDTH).locator('input').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('banana');
  await page.keyboard.press('Enter');
  await expect(status).toContainText('banana');
  await control(page, CARET, { args: { target: 'n-hero' } }).click();
  await expect(status).toHaveText('');
});

test('a preference change says what it set: the theme, a view switch on and off, the language', runs(OPEN, LIGHT, DARK, OUTLINES, PORTUGUESE), async ({ page }) => {
  const status = page.getByRole('status');
  // light, then dark: a fresh profile starts dark (PRODUCT.md §5.3), so each changes the theme; choosing the theme in
  // use changes nothing and says nothing
  await runDoor(page, LIGHT);
  await expect(status).toHaveText('Theme: Light.');
  await runDoor(page, DARK);
  await expect(status).toHaveText('Theme: Dark.');
  await runDoor(page, OUTLINES);
  await expect(status).toHaveText('Outlines: on.');
  await runDoor(page, OUTLINES);
  await expect(status).toHaveText('Outlines: off.');
  await runDoor(page, PORTUGUESE);
  await expect(status).toHaveText('Idioma: Português (Brasil).');
});

// the bar's fixed items (the breakpoint, the count, the zoom, the language, the save state): where they are, and what
// they look like on the screen
async function fixedItems(page: Page): Promise<{ readonly boxes: string; readonly pixels: Buffer }> {
  const boxes = await page.locator('.status-bar > :not(.status-bar__message, .status-bar__breadcrumb)').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)}+${Math.round(r.width)}`; }).join(' '));
  const first = await page.locator('.status-bar > .status-bar__item').first().boundingBox();
  const bar = await page.locator('.status-bar').boundingBox();
  if (first === null || bar === null) throw new Error('the status bar is not laid out');
  const pixels = await page.screenshot({ clip: { x: first.x, y: bar.y, width: bar.x + bar.width - first.x, height: bar.height } });
  return { boxes, pixels };
}

test('a message longer than the bar is cut on one line, read whole in its tooltip, and moves or covers none of the other items', runs(OPEN, ROW, WIDTH), async ({ page }) => {
  const status = page.getByRole('status');
  const bar = page.locator('.status-bar');
  const height = (await bar.boundingBox())?.height ?? 0;
  await control(page, ROW, { args: { target: 'n-grid' } }).click();
  const before = await fixedItems(page);
  await control(page, WIDTH).locator('input').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('w'.repeat(300));
  await page.keyboard.press('Enter');
  await expect(status).toContainText('www');
  const read = await status.evaluate((el) => ({ cut: el.scrollWidth > el.clientWidth, whole: el.getAttribute('title') === el.textContent && (el.textContent ?? '').includes('w'.repeat(300)) }));
  expect(read).toEqual({ cut: true, whole: true });
  expect((await bar.boundingBox())?.height).toBe(height);
  const after = await fixedItems(page);
  expect(after.boxes).toBe(before.boxes);
  expect(after.pixels.equals(before.pixels)).toBe(true);
});

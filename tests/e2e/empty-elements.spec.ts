// Elements with no visible box (spec text-edit-inline, Problems in Pager 4; the audit's
// A3.38): a heading whose text is cleared keeps canvas.emptyTextMinHeight of height on the canvas and takes a click
// there, and its Layers row says it is empty; the export carries no trace of it. The document is read through the
// read-only test port, the box inside the frame, the export from its archive.
import fs from 'node:fs';
import { expect, test, type Download, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { unzip } from '../../tools/runner/unzip.ts';
import { control, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const SETTINGS = 'workspace.setActiveTab#inspector-tab-settings';
const TEXT = 'text.set#inspector-text';
const CLICK = 'selection.select#canvas-click-element-or-page';
const EXPORT = 'project.export#toolbar-top-bar-export';
const interactions = JSON.parse(fs.readFileSync('manifest/interactions.json', 'utf8')) as { constants: { id: string; value: number }[] };
const MIN_HEIGHT = interactions.constants.find((c) => c.id === 'canvas.emptyTextMinHeight')?.value ?? Number.NaN;

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-grid"]')).toHaveCount(1);
  // at 100 % (Ctrl+0), where lengths resolve to whole px (the user's decision of 2026-09-25 for style checks)
  await page.keyboard.press('Control+0');
  await expect(page.locator('.frame__page')).toHaveCSS('zoom', '1');
}
const titleText = (page: Page) =>
  page.evaluate(() => {
    const doc = (window as unknown as Record<string, { document: () => { pages: { tree: { children: { id: string; children: { id: string; text: string | null }[] }[] } }[] } }>).__builderTestPort?.document();
    return doc?.pages[0]?.tree.children.find((c) => c.id === 'n-hero')?.children.find((c) => c.id === 'n-title')?.text;
  });
const selection = (page: Page) => page.evaluate(() => (window as unknown as Record<string, { selection: () => unknown }>).__builderTestPort?.selection());

test('a heading whose text is cleared keeps its minimum height on the canvas, takes a click, and leaves no trace in the export', runs(OPEN, ROW, SETTINGS, TEXT, CLICK, EXPORT), async ({ page }) => {
  await open(page);
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  await runDoor(page, SETTINGS);
  const field = control(page, TEXT).locator('textarea');
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect.poll(() => titleText(page)).toBe('');
  // the Layers row of the heading says it is empty
  await expect(control(page, ROW, { args: { target: 'n-title' } }).locator('[data-region="layers-row-empty"]')).toHaveText('empty');
  const title = page.frameLocator('.frame__page').locator('[data-node="n-title"]');
  await expect.poll(async () => (await title.evaluate((el) => el.getBoundingClientRect().height)) >= MIN_HEIGHT).toBe(true);
  // another element selected, then a click on the empty heading selects it
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  // a press on the canvas where the heading is drawn (the canvas overlay takes it, as a person's)
  const box = await title.boundingBox();
  if (box === null) throw new Error('the empty heading is not drawn');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => selection(page)).toEqual(['n-title']);
  // the export: no editor mark, no editor rule
  const download = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const file: Download = await download;
  const files = unzip(fs.readFileSync(await file.path()));
  const html = files.get('index.html')?.toString('utf8') ?? '';
  const css = [...files.entries()].filter(([name]) => name.endsWith('.css')).map(([, body]) => body.toString('utf8')).join('\n');
  expect(html).toContain('<h1');
  expect(`${html}\n${css}`).not.toContain('data-empty-text');
  expect(css).not.toContain(`min-height: ${MIN_HEIGHT}px`);
});


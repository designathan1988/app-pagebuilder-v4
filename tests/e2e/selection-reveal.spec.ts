// A selection made away from the canvas brings its element into view (spec keyboard-tree-walk Problem 2, the audit of
// 2026-10-05): walking with the arrows to an element below the stage, choosing it in the command bar's find, or
// inserting at the page's end selected it while the canvas stayed where it was — the inspector named an element the
// person could not see, and the quick panel's chip was out of sight with it. A Layers row leaves the canvas as it is:
// the contract's drag-autoscroll scenario chooses an element far below in the Layers, then drags one at the top.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ZOOM_100 = 'view.zoomTo#menu-zoom-100';
const ROW = 'selection.select#layers-row';
const NEXT = 'selection.walkNextSibling#key-arrow-right-in-canvas';
const CLICK = 'selection.select#canvas-click-element-or-page';
const BAR = 'commandBar.open#toolbar-top-bar-search';
const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';

// how much of a node the stage shows, in screen px of its height (0: none of it)
const shown = (page: Page, id: string) =>
  page.evaluate((wanted) => {
    const frame = document.querySelector<HTMLIFrameElement>('.frame__page');
    const view = document.querySelector('.frame__view')?.getBoundingClientRect();
    const node = frame?.contentDocument?.querySelector(`[data-node="${wanted}"]`)?.getBoundingClientRect();
    if (!frame || !view || !node) return -1;
    const zoom = frame.currentCSSZoom;
    const top = frame.getBoundingClientRect().top + node.top * zoom;
    const bottom = frame.getBoundingClientRect().top + node.bottom * zoom;
    return Math.max(0, Math.min(bottom, view.bottom) - Math.max(top, view.top));
  }, id);
// the page's top back in view: the wheel over the stage, as a person scrolls up
async function toTop(page: Page): Promise<void> {
  const view = await page.locator('.frame__view').first().boundingBox();
  if (view === null) throw new Error('no stage');
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  for (let i = 0; i < 20; i += 1) await page.mouse.wheel(0, -400);
  await expect.poll(() => shown(page, 'c-footer'), { message: 'the footer below the stage' }).toBe(0);
}
// the footer's row, found by its name in the Layers' search (the tree draws the rows in view only)
async function footerRow(page: Page): Promise<void> {
  const search = page.getByPlaceholder('Search layers');
  await search.click();
  await page.keyboard.type('Footer');
  await control(page, ROW, { args: { target: 'c-footer' } }).click();
}
const selection = (page: Page) => page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection());

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  await expect(page.frameLocator('.frame__page').locator('[data-node="c-footer"]')).toHaveCount(1);
  await runDoor(page, ZOOM_100);
  await toTop(page);
});

test('walking with the arrows to an element below the stage brings it into view', runs(OPEN, ZOOM_100, CLICK, NEXT), async ({ page }) => {
  // a click on the hero's supporting text, at its middle, then up the tree to the Main
  const at = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('.frame__page');
    const node = frame?.contentDocument?.querySelector('[data-node="c-lead"]')?.getBoundingClientRect();
    if (!frame || !node) throw new Error('no supporting text');
    const box = frame.getBoundingClientRect();
    const zoom = frame.currentCSSZoom;
    return { x: box.left + (node.left + node.width / 2) * zoom, y: box.top + (node.top + node.height / 2) * zoom };
  });
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => selection(page)).toEqual(['c-lead']);
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowUp');
  // the walk's next sibling of the Main is the page's footer, far below the stage
  await expect.poll(() => selection(page)).toEqual(['c-main']);
  await runDoor(page, NEXT);
  await expect.poll(() => selection(page)).toEqual(['c-footer']);
  await expect.poll(() => shown(page, 'c-footer'), { message: 'the footer in view' }).toBeGreaterThan(40);
});

test('the command bar\'s find brings its element into view; a Layers row leaves the canvas as it is', runs(OPEN, ZOOM_100, ROW, BAR), async ({ page }) => {
  // a row of the Layers leaves the canvas where it was (the contract's drag-autoscroll scenario relies on it)
  await footerRow(page);
  await expect.poll(() => selection(page)).toEqual(['c-footer']);
  expect(await shown(page, 'c-footer'), 'the footer still below the stage after its row').toBe(0);
  // the Hero, in view, selected first: the find then changes the selection
  const search = page.getByPlaceholder('Search layers');
  await search.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Hero');
  await control(page, ROW, { args: { target: 'c-hero' } }).click();
  await expect.poll(() => selection(page)).toEqual(['c-hero']);
  await runDoor(page, BAR);
  await page.keyboard.type('@Footer');
  await page.keyboard.press('Enter');
  await expect.poll(() => selection(page)).toEqual(['c-footer']);
  await expect.poll(() => shown(page, 'c-footer'), { message: 'the footer in view after the find' }).toBeGreaterThan(40);
});

test('an element inserted below the stage is brought into view', runs(OPEN, ZOOM_100, ROW, INSERT_PANEL, TILE), async ({ page }) => {
  await footerRow(page);
  await toTop(page);
  await runDoor(page, INSERT_PANEL);
  await control(page, TILE, { args: { entry: 'paragraph' } }).first().click();
  const made = (await selection(page))[0] ?? '';
  expect(made).not.toBe('c-footer');
  await expect.poll(() => shown(page, made), { message: 'the new paragraph in view' }).toBeGreaterThan(0);
});

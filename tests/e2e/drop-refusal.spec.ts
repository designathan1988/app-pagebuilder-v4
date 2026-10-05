// Small targets never take a side drop, and a drop over a link stays beside it (spec drag-layout, Problems in Pager 4;
// the user's real-use audit, A3.37), with a hand's gestures (gradual, then resting a moment). A Link tile carried to
// the middle of a Link in the Hero's Actions lands beside it, in the Actions, and no Row is created. At 25 %, a
// Paragraph tile carried into the 7 px gap between two buttons of the Actions (a row) creates no Row and lands between
// them. The
// document is read through the read-only test port.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs, openStyleControl } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const PALETTE_DRAG = 'element.insert#canvas-drag-palette-tile-drop-proposal';
const ZOOM_25 = 'view.zoomTo#menu-zoom-25';
const DISPLAY = 'style.set#inspector-display';
const COLUMN_GAP = 'style.set#inspector-column-gap';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface Tree {
  readonly id: string;
  readonly name: string;
  readonly children: readonly Tree[];
}
type Port = { document: () => { pages: { tree: Tree }[] } };

const tree = async (page: Page): Promise<Tree> => {
  const read = await page.evaluate(() => (window as unknown as { __builderTestPort?: Port }).__builderTestPort?.document().pages[0]?.tree);
  if (read === undefined) throw new Error('the test port reads no page');
  return read;
};
const names = (n: Tree): string[] => [n.name, ...n.children.flatMap(names)];
const find = (n: Tree, id: string): Tree | undefined => (n.id === id ? n : n.children.map((c) => find(c, id)).find((x) => x !== undefined));
// the screen boxes of a node's element and of its children's, through the frame's content box and CSS zoom
function boxes(page: Page, id: string): Promise<{ own: Box; children: Box[] }> {
  return page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const style = getComputedStyle(iframe);
    const left = frame.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
    const top = frame.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
    const screen = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: left + r.left * zoom, y: top + r.top * zoom, width: r.width * zoom, height: r.height * zoom };
    };
    const el = doc.querySelector(`[data-node="${node}"]`);
    if (!el) throw new Error(`the canvas does not draw ${node}`);
    return { own: screen(el), children: [...el.children].filter((c) => c.hasAttribute('data-node')).map(screen) };
  }, id);
}
// a tile carried as a hand does: pressed, moved in many small steps, rested a moment trembling, released
async function carryTile(page: Page, entry: string, at: { readonly x: number; readonly y: number }): Promise<void> {
  // brought into view first, as a person scrolls the palette to it
  await control(page, TILE, { args: { entry } }).scrollIntoViewIfNeeded();
  const tile = await control(page, TILE, { args: { entry } }).boundingBox();
  if (tile === null) throw new Error(`the ${entry} tile is not laid out`);
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2);
  await page.mouse.down();
  await page.mouse.move(tile.x + tile.width / 2 + 12, tile.y + tile.height / 2 + 12, { steps: 4 });
  await page.mouse.move(at.x, at.y, { steps: 25 });
  for (let k = 0; k < 8; k++) {
    await page.mouse.move(at.x + (k % 3) - 1, at.y + (k % 2));
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-actions"]')).toHaveCount(1);
  await control(page, ROW, { args: { target: 'n-actions' } }).click();
  await runDoor(page, INSERT_PANEL);
});

test('a Link tile carried to the middle of a Link lands beside it, in the same parent, and creates no Row', runs(OPEN, ROW, INSERT_PANEL, TILE, PALETTE_DRAG), async ({ page }) => {
  await control(page, TILE, { args: { entry: 'link' } }).click();
  await expect.poll(async () => find(await tree(page), 'n-actions')?.children.map((c) => c.name)).toEqual(['Link']);
  const [link] = (await boxes(page, 'n-actions')).children;
  if (link === undefined) throw new Error('the Link is not drawn');
  await carryTile(page, 'link', { x: link.x + link.width * 0.6, y: link.y + link.height / 2 });
  await expect.poll(async () => find(await tree(page), 'n-actions')?.children.map((c) => c.name)).toEqual(['Link', 'Link 2']);
  expect(names(await tree(page))).not.toContain('Row');
});

test('at 25 % a tile carried into the 7 px gap between two buttons creates no Row and lands between them', runs(OPEN, ROW, INSERT_PANEL, TILE, PALETTE_DRAG, ZOOM_25, DISPLAY, COLUMN_GAP), async ({ page }) => {
  // the Actions (selected) a row with a 28 px gap: 7 screen px at 25 %, as the audit measured; then its two buttons
  for (const [ref, value] of [[DISPLAY, 'flex'], [COLUMN_GAP, '28px']] as const) {
    // the column gap is drawn in the Gap row's details since DEC-64 (QA 358): opened as a person opens it
    await openStyleControl(page, ref);
    await control(page, ref).locator('input').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
  }
  await control(page, TILE, { args: { entry: 'button' } }).click();
  await control(page, TILE, { args: { entry: 'button' } }).click();
  await expect.poll(async () => find(await tree(page), 'n-actions')?.children.map((c) => c.name)).toEqual(['Button', 'Button 2']);
  await openMenu(page, 'zoom');
  await control(page, ZOOM_25).click();
  await expect.poll(() => page.locator('.frame__page').evaluate((el) => (el as HTMLIFrameElement).currentCSSZoom)).toBeCloseTo(0.25, 2);
  const { children } = await boxes(page, 'n-actions');
  const [one, two] = children;
  if (one === undefined || two === undefined) throw new Error('the buttons are not drawn');
  await carryTile(page, 'paragraph', { x: (one.x + one.width + two.x) / 2, y: one.y + one.height / 2 });
  await expect.poll(async () => find(await tree(page), 'n-actions')?.children.map((c) => c.name)).toEqual(['Button', 'Paragraph', 'Button 2']);
  expect(names(await tree(page))).not.toContain('Row');
});

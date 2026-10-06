// Dragging a selection of several (spec drag-reorder-canvas, Problems in Pager 11, drag;
// the user's real-use audit, item 3.4), with a hand's gestures: the two cards' titles, clicked and Shift+clicked on the
// canvas, one of them carried to the gap between the Hero's Intro and Actions: both land there in their order, one
// undo step puts both back. A press on one of them released without a drag selects that one alone. The document, the
// selection and the history are read through the read-only test port.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const CLICK = 'selection.select#canvas-click-element-or-page';
const ADD = 'selection.add#canvas-click-element-shift';
const MOVE = 'element.moveTo#canvas-drag-canvas-element-before-after';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface Tree {
  readonly id: string;
  readonly children: readonly Tree[];
}
type Port = { document: () => { pages: { tree: Tree }[] }; selection: () => string[]; history: () => { undoSteps: number } };

const port = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __builderTestPort: Port }).__builderTestPort;
    return { tree: p.document().pages[0]?.tree, selection: p.selection(), undoSteps: p.history().undoSteps };
  });
async function childrenOf(page: Page, id: string): Promise<readonly string[]> {
  const { tree } = await port(page);
  const find = (n: Tree): Tree | undefined => (n.id === id ? n : n.children.map(find).find((x) => x !== undefined));
  return (tree === undefined ? undefined : find(tree))?.children.map((c) => c.id) ?? [];
}
function nodeBox(page: Page, id: string): Promise<Box> {
  return page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const style = getComputedStyle(iframe);
    const left = frame.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
    const top = frame.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
    const el = doc.querySelector(`[data-node="${node}"]`);
    if (!el) throw new Error(`the canvas does not draw ${node}`);
    const r = el.getBoundingClientRect();
    return { x: left + r.left * zoom, y: top + r.top * zoom, width: r.width * zoom, height: r.height * zoom };
  }, id);
}
const inside = (b: Box) => ({ x: b.x + b.width / 3, y: b.y + b.height / 2 });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-b-title"]')).toHaveCount(1);
  // the first card's title clicked, the second's Shift+clicked
  const a = inside(await nodeBox(page, 'n-card-a-title'));
  const b = inside(await nodeBox(page, 'n-card-b-title'));
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-card-a-title', 'n-card-b-title']);
});

test('dragging one of two selected titles drags both, in their order, and one undo step puts both back', runs(OPEN, CLICK, ADD, MOVE), async ({ page }) => {
  const before = await port(page);
  const from = inside(await nodeBox(page, 'n-card-b-title'));
  const intro = await nodeBox(page, 'n-intro');
  const actions = await nodeBox(page, 'n-actions');
  const gap = { x: intro.x + intro.width * 0.4, y: (intro.y + intro.height + actions.y) / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(gap.x, gap.y, { steps: 25 });
  for (let k = 0; k < 6; k++) {
    await page.mouse.move(gap.x + (k % 3) - 1, gap.y + (k % 2));
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await expect.poll(() => childrenOf(page, 'n-hero')).toEqual(['n-title', 'n-intro', 'n-card-a-title', 'n-card-b-title', 'n-actions']);
  expect((await port(page)).undoSteps).toBe(before.undoSteps + 1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => childrenOf(page, 'n-hero')).toEqual(['n-title', 'n-intro', 'n-actions']);
  expect(await childrenOf(page, 'n-card-a')).toEqual(['n-card-a-title']);
  expect(await childrenOf(page, 'n-card-b')).toEqual(['n-card-b-title']);
});

test('a press on one of two selected titles released without a drag selects that one alone', runs(OPEN, CLICK, ADD), async ({ page }) => {
  const at = inside(await nodeBox(page, 'n-card-b-title'));
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await port(page)).selection).toEqual(['n-card-b-title']);
});

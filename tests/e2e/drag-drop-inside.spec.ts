// drag-drop-inside beyond its scenarios (spec/BEHAVIOUR.md#drag-drop-inside, drag): what
// the canvas draws while an element is dragged into a container (src/editor/canvas/chrome.tsx): an empty container
// outlined dashed with no line; a container with children at the slot of the pointer, with the line at that slot; the
// page root's own background as a receiver; and, over the dragged element's own subtree, its current place (Problems in
// Pager 1): the receiver outlined in the danger colour, no line, the label saying why, and a release that changes
// nothing. The document, the selection and the history are read through the read-only test port; the drawing is
// measured against the elements' boxes inside the frame, mapped to the screen through its CSS zoom.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const interactions = JSON.parse(fs.readFileSync('manifest/interactions.json', 'utf8')) as { constants: { id: string; value: unknown }[] };
const THRESHOLD = interactions.constants.find((c) => c.id === 'drag.threshold')?.value as number;

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
interface Port {
  readonly document: { pages: { tree: Tree }[] };
  readonly selection: string[];
  readonly undoSteps: number;
}

const port = (page: Page): Promise<Port> =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => unknown; selection: () => string[]; history: () => { undoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    return { document: p.document() as Port['document'], selection: p.selection(), undoSteps: p.history().undoSteps };
  });
async function childrenOf(page: Page, id: string): Promise<string[]> {
  const find = (n: Tree): Tree | undefined => (n.id === id ? n : n.children.map(find).find((x) => x !== undefined));
  const tree = (await port(page)).document.pages[0]?.tree;
  return (tree === undefined ? undefined : find(tree))?.children.map((c) => c.id) ?? [];
}

// the element's declared styles at the base breakpoint (the read-only test port)
type Styled = Tree & { readonly styles?: Record<string, Record<string, Record<string, string>>> };
async function declared(page: Page, id: string): Promise<Record<string, string>> {
  return page.evaluate((node) => {
    const port = (window as unknown as Record<string, { document: () => { pages: { tree: Styled }[] } }>).__builderTestPort;
    if (!port) throw new Error('the test port is missing');
    const doc = port.document();
    const find = (n: Styled): Styled | undefined => (n.id === node ? n : n.children.map((c) => find(c as Styled)).find((x) => x !== undefined));
    const tree = doc.pages[0]?.tree;
    return (tree === undefined ? undefined : find(tree)?.styles?.desktop?.base) ?? {};
  }, id);
}

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-a-title"]')).toHaveCount(1);
}

// the screen box of a node's element through the frame's CSS zoom, and the zoom
function screenBox(page: Page, id: string): Promise<Box & { readonly zoom: number }> {
  return page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const el = doc.querySelector(`[data-node="${node}"]`);
    if (!el) throw new Error(`the canvas does not draw ${node}`);
    const r = el.getBoundingClientRect();
    return { x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, width: r.width * zoom, height: r.height * zoom, zoom };
  }, id);
}

// a screen point of the page's own background, below every element
function pageBackground(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    for (let y = doc.documentElement.clientHeight - 2; y > 0; y -= 4) {
      const hit = doc.elementFromPoint(vw / 2, y);
      if (hit === doc.documentElement || hit === doc.body) return { x: frame.left + (vw / 2) * zoom, y: frame.top + y * zoom };
    }
    throw new Error('no point of the page lies outside every element');
  });
}

// two animation frames: the canvas chrome draws what it measures on its next frame, so a check that something is
// not drawn waits until it would have been
const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const near = (a: Box | null, b: Box) => a !== null && [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].every((d) => Math.abs(d) <= 1);
// the box of the one element a selector finds, or null when it finds none or several, read in one task of the page:
// counting first and then asking the box raced the chrome's next frame, whose removed element left the read waiting
async function boxOf(page: Page, selector: string): Promise<Box | null> {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  return boxes.length === 1 ? (boxes[0] ?? null) : null;
}

// presses at a point and starts the drag past drag.threshold
async function pressAndStart(page: Page, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + THRESHOLD + 2, at.y + THRESHOLD + 2, { steps: 3 });
}

const DOORS = ['project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.moveTo#canvas-drag-canvas-element-inside', 'element.moveTo#canvas-drag-canvas-element-before-after'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
  await openAurora(page);
});

test('over an empty container: it is outlined solid and filled as the receiver, no line, the label names it; the release puts the element in it', runs(...DOORS), async ({ page }) => {
  const actions = await screenBox(page, 'n-actions');
  await pressAndStart(page, centre(await screenBox(page, 'n-intro')));
  await page.mouse.move(centre(actions).x, centre(actions).y, { steps: 8 });
  const receiver = page.locator('[data-chrome="drop-receiver"]');
  await expect(receiver).toHaveAttribute('data-state', 'into');
  await expect.poll(() => boxOf(page, '[data-chrome="drop-receiver"]').then((b) => near(b, actions)), { message: 'Actions is outlined' }).toBe(true);
  expect(await receiver.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await expect(page.locator('[data-chrome="drop-line"]')).toHaveCount(0);
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('Inside Page › Hero › Actions');
  await page.mouse.up();
  expect(await childrenOf(page, 'n-actions')).toEqual(['n-intro']);
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);
});

test('inside a container with children, at the slot of the pointer: the line lies at that slot; the page root\'s background takes a drop at its end', runs(...DOORS), async ({ page }) => {
  // Hero's left padding, level with the top of the Title, past its top edge band (32 screen px, which covers all of
  // its top padding at the fit zoom: drag-reorder-canvas, Problems in Pager 6): inside Hero, first
  const hero = await screenBox(page, 'n-hero');
  const title = await screenBox(page, 'n-title');
  const padding = { x: hero.x + 20 * hero.zoom, y: title.y + title.height / 4 };
  expect(padding.y - hero.y).toBeGreaterThan(32);
  await pressAndStart(page, centre(await screenBox(page, 'n-actions')));
  await page.mouse.move(padding.x, padding.y, { steps: 8 });
  await expect(page.locator('[data-chrome="drop-receiver"]')).toHaveAttribute('data-state', 'between');
  await expect.poll(() => boxOf(page, '[data-chrome="drop-receiver"]').then((b) => near(b, hero)), { message: 'Hero is outlined' }).toBe(true);
  await expect.poll(async () => {
    const line = await boxOf(page, '[data-chrome="drop-line"]');
    return line !== null && Math.abs(line.y + line.height / 2 - title.y) <= 1;
  }, { message: 'the line lies at the top of Title' }).toBe(true);
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('Before Title · Page › Hero');
  await page.mouse.up();
  expect(await childrenOf(page, 'n-hero')).toEqual(['n-actions', 'n-title', 'n-intro']);

  // the page's own background below the footer: inside the page root, last
  const background = await pageBackground(page);
  await pressAndStart(page, centre(await screenBox(page, 'n-title')));
  await page.mouse.move(background.x, background.y, { steps: 8 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('After Footer · Page');
  await page.mouse.up();
  expect(await childrenOf(page, 'n-page')).toEqual(['n-hero', 'n-plans', 'n-footer', 'n-title']);
  expect((await port(page)).undoSteps).toBe(2);
});

test('over the dragged element\'s own subtree: its current place, drawn as any other, and the release changes nothing', runs(...DOORS), async ({ page }) => {
  // the empty Actions dragged over itself (a press on a container with children and a drag is a marquee:
  // marquee-select); where it is now: after the Intro, in the Hero (the user's correction of 2026-09-27)
  const actions = await screenBox(page, 'n-actions');
  const before = (await port(page)).document;
  await pressAndStart(page, { x: centre(actions).x - 40, y: centre(actions).y - 3 });
  await page.mouse.move(centre(actions).x + 40, centre(actions).y, { steps: 8 });
  await expect(page.locator('[data-chrome="drop-receiver"]')).toHaveAttribute('data-state', 'between');
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('After Intro · Page › Hero');
  await page.mouse.up();
  const after = await port(page);
  expect(after.document).toEqual(before);
  expect(after.undoSteps).toBe(0);
  expect(after.selection).toEqual(['n-actions']);
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);
});

test('a container is dragged by its name label on the canvas; a press and drag on its own empty area is still a marquee', runs(...DOORS, 'selection.marquee#canvas-drag-empty-area-page-or-container'), async ({ page }) => {
  const hero = await screenBox(page, 'n-hero');
  const padding = { x: centre(hero).x, y: hero.y + 20 * hero.zoom };
  // clicked in its padding, Hero is selected and shows its label; pressed there and dragged below the Footer, it
  // lands last in the page
  await page.mouse.click(padding.x, padding.y);
  const label = page.locator('[data-chrome="label"][data-label-for="n-hero"]');
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  if (box === null) throw new Error('the hover label is not laid out');
  const background = await pageBackground(page);
  await pressAndStart(page, centre(box));
  await nextFrames(page);
  await expect(page.locator('[data-chrome="band"]')).toHaveCount(0);
  await page.mouse.move(background.x, background.y, { steps: 8 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('After Footer · Page');
  await page.mouse.up();
  expect(await childrenOf(page, 'n-page')).toEqual(['n-plans', 'n-footer', 'n-hero']);
  const moved = await port(page);
  expect(moved.selection).toEqual(['n-hero']);
  expect(moved.undoSteps).toBe(1);

  // Hero's own padding pressed and dragged (its top-right corner, away from its label): while the Hero is selected
  // its padding belongs to its bands (the audit's item 4.1), so the press drags the top padding and no marquee starts;
  // the page itself moves as a marquee where nothing is selected (the marquee scenarios select the page first)
  const heroNow = await screenBox(page, 'n-hero');
  await pressAndStart(page, { x: heroNow.x + heroNow.width - 20 * heroNow.zoom, y: heroNow.y + 20 * heroNow.zoom });
  await page.mouse.move(centre(heroNow).x, centre(heroNow).y, { steps: 4 });
  await expect(page.locator('[data-chrome="band"]'), 'the band takes the press, not a marquee').toHaveCount(0);
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);
  await page.mouse.up();
  expect(parseFloat((await declared(page, 'n-hero'))['padding-top'] ?? '0'), 'the drag grew the top padding').toBeGreaterThan(56);
  expect(await childrenOf(page, 'n-page'), 'nothing moved').toEqual(['n-plans', 'n-footer', 'n-hero']);
  expect((await port(page)).selection).toEqual(['n-hero']);
});

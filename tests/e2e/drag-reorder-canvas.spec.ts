// drag-reorder-canvas beyond its scenarios (spec/BEHAVIOUR.md#drag-reorder-canvas, drag):
// what the canvas draws while an element is dragged (src/editor/canvas/chrome.tsx): the insertion line across the
// receiver in the gap where the element will land, the receiver's outline, the drop label beside the line over no text,
// the dragged element's outline dashed and its name label hidden (Problems in Pager 1); the hysteresis that keeps a
// drawn proposal until the pointer has moved drag.hysteresis screen pixels; and a press that moves less than
// drag.threshold, which only selects. The document and the selection are read through the read-only test port;
// the drawing is measured against the elements' boxes inside the frame, mapped to the screen through its CSS zoom.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const interactions = JSON.parse(fs.readFileSync('manifest/interactions.json', 'utf8')) as { constants: { id: string; value: unknown }[] };
const constant = (id: string) => {
  const value = interactions.constants.find((c) => c.id === id)?.value;
  if (typeof value !== 'number') throw new Error(`no number ${id}`);
  return value;
};
const THRESHOLD = constant('drag.threshold');
const HYSTERESIS = constant('drag.hysteresis');

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface Port {
  readonly document: { pages: { tree: Tree }[] };
  readonly selection: string[];
  readonly undoSteps: number;
}
interface Tree {
  readonly id: string;
  readonly children: readonly Tree[];
}

const port = (page: Page): Promise<Port> =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => unknown; selection: () => string[]; history: () => { undoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    return { document: p.document() as Port['document'], selection: p.selection(), undoSteps: p.history().undoSteps };
  });
// the ids of a node's children in the document the port reads
async function childrenOf(page: Page, id: string): Promise<string[]> {
  const find = (n: Tree): Tree | undefined => (n.id === id ? n : n.children.map(find).find((x) => x !== undefined));
  const tree = (await port(page)).document.pages[0]?.tree;
  return (tree === undefined ? undefined : find(tree))?.children.map((c) => c.id) ?? [];
}

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-a-title"]')).toHaveCount(1);
}

// the screen box of a node's element, through the frame's CSS zoom
function screenBox(page: Page, id: string): Promise<Box> {
  return page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const el = doc.querySelector(`[data-node="${node}"]`);
    if (!el) throw new Error(`the canvas does not draw ${node}`);
    const r = el.getBoundingClientRect();
    return { x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, width: r.width * zoom, height: r.height * zoom };
  }, id);
}

// the screen boxes of every run of text on the page
function textBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      if ((text.textContent ?? '').trim() === '') continue;
      const range = doc.createRange();
      range.selectNodeContents(text);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) boxes.push({ x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, width: r.width * zoom, height: r.height * zoom });
    }
    return boxes;
  });
}

// two animation frames: the canvas chrome draws what it measures on its next frame, so a check that something is
// not drawn waits until it would have been
const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
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
const close = (a: number, b: number) => Math.abs(a - b) <= 1;

// presses on a node's centre and starts the drag past drag.threshold, the pointer still over the node
async function pressAndStart(page: Page, box: Box) {
  const at = centre(box);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + THRESHOLD + 2, at.y + THRESHOLD + 2, { steps: 3 });
}

const DOORS = ['project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.moveTo#canvas-drag-canvas-element-before-after'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
  await openAurora(page);
});

test('while dragging: the line lies across the receiver where the element lands, the receiver is outlined, the label names it beside the line; the source is dashed and unlabelled', runs(...DOORS), async ({ page }) => {
  const hero = await screenBox(page, 'n-hero');
  const title = await screenBox(page, 'n-title');
  const intro = await screenBox(page, 'n-intro');
  const actions = await screenBox(page, 'n-actions');

  // the Heading over the upper half of the Paragraph: before it, and no sibling but the Heading itself before it, so
  // at the Paragraph's top
  await pressAndStart(page, title);
  await page.mouse.move(centre(intro).x, intro.y + intro.height * 0.2, { steps: 8 });
  await expect.poll(async () => {
    const line = await boxOf(page, '[data-chrome="drop-line"]');
    return line !== null && close(line.y + line.height / 2, intro.y);
  }, { message: 'the line lies at the top of Intro' }).toBe(true);
  const label = page.locator('[data-chrome="drop-label"]');
  await expect(label).toHaveText('Before Intro · Page › Hero');

  // the Heading over the lower half of the Paragraph: after it, in the gap before Actions
  await page.mouse.move(centre(intro).x, intro.y + intro.height * 0.8, { steps: 4 });
  const gap = (intro.y + intro.height + actions.y) / 2;
  await expect
    .poll(async () => {
      const line = await boxOf(page, '[data-chrome="drop-line"]');
      return line !== null && close(line.y + line.height / 2, gap) && close(line.x, hero.x) && close(line.width, hero.width);
    }, { message: `the line crosses Hero at y ${gap}, between Intro and Actions` })
    .toBe(true);
  await expect.poll(async () => {
    const receiver = await boxOf(page, '[data-chrome="drop-receiver"]');
    return receiver !== null && [receiver.x - hero.x, receiver.y - hero.y, receiver.width - hero.width, receiver.height - hero.height].every((d) => Math.abs(d) <= 1);
  }, { message: 'Hero is outlined as the receiver' }).toBe(true);
  await expect(label).toHaveText('Between Intro and Actions · Page › Hero');
  await expect(label).toHaveAttribute('data-placement', /above|inside|below/);
  const labelBox = await label.boundingBox();
  if (labelBox === null) throw new Error('the drop label is not laid out');
  expect(Math.min(Math.abs(labelBox.y + labelBox.height - gap), Math.abs(labelBox.y - gap)), 'the label sits beside the line').toBeLessThanOrEqual(12);
  expect((await textBoxes(page)).filter((t) => overlaps(labelBox, t)), 'the label covers no text').toEqual([]);
  // the dragged element: no outline (the ghost chip says what is dragged), and its name label hidden
  expect(await page.locator('[data-chrome="selection"]').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  expect(await page.locator('[data-chrome="label"]').evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');

  // the release lands where the line was, and every mark of the drag goes
  await page.mouse.up();
  expect(await childrenOf(page, 'n-hero')).toEqual(['n-intro', 'n-title', 'n-actions']);
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);
  await expect.poll(() => page.locator('[data-chrome="label"]').evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
  expect(await page.locator('[data-chrome="selection"]').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');

  // then Actions over the upper half of the Heading, released: the line lies in the gap after Intro, and the
  // document follows it
  const [introNow, titleNow] = [await screenBox(page, 'n-intro'), await screenBox(page, 'n-title')];
  await pressAndStart(page, await screenBox(page, 'n-actions'));
  await page.mouse.move(centre(titleNow).x, titleNow.y + titleNow.height * 0.25, { steps: 8 });
  const between = (introNow.y + introNow.height + titleNow.y) / 2;
  await expect.poll(async () => {
    const line = await boxOf(page, '[data-chrome="drop-line"]');
    return line !== null && close(line.y + line.height / 2, between);
  }, { message: `the line lies at y ${between}, between Intro and Title` }).toBe(true);
  await page.mouse.up();
  expect(await childrenOf(page, 'n-hero')).toEqual(['n-intro', 'n-actions', 'n-title']);
  expect((await port(page)).undoSteps, 'one undo step per drop').toBe(2);
});

test('a drawn proposal holds until the pointer has moved drag.hysteresis pixels from where it was taken', runs(...DOORS), async ({ page }) => {
  const title = await screenBox(page, 'n-title');
  const intro = await screenBox(page, 'n-intro');
  const middle = title.y + title.height / 2;
  const x = centre(title).x;

  // just above the Heading's middle: before it; then just below, closer than drag.hysteresis: still before it
  await pressAndStart(page, intro);
  await page.mouse.move(x, middle - 1, { steps: 1 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('Before Title · Page › Hero');
  await page.mouse.move(x, middle - 1 + HYSTERESIS / 2, { steps: 1 });
  await page.mouse.up();
  expect(await childrenOf(page, 'n-hero')).toEqual(['n-intro', 'n-title', 'n-actions']);

  // below the middle again, now farther than drag.hysteresis from where "before" was taken: after it
  const titleNow = await screenBox(page, 'n-title');
  const middleNow = titleNow.y + titleNow.height / 2;
  await pressAndStart(page, await screenBox(page, 'n-intro'));
  await page.mouse.move(x, middleNow - 1, { steps: 1 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('Before Title · Page › Hero');
  await page.mouse.move(x, middleNow - 1 + HYSTERESIS + 2, { steps: 1 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('Between Title and Actions · Page › Hero');
  await page.mouse.up();
  expect(await childrenOf(page, 'n-hero')).toEqual(['n-title', 'n-intro', 'n-actions']);
});

test('the drop label of a line that is closed between two runs of text moves to the far end of the line: it covers no text there either', runs(...DOORS), async ({ page }) => {
  // the real-use audit of the canvas, 2026-09-28: dragging Intro over the lower half of Title drew the line between
  // Title and Intro — two runs of text with a few pixels between them — and the label, with no free place at the
  // line's start, fell back to "below", over the paragraph's own text. The rule's invariant is that no label covers
  // page content: the three places are tried at the line's far end too.
  const title = await screenBox(page, 'n-title');
  const intro = await screenBox(page, 'n-intro');
  await pressAndStart(page, intro);
  await page.mouse.move(centre(title).x, title.y + title.height * 0.8, { steps: 10 });
  const label = page.locator('[data-chrome="drop-label"]');
  await expect(label).toHaveText('Between Title and Actions · Page › Hero');
  const labelBox = await label.boundingBox();
  if (labelBox === null) throw new Error('the drop label is not laid out');
  expect((await textBoxes(page)).filter((t) => overlaps(labelBox, t)), 'the label covers no text').toEqual([]);
  await page.mouse.up();
  expect(await childrenOf(page, 'n-hero')).toEqual(['n-title', 'n-intro', 'n-actions']);
});

test('a press that moves less than drag.threshold only selects: no drag is drawn and the document is unchanged', runs(...DOORS.slice(0, 2)), async ({ page }) => {
  const title = await screenBox(page, 'n-title');
  const before = (await port(page)).document;
  const at = centre(title);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + THRESHOLD - 1, { steps: 2 });
  // held: the element is selected, its outline is the selection's, and nothing of a drag is drawn
  expect((await port(page)).selection).toEqual(['n-title']);
  await expect.poll(() => page.locator('[data-chrome="selection"]').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await nextFrames(page);
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);
  await page.mouse.up();
  const after = await port(page);
  expect(after.document).toEqual(before);
  expect(after.selection).toEqual(['n-title']);
  expect(after.undoSteps).toBe(0);
});

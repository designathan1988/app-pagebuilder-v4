// multi-select-click beyond its scenarios (spec/BEHAVIOUR.md#multi-select-click, multi):
// what the canvas draws while several elements are selected (src/editor/canvas/chrome.tsx): each one's own outline, the
// dashed outline of their union and one label counting them, over no text; and that a Shift+click on the page root
// adds nothing (the door's target is an element). The selection is read through the read-only test port; the
// outlines are measured against the elements' boxes inside the frame, mapped to the screen through its CSS zoom.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const selection = (page: Page) => page.evaluate(() => (window as unknown as Record<string, { selection: () => string[] }>).__builderTestPort?.selection());

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-a-title"]')).toHaveCount(1);
}

// the screen box of a node's element, through the frame's CSS zoom, or of the frame's whole page (null)
function screenBox(page: Page, id: string | null): Promise<Box> {
  return page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    if (node === null) return { x: frame.left, y: frame.top, width: frame.width, height: frame.height };
    const el = doc.querySelector(`[data-node="${node}"]`);
    if (!el) throw new Error(`the canvas does not draw ${node}`);
    const r = el.getBoundingClientRect();
    return { x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, width: r.width * zoom, height: r.height * zoom };
  }, id);
}

const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const near = (a: Box, b: Box) => [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].every((d) => Math.abs(d) <= 1);
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

interface Drawn {
  // the screen boxes of the nodes asked for, as the page lays them out
  readonly nodes: Record<string, Box>;
  // what the canvas chrome draws: each selection outline, the union outline, the label
  readonly outlines: Box[];
  readonly unions: Box[];
  readonly labels: Box[];
  // every run of text on the page
  readonly texts: Box[];
}

// The page's elements and the canvas chrome, read at one instant (one task of the page, which no frame can split):
// an outline is compared with its element as the element is while the outline is drawn. Reading them apart, a
// count then each box, raced the chrome's next frame: the count saw the outline it was about to remove, and the box
// of the removed one waited out the poll's whole time.
function drawn(page: Page, ids: readonly string[]): Promise<Drawn> {
  return page.evaluate((nodeIds) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const onScreen = (r: DOMRect) => ({ x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, width: r.width * zoom, height: r.height * zoom });
    const nodes: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const id of nodeIds) {
      const el = doc.querySelector(`[data-node="${id}"]`);
      if (!el) throw new Error(`the canvas does not draw ${id}`);
      nodes[id] = onScreen(el.getBoundingClientRect());
    }
    const chrome = (selector: string) =>
      [...document.querySelectorAll(selector)].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
    const texts: { x: number; y: number; width: number; height: number }[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      if ((text.textContent ?? '').trim() === '') continue;
      const range = doc.createRange();
      range.selectNodeContents(text);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) texts.push(onScreen(r));
    }
    return { nodes, outlines: chrome('[data-chrome="selection"]'), unions: chrome('[data-chrome="union"]'), labels: chrome('[data-chrome="label"]'), texts };
  }, ids);
}

// which node each selection outline lies on ('elsewhere' when it lies on none of them), in the order drawn
const outlinedNodes = (d: Drawn) => d.outlines.map((b) => Object.keys(d.nodes).find((id) => near(b, d.nodes[id] as Box)) ?? 'elsewhere');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
});

test(
  'several selected: each element has its own outline, their union is outlined dashed, one label counts them over no text; back to one, the label names it',
  runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'selection.add#canvas-click-element-shift', 'selection.toggle#canvas-click-element-ctrl'),
  async ({ page }) => {
    await openAurora(page);
    const IDS = ['n-title', 'n-card-a-title'];
    // where the two elements lie before any click: a click that selects moves nothing on the page
    const before = (await drawn(page, IDS)).nodes;
    const stayed = (d: Drawn) => IDS.every((id) => near(d.nodes[id] as Box, before[id] as Box));
    const title = before['n-title'] as Box;
    const card = before['n-card-a-title'] as Box;
    await page.mouse.click(centre(title).x, centre(title).y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre(card).x, centre(card).y);
    await page.keyboard.up('Shift');
    expect(await selection(page)).toEqual(['n-title', 'n-card-a-title']);

    // each selected element has one outline of its own, on its box, and nothing else is outlined; their union has
    // one outline, on the union of their boxes: all read at one instant, the elements as they are while outlined
    await expect
      .poll(
        async () => {
          const d = await drawn(page, IDS);
          const around = union(d.nodes['n-title'] as Box, d.nodes['n-card-a-title'] as Box);
          return { outlined: outlinedNodes(d).sort(), union: d.unions.map((b) => near(b, around)) };
        },
        { message: 'an outline on each selected element and one on their union' },
      )
      .toEqual({ outlined: ['n-card-a-title', 'n-title'], union: [true] });
    expect(await page.locator('[data-chrome="union"]').evaluate((el) => getComputedStyle(el).outlineStyle), 'the union is dashed').toBe('dashed');
    // one label, counting them, over no text of the page
    const label = page.locator('[data-chrome="label"]');
    await expect(label).toHaveCount(1);
    // the count, then the size of the box holding them (the canonical "3 elements selected 1248 × 390")
    await expect(label.locator('.chrome__name')).toHaveText('2 elements selected');
    await expect(label.locator('[data-chrome="label-size"]')).toHaveText(/^\d+ × \d+$/);
    await expect(label).toHaveAttribute('data-placement', /above|inside|below/);
    const placed = await drawn(page, IDS);
    expect(placed.labels, 'one label is laid out').toHaveLength(1);
    expect(
      placed.texts.filter((t) => overlaps(placed.labels[0] as Box, t)),
      'the label covers no text',
    ).toEqual([]);
    expect(stayed(placed), 'a click that selects moves nothing on the page').toBe(true);

    // Ctrl+click takes the card title out: one outline, on the title, no union, the label names the title and its tag
    await page.keyboard.down('Control');
    await page.mouse.click(centre(card).x, centre(card).y);
    await page.keyboard.up('Control');
    expect(await selection(page)).toEqual(['n-title']);
    await expect(label).toHaveText(/Title\s*h1/);
    await expect
      .poll(
        async () => {
          const d = await drawn(page, IDS);
          return { outlined: outlinedNodes(d), unions: d.unions.length };
        },
        { message: 'one outline, on the title alone, and no union' },
      )
      .toEqual({ outlined: ['n-title'], unions: 0 });
    expect(stayed(await drawn(page, IDS)), 'a Ctrl+click moves nothing on the page').toBe(true);
  },
);

test('a Shift+click on empty page area adds nothing: the page root is never added', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'selection.add#canvas-click-element-shift'), async ({ page }) => {
  await openAurora(page);
  const title = await screenBox(page, 'n-title');
  await page.mouse.click(centre(title).x, centre(title).y);
  // a point of the page that no element covers: the bottom of the frame, below the footer
  const frame = await screenBox(page, null);
  const empty = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const frameBox = iframe.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    for (let y = vh - 2; y > 0; y -= 4) {
      const hit = doc.elementFromPoint(vw / 2, y);
      if (hit === doc.documentElement || hit === doc.body) return { x: frameBox.left + (vw / 2) * zoom, y: frameBox.top + y * zoom };
    }
    return null;
  });
  if (empty === null) throw new Error(`no point of the page (${JSON.stringify(frame)}) lies outside every element`);
  await page.keyboard.down('Shift');
  await page.mouse.click(empty.x, empty.y);
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual(['n-title']);
  await expect(page.locator('[data-chrome="selection"]')).toHaveCount(1);
});

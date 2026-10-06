// palette-drag-insert beyond its scenarios (spec/BEHAVIOUR.md#palette-drag-insert, drag). A
// press on a palette tile is split by the pointer owner (src/editor/input/pointer.ts) at drag.threshold: released below
// it, it is the tile's click and inserts at the selection; moved past it, it is a creation drag, which inserts only
// where it is dropped on the page, so released outside the page, or back on the tile it started from, it inserts
// nothing. While it goes on, the canvas chrome (src/editor/canvas/chrome.tsx) draws the drop indicator of a move, its
// label reading "Insert Paragraph · between Title and Intro · Page › Hero" (Problems in Pager 1), the status bar says
// the same, or, off the page, "Outside the page — release to cancel." (Problems in Pager 2); where the element's
// command refuses it the indicator is refused, with that refusal and no line (Problems in Pager 3); and the ghost, the
// element's icon and name, follows the pointer at drag.ghostOffset (Problems in Pager 4). The document, the selection
// and the history are read through the read-only test port; the drawing is measured against the elements' boxes inside
// the frame.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const PALETTE_DRAG = 'element.insert#canvas-drag-palette-tile-drop-proposal';
const interactions = JSON.parse(fs.readFileSync('manifest/interactions.json', 'utf8')) as { constants: { id: string; value: unknown }[] };
const THRESHOLD = interactions.constants.find((c) => c.id === 'drag.threshold')?.value;
const GHOST_OFFSET = interactions.constants.find((c) => c.id === 'drag.ghostOffset')?.value;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface Point {
  readonly x: number;
  readonly y: number;
}
interface Tree {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly children: readonly Tree[];
}
const port = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => unknown; selection: () => string[]; history: () => { undoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    return { document: p.document() as { pages: { tree: Tree }[] }, selection: p.selection(), undoSteps: p.history().undoSteps };
  });
const rootChildren = async (page: Page) => (await port(page)).document.pages[0]?.tree.children.map((c) => `${c.type} ${c.name}`);
// a node's children in the document the port reads
async function childrenOf(page: Page, id: string): Promise<readonly Tree[]> {
  const find = (n: Tree): Tree | undefined => (n.id === id ? n : n.children.map(find).find((x) => x !== undefined));
  const tree = (await port(page)).document.pages[0]?.tree;
  return (tree === undefined ? undefined : find(tree))?.children ?? [];
}

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator(`[data-door="${OPEN}"]`).click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-perk-two-text"]')).toHaveCount(1);
}

// the screen box of a node's element: its box in the frame, through the frame's content box and CSS zoom
function screenBox(page: Page, id: string): Promise<Box> {
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
// two animation frames: the canvas chrome draws what it measures on its next frame, so a check that something is
// not drawn waits until it would have been
const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const centre = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const close = (a: number, b: number) => Math.abs(a - b) <= 1;
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

// the centre of a tile on the screen
async function tileCentre(page: Page, entry: string): Promise<Point> {
  const tile = control(page, TILE, { args: { entry } });
  await tile.scrollIntoViewIfNeeded();
  const box = await tile.boundingBox();
  if (box === null) throw new Error(`the tile of ${entry} is not laid out`);
  return centre(box);
}

// a point of the stage outside the page, where the stage itself is hit
async function stagePoint(page: Page): Promise<Point> {
  const found = await page.evaluate(() => {
    const stage = document.querySelector('.stage');
    const frame = document.querySelector('.frame');
    if (!stage || !frame) return null;
    const s = stage.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const candidates = [
      { x: (s.left + f.left) / 2, y: f.top + f.height / 2 },
      { x: (f.right + s.right) / 2, y: f.top + f.height / 2 },
      { x: f.left + f.width / 2, y: (f.bottom + s.bottom) / 2 },
    ];
    return candidates.find((p) => document.elementFromPoint(p.x, p.y) === stage) ?? null;
  });
  if (found === null) throw new Error('no point of the stage lies outside the page');
  return found;
}

// presses a tile and moves past drag.threshold, still over the palette; returns where the pointer is
async function startTileDrag(page: Page, entry: string): Promise<Point> {
  const threshold = THRESHOLD as number;
  const at = await tileCentre(page, entry);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  const moved = { x: at.x + threshold + 2, y: at.y + threshold + 2 };
  await page.mouse.move(moved.x, moved.y, { steps: 3 });
  return moved;
}

// the ghost sits at drag.ghostOffset from the pointer, with the tile's own icon and the element's name
async function expectGhostAt(page: Page, pointer: Point, entry: string, name: string) {
  const [dx, dy] = GHOST_OFFSET as [number, number];
  const ghost = page.locator('[data-chrome="ghost"]');
  await expect.poll(async () => {
    const box = await boxOf(page, '[data-chrome="ghost"]');
    return box !== null && close(box.x, pointer.x + dx) && close(box.y, pointer.y + dy);
  }, { message: `the ghost sits at ${pointer.x + dx}, ${pointer.y + dy}` }).toBe(true);
  await expect(ghost).toHaveText(name);
  const tileIcon = await control(page, TILE, { args: { entry } }).locator('use').getAttribute('href');
  expect(tileIcon, 'the tile draws an icon').not.toBeNull();
  expect(await ghost.locator('use').getAttribute('href'), 'the ghost draws the tile\'s icon').toBe(tileIcon);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
});

test('a tile press is its click below drag.threshold and a creation drag past it, which inserts nothing off the page', runs(INSERT_PANEL, TILE, PALETTE_DRAG), async ({ page }) => {
  expect(THRESHOLD).toBe(4);
  const threshold = THRESHOLD as number;
  await runDoor(page, INSERT_PANEL);

  // below the threshold: the tile's click, released where the pointer is, inserts its entry at the selection
  const paragraph = await tileCentre(page, 'paragraph');
  await page.mouse.move(paragraph.x, paragraph.y);
  await page.mouse.down();
  await page.mouse.move(paragraph.x + threshold - 2, paragraph.y + 1, { steps: 2 });
  await page.mouse.up();
  expect(await rootChildren(page)).toEqual(['paragraph Paragraph']);
  expect((await port(page)).undoSteps).toBe(1);

  // past the threshold and released on the stage outside the page: no proposal, nothing inserted, no undo step
  const stage = await stagePoint(page);
  await startTileDrag(page, 'heading');
  await page.mouse.move(stage.x, stage.y, { steps: 12 });
  await page.mouse.up();
  expect(await rootChildren(page)).toEqual(['paragraph Paragraph']);
  expect((await port(page)).undoSteps).toBe(1);

  // past the threshold and back onto the tile it started from: still a drag, never the tile's click
  const heading = await tileCentre(page, 'heading');
  await page.mouse.move(heading.x, heading.y);
  await page.mouse.down();
  await page.mouse.move(heading.x + threshold + 6, heading.y, { steps: 3 });
  await page.mouse.move(heading.x, heading.y, { steps: 3 });
  await page.mouse.up();
  expect(await rootChildren(page)).toEqual(['paragraph Paragraph']);
  expect((await port(page)).undoSteps).toBe(1);
});

test('while a tile is dragged over the page: the line where it lands, the label and the status bar name the insert, the ghost follows the pointer, and the release inserts it there', runs(OPEN, INSERT_PANEL, PALETTE_DRAG), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, INSERT_PANEL);
  const title = await screenBox(page, 'n-title');
  const intro = await screenBox(page, 'n-intro');
  const hero = await screenBox(page, 'n-hero');

  // just past the threshold, over the palette: the ghost beside the pointer, and the status bar says releasing cancels
  const start = await startTileDrag(page, 'paragraph');
  await expectGhostAt(page, start, 'paragraph', 'Paragraph');
  await expect(page.getByRole('status')).toHaveText('Outside the page — release to cancel.');
  await nextFrames(page);
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);

  // over the upper half of Intro: before it, so the line lies in the gap between Title and Intro, across Hero
  const over = { x: centre(intro).x, y: intro.y + intro.height * 0.25 };
  await page.mouse.move(over.x, over.y, { steps: 12 });
  const gap = (title.y + title.height + intro.y) / 2;
  await expect
    .poll(async () => {
      const line = await boxOf(page, '[data-chrome="drop-line"]');
      return line !== null && close(line.y + line.height / 2, gap) && close(line.x, hero.x) && close(line.width, hero.width);
    }, { message: `the line crosses Hero at y ${gap}, between Title and Intro` })
    .toBe(true);
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('Insert Paragraph · between Title and Intro · Page › Hero');
  await expect(page.getByRole('status')).toHaveText('Insert Paragraph · between Title and Intro · Page › Hero');
  await expectGhostAt(page, over, 'paragraph', 'Paragraph');

  // the release inserts a Paragraph there, selected, as one undo step, and every mark of the drag goes
  await page.mouse.up();
  const kids = await childrenOf(page, 'n-hero');
  expect(kids.map((c) => `${c.type} ${c.name}`)).toEqual(['heading Title', 'paragraph Paragraph', 'paragraph Intro', 'div Actions']);
  const inserted = kids[1]?.id;
  const after = await port(page);
  expect(after.selection).toEqual([inserted]);
  expect(after.undoSteps).toBe(1);
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);
  await expect(page.locator('[data-chrome="ghost"]')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Placed Paragraph in Hero, position 2 of 4.');

  // then Container into Actions, a container with no child: its outline alone, the label says into it, and the
  // selection (the new Paragraph) keeps its solid outline, since nothing of it moves
  const actions = await screenBox(page, 'n-actions');
  await startTileDrag(page, 'container');
  await page.mouse.move(centre(actions).x, centre(actions).y, { steps: 12 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('Insert Container · inside Page › Hero › Actions');
  await expect(page.locator('[data-chrome="drop-receiver"]')).toHaveAttribute('data-state', 'into');
  await expect(page.locator('[data-chrome="drop-line"]')).toHaveCount(0);
  expect(await page.locator('[data-chrome="selection"]').evaluate((el) => getComputedStyle(el).outlineStyle), 'the selection is not what is dragged').toBe('solid');
  await page.mouse.up();
  expect((await childrenOf(page, 'n-actions')).map((c) => `${c.type} ${c.name}`)).toEqual(['div Container']);
  expect((await port(page)).undoSteps).toBe(2);
});

test('off the page a tile drag proposes nothing: no indicator, the status bar says releasing cancels, and the release inserts nothing', runs(OPEN, INSERT_PANEL, PALETTE_DRAG), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, INSERT_PANEL);
  const before = (await port(page)).document;
  const intro = await screenBox(page, 'n-intro');
  const stage = await stagePoint(page);

  // over the page first, where it proposes a drop, then over the stage around the page
  await startTileDrag(page, 'heading');
  await page.mouse.move(centre(intro).x, intro.y + intro.height * 0.75, { steps: 12 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText('Insert Heading · between Intro and Actions · Page › Hero');
  await page.mouse.move(stage.x, stage.y, { steps: 12 });
  await expect(page.locator('[data-chrome="drop"]')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Outside the page — release to cancel.');
  await expectGhostAt(page, stage, 'heading', 'Heading');
  await page.mouse.up();
  const after = await port(page);
  expect(after.document).toEqual(before);
  expect(after.undoSteps).toBe(0);
  await expect(page.locator('[data-chrome="ghost"]')).toHaveCount(0);
});

test('a tile dragged where its element is refused draws the list refused with the refusal, and lands beside it, where the label says (A3.37)', runs(OPEN, INSERT_PANEL, PALETTE_DRAG), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, INSERT_PANEL);
  const perks = await screenBox(page, 'n-perks');
  const one = await screenBox(page, 'n-perk-one');
  const two = await screenBox(page, 'n-perk-two');
  // inside the list, between its two items: a Section there would be a child of <ul>, which accepts only <li>; the
  // nearest place that takes it is beside the list, on the pointer's side of its middle (spec drag-layout, Problems in
  // Pager 4)
  // the gap's middle is the list's own middle for two items of one height, where the app's tie rule and this test's
  // comparison meet: the point stands 4 px below it, past the tie the app allows at the middle (drop.middleTie) and
  // still in the gap
  const between = { x: centre(one).x, y: (one.y + one.height + two.y) / 2 + 4 };
  expect(two.y - (one.y + one.height), 'the list leaves a gap between its items').toBeGreaterThan(2);
  const beforeList = between.y < perks.y + perks.height / 2;
  const said = `Refused. <ul> only accepts <li>. · Insert Section · ${beforeList ? 'between Grid and Perks' : 'after Perks'} · Page › Plans`;

  await startTileDrag(page, 'section');
  await page.mouse.move(between.x, between.y, { steps: 12 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText(said);
  await expect(page.getByRole('status')).toHaveText(said);
  await expect
    .poll(async () => {
      const refused = await boxOf(page, '[data-chrome="drop-refused"]');
      return refused !== null && [refused.x - perks.x, refused.y - perks.y, refused.width - perks.width, refused.height - perks.height].every((d) => Math.abs(d) <= 1);
    }, { message: 'the list is outlined as the element that refuses' })
    .toBe(true);
  await expect(page.locator('[data-chrome="drop-line"]')).toHaveCount(1);

  // released there: the Section lands beside the list, in the Plans
  await page.mouse.up();
  await expect.poll(async () => (await port(page)).document.pages[0]?.tree.children[1]?.children.map((c) => c.name)).toEqual(beforeList ? ['Grid', 'Section', 'Perks'] : ['Grid', 'Perks', 'Section']);
  expect((await port(page)).undoSteps).toBe(1);
});

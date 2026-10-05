// select-click beyond its scenarios (spec/BEHAVIOUR.md#select-click): what the canvas draws for the selection and the
// hover (src/editor/canvas/chrome.tsx), and the drawn doors of selection.select and selection.clear a user can reach
// once they are built (a Layers row, Edit › Clear selection). The selection is read through the read-only test port;
// the outlines are measured against the element's box inside the frame, mapped to the screen through the frame's CSS
// zoom.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const selection = (page: Page) => page.evaluate(() => (window as unknown as Record<string, { selection: () => string[] }>).__builderTestPort?.selection());
const rootId = (page: Page) => page.evaluate(() => (window as unknown as Record<string, { document: () => { pages: { tree: { id: string } }[] } }>).__builderTestPort?.document().pages[0]?.tree.id);

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-intro"]')).toHaveCount(1);
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
    if (!el) throw new Error(`the canvas does not draw ${node ?? 'the page'}`);
    const r = el.getBoundingClientRect();
    return { x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, width: r.width * zoom, height: r.height * zoom };
  }, id);
}

const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function expectBox(page: Page, selector: string, expected: Box, what: string) {
  await expect
    .poll(async () => {
      const box = await page.locator(selector).boundingBox();
      if (box === null) return null;
      const near = (actual: number, wanted: number) => Math.abs(actual - wanted) <= 1;
      return [near(box.x, expected.x), near(box.y, expected.y), near(box.width, expected.width), near(box.height, expected.height)];
    }, { message: what })
    .toEqual([true, true, true, true]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
});

test(
  'a click outlines the selected element with its name and tag, over no text; hovering outlines another thinner; Escape takes the outline away',
  runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'selection.clear#key-escape-in-canvas'),
  async ({ page }) => {
    await openAurora(page);
    const intro = await screenBox(page, 'n-intro');
    await page.mouse.click(centre(intro).x, centre(intro).y);
    expect(await selection(page)).toEqual(['n-intro']);

    // the selection outline lies on the element's box
    await expectBox(page, '[data-chrome="selection"]', intro, 'the selection outline lies on the paragraph');
    // the label names the element and its tag, and stands in its one place (the user's rule of 2026-10-05, DEC-70):
    // above the element, touching its frame, at its left edge, whatever lies there. The Intro's space above holds the
    // Title's text: the label lies over it, and then takes no press (jornada03 J16), so a press there reaches the text.
    const label = page.locator('[data-chrome="label"]');
    await expect(label).toHaveText(/Intro\s*p/);
    await expect(label).toHaveAttribute('data-placement', 'above');
    const labelBox = await label.boundingBox();
    if (labelBox === null) throw new Error('the label is not laid out');
    expect(Math.abs(Math.round(intro.y - 2 - (labelBox.y + labelBox.height))), 'the label ends on the frame line above the element').toBe(0);
    expect(Math.abs(Math.round(labelBox.x - (intro.x - 2))), 'and starts at its left').toBe(0);
    await expect(label, 'over the Title’s text it takes no press').toHaveClass(/is-covering/);
    await expect(label).toHaveCSS('pointer-events', 'none');
    // the Title: its label stands the same way, above it, outside its box
    await page.locator('[data-door="selection.select#layers-row"][data-args*="n-title"]').first().click();
    const titleBox = await screenBox(page, 'n-title');
    await expect(label).toHaveAttribute('data-placement', 'above');
    await expect.poll(async () => Math.abs(Math.round(titleBox.y - 2 - (((await label.boundingBox())?.y ?? 0) + ((await label.boundingBox())?.height ?? 0)))), 'the label ends on the frame line').toBe(0);
    const above = await label.boundingBox();
    if (above === null) throw new Error('the label is not laid out');
    expect(overlaps(above, titleBox), 'the label lies outside the element').toBe(false);
    // the Intro again, clicked on the canvas (the focus stays in the canvas, so the Escape below reaches it): the
    // hover after it compares its outline with the selection's
    await page.mouse.click(centre(intro).x, centre(intro).y);
    expect(await selection(page)).toEqual(['n-intro']);

    // hovering the title outlines it, thinner than the selection, and selects nothing
    const title = await screenBox(page, 'n-title');
    await page.mouse.move(centre(title).x, centre(title).y, { steps: 3 });
    await expectBox(page, '[data-chrome="hover"]', title, 'the hover outline lies on the title');
    const width = (selector: string) => page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth));
    expect(await width('[data-chrome="hover"]')).toBeLessThan(await width('[data-chrome="selection"]'));
    expect(await selection(page)).toEqual(['n-intro']);

    // Escape clears: no outline and no label is left
    await page.keyboard.press('Escape');
    expect(await selection(page)).toEqual([]);
    await expect(page.locator('[data-chrome="selection"]')).toHaveCount(0);
    await expect(label).toHaveCount(0);
  },
);

test('a click on empty page area selects the page root, whose label reads its exported tag body', runs('selection.select#canvas-click-element-or-page'), async ({ page }) => {
  const root = await screenBox(page, null);
  await page.mouse.click(centre(root).x, centre(root).y);
  const id = await rootId(page);
  expect(await selection(page)).toEqual([id]);
  await expect(page.locator('[data-chrome="label"]')).toHaveText(/Page\s*body/);
  await expect(page.locator('[data-chrome="selection"]')).toHaveCount(1);
});

test('a Layers row selects its node, and the canvas outlines it', runs('project.open#menu-file', 'selection.select#layers-row'), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, 'selection.select#layers-row', { args: { target: 'n-title' } });
  expect(await selection(page)).toEqual(['n-title']);
  await expect(page.getByRole('status')).toHaveText('Title selected.');
  await expectBox(page, '[data-chrome="selection"]', await screenBox(page, 'n-title'), 'the selection outline lies on the title');
  await expect(control(page, 'selection.select#layers-row', { args: { target: 'n-title' } })).toHaveAttribute('aria-selected', 'true');
});

test('Edit › Clear selection is disabled with nothing selected, and clears a selection', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'selection.clear#menu-edit'), async ({ page }) => {
  await openAurora(page);
  await openMenu(page, 'edit');
  const item = page.locator('[data-door="selection.clear#menu-edit"]');
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item).toHaveAttribute('title', /Select an element first\./);
  await page.keyboard.press('Escape');

  const title = await screenBox(page, 'n-title');
  await page.mouse.click(centre(title).x, centre(title).y);
  expect(await selection(page)).toEqual(['n-title']);
  await runDoor(page, 'selection.clear#menu-edit');
  expect(await selection(page)).toEqual([]);
  await expect(page.getByRole('status')).toHaveText('Nothing selected.');
  await expect(page.locator('[data-chrome="selection"]')).toHaveCount(0);
});

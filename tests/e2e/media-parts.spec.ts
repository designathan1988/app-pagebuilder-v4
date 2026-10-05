// The media and embed rules of the user's real-use audit, A3.6 (spec explorer-assets aside): a media part with no
// address is never exported, Autoplay switches Muted on in the same undo step, an image with an empty alternative text
// is decorative and exports alt="", a whole <svg> pasted into an SVG's markup is unwrapped, an SVG that draws markup
// takes no shape parts, and an Embed says its code runs in the published page. Every assertion reads the document
// through the read-only test port, the canvas through the frame, the site through the ZIP.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';
import { unzip } from '../../tools/runner/unzip.ts';

const INSERT = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const SETTINGS = 'workspace.setActiveTab#inspector-tab-settings';
const ADD_SOURCE = 'parts.add#inspector-media-sources-add-source';
const ADD_TRACK = 'parts.add#inspector-media-sources-add-track';
const SRC = 'element.setAttribute#inspector-src';
const AUTOPLAY = 'element.setAttribute#inspector-autoplay';
const ALT = 'element.setAttribute#inspector-alt';
const MARKUP = 'element.setSvgMarkup#inspector-svg-markup';
const EMBED_MARKUP = 'element.setEmbedMarkup#inspector-embed-markup';
const EXPORT = 'project.export#toolbar-top-bar-export';
const ROW = 'selection.select#layers-row';

interface Node { readonly id: string; readonly type: string; readonly attributes: Readonly<Record<string, unknown>>; readonly text?: string | null; readonly children: readonly Node[] }
const tree = async (page: Page): Promise<Node> =>
  page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { pages: { tree: Node }[] } } }).__builderTestPort.document().pages[0]?.tree as Node);
const find = (node: Node, type: string): Node | null => (node.type === type ? node : node.children.map((c) => find(c, type)).find((x) => x !== null) ?? null);
const undoSteps = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __builderTestPort: { history: () => { undoSteps: number } } }).__builderTestPort.history().undoSteps);
const all = (node: Node, type: string): Node[] => [...(node.type === type ? [node] : []), ...node.children.flatMap((c) => all(c, type))];
// a markup field is several lines: Enter adds a line break there, and leaving the field (Tab) keeps what it holds
async function typeInto(page: Page, ref: string, text: string, keep: 'enter' | 'tab' = 'enter'): Promise<void> {
  const field = control(page, ref).locator('textarea, input').first();
  await field.click();
  await page.keyboard.press('Control+A');
  if (text === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(text);
  await page.keyboard.press(keep === 'tab' ? 'Tab' : 'Enter');
}
async function exported(page: Page): Promise<{ readonly html: string; readonly css: string }> {
  const download = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const files = unzip(fs.readFileSync(await (await download).path()));
  return { html: files.get('index.html')?.toString('utf8') ?? '', css: files.get('css/styles.css')?.toString('utf8') ?? '' };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
});

test('a source or track part with no address is never exported, and the canvas keeps drawing it', runs(INSERT, TILE, SETTINGS, ADD_SOURCE, ADD_TRACK, SRC, EXPORT), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, INSERT);
  await runDoor(page, TILE, { args: { entry: 'video' } });
  await runDoor(page, SETTINGS);
  await runDoor(page, ADD_SOURCE);
  await runDoor(page, ADD_TRACK);
  expect(all(await tree(page), 'source')).toHaveLength(2);
  expect(all(await tree(page), 'track')).toHaveLength(1);
  const empty = await exported(page);
  expect(empty.html).not.toContain('<source');
  expect(empty.html).not.toContain('<track');
  // the filled source is written, its own address only, and the empty track still is not: a part has no box of its
  // own, so it is selected through its Layers row, and its Source field then writes it
  const part = all(await tree(page), 'source')[0];
  if (part === undefined) throw new Error('the Source part is missing');
  await control(page, ROW, { args: { target: part.id } }).click();
  await typeInto(page, SRC, 'https://cdn.example/aurora.mp4', 'tab');
  const filled = await exported(page);
  expect(filled.html.match(/<source[^>]*>/g)).toEqual(['<source src="https://cdn.example/aurora.mp4">']);
  expect(filled.html).not.toContain('<track');
});

test('Autoplay switches Muted on in the same undo step', runs(INSERT, TILE, SETTINGS, AUTOPLAY, 'history.undo#toolbar-top-bar'), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, INSERT);
  await runDoor(page, TILE, { args: { entry: 'video' } });
  await runDoor(page, SETTINGS);
  // Autoplay is an Off | On pair (spec settings-audit): its On
  await runDoor(page, AUTOPLAY, { args: { value: true } });
  await expect.poll(async () => find(await tree(page), 'video')?.attributes).toEqual({ autoplay: true, muted: true });
  const steps = await undoSteps(page);
  await runDoor(page, 'history.undo#toolbar-top-bar');
  expect(await undoSteps(page)).toBe(steps - 1);
  expect(find(await tree(page), 'video')?.attributes).toEqual({});
});

test('an image with an empty alternative text is decorative and exports alt=""', runs(INSERT, TILE, SETTINGS, ALT, EXPORT), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, INSERT);
  await runDoor(page, TILE, { args: { entry: 'image' } });
  await runDoor(page, SETTINGS);
  await typeInto(page, ALT, 'A coffee bag');
  expect(find(await tree(page), 'image')?.attributes.alt).toBe('A coffee bag');
  await typeInto(page, ALT, '');
  // the empty text is a value of its own: it stays in the document (decoration), never removed
  expect(find(await tree(page), 'image')?.attributes.alt).toBe('');
  const site = await exported(page);
  expect(site.html).toContain('alt=""');
});

test('a whole <svg> pasted into the markup is unwrapped, and an SVG that draws markup takes no shape parts', runs(INSERT, TILE, SETTINGS, MARKUP, 'parts.add#inspector-svg-shapes-add-rectangle'), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, INSERT);
  await runDoor(page, TILE, { args: { entry: 'svg' } });
  await runDoor(page, SETTINGS);
  await typeInto(page, MARKUP, '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>', 'tab');
  await expect.poll(async () => find(await tree(page), 'svg')?.attributes.svgMarkup).toBe('<circle cx="5" cy="5" r="4"></circle>');
  const drawn = await page.frameLocator('.frame__page').locator('svg svg').count();
  expect(drawn, 'the canvas draws one SVG, never an SVG inside it').toBe(0);
  // the SVG draws its markup: a shape part is refused with the reason, nothing changes
  const before = await tree(page);
  await runDoor(page, 'parts.add#inspector-svg-shapes-add-rectangle');
  await expect(page.getByRole('status')).toContainText('draws its markup');
  expect(await tree(page)).toEqual(before);
});

test('an Embed says its code runs in the published page', runs(INSERT, TILE, SETTINGS, EMBED_MARKUP), async ({ page }) => {
  // the canvas shows an embed without its scripts, which never run there: the frame blocked each one and logged a
  // console error (the user's audit order of 2026-10-05); the document keeps them
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await openEditor(page);
  await runDoor(page, INSERT);
  await runDoor(page, TILE, { args: { entry: 'embed-html' } });
  await runDoor(page, SETTINGS);
  await typeInto(page, EMBED_MARKUP, '<div>widget</div>', 'tab');
  await expect(control(page, EMBED_MARKUP).locator('.field-row__warning')).toHaveCount(0);
  await typeInto(page, EMBED_MARKUP, '<script>alert(1)</script>', 'tab');
  await expect(control(page, EMBED_MARKUP).locator('.field-row__warning')).toContainText('runs in the published page');
  await expect(page.frameLocator('.frame__page').locator('iframe[data-embed-frame]')).toHaveAttribute('srcdoc', '');
  expect(JSON.stringify(await tree(page)), 'the document keeps the script').toContain('<script>alert(1)</script>');
  expect(errors, 'no console error').toEqual([]);
});

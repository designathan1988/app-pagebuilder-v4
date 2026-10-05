// elements-structure beyond its scenarios (spec/BEHAVIOUR.md#elements-structure). The Structure tiles insert their
// elements, drawn as their tags, an empty one kept visible by the canvas alone (Problems in Pager 3 and 6). An
// interactive element never goes into a Link Block nor into an element inside one, through every door that places it:
// Enter and Space on a focused tile, a tile dragged over it, an element dragged into it (Problems in Pager 5). The
// Settings tab's Link address keeps a Link Block's link on Enter and when the field loses the focus, for the Link Block
// it was drawn for; an emptied field removes the href (the canvas draws no link, also after a reload); an unsafe
// address is refused and the document keeps its link; a locked Link Block keeps its link (Problems in Pager 4). Open
// in a new tab shares the command and comes with elements-text: not available yet. The document, the selection and
// the history are read through the read-only test port; the page through the frame.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { control, runDoor, runs } from './door.ts';

const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const ENTER = 'element.insert#key-enter-in-palette';
const SPACE = 'element.insert#key-space-in-palette';
const PALETTE_DRAG = 'element.insert#canvas-drag-palette-tile-drop-proposal';
const CLEAR = 'selection.clear#menu-edit';
const SELECT = 'selection.select#canvas-click-element-or-page';
const DRAG_INSIDE = 'element.moveTo#canvas-drag-canvas-element-inside';
const DRAG_BEFORE_AFTER = 'element.moveTo#canvas-drag-canvas-element-before-after';
const SETTINGS_TAB = 'workspace.setActiveTab#inspector-tab-settings';
const HREF = 'element.setLink#inspector-href';
const NEW_TAB = 'element.setLink#inspector-new-tab';
const UNDO = 'history.undo#toolbar-top-bar';
const MENU_LOCK = 'element.toggleLock#menu-element-actions';

const EN = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;
const words = (key: string, params: Record<string, string> = {}) => (EN[key] ?? '').replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
const interactions = JSON.parse(fs.readFileSync('manifest/interactions.json', 'utf8')) as { constants: { id: string; value: unknown }[] };
const THRESHOLD = interactions.constants.find((c) => c.id === 'drag.threshold')?.value as number;
const ELEMENTS = JSON.parse(fs.readFileSync('manifest/elements.json', 'utf8')) as {
  elements: { id: string; tag: string | null }[];
  palette: { id: string; entries: { id: string; element: string }[] }[];
};
// the Structure group's entries, each with the tag its element renders as
const STRUCTURE = (ELEMENTS.palette.find((g) => g.id === 'structure')?.entries ?? []).map((e) => ({ entry: e.id, tag: ELEMENTS.elements.find((el) => el.id === e.element)?.tag ?? '' }));
const REFUSED_IN_LINK_BLOCK = words('status.refused.interactiveInside', { parent: 'Link Block' });

interface Tree {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly tag: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly styles: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>;
  readonly children: readonly Tree[];
}
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
const port = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => { pages: { tree: Tree }[] }; selection: () => string[]; history: () => { undoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    return { document: p.document(), selection: p.selection(), undoSteps: p.history().undoSteps };
  });
// every node of the page, the root first
const nodes = async (page: Page): Promise<Tree[]> => {
  const tree = (await port(page)).document.pages[0]?.tree;
  const all: Tree[] = [];
  const visit = (n: Tree) => {
    all.push(n);
    n.children.forEach(visit);
  };
  if (tree !== undefined) visit(tree);
  return all;
};
const named = async (page: Page, name: string): Promise<Tree> => {
  const found = (await nodes(page)).find((n) => n.name === name);
  if (found === undefined) throw new Error(`the document has no node named ${name}`);
  return found;
};
// a node's element inside the frame: its tag, its link, its display and height
const drawn = (page: Page, id: string) =>
  page.evaluate((node) => {
    const doc = document.querySelector<HTMLIFrameElement>('.frame__page')?.contentDocument;
    const el = doc?.querySelector(`[data-node="${node}"]`);
    if (!el) throw new Error(`the canvas does not draw ${node}`);
    return { tag: el.tagName.toLowerCase(), href: el.getAttribute('href'), display: getComputedStyle(el).display, height: el.getBoundingClientRect().height };
  }, id);
// the screen box of a node's element, through the frame's CSS zoom
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
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const status = (page: Page) => page.getByRole('status');
const hrefInput = (page: Page) => control(page, HREF).locator('input');

// a tile's click with nothing selected: its element goes last in the page
async function insertInPage(page: Page, entry: string) {
  if ((await port(page)).selection.length > 0) await runDoor(page, CLEAR);
  await runDoor(page, TILE, { args: { entry } });
}
// the focus moved to a tile as a person reaches it with the keyboard: Tab (Shift+Tab when the focus is after it) to
// the tile's group, whose tiles are one Tab stop (spec palette, the Insert panel), then the arrows within it
async function tabToTile(page: Page, entry: string) {
  const tile = control(page, TILE, { args: { entry } });
  const focused = () => tile.evaluate((el) => el === document.activeElement);
  const inGroup = () => tile.evaluate((el) => el.parentElement?.contains(document.activeElement) === true);
  const after = await tile.evaluate((el) => document.activeElement !== null && document.activeElement !== document.body && (el.compareDocumentPosition(document.activeElement) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  for (let i = 0; i < 400 && !(await inGroup()); i += 1) await page.keyboard.press(after ? 'Shift+Tab' : 'Tab');
  for (let i = 0; i < 200 && (await inGroup()) && !(await focused()); i += 1) await page.keyboard.press('ArrowRight');
  expect(await focused(), `Tab reaches the ${entry} tile`).toBe(true);
}
// the address the canvas's frame shows: its page never follows a link
const frameAddress = (page: Page) => page.evaluate(() => document.querySelector<HTMLIFrameElement>('.frame__page')?.contentWindow?.location.href ?? null);
// types into the Link address as a person does: a click on it, what it holds selected, then the text (an empty text
// deletes what it holds)
async function typeLink(page: Page, text: string) {
  await hrefInput(page).click();
  await page.keyboard.press('Control+A');
  if (text === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(text);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
  await runDoor(page, INSERT_PANEL);
});

test('each Structure tile inserts its element, drawn as its tag and kept visible while empty by the canvas alone; there is no Card', runs(INSERT_PANEL, CLEAR, TILE), async ({ page }) => {
  expect(STRUCTURE.map((s) => s.entry)).toEqual(['container', 'header', 'navigation', 'main', 'section', 'article', 'aside', 'footer', 'link-block']);
  for (const { entry } of STRUCTURE) await insertInPage(page, entry);
  const children = (await port(page)).document.pages[0]?.tree.children ?? [];
  expect(children.map((c) => `${c.type} ${c.name} <${c.tag ?? ''}>`)).toEqual([
    'div Container <div>',
    'header Header <header>',
    'nav Navigation <nav>',
    'main Main <main>',
    'section Section <section>',
    'article Article <article>',
    'aside Aside <aside>',
    'footer Footer <footer>',
    'linkBlock Link Block <a>',
  ]);
  for (const [i, child] of children.entries()) {
    const element = await drawn(page, child.id);
    expect(element.tag, child.name).toBe(STRUCTURE[i]?.tag);
    expect(element.display, `${child.name}: a block`).toBe('block');
    expect(element.height, `${child.name}: visible while empty`).toBeGreaterThan(0);
    // its default styles are only declarations that act: padding, or the Link Block's display; no minimum height
    const declared = Object.keys(child.styles.desktop?.base ?? {});
    expect(declared.includes('min-height') || declared.includes('align-items'), `${child.name}: ${declared.join(', ')}`).toBe(false);
  }
  // the Link Block without a link has no href, in the document and on the canvas
  const link = children[8];
  expect(link?.attributes).toEqual({});
  expect((await drawn(page, link?.id ?? '')).href).toBeNull();
});

test('Enter and Space on the Link Block tile put one beside a selected Link Block, and are refused inside an element inside one, naming the Link Block', runs(INSERT_PANEL, TILE, ENTER, SPACE), async ({ page }) => {
  // a Link Block, selected: the tile's Enter puts the new one beside it, its own kind (the audit of 2026-10-05: a card
  // clicked on a card nested in it), never into it; undone, the first is selected again
  await runDoor(page, TILE, { args: { entry: 'link-block' } });
  const outer = await named(page, 'Link Block');
  expect((await port(page)).selection).toEqual([outer.id]);
  const before = await port(page);
  await tabToTile(page, 'link-block');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await named(page, 'Link Block')).children.length).toBe(0);
  await expect(status(page)).not.toHaveText(REFUSED_IN_LINK_BLOCK);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await port(page)).document).toEqual(before.document);
  await control(page, 'selection.select#layers-row', { args: { target: outer.id } }).click();

  // a Container is not interactive: Enter on its tile puts it into the Link Block, and selects it
  await tabToTile(page, 'container');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await named(page, 'Link Block')).children.map((c) => c.name)).toEqual(['Container']);
  const inner = await named(page, 'Container');
  expect((await port(page)).selection).toEqual([inner.id]);
  // inside the Container, inside the Link Block: still refused, naming the Link Block
  const nested = await port(page);
  await tabToTile(page, 'link-block');
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveText(REFUSED_IN_LINK_BLOCK);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(REFUSED_IN_LINK_BLOCK);
  expect((await port(page)).document).toEqual(nested.document);
  expect((await port(page)).undoSteps).toBe(2);
});

test('a Link Block tile dragged over a Link Block draws it refused with the refusal, and lands after it, where the label says (A3.37)', runs(INSERT_PANEL, TILE, PALETTE_DRAG), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'link-block' } });
  const target = await named(page, 'Link Block');
  const before = await port(page);
  const block = await screenBox(page, target.id);
  // over its lower half: the nearest place that takes a Link Block is after it (spec drag-layout, Problems in Pager 4)
  const over = { x: centre(block).x, y: block.y + block.height * 0.75 };
  const tile = await control(page, TILE, { args: { entry: 'link-block' } }).boundingBox();
  if (tile === null) throw new Error('the Link Block tile is not laid out');
  const from = centre(tile);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + THRESHOLD + 2, from.y + THRESHOLD + 2, { steps: 3 });
  await page.mouse.move(over.x, over.y, { steps: 12 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText(`${REFUSED_IN_LINK_BLOCK} · Insert Link Block · after Link Block · Page`);
  await expect(status(page)).toHaveText(`${REFUSED_IN_LINK_BLOCK} · Insert Link Block · after Link Block · Page`);
  const refused = await page.locator('[data-chrome="drop-refused"]').boundingBox();
  expect(refused !== null && Math.abs(refused.x - block.x) <= 1 && Math.abs(refused.y - block.y) <= 1 && Math.abs(refused.width - block.width) <= 1).toBe(true);
  await expect(page.locator('[data-chrome="drop-line"]')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(async () => (await port(page)).document.pages[0]?.tree.children.map((c) => c.name)).toEqual(['Link Block', 'Link Block 2']);
  expect((await port(page)).undoSteps).toBe(before.undoSteps + 1);

  // a Container dragged there lands inside it
  const containerTile = await control(page, TILE, { args: { entry: 'container' } }).boundingBox();
  if (containerTile === null) throw new Error('the Container tile is not laid out');
  const start = centre(containerTile);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + THRESHOLD + 2, start.y + THRESHOLD + 2, { steps: 3 });
  await page.mouse.move(over.x, over.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await named(page, 'Link Block')).children.map((c) => c.name)).toEqual(['Container']);
});

test('a Link Block dragged on the canvas over another Link Block lands beside it, as the refusal and the label say (A3.37)', runs(INSERT_PANEL, CLEAR, TILE, SELECT, DRAG_INSIDE, DRAG_BEFORE_AFTER), async ({ page }) => {
  await insertInPage(page, 'link-block');
  await insertInPage(page, 'section');
  await insertInPage(page, 'link-block');
  const first = await named(page, 'Link Block');
  const second = await named(page, 'Link Block 2');
  expect((await port(page)).selection).toEqual([second.id]);
  const before = await port(page);
  // the selected Link Block is pressed on its name label and dragged over the other one
  const label = page.locator(`[data-chrome="label"][data-label-for="${second.id}"]`);
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  if (box === null) throw new Error('the label is not laid out');
  const firstBox = await screenBox(page, first.id);
  // over its lower half: the nearest place that takes it is after the first Link Block, before the Section
  const over = { x: centre(firstBox).x, y: firstBox.y + firstBox.height * 0.75 };
  await page.mouse.move(centre(box).x, centre(box).y);
  await page.mouse.down();
  await page.mouse.move(centre(box).x + THRESHOLD + 2, centre(box).y + THRESHOLD + 2, { steps: 3 });
  await page.mouse.move(over.x, over.y, { steps: 12 });
  await expect(page.locator('[data-chrome="drop-label"]')).toHaveText(`${REFUSED_IN_LINK_BLOCK} · Between Link Block and Section · Page`);
  await expect(page.locator('[data-chrome="drop-refused"]')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(async () => (await port(page)).document.pages[0]?.tree.children.map((c) => c.name)).toEqual(['Link Block', 'Link Block 2', 'Section']);
  expect((await port(page)).undoSteps).toBe(before.undoSteps + 1);

  // the Section is no interactive element: dragged by its label into the Link Block, it goes in
  const section = await named(page, 'Section');
  await page.mouse.click(centre(await screenBox(page, section.id)).x, centre(await screenBox(page, section.id)).y);
  await expect.poll(async () => (await port(page)).selection).toEqual([section.id]);
  const sectionLabel = await page.locator(`[data-chrome="label"][data-label-for="${section.id}"]`).boundingBox();
  if (sectionLabel === null) throw new Error('the Section label is not laid out');
  const target = centre(await screenBox(page, first.id));
  await page.mouse.move(centre(sectionLabel).x, centre(sectionLabel).y);
  await page.mouse.down();
  await page.mouse.move(centre(sectionLabel).x + THRESHOLD + 2, centre(sectionLabel).y + THRESHOLD + 2, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await named(page, 'Link Block')).children.map((c) => c.name)).toEqual(['Section']);
});

test('the Link address keeps the link on Enter, with Tab and with a click elsewhere, for the Link Block it was drawn for; Open in a new tab stands beside it (feature elements-text)', runs(INSERT_PANEL, CLEAR, TILE, SETTINGS_TAB, HREF, SELECT, UNDO), async ({ page }) => {
  await insertInPage(page, 'section');
  await insertInPage(page, 'link-block');
  const link = await named(page, 'Link Block');
  const section = await named(page, 'Section');
  await runDoor(page, SETTINGS_TAB);
  await expect(hrefInput(page)).toBeEnabled();
  // elements-text is built: its toggle is usable, and what it does is proven by that feature's scenarios — an Off | On
  // pair (spec settings-audit), Off pressed while the link opens in the same tab
  await expect(control(page, NEW_TAB, { args: { newTab: true } })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(control(page, NEW_TAB, { args: { newTab: false } })).toHaveAttribute('aria-pressed', 'true');

  // Enter keeps it: one undo step, on the document and on the canvas's <a>
  await typeLink(page, 'https://example.com');
  expect((await named(page, 'Link Block')).attributes).toEqual({});
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await named(page, 'Link Block')).attributes).toEqual({ href: 'https://example.com' });
  await expect(status(page)).toHaveText(words('status.link.set', { name: 'Link Block', href: 'https://example.com' }));
  expect((await drawn(page, link.id)).href).toBe('https://example.com');
  expect((await port(page)).undoSteps).toBe(3);
  // Enter again with the same link records nothing
  await page.keyboard.press('Enter');
  expect((await port(page)).undoSteps).toBe(3);

  // Tab keeps what was typed, trimmed
  await typeLink(page, '  mailto:hi@example.com ');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await named(page, 'Link Block')).attributes).toEqual({ href: 'mailto:hi@example.com' });
  expect((await port(page)).undoSteps).toBe(4);

  // a click on the Section on the canvas keeps what was typed for the Link Block, not for the Section it selects;
  // the canvas never follows the link
  const address = await frameAddress(page);
  expect(address).toBe('about:srcdoc');
  await typeLink(page, 'https://example.com/about');
  const at = centre(await screenBox(page, section.id));
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await port(page)).selection).toEqual([section.id]);
  await expect.poll(async () => (await named(page, 'Link Block')).attributes).toEqual({ href: 'https://example.com/about' });
  expect((await named(page, 'Section')).attributes).toEqual({});
  expect((await port(page)).undoSteps).toBe(5);
  expect((await drawn(page, link.id)).href).toBe('https://example.com/about');
  const linkAt = centre(await screenBox(page, link.id));
  await page.mouse.click(linkAt.x, linkAt.y);
  await expect.poll(async () => (await port(page)).selection).toEqual([link.id]);
  expect(await frameAddress(page)).toBe(address);
  await expect(hrefInput(page)).toHaveValue('https://example.com/about');

  // undo gives the link before back
  await runDoor(page, UNDO);
  await expect.poll(async () => (await named(page, 'Link Block')).attributes).toEqual({ href: 'mailto:hi@example.com' });
  expect((await drawn(page, link.id)).href).toBe('mailto:hi@example.com');
});

test('an emptied Link address removes the href from the document and the canvas, also after a reload', runs(INSERT_PANEL, TILE, SETTINGS_TAB, HREF, UNDO), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'link-block' } });
  const link = await named(page, 'Link Block');
  await runDoor(page, SETTINGS_TAB);
  await typeLink(page, 'https://example.com');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await named(page, 'Link Block')).attributes).toEqual({ href: 'https://example.com' });
  await typeLink(page, '');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await named(page, 'Link Block')).attributes).toEqual({});
  await expect(status(page)).toHaveText(words('status.link.removed', { name: 'Link Block' }));
  expect((await drawn(page, link.id)).href).toBeNull();
  expect((await port(page)).undoSteps).toBe(3);
  await runDoor(page, UNDO);
  await expect.poll(async () => (await drawn(page, link.id)).href).toBe('https://example.com');
  await typeLink(page, '   ');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await named(page, 'Link Block')).attributes).toEqual({});

  // after an immediate reload the Link Block still has no link
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
  await expect(page.frameLocator('.frame__page').locator(`[data-node="${link.id}"]`)).toHaveCount(1);
  expect((await named(page, 'Link Block')).attributes).toEqual({});
  expect((await drawn(page, link.id)).href).toBeNull();
});

test('an unsafe address is refused naming it: the document keeps its link and the field shows it again', runs(INSERT_PANEL, TILE, SETTINGS_TAB, HREF), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'link-block' } });
  const link = await named(page, 'Link Block');
  await runDoor(page, SETTINGS_TAB);
  await typeLink(page, 'javascript:alert(1)');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(words('status.url.unsafe', { url: 'javascript:alert(1)' }));
  expect((await named(page, 'Link Block')).attributes).toEqual({});
  expect((await drawn(page, link.id)).href).toBeNull();
  await expect(hrefInput(page)).toHaveValue('');
  expect((await port(page)).undoSteps).toBe(1);

  await typeLink(page, 'https://example.com');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await named(page, 'Link Block')).attributes).toEqual({ href: 'https://example.com' });
  // refused when the field is left too, and the link stays
  await typeLink(page, 'data:text/html,hello');
  await page.keyboard.press('Tab');
  await expect(status(page)).toHaveText(words('status.url.unsafe', { url: 'data:text/html,hello' }));
  expect((await named(page, 'Link Block')).attributes).toEqual({ href: 'https://example.com' });
  await expect(hrefInput(page)).toHaveValue('https://example.com');
  expect((await drawn(page, link.id)).href).toBe('https://example.com');
  expect((await port(page)).undoSteps).toBe(2);
});

test('a locked Link Block keeps its link: the Link address says what to unlock and changes nothing', runs(INSERT_PANEL, TILE, SETTINGS_TAB, HREF, MENU_LOCK), async ({ page }) => {
  await runDoor(page, TILE, { args: { entry: 'link-block' } });
  const link = await named(page, 'Link Block');
  await runDoor(page, MENU_LOCK);
  await expect.poll(async () => ((await named(page, 'Link Block')) as Tree & { locked?: boolean }).locked).toBe(true);
  await runDoor(page, SETTINGS_TAB);
  const before = await port(page);
  await typeLink(page, 'https://example.com');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(words('status.locked.edit', { name: 'Link Block' }));
  const after = await port(page);
  expect(after.document).toEqual(before.document);
  expect(after.undoSteps).toBe(before.undoSteps);
  await expect(hrefInput(page)).toHaveValue('');
  expect((await drawn(page, link.id)).href).toBeNull();
});

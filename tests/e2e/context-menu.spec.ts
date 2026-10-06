// context-menu beyond its scenarios (spec/BEHAVIOUR.md#context-menu): the menu shows only
// the commands that apply to the selection, in the manifest's order, each with its shortcut in the canvas (Problems 2);
// a secondary click inside the selection keeps it; the menu stays inside the window; Escape and a click outside give
// the focus back where it was, and so does a run item (Problems 4); the browser's own menu never opens where the
// editor's does (Problems 5). What is built is read from the manifest's registry (references.json), never a fixed
// list, so the test stays valid as later features bring their items. The document, the selection and the history are
// read through the read-only test port.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs, scrollToControl } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const CANVAS_MENU = 'contextMenu.open#canvas-right-click-element-or-page';
const ROW_MENU = 'contextMenu.open#layers-row-secondary-click';
const ESCAPE = 'ui.dismiss#key-escape-in-menu';
const SELECT = 'selection.select#canvas-click-element-or-page';
const ADD = 'selection.add#canvas-click-element-shift';
const ROW = 'selection.select#layers-row';
const MOVE_UP = 'element.moveUp#context-menu';
const MOVE_DOWN = 'element.moveDown#context-menu';
const DELETE = 'element.delete#context-menu';

interface Entry {
  readonly id: string;
  readonly kind: string;
  readonly context?: string;
  readonly chord?: string;
  readonly labelKey: string;
  readonly placement: { readonly region: string; readonly order: number } | 'none';
}
const COMMANDS = fs.readdirSync('manifest/commands').flatMap((f) => (JSON.parse(fs.readFileSync(path.join('manifest/commands', f), 'utf8')) as { commands: { id: string; entryPoints: Entry[] }[] }).commands);
const BUILT = new Set(
  (JSON.parse(fs.readFileSync('manifest/references.json', 'utf8')) as { references: { kind: string; id: string; status: string }[] }).references
    .filter((r) => r.kind === 'handler' && r.status === 'registered')
    .map((r) => r.id),
);
const EN = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;
// every context-menu item of the manifest, in its order there
const ITEMS = COMMANDS.flatMap((c) => c.entryPoints.filter((d) => d.kind === 'context-menu').map((d) => ({ ref: `${c.id}#${d.id}`, command: c.id, door: d })))
  .sort((a, b) => (a.door.placement === 'none' ? 0 : a.door.placement.order) - (b.door.placement === 'none' ? 0 : b.door.placement.order));
// the tooltip an item shows: its label, with the command's key on the canvas (or a global one) when it has one
function tooltip(ref: string): string {
  const item = ITEMS.find((i) => i.ref === ref);
  if (item === undefined) throw new Error(`${ref} is no context-menu item`);
  const keys = COMMANDS.find((c) => c.id === item.command)?.entryPoints.filter((d) => d.kind === 'shortcut') ?? [];
  const chord = (keys.find((d) => d.context === 'canvas') ?? keys.find((d) => d.context === 'global'))?.chord;
  const label = EN[item.door.labelKey] ?? '';
  return chord === undefined ? label : `${label} (${chord})`;
}

interface Tree {
  readonly id: string;
  readonly children: readonly Tree[];
}
const read = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => { pages: { tree: Tree }[] }; selection: () => string[]; history: () => { undoSteps: number } }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    const hero = p.document().pages[0]?.tree.children.find((c) => c.id === 'n-hero');
    return { hero: hero?.children.map((c) => c.id) ?? null, selection: p.selection(), undoSteps: p.history().undoSteps };
  });
const drawn = (page: Page, id: string) => page.frameLocator('.frame__page').locator(`[data-node="${id}"]`);
const menu = (page: Page) => page.locator('[role="menu"][data-region="context-menu"]');
// the context-menu items drawn, in their order
const shown = (page: Page) => menu(page).locator('[data-door]').evaluateAll((els) => els.map((el) => el.getAttribute('data-door') ?? ''));

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator(`[data-door="${OPEN}"]`).click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(drawn(page, 'n-intro')).toHaveCount(1);
}

// the screen point at the centre of a node's element on the canvas (a leaf: a click there hits the node itself)
async function nodePoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const el = iframe?.contentDocument?.querySelector(`[data-node="${node}"]`);
    if (!iframe || !el) throw new Error(`the canvas does not draw ${node}`);
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: frame.left + (r.left + r.width / 2) * zoom, y: frame.top + (r.top + r.height / 2) * zoom };
  }, id);
}
async function clickNode(page: Page, id: string, button: 'left' | 'right' = 'left', modifiers: 'Shift'[] = []) {
  const at = await nodePoint(page, id);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(at.x, at.y, { button });
  for (const key of modifiers) await page.keyboard.up(key);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
  await openAurora(page);
});

test('the menu shows only the built commands that apply, in the manifest order, each with its shortcut', runs(OPEN, CANVAS_MENU, ESCAPE, ROW_MENU), async ({ page }) => {
  const check = async (absent: string, present: string) => {
    await expect(menu(page)).toBeVisible();
    const refs = await shown(page);
    // built, in the manifest order, none disabled nor "not available yet"
    expect(refs.filter((r) => !BUILT.has(r.split('#')[0] ?? '')), 'items of commands not built').toEqual([]);
    expect(refs, 'the manifest order').toEqual(ITEMS.map((i) => i.ref).filter((r) => refs.includes(r)));
    await expect(menu(page).locator('[aria-disabled="true"], .menu__reason')).toHaveCount(0);
    expect(refs).not.toContain(absent);
    expect(refs).toContain(present);
    for (const ref of refs) await expect(menu(page).locator(`[data-door="${ref}"]`), `${ref} tooltip`).toHaveAttribute('title', tooltip(ref));
    await runDoor(page, ESCAPE);
    await expect(menu(page)).toHaveCount(0);
  };
  // the first child of Hero: Move up cannot apply; the last: Move down cannot
  await clickNode(page, 'n-title', 'right');
  await check(MOVE_UP, MOVE_DOWN);
  await clickNode(page, 'n-actions', 'right');
  await check(MOVE_DOWN, MOVE_UP);
  // the page root: the commands that apply to it are the pastes (a paste lands inside it), the style clipboard,
  // Organize and Compose layout (spec layout-composer: the page's root is a container it composes); nothing that moves,
  // copies, renames or removes an element is offered for the root; the root is selected
  await runDoor(page, ROW_MENU, { args: { target: 'n-page' } });
  expect((await read(page)).selection).toEqual(['n-page']);
  await expect(menu(page)).toBeVisible();
  expect(await shown(page)).toEqual(ITEMS.filter((i) => ['clipboard.paste', 'clipboard.copyStyle', 'clipboard.pasteStyle', 'element.organize', 'layout.enter'].includes(i.command)).map((i) => i.ref));
});

test('a secondary click inside the selection keeps it, and Delete removes every selected root in one undo step', runs(OPEN, SELECT, ADD, CANVAS_MENU, DELETE), async ({ page }) => {
  await clickNode(page, 'n-intro');
  await clickNode(page, 'n-actions', 'left', ['Shift']);
  await clickNode(page, 'n-actions', 'right');
  await expect(menu(page)).toBeVisible();
  expect(await read(page)).toEqual({ hero: ['n-title', 'n-intro', 'n-actions'], selection: ['n-intro', 'n-actions'], undoSteps: 0 });
  await runDoor(page, DELETE);
  await expect.poll(() => read(page)).toEqual({ hero: ['n-title'], selection: ['n-title'], undoSteps: 1 });
  await expect(drawn(page, 'n-intro')).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
  // outside the selection, the secondary click selects the node alone
  await clickNode(page, 'n-note', 'right');
  await expect(menu(page)).toBeVisible();
  expect((await read(page)).selection).toEqual(['n-note']);
});

test('the menu opens at the pointer and stays inside the window', runs(OPEN, ROW_MENU, ESCAPE), async ({ page }) => {
  // a short window: the last Layers row sits at its bottom edge, where a menu at the pointer would overflow; the tree
  // draws its last rows only once scrolled to its end (A3.28)
  await page.setViewportSize({ width: 1440, height: 560 });
  const tree = page.locator('.layers-tree');
  await expect(tree).toBeVisible();
  // the tree draws its last rows only once scrolled to its end, and lays them out a frame after the scroll
  await scrollToControl(page, ROW, { args: { target: 'n-note' } });
  const row = control(page, ROW, { args: { target: 'n-note' } });
  await expect(row).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = await row.boundingBox();
  if (box === null) throw new Error('the Note row is not laid out');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  const drawnAt = await menu(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: window.innerWidth, height: window.innerHeight };
  });
  // at the pointer across, moved up to stay inside the window
  expect(Math.abs(drawnAt.left - at.x)).toBeLessThanOrEqual(1);
  expect(at.y + (drawnAt.bottom - drawnAt.top)).toBeGreaterThan(drawnAt.height);
  expect(drawnAt.top).toBeGreaterThanOrEqual(0);
  expect(drawnAt.bottom).toBeLessThanOrEqual(drawnAt.height);
  expect(drawnAt.right).toBeLessThanOrEqual(drawnAt.width);
  await runDoor(page, ESCAPE);
});

test('Escape, a click outside and a run item close the menu and give the focus back to the Layers row', runs(OPEN, ROW_MENU, ESCAPE, MOVE_UP), async ({ page }) => {
  const row = control(page, ROW, { args: { target: 'n-intro' } });
  const focusedRow = () => row.evaluate((el) => el === document.activeElement);
  const focusedItem = () => page.evaluate(() => document.activeElement?.closest('[data-region="context-menu"]') !== null && document.activeElement?.getAttribute('role') === 'menuitem');

  await runDoor(page, ROW_MENU, { args: { target: 'n-intro' } });
  await expect(menu(page)).toBeVisible();
  expect(await focusedItem(), 'the menu takes the focus on its first item').toBe(true);
  await runDoor(page, ESCAPE);
  await expect(menu(page)).toHaveCount(0);
  expect(await focusedRow(), 'Escape gives the focus back to the row').toBe(true);

  await runDoor(page, ROW_MENU, { args: { target: 'n-intro' } });
  await expect(menu(page)).toBeVisible();
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await expect(menu(page)).toHaveCount(0);
  expect(await focusedRow(), 'a click outside gives the focus back to the row').toBe(true);

  await runDoor(page, ROW_MENU, { args: { target: 'n-intro' } });
  await runDoor(page, MOVE_UP);
  await expect.poll(() => read(page)).toEqual({ hero: ['n-intro', 'n-title', 'n-actions'], selection: ['n-intro'], undoSteps: 1 });
  await expect(menu(page)).toHaveCount(0);
  expect(await focusedRow(), 'a run item gives the focus back to the row').toBe(true);
});

test('the browser’s own menu does not open on the canvas nor on a Layers row', runs(OPEN, CANVAS_MENU, ROW_MENU, ESCAPE), async ({ page }) => {
  // whether each contextmenu event the browser sends was taken by the editor (its default prevented)
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { __contextMenus: boolean[] }).__contextMenus = seen;
    window.addEventListener('contextmenu', (event) => seen.push(event.defaultPrevented));
  });
  const seen = () => page.evaluate(() => (window as unknown as { __contextMenus: boolean[] }).__contextMenus);
  await clickNode(page, 'n-intro', 'right');
  await expect(menu(page)).toBeVisible();
  await runDoor(page, ESCAPE);
  await runDoor(page, ROW_MENU, { args: { target: 'n-intro' } });
  await expect(menu(page)).toBeVisible();
  await runDoor(page, ESCAPE);
  expect(await seen()).toEqual([true, true]);
});

// What a person does with the editor, as gestures: open a panel, search the Insert panel and click a tile, type into a
// field of the inspector, edit a text on the canvas, open a menu and choose an item. Real mouse and keyboard only; the
// read-only test port is read for the checks, never to act.
import type { Locator, Page } from '@playwright/test';
import { openMenu, openStyleControl, runDoor, control } from '../../tests/e2e/door.ts';
import { canvasPoint } from './kit.ts';

export {  runDoor,  };

const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

export async function rail(page: Page, panel: 'insert' | 'explorer' | 'styles' | 'data' | 'assistant'): Promise<void> {
  const button = page.locator(`[data-door="workspace.setPanelOpen#toolbar-activity-bar-${panel}"]`);
  await button.click();
  await settle(page);
}

const INSERT_SEARCH = 'input[aria-label="Buscar elementos"], input[aria-label="Search elements"]';
// the Insert panel's search, a term typed, then the tile whose words are `tile`
export async function insert(page: Page, term: string, tile: string): Promise<boolean> {
  const target = page.locator(INSERT_SEARCH).first();
  if (!(await target.isVisible().catch(() => false))) await rail(page, 'insert');
  await target.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(term, { delay: 20 });
  await settle(page);
  const button = page.locator('[data-door="element.insert#elements-tile"]').filter({ hasText: new RegExp(`^\\s*${tile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') }).first();
  if ((await button.count()) === 0) return false;
  await button.click();
  await settle(page);
  return true;
}
// the names of the tiles the search shows, in order
export async function tilesFor(page: Page, term: string): Promise<string[]> {
  const search = page.locator(INSERT_SEARCH).first();
  if (!(await search.isVisible().catch(() => false))) await rail(page, 'insert');
  await search.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(term, { delay: 20 });
  await settle(page);
  return page.locator('[data-door="element.insert#elements-tile"]').allInnerTexts();
}

// a field of the Style or Settings tab by its door, its section opened as a person opens it, the value typed and kept
export async function field(page: Page, ref: string, value: string, args: Record<string, unknown> = {}): Promise<void> {
  let row: Locator = control(page, ref, { args }).first();
  if ((await row.count()) === 0) {
    await openStyleControl(page, ref, args);
    row = control(page, ref, { args }).first();
  }
  await row.scrollIntoViewIfNeeded();
  const input = row.locator('input, textarea').first();
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(value, { delay: 10 });
  await page.keyboard.press('Enter');
  await settle(page);
}

// a canvas element by its text: a click on it
export async function pick(page: Page, text: string, n = 1, modifiers: ('Shift' | 'Control')[] = []): Promise<void> {
  const p = await canvasPoint(page, text, n);
  if (p === null) throw new Error(`no element reads ${text}`);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers.reverse()) await page.keyboard.up(m);
  await settle(page);
}
// a canvas text edited in place: double-click, select all, type, Escape keeps it
export async function editText(page: Page, text: string, next: string, n = 1): Promise<void> {
  const p = await canvasPoint(page, text, n);
  if (p === null) throw new Error(`no element reads ${text}`);
  await page.mouse.dblclick(p.x, p.y);
  await settle(page);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(next, { delay: 8 });
  await page.keyboard.press('Escape');
  await settle(page);
}
// a crumb of the status bar's breadcrumb by its words: the person climbs to the block holding the selection
export async function crumb(page: Page, words: string): Promise<void> {
  const item = page.locator('[data-region="status-bar"] button, [data-region="status-bar"] [role="button"]').filter({ hasText: words }).last();
  await item.click();
  await settle(page);
}
// File › an item (by its door), with the files it asks for
export async function fileMenu(page: Page, ref: string, files?: string | string[]): Promise<void> {
  await openMenu(page, 'file');
  const item = page.locator(`[data-door="${ref}"]`).first();
  if (files !== undefined) {
    const chooser = page.waitForEvent('filechooser');
    await item.click();
    await (await chooser).setFiles(files);
  } else await item.click();
  await page.waitForTimeout(600);
  await page.locator('.workbench').waitFor();
}
export async function key(page: Page, chord: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) await page.keyboard.press(chord);
  await settle(page);
}

// command-bar beyond its scenarios (spec/BEHAVIOUR.md#command-bar): the bar offers only the commands that apply to the
// selection (Problems in Pager 2), the recently run entry first on an empty query, a query's words in any order
// (Problems in Pager 3), a press on the backdrop closes it, and while a text is edited Ctrl+K keeps its link meaning
// and opens no bar. The document and the selection are read through the read-only test port.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const CTRL_K = 'commandBar.open#key-ctrl-k-in-global';
const ROW = 'selection.select#layers-row';
const WRAP = 'element.wrapRow#command-bar';
const INSERT = 'element.insert#command-bar-insert';
const BACKDROP = 'ui.dismiss#overlay-backdrop';
const START_EDIT = 'text.startEdit#key-enter-in-canvas';
const CLICK = 'selection.select#canvas-click-element-or-page';

const bar = (page: Page) => page.locator('[data-region="command-palette"]');
const options = (page: Page) => bar(page).locator('[role="option"]').evaluateAll((els) => els.map((el) => el.textContent ?? ''));
const hero = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => unknown }>).__builderTestPort;
    const doc = p?.document() as { pages: { tree: { children: { id: string; name: string; children: { name: string }[] }[] } }[] };
    return doc.pages[0]?.tree.children.find((c) => c.id === 'n-hero')?.children.map((c) => c.name);
  });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-a-title"]')).toHaveCount(1);
});

test('the bar offers a command only while it applies to the selection', runs(CTRL_K, ROW), async ({ page }) => {
  await runDoor(page, CTRL_K);
  await page.keyboard.type('wrap in a');
  expect(await options(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await runDoor(page, CTRL_K);
  await page.keyboard.type('wrap in a');
  expect(await options(page)).toEqual(['Wrap in a row', 'Wrap in a column', 'Wrap in a container', 'Wrap in a grid']);
});

test('the entry run last comes first on an empty query', runs(CTRL_K, ROW, WRAP), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await runDoor(page, CTRL_K);
  await expect(bar(page), 'the bar opens').toBeVisible();
  const first = (await options(page))[0];
  expect(first).not.toBe('Wrap in a row');
  await page.keyboard.type('wrap in a row');
  await expect(control(page, WRAP), 'the bar offers Wrap in a row').toBeVisible();
  await control(page, WRAP).click();
  expect(await hero(page)).toEqual(['Title', 'Row', 'Actions']);
  await runDoor(page, CTRL_K);
  expect((await options(page))[0]).toBe('Wrap in a row');
});

test('the words of a query match in any order, and a press on the backdrop closes the bar', runs(CTRL_K, INSERT, BACKDROP), async ({ page }) => {
  await runDoor(page, CTRL_K);
  await page.keyboard.type('hero ins');
  expect(await options(page)).toContain('Insert Hero');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('ins hero');
  expect((await options(page))[0]).toBe('Insert Hero');
  await control(page, BACKDROP).click({ position: { x: 4, y: 4 } });
  await expect(bar(page)).toHaveCount(0);
  expect(await hero(page)).toEqual(['Title', 'Intro', 'Actions']);
});

test('while a text is edited, Ctrl+K opens no bar', runs(CLICK, START_EDIT, CTRL_K), async ({ page }) => {
  // the Title clicked on the canvas (at its centre on the screen, through the frame's zoom): selected, the focus there
  const at = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const el = iframe?.contentDocument?.querySelector('[data-node="n-title"]');
    if (!iframe || !el) throw new Error('the canvas does not draw the Title');
    const frame = iframe.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const zoom = iframe.currentCSSZoom;
    return { x: frame.left + (r.left + r.width / 2) * zoom, y: frame.top + (r.top + r.height / 2) * zoom };
  });
  await page.mouse.click(at.x, at.y);
  await runDoor(page, START_EDIT);
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-title"][contenteditable]')).toHaveCount(1);
  await page.keyboard.press('Control+K');
  await expect(bar(page)).toHaveCount(0);
  // the key keeps its meaning in the text (the audit's AUD-35: no bar alone proved nothing ran): the link's address
  // field takes the focus, and the text is still edited
  await expect(page.locator('[data-local="link-address"]')).toBeFocused();
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-title"][contenteditable]')).toHaveCount(1);
});

// The backdrop is the whole window: a press anywhere outside the panel closes the bar, and Escape still closes it after
// (the audit's U-002: the backdrop was a 28 px strip); every entry shows one icon (U-003: it showed two).
test('a press anywhere outside the bar closes it, and each entry shows one icon', runs(CTRL_K, BACKDROP), async ({ page }) => {
  await runDoor(page, CTRL_K);
  await page.keyboard.type('ins');
  const icons = await bar(page).locator('[role="option"]').evaluateAll((els) => els.map((el) => el.querySelectorAll('svg').length));
  expect(icons.length).toBeGreaterThan(0);
  expect(icons.every((count) => count <= 1)).toBe(true);
  await control(page, BACKDROP).click({ position: { x: 720, y: 850 } });
  await expect(bar(page)).toHaveCount(0);
  await runDoor(page, CTRL_K);
  await page.mouse.click(40, 850);
  await expect(bar(page)).toHaveCount(0);
  await runDoor(page, CTRL_K);
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
});

// The scope pills (spec command-bar, Problems in Pager 5; the canonical palette): All is pressed with no prefix; a press
// on Insert puts its prefix before the words, keeping only insert entries; All takes the prefix away.
test('the scope pills show the scope in force and change it, keeping the words typed', runs(CTRL_K), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, CTRL_K);
  const field = bar(page).locator('input[role="combobox"]');
  await page.keyboard.type('hero');
  const pill = (name: string) => bar(page).locator('.command-bar__scope', { hasText: name });
  await expect(pill('All')).toHaveAttribute('aria-pressed', 'true');
  await pill('Insert +').click();
  await expect(field).toHaveValue('+hero');
  await expect(pill('Insert +')).toHaveAttribute('aria-pressed', 'true');
  expect((await options(page)).every((text) => /insert/i.test(text)), (await options(page)).join(' | ')).toBe(true);
  await expect(field).toBeFocused();
  await pill('All').click();
  await expect(field).toHaveValue('hero');
});

test('a command the query names that cannot run now is not offered, and the bar says why', runs(CTRL_K), async ({ page }) => {
  // the dogfooding pass: "dup" with nothing selected answered only that nothing matched
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await runDoor(page, CTRL_K);
  await page.keyboard.type('dup');
  await expect(bar(page).locator('[role="option"]')).toHaveCount(0);
  await expect(bar(page).locator('.command-bar__none')).toContainText('Duplicate');
  await expect(bar(page).locator('.command-bar__none')).toContainText('cannot run now');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('zzzqqq');
  await expect(bar(page).locator('.command-bar__none')).toContainText('No command');
});

// Every entry's words start at one place, an entry without an icon keeping the icon's room (the user's review of
// 2026-10-05, LR2: Paste style and New blank page, drawn without icons, started 4 px left of every other entry — their
// placeholder was 12 px wide where an icon is 16).
test('every palette entry\'s words start at the same place, with an icon or without', runs(CTRL_K), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, CTRL_K);
  const entries = page.locator('[data-region="command-palette"] .command-bar__entry');
  await expect(entries.first()).toBeVisible();
  const starts = await entries.evaluateAll((all) => all.filter((one) => one.getClientRects().length > 0).map((one) => Math.round(one.querySelector('.command-bar__label')?.getBoundingClientRect().left ?? -1)));
  expect(starts.length).toBeGreaterThan(5);
  expect(new Set(starts).size, `starts ${[...new Set(starts)].join(', ')}`).toBe(1);
});

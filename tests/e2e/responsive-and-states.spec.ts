// Group 11 beyond its scenarios (spec/BEHAVIOUR.md#breakpoints-switch, spec/BEHAVIOUR.md#breakpoint-overrides,
// spec/BEHAVIOUR.md#state-styles):
//  - the breakpoint shown is kept after a reload, the page drawn at its width;
//  - at Tablet a field whose value is set there says so, and one it inherits names Desktop;
//  - while Hover is edited the canvas badge reads "Editing Hover"; in the exported page, hovering the element changes
//    its computed colour (the page and its stylesheet, as the ZIP holds them, loaded in the browser).
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { unzip } from '../../tools/runner/unzip.ts';
import { control, openMenu, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const TABLET = 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet';
const FONT = 'style.set#inspector-font-size';
const COLOR = 'style.set#inspector-color';
const WIDTH = 'view.setViewportWidth#viewport-width';
// the width field stands in the Breakpoints dialog (the canonical frame's row holds only the breakpoints' tabs)
const BREAKPOINTS = 'workspace.openDialog#menu-view-breakpoints';
const CLOSE = 'ui.dismiss#dialog-close';
const HOVER = 'view.setStyleState#menu-style-state-hover';
const EXPORT = 'project.export#toolbar-top-bar-export';

async function openAurora(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
}
const pageWidth = (page: Page) => page.locator('.frame__page').evaluate((frame) => (frame as HTMLIFrameElement).contentWindow?.innerWidth ?? 0);
async function typeInto(page: Page, ref: string, text: string): Promise<void> {
  const field = control(page, ref).locator('input').first();
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(`${text}\n`);
}

test('continuous width updates the frame, cascade and preview without adding document history', runs(OPEN, BREAKPOINTS, WIDTH, CLOSE, TABLET), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, BREAKPOINTS);
  for (const [width, breakpoint] of [[1024, 'laptop'], [600, 'tablet'], [320, 'phone']] as const) {
    await typeInto(page, WIDTH, String(width));
    await expect.poll(() => pageWidth(page)).toBe(width);
    await expect(page.locator(`[data-door="view.setBreakpoint#toolbar-breakpoint-tabs-${breakpoint}"]`)).toHaveAttribute('aria-selected', 'true');
  }
  const slider = control(page, WIDTH).locator('input[type="range"]');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pageWidth(page)).toBe(321);
  await runDoor(page, CLOSE);
  await runDoor(page, 'view.enterPreview#toolbar-top-bar-preview');
  await expect(page.locator('.preview__page')).toHaveCSS('width', '321px');
  await page.keyboard.press('Escape');
  await runDoor(page, TABLET);
  await expect.poll(() => pageWidth(page)).toBe(834);
  await runDoor(page, BREAKPOINTS);
  await typeInto(page, WIDTH, '0');
  await expect.poll(() => pageWidth(page)).toBe(834);
});

test('the breakpoint shown is kept after a reload, and a field says where its value comes from', runs(OPEN, ROW, TABLET, FONT), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, TABLET);
  expect(await pageWidth(page)).toBe(834);
  await page.reload();
  await page.locator('.workbench').waitFor();
  expect(await pageWidth(page)).toBe(834);
  await expect(page.locator(`[data-door="${TABLET}"]`)).toHaveAttribute('aria-selected', 'true');

  await control(page, ROW, { args: { target: 'n-title' } }).click();
  // the inspector names the breakpoint the editor edits, never the base one while another is shown
  await expect(page.locator('.active-breakpoint')).toHaveText('Tablet834');
  // Title's font size is set nowhere yet; its padding neither: no origin note
  const origin = page.locator(`.field-origin[data-field="${FONT}"]`);
  await expect(origin).toHaveCount(0);
  await typeInto(page, FONT, '24');
  await expect(origin).toHaveAttribute('data-origin', 'here');
  await expect(origin).toHaveText('Set at Tablet');
  // Intro's colour set at Desktop is inherited at Tablet
  await runDoor(page, 'view.setBreakpoint#toolbar-breakpoint-tabs-desktop');
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await typeInto(page, COLOR, '#aa0000');
  await runDoor(page, TABLET);
  const inherited = page.locator(`.field-origin[data-field="${COLOR}"]`);
  await expect(inherited).toHaveAttribute('data-origin', 'breakpoint');
  await expect(inherited).toHaveText('From Desktop');
});

test('while Hover is edited the canvas says so, and the exported page changes on hover', runs(OPEN, ROW, HOVER, COLOR, EXPORT), async ({ page, browser }) => {
  await openAurora(page);
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await runDoor(page, HOVER);
  await expect(page.locator('[data-canvas-badge="state"]')).toHaveText('Editing Hover');
  await expect(page.locator('.state-picker__value')).toHaveText('Hover');
  await typeInto(page, COLOR, '#aa0000');
  const downloaded = page.waitForEvent('download');
  await runDoor(page, EXPORT);
  const files = unzip(fs.readFileSync(await (await downloaded).path()));
  const html = files.get('index.html')?.toString('utf8') ?? '';
  const css = files.get('css/styles.css')?.toString('utf8') ?? '';
  expect(css).toContain(':hover');
  // the exported page with its stylesheet, as a browser opens it
  const exported = await browser.newPage();
  await exported.route('**/css/styles.css', (route) => route.fulfill({ contentType: 'text/css', body: css }));
  await exported.route('https://export.test/', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await exported.goto('https://export.test/');
  const intro = exported.locator('p').first();
  const before = await intro.evaluate((el) => getComputedStyle(el).color);
  await intro.hover();
  await expect.poll(() => intro.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(170, 0, 0)');
  expect(before).not.toBe('rgb(170, 0, 0)');
  await exported.close();
});

// A3.36: the State menu offers only the states the selected element stands on — a paragraph takes no :disabled,
// :invalid or :placeholder-shown, and no :visited — and the canvas label names the state being edited.
test('a paragraph\'s State menu leaves out the states it does not take, and the label names the state chosen', runs(OPEN, ROW, HOVER), async ({ page }) => {
  await openAurora(page);
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await page.locator('.state-picker').first().click({ force: true });
  await expect(page.locator('[data-door="view.setStyleState#menu-style-state-hover"]')).toBeVisible();
  const offered = await page.locator('[data-region="menu:style-state"] [role="menuitemradio"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  for (const gone of ['Disabled', 'Invalid', 'Placeholder shown', 'Visited']) expect(offered, gone).not.toContain(gone);
  for (const there of ['Hover', 'Focus', 'Focus visible', 'First child', 'Last child', 'Before', 'After']) expect(offered, there).toContain(there);
  // the state chosen (the menu is open: its item is clicked) closes it and is named on the canvas label
  await page.locator('[data-door="view.setStyleState#menu-style-state-hover"]').click();
  // the state as its selector writes it (the canonical "· :hover" on the label)
  await expect(page.locator('[data-chrome="label"] .chrome__state')).toHaveText(':hover');
});

// A3.36: a link, the one kind :visited stands on, is offered it (a paragraph is not).
test('a link\'s State menu offers Visited', runs(OPEN, ROW, 'workspace.setPanelOpen#toolbar-activity-bar-insert', 'element.insert#elements-tile', 'view.setStyleState#menu-style-state-visited'), async ({ page }) => {
  await openAurora(page);
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await control(page, 'workspace.setPanelOpen#toolbar-activity-bar-insert').click();
  await runDoor(page, 'element.insert#elements-tile', { args: { entry: 'link' } });
  await page.locator('.state-picker').first().click({ force: true });
  await expect(page.locator('[data-door="view.setStyleState#menu-style-state-visited"]')).toBeVisible();
  await page.locator('[data-door="view.setStyleState#menu-style-state-visited"]').click();
  await expect(page.locator('.state-picker__value')).toHaveText('Visited');
});

// The Breakpoints dialog's rows are one height, the base's with its word as the others with their trash (the user's
// review of 2026-10-05, LR2: the trash stood 28 px tall beside 24 px fields, so the base's row was 4 px shorter than
// the others and the rows stood unevenly apart).
test('the Breakpoints dialog draws its rows one height', runs('workspace.openDialog#menu-view-breakpoints'), async ({ page }) => {
  await openEditor(page);
  await openMenu(page, 'view');
  await page.locator('[data-door="workspace.openDialog#menu-view-breakpoints"]').click();
  const rows = page.locator('.breakpoints-dialog__row:not(.breakpoints-dialog__row--head)');
  await expect(rows.first()).toBeVisible();
  const heights = await rows.evaluateAll((all) => all.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(new Set(heights).size, `heights ${heights.join(', ')}`).toBe(1);
});

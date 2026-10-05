// The Checks panel (manifest feature accessibility-checks; the user's real-use audit, 7.5 and A3.39): the document's
// issues (core/a11y/checks.ts, the one owner) are listed with their category, their rule, the element they are about
// and the fix to suggest; a row selects its element on the canvas; the list follows every command; and a page with
// issues edits and exports like any other — a check is advice, never a gate.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor } from './door.ts';

const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const CHECKS = 'workspace.setPanelOpen#menu-view-checks';
const EXPORT = 'project.export#toolbar-top-bar-export';

const rows = (page: Page): Promise<string[]> => page.locator('.dock-checks__row').allTextContents();
// a page with nothing to report says so in the panel's own words
const none = (page: Page): Promise<string | null> => page.locator('.dock-checks__none').textContent();
const selection = (page: Page): Promise<readonly string[]> =>
  page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => readonly string[] } }).__builderTestPort.selection());

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
}

test('the panel lists every issue with its category and fix, and a row selects its element', async ({ page }) => {
  await open(page);
  await runDoor(page, INSERT_PANEL, {});
  await runDoor(page, TILE, { args: { entry: 'image' } });
  await runDoor(page, TILE, { args: { entry: 'link' } });
  await runDoor(page, CHECKS, {});
  await expect(page.locator('[data-region="dock-checks"]')).toBeVisible();
  const listed = await rows(page);
  // an image with no alt is the accessibility rule; a link with neither an address nor text is the links rules
  expect(listed.some((row) => row.includes('Accessibility') && row.includes('Image without alt text in Image')), `the image issue is listed (${listed.join(' | ')})`).toBe(true);
  expect(listed.some((row) => row.includes('Links') && row.includes('Link without an address in Link')), 'the address issue is listed').toBe(true);
  // an image with no source is an export issue: the canvas draws a placeholder, the exported page nothing (the journey
  // "site")
  expect(listed.some((row) => row.includes('Export') && row.includes('Image without a source in Image')), 'the source issue is listed').toBe(true);
  expect(listed.every((row) => row.includes('Fix:')), 'every row suggests its fix').toBe(true);
  // pressing a row selects the element it is about (the canvas and the Layers agree through the selection)
  const before = await selection(page);
  await page.locator('.dock-checks__row').first().click();
  await expect.poll(() => selection(page), { message: 'the row selected its element' }).not.toEqual(before);
  await expect(page.locator('[data-door="selection.select#layers-row"]').first()).toBeVisible();
});

// A problem is marked as one: a check mark reads "passed" (VS Code's codicons: check and pass for success, warning for
// a warning), so each row wears the warning triangle in the warning colour (the user's review of 2026-10-05, LR2: every
// problem started with the Checks tab's own check mark).
test('each problem is marked with the warning triangle, never the check mark', async ({ page }) => {
  await open(page);
  await runDoor(page, INSERT_PANEL, {});
  await runDoor(page, TILE, { args: { entry: 'image' } });
  await runDoor(page, CHECKS, {});
  const marks = page.locator('.dock-checks__row > svg use');
  await expect(marks.first()).toBeVisible();
  const names = await marks.evaluateAll((all) => all.map((one) => one.getAttribute('href')));
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names)).toEqual(new Set(['#triangle-alert']));
  const colours = await page.locator('.dock-checks__row > svg').evaluateAll((all) => all.map((one) => getComputedStyle(one).color));
  const warning = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-warning)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  expect(new Set(colours)).toEqual(new Set([warning]));
});

test('the list follows the document and never blocks the export', async ({ page }) => {
  await open(page);
  await runDoor(page, CHECKS, {});
  await runDoor(page, INSERT_PANEL, {});
  await expect.poll(() => none(page), { message: 'a page with no issue says so' }).toBe('No issues');
  await runDoor(page, TILE, { args: { entry: 'image' } });
  // its two issues, no alt text and no source (the journey "site": the exported page shows nothing in its place), in
  // its one row
  await expect.poll(() => rows(page), { message: 'the image it just inserted is reported at once' }).toHaveLength(1);
  expect(await page.locator('.dock-checks__row .dock-checks__issue').count(), 'the row holds both issues').toBe(2);
  // the fix: alt text written in the Settings removes that issue, with no other command
  await runDoor(page, 'workspace.setActiveTab#inspector-tab-settings', {});
  await control(page, 'element.setAttribute#inspector-alt').locator('input, textarea').first().fill('A photo');
  await control(page, 'element.setAttribute#inspector-alt').locator('input, textarea').first().press('Enter');
  await expect.poll(() => page.locator('.dock-checks__row .dock-checks__issue').count(), { message: 'the alt issue is gone once its alt text is written' }).toBe(1);
  // and with issues standing, the export still writes the site
  await runDoor(page, TILE, { args: { entry: 'link' } });
  await expect.poll(() => rows(page)).toHaveLength(2);
  const download = page.waitForEvent('download');
  await runDoor(page, EXPORT, {});
  const file = await download;
  expect(fs.readFileSync(await file.path()).length, 'the site was written although the page has issues').toBeGreaterThan(0);
});

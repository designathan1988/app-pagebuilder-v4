// The Style tab's concept rows (spec/BEHAVIOUR.md#inspector-panel, item 4a; plan item 2.D): one row per concept, its
// details in place under its head behind a disclosure in the section's gutter. Proven here: the budget — All
// properties with every section open and the rows closed fits four screens of the inspector for every kind of element
// the fixture holds —, the disclosure's keys and names, the user's choice kept for every element, and every detail reachable (the
// opening rule is proven by src/editor/inspector/concept-rows.test.ts). The document is read through the
// read-only test port.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs, setSectionOpen } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const SECTION = 'inspector.toggleSection#inspector-section-header';
const TOGGLE = 'inspector.toggleRow#inspector-row-disclosure';
const ALL = 'inspector.setMode#inspector-mode-all';
const OVERFLOW_X = 'style.set#inspector-overflow-x';

const PROPERTIES = JSON.parse(fs.readFileSync('manifest/properties.json', 'utf8')) as {
  sections: { id: string }[];
  conceptRows: { id: string; section: string; details: string[] }[];
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-hero"]')).toHaveCount(1);
});

async function select(page: Page, target: string): Promise<void> {
  await control(page, ROW, { args: { target } }).click();
  await runDoor(page, ALL);
  for (const section of PROPERTIES.sections.map((s) => s.id)) {
    if ((await control(page, SECTION, { args: { section } }).count()) > 0) await setSectionOpen(page, section, true);
  }
}

// the inspector's scroller: its whole content in screens of its own height
const screens = (page: Page) => page.locator('.inspector-scroll').evaluate((el) => el.scrollHeight / el.clientHeight);

test('All properties, every section open and the rows closed, fits four screens for every kind of element', runs(OPEN, ROW, SECTION, ALL), async ({ page }) => {
  for (const target of ['n-page', 'n-hero', 'n-title', 'n-intro', 'n-actions', 'n-grid', 'n-card-a', 'n-perks', 'n-perk-one', 'n-footer']) {
    await select(page, target);
    const measured = await screens(page);
    expect(measured, `${target}: ${measured.toFixed(2)} screens`).toBeLessThanOrEqual(4);
  }
});

test('a row opens and closes with its disclosure, a 24 px target named by its row, and keeps its state for every element', runs(OPEN, ROW, SECTION, ALL, TOGGLE), async ({ page }) => {
  await select(page, 'n-hero');
  const toggle = control(page, TOGGLE, { args: { row: 'overflow' } }).first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Details of Overflow');
  const box = await toggle.boundingBox();
  expect(box?.width ?? 0, 'the disclosure is 24 px wide').toBeGreaterThanOrEqual(24);
  expect(box?.height ?? 0, 'the disclosure is 24 px tall').toBeGreaterThanOrEqual(24);
  await expect(control(page, OVERFLOW_X)).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const details = page.locator('[data-concept-row="overflow"] [role="group"]');
  await expect(details).toHaveAttribute('aria-label', 'Overflow');
  await expect(details.locator(`[data-door="${OVERFLOW_X}"]`)).toHaveCount(1);
  // the same row stays open on another element
  await select(page, 'n-title');
  await expect(control(page, TOGGLE, { args: { row: 'overflow' } }).first()).toHaveAttribute('aria-expanded', 'true');
  await control(page, TOGGLE, { args: { row: 'overflow' } }).first().press('Space');
  await expect(control(page, TOGGLE, { args: { row: 'overflow' } }).first()).toHaveAttribute('aria-expanded', 'false');
  // no history, no document change
  const history = await page.evaluate(() => (window as unknown as { __builderTestPort: { history: () => { undoSteps: number } } }).__builderTestPort.history().undoSteps);
  expect(history).toBe(0);
});

test('every detail of every row is reachable: opened, each row draws the details the element takes', runs(OPEN, ROW, SECTION, ALL, TOGGLE), async ({ page }) => {
  for (const target of ['n-hero', 'n-title', 'n-grid', 'n-perks']) {
    await select(page, target);
    const rows = await page.locator(`[data-door="${TOGGLE}"]`).evaluateAll((els) => els.map((el) => (JSON.parse(el.getAttribute('data-args') ?? '{}') as { row: string }).row));
    for (const row of rows) {
      const toggle = control(page, TOGGLE, { args: { row } }).first();
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      const detail = page.locator(`[data-concept-row="${row}"] [role="group"] [data-door]`).first();
      await expect(detail, `${target}: the details of ${row}`).toBeAttached();
      // reachable, not only in the markup (the audit's AUD-35): scrolled to, the detail lies in the window
      await detail.scrollIntoViewIfNeeded();
      await expect(detail, `${target}: a detail of ${row} in the window`).toBeInViewport();
    }
  }
});

// A detail takes the shorter name its concept row gives it (properties.json shortLabels: under Border, "Top width"; under
// Radius, "Top left"), the concept naming the rest. The user's review of 2026-10-05 made a pair's first field keep its own
// name (Width) under the row's label (Size); that change once drew every detail under its whole name again ("Largura da
// borda superior" in two lines), which no test saw.
test('every detail a concept row names shorter is drawn under that name', runs(OPEN, ROW, SECTION, ALL, TOGGLE), async ({ page }) => {
  const rows = (JSON.parse(fs.readFileSync('manifest/properties.json', 'utf8')) as { conceptRows: { id: string; shortLabels?: Record<string, string> }[] }).conceptRows;
  const words = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;
  const named = rows.flatMap((row) => Object.entries(row.shortLabels ?? {}).map(([door, key]) => ({ row: row.id, door, word: words[key] ?? key })));
  expect(named.length, 'properties.json gives some details a shorter name').toBeGreaterThan(0);
  const seen = new Set<string>();
  for (const target of ['n-card-a', 'n-title', 'n-grid']) {
    await select(page, target);
    for (const row of new Set(named.map((one) => one.row))) {
      const toggle = control(page, TOGGLE, { args: { row } });
      if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
    for (const one of named) {
      const field = page.locator(`[data-region="inspector-style"] [data-door="${one.door}"]`).first();
      if ((await field.count()) === 0) continue;
      const label = page.locator(`[data-region="inspector-style"] .field-row:has([data-door="${one.door}"]) > .field-row__label, [data-region="inspector-style"] .field-row[data-door="${one.door}"] > .field-row__label`).first();
      await expect(label, `${one.door} under ${one.row}`).toHaveText(one.word);
      seen.add(one.door);
    }
  }
  expect(seen.size, 'the details named shorter were drawn').toBeGreaterThan(4);
});

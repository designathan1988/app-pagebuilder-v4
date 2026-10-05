// A form field's Settings tab draws each control whole, on its line, at the tab's own column (the user's review of
// 2026-10-05, LR2, photographed on a select in both languages: each option broke over two lines — its name and its up
// arrow, then its down arrow and its remove — and "Add an option" was cut).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const SETTINGS = 'workspace.setActiveTab#inspector-tab-settings';

async function openSelect(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'form-controls.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/form-controls.json') });
  await control(page, ROW, { args: { target: 'n-select' } }).click();
  await runDoor(page, SETTINGS);
}

test('a select\'s options stand one to a line, their buttons beside their names, the add buttons whole', runs(OPEN, ROW, SETTINGS), async ({ page }) => {
  await openSelect(page);
  const editor = page.locator('.parts-editor');
  await expect(editor).toBeVisible();
  const found = await editor.evaluate((root) => {
    const problems: string[] = [];
    for (const row of root.querySelectorAll<HTMLElement>(':scope > .field-row')) {
      const tops = new Set([...row.children].filter((one) => one.getClientRects().length > 0).map((one) => Math.round(one.getBoundingClientRect().top + one.getBoundingClientRect().height / 2)));
      if (tops.size > 1) problems.push(`over ${tops.size} lines: ${row.textContent?.trim() ?? ''}`);
    }
    for (const label of root.querySelectorAll<HTMLElement>('.door__label')) {
      if (label.getClientRects().length > 0 && label.scrollWidth > label.clientWidth + 1) problems.push(`cut: ${label.textContent?.trim() ?? ''}`);
    }
    return problems;
  });
  expect(found).toEqual([]);
});

// The Form section stands as every section of the tab: its labels and its values at the tab's columns, its fields
// apart (LR2: a section drawn inside the section, its labels 12 px in and its values 12 px right of every other
// section's, its fields touching into one dark block).
test('the Form section keeps the tab\'s columns and its fields apart', runs(OPEN, ROW, SETTINGS), async ({ page }) => {
  await openSelect(page);
  const found = await page.locator('[data-region="inspector-settings"]').evaluate((tab) => {
    const general = tab.querySelector('.settings-section .field-row');
    const form = tab.querySelector('[data-region="forms-settings"]');
    const rows = form === null ? [] : [...form.querySelectorAll<HTMLElement>('.field-row')].filter((row) => row.getClientRects().length > 0);
    const at = (row: Element | null | undefined, part: string) => Math.round(row?.querySelector(part)?.getBoundingClientRect().left ?? -1);
    const misplaced = rows.filter((row) => row.querySelector(':scope > .field-row__label') !== null && (at(row, ':scope > .field-row__label') !== at(general, ':scope > .field-row__label'))).length;
    const touching = rows.slice(1).filter((row, i) => row.getBoundingClientRect().top - (rows[i]?.getBoundingClientRect().bottom ?? 0) < 2).length;
    return { misplaced, touching };
  });
  expect(found).toEqual({ misplaced: 0, touching: 0 });
});

// Every name of the Settings tab fits one line, in both languages (the user's review of 2026-10-05, LR2: "Label for
// assistive readers", "Open in a new tab (adds rel=…)", "Allowed values, one per line", seventeen "Message: <the whole
// default message>" and, in Portuguese, the page's sharing title and image and five more took two to five lines). A
// name is said short, as the Style tab's (DEC-66); what a field takes shows as its placeholder — a message field's the
// message it shows when left empty, in the language the messages are in.
for (const [fixture, targets] of [['canonical.json', ['c-page', 'c-hero', 'c-nav-0', 'c-hero-image']], ['form-controls.json', ['n-select']]] as const) {
  test(`every name of the Settings tab fits one line in both languages (${fixture})`, runs(OPEN, ROW, SETTINGS, 'preferences.setLanguage#menu-language-pt-br'), async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    const chooser = page.waitForEvent('filechooser');
    await runDoor(page, OPEN);
    await (await chooser).setFiles({ name: fixture, mimeType: 'application/json', buffer: fs.readFileSync(`manifest/features/fixtures/${fixture}`) });
    const wrapped = () => page.evaluate(() => [...document.querySelectorAll('[data-region="inspector-settings"] .field-row__label')].filter((label) => label.getClientRects().length > 0).flatMap((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size > 1 ? [label.textContent?.trim() ?? ''] : [];
    }));
    const found: string[] = [];
    for (const language of ['en', 'pt-BR']) {
      if (language === 'pt-BR') await runDoor(page, 'preferences.setLanguage#menu-language-pt-br');
      for (const target of targets) {
        await control(page, ROW, { args: { target } }).click();
        await runDoor(page, SETTINGS);
        found.push(...(await wrapped()).map((label) => `${language} ${target}: ${label}`));
      }
    }
    expect(found).toEqual([]);
  });
}

// A concept row's name stands on its disclosure's line, however tall the row's control is (the user's review of
// 2026-10-05, LR2: the Anchors row's two lines of anchor buttons centred its name under the disclosure, which stood
// alone above it as a row of its own — the rule the alignment matrix already kept, kept for every row).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const SECTION = 'inspector.toggleSection#inspector-section-header';

test('every concept row\'s name stands level with its disclosure', runs(OPEN, ROW, SECTION), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  // the header, placed relative: its Position section holds the Anchors row (the inset concept)
  await control(page, ROW, { args: { target: 'c-header' } }).click();
  for (const header of await control(page, SECTION).all()) if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
  await expect(page.locator('[data-concept-row="inset"]')).toBeVisible();
  const apart = await page.locator('[data-region="inspector-style"]').evaluate((region) => [...region.querySelectorAll('.concept-row')].flatMap((row) => {
    const toggle = row.querySelector('.concept-row__toggle')?.getBoundingClientRect();
    const label = row.querySelector('.concept-row__head .field-row__label')?.getBoundingClientRect();
    if (toggle === undefined || label === undefined || label.height === 0) return [];
    const off = Math.abs(toggle.top + toggle.height / 2 - (label.top + label.height / 2));
    return off > 2 ? [`${row.getAttribute('data-concept-row')}: ${Math.round(off)} px`] : [];
  }));
  expect(apart).toEqual([]);
});

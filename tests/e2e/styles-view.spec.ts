// The Styles view says what to do when it has nothing to show, and shows each variable's name whole (the user's review
// of 2026-10-05, LR2: an empty project's Styles view was two titles over nothing, and "terracota-escuro" read
// "terracota·" in a field half the row wide beside a value that needed a third of its own).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const EN = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;
const STYLES = 'workspace.setPanelOpen#toolbar-activity-bar-styles';
const OPEN = 'project.open#menu-file';

test('an empty project\'s Styles view says how to make a class and a variable', runs(STYLES), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, STYLES);
  const view = page.locator('[data-region="styles"]');
  await expect(view.getByText(EN['styles.noClasses'] ?? '-', { exact: true })).toBeVisible();
  await expect(view.getByText(EN['styles.noVariables'] ?? '-', { exact: true })).toBeVisible();
});

test('a project\'s Styles view says none of that, and shows every variable\'s name and value whole', runs(OPEN, STYLES), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  await runDoor(page, STYLES);
  const view = page.locator('[data-region="styles"]');
  await expect(view.locator('.variables__row').first()).toBeVisible();
  await expect(view.getByText(EN['styles.noClasses'] ?? '-', { exact: true })).toHaveCount(0);
  await expect(view.getByText(EN['styles.noVariables'] ?? '-', { exact: true })).toHaveCount(0);
  const cut = await view.locator('.variables__row input').evaluateAll((all) => all.filter((input) => (input as HTMLInputElement).scrollWidth > (input as HTMLInputElement).clientWidth + 1).map((input) => (input as HTMLInputElement).value));
  expect(cut).toEqual([]);
});

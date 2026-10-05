// The Settings tab says whose settings it shows: the selected element's head, its icon, name and tag, as the Style
// tab's selector bar and the Interactions tab's head (the user's audit order of 2026-10-05).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';

test('the Settings tab heads its fields with the selected element', runs(OPEN, ROW), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  await page.locator('[data-door$="#inspector-tab-settings"]').first().click();
  const head = page.locator('[data-region="inspector-settings-head"]');
  await expect(head).toContainText('Title');
  await expect(head.locator('.selector-bar__tag')).toHaveText('h1');
  // nothing selected: the tab says so itself, with no head
  await page.keyboard.press('Escape');
  await page.locator('[data-canvas-stage]').click({ position: { x: 4, y: 4 } });
  await expect(head).toHaveCount(0);
});

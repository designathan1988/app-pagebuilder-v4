// Escape leaves the Layout tool even while the toolbar button still holds focus before the stage takes it.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-layout-composer';
const ENTER = 'layout.enter#layout-compose';
const LEAVE = 'layout.leave#layout-escape';

test('Escape leaves Layout while its toolbar button has focus', runs(PANEL, ENTER, LEAVE), async ({ page }) => {
  const photos = '.cache/logs/fl1';
  fs.mkdirSync(photos, { recursive: true });
  await openEditor(page);
  await runDoor(page, PANEL);
  await runDoor(page, ENTER);
  await expect(page.locator('[data-layout-stage]')).toBeVisible();
  await page.screenshot({ path: `${photos}/layout-open.png` });
  await page.locator(`[data-door="${ENTER}"]`).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-layout-stage]')).toHaveCount(0);
  await page.screenshot({ path: `${photos}/layout-closed.png` });
});

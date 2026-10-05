// The dock's panels say one thing at a time, and the right thing (the user's review of 2026-10-05, criterion 15: with
// nothing selected the Timeline read "This element holds no animation yet.", with an element selected it read "Select
// an element to animate.", and the Motion panel wrote its "No timeline yet" twice, in its list and in its track area).
// An empty state says why it is empty and what to do next, once (Carbon Design System, "Empty states" pattern).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const EN = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const TIMELINE = 'workspace.setPanelOpen#dock-strip-timeline';
const MOTION = 'workspace.setPanelOpen#dock-strip-motion';

async function openAurora(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await expect(control(page, ROW, { args: { target: 'n-hero' } })).toBeVisible();
}

test('the Timeline asks for an element while none is selected, and says the element holds none once one is', runs(OPEN, ROW, TIMELINE), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, TIMELINE);
  const dock = page.locator('[data-region="dock-timeline"]');
  const select = EN['timeline.empty'] ?? '';
  const none = EN['timeline.noAnimations'] ?? '';
  // nothing selected: the panel asks for an element, and says nothing about "this element"
  await expect(dock.getByText(select, { exact: true })).toHaveCount(1);
  await expect(dock.getByText(none, { exact: true })).toHaveCount(0);
  // the hero selected, holding no animation: the panel says so, and no longer asks for an element
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  await expect(dock.getByText(none, { exact: true })).toHaveCount(1);
  await expect(dock.getByText(select, { exact: true })).toHaveCount(0);
});

test('the Motion panel says once that the project has no timeline', runs(OPEN, MOTION), async ({ page }) => {
  await openAurora(page);
  await runDoor(page, MOTION);
  const dock = page.locator('[data-region="dock-motion"]');
  await expect(dock).toBeVisible();
  await expect(dock.getByText(EN['motion.timeline.empty'] ?? '', { exact: true })).toHaveCount(1);
});

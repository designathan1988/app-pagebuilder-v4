// A Shift+click choosing a range of Layers rows selects rows, never the interface's text (the audit of 2026-10-05: the
// browser's text selection stretched blue over the whole editor).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';

test('Shift+click on a Layers row leaves no text selected', runs(OPEN, ROW), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  // a press on a text of the interface first (the inspector's guidance) leaves the browser's selection anchored there
  await page.locator('aside.inspector li').first().click();
  await control(page, ROW, { args: { target: 'c-nav-0' } }).click({ modifiers: ['Shift'] });
  await control(page, ROW, { args: { target: 'c-nav-2' } }).click({ modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection().length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''), 'no text of the interface selected').toBe('');
});

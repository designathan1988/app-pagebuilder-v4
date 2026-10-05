// The inspector reads and writes a keyframe only while the Timeline shows it: with the panel closed, a button whose
// animation starts at opacity 0 read "Opacity 0 %" and a value typed went into the animation (the audit of 2026-10-05).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs, setSectionOpen } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const OPACITY = 'style.set#inspector-opacity';

test('a selected element shows its own values with the Timeline closed, its keyframe\'s with the Timeline open', runs(OPEN, ROW, OPACITY), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  await control(page, ROW, { args: { target: 'c-subscribe' } }).click();
  await setSectionOpen(page, 'effects', true);
  const opacity = control(page, OPACITY).locator('input').first();
  const shown = async () => (await opacity.inputValue()) || (await opacity.getAttribute('placeholder')) || '';
  await expect.poll(shown, 'the Timeline closed: the element\'s own opacity').toMatch(/^1$|^100/);
  await page.locator('[data-door$="#dock-strip-timeline"]:visible').first().click();
  await expect.poll(shown, 'the Timeline open, its playhead on the first keyframe: the keyframe\'s').toMatch(/^0/);
});

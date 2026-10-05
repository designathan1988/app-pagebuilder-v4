// The Timeline's ruler reads in seconds and its transport bar says where the playhead stands (the user's review of
// 2026-10-05, LR2: the ruler was ten empty cells and nothing said the time; the canonical Timeline, design/final
// .tl-ruler and .tl-time: "0 s 0.3 s 0.6 s 0.9 s 1.2 s" over the track, "0.48 s / 1.20 s" beside Loop).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const TIMELINE = 'workspace.setPanelOpen#dock-strip-timeline';
const ANIMATION = 'timeline.show#timeline-animation-row';

test('the ruler names its quarters in seconds and the bar the playhead\'s time over the animation\'s length', runs(OPEN, ROW, TIMELINE, ANIMATION), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  const dock = page.locator('[data-region="dock-timeline"]');
  // nothing selected: no animation, no time
  await runDoor(page, TIMELINE);
  await expect(dock.locator('.timeline__ruler-label')).toHaveCount(0);
  await expect(dock.locator('.timeline__time')).toHaveCount(0);
  // the button's first animation, 1.2 s long
  await control(page, ROW, { args: { target: 'c-subscribe' } }).click();
  await expect(dock.locator('.timeline__ruler-label')).toHaveText(['0 s', '0.3 s', '0.6 s', '0.9 s', '1.2 s']);
  await expect(dock.locator('.timeline__time')).toHaveText('0.00 s / 1.20 s');
  // every label inside the ruler
  const outside = await dock.locator('.timeline__ruler').evaluate((ruler) => {
    const box = ruler.getBoundingClientRect();
    return [...ruler.querySelectorAll('.timeline__ruler-label')].filter((label) => {
      const own = label.getBoundingClientRect();
      return own.left < box.left - 1 || own.right > box.right + 1;
    }).map((label) => label.textContent);
  });
  expect(outside).toEqual([]);
  // the second animation, 0.8 s long
  await control(page, ANIMATION, { args: { animation: 'entrada-hero' } }).click();
  await expect(dock.locator('.timeline__ruler-label')).toHaveText(['0 s', '0.2 s', '0.4 s', '0.6 s', '0.8 s']);
  await expect(dock.locator('.timeline__time')).toHaveText('0.00 s / 0.80 s');
});

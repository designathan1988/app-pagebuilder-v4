// A motion card's Reduced motion field reads whole in both languages, and stays whole when the inspector is judged again
// (the audit of 2026-10-05, AU6-10: with the Motion dock opened the field read "Respect it (no movemen"). row-fit.ts
// stacked the row as drawn beside its label, then, judged again while stacked, measured the text and its frame alone —
// not the list's drop-down indicator Chrome draws inside an input with a datalist — found that it fit, and laid it back
// beside its label, cut.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const TAB = 'workspace.setActiveTab#inspector-tab-interactions';
const ADD = 'motion.add#inspector-motion-add';
const FIELD = 'motion.update#inspector-motion-reduced-motion';
const LANGUAGE = 'preferences.setLanguage#menu-language-pt-br';
const DOCK = 'workspace.setPanelOpen#dock-strip-motion';

for (const language of ['en', 'pt-BR'] as const) {
  test(`the Reduced motion field's default and choices fit it (${language})`, runs(OPEN, ROW, TAB, ADD, FIELD, LANGUAGE, DOCK), async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    const chooser = page.waitForEvent('filechooser');
    await runDoor(page, OPEN);
    await (await chooser).setFiles({ name: 'motion.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/motion.json') });
    if (language === 'pt-BR') {
      await openMenu(page, 'language');
      await page.locator(`[data-door="${LANGUAGE}"]`).first().click();
    }
    await control(page, ROW, { args: { target: 'n-hero' } }).click();
    await runDoor(page, TAB);
    await runDoor(page, ADD);
    const input = control(page, FIELD).locator('input').first();
    await expect(input).toBeVisible();
    const whole = () => input.evaluate((el) => el.scrollWidth - el.clientWidth);
    await expect.poll(whole, { message: 'whole when made' }).toBeLessThanOrEqual(0);
    // the inspector judged again: the Motion dock opened below it
    await runDoor(page, DOCK);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(whole, { message: 'whole with the Motion dock open' }).toBeLessThanOrEqual(0);
  });
}

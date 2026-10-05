// Ctrl+Z in a field with nothing of its own to undo undoes the document, never another field's typing: Chrome keeps one
// editing history per page, and with the focus in the Timeline's empty New animation field Ctrl+Z rewrote Font size and
// moved the focus there, its redos retyping "48px2828" (the audit of 2026-10-05).
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const SIZE = 'style.set#inspector-font-size';
const NEW_ANIMATION = 'animation.create#timeline-new-animation';
const titleSize = (page: Page) => page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { pages: { tree: { children: { children: { styles: { desktop?: { base?: Record<string, string> } } }[] }[] } }[] } } }).__builderTestPort.document().pages[0]?.tree.children[0]?.children[0]?.styles.desktop?.base?.['font-size'] ?? null);

test('Ctrl+Z and Ctrl+Shift+Z in the Timeline\'s empty field undo and redo the document, the focus kept', runs(OPEN, ROW, SIZE), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  const size = control(page, SIZE).locator('input').first();
  for (const value of ['48', '56']) {
    await size.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
  }
  await expect.poll(() => titleSize(page)).toBe('56px');
  await page.locator('[data-door$="#dock-strip-timeline"]:visible').first().click();
  // New animation: its press opens the field its name is typed in, the focus in it
  await page.locator(`[data-door="${NEW_ANIMATION}"]`).first().click();
  const name = page.locator('input.panel-field__text:focus');
  await expect(name).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => titleSize(page), 'the document is undone').toBe('48px');
  await expect(name, 'the focus stays in the field').toBeFocused();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => titleSize(page), 'and redone').toBe('56px');
  await expect(name).toBeFocused();
  await expect(size, 'Font size holds no retyped draft').toHaveValue('56px');
});

// A text area shows several lines (the audit of 2026-10-04's real-use pass: the Data panel's page names, "one name per
// line", and the assistant's request showed one line and a half, the first line cut at the top, because the field
// class's one-line height overrode the area's rows). Each shows at least three lines, and two typed lines stand whole
// in it with nothing scrolled away.
import { expect, test, type Locator, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const DATA = 'workspace.setPanelOpen#toolbar-activity-bar-data';
const ASSISTANT = 'workspace.setPanelOpen#toolbar-activity-bar-assistant';

const lines = (area: Locator) =>
  area.evaluate((el: HTMLTextAreaElement) => {
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight);
    const inner = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return { shown: Math.floor(inner / line + 0.01), scrolled: el.scrollHeight > el.clientHeight + 1 };
  });

async function check(page: Page, area: Locator): Promise<void> {
  await expect(area).toBeVisible();
  expect((await lines(area)).shown).toBeGreaterThanOrEqual(3);
  await area.click();
  await page.keyboard.type('Unidade Centro');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Unidade Norte');
  expect(await lines(area)).toMatchObject({ scrolled: false });
}

test('the Data panel’s page names and the assistant’s request each show several lines', runs(DATA, ASSISTANT), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await runDoor(page, DATA);
  await check(page, page.locator('[data-region="data-pages"] textarea[name="names"]'));
  await runDoor(page, ASSISTANT);
  await check(page, page.locator('textarea[data-key-context="assistant-input"]'));
});

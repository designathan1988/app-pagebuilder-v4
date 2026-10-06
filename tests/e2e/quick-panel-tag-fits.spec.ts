// The quick panel's head shows the element's tag whole: the tag field holds the longest tag a person types,
// "blockquote", as its own rule says (canvas-editing.css), where its box was 74 px for 86 px of text and the tag read
// "blockquo" with no ellipsis (the audit of 2026-10-05, AU6-07).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openQuickPanel, runDoor, runs } from './door.ts';

const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';

for (const entry of ['blockquote', 'preformatted', 'definition-list', 'embedded-frame']) {
  test(`the quick panel's tag reads whole for a ${entry}`, runs(INSERT_PANEL, TILE), async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    await runDoor(page, INSERT_PANEL);
    await control(page, TILE, { args: { entry } }).first().click();
    await openQuickPanel(page);
    const tag = page.locator('.quick-panel:not(.is-measuring) .quick-panel__tag input').first();
    await expect(tag).toBeVisible();
    expect(await tag.evaluate((el) => el.scrollWidth - el.clientWidth), `the tag ${await tag.inputValue()}`).toBeLessThanOrEqual(0);
  });
}

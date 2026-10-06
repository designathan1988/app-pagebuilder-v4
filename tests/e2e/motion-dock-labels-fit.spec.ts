// Every field name of the Motion dock's action fits one line in both languages (DEC-68: a name that would take two
// lines is said shorter in that place; the audit of 2026-10-05, AU6-11: "Adicionar junto da última" and "Animar uma
// propriedade" took two lines in the 116 px column at every width).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs } from './door.ts';

const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const TAB = 'workspace.setActiveTab#inspector-tab-interactions';
const ADD = 'motion.add#inspector-motion-add';
const DOCK = 'workspace.setPanelOpen#dock-strip-motion';
const BAR = 'motion.select#timeline-motion-bar';
const PT = 'preferences.setLanguage#menu-language-pt-br';

for (const language of ['en', 'pt-BR'] as const) {
  test(`the Motion dock's field names take one line (${language})`, runs(INSERT_PANEL, TILE, TAB, ADD, DOCK, BAR, PT), async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    if (language === 'pt-BR') {
      await openMenu(page, 'language');
      await page.locator(`[data-door="${PT}"]`).first().click();
    }
    await runDoor(page, INSERT_PANEL);
    await control(page, TILE, { args: { entry: 'container' } }).first().click();
    await runDoor(page, TAB);
    await runDoor(page, ADD);
    await runDoor(page, DOCK);
    await control(page, BAR).first().click();
    const names = page.locator('[data-region="dock-motion"] label.field-row__label');
    await expect(names.first()).toBeVisible();
    const twoLines = await names.evaluateAll((els) =>
      els
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size > 1;
        })
        .map((el) => el.textContent?.trim() ?? ''),
    );
    expect(twoLines).toEqual([]);
  });
}

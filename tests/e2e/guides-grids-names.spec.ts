// No control of Guides & Grids repeats the name of the section that holds it, and the fold lines are shown or hidden
// where the rulers and the manual guides are (the user's review of 2026-10-05, LR2: under "Column grid" a button read
// "Column grid", under "Row grid" "Row grid", under "Dot grid" "Dot grid", and the dot grid's section ended with "Show
// or hide the fold lines"; the case 8 rule of the Style tab: no row named like the row that holds it).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const GUIDES = 'workspace.openDialog#menu-view-guides-grids';
const PT = 'preferences.setLanguage#menu-language-pt-br';
const FOLDS = 'grid.toggleFolds#guides-grids-fold-lines';
const RULERS = 'view.toggleRulers#guides-grids-rulers';

test('no control of Guides & Grids repeats its section\'s name, and the fold lines stand with the rulers', runs(GUIDES, PT), async ({ page }) => {
  await openEditor(page);
  for (const language of ['en', 'pt-BR']) {
    if (language === 'pt-BR') await runDoor(page, PT);
    await runDoor(page, GUIDES);
    const dialog = page.locator('[data-region="guides-grids-dialog"]');
    await expect(dialog).toBeVisible();
    const repeated = await dialog.evaluate((root) => [...root.querySelectorAll('.guides-grids__section')].flatMap((section) => {
      const title = section.querySelector('.guides-grids__title')?.textContent?.trim().toLowerCase() ?? '';
      return [...section.querySelectorAll('.door__label')].map((label) => label.textContent?.trim() ?? '').filter((text) => text.toLowerCase() === title);
    }));
    expect(repeated, `controls named like their section (${language})`).toEqual([]);
    // the fold lines' toggle in the section of the rulers, its face a name as theirs is
    const section = (ref: string) => dialog.locator(`[data-door="${ref}"]`).evaluate((el) => el.closest('.guides-grids__section')?.querySelector('.guides-grids__title')?.textContent ?? '');
    expect(await section(FOLDS)).toBe(await section(RULERS));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});

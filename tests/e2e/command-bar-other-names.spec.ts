// The command bar's insert entries answer to what the Insert panel's search answers to (the audit of 2026-10-05,
// AU6-12): in Portuguese "+header" found nothing where the Insert panel found Cabeçalho; a page built from the keyboard
// had to know the translated names. The entry's own label still comes first (command-bar.ts ALSO_RANK).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runDoor, runs } from './door.ts';

const CTRL_K = 'commandBar.open#key-ctrl-k-in-global';
const LANGUAGE = 'preferences.setLanguage#menu-language-pt-br';

test('in Portuguese the bar finds an element by its English name and its tag, and inserts it', runs(CTRL_K, LANGUAGE), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await openMenu(page, 'language');
  await page.locator(`[data-door="${LANGUAGE}"]`).first().click();
  const options = page.locator('[data-region="command-palette"] [role="option"]');
  for (const [typed, offered] of [['+header', 'Inserir Cabeçalho'], ['+footer', 'Inserir Rodapé'], ['+h1', 'Inserir Título']] as const) {
    await runDoor(page, CTRL_K);
    await page.keyboard.type(typed);
    await expect(options.first(), typed).toHaveText(new RegExp(`^${offered}`));
    await page.keyboard.press('Escape');
  }
  await runDoor(page, CTRL_K);
  await page.keyboard.type('+header');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __builderTestPort: { document: () => { pages: { tree: { children: { type: string }[] } }[] } } }).__builderTestPort.document().pages[0]?.tree.children.map((c) => c.type))).toContain('header');
});

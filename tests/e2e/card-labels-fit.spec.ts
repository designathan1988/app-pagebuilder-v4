// A card's field names fit one line in both languages (the user's review of 2026-10-05, LR2: in the dialogs, the
// Timeline's settings and the Interactions tab's cards the names stood in a 72 px column, and "Pages of the site",
// "Snap distance (px)", "Animation direction", "Distância de encaixe (px)", "Espaçamento dos pontos" took two lines).
// The cards' label column is the inspector's (DEC-66), and a name that would still take two lines is said shorter, as
// the inspector's are (spec inspector-panel, Problem 14).
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const PT = 'preferences.setLanguage#menu-language-pt-br';
const GUIDES = 'workspace.openDialog#menu-view-guides-grids';
const CAPTURE = 'workspace.openDialog#menu-file-capture-url';
const SNAP = 'workspace.openDialog#menu-snap-snap-settings';
const TIMELINE = 'workspace.setPanelOpen#dock-strip-timeline';
const INTERACTIONS = 'workspace.setActiveTab#inspector-tab-interactions';

// the names drawn in a card's label column that take more than one line, with their text
const wrapped = (page: Page, selector: string) =>
  page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel)].filter((label) => label.getClientRects().length > 0).flatMap((label) => {
    const range = document.createRange();
    range.selectNodeContents(label);
    const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    return lines > 1 ? [`${label.textContent?.trim() ?? ''} (${lines} lines)`] : [];
  }), selector);

async function dialogNames(page: Page, menu: string, ref: string): Promise<string[]> {
  await openMenu(page, menu);
  await control(page, ref).click();
  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog).toBeVisible();
  const found = await wrapped(page, '[role="dialog"] .guides-grids__label');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return found;
}

test('every name in a card\'s label column fits one line, in English and in Portuguese', runs(OPEN, ROW, PT, GUIDES, CAPTURE, SNAP, TIMELINE, INTERACTIONS), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  await expect(control(page, ROW, { args: { target: 'c-subscribe' } })).toHaveCount(1);
  for (const language of ['en', 'pt-BR']) {
    if (language === 'pt-BR') await runDoor(page, PT);
    const found = [
      ...(await dialogNames(page, 'view', GUIDES)),
      ...(await dialogNames(page, 'file', CAPTURE)),
      ...(await dialogNames(page, 'snap', SNAP)),
    ];
    // the button that holds an animation and two interactions: its Timeline settings and its interaction cards
    await control(page, ROW, { args: { target: 'c-subscribe' } }).click();
    // the Timeline, opened once (the dock then holds it as a tab)
    if ((await page.locator('[data-region="dock-timeline"]').count()) === 0) await runDoor(page, TIMELINE);
    await expect(page.locator('.timeline__settings')).toBeVisible();
    found.push(...(await wrapped(page, '.timeline__side .field-row__label')));
    await runDoor(page, INTERACTIONS);
    await expect(page.locator('.interaction-card').first()).toBeVisible();
    found.push(...(await wrapped(page, '.interaction-card .field-row__label')));
    expect(found, `names in two lines (${language})`).toEqual([]);
  }
});

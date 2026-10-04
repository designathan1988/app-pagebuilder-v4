// The editor opens in the browser's language when the person chose none (jornada03 J26): a Portuguese Chrome shows a
// Portuguese editor and a Portuguese empty project, and the person's choice wins after a reload.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runs } from './door.ts';

test.use({ locale: 'pt-BR' });

test('a Portuguese browser opens a Portuguese editor, and a chosen language stays chosen', runs('preferences.setLanguage#menu-language-en'), async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.locator('[data-menu="file"]')).toHaveText('Arquivo');
  await openMenu(page, 'view');
  await page.getByRole('menuitem', { name: 'Idioma', exact: true }).hover();
  await page.locator('[data-door="preferences.setLanguage#menu-language-en"]').click();
  await expect(page.locator('[data-menu="file"]')).toHaveText('File');
  await page.reload();
  await expect(page.locator('[data-menu="file"]')).toHaveText('File');
});

// The audit's AUD-21 (jornada03 J26, the rest of it): a fresh editor opened on the Explorer, and called its insert panel
// "Elements" in the View menu and its doors. A fresh profile opens on Insert, named Insert everywhere.
test('a fresh editor opens on the Insert panel, which the View menu names Insert', runs('workspace.setPanelOpen#menu-view-elements'), async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.sidebar__view[data-panel-area="elements"]'), 'the first panel is Insert').toBeVisible();
  await expect(page.locator('.sidebar__view[data-panel-area="explorer"]')).toHaveCount(0);
  await expect(page.locator('[data-door="workspace.setPanelOpen#toolbar-activity-bar-insert"]')).toHaveAttribute('aria-pressed', 'true');
  await openMenu(page, 'view');
  await expect(page.locator('[data-door="workspace.setPanelOpen#menu-view-elements"]')).toContainText('Inserir');
});

test('the Export ZIP label fits the top bar in both languages at 1280 pixels', runs('preferences.setLanguage#menu-language-en'), async ({ page }) => {
  fs.mkdirSync('.cache/logs/j28-copy', { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await openEditor(page);
  const exportButton = page.locator('[data-door="project.export#toolbar-top-bar-export"]');
  const fits = () => exportButton.evaluate((button) => {
    const label = button.querySelector('.door__label');
    if (label === null) return false;
    const outer = button.getBoundingClientRect();
    const inner = label.getBoundingClientRect();
    return inner.left >= outer.left && inner.right <= outer.right && label.scrollWidth <= label.clientWidth;
  });
  await expect(exportButton).toContainText('Exportar ZIP');
  expect(await fits()).toBe(true);
  await page.screenshot({ path: '.cache/logs/j28-copy/export-pt-BR.png' });
  await openMenu(page, 'view');
  await page.getByRole('menuitem', { name: 'Idioma', exact: true }).hover();
  await page.locator('[data-door="preferences.setLanguage#menu-language-en"]').click();
  await expect(exportButton).toContainText('Export ZIP');
  expect(await fits()).toBe(true);
  await page.screenshot({ path: '.cache/logs/j28-copy/export-en.png' });
});

test('one matching layer is reported in the singular in both languages', runs('layers.search#layers-search-field', 'preferences.setLanguage#menu-language-en'), async ({ page }) => {
  fs.mkdirSync('.cache/logs/j28-plural', { recursive: true });
  await openEditor(page);
  await page.locator('.layers__search input').fill('Pá');
  await expect(page.getByRole('status')).toHaveText('1 camada corresponde a "Pá".');
  await page.screenshot({ path: '.cache/logs/j28-plural/one-layer-pt-BR.png' });
  await openMenu(page, 'view');
  await page.getByRole('menuitem', { name: 'Idioma', exact: true }).hover();
  await page.locator('[data-door="preferences.setLanguage#menu-language-en"]').click();
  await page.locator('.layers__search input').fill('');
  await page.locator('.layers__search input').fill('Pá');
  await expect(page.getByRole('status')).toHaveText('1 layer matches "Pá".');
  await expect(page.locator('[data-door="project.export#toolbar-top-bar-export"]')).toContainText('Export ZIP');
  await page.screenshot({ path: '.cache/logs/j28-plural/one-layer-en.png' });
});

// The audit's AUD-24: a write IndexedDB cannot take said "Não salvo: IndexedDB is not available", the editor's own
// reason in English inside the translated sentence. Without IndexedDB, the reason is the editor's, in Portuguese.
test('without the browser storage, the save state says why in the editor language', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
  await openEditor(page);
  await page.locator('[data-door="element.insert#elements-tile"]').first().click();
  await expect(page.locator('.status-bar__save')).toHaveText('Não salvo: o navegador não guarda dados desta página (o IndexedDB não está disponível)');
});

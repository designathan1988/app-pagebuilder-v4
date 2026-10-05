// The editor opens in the browser's language when the person chose none (jornada03 J26): a Portuguese Chrome shows a
// Portuguese editor and a Portuguese empty project, and the person's choice wins after a reload.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openEverySection, openMenu, runs } from './door.ts';

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

// The user's choice of 2026-10-05 (DEC-65): a CSS value is shown as CSS writes it in every language — what a
// professional types and reads in the code (Firefox's DevTools: "CSS properties and values … should not be
// translated"); only the names of the fields are translated. In Portuguese the panel read "automático" beside
// "border-box" and "L auto" beside "A automático". A word of the person's language typed in a field still reads as
// its keyword (the plan's smart input).
test('a Portuguese editor shows CSS values as CSS writes them, and reads a Portuguese word typed as its keyword', runs('project.open#menu-file', 'selection.select#layers-row', 'style.set#inspector-width'), async ({ page }) => {
  await openEditor(page);
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await control(page, 'selection.select#layers-row', { args: { target: 'n-title' } }).click();
  await openEverySection(page);
  const width = control(page, 'style.set#inspector-width');
  await expect(width.locator('.field__rest-value')).toHaveText('auto');
  // a value the element does not hold: the page's own, shown in the field as its placeholder
  await expect(control(page, 'style.set#inspector-overflow').locator('input')).toHaveAttribute('placeholder', 'visible');
  // typed in Portuguese, kept as the CSS keyword, and shown as CSS writes it
  await width.locator('input').fill('240px');
  await width.locator('input').press('Enter');
  await width.locator('input').fill('automático');
  await width.locator('input').press('Enter');
  const stored = () => page.evaluate(() => {
    type Node = { id: string; styles?: { desktop?: { base?: Record<string, string> } }; children: Node[] };
    const tree = (window as unknown as { __builderTestPort: { document: () => { pages: { tree: Node }[] } } }).__builderTestPort.document().pages[0]?.tree;
    const find = (n: Node): Node | undefined => (n.id === 'n-title' ? n : n.children.map(find).find((x) => x !== undefined));
    return tree === undefined ? null : (find(tree)?.styles?.desktop?.base?.width ?? null);
  });
  await expect.poll(stored).toBe('auto');
  await expect(width.locator('input')).toHaveValue('auto');
});

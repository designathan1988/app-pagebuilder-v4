import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openQuickPanel, runDoor, runs, setSectionOpen } from './door.ts';

const project = (page: Page) => page.evaluate(() => (window as unknown as { __builderTestPort: { document(): unknown } }).__builderTestPort.document());
test.beforeEach(async ({ page }) => {
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, 'project.open#menu-file');
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await control(page, 'selection.select#layers-row', { args: { target: 'n-intro' } }).click();
});

for (const item of [
  { name: 'number', door: 'style.set#inspector-font-size', value: '32px', tab: 'style' },
  { name: 'style text', door: 'style.set#inspector-font-family', value: 'Georgia', tab: 'style' },
  { name: 'element text', door: 'text.set#inspector-text', value: 'An unfinished introduction', tab: 'settings' },
  { name: 'attribute', door: 'element.setId#inspector-id', value: 'intro-copy', tab: 'settings' },
  { name: 'quick panel', door: 'style.set#quick-panel-width', value: '420px', tab: 'quick' },
]) {
  test(`${item.name} draft warns before reload and returns uncommitted with its caret`, runs(item.door), async ({ page }) => {
    if (item.tab === 'quick') await openQuickPanel(page);
    else {
      await runDoor(page, `workspace.setActiveTab#inspector-tab-${item.tab}`);
      if (item.tab === 'style') await setSectionOpen(page, 'text', true);
    }
    const field = control(page, item.door).locator('input, textarea').first();
    const before = await project(page);
    const original = await field.inputValue();
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(item.value);
    await page.keyboard.press('ArrowLeft');
    const caret = await field.evaluate(el => (el as HTMLInputElement).selectionStart);
    let warned = false;
    page.once('dialog', async dialog => { warned = dialog.type() === 'beforeunload'; await dialog.accept(); });
    await page.reload();
    await expect(field).toHaveValue(item.value);
    await expect(field).toBeFocused();
    expect(warned).toBe(true);
    expect(await field.evaluate(el => (el as HTMLInputElement).selectionStart)).toBe(caret);
    expect(await project(page)).toEqual(before);
    await page.keyboard.press('Control+z');
    await expect(field).toHaveValue(original);
    expect(await project(page)).toEqual(before);
    await page.keyboard.press('Control+y');
    await expect(field).toHaveValue(item.value);
    await page.keyboard.press('Enter');
    await expect.poll(() => project(page)).not.toEqual(before);
    await page.keyboard.press('Control+z');
    await expect.poll(() => project(page)).toEqual(before);
    page.once('dialog', d => d.accept());
    await page.reload();
    if (item.tab === 'quick') {
      await expect(field).toHaveCount(0);
      await openQuickPanel(page);
    }
    await expect(field).not.toHaveValue(item.value);
  });
}

test('canvas text returns after reload with editing open and remains a single undoable confirmation', runs('text.startEdit#key-enter-in-canvas'), async ({ page }) => {
  const before = await project(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  const text = page.frameLocator('.frame__page').locator('[data-node="n-intro"]');
  await expect(text).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.keyboard.press('End');
  await page.keyboard.type(' Especial');
  const draft = await text.innerText();
  page.once('dialog', d => d.accept());
  await page.reload();
  await expect(text).toHaveAttribute('contenteditable', 'plaintext-only');
  await expect(text).toHaveText(draft);
  await expect(text).toBeFocused();
  expect(await project(page)).toEqual(before);
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await expect(text).toHaveText(`${draft}!`);
  await page.keyboard.press('Control+z');
  await expect.poll(() => project(page)).toEqual(before);
});

test('a canvas draft restores when its last selection save has not reached idle', runs('text.startEdit#key-enter-in-canvas'), async ({ page }) => {
  const photos = '.cache/logs/fk1';
  fs.mkdirSync(photos, { recursive: true });
  await control(page, 'selection.select#layers-row', { args: { target: 'n-page' } }).click();
  await expect(page.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved');
  // A busy browser can leave the selection-only autosave queued until the page is reloaded.
  await page.evaluate(() => {
    window.requestIdleCallback = () => 1;
    window.cancelIdleCallback = () => {};
  });
  await control(page, 'selection.select#layers-row', { args: { target: 'n-intro' } }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  const text = page.frameLocator('.frame__page').locator('[data-node="n-intro"]');
  await page.keyboard.press('End');
  await page.keyboard.type(' Especial');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('editing-draft'))).not.toBeNull();
  expect(await page.evaluate(() => {
    const draft = JSON.parse(sessionStorage.getItem('editing-draft') ?? 'null') as { revision: number; selection: string[] } | null;
    const journal = JSON.parse(localStorage.getItem('work-journal') ?? 'null') as { revision: number; selection: string[] } | null;
    return draft !== null && journal !== null && draft.revision === journal.revision && JSON.stringify(draft.selection) === JSON.stringify(journal.selection);
  })).toBe(true);
  const draft = await text.innerText();
  await page.screenshot({ path: `${photos}/before-reload.png` });
  page.once('dialog', d => d.accept());
  await page.reload();
  await expect(text).toHaveText(draft);
  await expect(text).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.screenshot({ path: `${photos}/after-reload.png` });
});

test('programmatic marks, line breaks and a moved caret survive reload before confirmation', runs('text.startEdit#key-enter-in-canvas'), async ({ page }) => {
  const before = await project(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  const text = page.frameLocator('.frame__page').locator('[data-node="n-intro"]');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Especial');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  const html = await text.innerHTML();
  page.once('dialog', d => d.accept());
  await page.reload();
  await expect.poll(() => text.innerHTML()).toBe(html);
  expect(await project(page)).toEqual(before);
  await page.keyboard.type('X');
  await expect(text).toHaveText(/^FXresh coffee/);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+z');
  await expect.poll(() => project(page)).toEqual(before);
});

test('a confirmed draft never returns in a replacement project with the same node IDs', runs('element.setId#inspector-id', 'project.open#menu-file'), async ({ page }) => {
  await runDoor(page, 'workspace.setActiveTab#inspector-tab-settings');
  const field = control(page, 'element.setId#inspector-id').locator('input');
  await field.fill('old-project-draft');
  await page.keyboard.press('Enter');
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, 'project.open#menu-file');
  await (await chooser).setFiles('manifest/features/fixtures/aurora.json');
  await page.locator('[data-confirmation="confirm"]').click();
  await control(page, 'selection.select#layers-row', { args: { target: 'n-intro' } }).click();
  await page.reload();
  await runDoor(page, 'workspace.setActiveTab#inspector-tab-settings');
  await expect(field).not.toHaveValue('old-project-draft');
  expect(await page.evaluate(() => sessionStorage.getItem('editing-draft'))).toBeNull();
});

test('an opener-created read-only tab discards its copied draft without changing the original project', runs('element.setId#inspector-id'), async ({ page }) => {
  await runDoor(page, 'workspace.setActiveTab#inspector-tab-settings');
  const field = control(page, 'element.setId#inspector-id').locator('input');
  await field.fill('only-this-tab');
  const before = await project(page);
  const popup = page.waitForEvent('popup');
  await page.evaluate(() => { window.open(location.href); });
  const second = await popup;
  await expect(second.locator('[data-region="tab-guard"]')).toHaveText(/being edited in another tab/);
  await expect(control(second, 'element.setId#inspector-id').locator('input')).not.toHaveValue('only-this-tab');
  expect(await second.evaluate(() => sessionStorage.getItem('editing-draft'))).toBeNull();
  expect(await project(second)).toEqual(before);
  await second.close();
});

test('a class draft returns at its hover state and tablet breakpoint', runs('classes.create#inspector-class-save-as', 'style.set#inspector-font-size'), async ({ page }) => {
  await runDoor(page, 'classes.create#inspector-class-save-as');
  await page.keyboard.type('intro-style');
  await page.keyboard.press('Enter');
  await control(page, 'inspector.setStyleTarget#inspector-class-bar-target', { args: { target: 'class', className: 'intro-style' } }).click();
  await runDoor(page, 'view.setStyleState#menu-style-state-hover');
  await runDoor(page, 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet');
  await setSectionOpen(page, 'text', true);
  const field = control(page, 'style.set#inspector-font-size').locator('input').first();
  const before = await project(page);
  await field.fill('34px');
  page.once('dialog', d => d.accept());
  await page.reload();
  await expect(field).toHaveValue('34px');
  await expect(field).toBeFocused();
  expect(await project(page)).toEqual(before);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await project(page) as { classes: { name: string; styles: { tablet?: { hover?: Record<string, string> } } }[] }).classes.find(c => c.name === 'intro-style')?.styles.tablet?.hover?.['font-size']).toBe('34px');
});

test('a revealed nonessential field returns with its draft in Essentials mode', runs('inspector.reveal#inspector-add-property-item', 'style.setShadows#inspector-text-shadow-shadow-css'), async ({ page }) => {
  await runDoor(page, 'inspector.setMode#inspector-mode-essentials');
  await page.locator('.add-property > [data-door="inspector.reveal#inspector-add-property-item"]').click();
  await page.keyboard.type('text-shadow');
  await page.keyboard.press('Enter');
  const field = control(page, 'style.setShadows#inspector-text-shadow-shadow-css').locator('input').first();
  await expect(field).toBeFocused();
  await page.keyboard.type('1px 2px 3px black');
  const before = await project(page);
  page.once('dialog', d => d.accept());
  await page.reload();
  await expect(field).toHaveValue('1px 2px 3px black');
  await expect(field).toBeFocused();
  expect(await project(page)).toEqual(before);
});

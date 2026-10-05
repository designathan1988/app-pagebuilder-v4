import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openEverySection, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const SECTION = 'inspector.toggleSection#inspector-section-header';
// the pair row of the Size section (properties.json rows): Size, its W and its H
const WIDTH = 'style.set#inspector-width';
const HEIGHT = 'style.set#inspector-height';
const STEP = 'field.step#key-arrow-up-in-number-field';
const RESET = 'style.reset#inspector-property-reset';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  await openEverySection(page);
});

test('paired resting values remain readable and editing keeps full units, stepping and reset', runs(OPEN, ROW, SECTION, WIDTH, HEIGHT, STEP, RESET), async ({ page }) => {
  // (the pair was Font size and Letter spacing until the user's review of 2026-10-05 gave each its own line)
  const font = control(page, WIDTH);
  const spacing = control(page, HEIGHT);
  await font.locator('input').fill('240px');
  await font.locator('input').press('Enter');
  await spacing.locator('input').fill('120px');
  await spacing.locator('input').press('Enter');
  await page.locator('.selector-bar__name').click();
  await page.mouse.move(600, 40);
  await expect(font.locator('.field__rest-value')).toHaveText('240');
  await expect(spacing.locator('.field__rest-value')).toHaveText('120');
  await expect(font.locator('input')).toHaveValue('240px');
  await expect(spacing.locator('input')).toHaveValue('120px');
  for (const field of [font, spacing]) {
    const readable = await field.locator('.field__rest-value').evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    expect(readable, 'the complete resting number fits its cell').toBe(true);
  }
  const before = await font.locator('.input-wrap').boundingBox();
  await font.locator('input').click();
  await expect(font.locator('.field__rest-value')).toBeHidden();
  const after = await font.locator('.input-wrap').boundingBox();
  expect(after?.width).toBe(before?.width);
  await font.locator('input').press('ArrowUp');
  await expect(font.locator('input')).toHaveValue('241px');
  await expect.poll(() => page.frameLocator('.frame__page').locator('[data-node="n-title"]').evaluate(el => Math.round(parseFloat(getComputedStyle(el).width)))).toBe(241);
  await font.locator('input').click();
  // a pair field's Reset stands at the end of the row's label column, beside its cell, never inside the value cell
  // (jornada02 A.0, J6: inside, it squeezed the number while the field held the focus)
  await font.locator('xpath=following-sibling::*[contains(@class, "field__end")][1]').locator(`[data-door="${RESET}"]`).click();
  await expect(font.locator('input')).toHaveValue('');
});

test('Style context and search stay fixed while the property sections scroll', runs(OPEN, ROW, SECTION), async ({ page }) => {
  const controls = page.locator('.inspector-controls');
  const before = await controls.boundingBox();
  const scroller = page.locator('.inspector-scroll');
  await scroller.hover();
  await page.mouse.wheel(0, 1800);
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const after = await controls.boundingBox();
  expect(after?.y).toBe(before?.y);
  await expect(page.getByRole('searchbox', { name: 'Find a property…' })).toBeVisible();
  await expect(page.locator('.selector-bar__name')).toHaveText('Title');
});

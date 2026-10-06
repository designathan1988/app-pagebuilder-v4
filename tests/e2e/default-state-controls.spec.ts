// No control looks usable without acting (the user's real-use audit, item 1.4; specs
// quick-panel, Problems in Pager 8, and inspector-provenance-reset, Problems in Pager 5): a field draws its Reset only
// while the element holds a value of its own, in the Style tab and the quick panel; the quick panel's bar leaves out
// align and distribute while they cannot act, keeping the actions that can (More actions, Edit on canvas); a control
// that cannot act (the view segments and the Interactions tab, whose features are to come) is drawn clearly disabled.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openQuickPanel, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const COLOR = 'style.set#inspector-color';
const RESET = 'style.reset#inspector-property-reset';
const MORE = 'contextMenu.open#quick-panel-more-actions';
const EDIT_ON_CANVAS = 'canvas.setEditMode#quick-panel-edit-on-canvas';

// the Resets drawn, by the property each stands for, in the Style tab and in the quick panel
const resets = (page: Page, region: string) => page.locator(`[data-region^="${region}"] [data-door="${RESET}"]`).evaluateAll((els) => els.map((el) => JSON.parse(el.getAttribute('data-args') ?? '{}').property as string));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-a-title"]')).toHaveCount(1);
  await control(page, ROW, { args: { target: 'n-title' } }).click();
});

test('a field draws its Reset only while the element holds a value of its own', runs(OPEN, ROW, COLOR, RESET), async ({ page }) => {
  await openQuickPanel(page);
  expect(await resets(page, 'inspector-')).toEqual([]);
  expect(await resets(page, 'quick-panel')).toEqual([]);
  await control(page, COLOR).locator('input').first().click();
  await page.keyboard.type('#ff0000');
  await page.keyboard.press('Enter');
  await expect.poll(() => resets(page, 'inspector-')).toEqual(['color']);
  await expect.poll(async () => (await resets(page, 'quick-panel')).filter((p) => p === 'color')).toEqual(['color']);
});

test('the quick panel bar leaves out align and distribute while they cannot act, and keeps what can', runs(OPEN, ROW, MORE, EDIT_ON_CANVAS), async ({ page }) => {
  await openQuickPanel(page);
  const bar = await page.locator('[data-region="quick-panel"] .quick-panel__actions [data-door]').evaluateAll((els) => els.map((el) => el.getAttribute('data-door') ?? ''));
  expect(bar.filter((ref) => ref.startsWith('position.align#') || ref.startsWith('position.distribute#'))).toEqual([]);
  expect(bar).toContain(MORE);
  expect(bar).toContain(EDIT_ON_CANVAS);
});

test('a control that cannot act is drawn clearly disabled', async ({ page }) => {
  // The controls that cannot act with the fixture open and one element selected: Undo and Redo, with an empty history
  // (the page root's Hide and Lock are enabled now — the root takes them, which is what its own feature asked for).
  // The three this test named before — the Split and Code views and the Interactions tab — are built too, and drawn
  // enabled. Disabled is the subtle ink on the control's own container, never faded (docs/PRODUCT.md, The interface
  // contract; jornada02 G-13): its words stay legible, and the pointer finds no hover plate on it.
  const subtle = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = 'var(--color-text-subtle)';
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  for (const ref of ['history.undo#toolbar-top-bar', 'history.redo#toolbar-top-bar']) {
    const drawn = page.locator(`[data-door="${ref}"]`).first();
    await expect(drawn, ref).toHaveAttribute('aria-disabled', 'true');
    const rest = await drawn.evaluate((el) => ({ colour: getComputedStyle(el).color, opacity: getComputedStyle(el).opacity, background: getComputedStyle(el).backgroundColor }));
    expect(rest.colour, `${ref}: the subtle ink`).toBe(subtle);
    expect(rest.opacity, `${ref}: never faded`).toBe('1');
    await drawn.hover();
    expect(await drawn.evaluate((el) => getComputedStyle(el).backgroundColor), `${ref}: no hover plate`).toBe(rest.background);
  }
});

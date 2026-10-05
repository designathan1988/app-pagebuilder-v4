// A menu stays inside the window, every item of it reachable (the user's review of 2026-10-05, LR2: in a 1280 × 720
// window, a size the product supports (P3), the View menu's thirty items ran past the window's bottom, its last ones
// beyond reach). A menu taller than the room under its button is held to that room and scrolls, as VS Code's menus are;
// a submenu opens beside its item, whole and inside the window, the scroll of its menu cutting nothing of it (CSS 2.2
// §11.1.1: a box's overflow clips no descendant whose containing block is the viewport).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runs } from './door.ts';

const RESET = 'workspace.reset#menu-view';
const DARK = 'preferences.setTheme#menu-theme-dark';

test('in a 1280 × 720 window the View menu fits the window, its last item and its submenus within reach', runs(RESET, DARK), async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openEditor(page);
  await page.locator('.menu-button[data-menu="view"]').click();
  const menu = page.locator('[data-region="menu:view"]');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0), 'the menu ends inside the window').toBeLessThanOrEqual(720);
  // it scrolls, its items as tall as ever (the chip's height), none squeezed to fit
  const heights = await menu.evaluate((element) => {
    const chip = parseFloat(getComputedStyle(element).getPropertyValue('--size-chip'));
    return { chip, items: [...element.querySelectorAll<HTMLElement>(':scope > .menu__item, :scope > .menu__sub > .menu__item')].map((one) => one.getBoundingClientRect().height), scrolls: element.scrollHeight > element.clientHeight };
  });
  expect(heights.scrolls, 'the menu scrolls').toBe(true);
  expect(new Set(heights.items)).toEqual(new Set([heights.chip]));
  // its last item: reached by scrolling the menu, and then inside the window
  const reset = page.locator(`[data-door="${RESET}"]`);
  await reset.scrollIntoViewIfNeeded();
  const last = await reset.boundingBox();
  expect((last?.y ?? 0) + (last?.height ?? 0), 'the last item shows inside the window').toBeLessThanOrEqual(720);
  // a submenu of the scrolled menu: beside its item, whole, inside the window, and its items run
  const theme = menu.locator(':scope > .menu__sub').first().locator(':scope > [aria-haspopup="menu"]');
  await theme.scrollIntoViewIfNeeded();
  await theme.hover();
  const sub = page.locator('[data-region="menu:theme"]');
  await expect(sub).toBeVisible();
  const item = await theme.boundingBox();
  const opened = await sub.boundingBox();
  expect(opened).not.toBeNull();
  expect(opened?.x ?? 0, 'beside its item').toBeGreaterThanOrEqual((item?.x ?? 0) + (item?.width ?? 0) - 1);
  // its item spans the menu, as every item does, so the submenu opens at the menu's edge, over none of it
  const edge = await menu.evaluate((element) => element.getBoundingClientRect().right - parseFloat(getComputedStyle(element).paddingRight) - parseFloat(getComputedStyle(element).borderRightWidth));
  expect((item?.x ?? 0) + (item?.width ?? 0), 'the item spans the menu').toBeCloseTo(edge, 0);
  expect((opened?.y ?? 0) + (opened?.height ?? 0), 'inside the window').toBeLessThanOrEqual(720);
  // nothing of it cut: the item under its middle is its own
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest('[data-region="menu:theme"]') !== null, [(opened?.x ?? 0) + (opened?.width ?? 0) / 2, (opened?.y ?? 0) + (opened?.height ?? 0) / 2]);
  expect(hit, 'the submenu is drawn over everything at its middle').toBe(true);
  await page.locator(`[data-door="${DARK}"]`).click();
  await expect(page.locator('[data-region="menu:view"]')).toHaveCount(0);
});

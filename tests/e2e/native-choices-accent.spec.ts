// A native check box wears the interface's accent, not the browser's blue (the user's review of 2026-10-05, LR2: Snap
// settings' eight targets were checked in Chrome's own blue in an editor whose accent is teal). MDN accent-color: check
// boxes, radio buttons, ranges and progress bars take it.
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runs } from './door.ts';

const SNAP = 'workspace.openDialog#menu-snap-snap-settings';

test('Snap settings\' check boxes are in the interface\'s accent', runs(SNAP), async ({ page }) => {
  await openEditor(page);
  await openMenu(page, 'snap');
  await control(page, SNAP).click();
  const boxes = page.locator('[role="dialog"] input[type="checkbox"]');
  await expect(boxes.first()).toBeVisible();
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-accent)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  const worn = await boxes.evaluateAll((all) => all.map((box) => getComputedStyle(box).accentColor));
  expect(worn.length).toBeGreaterThan(0);
  expect(new Set(worn)).toEqual(new Set([accent]));
});

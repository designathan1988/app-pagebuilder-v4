// The capture dialog's words stand under what they explain, at the dialog's own spacing (the user's review of
// 2026-10-05, LR2: its three paragraphs kept the browser's own 1 em margins, so the pages' hint stood 40 px from its
// field and the notices floated apart in the dialog).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runs } from './door.ts';

const CAPTURE = 'workspace.openDialog#menu-file-capture-url';

test('the capture dialog\'s hints stand at the dialog\'s spacing, the pages\' hint under its field', runs(CAPTURE), async ({ page }) => {
  await openEditor(page);
  await openMenu(page, 'file');
  await control(page, CAPTURE).click();
  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog).toBeVisible();
  const found = await dialog.evaluate((root) => {
    const body = root.querySelector<HTMLElement>('.dialog__body');
    const gap = body === null ? 0 : parseFloat(getComputedStyle(body).rowGap) || 0;
    const items = [...(body?.children ?? [])].map((one) => one.getBoundingClientRect());
    // the space between each child and the next, beyond the body's own gap
    return { gap, extra: items.slice(1).map((box, i) => Math.round(box.top - (items[i]?.bottom ?? box.top) - gap)) };
  });
  expect(found.extra.every((one) => one <= 1), `spaces beyond the gap: ${found.extra.join(', ')}`).toBe(true);
});

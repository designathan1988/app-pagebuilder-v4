// Every sidebar view wears the one view title: its name at the same place, and the panel header's close (the user's
// review of 2026-10-05, LR2: the Layout view's title stood 17 px right of every other view's and had no close; the
// Assistant view had no title at all).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runs } from './door.ts';

const VIEWS = ['explorer', 'insert', 'styles', 'data', 'assistant'] as const;
const LAYOUT = 'workspace.setPanelOpen#toolbar-activity-bar-layout-composer';

test('every sidebar view draws its title at the same place, with the close of the panel header', runs(...VIEWS.map((view) => `workspace.setPanelOpen#toolbar-activity-bar-${view}`), LAYOUT), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const titles: Record<string, { readonly x: number; readonly close: boolean }> = {};
  const read = async (name: string) => {
    const title = page.locator('.sidebar [data-panel-header] .view__name').first();
    await expect(title).toBeVisible();
    const box = await title.boundingBox();
    const close = await page.locator('.sidebar [data-panel-header] [data-door^="workspace.setPanelOpen#panel-header"]').count();
    titles[name] = { x: Math.round(box?.x ?? -1), close: close > 0 };
  };
  for (const view of VIEWS) {
    const button = control(page, `workspace.setPanelOpen#toolbar-activity-bar-${view}`);
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
    await read(view);
  }
  await openMenu(page, 'view');
  await control(page, LAYOUT).click();
  await read('layout-composer');
  const x = titles.explorer?.x;
  for (const [name, title] of Object.entries(titles)) {
    expect(title.x, `${name}'s title stands where the Explorer's does`).toBe(x);
    expect(title.close, `${name}'s title has the panel header's close`).toBe(true);
  }
});

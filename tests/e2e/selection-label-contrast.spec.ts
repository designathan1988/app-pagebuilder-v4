// The selection's label reads whole: the class it writes to and the breakpoint in view (A3.8), drawn after the name
// and the tag, keep a contrast of at least 4.5:1 with the label's own colour in both themes (WCAG 1.4.3; the audit of
// 2026-10-05, AU6-16: ".plans__title" and "Tablet" in the text's subtle grey on the accent, about 1.5:1).
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const BAR = 'commandBar.open#toolbar-top-bar-search';
const TABLET = 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet';
const LIGHT = 'preferences.setTheme#menu-theme-light';

// the contrast of an element's text with the label's background, as WCAG computes it from relative luminance
const contrast = (page: Page, selector: string) =>
  page.evaluate((wanted) => {
    const part = document.querySelector(wanted);
    const label = part?.closest('.chrome__label');
    if (!part || !label) return 0;
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => { const s = (v ?? 0) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    };
    const a = lum(rgb(getComputedStyle(part).color));
    const b = lum(rgb(getComputedStyle(label).backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selector);

for (const theme of ['dark', 'light'] as const) {
  test(`the label's class and breakpoint keep 4.5:1 with the label (${theme})`, runs(OPEN, BAR, TABLET, LIGHT), async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    const chooser = page.waitForEvent('filechooser');
    await runDoor(page, OPEN);
    await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
    if (theme === 'light') {
      await openMenu(page, 'theme');
      await page.locator(`[data-door="${LIGHT}"]`).first().click();
    }
    await runDoor(page, TABLET);
    // the plans' title found by the command bar, which brings it into view (QA 423) with its label
    await runDoor(page, BAR);
    await page.keyboard.type('@Título Planos');
    await page.keyboard.press('Enter');
    // its class the style target (the selector bar's chip), so the label names it
    await page.locator('[data-door="inspector.setStyleTarget#inspector-class-bar-target"]').filter({ hasText: 'plans__title' }).first().click();
    for (const part of ['.chrome__label[data-chrome="label"] .chrome__target', '.chrome__label[data-chrome="label"] .chrome__breakpoint']) {
      await expect(page.locator(part)).toBeVisible();
      await expect.poll(() => contrast(page, part), { message: part }).toBeGreaterThanOrEqual(4.5);
    }
  });
}

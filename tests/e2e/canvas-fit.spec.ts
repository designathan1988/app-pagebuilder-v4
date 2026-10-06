// The canvas opens fitted (spec canvas-page-iframe): from the first frame the browser
// paints, the page frame already has the width that fits the stage; it never shows an unfitted frame (at zoom 1) that
// fits a frame later. A layout read right after the editor appears (history-doors.spec.ts, the region snapshots)
// depends on it:
// with the fit measured after the first paint, those reads raced the fit and failed under load.
import { expect, test } from '../support/test.ts';

test('the page frame has its fitted width from the first painted frame on', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // before any app code runs: record the frame's width in every animation frame (before each paint) from the first
  // frame the element exists in, for the first 30 frames
  await page.addInitScript(() => {
    const widths: number[] = [];
    (window as unknown as { __frameWidths: number[] }).__frameWidths = widths;
    const tick = () => {
      const frame = document.querySelector('.frame');
      if (frame) widths.push(Math.round(frame.getBoundingClientRect().width));
      if (widths.length < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto('/');
  await expect(page.locator('.workbench')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __frameWidths: number[] }).__frameWidths.length)).toBeGreaterThanOrEqual(30);
  const widths = await page.evaluate(() => (window as unknown as { __frameWidths: number[] }).__frameWidths);
  const fitted = Math.round(await page.locator('.frame').evaluate((el) => el.getBoundingClientRect().width));
  // the fitted width is narrower than the base breakpoint at this window size, so an unfitted first frame shows
  expect(fitted).toBeLessThan(1440);
  expect(widths, 'the frame width in each painted frame').toEqual(widths.map(() => fitted));
});

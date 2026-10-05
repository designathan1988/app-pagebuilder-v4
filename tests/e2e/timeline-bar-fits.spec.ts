// The Timeline's keyframe bar draws each of its controls whole, side by side, inside the panel (the user's review of
// 2026-10-05, LR2: with the playhead on a keyframe, "Add keyframe" ran into its border, the easing's curve button lay
// over the delete's trash, and "Delete the keyframe" ran past the panel's edge, cut; in Portuguese "Suavização do
// quadro-chave" took two lines over its neighbours). The track area takes the panel's width beside the side, and the
// bar's controls wrap to a second line rather than squeeze.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const PT = 'preferences.setLanguage#menu-language-pt-br';
const TIMELINE = 'workspace.setPanelOpen#dock-strip-timeline';

test('with the playhead on a keyframe, the bar under the track holds its controls whole, apart and inside the panel', runs(OPEN, ROW, PT, TIMELINE), async ({ page }) => {
  // the narrowest window that docks the sidebar: the narrowest Timeline
  await page.setViewportSize({ width: 1366, height: 768 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  await control(page, ROW, { args: { target: 'c-subscribe' } }).click();
  await runDoor(page, TIMELINE);
  for (const language of ['en', 'pt-BR']) {
    if (language === 'pt-BR') await runDoor(page, PT);
    // the playhead stands at 0 %, on the animation's first keyframe: the bar holds Add keyframe, its easing and delete
    const bar = page.locator('.timeline__track-area > .timeline__row');
    await expect(bar.locator('[data-door$="#timeline-keyframe-delete"]')).toBeVisible();
    const found = await page.locator('.timeline__track-area').evaluate((area) => {
      const problems: string[] = [];
      const edge = area.getBoundingClientRect();
      const row = area.querySelector<HTMLElement>(':scope > .timeline__row');
      if (row === null) return ['no bar'];
      const parts = [...row.children].filter((one): one is HTMLElement => one instanceof HTMLElement && one.getClientRects().length > 0);
      const boxes = parts.map((one) => ({ name: one.textContent?.trim() || one.getAttribute('aria-label') || one.className, box: one.getBoundingClientRect() }));
      for (const { name, box } of boxes) if (box.right > edge.right + 1) problems.push(`past the panel's edge: ${name}`);
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
        const over = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1;
        if (over) problems.push(`${a.name} over ${b.name}`);
      }));
      // nothing of a control past its box (the easing's curve button lay over the delete beside it)
      for (const part of parts) {
        const box = part.getBoundingClientRect();
        for (const inner of part.querySelectorAll<HTMLElement>('button, input')) {
          const own = inner.getBoundingClientRect();
          if (own.width > 0 && (own.left < box.left - 1 || own.right > box.right + 1)) problems.push(`past its control: ${inner.getAttribute('aria-label') ?? inner.className}`);
        }
      }
      // every text whole inside its control: on one line, within the control's box
      for (const one of row.querySelectorAll<HTMLElement>('.door__label, .field-row__label, .easing-curve__button, .panel-field__text')) {
        // a name kept for assistive technology only (clipped away, as an icon button's) is no text drawn
        if (one.getClientRects().length === 0 || one.closest('.visually-hidden') !== null || getComputedStyle(one).clipPath !== 'none') continue;
        const range = document.createRange();
        range.selectNodeContents(one);
        const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        if (lines > 1) problems.push(`in ${lines} lines: ${one.textContent?.trim() ?? ''}`);
        const host = one.closest<HTMLElement>('button, .field-row') ?? one;
        const text = range.getBoundingClientRect();
        const box = host.getBoundingClientRect();
        if (text.width > 0 && (text.left < box.left - 1 || text.right > box.right + 1)) problems.push(`out of its control: ${one.textContent?.trim() ?? ''}`);
      }
      return problems;
    });
    expect(found, `the bar (${language})`).toEqual([]);
  }
});

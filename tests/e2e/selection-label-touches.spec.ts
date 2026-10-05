// The selection's label touches its element (the user's review of 2026-10-05, LR2: "o rótulo da moldura de seleção e
// o quick panel todos posicionados errados" — every label stood about 22 px off its element, above or below, the quick
// panel's chip beside it: the faint margin bands that wait along every edge and the rotation zones that draw nothing
// were taken for controls the label must clear, so no place touching the element was ever free). The canonical label
// stands just off its element's edge (design/final .ov-tag); it still covers no page text, no resize handle (A3.16)
// and no band a mode pins, and the chip beside it covers no rotation zone.
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';

test('the selection label stands touching its element, above, below or inside it, and the chip beside it', runs(OPEN, ROW), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  // a section at the page's top, a heading under a line of text, a full-width heading, a button and a menu link
  for (const target of ['c-hero', 'c-title', 'c-plans-title', 'c-subscribe', 'c-nav-0']) {
    await control(page, ROW, { args: { target } }).click();
    const label = page.locator(`[data-chrome="label"][data-label-for="${target}"]:not(.is-measuring)`);
    await expect(label).toBeVisible();
    // the chip follows the label a frame later: read until both have settled
    const read = () => page.evaluate((id) => {
      const frame = document.querySelector('.chrome__selection')?.getBoundingClientRect();
      const tag = document.querySelector(`[data-chrome="label"][data-label-for="${id}"]`);
      const own = tag?.getBoundingClientRect();
      if (frame === undefined || own === undefined || tag === null) return ['nothing drawn'];
      const problems: string[] = [];
      const placement = tag.getAttribute('data-placement');
      // the distance between the label and its element's edge, by where it stands
      const off = placement === 'above' ? frame.top - own.bottom : placement === 'below' ? own.top - frame.bottom : Math.min(own.top - frame.top, own.left - frame.left);
      if (off < 0 || off > 4) problems.push(`${id} ${placement}: ${Math.round(off)} px off its element`);
      const meets = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      for (const handle of document.querySelectorAll('[data-canvas-overlay] [data-resize-handle]:not([data-chrome="edge"])')) {
        if (meets(own, handle.getBoundingClientRect())) problems.push(`${id}: the label covers the ${handle.getAttribute('data-resize-handle')} handle`);
      }
      const chip = document.querySelector('.quick-panel-chip')?.getBoundingClientRect();
      if (chip === undefined) problems.push(`${id}: no chip`);
      else {
        // on the label's line (centred on it, held inside the stage at its edge)
        const middle = own.top + own.height / 2;
        if (middle < chip.top || middle > chip.bottom) problems.push(`${id}: the chip is not on the label's line`);
        if (chip.left < own.right) problems.push(`${id}: the chip is not beside the label`);
        for (const zone of document.querySelectorAll('[data-rotate-handle]')) if (meets(chip, zone.getBoundingClientRect())) problems.push(`${id}: the chip covers the ${zone.getAttribute('data-rotate-zone')} rotation zone`);
      }
      return problems;
    }, target);
    await expect.poll(read, { message: target }).toEqual([]);
  }
});

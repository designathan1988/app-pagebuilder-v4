// The quick panel's chip and the rotation zones both take their presses beside a narrow element's label (the audit of
// 2026-10-05, AU6-20): the chip stands on the label's right (DEC-70), which for an element about as wide as its label
// is where the north-east rotation zone lay outside the frame's corner, and the zone, drawn over the chip, took the
// press — the chip never opened its panel. The arrangement moves the zone to its next free place (DEC-75), so at every
// width the chip and every zone drawn are each the control a press at their middle reaches.
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const WIDTH = 'style.set#inspector-width';

test('the chip and every rotation zone take a press at their middle beside a field of any width, and the chip opens the panel', runs(INSERT_PANEL, TILE, WIDTH), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await runDoor(page, INSERT_PANEL);
  // a heading first, so the field stands below the page's top and its rotation zones lie outside its corners (at the
  // top they turn inward, under the frame's top edge)
  await control(page, TILE, { args: { entry: 'heading' } }).first().click();
  await page.keyboard.press('Escape');
  await runDoor(page, INSERT_PANEL);
  await control(page, TILE, { args: { entry: 'input-text' } }).first().click();
  const chip = page.locator('[data-quick-panel-chip][aria-expanded="false"]');
  const width = control(page, WIDTH).locator('input').first();
  const onTop: string[] = [];
  // the field's width swept so its frame's corner passes under the chip
  for (let px = 120; px <= 260; px += 10) {
    await width.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`${px}px`);
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    if (box === null) throw new Error('no chip');
    const met = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.closest('[data-quick-panel-chip]') !== null ? 'chip' : `${e?.className}`; }, [box.x + box.width / 2, box.y + box.height / 2] as const);
    if (met !== 'chip') onTop.push(`${px}px: ${met}`);
    // every zone drawn is the control a press at its middle reaches
    const zones = await page.locator('[data-rotate-zone]').evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return e !== null && el.contains(e) ? '' : `${el.getAttribute('data-rotate-zone')}: ${e?.className}`; }).filter((x) => x !== ''));
    for (const zone of zones) onTop.push(`${px}px zone ${zone}`);
    expect(await page.locator('[data-rotate-zone]').count(), `${px}px: the zones drawn`).toBeGreaterThan(0);
  }
  expect(onTop, 'what lay over the chip or a zone').toEqual([]);
  const box = await chip.boundingBox();
  if (box === null) throw new Error('no chip');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-quick-panel-chip][aria-expanded="true"]')).toBeVisible();
});

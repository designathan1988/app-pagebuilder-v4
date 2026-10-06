// The Motion dock's action row lies within the dock (the audit of 2026-10-05, AU6-19).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const TAB = 'workspace.setActiveTab#inspector-tab-interactions';
const ADD = 'motion.add#inspector-motion-add';
const DOCK = 'workspace.setPanelOpen#dock-strip-motion';
const BAR = 'motion.select#timeline-motion-bar';

// Every field of the action row is reachable without scrolling the dock sideways (the audit of 2026-10-05, AU6-19: the
// timeline column took its track's width, 1540 px in an 840 px dock at 1440 × 900, and Add at the playhead stood past
// the dock's right edge, reached only by scrolling).
for (const [width, height] of [[1280, 720], [1440, 900]] as const) {
  test(`the Motion dock's action row lies within the dock at ${width} × ${height}`, runs(INSERT_PANEL, TILE, TAB, ADD, DOCK, BAR), async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openEditor(page);
    await runDoor(page, INSERT_PANEL);
    await control(page, TILE, { args: { entry: 'container' } }).first().click();
    await runDoor(page, TAB);
    await runDoor(page, ADD);
    await runDoor(page, DOCK);
    await control(page, BAR).first().click();
    const fields = page.locator('.motion-timeline__add .field-row');
    await expect(fields).toHaveCount(3);
    const body = await page.locator('.dock-body').first().boundingBox();
    if (body === null) throw new Error('no dock');
    for (const box of await fields.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; }))) {
      expect(box.right, 'a field\'s right edge within the dock').toBeLessThanOrEqual(body.x + body.width + 0.5);
    }
  });
}

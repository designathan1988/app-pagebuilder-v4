// Every dock panel is a press away while the dock is open (the audit of 2026-10-04's rendered sweep: with the dock open
// on the Timeline, the strip drew only the panels already opened as tabs, so the Motion panel could be reached only by
// closing the dock first).
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const TIMELINE = 'workspace.setPanelOpen#dock-strip-timeline';
const MOTION = 'workspace.setPanelOpen#dock-strip-motion';

test('with the dock open on the Timeline, the Motion panel opens from the strip', runs(TIMELINE, MOTION), async ({ page }) => {
  await openEditor(page);
  await runDoor(page, TIMELINE);
  await expect(page.locator('[data-region="dock-strip"] [role="tablist"]')).toBeVisible();
  const motion = page.locator(`[data-region="dock-strip"] [data-door="${MOTION}"]`);
  await expect(motion).toBeVisible();
  await motion.click();
  await expect(page.locator('[data-region="dock-motion"]')).toBeVisible();
});

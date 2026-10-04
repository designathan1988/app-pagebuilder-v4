// The Motion dock draws its text whole (the audit of 2026-10-04's real-use pass: in the easing-curve flow's photo the
// timeline row's Delete the timeline ran past its column's edge, the action's easing read "cubic-bezier(0.42, 1.6, (" with
// no ellipsis and no tooltip, and the timeline's Name field wore the UI's input face, larger than every value beside
// it). Every value of the dock wears the code face of the Timeline's values; a button stays within its column; a value
// of several parts the field cannot hold ends in an ellipsis and its field's tooltip carries it whole (spec
// inspector-panel, Problem 12's rule, in the dock).
import fs from 'node:fs';
import { expect, test } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const TAB = 'workspace.setActiveTab#inspector-tab-interactions';
const ADD = 'motion.add#inspector-motion-add';
const PANEL = 'workspace.setPanelOpen#dock-strip-motion';
const BAR = 'motion.select#timeline-motion-bar';
const EASING = 'motion.updateAction#timeline-motion-action-easing';

test('the Motion dock keeps its buttons within their column and its values whole or ellipsed with a tooltip, in one face', runs(OPEN, ROW, TAB, ADD, PANEL, BAR, EASING), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'motion.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/motion.json') });
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  await runDoor(page, TAB);
  await runDoor(page, ADD);
  await runDoor(page, PANEL);
  await control(page, BAR).first().click();
  const easing = control(page, EASING).locator('input.panel-field__text');
  await easing.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('cubic-bezier(0.42, 1.6, 0.58, 1)');
  await page.keyboard.press('Enter');
  await page.locator('[data-region="dock-motion"]').click({ position: { x: 2, y: 2 } });
  await expect(easing).toHaveValue('cubic-bezier(0.42, 1.6, 0.58, 1)');
  const found = await page.locator('[data-region="dock-motion"]').evaluate((dock) => {
    const problems: string[] = [];
    // a control of the timelines' column that runs past the column's edge
    const side = dock.querySelector<HTMLElement>('.motion-timeline__side');
    if (side !== null) {
      const edge = side.getBoundingClientRect().right;
      for (const one of side.querySelectorAll<HTMLElement>('button:not(.visually-hidden), .motion-timeline__uses')) {
        if (one.getClientRects().length > 0 && one.getBoundingClientRect().right > edge + 1) problems.push(`past the column: ${one.textContent?.trim() ?? ''}`);
      }
    }
    // a value the field cannot hold: ellipsed, with its whole text in the field's tooltip
    const faces = new Set<string>();
    for (const input of dock.querySelectorAll<HTMLInputElement>('input.panel-field__text')) {
      if (input.getClientRects().length === 0) continue;
      const style = getComputedStyle(input);
      faces.add(`${style.fontFamily} ${style.fontSize}`);
      if (input.value !== '' && input.scrollWidth > input.clientWidth + 1 && (style.textOverflow !== 'ellipsis' || input.title !== input.value)) problems.push(`cut without ellipsis or tooltip: ${input.value}`);
    }
    if (faces.size > 1) problems.push(`values in ${faces.size} faces: ${[...faces].join(' | ')}`);
    return problems;
  });
  expect(found).toEqual([]);
});

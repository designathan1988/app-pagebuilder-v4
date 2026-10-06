// Keyboard navigation between the editor's regions (manifest feature keyboard-panel-navigation):
// F6 and Shift+F6 move the keyboard focus from region to region (top bar, the left dock, the canvas,
// the dock, the inspector, the status bar), each region's items are walked with the arrows of its own context, and
// Escape inside a panel gives the focus back to the canvas — the body of the editor's document, which is the canvas's
// key context (input/keymap.ts) — with the selection intact. What proves it is the real focus (document.activeElement)
// after each real key press, never a drawn mark.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { runDoor, runs } from './door.ts';

const escapeInLayers = 'focus.canvas#key-escape-in-layers-tree';
const row = 'selection.select#layers-row';
const f6 = 'focus.nextRegion#key-f6-in-global';
const shiftF6 = 'focus.previousRegion#key-shift-f6-in-global';

// the editor's region the keyboard focus is in, read from the element that holds it
const region = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const held = document.activeElement;
    if (held === null || held === document.body) return 'body';
    for (const one of ['header.top-bar', 'nav.activity-bar', 'section[data-panel-area="layers"]', 'aside.sidebar', '.stage', '.dock-strip', 'aside.inspector', 'footer.status-bar']) {
      if (held.closest(one) !== null) return one;
    }
    return held.tagName;
  });

test('F6 walks the focus through the editor regions and Shift+F6 walks it back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  // the start: nothing holds the focus, which is the canvas's own context (the editor's body)
  expect(await region(page), 'the canvas holds the focus at the start').toBe('body');
  const walked: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    await runDoor(page, f6);
    walked.push(await region(page));
  }
  // every region the window draws takes the focus at some point in one full turn
  // the Layers tree is a stop of its own (jornada03 J12)
  for (const one of ['header.top-bar', 'nav.activity-bar', 'section[data-panel-area="layers"]', '.stage', 'aside.inspector', 'footer.status-bar']) {
    expect(walked, `F6 reaches ${one}`).toContain(one);
  }
  // and Shift+F6 turns the same ring the other way: two steps forward and one back is one step forward
  await runDoor(page, f6);
  const forward = await region(page);
  await runDoor(page, f6);
  await runDoor(page, shiftF6);
  expect(await region(page), 'Shift+F6 undoes one F6').toBe(forward);
});

test('Escape inside a panel gives the focus back to the canvas and keeps the selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  // a real page: a heading of the fixture, selected through its Layers row (which takes the focus, as a tree's row does)
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, 'project.open#menu-file');
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-title"]')).toHaveCount(1);
  await page.locator(`[data-door="${row}"][data-args*='"n-title"']`).first().click();
  await expect.poll(() => region(page), { message: 'the tree holds the focus' }).not.toBe('body');
  const selected = await page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => readonly string[] } }).__builderTestPort.selection());
  expect(selected.length, 'a row was selected').toBe(1);
  await runDoor(page, escapeInLayers);
  await expect.poll(() => region(page), { message: 'Escape gives the focus back to the canvas' }).toBe('body');
  expect(await page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => readonly string[] } }).__builderTestPort.selection()), 'the selection is intact').toEqual(selected);
  // and the canvas's own keys act again: Delete takes the selected element out of the document and the canvas
  await page.keyboard.press('Delete');
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-title"]'), 'Delete deletes the element the canvas holds').toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify((window as unknown as { __builderTestPort: { document: () => unknown } }).__builderTestPort.document())), 'the document no longer holds it').not.toContain('n-title');
});

test('F6 puts the keys on the canvas page itself, with a visible focus, and walks on from there', async ({ page }) => {
  // the audit's AUD-13 (jornada03 J12): the canvas's stop of the F6 ring focused the frame's breakpoint tabs, so the
  // page's tree walk needed a click or Escape
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, 'project.open#menu-file');
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-title"]')).toHaveCount(1);
  const onStage = () => page.evaluate(() => document.activeElement?.matches('.stage') === true);
  let reached = false;
  for (let i = 0; i < 12 && !reached; i += 1) {
    await runDoor(page, f6);
    reached = await onStage();
  }
  expect(reached, 'one stop of the F6 ring is the canvas page itself').toBe(true);
  expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible') === true), 'the canvas shows it holds the focus').toBe(true);
  expect(await page.evaluate(() => (document.activeElement === null ? '' : getComputedStyle(document.activeElement).outlineStyle)), 'its focus ring is drawn').toBe('solid');
  const selection = () => page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => readonly string[] } }).__builderTestPort.selection());
  expect(await selection()).toEqual([]);
  // the canvas's own keys act: the tree walk starts at the page
  await page.keyboard.press('ArrowDown');
  await expect.poll(selection, { message: 'ArrowDown walks into the page' }).not.toEqual([]);
  // and the ring goes on from the canvas, not from its start: one step on and one back is the canvas again
  await runDoor(page, f6);
  expect(await onStage()).toBe(false);
  await runDoor(page, shiftF6);
  expect(await onStage(), 'Shift+F6 comes back to the canvas page').toBe(true);
});

test('Ctrl+A on a control outside the canvas selects the page elements, never the interface text', runs('selection.selectAllInContainer#key-ctrl-a-in-global'), async ({ page }) => {
  // the audit's AUD-25: with the focus on a sidebar button, Ctrl+A was the browser's own, and selected the whole interface
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, 'project.open#menu-file');
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-title"]')).toHaveCount(1);
  await page.locator('[data-door="workspace.setPanelOpen#toolbar-activity-bar-explorer"]').focus();
  await page.keyboard.press('Control+A');
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''), 'no interface text is selected').toBe('');
  const selection = await page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => readonly string[] } }).__builderTestPort.selection());
  expect(selection, 'the page elements are').toEqual(['n-hero', 'n-plans', 'n-footer']);
});

// A panel opened takes the focus two frames later (focus.ts, the panel's request): a control the person reaches inside
// it in those two frames keeps the focus (FL2: narrow-window's tile, focused at once, lost it to the Insert panel's
// search field, so its Escape cleared the field instead of closing the panel). Played in the page to hold the timing:
// the Insert panel opened from the Explorer, its second tile focused on the next frame, the focus read three frames on.
test('a control reached inside a panel just opened keeps the focus', runs('workspace.setPanelOpen#toolbar-activity-bar-insert'), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await page.locator('[data-door="workspace.setPanelOpen#toolbar-activity-bar-explorer"]').click();
  await expect(page.locator('[data-door="element.insert#elements-tile"]')).toHaveCount(0);
  const held = await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    document.querySelector<HTMLElement>('[data-door="workspace.setPanelOpen#toolbar-activity-bar-insert"]')?.click();
    await frame();
    const tile = document.querySelectorAll<HTMLElement>('[data-door="element.insert#elements-tile"]')[1];
    tile?.focus();
    await frame();
    await frame();
    await frame();
    return { tile: tile?.getAttribute('data-args') ?? null, focused: document.activeElement?.getAttribute('data-args') ?? document.activeElement?.tagName ?? null };
  });
  expect(held.tile).not.toBeNull();
  expect(held.focused).toBe(held.tile);
});

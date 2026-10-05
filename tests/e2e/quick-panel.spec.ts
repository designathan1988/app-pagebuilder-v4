// quick-panel beyond its scenarios (spec/BEHAVIOUR.md#quick-panel): the panel dragged by its grip stays where it was
// put for that element after a reload (Problems in Pager 1: its offset from the element, read on the screen), and it
// shows only the fields whose property applies to the element (PRODUCT.md §5.3: the text fields for an element that
// holds text, none for a section). The scenarios cannot say where the panel is drawn relative to its element, nor which
// fields it draws: this test reads the panel's box and fields in Chrome.
import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openEverySection, runDoor, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const INSERT = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const TILE = 'element.insert#elements-tile';
const DELETE = 'element.delete#key-delete-in-canvas';
const GRIP = 'quickPanel.setOffset#panel-drag-quick-panel-grip-canvas';
const FONT_SIZE = 'style.set#quick-panel-font-size';
const WIDTH = 'style.set#quick-panel-width';

const panel = (page: Page) => page.locator('.quick-panel');
async function openPanel(page: Page): Promise<void> {
  await page.locator('[data-quick-panel-chip][aria-expanded="false"]').click();
  await expect(panel(page)).toBeVisible();
}
// the panel's top-left corner from the element's, on the screen
async function offset(page: Page, node: string): Promise<{ x: number; y: number }> {
  const box = await panel(page).boundingBox();
  const element = await page.evaluate((id) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const el = iframe?.contentDocument?.querySelector(`[data-node="${id}"]`);
    if (!iframe || !el) return null;
    const frame = iframe.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const zoom = iframe.currentCSSZoom;
    return { x: frame.left + r.left * zoom, y: frame.top + r.top * zoom };
  }, node);
  if (box === null || element === null) throw new Error('the panel or its element is not drawn');
  return { x: Math.round(box.x - element.x), y: Math.round(box.y - element.y) };
}

test('the panel dragged by its grip keeps its offset from the element after a reload', runs(OPEN, ROW, GRIP), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await openPanel(page);
  const before = await offset(page, 'n-intro');
  // the grip moved 120 px left and 40 px up, inside the stage (the panel stands below the Intro, held at the stage's
  // bottom left: spec quick-panel, Problems in Pager 9; 40 px leaves it inside the stage under the file tabs, which
  // the canonical frame always draws: the user's decision of 2026-10-02). It moved right until the inspector widened
  // to 336 px (DEC-66): the narrower stage holds the panel at its right edge already, so a move right moves nothing.
  const grip = await control(page, GRIP).boundingBox();
  if (grip === null) throw new Error('the grip is not drawn');
  const from = { x: Math.round(grip.x + grip.width / 2), y: Math.round(grip.y + grip.height / 2) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 120, from.y - 40, { steps: 10 });
  await page.mouse.up();
  const dragged = await offset(page, 'n-intro');
  expect(dragged).toEqual({ x: before.x - 120, y: before.y - 40 });
  await page.reload();
  await expect(page.locator('.workbench')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection())).toEqual(['n-intro']);
  await openPanel(page);
  await expect.poll(() => offset(page, 'n-intro')).toEqual(dragged);
});

test('the panel shows the fields whose property applies to the element', runs(OPEN, ROW, FONT_SIZE, WIDTH), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  // a section holds no text of its own: no font field, but W
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  await openPanel(page);
  await expect(panel(page).locator(`[data-door="${WIDTH}"]`)).toHaveCount(1);
  await expect(panel(page).locator(`[data-door="${FONT_SIZE}"]`)).toHaveCount(0);
  // a field drawn is one that applies (the audit's AUD-35: drawn alone): W written, the section takes the width
  await typeValue(page, panel(page).locator(`[data-door="${WIDTH}"] input`).first(), '420px');
  // (the frame's zoom leaves a used width a few thousandths of a px off)
  await expect.poll(() => page.frameLocator('.frame__page').locator('[data-node="n-hero"]').evaluate((el) => Math.round(Number.parseFloat(getComputedStyle(el).width)))).toBe(420);
  // a paragraph: its text fields too, and its font size field sizes its text
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await expect(panel(page).locator(`[data-door="${FONT_SIZE}"]`)).toHaveCount(1);
  await typeValue(page, panel(page).locator(`[data-door="${FONT_SIZE}"] input`).first(), '30px');
  await expect.poll(() => page.frameLocator('.frame__page').locator('[data-node="n-intro"]').evaluate((el) => getComputedStyle(el).fontSize)).toBe('30px');
});

async function typeValue(page: Page, field: Locator, value: string): Promise<void> {
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

// A3.34: the panel's fill field is named by what it shows — the background image, url or gradient — never "Gradient"
// while it holds an address, and typing an address writes that declaration.
test('the fill field is named Background image and writes the address typed', runs(OPEN, ROW, 'style.setBackgroundImage#quick-panel-fill-gradient'), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  await openPanel(page);
  const fill = page.locator('[data-door="style.setBackgroundImage#quick-panel-fill-gradient"]').first();
  await expect(fill).toHaveCount(1);
  // the row is labelled with the property it edits
  const label = (await fill.locator('.field-row__label').textContent()) ?? '';
  expect(label.trim()).toBe('Background image');
  const input = fill.locator('input').first();
  await input.click();
  await page.keyboard.type('https://example.com/photo.jpg\n');
  await expect.poll(() => page.evaluate(() => {
    const port = (window as unknown as { __builderTestPort: { document: () => { pages: { tree: { children: { id: string; styles?: Record<string, Record<string, Record<string, unknown>>> }[] } }[] } } }).__builderTestPort;
    const hero = port.document().pages[0]?.tree.children.find((c) => c.id === 'n-hero');
    return hero?.styles?.desktop?.base?.['background-image'] ?? null;
  })).toBe('url("https://example.com/photo.jpg")');
});

// 6.1: the panel's fields follow the element kind — a container's layout fields, an image's source and alternative
// text, a link's address, a button's text and type — and a field a kind does not take is not drawn.
test('the fields follow the element kind', runs(OPEN, ROW, INSERT, TILE), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  const panelDoor = (ref: string) => panel(page).locator(`[data-door="${ref}"]`);
  const insert = async (entry: string) => {
    const tile = control(page, TILE, { args: { entry } }).first();
    // the Insert view is a toggle: it is opened only while its tiles are not drawn
    if ((await tile.count()) === 0) await control(page, INSERT).click();
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
  };
  // a paragraph: its typography, and none of the container's or an image's fields
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await openPanel(page);
  await expect(panelDoor(FONT_SIZE)).toHaveCount(1);
  await expect(panelDoor('style.set#quick-panel-gap'), 'a paragraph is no container').toHaveCount(0);
  await expect(panelDoor('element.setAttribute#quick-panel-src'), 'a paragraph takes no source').toHaveCount(0);
  // a container laid out with flex: direction, alignment, padding and gap
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  // the inspector's Display field, in a section drawn collapsed while the Hero holds no layout value (item 5.1)
  await openEverySection(page);
  const hero = page.locator('[data-door="style.set#inspector-display"] input').first();
  await hero.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('flex\n');
  await expect.poll(async () => page.frameLocator('.frame__page').locator('[data-node="n-hero"]').evaluate((el) => getComputedStyle(el).display)).toBe('flex');
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  for (const ref of ['style.set#quick-panel-direction', 'style.set#quick-panel-align-items', 'style.set#quick-panel-padding', 'style.set#quick-panel-gap']) {
    await expect(panelDoor(ref), ref).toHaveCount(1);
  }
  // an image: its source and its alternative text
  await insert('image');
  for (const ref of ['element.setAttribute#quick-panel-src', 'element.setAttribute#quick-panel-alt', 'style.set#quick-panel-object-fit', 'style.set#quick-panel-radius']) {
    await expect(panelDoor(ref), ref).toHaveCount(1);
  }
  await expect(panelDoor('style.set#quick-panel-gap'), 'an image is no container').toHaveCount(0);
  // a link: its address and its new tab
  await insert('link');
  for (const ref of ['element.setLink#quick-panel-href', 'element.setLink#quick-panel-new-tab']) {
    await expect(panelDoor(ref), ref).toHaveCount(1);
  }
  // a button: its text and its type
  await insert('button');
  for (const ref of ['text.set#quick-panel-text', 'element.setAttribute#quick-panel-button-type']) {
    await expect(panelDoor(ref), ref).toHaveCount(1);
  }
});

// A3.42: the offsets the preferences keep are pruned of the elements the document no longer holds, as they are written:
// deleting an element whose panel was moved leaves no entry behind, so the list never grows with dead ids.
test('deleting an element with a moved panel removes its offset from the preferences', runs(OPEN, ROW, GRIP, DELETE), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  await openPanel(page);
  const grip = await control(page, GRIP).boundingBox();
  if (grip === null) throw new Error('the grip is not drawn');
  await page.mouse.move(Math.round(grip.x + grip.width / 2), Math.round(grip.y + grip.height / 2));
  await page.mouse.down();
  await page.mouse.move(Math.round(grip.x + grip.width / 2) - 120, Math.round(grip.y + grip.height / 2) + 60, { steps: 8 });
  await page.mouse.up();
  const stored = () => page.evaluate(() => {
    const raw = window.localStorage.getItem('preferences');
    const held = raw === null ? {} : (JSON.parse(raw) as { quickPanelOffsets?: Record<string, unknown> });
    return held.quickPanelOffsets ?? null;
  });
  await expect.poll(stored, 'the moved panel is kept').not.toBeNull();
  const ids = await page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection());
  expect(Object.keys((await stored()) ?? {})).toEqual(ids);
  // the element goes: its offset goes with it (the write prunes it)
  await page.keyboard.press('Delete');
  const selectionNow = () => page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection());
  await expect.poll(async () => await selectionNow()).not.toEqual(ids);
  await expect.poll(stored, 'the dead offset is gone').toEqual(null);
});

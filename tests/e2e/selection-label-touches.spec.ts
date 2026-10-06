// The selection's label and the quick panel have one place each (the user's rule of 2026-10-05, DEC-70): the label
// always above its element, touching the top of the selection's frame and starting at its left edge — never inside,
// below, beside or moved aside for an obstacle — and the quick panel always on the label's right, on its line, touching
// it (the chip resting on the frame as the label does, the open panel level with the label's top). It holds for a small
// element and a large one, at the page's top and its right edge, rotated, zoomed from 25 % to 400 %, scrolled, for
// several selected, at every breakpoint, with the panel open and closed. (QA 375 had placed the label at the first
// free place of six, and the chip beside it, held inside the stage.)
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs } from './door.ts';

const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const FIT = 'view.zoomFit#toolbar-status-bar-fit';

// the label's distance from the frame's line above it and from its left, and the chip's (or the open panel's) from the
// label's right and its level; null where nothing is drawn or the label is out of sight
async function measured(page: Page): Promise<{ readonly label: [number, number]; readonly chip: [number, number] | null } | null> {
  return page.evaluate(() => {
    const frame = document.querySelector('[data-chrome="union"]') ?? document.querySelector('[data-chrome="selection"]');
    const label = document.querySelector('[data-chrome="label"]:not(.is-measuring)');
    if (frame === null || label === null || getComputedStyle(label).visibility === 'hidden') return null;
    // the frame's line drawn outside its box; turned with the element, its upright bounding box grows by the line's width
    // times |cos| + |sin| on each side
    const turn = new DOMMatrix(getComputedStyle(frame).transform === 'none' ? undefined : getComputedStyle(frame).transform);
    const edge = (parseFloat(getComputedStyle(frame).outlineWidth) || 0) * (Math.abs(turn.a) + Math.abs(turn.b));
    const f = frame.getBoundingClientRect();
    const l = label.getBoundingClientRect();
    const open = document.querySelector('.quick-panel:not(.is-measuring)');
    const chip = open ?? document.querySelector('.quick-panel-chip:not(.is-measuring)');
    const c = chip?.getBoundingClientRect();
    const round = (n: number) => Math.round(n * 2) / 2 + 0;
    return {
      label: [round(f.top - edge - l.bottom), round(l.left - (f.left - edge))],
      chip: c === undefined ? null : [round(c.left - l.right), round(open !== null ? c.top - l.top : c.bottom - l.bottom)],
    };
  });
}

async function holds(page: Page, name: string, chip: 'chip' | 'none' = 'chip'): Promise<void> {
  await expect.poll(() => measured(page), { message: name }).toEqual({ label: [0, 0], chip: chip === 'none' ? null : [0, 0] });
}

// by its Layers row, or, where the tree draws no row for it (outside the panel's window), by a click on the canvas
const select = async (page: Page, target: string, modifiers: ('Shift')[] = []) => {
  const row = control(page, ROW, { args: { target } });
  if ((await row.count()) > 0) {
    await row.click({ modifiers });
    return;
  }
  const at = await page.evaluate((id) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const element = iframe?.contentDocument?.querySelector(`[data-node="${id}"]`);
    if (!iframe || !element) throw new Error(`the canvas does not draw ${id}`);
    const zoom = iframe.currentCSSZoom;
    const frame = iframe.getBoundingClientRect();
    const r = element.getBoundingClientRect();
    return { x: frame.left + (r.left + r.width / 2) * zoom, y: frame.top + (r.top + r.height / 2) * zoom };
  }, target);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(at.x, at.y);
  for (const key of modifiers) await page.keyboard.up(key);
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/canonical.json') });
  await expect(page.frameLocator('.frame__page').locator('[data-node="c-hero"]')).toHaveCount(1);
});

test('the selection label stands above its element touching its frame, the chip on its right, for every kind of element', runs(OPEN, ROW), async ({ page }) => {
  // a large section, a small link (narrower than its label), the header and the page at the page's top (their label
  // over the breakpoint tabs), the last link at the page's right edge, an image at the right, a heading under text, a
  // button
  for (const target of ['c-hero', 'c-nav-0', 'c-header', 'c-enter', 'c-hero-image', 'c-title', 'c-subscribe']) {
    await select(page, target);
    await holds(page, target);
  }
  // the page root draws no quick panel; its label stands above the page, over the tabs, in sight
  await select(page, 'c-page');
  await holds(page, 'c-page', 'none');
  // several selected: the label over their union
  await select(page, 'c-card-subscription');
  await select(page, 'c-card-beans', ['Shift']);
  await holds(page, 'two cards');
});

test('the label and the chip keep their places at every zoom, scrolled, rotated and at every breakpoint', runs(OPEN, ROW, FIT, 'view.zoomTo#menu-zoom-25', 'view.zoomTo#menu-zoom-400', 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet', 'view.setBreakpoint#toolbar-breakpoint-tabs-phone', 'style.set#handle-rotate'), async ({ page }) => {
  await select(page, 'c-title');
  await openMenu(page, 'zoom');
  await control(page, 'view.zoomTo#menu-zoom-25').click();
  await holds(page, 'zoom 25 %');
  await openMenu(page, 'zoom');
  await control(page, 'view.zoomTo#menu-zoom-400').click();
  // at 400 % the title's start lies left of the canvas: the label keeps its place there, out of sight, and the chip
  // with it — neither is moved into the canvas
  await expect.poll(() => measured(page), { message: 'zoom 400 %: out of sight' }).toBeNull();
  await expect(page.locator('.quick-panel-chip:not(.is-measuring)')).toHaveCount(0);
  await control(page, FIT).click();
  await holds(page, 'fit');
  // rotated by its rotation handle
  await select(page, 'c-plans-title');
  // the north-west zone turned 30° along the circle around the heading's centre
  const zone = await page.locator('[data-canvas-overlay] [data-rotate-zone="nw"]').boundingBox();
  const button = await page.locator('[data-chrome="selection"]').boundingBox();
  if (zone === null || button === null) throw new Error('no rotation zone');
  const centre = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
  const from = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
  const radius = Math.hypot(from.x - centre.x, from.y - centre.y);
  const start = Math.atan2(from.y - centre.y, from.x - centre.x);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(centre.x + radius * Math.cos(start + (Math.PI / 6) * (i / 12)), centre.y + radius * Math.sin(start + (Math.PI / 6) * (i / 12)));
  await page.mouse.up();
  await expect(page.locator('[data-chrome="label-angle"]')).toBeVisible();
  await holds(page, 'rotated');
  // scrolled: the label follows its element
  await select(page, 'c-card-beans-title');
  await page.locator('[data-canvas-stage]').hover();
  await page.mouse.wheel(0, 300);
  await holds(page, 'scrolled');
  for (const breakpoint of ['tablet', 'phone']) {
    await control(page, `view.setBreakpoint#toolbar-breakpoint-tabs-${breakpoint}`).click();
    await select(page, 'c-subscribe');
    await holds(page, breakpoint);
  }
});

test('the open quick panel stands on the label’s right, level with its top, whole beside a label near the canvas edge', runs(OPEN, ROW, 'quickPanel.setOpen#chip'), async ({ page }) => {
  await select(page, 'c-subscribe');
  await page.locator('.quick-panel-chip').click();
  await expect(page.locator('.quick-panel:not(.is-measuring)')).toBeVisible();
  await holds(page, 'open');
  // a link near the canvas's right edge: the panel stands beside its label still, over the inspector, its close in
  // reach (the stage is clipped, never scrolled by the focus put in the panel)
  await select(page, 'c-nav-2');
  await holds(page, 'open near the edge');
  const close = page.locator('.quick-panel .quick-panel__close');
  const reach = await close.evaluate((element) => {
    const b = element.getBoundingClientRect();
    return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.quick-panel__close') === element;
  });
  expect(reach, 'the close takes its press').toBe(true);
  await close.click();
  await holds(page, 'closed again');
});

// Opened beside a label near the window's bottom, the panel was held to the room left below it (QA 408): at Tablet the
// plans' title near the canvas's bottom had a panel 89 px tall, one field in sight (the pairing of 2026-10-05). Opening
// it now moves the canvas once so the whole panel fits below the label, still beside it (DEC-70).
test('the quick panel opened beside a label near the bottom moves the canvas so it fits whole', runs(OPEN, ROW, 'quickPanel.setOpen#chip', 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet'), async ({ page }) => {
  await runDoor(page, 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet');
  await select(page, 'c-plans-title');
  // the canvas scrolled with the wheel until the title's label stands near the window's bottom
  const stage = page.locator('.frame__view').first();
  const box = await stage.boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const label = page.locator('[data-chrome="label"]:not(.is-measuring)');
  const viewport = page.viewportSize()?.height ?? 900;
  for (let turn = 0; turn < 40; turn += 1) {
    const at = await label.boundingBox();
    if (at !== null && at.y > viewport - 140 && at.y < viewport - 60) break;
    await page.mouse.wheel(0, at === null || at.y < viewport - 140 ? -40 : 40);
    await page.waitForTimeout(60);
  }
  const before = await label.boundingBox();
  expect(before?.y ?? 0, 'the label near the bottom').toBeGreaterThan(viewport - 140);
  await page.locator('.quick-panel-chip').click();
  const panel = page.locator('.quick-panel:not(.is-measuring)');
  await expect(panel).toBeVisible();
  await holds(page, 'open beside the label');
  // whole: nothing held scrolled inside it, and its bottom inside the window
  await expect.poll(() => panel.evaluate((element) => element.scrollHeight - element.clientHeight), { message: 'no inner scroll' }).toBeLessThanOrEqual(1);
  const placed = await panel.boundingBox();
  expect((placed?.y ?? 0) + (placed?.height ?? 0), 'inside the window').toBeLessThanOrEqual(viewport);
  expect(placed?.height ?? 0, 'taller than one field').toBeGreaterThan(200);
});

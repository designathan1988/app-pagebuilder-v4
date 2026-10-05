// marquee-select beyond its scenarios (spec/BEHAVIOUR.md#marquee-select): the band the canvas chrome draws while the
// pointer drags (src/editor/canvas/chrome.tsx), the selection following the band live (src/editor/input/pointer.ts),
// and what selection.marquee takes (src/core/selection/selection.ts): the direct children of the container the band
// was pressed in, each one it touches; with Alt held, the leaves instead (a leaf when touched, a container only when
// held entirely and then in its descendants' place); Ctrl toggling; a press on a leaf is never a marquee. Points are
// given in page pixels of the aurora fixture at the fit zoom and mapped to the screen through the frame's content box
// and CSS zoom; the selection is read through the read-only test port.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runs } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const MARQUEE = 'selection.marquee#canvas-drag-empty-area-page-or-container';

interface Point {
  readonly x: number;
  readonly y: number;
}

// two animation frames: the canvas chrome draws what it measures on its next frame, so a check that something is
// not drawn waits until it would have been
const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const selection = (page: Page) => page.evaluate(() => (window as unknown as Record<string, { selection: () => string[] }>).__builderTestPort?.selection());

async function openAurora(page: Page) {
  await openMenu(page, 'file');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-intro"]')).toHaveCount(1);
}

// A node's box in page pixels (the page's CSS pixels, not scrolled): read from the frame, so a point that is meant to
// be "the middle of Intro" stays the middle of Intro when the page's default styles move the layout.
interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
function boxOf(page: Page, id: string): Promise<Box> {
  return page.evaluate((node) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    const el = iframe?.contentDocument?.querySelector(`[data-node="${node}"]`);
    if (iframe === null || iframe === undefined || el === null || el === undefined) throw new Error(`the canvas does not draw ${node}`);
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }, id);
}
const midOf = async (page: Page, id: string): Promise<Point> => {
  const box = await boxOf(page, id);
  return { x: box.x + Math.round(box.w / 2), y: box.y + Math.round(box.h / 2) };
};

// a page point (the page's CSS pixels, not scrolled) on the screen: the iframe's content box scaled by its CSS zoom
function screen(page: Page, at: Point): Promise<Point> {
  return page.evaluate((p) => {
    const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
    if (!iframe) throw new Error('the canvas has no page');
    const zoom = iframe.currentCSSZoom;
    const box = iframe.getBoundingClientRect();
    const style = getComputedStyle(iframe);
    const left = box.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
    const top = box.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
    return { x: left + p.x * zoom, y: top + p.y * zoom };
  }, at);
}

// presses at `from` (with a modifier held), moves past the drag threshold and on to each point, keeping the button down
async function pressAndMove(page: Page, from: Point, to: Point, modifier: string | null = null) {
  const start = await screen(page, from);
  const end = await screen(page, to);
  await page.mouse.move(start.x, start.y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 8, { steps: 3 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  return { start, end };
}
async function release(page: Page, modifier: string | null = null) {
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await expect(page.locator('.workbench')).toBeVisible();
  await openAurora(page);
});

test(
  'while the pointer drags, the band lies from the press to the pointer and the selection follows it live; the release keeps it and takes the band away',
  runs('project.open#menu-file', MARQUEE),
  async ({ page }) => {
    // from Hero's top-left padding to the middle of Intro: Title and Intro are touched, before any release
    const { start, end } = await pressAndMove(page, { x: 20, y: 20 }, await midOf(page, 'n-intro'));
    const band = page.locator('[data-chrome="band"]');
    await expect
      .poll(async () => {
        const box = await band.boundingBox();
        const near = (a: number, b: number) => Math.abs(a - b) <= 1;
        return box !== null && near(box.x, start.x) && near(box.y, start.y) && near(box.width, end.x - start.x) && near(box.height, end.y - start.y);
      }, { message: 'the band lies from the press to the pointer' })
      .toBe(true);
    expect(await band.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
    expect(await selection(page)).toEqual(['n-title', 'n-intro']);
    await expect(page.getByRole('status')).toHaveText('2 elements selected.');

    // back up to the middle of Title: the band touches Title only, recomputed from the selection at the press
    const back = await screen(page, await midOf(page, 'n-title'));
    await page.mouse.move(back.x, back.y, { steps: 4 });
    expect(await selection(page)).toEqual(['n-title']);

    await release(page);
    await expect(band).toHaveCount(0);
    expect(await selection(page)).toEqual(['n-title']);
    // one element is named, as a click names it
    await expect(page.getByRole('status')).toHaveText('Title selected.');
  },
);

test('a band that touches nothing replaces the selection with nothing, and the status bar says so', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', MARQUEE), async ({ page }) => {
  const intro = await screen(page, await midOf(page, 'n-intro'));
  await page.mouse.click(intro.x, intro.y);
  expect(await selection(page)).toEqual(['n-intro']);
  // inside Hero's top padding only, above the Title: the band touches nothing
  await pressAndMove(page, { x: 20, y: 20 }, { x: 600, y: (await boxOf(page, 'n-title')).y - 10 });
  await release(page);
  expect(await selection(page)).toEqual([]);
  await expect(page.getByRole('status')).toHaveText('Nothing selected.');
});

test('with Shift held, the band adds to the selection held at the press, and gives up what it no longer touches', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', MARQUEE), async ({ page }) => {
  const note = await screen(page, await midOf(page, 'n-note'));
  await page.mouse.click(note.x, note.y);
  expect(await selection(page)).toEqual(['n-note']);
  // over Title and Intro, then back to Title only: Intro leaves again, the Note stays first
  await pressAndMove(page, { x: 20, y: 20 }, await midOf(page, 'n-intro'), 'Shift');
  expect(await selection(page)).toEqual(['n-note', 'n-title', 'n-intro']);
  const back = await screen(page, await midOf(page, 'n-title'));
  await page.mouse.move(back.x, back.y, { steps: 4 });
  await release(page, 'Shift');
  expect(await selection(page)).toEqual(['n-note', 'n-title']);
  await expect(page.getByRole('status')).toHaveText('2 elements selected.');
});

test('a band pressed in a container takes only what lies in that container, however far the pointer goes', runs('project.open#menu-file', MARQUEE), async ({ page }) => {
  // from Hero's padding down over Plans to the Footer's Note: the band leaves Hero for none of it — Hero's own
  // children are the only candidates (Problems in Pager 3) and the band touches the three of them
  await pressAndMove(page, { x: 20, y: 20 }, { x: 720, y: 500 });
  await release(page);
  expect(await selection(page)).toEqual(['n-title', 'n-intro', 'n-actions']);
});

test('with Alt held the band dives to the leaves: a container only when held entirely, in its descendants\' place', runs('project.open#menu-file', MARQUEE), async ({ page }) => {
  // From the page's own area between Perks and the Footer (the band must be pressed on the page root, never on a
  // child — Plans and the Footer are its neighbours there, nothing else) up over Plans, the full width: with Alt the
  // band keeps the fine rule (Problems in Pager 3): the container held entirely stands in its descendants' place —
  // Plans, not the cards and lists inside it, and not the Perks beneath it.
  const perks = await boxOf(page, 'n-perks');
  const footer = await boxOf(page, 'n-footer');
  const gap = perks.y + perks.h + Math.round((footer.y - (perks.y + perks.h)) / 2);
  // the band must hold Plans entirely — its box spans the page's whole width, so the band does too
  await pressAndMove(page, { x: 0, y: gap }, { x: 1444, y: (await boxOf(page, 'n-plans')).y - 20 }, 'Alt');
  await release(page, 'Alt');
  expect(await selection(page)).toEqual(['n-plans']);
  await expect(page.getByRole('status')).toHaveText('Plans selected.');
});

test('with Ctrl held at the press, the band toggles what it takes in the selection', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', MARQUEE), async ({ page }) => {
  const title = await screen(page, await midOf(page, 'n-title'));
  await page.mouse.click(title.x, title.y);
  expect(await selection(page)).toEqual(['n-title']);
  // over Title and Intro: Title leaves the selection, Intro joins it. The press is in Hero's padding clear of the
  // selected Title's chrome: its rotation handle stands 12 screen px outside its corner, which reaches page (20, 20)
  // at the fit zoom of the 336 px inspector (DEC-66, 0.558)
  await pressAndMove(page, { x: 8, y: 8 }, await midOf(page, 'n-intro'), 'Control');
  await release(page, 'Control');
  expect(await selection(page)).toEqual(['n-intro']);
});

test('a press on a leaf and a drag is never a marquee: no band is drawn and the click\'s selection stays', runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page'), async ({ page }) => {
  await pressAndMove(page, await midOf(page, 'n-intro'), { x: 20, y: 20 });
  await nextFrames(page);
  await expect(page.locator('[data-chrome="band"]')).toHaveCount(0);
  await release(page);
  expect(await selection(page)).toEqual(['n-intro']);
});

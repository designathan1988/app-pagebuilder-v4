// resize-handles beyond its scenarios (spec/BEHAVIOUR.md#resize-handles): the gesture's modifiers, read on every move
// (Shift keeps the aspect ratio of a corner drag, Alt resizes from the centre, so a flow element's width changes by
// twice the travel), whole CSS px, and the handles drawn only where a resize can happen (one selected element, not
// the page, not locked, not several). The document is read through the read-only test port; the handles are the
// chrome's controls of the manifest's resize doors.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { control, openMenu, runDoor, runs, openStyleControl } from './door.ts';

const FIXTURE = 'manifest/features/fixtures/aurora.json';
const interactions = JSON.parse(fs.readFileSync('manifest/interactions.json', 'utf8')) as { constants: { id: string; value: unknown }[] };
const ROOM = interactions.constants.find((c) => c.id === 'resize.handleRoom')?.value as number;
const OPEN = 'project.open#menu-file';
const ROW = 'selection.select#layers-row';
const ADD = 'selection.range#layers-row-shift';
const LOCK = 'element.toggleLock#layers-row-lock';
const SE = 'geometry.resize#handle-resize-se';
const E = 'geometry.resize#handle-resize-e';
const W = 'geometry.resize#handle-resize-w';
const EDGE_E = 'geometry.resize#handle-resize-edge-e';
const MOVE = 'element.moveTo#canvas-drag-canvas-element-before-after';

interface Node {
  readonly id: string;
  readonly styles: Record<string, Record<string, Record<string, string>> | undefined>;
  readonly children: readonly Node[];
}
const nodeIn = (tree: Node, id: string): Node | null => (tree.id === id ? tree : tree.children.map((c) => nodeIn(c, id)).find((n) => n !== null) ?? null);
const declared = async (page: Page, id: string): Promise<Record<string, string>> => {
  const document = (await page.evaluate(() => (window as unknown as Record<string, { document: () => unknown }>).__builderTestPort?.document())) as { pages: { tree: Node }[] };
  const tree = document.pages[0]?.tree;
  return (tree ? nodeIn(tree, id)?.styles.desktop?.base : undefined) ?? {};
};
const drawnBox = (page: Page, id: string) => page.frameLocator('.frame__page').locator(`[data-node="${id}"]`).evaluate((el) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
const zoomOf = (page: Page) => page.locator('.frame__page').evaluate((el) => (el as HTMLIFrameElement).currentCSSZoom);
const handle = (page: Page, ref: string) => page.locator(`[data-canvas-overlay] [data-door="${ref}"]`);

async function dragHandle(page: Page, ref: string, dx: number, dy: number, key: string | null): Promise<void> {
  const box = await handle(page, ref).boundingBox();
  if (box === null) throw new Error(`${ref} is not drawn`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  if (key !== null) await page.keyboard.down(key);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
  if (key !== null) await page.keyboard.up(key);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const chooser = page.waitForEvent('filechooser');
  await runDoor(page, OPEN);
  await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-card-a-title"]')).toHaveCount(1);
});

test('the whole edge resizes: a press on the right edge of the Hero far from its middle handle writes the width, not the padding', runs(OPEN, ROW, EDGE_E), async ({ page }) => {
  // the dogfooding pass: a person narrowing a section took its edge a quarter of the way down, where the right padding
  // band lies, and wrote padding-right; each side's whole length is a grip (resize.edgeGrip) over that band
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  const before = await declared(page, 'n-hero');
  const drawn = await drawnBox(page, 'n-hero');
  const zoom = await zoomOf(page);
  const frame = await page.locator('.frame__page').boundingBox();
  const hero = await page.frameLocator('.frame__page').locator('[data-node="n-hero"]').evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top }; });
  if (frame === null) throw new Error('no frame');
  const x = frame.x + (hero.left + drawn.width) * zoom - 2;
  const y = frame.y + (hero.top + drawn.height * 0.25) * zoom;
  await expect(handle(page, EDGE_E)).toBeVisible();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y, { steps: 10 });
  await page.mouse.up();
  const written = await declared(page, 'n-hero');
  expect(written['padding-right'], 'the padding is untouched').toBe(before['padding-right']);
  expect(Math.abs(parseFloat(written.width ?? '0') - Math.round(drawn.width - 150 / zoom)), 'the width follows the edge').toBeLessThanOrEqual(1);
});

test('Shift keeps the ratio of a corner drag, in whole px', runs(OPEN, ROW, SE), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  // the corner handle needs room (spec resize-handles, resize.handleRoom: the top and bottom where the element is
  // tall enough on the screen) and must stand inside the canvas: at 100% and 600 px wide it has both
  await openMenu(page, 'zoom');
  await control(page, 'view.zoomTo#menu-zoom-100').click();
  for (const [property, value] of [['width', '600px'], ['height', '60px']] as const) {
    const field = control(page, `style.set#inspector-${property}`).locator('input').first();
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`${value.replace('px', '')}\n`);
  }
  const before = await drawnBox(page, 'n-title');
  const zoom = await zoomOf(page);
  await dragHandle(page, SE, -200 * zoom, 30 * zoom, 'Shift');
  const written = await declared(page, 'n-title');
  expect(written.width, 'a whole px width').toMatch(/^\d+px$/);
  expect(written.height, 'a whole px height').toMatch(/^\d+px$/);
  const width = parseFloat(written.width ?? '0');
  const height = parseFloat(written.height ?? '0');
  // the ratio kept to the nearest px, and the travel's larger side followed: the height grew
  expect(Math.abs(width / height - before.width / before.height)).toBeLessThan(before.width / before.height / Math.min(width, height) + 0.01);
  expect(height).toBeGreaterThan(before.height);
});

test('Alt resizes from the centre: a flow element\'s width changes by twice the travel', runs(OPEN, ROW, W), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  const before = await drawnBox(page, 'n-title');
  const zoom = await zoomOf(page);
  await dragHandle(page, W, 100 * zoom, 0, 'Alt');
  const written = await declared(page, 'n-title');
  expect(Math.abs(parseFloat(written.width ?? '0') - (before.width - 200))).toBeLessThanOrEqual(1);
  expect(written.height, 'a side handle writes no height').toBeUndefined();
});

test('a handle clicked without a drag clicks what lies under it: the Hero around its Title is selected, nothing resized', runs(OPEN, ROW, E), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  // the east handle: the one a short element draws (the north and south ones want its height, resize.handleRoom)
  const box = await handle(page, E).boundingBox();
  if (box === null) throw new Error('the east handle is not drawn');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => page.evaluate(() => (window as unknown as Record<string, { selection: () => string[] }>).__builderTestPort?.selection())).toEqual(['n-hero']);
  expect(await declared(page, 'n-title'), 'the Title keeps its size').toEqual({});
});

// A handle is drawn only where it has room (spec resize-handles, resize.handleRoom; the user's real use: a link 23 x
// 10 screen px was all handles, and a press on it resized it instead of dragging it). On a short element (the Intro,
// about 10 screen px high at the fit zoom) the top and bottom handles are not drawn at all, and a press inside it
// moves it and never resizes it.
test('a short selected element draws no top or bottom handle, and a press inside it moves it: it never resizes it', runs(OPEN, ROW, MOVE), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-intro' } }).click();
  const screen = (id: string) =>
    page.evaluate((node) => {
      const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
      const el = iframe?.contentDocument?.querySelector(`[data-node="${node}"]`);
      if (!iframe || !el) throw new Error(`the canvas does not draw ${node}`);
      const zoom = iframe.currentCSSZoom;
      const frame = iframe.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, width: r.width * zoom, height: r.height * zoom };
    }, id);
  const intro = await screen('n-intro');
  expect(intro.height, 'the Intro is shorter than the room a handle wants').toBeLessThan(ROOM);
  for (const side of ['n', 's']) await expect(handle(page, `geometry.resize#handle-resize-${side}`), `${side}: no room, no handle`).toHaveCount(0);
  // the press lands 2 px above its bottom edge, where the south handle's dot would have been
  const at = { x: intro.x + intro.width / 2, y: intro.y + intro.height - 2 };
  const title = await screen('n-title');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, title.y + title.height / 2 - 1, { steps: 8 });
  await page.mouse.up();
  const moved = (await page.evaluate(() => (window as unknown as Record<string, { document: () => unknown }>).__builderTestPort?.document())) as { pages: { tree: Node }[] };
  const hero = moved.pages[0] ? nodeIn(moved.pages[0].tree, 'n-hero') : null;
  expect(hero?.children.map((c) => c.id), 'the Intro moved before the Title').toEqual(['n-intro', 'n-title', 'n-actions']);
  expect(await declared(page, 'n-intro'), 'the Intro keeps its size').toEqual({});
});

test('no handle is drawn on the page, on a locked element or on several elements', runs(OPEN, ROW, ADD, LOCK), async ({ page }) => {
  // the east handle: the one the short Title draws at the fit zoom (resize.handleRoom)
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  await expect(handle(page, E), 'one element: its handles').toHaveCount(1);
  const where = await handle(page, E).boundingBox();
  if (where === null) throw new Error('the east handle is not laid out');
  await control(page, ROW, { args: { target: 'n-page' } }).click();
  await expect(handle(page, E), 'the page: none').toHaveCount(0);
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  await control(page, ROW, { args: { target: 'n-intro' } }).click({ modifiers: ['Shift'] });
  await expect(handle(page, E), 'several elements: none').toHaveCount(0);
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  await control(page, LOCK, { args: { target: 'n-title' } }).click();
  await expect(handle(page, E), 'a locked element: none').toHaveCount(0);
  // and nothing resizes it (the audit's AUD-35: no handle drawn alone): a drag from where its handle stood leaves the
  // document as it was
  const before = await page.evaluate(() => JSON.stringify((window as unknown as Record<string, { document: () => unknown }>).__builderTestPort?.document()));
  await page.mouse.move(where.x + where.width / 2, where.y + where.height / 2);
  await page.mouse.down();
  await page.mouse.move(where.x + where.width / 2 + 60, where.y + where.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => JSON.stringify((window as unknown as Record<string, { document: () => unknown }>).__builderTestPort?.document())), 'the locked Title keeps its size').toBe(before);
});

// A3.8: every style door writes where the style target is — the Quick Panel, the Style tab, the Edit-on-canvas modes and
// the canvas handles alike. With a class as the target, a handle's drag lands in the class's styles at the state and
// breakpoint the editor edits, never on the element.
test('a handle writes into the class the style target names, at the state and breakpoint in view', runs(OPEN, ROW, 'inspector.setStyleTarget#inspector-class-bar-target', 'view.setStyleState#menu-style-state-hover', 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet', E), async ({ page }) => {
  await runDoor(page, ROW, { args: { target: 'n-card-a' } });
  // the class of the element becomes the target (its chip in the selector bar)
  const chip = page.locator('[data-door="inspector.setStyleTarget#inspector-class-bar-target"][data-args*="card"]').first();
  await expect(chip).toHaveCount(1);
  await chip.click();
  await expect(chip).toHaveClass(/is-current/);
  // the state and the breakpoint the editor edits
  await page.locator('.state-picker').first().click({ force: true });
  await page.locator('[data-door="view.setStyleState#menu-style-state-hover"]').click();
  await runDoor(page, 'view.setBreakpoint#toolbar-breakpoint-tabs-tablet');
  // the Quick Panel and the canvas label say the same context the write lands in (A3.8)
  await page.locator('[data-quick-panel-chip][aria-expanded="false"]').click();
  await expect(page.locator('.quick-panel__context')).toHaveText('.card · Hover · Tablet');
  await expect(page.locator('[data-chrome="label"] .chrome__target')).toHaveText('.card');
  // the state as its selector writes it (the canonical "· :hover" on the label)
  await expect(page.locator('[data-chrome="label"] .chrome__state')).toHaveText(':hover');
  await expect(page.locator('[data-chrome="label"] .chrome__breakpoint')).toHaveText('Tablet');
  await page.locator('[data-quick-panel-chip][aria-expanded="true"]').click();
  await dragHandle(page, E, 40, 0, null);
  // the class holds the width, at Tablet and Hover; the element's own styles stay as they were
  await expect.poll(async () => page.evaluate(() => {
    const port = (window as unknown as { __builderTestPort: { document: () => { classes?: { name: string; styles?: Record<string, Record<string, Record<string, unknown>>> }[] } } }).__builderTestPort;
    return port.document().classes?.find((c) => c.name === 'card')?.styles?.tablet?.hover?.width ?? null;
  })).not.toBeNull();
  const element = await declared(page, 'n-card-a');
  expect(element.width, 'the element itself keeps no width').toBeUndefined();
});

// (the user's real-use audit, items 4.2 and A3.16). The document is read through the port; the handles and the label
// through the chrome.
const NW = 'geometry.resize#handle-resize-nw';
const N = 'geometry.resize#handle-resize-n';
const S = 'geometry.resize#handle-resize-s';
const INSERT = 'element.insert#elements-tile';
const INSERT_PANEL = 'workspace.setPanelOpen#toolbar-activity-bar-insert';
const DISPLAY = 'style.set#inspector-display';
const COLUMNS = 'style.set#inspector-grid-template-columns';
const WIDTH = 'style.set#inspector-width';

async function typeField(page: Page, ref: string, text: string): Promise<void> {
  // a field in a concept row's details is reached by opening the row (spec inspector-panel, item 4a)
  await openStyleControl(page, ref);
  const input = control(page, ref).locator('input').first();
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
}
// the box of a locator, or null
const boxOf = async (locator: ReturnType<typeof handle>) => locator.boundingBox();
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// A3.16: an image keeps its own ratio while it is resized, and Shift releases it
test('an image keeps its ratio through a corner drag, and Shift releases it', runs(OPEN, INSERT_PANEL, INSERT, WIDTH, SE), async ({ page }) => {
  await runDoor(page, INSERT_PANEL);
  await runDoor(page, INSERT, { args: { entry: 'image' } });
  await expect.poll(async () => page.evaluate(() => (window as unknown as Record<string, { selection: () => string[] }>).__builderTestPort?.selection().length)).toBe(1);
  const id = await page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection()[0] as string);
  await typeField(page, WIDTH, '200');
  await typeField(page, 'style.set#inspector-height', '100');
  expect(await declared(page, id), 'the image is 200 x 100').toMatchObject({ width: '200px', height: '100px' });
  const zoom = await zoomOf(page);
  const before = await drawnBox(page, id);
  const ratio = before.width / before.height;
  // the corner drag pulls the width: the image keeps its ratio, so the height follows it
  await dragHandle(page, SE, 100 * zoom, 0, null);
  const kept = await drawnBox(page, id);
  expect(kept.width, 'it grew').toBeGreaterThan(before.width + 50);
  expect(Math.abs(kept.height - kept.width / ratio), "the height follows the width at the image ratio").toBeLessThan(3);
  // Shift releases the ratio: the width stays and the height takes the travel
  await dragHandle(page, SE, 0, 40 * zoom, 'Shift');
  const released = await drawnBox(page, id);
  expect(Math.abs(released.width - kept.width), 'Shift keeps the width the pointer did not move').toBeLessThan(1.5);
  expect(released.height - kept.height, 'and takes the height it did').toBeGreaterThan(30);
});

// A3.16: where the parent lays the element out (a grid), the handles that move a start edge are drawn disabled with
// their reason, and a press on one belongs to what lies under it
test('in a grid the north and west handles are drawn disabled, with the reason', runs(OPEN, ROW, DISPLAY, COLUMNS, WIDTH, W, N, NW, E), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-grid' } }).click();
  await typeField(page, DISPLAY, 'grid');
  await typeField(page, COLUMNS, 'repeat(3, 1fr)');
  await control(page, ROW, { args: { target: 'n-card-a' } }).click();
  // a card is shorter than the room a top or bottom handle asks for (resize.handleRoom): given a height, they are drawn
  await typeField(page, 'style.set#inspector-height', '120');
  for (const ref of [W, N, NW]) {
    await expect(handle(page, ref), `${ref} is drawn`).toHaveCount(1);
    await expect(handle(page, ref), `${ref} says why`).toHaveAttribute('aria-disabled', 'true');
    await expect(handle(page, ref)).toHaveAttribute('title', 'Resize — the parent places this element');
  }
  for (const ref of [E, S, SE]) await expect(handle(page, ref), `${ref} still resizes the box`).not.toHaveAttribute('aria-disabled', 'true');
  // a press on the disabled west handle starts no resize: the card keeps every declaration
  const before = await declared(page, 'n-card-a');
  const box = await boxOf(handle(page, W));
  if (box === null) throw new Error('the west handle is not laid out');
  const zoom = await zoomOf(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60 * zoom, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await declared(page, 'n-card-a'), 'the disabled handle writes nothing').toEqual(before);
});

// item 4.2: the label carries the element's own size, live while a drag goes on
test('the label shows the live size while a resize goes on', runs(OPEN, ROW, SE), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  const chip = page.locator('[data-chrome="label"] [data-chrome="label-size"]');
  await expect(chip).toBeVisible();
  const box = await handle(page, 'geometry.resize#handle-resize-e').boundingBox();
  if (box === null) throw new Error('the east handle is not drawn');
  const zoom = await zoomOf(page);
  const before = await chip.textContent();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120 * zoom, box.y + box.height / 2, { steps: 8 });
  const during = await chip.textContent();
  await page.mouse.up();
  expect(during, 'the chip follows the drag').not.toBe(before);
  expect(await chip.textContent(), 'and keeps the size it ends with').toBe(during);
});

// A3.16: a handle the label lies over can still be taken. The label has one place (the user's rule of 2026-10-05,
// DEC-70: above its element, touching its frame, at its left edge), so over a narrow element it lies over the handles
// of the top edge; the handles are drawn over it, and a press at a handle's centre reaches the handle.
test('every handle the selection label lies over is drawn over it and takes its press', runs(OPEN, ROW), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-title' } }).click();
  // a narrow element: its label is wider than it is, so the label's box reaches over the handles on its top edge
  await typeField(page, WIDTH, '120');
  await typeField(page, 'style.set#inspector-height', '90');
  const label = await page.locator('[data-chrome="label"]').boundingBox();
  if (label === null) throw new Error('the label is not laid out');
  const handles = await page.locator('[data-canvas-overlay] [data-resize-handle]:not([data-chrome="edge"])').all();
  expect(handles.length, 'the handles are drawn').toBeGreaterThan(0);
  let under = 0;
  for (const drawn of handles) {
    const box = await drawn.boundingBox();
    if (box === null || !overlaps(label, box)) continue;
    under += 1;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const reached = await drawn.evaluate((element, at) => document.elementFromPoint(at.x, at.y) === element, centre);
    expect(reached, `the ${await drawn.getAttribute('data-resize-handle')} handle takes the press at its centre`).toBe(true);
  }
  expect(under, 'the narrow element’s label lies over a handle of its top edge').toBeGreaterThan(0);
});

// The user's real-use audit: the chrome clips its drawing to the canvas, and an element at the page's edge (a section)
// keeps half of its east handle past the overlay, over the stage. The handle's whole box is its target: a press at the
// middle of it — what a person aims at — resizes, and never clears the selection (the stage's own press), at any zoom.
test('the east handle of a full-width element resizes from its whole box, even where the stage lies under it', runs(OPEN, ROW, E), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  const box = await boxOf(handle(page, E));
  if (box === null) throw new Error('the east handle is not drawn');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // the premise: at its centre the drawn handle is clipped away and the stage lies under the pointer
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute('data-canvas-stage') ?? false, centre), 'the stage lies under the handle centre').toBe(true);
  const zoom = await zoomOf(page);
  const before = await declared(page, 'n-hero');
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - 120 * zoom, centre.y, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as Record<string, { selection: () => string[] }>).__builderTestPort?.selection()), 'the element stays selected').toEqual(['n-hero']);
  const after = await declared(page, 'n-hero');
  expect(Number.parseFloat(after.width ?? '0'), 'the handle wrote a width').toBeLessThan(Number.parseFloat(before.width ?? '1440px'));
});

// The canvas audit of 2026-09-28: with a card selected, its south handle's hit area stood wholly over the card drawn
// right below it (23 screen px tall at the fit zoom), so a press meant to drag that card resized the one above. The
// hit area now keeps out of a neighbouring element's box — the unused room moves inside the selected element, and the
// dot stays on its edge — so the card below keeps every press, and the edge still resizes from just inside it.
test('the south handle of a selected card never covers the card below: that card keeps its press, and the edge still resizes', runs(OPEN, ROW, S, MOVE), async ({ page }) => {
  const screen = (id: string) =>
    page.evaluate((node) => {
      const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
      const el = iframe?.contentDocument?.querySelector(`[data-node="${node}"]`);
      if (!iframe || !el) throw new Error(`the canvas does not draw ${node}`);
      const zoom = iframe.currentCSSZoom;
      const frame = iframe.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: frame.left + r.left * zoom, y: frame.top + r.top * zoom, width: r.width * zoom, height: r.height * zoom };
    }, id);
  await control(page, ROW, { args: { target: 'n-card-b' } }).click();
  await typeField(page, 'style.set#inspector-height', '180px');
  const cardC = await screen('n-card-c');
  const below = await boxOf(handle(page, S));
  if (below === null) throw new Error('the south handle is not drawn');
  expect(overlaps(below, cardC), 'the handle’s hit area covers no part of the card below').toBe(false);
  // a press on the card below its edge drags that card (it lands in the Footer)
  const footer = await screen('n-footer');
  await page.mouse.move(cardC.x + cardC.width / 2, cardC.y + cardC.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardC.x + cardC.width / 2 + 6, cardC.y + cardC.height / 2 + 6, { steps: 3 });
  await page.mouse.move(footer.x + footer.width / 2, footer.y + footer.height / 2, { steps: 12 });
  await page.mouse.up();
  const moved = (await page.evaluate(() => (window as unknown as Record<string, { document: () => unknown }>).__builderTestPort?.document())) as { pages: { tree: Node }[] };
  const footerNow = moved.pages[0] ? nodeIn(moved.pages[0].tree, 'n-footer') : null;
  expect(footerNow?.children.map((c) => c.id), 'the card below moved, it did not resize the card above').toContain('n-card-c');
  await page.keyboard.press('Control+z');
  await expect(page.frameLocator('.frame__page').locator('[data-node="n-grid"] > [data-node]'), 'the undo puts the card below back in the grid').toHaveCount(3);
  // the handle still resizes: pressed just inside the selected card's own bottom edge, where it now sits
  await control(page, ROW, { args: { target: 'n-card-b' } }).click();
  const cardB = await screen('n-card-b');
  const zoom = await zoomOf(page);
  const before = Number.parseFloat((await declared(page, 'n-card-b')).height ?? '0');
  await page.mouse.move(cardB.x + cardB.width / 2, cardB.y + cardB.height - 4);
  await page.mouse.down();
  await page.mouse.move(cardB.x + cardB.width / 2, cardB.y + cardB.height - 4 + 30 * zoom, { steps: 10 });
  await page.mouse.up();
  expect(Number.parseFloat((await declared(page, 'n-card-b')).height ?? '0'), 'the south edge resized from inside').toBeGreaterThan(before);
});

// The user's real-use audit: at 100 % a 1440 px page is wider than the canvas, and the overlay reaches under the
// panels. The label keeps its one place at its element's start (DEC-70), never moved inside the canvas: where that
// place lies out of the canvas the label is out of sight, never drawn over the panels.
test('the selection label keeps its place at its element when the page is wider than the canvas, out of sight there', runs(OPEN, ROW, 'view.zoomTo#menu-zoom-100'), async ({ page }) => {
  await control(page, ROW, { args: { target: 'n-hero' } }).click();
  await openMenu(page, 'zoom');
  await control(page, 'view.zoomTo#menu-zoom-100').click();
  const label = page.locator('[data-chrome="label"]');
  const frame = await page.locator('[data-chrome="selection"]').boundingBox();
  const stage = await page.locator('[data-canvas-stage]').boundingBox();
  if (frame === null || stage === null) throw new Error('the selection or the stage is not laid out');
  expect(frame.x, 'the premise: the hero starts left of the canvas').toBeLessThan(stage.x);
  await expect.poll(async () => Math.round(((await label.boundingBox())?.x ?? 0) - frame.x), 'the label starts at the frame line').toBe(-2);
  await expect(label, 'out of sight, not over the panels').toHaveCSS('visibility', 'hidden');
});

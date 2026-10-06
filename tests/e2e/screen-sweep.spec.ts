// The editor's screens under the conditions a person meets them (DEC-74; the root-cause study of 2026-10-06, CR2): the
// suite's scenarios run in English at 1440 x 900 in the dark theme, where the audits found a third to a half of their
// cut texts and overlaps only in Portuguese, at 1280 x 720 (a requirement: P3, J25) or in the light theme. Each surface
// a person opens — the menus and their submenus, the sidebar's views, the docks, the command bar, the dialogs, the
// breakpoints and zoom levels, the inspector's tabs and the quick panel of each kind of element, a text edited in place
// — is checked by the screen guard (tests/support/screen-guard.ts) in six combinations that hold every pair of window
// (1280, 1440, 1920), language (en, pt-BR), theme (dark, light) and project (empty, the canonical page): a pairwise
// covering array, so a defect that needs two conditions together is met without running all 24.
import fs from 'node:fs';
import { expect, test, type Page, type TestInfo } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { guardScreen } from '../support/screen-guard.ts';
import { control, openMenu, openQuickPanel, runDoor } from './door.ts';

interface Condition {
  readonly width: number;
  readonly height: number;
  readonly language: 'en' | 'pt-BR';
  readonly theme: 'dark' | 'light';
  readonly project: 'empty' | 'canonical';
}
const WINDOWS = { 1280: 720, 1440: 900, 1920: 1080 } as const;
// every pair of two conditions' values appears in one row at least
const CONDITIONS: readonly Condition[] = (
  [
    [1280, 'en', 'dark', 'empty'],
    [1280, 'pt-BR', 'light', 'canonical'],
    [1440, 'en', 'light', 'canonical'],
    [1440, 'pt-BR', 'dark', 'empty'],
    [1920, 'en', 'dark', 'canonical'],
    [1920, 'pt-BR', 'light', 'empty'],
  ] as const
).map(([width, language, theme, project]) => ({ width, height: WINDOWS[width], language, theme, project }));

const CANONICAL = 'manifest/features/fixtures/canonical.json';
// one element of each kind of the canonical page
const CANONICAL_KINDS: Readonly<Record<string, string>> = { header: 'c-header', paragraph: 'c-logo', navigation: 'c-nav', link: 'c-nav-0', section: 'c-hero', heading: 'c-title', image: 'c-hero-image', article: 'c-card-subscription', container: 'c-grid' };
// the kinds the empty project gets, inserted from the palette as a person inserts them
const INSERTED = ['container', 'heading', 'paragraph', 'button', 'image', 'link', 'blockquote', 'input-text', 'select', 'table'];
const MENUS = ['file', 'edit', 'arrange', 'view', 'help'];
const VIEWS = ['insert', 'explorer', 'styles', 'data', 'assistant'];
const DOCKS = ['timeline', 'motion', 'checks'];
const DIALOGS = ['workspace.openDialog#menu-view-breakpoints', 'workspace.openDialog#menu-view-guides-grids', 'workspace.openDialog#menu-file-capture-url', 'workspace.openDialog#menu-snap-snap-settings'];
const BREAKPOINTS = ['laptop', 'tablet', 'phone', 'desktop'];
const ZOOMS = [25, 200, 100];
const TABS = ['style', 'settings', 'interactions'];

const frames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const selection = (page: Page) => page.evaluate(() => (window as unknown as { __builderTestPort: { selection: () => string[] } }).__builderTestPort.selection());

// the screen as it stands, checked by the guard under the step's name
async function check(page: Page, info: TestInfo, step: string): Promise<void> {
  await frames(page);
  expect(await guardScreen(page, info, step), `the screen at ${step}`).toEqual([]);
}
async function closeAll(page: Page): Promise<void> {
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
}

// the editor under a condition, and the elements a sweep selects (by kind)
async function setUp(page: Page, c: Condition): Promise<Record<string, string>> {
  await page.setViewportSize({ width: c.width, height: c.height });
  await openEditor(page);
  const ids: Record<string, string> = {};
  if (c.project === 'canonical') {
    const chooser = page.waitForEvent('filechooser');
    await runDoor(page, 'project.open#menu-file');
    await (await chooser).setFiles({ name: 'canonical.json', mimeType: 'application/json', buffer: fs.readFileSync(CANONICAL) });
    await expect(page.frameLocator('.frame__page').locator('[data-node="c-title"]')).toHaveCount(1);
    Object.assign(ids, CANONICAL_KINDS);
  } else {
    for (const entry of INSERTED) {
      await closeAll(page);
      await runDoor(page, 'workspace.setPanelOpen#toolbar-activity-bar-insert');
      const tile = control(page, 'element.insert#elements-tile', { args: { entry } }).first();
      await tile.scrollIntoViewIfNeeded();
      await tile.click();
      await expect.poll(() => selection(page)).toHaveLength(1);
      ids[entry] = (await selection(page))[0] as string;
    }
    await closeAll(page);
  }
  if (c.theme === 'light') await runDoor(page, 'preferences.setTheme#menu-theme-light');
  if (c.language === 'pt-BR') await runDoor(page, 'preferences.setLanguage#menu-language-pt-br');
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(c.language);
  await closeAll(page);
  return ids;
}

// Below the narrow window's width the sidebar opens over the canvas and the dock (src/editor/workspace/narrow.ts): a
// person puts it away (Ctrl+B) to reach what it lies over
async function sidebarAway(page: Page, ref: string): Promise<void> {
  const target = page.locator(`[data-door="${ref}"]`).first();
  if (!(await target.isVisible())) return;
  const covered = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit !== null && !el.contains(hit) && hit.closest('.sidebar') !== null;
  });
  if (covered) await runDoor(page, 'workspace.toggleLeftDock#key-ctrl-b-in-global');
}

// where an element of the page stands on screen: its box in the canvas's frame, scaled by the frame's zoom
async function canvasCentre(page: Page, id: string): Promise<{ readonly x: number; readonly y: number }> {
  const at = await page.evaluate((node) => {
    const frame = document.querySelector<HTMLIFrameElement>('.frame__page');
    const el = frame?.contentDocument?.querySelector(`[data-node="${node}"]`);
    if (!frame || !el) return null;
    const r = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const zoom = frame.currentCSSZoom;
    return { x: f.x + (r.x + r.width / 2) * zoom, y: f.y + (r.y + r.height / 2) * zoom };
  }, id);
  if (at === null) throw new Error(`no element ${id} on the canvas`);
  return at;
}

// an element of the page brought into the canvas's view with the wheel, as a person scrolls to it (a selection made in
// the Layers never moves the canvas: AU6-01), and its centre on screen
async function inView(page: Page, id: string): Promise<{ readonly x: number; readonly y: number }> {
  const view = await page.locator('.frame__view').boundingBox();
  if (view === null) throw new Error('no canvas view');
  for (let i = 0; i < 20; i += 1) {
    await frames(page);
    const at = await canvasCentre(page, id);
    const inside = at.y > view.y + 4 && at.y < view.y + view.height - 4;
    const off = inside ? 0 : at.y - (view.y + view.height / 2);
    if (off === 0) return at;
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
    await page.mouse.wheel(0, off);
  }
  throw new Error(`${id}: the wheel did not bring it into the canvas's view`);
}

// an element selected through its Layers row, the Explorer opened first where it is closed
async function select(page: Page, id: string): Promise<void> {
  const row = control(page, 'selection.select#layers-row', { args: { target: id } }).first();
  if (!(await row.isVisible())) await runDoor(page, 'workspace.setPanelOpen#toolbar-activity-bar-explorer');
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect.poll(() => selection(page)).toEqual([id]);
}

for (const c of CONDITIONS) {
  const name = `${c.width}, ${c.language}, ${c.theme}, ${c.project} project`;
  test.describe(name, () => {
    test('the menus and their submenus', async ({ page }, info) => {
      await setUp(page, c);
      for (const menu of MENUS) {
        await openMenu(page, menu);
        await check(page, info, `menu ${menu}`);
        const subs = page.locator('[role="menu"] [aria-haspopup="menu"]');
        for (let i = 0; i < (await subs.count()); i += 1) {
          await subs.nth(i).hover();
          await check(page, info, `menu ${menu} submenu ${i + 1}`);
        }
        await closeAll(page);
      }
    });

    test('the sidebar views, the docks and the command bar', async ({ page }, info) => {
      await setUp(page, c);
      for (const view of VIEWS) {
        await runDoor(page, `workspace.setPanelOpen#toolbar-activity-bar-${view}`);
        await check(page, info, `view ${view}`);
      }
      await closeAll(page);
      for (const dock of DOCKS) {
        await sidebarAway(page, `workspace.setPanelOpen#dock-strip-${dock}`);
        const strip = page.locator(`[data-door="workspace.setPanelOpen#dock-strip-${dock}"]`).first();
        if (await strip.isVisible()) await strip.click();
        else await control(page, 'workspace.setActiveTab#tab-strip-tab', { args: { panel: dock } }).first().click();
        await check(page, info, `dock ${dock}`);
      }
      await runDoor(page, 'commandBar.open#toolbar-top-bar-search');
      await check(page, info, 'command bar');
      await page.keyboard.type(c.language === 'en' ? 'card' : 'cart');
      await check(page, info, 'command bar, typed');
      await closeAll(page);
    });

    test('the dialogs', async ({ page }, info) => {
      await setUp(page, c);
      for (const ref of DIALOGS) {
        await runDoor(page, ref);
        await expect(page.locator('[role="dialog"][aria-modal="true"]').last()).toBeVisible();
        await check(page, info, `dialog ${ref.split('#')[1] ?? ref}`);
        await closeAll(page);
      }
    });

    test('the breakpoints and the zoom levels', async ({ page }, info) => {
      const ids = await setUp(page, c);
      const first = Object.values(ids)[0];
      if (first !== undefined) await select(page, first);
      for (const breakpoint of BREAKPOINTS) {
        await runDoor(page, `view.setBreakpoint#toolbar-breakpoint-tabs-${breakpoint}`);
        await check(page, info, `breakpoint ${breakpoint}`);
      }
      for (const zoom of ZOOMS) {
        await runDoor(page, `view.zoomTo#menu-zoom-${zoom}`);
        await check(page, info, `zoom ${zoom}`);
      }
    });

    test("each kind of element's inspector tabs and quick panel, and a text edited in place", async ({ page }, info) => {
      const ids = await setUp(page, c);
      for (const [kind, id] of Object.entries(ids)) {
        await select(page, id);
        for (const tab of TABS) {
          await runDoor(page, `workspace.setActiveTab#inspector-tab-${tab}`);
          await check(page, info, `${kind}: ${tab}`);
        }
        await openQuickPanel(page);
        await check(page, info, `${kind}: quick panel`);
        // closed through its own control: its open state stays across selections, and an open panel beside the next
        // label lies over that element
        await page.locator('[data-quick-panel-chip][aria-expanded="true"]').click();
        await expect(page.locator('[data-quick-panel-chip][aria-expanded="true"]')).toHaveCount(0);
      }
      const heading = ids.heading;
      if (heading !== undefined) {
        await select(page, heading);
        // a click on the text in the canvas (its selection and the canvas's focus), then Enter, as a person starts editing
        const at = await inView(page, heading);
        await page.mouse.click(at.x, at.y);
        await expect.poll(() => selection(page)).toEqual([heading]);
        await page.keyboard.press('Enter');
        // the text edited in place (its toolbar stands above the label, out of sight for a text at the page's top: DEC-70)
        await expect(page.frameLocator('.frame__page').locator(`[data-node="${heading}"]`)).toHaveAttribute('contenteditable', 'plaintext-only');
        await check(page, info, 'heading: text edited in place');
        await closeAll(page);
      }
    });
  });
}

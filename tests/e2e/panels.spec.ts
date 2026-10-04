// A door whose only effect is to open a panel without its content is disabled with "not available yet" (AGENTS.md;
// the user's decision 2 as the user corrected it): Help › Keyboard shortcuts and View › Checks. The doors of the panels
// that exist (the sidebar's Explorer with Layers, Insert and Styles, the inspector, the dock with its Timeline, the
// canvas tools) stay enabled while their feature is registered, and wait with "not available yet" until it is (the door
// rule, the user's order of 2026-09-26, item 3: View › Explorer and View › Timeline wait for explorer-pages and
// timeline-animations).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { isFeatureBuilt } from '../../src/app/features.ts';
import type { FeatureId } from '../../src/generated/ids.ts';

// every panel of the window is drawn with content now: a panel that waits behind an unbuilt feature is drawn disabled
// by the unit test, and no door opens an empty panel
const EMPTY: readonly string[] = [];
const BUILT = ['explorer', 'elements', 'variables', 'layers', 'inspector', 'workbench', 'timeline', 'canvas-tools'];

interface Door {
  id: string;
  kind: string;
  feature: string;
  menu?: string;
  args: Record<string, unknown>;
}
const panelDoors: { ref: string; kind: string; menu: string | null; panel: string; feature: string }[] = [];
for (const file of fs.readdirSync('manifest/commands')) {
  const { commands } = JSON.parse(fs.readFileSync(path.join('manifest/commands', file), 'utf8')) as { commands: { id: string; entryPoints: Door[] }[] };
  for (const c of commands) {
    if (c.id !== 'workspace.setPanelOpen') continue;
    for (const d of c.entryPoints) {
      if (typeof d.args.panel === 'string' && d.args.open !== 'close' && (d.kind === 'menu' || d.kind === 'toolbar')) panelDoors.push({ ref: `${c.id}#${d.id}`, kind: d.kind, menu: d.menu ?? null, panel: d.args.panel, feature: d.feature });
    }
  }
}
const MENU_BUTTONS: Record<string, string> = { view: 'View', help: 'Help' };

async function control(page: Page, door: (typeof panelDoors)[number]) {
  if (door.menu !== null) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: MENU_BUTTONS[door.menu] ?? door.menu, exact: true }).click();
  }
  return page.locator(`[data-door="${door.ref}"]`);
}

// what a door could change: every region of the window and where it lies, the stored preferences, and the document,
// the selection and the history (read through the read-only test port)
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Record<string, { document: () => unknown; selection: () => unknown; history: () => unknown }>).__builderTestPort;
    if (!p) throw new Error('the test port is missing');
    return {
      document: p.document(),
      selection: p.selection(),
      history: p.history(),
      regions: [...document.querySelectorAll('[data-region]')].map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.getAttribute('data-region')} ${r.x} ${r.y} ${r.width} ${r.height}`;
      }),
      // the columns of the window, which carry no region of their own
      columns: ['.sidebar', '.centre', '.inspector', '.workbench'].map((selector) => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return r === undefined ? `${selector} absent` : `${selector} ${r.x} ${r.y} ${r.width} ${r.height}`;
      }),
      stored: window.localStorage.getItem('preferences'),
    };
  });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
});

test('every panel door opens a panel that has content', async ({ page }) => {
  // The two panels this test named before — Help › Keyboard shortcuts and View › Checks — were built since, so no door
  // is left opening a panel without content. The other half of the rule, a door waiting for an unbuilt feature, is
  // proven where it can be planted: src/editor/doors/door.test.tsx draws such a door disabled, changing nothing.
  const empty = panelDoors.filter((d) => EMPTY.includes(d.panel));
  expect(empty, 'no panel door is left without content').toEqual([]);
  const shortcuts = panelDoors.find((d) => d.panel === 'shortcuts');
  if (shortcuts === undefined) throw new Error('no door opens the keyboard shortcuts panel');
  const button = await control(page, shortcuts);
  await expect(button, shortcuts.ref).not.toHaveAttribute('aria-disabled', 'true');
  await button.click();
  // the panel it opens is drawn: a region of it appears (the panel docks into the dock area)
  await expect.poll(async () => (await snapshot(page)).regions.length, { message: 'the shortcuts panel opens' }).toBeGreaterThan(1);
});

test('the doors of the panels that exist are enabled exactly while their feature is registered', async ({ page }) => {
  const built = panelDoors.filter((d) => BUILT.includes(d.panel));
  expect(built.length).toBeGreaterThan(8);
  // every panel of the window is built now, so every one of their doors is enabled; a door left waiting for its
  // feature is drawn disabled by the unit test src/editor/doors/door.test.tsx, which plants an unregistered feature
  for (const door of built) {
    const enabled = isFeatureBuilt(door.feature as FeatureId);
    const button = await control(page, door);
    if (enabled) await expect(button, door.ref).not.toHaveAttribute('aria-disabled', 'true');
    else {
      await expect(button, door.ref).toHaveAttribute('aria-disabled', 'true');
      await expect(button, door.ref).toHaveAttribute('title', /not available yet/);
    }
  }
});

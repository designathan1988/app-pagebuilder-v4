// How a test runs a door of the manifest with the real mouse and keyboard, and how it names the doors it runs: one
// annotation "door" per door, so that a census of the tests can find a door no test runs.
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestDetails } from '@playwright/test';
import { withFunction } from '../../src/core/style/functions.ts';
import { styleSections, type StyleDoor } from '../../src/manifest/style-places.ts';
import { expect } from '../support/test.ts';

export interface Door {
  readonly id: string;
  readonly kind: string;
  readonly feature: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly menu?: string;
  readonly chord?: string;
  readonly context?: string;
  // canvas-click: what is clicked, with which button, how many times and which key held
  readonly target?: string;
  readonly button?: string;
  readonly count?: number;
  readonly modifier?: string | null;
  // canvas-drag and layers-drag: what is pressed and where it is released
  readonly source?: string;
  readonly zone?: string;
  readonly gesture?: string | null;
  // canvas-handle: the handle it is drawn as
  readonly handle?: string;
  // panel-control: the panel and the control it is drawn as
  readonly panel?: string;
  readonly control?: string;
  // toolbar and panel-control: the drawing (an "area" is part of a larger surface, such as a backdrop)
  readonly drawnAs?: string;
  // inspector-field: the property, composite or recipe it edits (the Style tab's section is read from it)
  readonly property?: string | null;
  readonly composite?: string | null;
  readonly recipe?: string | null;
  // where the door is drawn: the region, and the place in it
  readonly placement?: { readonly region: string; readonly order: number } | string;
  // command-bar: the kind of entry it gives, and its label (with placeholders: "Insert {element}")
  readonly entry?: string;
  readonly labelKey?: string;
}
interface Menu {
  readonly id: string;
  readonly labelKey: string;
  readonly anchors: readonly { readonly region: string }[];
}

export const DOORS = new Map<string, Door>();
for (const file of fs.readdirSync('manifest/commands')) {
  const { commands } = JSON.parse(fs.readFileSync(path.join('manifest/commands', file), 'utf8')) as { commands: { id: string; entryPoints: Door[] }[] };
  for (const c of commands) for (const d of c.entryPoints) DOORS.set(`${c.id}#${d.id}`, d);
}
const MENUS = (JSON.parse(fs.readFileSync('manifest/layout.json', 'utf8')) as { menus: Menu[] }).menus;
// the section of the Style tab each property, composite and recipe lives in (properties.json)
const PROPERTIES = JSON.parse(fs.readFileSync('manifest/properties.json', 'utf8')) as {
  properties: { id: string; section: string; doors: string[] }[];
  composites: { id: string; section: string; doors: string[] }[];
  recipes: { id: string; section: string; doors: string[] }[];
  controls: { door: string; section: string | null }[];
  conceptRows: { id: string; section: string; head: string[]; details: string[] }[];
  rows: { id: string; fields: { target: string }[] }[];
};
// the section of the Style tab a door's field is drawn in, or null when the door is no Style field: the one answer the
// inspector draws by (src/manifest/style-places.ts), read from the JSON this helper reads itself
const PLACE = styleSections(PROPERTIES);
// The concept row a door's control is drawn in the details of (properties.json conceptRows; the inspector's
// concept-rows.ts): its own item, or the pair row its field stands in. null for a door drawn in no row's details.
const ROW_TOGGLE = 'inspector.toggleRow#inspector-row-disclosure';
const PAIR_OF = new Map(PROPERTIES.rows.flatMap((r) => r.fields.map((f) => [f.target, `pair:${r.id}`] as const)));
const rowOfDoor = (ref: string, args: Readonly<Record<string, unknown>> = {}): string | null => {
  const d = DOORS.get(ref) as (Door & { property?: string | null; composite?: string | null }) | undefined;
  // a part of a field standing for a property (a ready-made value's thumbnail) is drawn in the row of that property's
  // first field
  if (d !== undefined && typeof d.placement === 'object' && d.placement.region === 'field' && typeof args.property === 'string') {
    const first = [...PROPERTIES.properties, ...PROPERTIES.composites].find((target) => target.id === args.property)?.doors[0];
    return first === undefined ? null : (PROPERTIES.conceptRows.find((row) => row.details.includes(first))?.id ?? null);
  }
  const target = d === undefined ? null : (d.property ?? d.composite ?? null);
  const pair = target === null ? undefined : PAIR_OF.get(target);
  return PROPERTIES.conceptRows.find((row) => row.details.includes(ref) || (pair !== undefined && row.details.includes(pair)))?.id ?? null;
};
const sectionOfDoor = (ref: string, args: Readonly<Record<string, unknown>> = {}): string | null => {
  // a row's disclosure is drawn in the section of the row it stands for
  if (ref === ROW_TOGGLE && typeof args.row === 'string') return PROPERTIES.conceptRows.find((row) => row.id === args.row)?.section ?? null;
  const d = DOORS.get(ref);
  // a part of a field (a ready-made value's thumbnail) standing for a property is drawn in that property's section
  if (d !== undefined && typeof d.placement === 'object' && d.placement.region === 'field' && typeof args.property === 'string') {
    return [...PROPERTIES.properties, ...PROPERTIES.composites].find((target) => target.id === args.property)?.section ?? null;
  }
  if (d === undefined || typeof d.placement !== 'object' || d.placement.region !== 'inspector-style') return null;
  return PLACE(ref, d as StyleDoor) ?? null;
};
// Opens what a Style door's control is drawn in, as a person does — its section's header, then its concept row's
// disclosure — when either is drawn closed. True when it pressed one.
export async function openStyleControl(page: Page, ref: string, args: Readonly<Record<string, unknown>> = {}): Promise<boolean> {
  let opened = false;
  const section = sectionOfDoor(ref, args);
  if (section !== null) {
    const header = control(page, 'inspector.toggleSection#inspector-section-header', { args: { section } }).first();
    if ((await header.count()) > 0 && (await header.getAttribute('aria-expanded')) === 'false') {
      await header.click();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      opened = true;
    }
  }
  const row = rowOfDoor(ref, args);
  if (row !== null) {
    const toggle = control(page, ROW_TOGGLE, { args: { row } }).first();
    if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      opened = true;
    }
  }
  return opened;
}
// Every concept row of the Style tab drawn open: a spec that reads every field presses each closed row's disclosure.
async function openEveryRow(page: Page): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const closed = page.locator(`[data-door="${ROW_TOGGLE}"][aria-expanded="false"]`);
    if ((await closed.count()) === 0) return;
    await closed.first().click();
  }
}
const EN = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<string, string>;

export const DOOR_ANNOTATION = 'door';
// a door the test runs and finds it cannot run yet (its command is built, but what it acts on cannot exist yet)
export const UNAVAILABLE_ANNOTATION = 'door-unavailable';

// the details of a test that runs these doors
export function runs(...refs: string[]): TestDetails {
  for (const ref of refs) if (!DOORS.has(ref)) throw new Error(`the manifest has no door ${ref}`);
  return { annotation: refs.map((ref) => ({ type: DOOR_ANNOTATION, description: ref })) };
}

export function door(ref: string): Door {
  const found = DOORS.get(ref);
  if (found === undefined) throw new Error(`the manifest has no door ${ref}`);
  return found;
}

// a chord of the manifest ("Ctrl+Alt+B", "Ctrl+\") as Playwright's keyboard writes it
const KEYS: Record<string, string> = { Ctrl: 'Control', '\\': 'Backslash' };
export const keys = (chord: string): string => chord.split('+').map((k) => KEYS[k] ?? (k.length === 1 ? k.toLowerCase() : k)).join('+');

// The quick panel (src/editor/canvas/quick-panel.tsx) opens from its chip, which is no door (PRODUCT.md §5.3: opening
// the quick panel is data-local): a door drawn in it (its fields, More actions) and its grip are reached by opening it
// first, as a person clicks the chip beside the selection.
const QUICK_PANEL_GRIP = 'quick-panel-grip';
export const inQuickPanel = (d: Door): boolean => d.kind === 'quick-panel' || (d.kind === 'panel-drag' && d.source === QUICK_PANEL_GRIP);
export async function openQuickPanel(page: Page): Promise<void> {
  const chip = page.locator('[data-quick-panel-chip][aria-expanded="false"]');
  // the chip stands beside the selection's label (DEC-70); where the label is out of sight (a wide element's start left
  // of the canvas at 100 %), so is the chip, and a person opens the panel with its shortcut from the canvas (a global
  // shortcut waits while a field holds the focus, DEC-27), the canvas moving the label into view
  if ((await chip.count()) > 0) {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (await chip.isVisible()) await chip.click();
    else {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Control+Shift+Q');
    }
  }
  // an assertion, not a bare wait: a tooth proof reads why a test failed, and a run that only times out on an action
  // proves nothing (tools/runner/tooth.ts)
  await expect(page.locator('[data-quick-panel-chip][aria-expanded="true"]'), 'the quick panel opens from its chip').toBeVisible();
}

// The command bar (src/editor/shell/command-bar.tsx) opens from the top bar's Commands field, which a click reaches
// wherever the focus is (a field keeps Ctrl+K: archive/DESIGN.md "Keyboard model"); an entry is picked as a person
// picks it:
// its label typed into the bar's field (English UI), then its row clicked. An insert entry's label names its palette
// entry and an open-panel entry's its panel; a placeholder a command's label fills in from the state is left out.
const PALETTE_LABELS = new Map((JSON.parse(fs.readFileSync('manifest/elements.json', 'utf8')) as { palette: { entries: { id: string; labelKey: string }[] }[] }).palette.flatMap((g) => g.entries.map((e) => [e.id, e.labelKey] as const)));
const PANEL_LABELS = (JSON.parse(fs.readFileSync('manifest/layout.json', 'utf8')) as { panels: Record<string, { labelKey: string }> }).panels;
const BAR_FIELD = [...DOORS.entries()].find(([ref, d]) => ref.startsWith('commandBar.open#') && d.kind === 'toolbar')?.[0];
function propertyOfEntry(args: Readonly<Record<string, unknown>>): string | undefined {
  const id = (() => {
    if (typeof args.property === 'string') return args.property;
    if (typeof args.box === 'string') return args.box;
    if (typeof args.corners === 'string') return 'border-radius';
    if (typeof args.sides === 'string') {
      const part = Object.keys(args).find((name) => ['width', 'style', 'color'].includes(name));
      return part === undefined ? 'border' : `border-${part}`;
    }
    return undefined;
  })();
  return id;
}

// The text a property entry's value stands for, as the bar shows it: the value argument itself, a shadow's CSS edit,
// or the functions a filter's or a transform's parts make (written back with the writer that owns them).
function textOfValue(args: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof args.value === 'string' || typeof args.value === 'number') return String(args.value);
  const edit = args.edit as Record<string, unknown> | undefined;
  if (edit !== undefined && typeof edit.css === 'string') return edit.css;
  const list = args.functions ?? args.parts;
  if (list !== null && typeof list === 'object' && !Array.isArray(list)) {
    let written: string | undefined = undefined;
    for (const [name, argument] of Object.entries(list as Record<string, unknown>)) if (typeof argument === 'string') written = withFunction(written, name, argument) ?? written;
    if (written !== undefined) return written;
  }
  // a writer that names its value otherwise: the border's colour, the position's mode — the one text argument left
  const structural = new Set(['property', 'box', 'sides', 'corners', 'distance', 'modifier']);
  const text = Object.entries(args).find(([name, value]) => typeof value === 'string' && !structural.has(name));
  return text?.[1] as string | undefined;
}

export function barLabel(d: Door, args: Readonly<Record<string, unknown>>, nameOf: (id: string) => string | undefined = () => undefined): string {
  const template = EN[d.labelKey ?? ''];
  if (template === undefined) throw new Error(`the catalogue has no label ${d.labelKey}`);
  const filled: Record<string, string | undefined> = {
    element: typeof args.entry === 'string' ? EN[PALETTE_LABELS.get(args.entry) ?? ''] : undefined,
    panel: typeof args.panel === 'string' ? EN[PANEL_LABELS[args.panel]?.labelKey ?? ''] : undefined,
    // a property entry (command-bar-set-property) is labelled by the property and the value its arguments name, and a
    // person reaches it by typing them: what is typed is that label
    property: propertyOfEntry(args),
    value: textOfValue(args),
    // the project's own things (command-bar-find): a page, an element and a class by the names they hold
    page: typeof args.page === 'string' ? nameOf(args.page) : undefined,
    name: typeof args.target === 'string' ? nameOf(args.target) : undefined,
    className: typeof args.className === 'string' ? args.className : undefined,
  };
  return template.replace(/\{(\w+)\}/g, (_, name: string) => filled[name] ?? '').replace(/\s+/g, ' ').trim();
}
export async function openCommandBar(page: Page): Promise<void> {
  if (BAR_FIELD === undefined) throw new Error('commandBar.open has no toolbar door');
  const field = page.locator('[data-region="command-palette"] [role="combobox"]');
  // a bar already open (a door before opened it) is typed into as it is: its backdrop covers the top bar
  if ((await field.count()) === 0) await page.locator(`[data-door="${BAR_FIELD}"]`).click();
  // a bar that does not open fails on an assertion, never on a wait's timeout
  await expect(field, 'the command bar opens').toBeVisible();
  await field.click();
  await page.keyboard.press('Control+A');
}

// opens a menu from its button, or from the menu it is a submenu of (English UI)
export async function openMenu(page: Page, id: string): Promise<void> {
  const menu = MENUS.find((m) => m.id === id);
  if (menu === undefined) throw new Error(`layout.json has no menu ${id}`);
  // the menu buttons are drawn with the editor: count them only once it is on screen (counting right after a
  // navigation raced the first render and read "no button" for a menu that has one)
  await page.locator('.workbench').waitFor();
  const button = page.locator(`.menu-button[data-menu="${id}"]`);
  if ((await button.count()) > 0) {
    // a menu with more than one button (Zoom: the canvas toolbar and the status bar) opens from the first
    await button.first().click();
    return;
  }
  const parent = menu.anchors.find((a) => a.region.startsWith('menu:'));
  const name = EN[menu.labelKey];
  if (parent === undefined || name === undefined) throw new Error(`menu ${id} has no button and is no submenu`);
  await openMenu(page, parent.region.slice('menu:'.length));
  await page.getByRole('menuitem', { name, exact: true }).hover();
}

// The control of a door drawn once per item it stands for (a Layers row per node, an Insert tile per palette entry):
// the one whose arguments (data-args, written by the door's drawing) hold every argument given. Without arguments,
// the door's only control, or with `any` the first of them that is available (a field's parts are drawn for every
// field, those of a feature still to come unavailable; the census runs only a door it read available).
export function control(page: Page, ref: string, options: { readonly args?: Readonly<Record<string, unknown>>; readonly any?: boolean } = {}): Locator {
  // a CSS string of any text: quoted with ', its backslashes and quotes escaped
  const css = (text: string) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  const given = Object.entries(options.args ?? {}).map(([name, value]) => `[data-args*=${css(`${JSON.stringify(name)}:${JSON.stringify(value)}`)}]`);
  const all = page.locator(`[data-door="${ref}"]${given.join('')}`);
  if (options.any !== true) return all;
  const available = page.locator(`[data-door="${ref}"]${given.join('')}:not([aria-disabled="true"]):not([disabled])`);
  return available.first();
}

// Any drawn control, of any door, that stands for these arguments (a canvas handle standing for itself: its arrows are
// keys of another command, handle.step).
export function standingControl(page: Page, args: Readonly<Record<string, unknown>>): Locator {
  const css = (text: string) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  const given = Object.entries(args).map(([name, value]) => `[data-args*=${css(`${JSON.stringify(name)}:${JSON.stringify(value)}`)}]`);
  return page.locator(`[data-door]${given.join('')}`);
}

// A panel control's door with a key held (a Layers row's Shift+click) is drawn by the control of the same gesture
// with no key held: the door of the same panel, control and gesture whose modifier is null. A panel control's door
// pressed with the secondary button (a Layers row's secondary click, its `button`) is drawn by the control of the same
// panel and control that the primary button runs with no key held.
export function modifiedControl(ref: string): { readonly drawn: string; readonly key: 'Shift' | 'Control' | 'Alt' | 'Meta' | null; readonly button: 'left' | 'right' } | null {
  const d = door(ref);
  const secondary = d.button === 'secondary';
  if (d.kind !== 'panel-control' || ((d.modifier === null || d.modifier === undefined) && !secondary)) return null;
  const drawn = [...DOORS].find(
    ([, o]) => o.kind === 'panel-control' && o.panel === d.panel && o.control === d.control && (secondary || o.gesture === d.gesture) && (o.modifier ?? null) === null && o.button === undefined,
  )?.[0];
  if (drawn === undefined) throw new Error(`${ref}: no control of ${d.panel ?? ''} ${d.control ?? ''} is drawn for its gesture with no key held`);
  const KEY = { Shift: 'Shift', Ctrl: 'Control', Alt: 'Alt', Meta: 'Meta' } as const;
  const key = d.modifier === null || d.modifier === undefined ? null : (KEY[d.modifier as keyof typeof KEY] as (typeof KEY)[keyof typeof KEY] | undefined);
  if (key === undefined) throw new Error(`${ref}: unknown modifier ${String(d.modifier)}`);
  return { drawn, key, button: secondary ? 'right' : 'left' };
}

// runs a door as a user does: a shortcut by its keys, a menu item from its menu, a panel control's door with a key
// held by a click on its control with that key held, one pressed with the secondary button by a secondary click on
// its control, a panel control its door counts two clicks for (a Layers row's name) by a double-click, any other
// control by a click
export async function runDoor(page: Page, ref: string, options: { readonly args?: Readonly<Record<string, unknown>>; readonly any?: boolean } = {}): Promise<void> {
  const d = door(ref);
  const modified = modifiedControl(ref);
  if (modified !== null) {
    await control(page, modified.drawn, options).click({ modifiers: modified.key === null ? [] : [modified.key], button: modified.button });
    return;
  }
  if (d.kind === 'shortcut') {
    if (d.chord === undefined) throw new Error(`shortcut ${ref} has no chord`);
    await focusContext(page, d.context);
    await page.keyboard.press(keys(d.chord));
    return;
  }
  if (d.kind === 'menu') {
    if (d.menu === undefined) throw new Error(`menu door ${ref} names no menu`);
    await openMenu(page, d.menu);
  }
  if (d.kind === 'command-bar') {
    await openCommandBar(page);
    await page.keyboard.type(barLabel(d, { ...d.args, ...options.args }));
  }
  if (inQuickPanel(d)) await openQuickPanel(page);
  await scrollToControl(page, ref, options);
  await openValueMenu(page, ref, options.args);
  // a door drawn as an area (the backdrop under a menu, a Layers row's name) is pressed where nothing drawn over it
  // lies, near its top-left corner, as a person clicks away from a menu; any other control at its centre — or, where
  // another control is drawn over that centre (a resize handle over the end of a spacing band, item 4.2), at a point
  // inside it that the door's own control takes, so the press lands on the control the step names
  const point = d.drawnAs === 'area' ? null : await clearPoint(page, ref, options);
  const at = d.drawnAs === 'area' ? { position: { x: 4, y: 4 } } : undefined;
  if (d.kind === 'panel-control' && d.count === 2) {
    await control(page, ref, options).dblclick(at);
    return;
  }
  if (point !== null) {
    // the control's centre is taken by another control drawn over it (a resize handle over the end of a spacing band,
    // item 4.2): the press is made with the real mouse at a point probed to be the control's own, so the door's
    // control receives it, as it does when a person aims past the handle
    await page.mouse.click(point.x, point.y);
    return;
  }
  await control(page, ref, options).click(at);
}

// A key of a region of controls (a toolbar, a tab strip, the palette, the Layers tree) is pressed with the focus in
// that region, as a person tabs or clicks into it first: a key pressed with the focus elsewhere went to another context
// (the toolbar's ArrowRight reached the canvas's tree walk, which then refused without a selection, and the step proved
// nothing). The focus already in the context stays where it is.
const REGION_CONTEXTS: ReadonlySet<string> = new Set(['toolbar', 'tab-strip', 'palette', 'layers-tree']);
export async function focusContext(page: Page, context: string | undefined): Promise<void> {
  if (context === undefined || !REGION_CONTEXTS.has(context)) return;
  await page.evaluate((wanted) => {
    const inside = (el: Element | null) => el?.closest('[data-key-context]')?.getAttribute('data-key-context') === wanted;
    if (inside(document.activeElement)) return;
    const visible = (el: Element) => el.getClientRects().length > 0;
    const region = [...document.querySelectorAll(`[data-key-context="${wanted}"]`)].find(visible);
    const target = region === undefined ? null : [...region.querySelectorAll<HTMLElement>('button, [tabindex], input')].find((el) => visible(el) && !el.hasAttribute('disabled') && inside(el));
    target?.focus();
  }, context);
}

// Keyword buttons whose words do not fit their row are a keyword menu (spec inspector-panel, "Keyword buttons"): the
// item standing for a value is drawn only while the menu is open, so a door pressed for a value it has no drawn control
// for opens the menu first — the one button of the door that opens a list — as a person does.
export async function openValueMenu(page: Page, ref: string, args: Readonly<Record<string, unknown>> | undefined): Promise<void> {
  if (door(ref).kind !== 'inspector-field' || args === undefined || (await control(page, ref, { args }).count()) > 0) return;
  const opener = page.locator(`[data-door="${ref}"][aria-haspopup="menu"]`);
  if ((await opener.count()) === 1 && (await opener.getAttribute('aria-expanded')) !== 'true') await opener.click();
}

// A point inside the door's control that the control itself takes, or undefined for its centre: the points of a grid
// over the control's box are tried, nearest the centre first, and the first whose topmost element lies inside the
// control wins. A press the browser would deliver to another control is not a press on this door. The chrome settles
// at its own pace (a selection's handles appear a frame after its bands), so the point found is probed once more
// before it is used, and the search starts over while the two disagree.
async function clearPoint(page: Page, ref: string, options: { readonly args?: Readonly<Record<string, unknown>>; readonly any?: boolean }): Promise<{ readonly x: number; readonly y: number } | null> {
  const target = control(page, ref, options);
  if ((await target.count()) === 0) return null;
  // the control is brought into view first (a field below its panel's fold), as a click would
  await target.first().scrollIntoViewIfNeeded();
  const settle = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  let last: { free: { x: number; y: number } | null; tried: string[] } = { free: null, tried: [] };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await settle();
    last = await target.first().evaluate((el) => {
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return { free: null, tried: [] as string[] };
      const probe = (x: number, y: number): string => {
        const hit = document.elementFromPoint(x, y);
        const mine = hit !== null && (hit === el || el.contains(hit));
        return mine ? 'its own' : hit === null ? 'nothing (off the screen?)' : `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 50)}`;
      };
      if (probe(box.left + box.width / 2, box.top + box.height / 2) === 'its own') return { free: null, tried: ['the centre is its own'] };
      const fractions = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85];
      const xs = [...fractions.map((f) => box.width * f), 4, box.width - 4];
      const ys = [...fractions.map((f) => box.height * f), 4, box.height - 4];
      const tried: string[] = [];
      for (const y of ys) {
        for (const x of xs) {
          const hit = probe(box.left + x, box.top + y);
          if (hit === 'its own') return { free: { x: Math.round(box.left + x), y: Math.round(box.top + y) }, tried };
          tried.push(`(${Math.round(box.left + x)},${Math.round(box.top + y)}) ${hit}`);
        }
      }
      return { free: null, tried };
    });
    if (last.free === null) {
      // the centre is the door's own (the plain click does it) or nothing of the control takes a press (the message)
      if (last.tried.length === 1) return null;
      continue;
    }
    const chosen = last.free;
    await settle();
    const stillFree = await target.first().evaluate((el, at) => {
      const hit = document.elementFromPoint(at.x, at.y);
      return hit !== null && (hit === el || el.contains(hit));
    }, chosen);
    if (stillFree) return chosen;
  }
  // the control takes no press anywhere: the step cannot run, and the reason is the message (never a click timeout)
  if (last.tried.length === 1) return null;
  throw new Error(`${ref}: no point of its control takes a press — ${last.tried.slice(0, 4).join('; ')}`);
}

// A Layers row outside its panel's window is not drawn (A3.28: the tree draws only the rows in its view, the panel as
// tall as the splitter holds): the tree is scrolled from its top down until the control is there, as a person scrolls
// to reach a row their selection or a click left outside the view.
// A panel a page already opens with (the workspace keeps it across a reload, spec dock-toggles): the toggle is
// clicked only while the control says the panel is closed, so a step that wants the panel open opens it, never
// closes it under itself.
export async function ensurePanel(page: Page, ref: string): Promise<void> {
  const toggle = page.locator(`[data-door="${ref}"]`);
  await expect(toggle, `${ref}: its control is drawn`).toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await runDoor(page, ref);
}
// The Style tab draws a section collapsed while the selected element holds no value in it (the user's real-use audit,
// item 5.1: the panel stays short; src/editor/inspector/sections.ts). A step that runs a door of such a section opens
// it first — through the section's own header door, as a person does — since a door the editor does not draw cannot be
// reached through the real mouse and keyboard. What the header's door records is the section's state only: nothing in
// the document, the selection or the history changes.
async function openSectionOfControl(page: Page, ref: string): Promise<boolean> {
  return openStyleControl(page, ref);
}

// The Style tab draws a section the selected element holds no value in collapsed (the user's real-use audit, item
// 5.1; src/editor/inspector/sections.ts): a spec that needs a section drawn open, or closed, presses its header door
// until it reads so — the same gesture a person makes, and nothing in the document, the selection or the history
// changes with it.
export async function setSectionOpen(page: Page, section: string, open: boolean): Promise<void> {
  const header = control(page, 'inspector.toggleSection#inspector-section-header', { args: { section } }).first();
  await expect(header, `the header of the ${section} section is drawn`).toHaveCount(1);
  for (let press = 0; press < 3 && (await header.getAttribute('aria-expanded')) !== String(open); press += 1) {
    await header.click();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  expect(await header.getAttribute('aria-expanded'), `the ${section} section is drawn ${open ? 'open' : 'collapsed'}`).toBe(String(open));
}

// Every section the Style tab draws, opened: a spec that reads the whole panel (its fields' drawing, the Tab walk)
// asks for it the way a person does, one header at a time.
export async function openEverySection(page: Page): Promise<void> {
  const sections = await page
    .locator('[data-door="inspector.toggleSection#inspector-section-header"]')
    .evaluateAll((els) => els.map((el) => (JSON.parse(el.getAttribute('data-args') ?? '{}') as { section?: string }).section ?? ''));
  for (const section of sections) if (section !== '') await setSectionOpen(page, section, true);
  // every field drawn: the concept rows' details too
  await openEveryRow(page);
}

export async function scrollToControl(page: Page, ref: string, options: { readonly args?: Readonly<Record<string, unknown>> } = {}): Promise<void> {
  // a field of the Style tab drawn in a collapsed section: the section is opened first
  if (!ref.includes('layers-')) {
    if ((await control(page, ref, options).count()) === 0 && (await openSectionOfControl(page, ref))) return;
    return;
  }
  const tree = page.locator('.layers-tree');
  const target = control(page, ref, options);
  if ((await tree.count()) !== 1) return;
  // each step waits for the editor to draw the rows of the new scroll before the next one: the tree redraws its
  // window a frame after the scroll, and a step taken before it overshoots the row
  const settle = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if ((await target.count()) === 0) {
    await tree.evaluate((el) => el.scrollTo(0, 0));
    await settle();
    for (let i = 0; i < 60 && (await target.count()) === 0; i += 1) {
      await tree.evaluate((el) => el.scrollBy(0, el.clientHeight * 0.8));
      await settle();
    }
  }
  // drawn is not enough: the row may still stand beyond the tree's fold, where a click at its box lands on whatever is
  // there (playwright counts a clipped element visible, and the tree keeps its first and last rows drawn for Home and
  // End) — so it is scrolled into the view, and the editor is given the frame it lays the new scroll out in
  if ((await target.count()) > 0) await target.scrollIntoViewIfNeeded();
  await settle();
}

// The Explorer, opened through its activity bar door, as a person does: a fresh profile opens on Insert (the audit's
// AUD-21), so a test that uses the Explorer's rows opens it first.
export async function openExplorer(page: Page): Promise<void> {
  await runDoor(page, 'workspace.setPanelOpen#toolbar-activity-bar-explorer');
}

// The canonical design's twelve states (design/final/index.html, its #state=…) and how the app is brought to each with
// the gestures a person makes, on the design's own page as a project (manifest/features/fixtures/canonical.json: the
// Aurora page, its pages, files, classes, variables and layer names): what the parity tools pair (pair.ts crops the
// regions, pairing.parity.ts measures every region and control).
import type { Page } from '@playwright/test';
import { openMenu } from '../../tests/e2e/door.ts';

export const STATES = ['default', 'selection', 'breakpoint', 'menu', 'context', 'palette', 'multi', 'state', 'text', 'interaction', 'hover', 'drag'] as const;
export type State = (typeof STATES)[number];
export type Theme = 'dark' | 'light';
export type Language = 'en' | 'pt-BR';
const CANON = 'http://localhost:5394/design/final/index.html';
const FIXTURE = 'manifest/features/fixtures/canonical.json';

// the design at a state, its theme and language from its address (its own control reloads the page with them)
export async function openCanon(canon: Page, state: State, theme: Theme, language: Language): Promise<void> {
  await canon.goto(`${CANON}#state=${state}&theme=${theme}&lang=${language === 'en' ? 'en' : 'pt'}`);
  await canon.waitForTimeout(1500);
  await canon.evaluate(() => document.querySelector('.mock-ctl')?.remove());
  await canon.waitForTimeout(400);
}

// the app opened on the canonical project, in a theme and a language chosen as a person chooses them
export async function openApp(app: Page, base: string, theme: Theme, language: Language): Promise<void> {
  await app.goto(base);
  await app.waitForTimeout(1200);
  await app.locator('[data-menu="file"]').click();
  const chooser = app.waitForEvent('filechooser');
  await app.locator('[data-door="project.open#menu-file"]').click();
  await (await chooser).setFiles(FIXTURE);
  // opening a project may start the editor again on it: the page settles first
  await app.waitForTimeout(1500);
  await app.waitForLoadState('load');
  await app.locator('.workbench').waitFor();
  if (theme === 'light') await choose(app, 'theme', 'preferences.setTheme#menu-theme-light');
  if (language === 'pt-BR') await choose(app, 'language', 'preferences.setLanguage#menu-language-pt-br');
}

// a submenu's item (View › Theme, View › Language), opened as the menus open it (tests/e2e/door.ts openMenu)
async function choose(app: Page, submenu: 'theme' | 'language', door: string): Promise<void> {
  await openMenu(app, submenu);
  await app.locator(`[data-door="${door}"]`).first().click();
  await app.waitForTimeout(300);
}

// what the design selects in each state (its inspector's name and its Layers' selected row), and the class its
// selector bar edits (the target drawn on)
const SELECTED: Record<State, { readonly name: string; readonly target: string }> = {
  default: { name: 'Cartão Assinatura', target: '.card' },
  selection: { name: 'Cartão Assinatura', target: '.card' },
  breakpoint: { name: 'Título Planos', target: '.plans__title' },
  menu: { name: 'Cartão Assinatura', target: '.card' },
  context: { name: 'Cartão Assinatura', target: '.card' },
  palette: { name: 'Cartão Assinatura', target: '.card' },
  multi: { name: 'Cartão Assinatura', target: '.card' },
  state: { name: 'Assinar agora', target: '.btn' },
  text: { name: 'Título principal', target: '.hero-title' },
  interaction: { name: 'Assinar agora', target: '.btn' },
  hover: { name: 'Cartão Assinatura', target: '.card' },
  drag: { name: 'Cartão Oficinas', target: '.card' },
};

// a box on the canvas, in the page's coordinates (the frame's own offset added), of the element a layer names
async function canvasBox(app: Page, name: string): Promise<{ x: number; y: number; width: number; height: number }> {
  await row.click(app, name);
  await app.waitForTimeout(300);
  const box = await app.locator('.chrome__selection').first().boundingBox();
  if (box === null) throw new Error(`${name} is not drawn selected`);
  return box;
}
const rowOf = (app: Page, name: string) => app.locator('[data-door="selection.select#layers-row"]').filter({ has: app.locator('.row__name').getByText(name, { exact: true }) }).first();
// the branches above each element the states select, from the page down (the canonical fixture's tree)
const ANCESTORS: Readonly<Record<string, readonly string[]>> = {
  'Cartão Assinatura': ['Page', 'Main', 'Planos', 'Grade de cartões'],
  'Cartão Grãos': ['Page', 'Main', 'Planos', 'Grade de cartões'],
  'Cartão Oficinas': ['Page', 'Main', 'Planos', 'Grade de cartões'],
  'Título Planos': ['Page', 'Main', 'Planos'],
  'Título principal': ['Page', 'Main', 'Hero', 'Texto do hero'],
  'Assinar agora': ['Page', 'Main', 'Hero', 'Texto do hero', 'Ações'],
};
// the folded branches above an element opened with their carets, as a person opens them
async function openTo(app: Page, name: string): Promise<void> {
  for (const branch of ANCESTORS[name] ?? []) {
    const caret = (await revealed(app, branch)).locator('[data-door="layers.setExpanded#layers-caret"]');
    if ((await caret.count()) > 0 && (await caret.getAttribute('aria-expanded')) === 'false') {
      await caret.click();
      await app.waitForTimeout(150);
    }
  }
}
// a layer's row, the Layers panel scrolled with the wheel until it is drawn (the tree draws the rows it shows)
async function revealed(app: Page, name: string) {
  const tree = app.locator('[data-region="explorer-layers"]').first();
  for (let turn = 0; turn < 30 && (await rowOf(app, name).count()) === 0; turn += 1) {
    const box = await tree.boundingBox();
    if (box === null) break;
    await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await app.mouse.wheel(0, 120);
    await app.waitForTimeout(80);
  }
  return rowOf(app, name);
}
const row = {
  click: async (app: Page, name: string, options?: Parameters<ReturnType<typeof rowOf>['click']>[0]) => (await revealed(app, name)).click(options),
};

// the app brought to a state of the design, as a person brings it there
export async function setUpState(app: Page, state: State): Promise<void> {
  const { name, target } = SELECTED[state];
  // the sidebar's view the design shows in the state (its Styles view in the State state, else the Explorer), opened
  // from the activity bar: a fresh profile opens on Insert (the audit's AUD-21), which the design does not show
  // the Explorer first, where the setup's rows are (the State state takes its Styles view at the end)
  await app.locator('[data-door="workspace.setPanelOpen#toolbar-activity-bar-explorer"]').click();
  await app.waitForTimeout(300);
  // the inspector showing every property, as the design's mode bar does (All, not Essentials only)
  const all = app.locator('[data-door="inspector.setMode#inspector-mode-all"]').first();
  if ((await all.count()) > 0 && (await all.getAttribute('aria-pressed')) !== 'true') await all.click();
  // the design's view of the canvas: snap and outlines on, as a person turns them on in the canvas toolbar
  await app.locator('[data-door="snap.setEnabled#toolbar-canvas-toolbar-snap"]').first().click();
  await app.locator('[data-door="view.toggleOutlines#canvas-tools-outlines"]').first().click();
  // Layers as the design shows it: every branch folded, then only the selection's opened by selecting it
  await app.locator('[data-door="layers.collapseAll#toolbar-layers-header-collapse-all"]').first().click();
  await app.waitForTimeout(200);
  // a session's history, as the design's top bar shows it (Undo and Redo both available) and the page unchanged: a card
  // moved down and back up, then duplicated and the duplicate undone
  await openTo(app, 'Cartão Grãos');
  await row.click(app, 'Cartão Grãos');
  for (const key of ['Alt+ArrowDown', 'Alt+ArrowUp', 'Control+d', 'Control+z']) {
    await app.keyboard.press(key);
    await app.waitForTimeout(150);
  }
  // the design's file tabs hold the stylesheet open beside the pages: opened from the Explorer's row, then the home
  // page's tab brought back to the front
  await app.locator('.row[data-file="css/styles.css"] .row__main').first().click();
  await app.waitForTimeout(300);
  await app.locator('[data-door="pages.switch#file-tab"]').first().click();
  await app.waitForTimeout(300);
  // the file showed in the Code view: the canvas back, as the toolbar's Canvas brings it
  await app.locator('[data-door="view.setEditorView#toolbar-canvas-toolbar-canvas"]').first().click();
  await app.waitForTimeout(300);
  await openTo(app, name);
  // the element selected once first: Layers opens its branch, so the rows of its siblings are there to click
  await row.click(app, name);
  await app.waitForTimeout(300);
  // the boxes the pointer states need, read before the selection they end on
  const other = state === 'hover' ? await canvasBox(app, 'Cartão Grãos') : null;
  const before = state === 'drag' ? await canvasBox(app, 'Cartão Grãos') : null;
  if (state === 'state') {
    // the Styles view has no Layers: the element is selected from the Explorer, then the Styles view opened again
    await app.locator('[data-door="workspace.setPanelOpen#toolbar-activity-bar-explorer"]').click();
    await app.waitForTimeout(300);
  }
  await row.click(app, name);
  await app.waitForTimeout(400);
  // the class the design's selector bar edits, chosen on the bar as a person chooses it
  const chip = app.locator('[data-door="inspector.setStyleTarget#inspector-class-bar-target"]', { hasText: target }).first();
  if ((await chip.count()) > 0) {
    await chip.click();
    await app.waitForTimeout(300);
  }
  if (state === 'state') {
    await app.locator('[data-door="workspace.setPanelOpen#toolbar-activity-bar-styles"]').click();
    await app.waitForTimeout(300);
  }
  // the design's Tablet state shows the quick panel open on the selection: the app at Tablet with its panel open too
  if (state === 'breakpoint') {
    await app.locator('[data-door="view.setBreakpoint#toolbar-breakpoint-tabs-tablet"]').click();
    await app.waitForTimeout(500);
    await app.keyboard.press('Control+Shift+Q');
    await app.waitForTimeout(600);
  }
  if (state === 'menu') {
    await app.locator('[data-menu="arrange"]').click();
    await app.waitForTimeout(400);
    // the design's pointer on Move down, the first item the selection can take
    await app.locator('[data-door="element.moveDown#menu-arrange"]').first().hover();
  }
  if (state === 'context') {
    await row.click(app, name, { button: 'right' });
    await app.waitForTimeout(400);
    await app.locator('[data-door="element.moveDown#context-menu"]').first().hover();
  }
  if (state === 'palette') {
    await app.keyboard.press('Control+K');
    await app.waitForTimeout(300);
    // the canonical palette shows the query exp
    await app.keyboard.type('exp');
    await app.waitForTimeout(400);
  }
  if (state === 'multi') {
    await row.click(app, 'Cartão Grãos', { modifiers: ['Control'] });
    await row.click(app, 'Cartão Oficinas', { modifiers: ['Control'] });
    await app.waitForTimeout(400);
  }
  if (state === 'state') {
    // the State picker of the selector bar, then its Hover item, as a person picks it
    await app.locator('.state-picker').first().click();
    await app.locator('[data-door$="#menu-style-state-hover"]').first().click();
    await app.waitForTimeout(400);
  }
  if (state === 'text') {
    // the title edited in place: selected, then a double-click on its words, as a person starts editing it
    const words = await app.locator('.chrome__selection').first().boundingBox();
    if (words === null) throw new Error('the title is not drawn selected');
    await app.mouse.dblclick(words.x + Math.min(words.width / 2, 20), words.y + words.height / 2);
    await app.waitForTimeout(500);
  }
  if (state === 'interaction') {
    // the design's dock is open on the Timeline while an event is edited, its loop on
    await app.locator('[data-door="workspace.setPanelOpen#dock-strip-timeline"]').first().click();
    await app.waitForTimeout(300);
    const loop = app.locator('[data-door="timeline.toggleLoop#timeline-loop"]').first();
    if ((await loop.count()) > 0) await loop.click();
    // the Interactions tab on the button's two events, its click event's target being picked (the design's state)
    await app.locator('[data-door$="#inspector-tab-interactions"]').first().click();
    await app.waitForTimeout(400);
    const pick = app.locator('[data-region="inspector-interactions"] [data-door="interactions.update#inspector-interaction-target"]').first();
    if ((await pick.count()) > 0) {
      await pick.click();
      await app.waitForTimeout(400);
    }
  }
  // the design's sidebar shows Insert while it measures a hover
  if (state === 'hover') await app.locator('[data-door="workspace.setPanelOpen#toolbar-activity-bar-insert"]').click();
  if (state === 'hover' && other !== null) {
    // the selection kept, the pointer on the next card with Alt held: the distance between them (the design's measure)
    await app.mouse.move(other.x + other.width * 0.3, other.y + other.height * 0.36);
    await app.keyboard.down('Alt');
    await app.waitForTimeout(400);
  }
  if (state === 'drag' && before !== null) {
    // the last card dragged by the pointer and held before the second one (the design's insertion line and ghost)
    const from = await app.locator('.chrome__selection').first().boundingBox();
    if (from !== null) {
      await app.mouse.move(from.x + from.width * 0.36, from.y + from.height * 0.3);
      await app.mouse.down();
      await app.mouse.move(before.x + 8, before.y + before.height * 0.3, { steps: 12 });
      await app.waitForTimeout(400);
    }
  }
  // the pointer rests where it hovers nothing (a menu stays open: the pointer leaving it does not close it)
  // in the multiple selection the design's pointer rests on the Footer's row, which shows its actions
  if (state === 'multi') await (await revealed(app, 'Footer')).hover();
  else if (state !== 'palette' && state !== 'hover' && state !== 'drag' && state !== 'menu' && state !== 'context') await app.mouse.move(1, 899);
}

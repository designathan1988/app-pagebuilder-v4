// Keyboard focus (INVENTORY.md, owners): focus.next, focus.previous, focus.first, focus.last and
// focus.activate move the keyboard focus among the items of the region that holds it, or run the focused item. The
// region is the element that names the focused key context (data-key-context: a menu, a toolbar, a tab strip…) and
// its items are its own focusable controls, in document order, not those of a region nested in it (a submenu).
// A handler never touches the page: it records the request in the editor state, and the focus owner's installer
// carries it out on the DOM focus when the state changes.
import type { Panel } from '../workspace/panel-catalogue.ts';
import { registerHandler } from '../../core/commands/registry.ts';
import type { EditorUi } from '../state.ts';
import type { EditorStore } from '../store.ts';
import { chooseCanvasByKeyboard } from '../input/pointer/views.ts';

export type FocusMove = `panel:${Panel}` | 'next' | 'previous' | 'first' | 'last' | 'activate' | 'parent' | 'nextRegion' | 'previousRegion' | 'canvas' | 'menuBar' | 'nextMenu' | 'previousMenu';

export interface FocusState {
  // the last request; its number tells a new request from one already carried out
  readonly request: { readonly move: FocusMove; readonly count: number } | null;
}

export const INITIAL_FOCUS: FocusState = { request: null };

export const asking = (ui: EditorUi, move: FocusMove): EditorUi => ({ ...ui, focus: { request: { move, count: (ui.focus.request?.count ?? 0) + 1 } } });

export const focusNext = registerHandler<'focus.next', EditorUi>('focus.next', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'next') }));
export const focusPrevious = registerHandler<'focus.previous', EditorUi>('focus.previous', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'previous') }));
export const focusFirst = registerHandler<'focus.first', EditorUi>('focus.first', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'first') }));
export const focusLast = registerHandler<'focus.last', EditorUi>('focus.last', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'last') }));
export const focusActivate = registerHandler<'focus.activate', EditorUi>('focus.activate', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'activate') }));

// The editor's regions, in the order F6 walks them (spec keyboard-panel-navigation): the top bar, the left dock (the
// activity bar and the panel it shows), the canvas, the code pane, the workbench's dock, the panels docked right or
// floating, the inspector and the status bar. Regions a window does not draw (a closed dock, the sidebar when it is
// collapsed, the canvas in the Code view) are skipped.
// The Layers tree is a stop of its own inside the sidebar (jornada03 J12: F6 never reached it): a region inside another
// comes right after it, and the focus is in the innermost region holding it.
const LAYERS_REGION = 'section[data-panel-area="layers"]';
// a panel's header (its name, Put back, Close)
const PANEL_HEADER = '[data-region="panel-header"]';
// the canvas's stage: the page the frame draws, with its breakpoint tabs
const STAGE = '.stage';
const REGION_ROOTS: readonly string[] = ['header.top-bar', 'nav.activity-bar', 'aside.sidebar', LAYERS_REGION, STAGE, 'section.code-pane', '.dock-strip', 'aside.right-dock', 'section.panel-window', 'aside.inspector', 'footer.status-bar'];

// the region roots the window draws, in that order
const drawnRegions = (): Element[] => REGION_ROOTS.map((one) => document.querySelector(one)).filter((one): one is Element => one !== null);

// The keyboard focus goes into a region: its first enabled control takes it, or the region itself when it holds none
// (a region that takes the focus keeps the focus ring of its own).
function focusRegion(region: Element): void {
  // the canvas is entered on the page itself, never on the frame's breakpoint tabs (the audit's AUD-13, jornada03 J12):
  // the stage takes the focus, its key context the canvas's (input/keymap.ts), so the tree walk and every canvas key
  // act at once, and it draws the focus ring; it gives the tabindex back when the focus leaves it
  if (region.matches(STAGE)) {
    const stage = region as HTMLElement;
    stage.setAttribute('tabindex', '-1');
    stage.addEventListener('blur', () => stage.removeAttribute('tabindex'), { once: true });
    stage.focus({ preventScroll: true });
    return;
  }
  // the Layers tree is entered on its row that takes the Tab key (the selected row, else the page's)
  // (the region itself, or the Layers' own panel area around it: never a larger region that holds it, the sidebar)
  const layers = region.matches(LAYERS_REGION) ? region : region.matches('[data-panel-area="layers"]') ? region.querySelector(LAYERS_REGION) : null;
  if (layers !== null) {
    const row = layers.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]');
    if (row !== null) {
      row.focus();
      return;
    }
  }
  // a control that is a key context of its own (a canvas handle, a guide) is not where a region is entered: F6 is no
  // key of it, and the walk would stop there (the audit's U-029); a panel is entered on its content, its header's
  // controls (Close the panel) only when it has none
  // (a region nested in it, the Layers in the sidebar, is a stop of its own: none of its controls enters this one)
  const nested = drawnRegions().filter((one) => one !== region && region.contains(one));
  const enterable = [...region.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.hasAttribute('disabled') && el.tabIndex >= 0 && !el.hasAttribute('data-key-context') && !nested.some((one) => one.contains(el)));
  const first = enterable.find((el) => el.closest(PANEL_HEADER) === null) ?? enterable[0];
  if (first !== undefined) {
    first.focus();
    return;
  }
  const own = region as HTMLElement;
  if (!own.hasAttribute('tabindex')) own.setAttribute('tabindex', '-1');
  own.focus();
}

// The canvas takes the focus back (spec keyboard-panel-navigation: Escape inside a panel): the panel's control lets it
// go, and the editor's own document holds the focus again — which is the canvas's key context (input/keymap.ts: the
// body is the canvas), so the keys the person presses act on the page. The selection is untouched.
export function focusTheCanvas(): void {
  const held = document.activeElement;
  if (held instanceof HTMLElement && held !== document.body) held.blur();
  // the keyboard chose the canvas: its single-letter keys act again (jornada03 J2, keymap.ts lettersChosen)
  chooseCanvasByKeyboard();
}

export const focusNextRegion = registerHandler<'focus.nextRegion', EditorUi>('focus.nextRegion', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'nextRegion') }));
export const focusPreviousRegion = registerHandler<'focus.previousRegion', EditorUi>('focus.previousRegion', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'previousRegion') }));
export const focusCanvas = registerHandler<'focus.canvas', EditorUi>('focus.canvas', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'canvas') }));
// The menu bar from the keyboard (WAI-ARIA menubar; the audit's U-033): F10 opens the first app menu, and in a menu
// ArrowRight and ArrowLeft go to the next and the previous one — or open the submenu the focused item leads to, and
// close the submenu the focus is in, back on its item.
export const focusMenuBar = registerHandler<'focus.menuBar', EditorUi>('focus.menuBar', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'menuBar') }));
export const focusNextMenu = registerHandler<'focus.nextMenu', EditorUi>('focus.nextMenu', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'nextMenu') }));
export const focusPreviousMenu = registerHandler<'focus.previousMenu', EditorUi>('focus.previousMenu', ({ state }) => ({ kind: 'change', ui: asking(state.ui, 'previousMenu') }));

// the app menus' buttons, in the bar's order
const MENU_BAR = '.top-bar__menus [data-menu]';
function menuBarMove(move: 'menuBar' | 'nextMenu' | 'previousMenu', focused: Element | null): void {
  const buttons = [...document.querySelectorAll<HTMLElement>(MENU_BAR)];
  if (move === 'menuBar') {
    buttons[0]?.click();
    return;
  }
  const item = focused instanceof HTMLElement ? focused : null;
  // a submenu: the item that leads to one opens it and its first item takes the focus; inside one, the left arrow
  // closes it and gives the focus back to its item
  const sub = item?.closest('.menu__sub');
  if (move === 'nextMenu' && item?.getAttribute('aria-haspopup') === 'menu' && sub !== null && sub !== undefined) {
    if (item.getAttribute('aria-expanded') !== 'true') item.click();
    requestAnimationFrame(() => sub.querySelector<HTMLElement>(':scope > .menu [role^="menuitem"]')?.focus());
    return;
  }
  const inside = item?.closest('.menu')?.parentElement?.closest('.menu__sub') ?? null;
  if (move === 'previousMenu' && inside !== null) {
    const trigger = inside.querySelector<HTMLElement>(':scope > [aria-haspopup="menu"]');
    if (trigger?.getAttribute('aria-expanded') === 'true') trigger.click();
    trigger?.focus();
    return;
  }
  // the app menu open now: the next or the previous one in the bar opens in its place, and takes the focus
  const at = buttons.findIndex((button) => button.getAttribute('aria-expanded') === 'true');
  if (at < 0) return;
  const step = move === 'nextMenu' ? 1 : -1;
  buttons[(at + step + buttons.length) % buttons.length]?.click();
}

// the controls that take the focus (an icon's <use href> is none)
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role^="menuitem"], [role="treeitem"], [role="tab"]';

// The items of the region the focus is in: its own visible focusable controls, in document order.
function itemsAround(focused: Element): { readonly items: HTMLElement[]; readonly at: number } | null {
  const region = focused.closest('[data-key-context]');
  if (!region) return null;
  const own = [...region.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.closest('[data-key-context]') === region && el.getClientRects().length > 0);
  // in a tree the items are its rows, not the buttons inside them (a row's caret, eye or lock)
  const rows = own.filter((el) => el.getAttribute('role') === 'treeitem');
  const items = rows.length > 0 ? rows : own;
  return { items, at: items.findIndex((el) => el === focused || el.contains(focused)) };
}

// The option a combobox names active (its aria-activedescendant), marked selected; null for none.
export function setActiveOption(field: HTMLElement, options: readonly HTMLElement[], index: number | null): void {
  for (const [i, option] of options.entries()) option.setAttribute('aria-selected', String(i === index));
  const option = index === null ? undefined : options[index];
  if (option === undefined) {
    field.removeAttribute('aria-activedescendant');
    return;
  }
  field.setAttribute('aria-activedescendant', option.id);
  option.scrollIntoView({ block: 'nearest' });
}

// A combobox (the command bar's search field) keeps the focus while its active option moves (the WAI-ARIA combobox):
// its items are the options of the listbox it controls, and activating it clicks the active option's control. False
// when the focus is on no combobox.
function comboboxMove(move: FocusMove, field: Element): boolean {
  if (!(field instanceof HTMLElement) || field.getAttribute('role') !== 'combobox') return false;
  const list = document.getElementById(field.getAttribute('aria-controls') ?? '');
  if (!list) return false;
  const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  const count = options.length;
  if (count === 0) return true;
  const at = options.findIndex((o) => o.id !== '' && o.id === field.getAttribute('aria-activedescendant'));
  if (move === 'activate') {
    const option = options[at];
    (option?.querySelector<HTMLElement>('[data-door]') ?? option)?.click();
    return true;
  }
  if (move === 'parent') return true;
  const index = move === 'first' ? 0 : move === 'last' ? count - 1 : move === 'next' ? (at + 1) % count : at < 0 ? count - 1 : (at - 1 + count) % count;
  setActiveOption(field, options, index);
  return true;
}

export function carryOut(move: FocusMove, focused: Element | null): void {
  if (move.startsWith('panel:')) {
    // the panel just opened is drawn on the next frame, and its rows (the Layers tree's) on the one after
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // a panel's own area, its floating window, or the place a panel that takes no other panel is entered by
        // (data-panel-focus: the inspector, a dock tab; data-panel-area would make it a place a dragged panel combines
        // with, panel-drag.ts)
        const region = document.querySelector(`[data-panel-area="${move.slice(6)}"], [data-panel-window="${move.slice(6)}"], [data-panel-focus="${move.slice(6)}"]`);
        // a control the person reached inside the panel in these two frames keeps the focus (FL2: a tile focused at
        // once lost it to the panel's search field, so its Escape cleared the field instead of closing the panel)
        if (region && !region.contains(document.activeElement)) focusRegion(region);
      }),
    );
    return;
  }
  if (move === 'canvas') {
    focusTheCanvas();
    return;
  }
  if (move === 'menuBar' || move === 'nextMenu' || move === 'previousMenu') {
    menuBarMove(move, focused);
    return;
  }
  if (!focused) return;
  // F6 and Shift+F6: the next (previous) region that a window draws, after (before) the region the focus is in; from
  // no region at all the first (last) one
  if (move === 'nextRegion' || move === 'previousRegion') {
    const regions = drawnRegions();
    if (regions.length === 0) return;
    const at = regions.findLastIndex((one) => one.contains(focused));
    const step = move === 'nextRegion' ? 1 : -1;
    const region = regions[at < 0 ? (step > 0 ? 0 : regions.length - 1) : (at + step + regions.length) % regions.length] as Element;
    focusRegion(region);
    if (region.matches(STAGE)) chooseCanvasByKeyboard();
    return;
  }
  if (comboboxMove(move, focused)) return;
  const around = itemsAround(focused);
  if (!around || around.items.length === 0) return;
  const { items, at } = around;
  if (move === 'activate') {
    items[at]?.click();
    return;
  }
  // a tree row's parent row: the nearest row before it one level up (aria-level)
  if (move === 'parent') {
    const level = Number(items[at]?.getAttribute('aria-level') ?? '0');
    for (let i = at - 1; i >= 0; i -= 1) {
      if (Number(items[i]?.getAttribute('aria-level') ?? '0') === level - 1) {
        items[i]?.focus();
        return;
      }
    }
    return;
  }
  const count = items.length;
  // from the region itself (no item has the focus yet) next is the first item and previous the last
  const index = move === 'first' ? 0 : move === 'last' ? count - 1 : move === 'next' ? (at + 1) % count : at < 0 ? count - 1 : (at - 1 + count) % count;
  items[index]?.focus();
}

// Carries out each new request on the document's focus; returns its removal.
export function installFocus(store: EditorStore): () => void {
  let done = store.getState().ui.focus.request?.count ?? 0;
  return store.subscribe(() => {
    const request = store.getState().ui.focus.request;
    if (request === null || request.count === done) return;
    done = request.count;
    carryOut(request.move, document.activeElement);
  });
}

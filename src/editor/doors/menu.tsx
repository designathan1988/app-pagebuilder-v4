// Menus (PRODUCT.md §5): a menu's button opens it; its items are the doors placed in "menu:<menu>" and the buttons
// of its submenus (menus anchored in it), in their order. An application menu shows every item: one whose command is
// not built yet is disabled with "not available yet" (archive/DESIGN.md "Overlays"). Opening a menu is not a command,
// so which menu is open is this component's own state. A menu has no key or pointer listener of its own: its keys are
// the doors of the "menu" key context, run by the keymap (the arrows, Home and End move the focus, Enter runs the
// focused item, Escape dismisses). Outside presses close through outside-layer without intercepting the target. A
// dismissal closes the menus open when it arrives (menus/overlays.ts), and a dismissed menu gives the focus back to its
// button. The context menu (ContextMenu, at the end) is drawn here too, from the doors the manifest places in the
// context-menu region; its opening is a command (menus/context-menu.ts).
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { locate } from '../../core/document/model.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, KeyContextId, MenuId, MessageId } from '../../generated/ids.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { chordCap } from '../input/keymap.ts';
import { openContextMenu } from '../menus/context-menu.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { stateOf } from '../view/style-state.ts';
import { Icon, useDoor, isDoorBuilt } from './door.tsx';
import { useOutsideLayer } from '../shell/outside-layer.ts';
import { floatBelow, pointAnchor } from '../shell/float.ts';
import { GLYPHS, doorSlots, menuOf, slotsIn, type Anchor } from './placement.ts';
import { usePointerValue, usePointerViews } from '../input/pointer/use-views.ts';

// the orders of the items a line stands before, by menu (layout.json breaks)
const BREAKS = new Map<string, readonly number[]>(manifest.layout.menus.map((m) => [m.id, m.breaks ?? []] as const));

// The manifest dismissal command also closes a context menu.
const BACKDROP = doorSlots('overlay')[0];

// an item; its shortcut is the command's key in the context it acts in (keysIn: the canvas's for the context menu)
// the menu whose items are the style states (the states an element kind stands on: A3.36)
const STYLE_STATE_MENU: MenuId = 'style-state';

function MenuItem({ entry, onDone, keysIn = 'global' }: { readonly entry: DoorEntry; readonly onDone: () => void; readonly keysIn?: KeyContextId }) {
  const door = useDoor(entry, {}, undefined, true, keysIn);
  const t = useT();
  // how the item says it stands for the current state: the door's checked (radio, checkbox or none), manifest data
  const checked = entry.door.kind === 'menu' ? entry.door.checked : null;
  const icon = checked !== null ? (door.current ? GLYPHS.checked : null) : entry.door.icon;
  return (
    <button
      type="button"
      role={checked === 'radio' ? 'menuitemradio' : checked === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={checked !== null ? door.current : undefined}
      aria-disabled={door.available ? undefined : true}
      className={['menu__item', door.available ? '' : 'is-unavailable'].filter((c) => c !== '').join(' ')}
      data-door={entry.ref}
      // what the item stands for, as every door's control says it (a dialog it opens)
      data-args={Object.keys(entry.door.args).length > 0 ? JSON.stringify(entry.door.args) : undefined}
      title={door.title}
      onClick={() => {
        if (!door.available) return;
        // the menu closes first, then the item runs: what the item opens (a rename, a name prompt, a dialog) is newer
        // than the menu's own dismissal, which would otherwise close it at once
        onDone();
        door.run();
      }}
    >
      <span className="menu__icon">{icon !== null ? <Icon name={icon} size="sm" /> : null}</span>
      <span className="menu__label">{door.label}</span>
      {door.built || door.reason === null ? null : <span className="menu__reason">{t(door.reason)}</span>}
      {door.chord !== null ? <kbd className="menu__chord">{chordCap(door.chord)}</kbd> : null}
    </button>
  );
}

// A menu's items. A menu opened from its button takes the focus on its first item, and opens at fixed window
// coordinates under that button, inside the window with the --space-4 token between it and the window's edge, so no
// panel that clips its content (the inspector) cuts it; a submenu is drawn with its menu and shown while the pointer
// is over its item, the focus is in it, or its item was run (shell.css).
function MenuList({ menu, onDone, focusFirst, anchor }: { readonly menu: MenuId; readonly onDone: () => void; readonly focusFirst: boolean; readonly anchor?: { readonly current: HTMLElement | null } }) {
  const list = useRef<HTMLDivElement>(null);
  const t = useT();
  // Commands may enter a canvas mode or open another surface; only Escape returns to this menu's trigger.
  useOutsideLayer(list, anchor !== undefined, onDone, anchor, false);
  const [at, setAt] = useState<{ readonly left: number; readonly top: number } | null>(null);
  useLayoutEffect(() => {
    const button = anchor?.current;
    const own = list.current;
    if (!button || !own) return;
    const edge = parseFloat(getComputedStyle(own).getPropertyValue('--space-4')) || 0;
    const { width, height } = own.getBoundingClientRect();
    // under the button, inside the window, above it when there is no room below (a menu of the status bar): float.ts
    setAt(floatBelow(button.getBoundingClientRect(), { width, height }, { width: window.innerWidth, height: window.innerHeight }, edge));
  }, [anchor]);
  // the first item takes the focus once the menu shows (a menu opened from a button, once it is placed)
  const shown = anchor === undefined || at !== null;
  useEffect(() => {
    if (focusFirst && shown) list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [focusFirst, shown]);
  const stateType = useEditorState((s) => (s.selection[0] === undefined ? null : (locate(s.document, s.selection[0])?.node.type ?? null)));
  const placed = anchor === undefined ? undefined : at === null ? { position: 'fixed' as const, visibility: 'hidden' as const } : { position: 'fixed' as const, left: at.left, top: at.top, right: 'auto', bottom: 'auto' };
  return (
    <div className="menu" role="menu" ref={list} style={placed} aria-label={t(menuOf(menu).labelKey as MessageId)} data-region={`menu:${menu}`} data-key-context="menu">
      {slotsIn(`menu:${menu}`)
        // the State menu offers only the states the selected element kind stands on (A3.36): an h2 takes no :disabled
        .filter((slot) => {
          if (slot.kind !== 'door' || menu !== STYLE_STATE_MENU || stateType === null) return true;
          const state = stateOf(slot.entry.door.args);
          return state === null || state.elements === null || state.elements.includes(stateType);
        })
        .flatMap((slot) => [
          // a line between the menu's groups (layout.json breaks)
          ...(BREAKS.get(menu)?.includes(slot.order) === true ? [<div key={`break-${slot.order}`} className="menu__separator" role="separator" />] : []),
          slot.kind === 'door' ? <MenuItem key={slot.entry.ref} entry={slot.entry} onDone={onDone} keysIn="canvas" /> : <SubMenu key={slot.menu} menu={slot.menu} onDone={onDone} />,
        ])}
    </div>
  );
}

function SubMenu({ menu, onDone }: { readonly menu: MenuId; readonly onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <div className={`menu__sub${open ? ' is-open' : ''}`}>
      <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} className="menu__item" onClick={() => setOpen(!open)}>
        <span className="menu__icon" />
        <span className="menu__label">{t(menuOf(menu).labelKey as MessageId)}</span>
        <Icon name={GLYPHS.submenu} size="sm" />
      </button>
      <MenuList menu={menu} onDone={onDone} focusFirst={false} />
    </div>
  );
}

export interface MenuButtonProps {
  readonly menu: MenuId;
  readonly anchor: Anchor;
  // what the button shows instead of the menu's label (the zoom value, the language)
  readonly children?: ReactNode;
  // draw the dropdown glyph after the label
  readonly indicator?: boolean;
  readonly className?: string;
}

// The opening is local UI state. Escape uses the dismissal count; outside-layer closes on a real outside press.
export interface MenuLayer {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;
}

interface MenuGroupState {
  readonly active: MenuId | null;
  readonly dismissed: MenuId | null;
  readonly toggle: (menu: MenuId) => void;
  readonly close: () => void;
}
const MenuGroupContext = createContext<MenuGroupState | null>(null);

// The application menus are peers: a single press on another button replaces the open menu in the same render.
// Other dropdowns keep their independent layer state (a values menu must not switch the application menu).
export function MenuGroup({ children }: { readonly children: ReactNode }) {
  const dismissals = useEditorState((s) => s.ui.overlays.dismissals);
  // how the open menu was opened: a menu the pointer opened on its way (hover) is kept by the click that follows it
  // (the person moved there to click it), and only a click on a menu a click opened closes it
  const [opened, setOpened] = useState<{ readonly menu: MenuId; readonly at: number; readonly hovered?: boolean } | null>(null);
  const active = opened !== null && opened.at === dismissals ? opened.menu : null;
  const dismissed = opened !== null && opened.at !== dismissals ? opened.menu : null;
  const toggle = (menu: MenuId) =>
    setOpened((current) => (current?.menu === menu && current.at === dismissals ? (current.hovered === true ? { menu, at: dismissals } : null) : { menu, at: dismissals }));
  // the pointer onto another menu's button while one is open opens that one (input/pointer.ts menuOver)
  // (adjusted while rendering, when the button under the pointer changes: React's own pattern for state that follows
  // another value, no effect)
  const over = usePointerValue('menuOver');
  const [seen, setSeen] = useState(over);
  if (over !== seen) {
    setSeen(over);
    if (active !== null && over !== null && over !== active) setOpened({ menu: over as MenuId, at: dismissals, hovered: true });
  }
  return <MenuGroupContext.Provider value={{ active, dismissed, toggle, close: () => setOpened(null) }}>{children}</MenuGroupContext.Provider>;
}

export function useMenuLayer(button: RefObject<HTMLButtonElement | null>, list?: RefObject<HTMLElement | null>, menu?: MenuId, options?: { readonly onOutside?: () => void; readonly returnFocus?: RefObject<HTMLElement | null> }): MenuLayer {
  const group = useContext(MenuGroupContext);
  const grouped = group !== null && menu !== undefined;
  // the number of dismissals when the layer was opened, or null while it is closed: a later dismissal closes it
  const dismissals = useEditorState((s) => s.ui.overlays.dismissals);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const open = grouped ? group.active === menu : openedAt !== null && openedAt === dismissals;
  const dismissed = grouped ? group.dismissed === menu : openedAt !== null && !open;
  const returnFocus = options?.returnFocus ?? button;
  useEffect(() => {
    if (dismissed && (document.activeElement === null || document.activeElement === document.body)) returnFocus.current?.focus();
  }, [dismissed, returnFocus]);
  // The focus goes into the layer's first item: the menu key context lives there, so Escape reaches it. A layer opened
  // by a press alone left the focus on its trigger, and Escape went to another context and closed nothing.
  useEffect(() => {
    if (open) list?.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [open, list]);
  const close = grouped ? group.close : () => setOpenedAt(null);
  const fallback = useRef<HTMLElement>(null);
  useOutsideLayer(list ?? fallback, open && list !== undefined, () => {
    options?.onOutside?.();
    close();
  }, button, true, returnFocus);
  return {
    open,
    toggle: grouped ? () => group.toggle(menu) : () => setOpenedAt(open ? null : dismissals),
    close,
  };
}

export function MenuButton({ menu, anchor, children, indicator = false, className }: MenuButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const layer = useMenuLayer(button, undefined, menu);
  const t = useT();
  const label = t(menuOf(menu).labelKey as MessageId);
  const icon = anchor.icon !== null ? <Icon name={anchor.icon} size={anchor.drawnAs === 'icon-button' ? 'md' : 'sm'} /> : null;
  return (
    <div className={['menu-anchor', className ?? ''].filter((c) => c !== '').join(' ')}>
      <button
        ref={button}
        type="button"
        className={`menu-button menu-button--${anchor.drawnAs}${layer.open ? ' is-open' : ''}`}
        data-menu={menu}
        aria-haspopup="menu"
        aria-expanded={layer.open}
        aria-label={anchor.drawnAs === 'icon-button' || children !== undefined ? label : undefined}
        title={label}
        onClick={layer.toggle}
      >
        {icon}
        {anchor.drawnAs === 'icon-button' ? null : (children ?? <span className="door__label">{label}</span>)}
        {indicator ? <Icon name={GLYPHS.dropdown} size="xs" /> : null}
      </button>
      {layer.open ? <MenuList menu={menu} onDone={layer.close} focusFirst anchor={button} /> : null}
    </div>
  );
}

// The context menu's items: the doors the manifest places in the context-menu region, in their order.
const CONTEXT_ITEMS = doorSlots('context-menu');

// The context menu (archive/DESIGN.md "Overlays", spec context-menu), open while the editor state says so
// (menus/context-menu.ts); each opening draws a new one.
export function ContextMenu() {
  const opened = useEditorState((s) => openContextMenu(s.ui));
  return opened === null ? null : <OpenContextMenu key={opened.count} />;
}

// An open context menu. Its items are the commands that apply to the selection when it opens (store.canRun: built,
// available and not refused), in the manifest's order: no disabled item and no "not available yet" item; nothing is
// drawn when none applies. It opens at the pointer (the last press, pointer.ts) and stays inside the window, with the
// --space-4 token between it and the window's edge. The focus goes to its first item and, when the menu closes, back
// where it was (a Layers row), when that is still there. An item runs its command's door and then dismisses the menu
// (ui.dismiss, the command the backdrop runs), so every way of closing it is a dismissal.
function OpenContextMenu() {
  const store = useStore();
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  const dismiss = () => {
    if (BACKDROP) (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(BACKDROP.command.id, BACKDROP.door.args);
  };
  useOutsideLayer(list, true, dismiss);
  const items = useMemo(() => CONTEXT_ITEMS.filter((entry) => isDoorBuilt(entry) && store.canRun(entry.command.id, entry.door.args as never)), [store]);
  const views = usePointerViews();
  const start = views.pressPoint() ?? { x: 0, y: 0 };
  // where the menu is drawn: at the pointer, then moved inside the window once its size is known (a layout measure)
  const [at, setAt] = useState({ left: start.x, top: start.y });
  useLayoutEffect(() => {
    const menu = list.current;
    if (!menu) return;
    const edge = parseFloat(getComputedStyle(menu).getPropertyValue('--space-4')) || 0;
    const { width, height } = menu.getBoundingClientRect();
    setAt(floatBelow(pointAnchor(start.x, start.y), { width, height }, { width: window.innerWidth, height: window.innerHeight }, edge));
  }, [start.x, start.y]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="context-menu" data-context-menu>
      <div className="menu" role="menu" ref={list} aria-label={t('contextMenu.label')} data-region="context-menu" data-key-context="menu" style={{ left: at.left, top: at.top }}>
        {items.map((entry) => (
          <MenuItem key={entry.ref} entry={entry} onDone={dismiss} keysIn="canvas" />
        ))}
      </div>
    </div>
  );
}

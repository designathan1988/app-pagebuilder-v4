// The Layers section (spec layers-tree): the shown page's tree, one row per node, drawn as a window of the rows in
// view, with its search, the row's name field, colour, details, empty mark and the pick targets of the interactions
// and the motion panel.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type MouseEvent } from 'react';
import { walk, type DocNode } from '../../../core/document/model.ts';
import { layerColourCss } from '../../../core/nodes/flags.ts';
import { pageShown, openedPage } from '../../../core/project/pages.ts';
import type { DispatchResult } from '../../../core/store/store.ts';
import type { CommandId } from '../../../generated/ids.ts';
import { elementIcon, manifest, type DoorEntry } from '../../../manifest/runtime.ts';
import { DoorControl, Icon, useDoor } from '../../doors/door.tsx';
import { GLYPHS, doorSlots } from '../../doors/placement.ts';
import { drag, modifierOf, pointerPressing } from '../../input/pointer.ts';
import { renamedNode } from '../../layers/rename.ts';
import { isExpanded, rowDetailsOf, searchView, type SearchView } from '../../layers/tree.ts';
import { useEditorState, useStore } from '../../store.ts';
import { isPanelOpen } from '../../workspace/panels.ts';
import { panelName } from '../../workspace/panel-catalogue.ts';
import { floatingOf } from '../../workspace/layout.ts';
import { PanelGrip } from '../../workspace/windows.tsx';
import { DOCK_BACK } from '../view-title.tsx';
import { useT } from '../../text.ts';
import { Slots } from '../slots.tsx';
import { LAYERS_PICK } from '../interactions.tsx';
import { pickingTarget } from '../../inspector/pick-target.ts';
import { motionPicking } from '../../motion/state.ts';
import { findTimeline } from '../../../core/motion/document.ts';
import { requireDoor, drawnAs } from './doors.tsx';
import { insertDestination } from './insert.tsx';

const LAYERS_HEADER = requireDoor('explorer-layers', (d) => drawnAs(d) === 'disclosure');

// a Layers row's plain click: the row's door of the layers-row-click gesture with no key held
const LAYERS_SELECT = requireDoor('layers-row', (d) => d.door.kind === 'panel-control' && d.door.gesture === 'layers-row-click' && d.door.modifier === null);

// the row's other clicks: the doors of the same gesture with a key held (Shift+click adds, Ctrl+click toggles)
const LAYERS_MODIFIED = doorSlots('layers-row').filter((d) => d.door.kind === 'panel-control' && d.door.gesture === 'layers-row-click' && d.door.modifier !== null);

// the row pressed with the secondary button: the door whose button is the secondary one (the context menu)
const LAYERS_SECONDARY = requireDoor('layers-row', (d) => d.door.kind === 'panel-control' && d.door.button === 'secondary');

const LAYERS_CARET = requireDoor('layers-row', (d) => drawnAs(d) === 'disclosure');

const LAYERS_BUTTONS = doorSlots('layers-row').filter((d) => drawnAs(d) === 'icon-button');

// the label colour's own door: a row offers the palette under its dot (spec layers-row-colours)
const LAYERS_COLOUR = LAYERS_BUTTONS.find((d) => d.door.kind === 'panel-control' && d.door.control === 'row-colour-dot');

// the palette the dot opens: the design tokens interactions.json names, in their order (one owner: the manifest)
const LAYER_COLOURS = (manifest.interactions.layerColours ?? []) as readonly string[];

// the row's name: the control a number of clicks runs (its double-click renames the row's node in place, spec
// rename-element), and the field that takes the name's place while the node is renamed
const LAYERS_NAME = requireDoor('layers-row', (d) => d.door.kind === 'panel-control' && d.door.count !== undefined);

const NAME_CLICKS = LAYERS_NAME.door.kind === 'panel-control' ? LAYERS_NAME.door.count : undefined;

const LAYERS_NAME_FIELD = requireDoor('layers-row', (d) => drawnAs(d) === 'field' && d.door.adapter.selection === 'target');

// the search field above the rows: the region's field that acts on no selection (spec layers-search)
const LAYERS_SEARCH = requireDoor('layers-row', (d) => drawnAs(d) === 'field' && d.door.adapter.selection === 'none');

// A row's name while its node is renamed (spec rename-element, layers/rename.ts): a field holding the name, which
// takes the focus with the whole name selected once it is drawn (after a menu that started the rename has given its
// own focus back), so typing replaces it. Enter (the form's submit) or leaving the field keeps what it holds, once:
// element.rename ends the rename, and the field that leaves the page then keeps nothing more.
function NameField({ node }: { readonly node: DocNode }) {
  const field = useDoor(LAYERS_NAME_FIELD, { target: node.id });
  const store = useStore();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const keep = (name: string) => {
    if (!field.built || renamedNode(store.getState().ui) !== node.id) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(LAYERS_NAME_FIELD.command.id as CommandId, { ...LAYERS_NAME_FIELD.door.args, target: node.id, name });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    keep(input.current?.value ?? node.name);
  };
  return (
    <form className="row__rename" onSubmit={submit}>
      <input
        ref={input}
        className="row__name-field"
        type="text"
        defaultValue={node.name}
        aria-label={field.label}
        title={field.title}
        spellCheck={false}
        autoComplete="off"
        data-door={LAYERS_NAME_FIELD.ref}
        data-args={JSON.stringify({ target: node.id })}
        // Escape cancels the rename, keeping the name (layers.cancelRename, its key context; the audit's U-019)
        data-key-context="rename-field"
        onBlur={(event) => keep(event.currentTarget.value)}
      />
    </form>
  );
}

// A node's row, then, while its branch is unfolded, its children's rows. A click on the row selects its node, a
// Shift+click adds it to the selection and a Ctrl+click toggles it (spec multi-select-click), a secondary click opens
// the context menu on it (spec context-menu); a click on a control
// of its own (the caret, Hide, Lock) runs that control's door alone. Its name is part of the row: a click on it selects
// as the row's does, and the click its door counts (the second of a double-click) renames the node the first click
// selected (spec rename-element); while the node is renamed, the name field takes the name's place. The primary
// selection's row
// is scrolled into view, at the nearest edge and without animation, whichever surface selected it (spec layers-tree,
// Problems in Pager 1). A hidden node's row is dimmed, and its Hide stays shown, pressed (spec hide-element); a
// locked node's row keeps its Lock shown, pressed (spec lock-element).
// What a row shows beside its name (spec layers-row-columns, layers.setRowDetails): its HTML tag, its id (#id), its
// classes (.a .b) and its attributes (name=value), each only while chosen.

// The label colour of a Layers row (spec layers-row-colours; core/nodes/flags.ts element.setLayerColor): the dot the
// row draws opens the palette under it while the pointer is on it (or the keyboard reaches it), one swatch per design
// token interactions.json names, and the row's own colour is marked. A swatch runs the dot's door with the colour the
// token stands for — the value the stylesheet holds, so the document keeps a colour and not the name of a token — and
// the dot's door with no colour takes it away again, which the palette's first row offers while a colour is set. The
// row wears the colour and the canvas draws the element's selection in it; it never reaches the export.
// A coloured row's palette stands where its dot is, before its icon, the dot its door (lead); a row without a colour
// offers it among its actions, on the row's hover.
function LayerPalette({ entry, node, lead = false }: { readonly entry: DoorEntry; readonly node: DocNode; readonly lead?: boolean }) {
  const t = useT();
  // the palette is open while the person is using it: the dot's press opens it (its own command re-writes the colour
  // it already holds, so the press changes nothing), a swatch press closes it
  const [open, setOpen] = useState(false);
  const chosen = useEditorState((s) => s.document.pages[openedPage(s)]?.tree.layerColors?.find((one) => one.node === node.id)?.colour);
  // the swatch wears the colour the token stands for (read from the stylesheet), while the door keeps the token's
  // name, which is the same in every theme and a colour CSS understands wherever the document draws it
  const value = (token: string) => {
    const held = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return held === '' ? token : held;
  };
  return (
    <span className={`row__palette${lead ? ' row__palette--lead' : ''}${open ? ' is-open' : ''}`} style={chosen === undefined ? undefined : { '--row-colour': layerColourCss(chosen) } as CSSProperties}>
      <span onClick={() => setOpen((one) => !one)}>
        <DoorControl entry={entry} args={{ target: node.id, color: chosen ?? '' }} tabbable={false} {...(lead ? { icon: null } : {})} />
      </span>
      {lead && chosen !== undefined ? <span className="row__colour-dot" style={{ '--row-colour': layerColourCss(chosen) } as CSSProperties} aria-hidden /> : null}
      <span className="row__swatches" role="group" aria-label={t('layers.labelColour')}>
        {chosen === undefined ? null : <span className="row__swatch row__swatch--none" onClick={() => setOpen(false)}><DoorControl entry={entry} args={{ target: node.id, color: '' }} tabbable={false} /></span>}
        {/* the colour the row wears is drawn marked and is no door: pressing it would change nothing, and the dot
            already stands for it (two controls of one door for the same colour could not be told apart) */}
        {LAYER_COLOURS.map((token) =>
          token === chosen ? (
            <span key={token} className="row__swatch is-chosen" style={{ background: value(token) }} role="img" aria-label={t('layers.colourChosen')} />
          ) : (
            <span key={token} className="row__swatch" style={{ background: value(token) }} onClick={() => setOpen(false)}><DoorControl entry={entry} args={{ target: node.id, color: token }} tabbable={false} /></span>
          ),
        )}
      </span>
    </span>
  );
}

function RowDetails({ node }: { readonly node: DocNode }) {
  const details = useEditorState((s) => rowDetailsOf(s.ui));
  const parts: string[] = [];
  for (const detail of details) {
    if (detail === 'tag' && node.tag !== null) parts.push(node.tag);
    if (detail === 'id' && typeof node.attributes.id === 'string') parts.push(`#${node.attributes.id}`);
    if (detail === 'classes' && node.classes.length > 0) parts.push(node.classes.map((c) => `.${c}`).join(' '));
    if (detail === 'attributes') {
      const own = Object.entries(node.attributes).filter(([name]) => name !== 'id').map(([name, value]) => (value === true ? name : `${name}=${String(value)}`));
      const custom = Object.entries(node.customAttributes ?? {}).map(([name, value]) => (value === '' ? name : `${name}=${value}`));
      if (own.length + custom.length > 0) parts.push([...own, ...custom].join(' '));
    }
  }
  return parts.length === 0 ? null : (
    <span className="row__meta" data-region="layers-row-details">
      {parts.join(' ')}
    </span>
  );
}

// A row of a text element whose text is empty says so beside its name (spec text-edit-inline, Problems in Pager 4):
// the canvas draws it with a minimum height, the Layers row names it empty.
const TEXT_TYPES: ReadonlySet<string> = new Set(manifest.elements.elements.filter((e) => e.content === 'text').map((e) => e.id));

function EmptyMark({ node }: { readonly node: DocNode }) {
  const t = useT();
  return TEXT_TYPES.has(node.type) && (node.text ?? '') === '' ? (
    <span className="row__meta" data-region="layers-row-empty">
      {t('layers.empty')}
    </span>
  ) : null;
}

// The height a row is drawn with: the token the shell draws every row with (PRODUCT.md §5.3), so the window and the
// rows agree by construction (the user's real-use audit, A3.28)
const ROW = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--size-row')) || 24;

// the rows drawn beyond the scroll window, so a scroll never shows a gap
const OVERSCAN = 8;

// The rows the panel shows, in draw order (A3.28: a page of 1205 elements drew 17 160 nodes, one row each): the tree
// walked depth first, a node's children after it while it is open (every branch while the Layers is searched, spec
// layers-search), and a node the search hides left out with its subtree. Which of them are drawn is the window's.
function shownRows(tree: DocNode, open: (id: string) => boolean, view: SearchView | null): { readonly node: DocNode; readonly depth: number }[] {
  const rows: { node: DocNode; depth: number }[] = [];
  const visit = (node: DocNode, depth: number) => {
    if (view !== null && !view.shown.has(node.id)) return;
    rows.push({ node, depth });
    if (view !== null || open(node.id)) for (const child of node.children) visit(child, depth + 1);
  };
  visit(tree, 0);
  return rows;
}

// Where a palette click would insert (the user's real-use audit, A3.19): the parent whose children it joins, and the
// sibling it follows (null: it goes first). The row there draws the dashed line.
interface InsertAt {
  readonly parent: string;
  readonly previous: string | null;
}

// the icon an instance of a component wears in its Layers row (the Insert view's components wear it too)
const COMPONENT_ICON = 'component';

function LayersRow({ node, depth, view }: { readonly node: DocNode; readonly depth: number; readonly view: SearchView | null }) {
  const t = useT();
  const door = useDoor(LAYERS_SELECT, { target: node.id });
  const rename = useDoor(LAYERS_NAME);
  const selected = useEditorState((s) => s.selection.includes(node.id));
  // the row's label colour (spec layers-row-colours): the page's own note about this node
  const colour = useEditorState((s) => s.document.pages[openedPage(s)]?.tree.layerColors?.find((one) => one.node === node.id)?.colour);
  // the tree is one Tab stop (spec layers-keyboard-navigation, Problems in Pager 3): the primary selected row, else the
  // page root's row, takes the Tab key; every other row is reached with the arrow keys
  const tabStop = useEditorState((s) => (s.selection[0] === undefined ? depth === 0 : s.selection[0] === node.id));
  const expanded = useEditorState((s) => isExpanded(s.ui, node.id));
  const renaming = useEditorState((s) => renamedNode(s.ui) === node.id);
  // a drag in progress, from Layers or from the canvas (spec layers-drag): the row its drop is placed against says
  // where (before, after, inside, or refused over the dragged nodes' own subtree), and the receiving parent's row is
  // marked, except while the drop is refused (Problems in Pager 4)
  const dropping = useSyncExternalStore(drag.subscribe, drag.get);
  const proposal = dropping?.proposal ?? null;
  const dropAt = proposal !== null && proposal.reference === node.id ? (proposal.refused ? 'refused' : proposal.placement) : undefined;
  const receiving = proposal !== null && !proposal.refused && proposal.placement !== 'inside' && proposal.parent === node.id;
  const store = useStore();
  const branch = node.children.length > 0;
  // while Layers is searched, only the rows that match and the rows above them show, unfolded (spec layers-search)
  const open = view !== null ? true : expanded;
  const match = view !== null && view.matches.has(node.id);
  // a click with no key held runs the row's own door (the rename on its name's counted click); with a key held, the
  // door of that key (none for another key)
  const select = (event: MouseEvent<HTMLDivElement>) => {
    const on = event.target instanceof Element ? event.target.closest('[data-door]') : null;
    const onName = on !== null && on !== event.currentTarget && on.getAttribute('data-door') === LAYERS_NAME.ref;
    if (on !== event.currentTarget && !onName) return;
    const held = modifierOf(event);
    if (held === null) {
      if (onName && event.detail === NAME_CLICKS) rename.run();
      else door.run();
      return;
    }
    const entry = LAYERS_MODIFIED.find((d) => d.door.kind === 'panel-control' && d.door.modifier === held);
    if (entry) (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, target: node.id });
  };
  // a secondary click anywhere on the row runs the row's secondary door (the context menu) instead of the browser's
  // own menu, except in the name field, whose text keeps the browser's; the keyboard's menu key is no door, so a
  // contextmenu event it sends is left to the browser
  const secondary = useDoor(LAYERS_SECONDARY, { target: node.id });
  const openMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return;
    if (event.target instanceof Element && event.target.closest('[data-door]')?.getAttribute('data-door') === LAYERS_NAME_FIELD.ref) return;
    event.preventDefault();
    secondary.run();
  };
  if (view !== null && !view.shown.has(node.id)) return null;
  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={branch ? open : undefined}
        aria-disabled={door.built ? undefined : true}
        aria-level={depth + 1}
        tabIndex={tabStop ? 0 : -1}
        className={`row row--tree${selected ? ' is-selected' : ''}${node.hidden === true ? ' row--hidden' : ''}${node.locked === true ? ' row--locked' : ''}${receiving ? ' is-receiving' : ''}${match ? ' is-match' : ''}${colour === undefined ? '' : ' is-coloured'}`}
        data-drop-position={dropAt}
        style={{ ...(({ '--depth': depth }) as CSSProperties), ...(colour === undefined ? {} : ({ '--row-colour': layerColourCss(colour) } as CSSProperties)) }}
        title={door.title}
        data-door={LAYERS_SELECT.ref}
        data-args={JSON.stringify({ target: node.id })}
        onClick={select}
        onContextMenu={openMenu}
      >
        {branch ? (
          <DoorControl entry={LAYERS_CARET} args={{ target: node.id }} expanded={open} tabbable={false}>
            {null}
          </DoorControl>
        ) : (
          <span className="row__caret-space" />
        )}
        {/* a coloured row shows its colour before its icon, as the canonical layers list does (stage 5); the palette
            that chooses it stays among the row's actions */}
        {colour === undefined || LAYERS_COLOUR === undefined ? null : <LayerPalette entry={LAYERS_COLOUR} node={node} lead />}
        {/* an instance of a component wears the component's icon and names its component (jornada03 J21) */}
        <Icon name={node.component !== undefined ? COMPONENT_ICON : (elementIcon(node.type) ?? GLYPHS.folder)} size="sm" />
        {renaming ? (
          <NameField node={node} />
        ) : (
          <span
            className="row__name"
            data-door={LAYERS_NAME.ref}
            data-args={JSON.stringify({ target: node.id })}
            tabIndex={-1}
            aria-disabled={rename.built ? undefined : true}
            title={rename.built ? rename.label : rename.title}
          >
            {node.name}
          </span>
        )}
        {node.component !== undefined ? (
          <span className="row__component" data-row-component={node.component} title={t('layers.instanceOf', { component: node.component })}>
            {node.component}
          </span>
        ) : null}
        <RowDetails node={node} />
        <EmptyMark node={node} />
        <span className="row__actions">
          {LAYERS_BUTTONS.map((b) =>
            b.ref !== LAYERS_COLOUR?.ref ? (
              <DoorControl key={b.ref} entry={b} args={{ target: node.id }} tabbable={false} />
            ) : (
              colour === undefined ? <LayerPalette key={b.ref} entry={b} node={node} /> : null
            ),
          )}
          <RowPickTarget node={node} />
          <RowPickMotionTarget node={node} />
        </span>
      </div>
    </>
  );
}

// The row's pick control (spec events-actions: "the target is picked on the canvas or on a Layers row"): drawn on
// every row while an interaction's target is being picked, a press gives the row's node through
// interactions.update#layers-row-pick-target. Nothing is drawn while no target is being picked.
function RowPickTarget({ node }: { readonly node: DocNode }) {
  const t = useT();
  const store = useStore();
  const picking = useEditorState((s) => pickingTarget(s.ui));
  const entry = LAYERS_PICK;
  if (picking === null || entry === null) return null;
  return (
    <button
      type="button"
      className="row__button"
      data-door={entry.ref}
      data-args={JSON.stringify({ ...entry.door.args, target: node.id, interaction: picking })}
      title={t('interactions.pickTarget')}
      onClick={() => (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, interaction: picking, changes: { target: node.id } })}
    >
      <Icon name="locate-fixed" size="sm" />
      <span className="visually-hidden">{t('interactions.pickTarget')}</span>
    </button>
  );
}

// The row's pick control for a motion action's target (spec motion-timeline: "picked on the canvas or on a Layers
// row"): drawn on every row while an action's target is being picked, a press gives the row's node through
// motion.updateAction#layers-row-pick-motion-target. Nothing is drawn while none is being picked.
const LAYERS_MOTION_PICK = manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.panel === 'layers' && d.door.control === 'row-pick-motion-target') ?? null;

function RowPickMotionTarget({ node }: { readonly node: DocNode }) {
  const t = useT();
  const store = useStore();
  const picking = useEditorState((s) => motionPicking(s.ui));
  // the action's place in its timeline, which the row's control stands for with the timeline
  const at = useEditorState((s) => (picking === null ? -1 : (findTimeline(s.document, picking.timeline)?.timeline.actions.findIndex((one) => one.id === picking.action) ?? -1)));
  const entry = LAYERS_MOTION_PICK;
  if (picking === null || entry === null) return null;
  const args = { ...entry.door.args, timeline: picking.timeline, action: picking.action, value: { kind: 'element', node: node.id } };
  return (
    <button
      type="button"
      className="row__button"
      data-door={entry.ref}
      data-args={JSON.stringify({ ...entry.door.args, timeline: picking.timeline, at, target: node.id })}
      title={t('motion.pickTarget')}
      onClick={() => (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id as CommandId, args)}
    >
      <Icon name="locate-fixed" size="sm" />
      <span className="visually-hidden">{t('motion.pickTarget')}</span>
    </button>
  );
}

// The dashed line where a palette click would insert (the user's real-use audit, A3.19): right under the container
// whose first child it becomes, or under the sibling it follows
function InsertMark({ at, node, depth }: { readonly at: InsertAt | null; readonly node: DocNode; readonly depth: number }) {
  if (at === null) return null;
  const under = at.previous === node.id ? depth : at.previous === null && at.parent === node.id ? depth + 1 : null;
  return under === null ? null : <div className="row__insert" data-insert-line style={{ '--depth': under } as CSSProperties} />;
}

// The Layers search field (spec layers-search): each change runs layers.search with what it holds; Enter keeps it
function LayersSearch() {
  const field = useDoor(LAYERS_SEARCH);
  const query = useEditorState((s) => s.ui.layers.query);
  const store = useStore();
  const change = (text: string) => {
    if (!field.built) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(LAYERS_SEARCH.command.id as CommandId, { ...LAYERS_SEARCH.door.args, query: text });
  };
  return (
    <form className="layers__search" data-door={LAYERS_SEARCH.ref} data-args="{}" onSubmit={(event) => event.preventDefault()}>
      <input
        className="search"
        type="search"
        placeholder={field.label}
        aria-label={field.label}
        title={field.title}
        disabled={!field.built}
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(event) => change(event.target.value)}
      />
    </form>
  );
}

// how many nodes the tree has, whatever is folded (spec layers-tree, Problems in Pager 3)
const nodeCount = (tree: DocNode): number => [...walk(tree)].length;

// The Layers section (spec layers-tree): its title with the node count and the panel's controls, its search field and
// the tree. It belongs to no view (layout.json): the sidebar shows it in the stack below whatever view shows, so the
// palette and the Layers are visible together (the user's real-use audit, item 3.9; spec panel-resize).
export function LayersSection() {
  const t = useT();
  const layersOpen = useEditorState((s) => isPanelOpen(s.ui, 'layers'));
  const layersFloat = useEditorState((s) => floatingOf(s.ui, 'layers') !== null);
  const layersAway = useEditorState((s) => floatingOf(s.ui, 'layers') !== null || (s.ui.layout.right ?? []).includes('layers'));
  const tree = useEditorState((s) => pageShown(s)?.tree);
  const collapsed = useEditorState((s) => s.ui.layers.collapsed);
  const query = useEditorState((s) => s.ui.layers.query);
  const view = useMemo(() => (tree ? searchView(tree, query) : null), [tree, query]);
  // where a palette click would insert now, as one JSON text (the hook's value stays stable)
  const said = useEditorState((s) => {
    const at = insertDestination(s);
    return at === null ? null : JSON.stringify({ parent: at.parent.node.id, previous: at.previous?.id ?? null });
  });
  const insertAt = said === null ? null : (JSON.parse(said) as InsertAt);
  // every row the panel shows, in draw order
  const rows = useMemo(() => (tree === undefined ? [] : shownRows(tree, (id) => !collapsed.includes(id), view)), [tree, collapsed, view]);
  // the scroll window: which rows are drawn (the window plus an overscan, measured from the scroller)
  const scroller = useRef<HTMLDivElement>(null);
  const [window, setWindow] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const measure = () => setWindow({ top: el.scrollTop, height: el.clientHeight });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [layersOpen]);
  const primary = useEditorState((s) => s.selection[0] ?? null);
  // the row the keyboard is on (spec layers-keyboard-navigation: the arrows move the focus among the rows): the window
  // scrolls with it, so the next row the arrow reaches is drawn too
  const onFocusIn = (event: React.FocusEvent<HTMLDivElement>) => {
    const el = scroller.current;
    const row = event.target instanceof Element ? event.target.closest('[data-args]') : null;
    const parsed: unknown = row === null ? null : JSON.parse(row.getAttribute('data-args') ?? '{}');
    const node = parsed !== null && typeof parsed === 'object' ? (parsed as { target?: unknown }).target : undefined;
    if (typeof node !== 'string') return;
    // a press focuses the row under the pointer, which needs no scrolling (and would move the row under it away from
    // the pointer, its own context menu landing on the next row): only the keyboard's focus moves the window
    if (pointerPressing()) return;
    const at = rows.findIndex((r) => r.node.id === node);
    if (el === null || at < 0) return;
    const top = at * ROW;
    if (top < el.scrollTop + ROW) el.scrollTop = Math.max(0, top - ROW);
    else if (top + ROW > el.scrollTop + el.clientHeight - ROW) el.scrollTop = top + ROW * 2 - el.clientHeight;
  };
  // the tree's Tab stop: the primary selected row, else the root's (spec layers-keyboard-navigation); always drawn
  const tabStop = primary ?? rows[0]?.node.id ?? null;
  const first = Math.max(0, Math.floor(window.top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((window.top + window.height) / ROW) + OVERSCAN);
  const drawn = useMemo(() => {
    const out: { node: DocNode; depth: number; index: number }[] = [];
    const wanted = new Set<number>();
    for (let i = first; i < last; i += 1) wanted.add(i);
    // the tree's Tab stop, outside the window, is drawn too (the focus may not be lost to a row unmounting), and so
    // are the first and the last row: the keyboard's Home and End reach them, and the window following the focus
    // draws the rows between them as the arrows walk to them (spec layers-keyboard-navigation)
    wanted.add(0);
    if (rows.length > 0) wanted.add(rows.length - 1);
    for (const keep of [tabStop]) {
      const at = keep === null ? -1 : rows.findIndex((r) => r.node.id === keep);
      if (at >= 0) wanted.add(at);
    }
    for (const i of [...wanted].sort((a, b) => a - b)) {
      const row = rows[i];
      if (row !== undefined) out.push({ ...row, index: i });
    }
    return out;
  }, [rows, first, last, tabStop]);
  // the scroll follows the primary selection: selecting on the canvas brings its row into the view, once per selection
  // (never again on a later document change, which would drag the tree back from where the person scrolled it)
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    const el = scroller.current;
    const at = primary === null ? -1 : rows.findIndex((r) => r.node.id === primary);
    if (el === null || at < 0 || scrolledTo.current === primary) return;
    scrolledTo.current = primary;
    const top = at * ROW;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
  }, [primary, rows]);
  return (
    <section className="view view--section" aria-label={t(panelName('layers'))} data-region="explorer-layers" data-panel-area="layers">
      <div className="section-title" data-panel-header={layersOpen ? 'layers' : undefined}>
        <DoorControl entry={LAYERS_HEADER} expanded={layersOpen} className="section-title__toggle" />
        {layersOpen ? <PanelGrip panel="layers" floating={layersFloat} /> : null}
        {tree ? (
          <span className="section-title__count" data-count="layers">
            {nodeCount(tree)}
          </span>
        ) : null}
        <span className="section-title__actions">
          <Slots region="explorer-layers" render={(slot) => (slot.kind === 'door' && slot.entry === LAYERS_HEADER ? null : undefined)} />
          {/* away from the sidebar (floating, or docked right), the header puts the Layers back (spec
             floating-panels) */}
          {layersAway && DOCK_BACK ? <DoorControl entry={DOCK_BACK} args={{ panel: 'layers' }} /> : null}
        </span>
      </div>
      {layersOpen && tree ? (
        // the rows' region holds the search field above the tree (manifest: its door is placed in layers-row)
        <div data-region="layers-row">
          <LayersSearch />
          {/* a search that matches no layer says so, instead of an empty tree (the audit's U-020) */}
          {view !== null && view.matches.size === 0 ? <p className="layers-search__none">{t('layers.searchNoMatch', { query })}</p> : null}
          <div role="tree" aria-label={t(panelName('layers'))} data-region="layers-tree" data-key-context="layers-tree" className="layers-tree" ref={scroller} onFocusCapture={onFocusIn}>
            {/* only the rows the scroll shows are drawn (A3.28: a page of 1205 elements drew 17 160 nodes); the
                board is as tall as every row, so the scrollbar tells the truth */}
            <div className="layers-tree__board" style={{ height: rows.length * ROW }}>
              {drawn.map(({ node, depth, index }) => (
                <div key={node.id} className="layers-tree__slot" style={{ top: index * ROW }}>
                  <LayersRow node={node} depth={depth} view={view} />
                  <InsertMark at={insertAt} node={node} depth={depth} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

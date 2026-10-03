import { MODULE_SIDEBAR_VIEWS } from '../../app/modules-view.ts';
import { AssistantPanel } from '../assistant/panel.tsx';
import { DataPanel } from '../data/panel.tsx';
// The activity bar and the sidebar (archive/DESIGN.md "Regions"): Explorer (Pages, Files, Layers), Insert (the element
// grid of elements.json's palette) and Styles (classes and variables). Rows and tiles are the doors of their regions,
// one per page, node or palette entry; a section's actions are the region's controls before its first item.
import { isDataFile } from '../../core/design/data.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { isFeatureBuilt } from '../../app/features.ts';
import { walk, type DocNode, type Location, type Page } from '../../core/document/model.ts';
import { placement } from '../../core/structure/insert.ts';
import { layerColourCss } from '../../core/nodes/flags.ts';
import { pageShown } from '../../core/project/pages.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId, MessageId, RegionId } from '../../generated/ids.ts';
import { elementIcon, manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { openedPage } from '../../core/project/pages.ts';
import { DoorControl, Icon, useDoor } from '../doors/door.tsx';
import { GLYPHS, doorSlots } from '../doors/placement.ts';
import { fileAt, folderOf, folderPaths, nameOfPath, objectUrl, pathGenerated, sizeLabel } from '../../core/files/files.ts';
import { treeRows, type TreeRow } from '../explorer/explorer.ts';
import { afterGesture, drag, modifierOf, pointerPressing } from '../input/pointer.ts';
import { renamedNode } from '../layers/rename.ts';
import { paletteDensity, paletteMatches, paletteRank } from '../palette/palette.ts';
import { isExpanded, rowDetailsOf, searchView, type SearchView } from '../layers/tree.ts';
import { MODEL_RULES, useEditorState, useStore, type EditorState } from '../store.ts';
import { atPlace, isPanelOpen, toggleLeftDock } from '../workspace/panels.ts';
import { panelName, stackedSections, type Panel } from '../workspace/panel-catalogue.ts';
import { useNarrowWindow } from '../workspace/narrow.ts';
import { useOutsideLayer } from './outside-layer.ts';
import { Splitter } from './splitter.tsx';
import { outsidePress } from '../input/pointer/views.ts';
import { combinationAt, splitterSize } from '../workspace/layout.ts';
import { PanelArea, PanelGrip } from '../workspace/windows.tsx';
import { floatingOf } from '../workspace/layout.ts';
import { DOCK_BACK, ViewTitle } from './view-title.tsx';
import { useLocale, useT } from '../text.ts';
import { hasText, translate, type Locale } from '../../i18n/index.ts';
import type { BodyTable } from './bodies.ts';
import { Slots } from './slots.tsx';
import { SiteColours, Suggestions, Variables } from './variables.tsx';
import { classesOf, usesOfClass } from '../../core/design/classes.ts';
import { componentsOf } from '../../core/design/instances.ts';
import { LAYERS_PICK } from './interactions.tsx';
import { pickingTarget } from '../inspector/pick-target.ts';
import { motionPicking } from '../motion/state.ts';
import { findTimeline } from '../../core/motion/document.ts';


const drawnAs = (entry: DoorEntry): string | null => (entry.door.kind === 'toolbar' || entry.door.kind === 'panel-control' ? entry.door.drawnAs : null);
const orderOf = (entry: DoorEntry): number => (typeof entry.door.placement === 'object' ? entry.door.placement.order : 0);

function requireDoor(region: RegionId, test: (entry: DoorEntry) => boolean): DoorEntry {
  const found = doorSlots(region).find(test);
  if (!found) throw new Error(`region ${region} has no such door`);
  return found;
}

// the order of a region's first item or field: the controls before it are the section's actions
// The order of the region's first door that is drawn as one of its items or fields: the title above draws the doors
// that come before it. A door the caller draws elsewhere (the makers, whose paths are typed into the rows) is not one
// of them: it is skipped here too, or every door between it and the next item would never be drawn.
function itemOrder(region: RegionId, skip?: (entry: DoorEntry) => boolean): number {
  const item = doorSlots(region).find((d) => (drawnAs(d) === 'item' || drawnAs(d) === 'field') && !(skip !== undefined && skip(d)));
  return item ? orderOf(item) : Number.POSITIVE_INFINITY;
}

const PAGE_ROW = requireDoor('explorer-pages', (d) => drawnAs(d) === 'item');
// the row's name field (pages.rename): the region's one field
const PAGE_NAME = requireDoor('explorer-pages', (d) => drawnAs(d) === 'field');
// the files tree's name field, the door a row's rename runs (the door's own control: the field itself)
const RENAME_DOOR = requireDoor('explorer-files', (d) => d.door.kind === 'panel-control' && d.door.control === 'file-name-field');
// the door a row is dragged by (the Explorer's file tree): its press drags the row, its release on a folder moves it.
// It is a gesture, not a placed control, so it is looked up among the manifest's doors by what it is drawn on.
const DRAG_ROW = manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'explorer-row') ?? undefined;
// the door a double-click on a row's name renames with (the Layers row's own pattern): the field it opens is
// files.rename's, drawn in the name's place
const RENAME_START = requireDoor('explorer-files', (d) => d.door.kind === 'panel-control' && d.door.control === 'file-name');
// the Files section's Upload button, and the command its folder drop runs (spec explorer-assets)
const PAGE_ACTIONS = doorSlots('explorer-pages').filter((d) => drawnAs(d) === 'icon-button' && orderOf(d) > orderOf(PAGE_ROW));
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
// an element tile: the item whose command takes a palette entry (a component tile takes a component)
const INSERT_TILE = requireDoor('insert', (d) => drawnAs(d) === 'item' && Object.values(d.command.args).some((a) => a.type === 'palette-entry'));
const INSERT_GROUP = requireDoor('insert', (d) => drawnAs(d) === 'disclosure');
// a component's tile (components.insertInstance): the project's components, after the element groups
const COMPONENT_TILE = requireDoor('insert', (d) => drawnAs(d) === 'item' && 'component' in d.command.args);

export function ActivityBar() {
  const t = useT();
  const ui = useEditorState((s) => s.ui);
  return (
    <nav className="activity-bar" data-region="activity-bar" data-key-context="toolbar">
      <Slots region="activity-bar" render={(slot) => {
        if (slot.kind !== 'door' || typeof slot.entry.door.args.panel !== 'string') return undefined;
        const active = isPanelOpen(ui, slot.entry.door.args.panel as Panel);
        return <DoorControl key={slot.entry.ref} entry={slot.entry} title={active ? t('activity.openPanelHint', { panel: t(slot.entry.door.labelKey as MessageId) }) : undefined} />;
      }} />
    </nav>
  );
}

function SectionTitle({ title, region, skip, children }: { readonly title: string; readonly region: RegionId; readonly skip?: (entry: DoorEntry) => boolean; readonly children?: ReactNode }) {
  return (
    <div className="section-title">
      <span className="section-title__text">{title}</span>
      <span className="section-title__actions">
        {children}
        <Slots region={region} to={itemOrder(region, skip) - 1} render={(slot) => (skip !== undefined && slot.kind === 'door' && skip(slot.entry) ? null : undefined)} />
      </span>
    </div>
  );
}

// the current page's row is marked by its door's own current state (pages.switch), none before that command exists
function PageRow({ page }: { readonly page: Page }) {
  return (
    <div className="row row--page">
      <DoorControl entry={PAGE_ROW} args={{ page: page.tree.id }} className="row__main">
        <Icon name={elementIcon('page') ?? GLYPHS.folder} size="sm" />
        <span className="row__meta" title={page.file}>{page.file}</span>
      </DoorControl>
      <PageNameField page={page} />
      <span className="row__actions">
        {PAGE_ACTIONS.map((a) => (
          <DoorControl key={a.ref} entry={a} args={{ page: page.tree.id }} />
        ))}
      </span>
    </div>
  );
}

// A page's name, kept by pages.rename on Enter or when the field loses the focus (one undo step): the row shows the
// name its document holds — again after an undo, a redo or a refused name (the status bar's message changes with each)
// — and typing another one keeps it. Only the page on the canvas is renamed in place: another page's name reads as
// text, and a click on it opens that page (the dogfooding pass: a click on "Home" put its name in edit and left the
// canvas on the other page; only the small icon switched).
function PageNameField({ page }: { readonly page: Page }) {
  const field = useDoor(PAGE_NAME, { page: page.id });
  const store = useStore();
  const shown = useEditorState((s) => pageShown(s)?.tree.id === page.tree.id);
  const input = useRef<HTMLInputElement>(null);
  const said = useEditorState((state) => state.message);
  useEffect(() => {
    if (input.current !== null && document.activeElement !== input.current) input.current.value = page.name;
  }, [page.name, said]);
  // the page pages.add just made takes the focus with its name selected, so what is typed next names it (spec
  // explorer-pages, Problems 3: the journey "site" typed "Sobre" after the + and the name stayed "Page")
  // so does a page pages.duplicate just made (jornada03 J20)
  const added = (said?.key === 'status.pages.added' || said?.key === 'status.pages.duplicated') && said.params.file === page.file && shown;
  useEffect(() => {
    if (added && input.current !== null) {
      input.current.focus();
      input.current.select();
    }
  }, [added, said]);
  const keep = (name: string) => {
    if (!field.built || name.trim() === page.name) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(PAGE_NAME.command.id as CommandId, { ...PAGE_NAME.door.args, page: page.tree.id, name });
  };
  return (
    <form className="row__page-name" onSubmit={(event) => { event.preventDefault();
      keep((event.currentTarget.elements.namedItem('name') as HTMLInputElement).value);
    }}>
      <input
        ref={input}
        className="row__name-field"
        type="text"
        name="name"
        defaultValue={page.name}
        disabled={!field.available}
        aria-label={field.label}
        title={field.title}
        spellCheck={false}
        autoComplete="off"
        data-door={PAGE_NAME.ref}
        data-args={JSON.stringify({ page: page.tree.id })}
        readOnly={!shown}
        data-opens={shown ? undefined : ''}
        onClick={(event) => {
          if (shown) return;
          event.currentTarget.blur();
          (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(PAGE_ROW.command.id as CommandId, { ...PAGE_ROW.door.args, page: page.tree.id });
        }}
        onBlur={(event) => keep(event.currentTarget.value)}
      />
    </form>
  );
}

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

function Explorer() {
  const t = useT();
  const pages = useEditorState((s) => s.document.pages);
  const makers = useMemo(() => paletteDoors('explorer-files'), []);
  return (
    <section className="view" aria-label={t(panelName('explorer'))}>
      <ViewTitle panel="explorer" title={t(panelName('explorer'))} />
      <div data-region="explorer-pages">
        <SectionTitle title={t('explorer.pages')} region="explorer-pages" />
        {pages.map((p) => (
          <PageRow key={p.id} page={p} />
        ))}
      </div>
      <div data-region="explorer-files">
        <SectionTitle title={t('explorer.files')} region="explorer-files" skip={(one) => (one.door.kind === 'panel-control' ? one.door.control === 'new-file' || one.door.control === 'new-folder' : false)}>
          {makers.newFile === undefined ? null : <NewPath door={makers.newFile} folder={false} />}
          {makers.newFolder === undefined ? null : <NewPath door={makers.newFolder} folder />}
        </SectionTitle>
        <FileRows />
      </div>
    </section>
  );
}

// The project's file tree (spec explorer-file-system): every folder at its path, and under it the files the project
// holds and the files its pages are written at — a page's file a row like any other, which opens the page's markup in
// the code pane. A row's doors are the explorer-files region's: the row itself opens the file, its name (a
// double-click) becomes the field that renames it, Move to… lists the folders it may move into (each an entry of the
// same door, with the folder among its arguments) and Delete takes it away — a folder that holds files asks first
// (dialog.deleteFiles). The two create doors are drawn as the fields their paths are typed into.
function FileRows() {
  const document = useEditorState((s) => s.document);
  const rows = useMemo(() => treeRows(document, MODEL_RULES), [document]);
  const makers = useMemo(() => paletteDoors('explorer-files'), []);
  // an image file dropped onto the folder uploads: the pointer owner listens (input/pointer.ts), this marks the place
  return (
    <div data-region="explorer-file-rows" data-drop-zone="explorer-folder">
      {rows.map((row) => (
        <TreeRow key={row.path} row={row} doors={makers} />
      ))}
    </div>
  );
}

// the explorer-files region's controls, by what they are
interface TreeDoors {
  readonly newFile: DoorEntry | undefined;
  readonly newFolder: DoorEntry | undefined;
  readonly open: DoorEntry | undefined;
  readonly rename: DoorEntry | undefined;
  readonly remove: DoorEntry | undefined;
  readonly move: DoorEntry | undefined;
  readonly target: DoorEntry | undefined;
  readonly fill: DoorEntry | undefined
}
function paletteDoors(region: RegionId): TreeDoors {
  const held = doorSlots(region);
  const of = (control: string): DoorEntry | undefined => held.find((slot) => slot.door.kind === 'panel-control' && slot.door.control === control);
  return { newFile: of('new-file'), newFolder: of('new-folder'), open: of('file-row'), rename: of('file-name-field'), remove: of('delete'), move: of('move-to'), target: of('move-target'), fill: of('fill-from-data') };
}

// one of the two create doors, drawn as the field a path is typed into: Enter makes it, Escape drops what was typed
function NewPath({ door, folder }: { readonly door: DoorEntry; readonly folder: boolean }) {
  const t = useT();
  const store = useStore();
  const field = useDoor(door, { path: '' });
  // the field is the door's own control: Enter submits its form (as the page name field does) and what is typed is
  // the path, made by the door's command; leaving the field empty makes nothing
  const make = (typed: string): void => {
    const path = typed.trim();
    if (path === '' || !field.built) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(door.command.id as CommandId, { ...door.door.args, path });
  };
  return (
    <form className="file-maker" onSubmit={(event) => { event.preventDefault();
      make(String(new FormData(event.currentTarget).get('path') ?? ''));
      event.currentTarget.reset();
      (event.currentTarget.elements.namedItem('path') as HTMLInputElement | null)?.blur();
    }}>
      <Icon name={folder ? 'folder-plus' : 'file-plus'} size="sm" />
      <input
        className="input file-maker__input"
        type="text"
        name="path"
        data-door={door.ref}
        aria-label={t(folder ? 'explorer.newFolderAria' : 'explorer.newFileAria')}
        placeholder={t(folder ? 'explorer.newFolderHint' : 'explorer.newFileHint')}
        spellCheck={false}
        autoComplete="off"
      />
    </form>
  );
}

function TreeRow({ row, doors }: { readonly row: TreeRow; readonly doors: TreeDoors }) {
  const t = useT();
  const store = useStore();
  const document = useEditorState((s) => s.document);
  const file = row.folder ? null : fileAt(document, row.path);
  // the folders this row may move into (a stable value: a selector that made a new list every read would loop)
  const folders = useMemo(() => (row.folder ? NO_FOLDERS : folderPaths(document).filter((one) => !pathGenerated(one))), [document, row.folder]);
  const [moving, setMoving] = useState(false);
  const target = doors.target;
  const dragDoor = DRAG_ROW;
  const name = nameOfPath(row.path);
  const renaming = useEditorState((s) => s.ui.renamingFile === row.path);
  const renamed = useDoor(RENAME_DOOR, { path: row.path, name: '' });
  // the name field is the door's own control: Enter submits it, leaving it keeps what it holds, and a name that is
  // empty or the one the row already has writes nothing
  const keepName = (typed: string): void => {
    void store.dispatch(RENAME_START.command.id as CommandId, { path: '' });
    if (renamed === null || !renamed.built) return;
    const wanted = typed.trim();
    if (wanted === '' || wanted === name) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(doors.rename?.command.id as CommandId, { path: row.path, name: wanted });
  };
  const style = { paddingLeft: `calc(var(--space-3) + ${row.depth} * var(--space-4))` } as CSSProperties;
  const label = (
    <>
      {file !== null && row.kind === 'image' && !row.folder ? (
        <img className="row__thumb" src={objectUrl(file)} alt="" />
      ) : doors.open === undefined || row.folder ? (
        <Icon name={row.folder ? 'folder' : row.page !== null ? 'globe' : row.generated ? 'file-code' : 'file'} size="sm" />
      ) : (
        /* the icon is the door that opens the file in the code pane (a click anywhere else on the row opens it too,
           run by the pointer owner with the row's drag) */
        <DoorControl entry={doors.open} args={{ path: row.path }} className="row__open-icon" tabbable={false}>
          {/* a code file's kind as its tag (HTML, CSS, JS: the canonical .ftag), any other file its icon */}
          {FILE_TAGS[row.kind] !== undefined ? <span className={`ftag ftag--${row.kind}`}>{FILE_TAGS[row.kind]}</span> : <Icon name={row.page !== null ? 'globe' : row.generated ? 'file-code' : 'file'} size="sm" />}
        </DoorControl>
      )}
      {renaming && doors.rename !== undefined ? (
        <form className="row__rename" onSubmit={(event) => { event.preventDefault();
          keepName(String(new FormData(event.currentTarget).get('name') ?? ''));
        }}>
          <input
            className="input row__name-field"
            type="text"
            name="name"
            data-door={doors.rename.ref}
            data-args={JSON.stringify({ path: row.path })}
            autoFocus
            defaultValue={name}
            aria-label={t('explorer.renameAria', { name })}
            spellCheck={false}
            autoComplete="off"
            onBlur={(event) => keepName(event.currentTarget.value)}
          />
        </form>
      ) : (
        <span className="row__name" title={name}>{name}</span>
      )}
      {/* a file the editor writes says so, its tooltip why it cannot be deleted (the canonical .gen pill) */}
      {row.generated && !row.folder ? <span className="row__gen" title={t(row.kind === 'js' ? 'files.generatedJsTip' : 'files.generatedTip')}>{t('files.generated')}</span> : null}
      {/* the file's folder and its size (spec explorer-assets: "the Explorer lists it, with its path and its size") */}
      <span className="row__meta">{file === null ? '' : folderOf(row.path) === '' ? sizeLabel(file) : `${folderOf(row.path)}/ · ${sizeLabel(file)}`}</span>
    </>
  );
  return (
    <div className={`row${row.folder ? ' row--folder' : ''}`} style={style} data-file={row.path} data-folder={row.folder ? row.path : undefined}>
      {/* a row's main area is the move door: a press drags the row (dropped on a folder it moves into it), a click
          opens it in the code pane — the pointer owner runs both (input/pointer.ts, the explorer-row drag) */}
      {row.folder || dragDoor === undefined ? (
        <span className="row__main">{label}</span>
      ) : (
        <span className="row__main" data-door={dragDoor.ref} data-args={JSON.stringify({ path: row.path, to: folderOf(row.path) })}>
          {label}
        </span>
      )}
      <span className="row__actions">
        {/* a page's file is generated and still moves: it is the page's address in the site's tree (files.move moves
            it with the page), while the stylesheet and the interactions' script stand at their fixed paths */}
        {(row.generated && row.page === null) || doors.move === undefined || folders.length === 0 ? null : <span onClick={() => setMoving((one) => !one)}><DoorControl entry={doors.move} args={{ path: row.path, to: folderOf(row.path) }} label={t('explorer.moveTo', { name })} /></span>}
        {/* a data file (JSON, CSV) fills the selected repeated items with its rows (spec repeat-element) */}
        {doors.fill === undefined || file === null || !isDataFile(file) ? null : <DoorControl entry={doors.fill} args={{ path: row.path }} />}
        {row.generated ? null : <DoorControl entry={RENAME_START} args={{ path: row.path }} />}
        {doors.remove === undefined || row.generated ? null : <DoorControl entry={doors.remove} args={{ path: row.path }} label={t('explorer.deleteRow', { name })} />}
      </span>
      {moving && target !== undefined ? (
        <span className="row__targets" onClick={() => setMoving(false)}>
          {folders.map((folder) => (
            <DoorControl key={folder} entry={target} args={{ path: row.path, to: folder }} className="row__target">
              {/* the entry says the folder it moves into: its path in the tree */}
              <span className="row__target-path">{folder}</span>
            </DoorControl>
          ))}
        </span>
      ) : null}
    </div>
  );
}
const NO_FOLDERS: readonly string[] = [];
// the tag a code file's row shows in place of its icon: the file's kind in capitals (never translated: they are the
// languages' own names)
const FILE_TAGS: Partial<Record<TreeRow['kind'], string>> = { html: 'HTML', css: 'CSS', js: 'JS' };

// The Layers section (spec layers-tree): its title with the node count and the panel's controls, its search field and
// the tree. It belongs to no view (layout.json): the sidebar shows it in the stack below whatever view shows, so the
// palette and the Layers are visible together (the user's real-use audit, item 3.9; spec panel-resize).
function LayersSection() {
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

// every palette entry, for the search's count of all the panel's entries
const PALETTE_SIZE = manifest.elements.palette.reduce((n, g) => n + g.entries.length, 0);
const tagOfElement = (element: string) => manifest.elements.elements.find((e) => e.id === element)?.tag ?? null;

// Where a palette click inserts now: element.insert's own rule (src/core/structure/insert.ts, `placement` used with no
// parent and no index: the selected container takes the element as its last child, a selected leaf is followed by it,
// nothing selected puts it at the end of the page). The Insert view's top line says it, and the Layers draws a
// dashed line at the row there (the user's real-use audit, A3.19); null when the document has no page.
function insertDestination(state: EditorState): { readonly parent: Location; readonly previous: DocNode | null } | null {
  const at = placement(state, state.selection, MODEL_RULES, undefined, undefined);
  if (at === null) return null;
  const previous = at.index > 0 ? at.parent.node.children[at.index - 1] ?? null : null;
  return { parent: at.parent, previous };
}

// The line at the top of the Insert view naming where a click inserts: the destination as one JSON text (the hook's
// value stays stable), said in the language the editor shows (the user's real-use audit, A3.19)
function InsertDestination() {
  const t = useT();
  const said = useEditorState((s) => {
    const at = insertDestination(s);
    return at === null ? null : JSON.stringify({ parent: at.parent.node.name, sibling: at.previous?.name ?? null });
  });
  if (said === null) return null;
  const { parent, sibling } = JSON.parse(said) as { parent: string; sibling: string | null };
  return (
    <p className="insert__destination" data-insert-destination>
      {sibling === null ? t('insert.destination.inside', { parent }) : t('insert.destination.after', { parent, sibling })}
    </p>
  );
}

// The other words a palette entry answers to: its English name, and the synonyms the catalogues give it in the person's
// language and in English (palette.keywords.<entry>), where they have them
function alsoNamed(locale: Locale, entry: string, labelKey: string): readonly string[] {
  const key = `palette.keywords.${entry}`;
  const words = [translate('en', labelKey as MessageId)];
  if (hasText(locale, key)) words.push(translate(locale, key as MessageId));
  if (locale !== 'en' && hasText('en', key)) words.push(translate('en', key as MessageId));
  return words;
}

function Insert() {
  const t = useT();
  const locale = useLocale();
  const density = useEditorState((s) => paletteDensity(s.ui));
  const collapsed = useEditorState((s) => s.ui.preferences.collapsedGroups ?? NO_GROUPS);
  // what the search field holds: the panel's own view (a filter, not a command)
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  // the entries that answer the search, the best answers first (palette.ts paletteRank): the name in the person's
  // language, then its English name and its synonyms (palette.keywords.<entry>, where the catalogue has them)
  const groups = manifest.elements.palette.map((g) => ({
    group: g,
    entries: g.entries
      .map((e) => ({ e, rank: paletteRank(query, t(e.labelKey as MessageId), tagOfElement(e.element), alsoNamed(locale, e.id, e.labelKey)) }))
      .filter((one): one is { e: (typeof g.entries)[number]; rank: number } => one.rank !== null)
      .sort((a, b) => a.rank - b.rank)
      .map((one) => one.e),
  }));
  const matches = groups.reduce((n, g) => n + g.entries.length, 0);
  return (
    <section className="view" aria-label={t('activity.insert')} data-region="insert">
      <ViewTitle panel="elements" title={t('activity.insert')} />
      <InsertDestination />
      <div className={`insert insert--${density}`}>
        <input className="search" type="search" placeholder={t('insert.search')} aria-label={t('insert.search')} data-local="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        {/* the densities, each the small button of its icon with its name as its tooltip (the canonical .seg.icons); they
            are one Tab stop, the density shown, and the arrows move among them (a roving group) */}
        <div className="segmented segmented--icons" role="group">
          <Slots region="insert" render={(slot) => (slot.kind === 'door' && drawnAs(slot.entry) === 'segment' ? <DoorControl key={slot.entry.ref} entry={slot.entry} roving /> : null)} />
        </div>
        {groups.map(({ group: g, entries }) => {
          if (searching && entries.length === 0) return null;
          // a search shows every group that matches, collapsed or not
          const open = searching || !collapsed.includes(g.id);
          return (
            <div key={g.id} className="palette-group">
              <DoorControl entry={INSERT_GROUP} args={{ group: g.id }} expanded={open} className="palette-group__header">
                <span className="door__label">{t(g.labelKey as MessageId)}</span>
                <span className="palette-group__count">{entries.length}</span>
              </DoorControl>
              {/* the tiles are the palette's key context: Enter and Space insert the focused tile's entry */}
              {open ? (
                // a group's tiles are one Tab stop, its first tile; the arrows walk the others (the palette key
                // context; jornada03 plan, stage 5: the Insert panel was 74 Tab stops)
                <div className="tiles" data-region="palette-tiles" data-key-context="palette">
                  {entries.map((e, index) => (
                    <DoorControl key={e.id} entry={INSERT_TILE} args={{ entry: e.id }} className="tile" label={t(e.labelKey as MessageId)} ready={isFeatureBuilt(e.feature as FeatureId)} tabbable={index === 0}>
                      <Icon name={elementIcon(e.element) ?? GLYPHS.folder} />
                      <span className="tile__label">{t(e.labelKey as MessageId)}</span>
                      {density === 'list' ? <span className="tile__tag">{`<${tagOfElement(e.element) ?? ''}>`}</span> : null}
                    </DoorControl>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <ComponentTiles query={query} density={density} />
        {searching ? <p className="insert__matches">{matches === 0 ? t('palette.search.noMatch', { query: query.trim() }) : t('palette.search.matchCount', { count: matches, total: PALETTE_SIZE })}</p> : null}
      </div>
    </section>
  );
}
const NO_GROUPS: readonly string[] = [];

// The Components group of the Insert view (PRODUCT.md §5.3 `insert` 7; spec reusable-components): a tile per component
// of the project that the search matches, which places an instance (its click, or its drag onto the page); no group
// while the project has none.
function ComponentTiles({ query, density }: { readonly query: string; readonly density: string }) {
  const t = useT();
  const text = useEditorState((s) => componentsOf(s.document).map((c) => c.name).join('\n'));
  const names = (text === '' ? [] : text.split('\n')).filter((name) => paletteMatches(query, name, null));
  if (names.length === 0) return null;
  return (
    <div className="palette-group">
      <div className="palette-group__header palette-group__header--static">
        <span className="door__label">{t('palette.group.components')}</span>
        <span className="palette-group__count">{names.length}</span>
      </div>
      {/* a component tile is a button of its own: Enter and Space press it (the palette key context inserts
         elements) */}
      <div className="tiles" data-region="palette-tiles">
        {names.map((name) => (
          <DoorControl key={name} entry={COMPONENT_TILE} args={{ component: name }} className="tile" label={t(COMPONENT_TILE.door.labelKey as MessageId, { component: name })}>
            {COMPONENT_TILE.door.icon !== null ? <Icon name={COMPONENT_TILE.door.icon} /> : null}
            <span className="tile__label">{name}</span>
            {density === 'list' ? <span className="tile__tag">{t('palette.group.components')}</span> : null}
          </DoorControl>
        ))}
      </div>
    </div>
  );
}

// The Styles view: its Classes and Variables sections, with the doors the manifest places in the styles region, each
// disabled with "not available yet" until its command is built (the user's correction of decision 2).
function Styles() {
  const t = useT();
  return (
    <section className="view" aria-label={t('activity.styles')} data-region="styles">
      <ViewTitle panel="variables" title={t('activity.styles')} />
      <div className="section-title">
        <span className="section-title__text">{t('styles.classes')}</span>
      </div>
      <StyleClasses />
      <Variables />
      <SiteColours />
      <Suggestions />
    </section>
  );
}

// The project's classes, read-only (archive/DESIGN.md "Regions", styles; spec shared-style-classes): each name and how
// many elements have it; a class is edited through the selector bar.
function StyleClasses() {
  const t = useT();
  const text = useEditorState((s) => JSON.stringify(classesOf(s.document).map((c) => [c.name, usesOfClass(s.document, c.name)])));
  const rows = JSON.parse(text) as [string, number][];
  const rename = doorSlots('styles').find((entry) => entry.command.args.nextName !== undefined);
  const remove = doorSlots('styles').find((entry) => entry.command.args.className !== undefined && entry.command.args.nextName === undefined);
  return (
    <ul className="style-classes">
      {rows.map(([name, count]) => (
        <li key={name} className="style-classes__row">
          {rename !== undefined ? <ClassNameField entry={rename} name={name} /> : <span className="style-classes__name">.{name}</span>}
          <span className="style-classes__count">{count === 1 ? t('styles.count.one') : t('styles.count.other', { count })}</span>
          {remove !== undefined ? <DoorControl entry={remove} args={{ className: name }} label={t('styles.deleteClassUsedBy', { count })} /> : null}
        </li>
      ))}
    </ul>
  );
}

function ClassNameField({ entry, name }: { readonly entry: DoorEntry; readonly name: string }) {
  const store = useStore();
  const door = useDoor(entry, { className: name }, undefined, isFeatureBuilt(entry.door.feature as FeatureId));
  const field = useRef<HTMLInputElement>(null);
  const said = useEditorState((state) => state.message);
  useEffect(() => {
    if (field.current !== null) field.current.value = name;
  }, [name, said]);
  const keep = () => {
    const nextName = field.current?.value ?? name;
    if (nextName === name) return;
    afterGesture(() => (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { className: name, nextName }));
  };
  return (
    <form className={`style-classes__field${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify({ className: name })} title={door.title} onSubmit={(event) => { event.preventDefault();
      keep();
    }}>
      <input ref={field} className="input" aria-label={door.label} disabled={!door.available} spellCheck={false} onBlur={keep} />
    </form>
  );
}

// The body of each sidebar view the editor draws; a view without one says "not available yet" and the doors that
// only open it are not available yet (bodies.ts).
// (the views of the installed modules join them: app/modules-view.ts)
export const SIDEBAR_VIEWS: BodyTable = { assistant: AssistantPanel, data: DataPanel, explorer: Explorer, elements: Insert, variables: Styles, ...MODULE_SIDEBAR_VIEWS };

// The body of each section that belongs to no view, drawn in the sidebar's stack below the view (bodies.ts)
export const SIDEBAR_SECTIONS: BodyTable = { layers: LayersSection };

function EmptyView({ panel }: { readonly panel: Panel }) {
  const t = useT();
  return (
    <section className="view" aria-label={t(panelName(panel))}>
      <div className="view__title">{t(panelName(panel))}</div>
      <p className="view__empty">{t('common.notAvailableYet')}</p>
    </section>
  );
}

export function Sidebar() {
  const view = useEditorState((s) => s.ui.panels.sidebarView);
  const View = SIDEBAR_VIEWS[view];
  // every stacked section, in the manifest's order, and which of them show (each one's header stays drawn while it is
  // folded, so the header that opens it is there to press); both as one text (the hook's values stay stable)
  // the sections that are still the sidebar's: one that left its place (a window, the right dock, a combined area) is
  // drawn there and never twice (spec floating-panels)
  const here = useEditorState((s) => stackedSections().filter((panel) => atPlace(s.ui, panel)).join(','));
  const shown = useEditorState((s) => stackedSections().filter((panel) => isPanelOpen(s.ui, panel) && atPlace(s.ui, panel)).join(','));
  const size = useEditorState((s) => splitterSize(s.ui, 'sidebar-stack'));
  const open = new Set(shown === '' ? [] : shown.split(','));
  // panels combined with the view's area (spec panel-combine-tabs): one more tab of it, or one stacked under it; the
  // area then draws itself (PanelArea), so the tab strip and the stacked bodies have one owner
  const combined = useEditorState((s) => combinationAt(s.ui, view).tabs.length > 1 || combinationAt(s.ui, view).stack.length > 0);
  // In a narrow window the sidebar opens over the canvas (workspace/narrow.ts): a press outside it and its activity
  // bar, or the focus leaving it for anywhere else (Escape takes it to the canvas), closes it, as the left dock's own
  // toggle does (workspace.toggleLeftDock)
  const narrow = useNarrowWindow();
  const store = useStore();
  const aside = useRef<HTMLElement>(null);
  const activity = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    activity.current = document.querySelector<HTMLElement>('.activity-bar');
  });
  const close = useCallback(() => {
    if (store.getState().ui.panels.sidebar) (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(toggleLeftDock.command, {});
  }, [store]);
  useOutsideLayer(aside, narrow, close, activity, false);
  // where the focus went is known once it has moved (Escape hands it to the canvas, which leaves the page's own focus
  // on its body): read then; a focus left on the body by a press on the panel's own padding keeps it open
  const pressedInside = useRef(false);
  useEffect(() => outsidePress.subscribe((target) => void (pressedInside.current = aside.current?.contains(target) === true)), []);
  const leave = () => {
    if (!narrow) return;
    window.setTimeout(() => {
      const now = document.activeElement;
      if (now !== null && (aside.current?.contains(now) === true || activity.current?.contains(now) === true)) return;
      if ((now === null || now === document.body) && pressedInside.current) return;
      close();
    }, 0);
  };
  return (
    <aside ref={aside} className="sidebar" onBlur={leave}>
      {combined ? (
        <PanelArea panel={view} />
      ) : (
        <div className="sidebar__view" data-panel-area={view}>
          {View ? <View /> : <EmptyView panel={view} />}
        </div>
      )}
      {open.size > 0 ? <Splitter splitter="sidebar-stack" /> : null}
      {(here === '' ? [] : here.split(',')).map((name) => {
        const panel = name as Panel;
        return (
          <div key={panel} className="sidebar__stack" style={open.has(name) ? { height: size ?? undefined } : undefined}>
            {/* the section draws itself and everything combined with it (spec panel-combine-tabs) */}
            <PanelArea panel={panel} />
          </div>
        );
      })}
      {/* the sidebar's width, which the person sets (spec panel-resize) */}
      <Splitter splitter="sidebar-width" className="splitter--column-end" />
    </aside>
  );
}

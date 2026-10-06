// The workspace layout (PRODUCT.md §5): the dock's state, collapsed to its strip, open, or maximised over the
// canvas area, the active tab of each tab group (the dock's and the inspector's: workspace.setActiveTab), and the
// panels that left their place: floating windows, the right dock and combined areas (workspace.movePanel; specs
// floating-panels and panel-combine-tabs). workspace.reset puts the first state back. The first state is data: the
// workbench and the dock panels of layout.json that are open, and the inspector's first tab.
import { message, registerHandler, type Message } from '../../core/commands/registry.ts';
import type { MessageId } from '../../generated/ids.ts';
import { commandOf, doorsIn, manifest } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';
import { INITIAL_PANELS, PANELS, panelName, panelsAt, type Panel } from './panel-catalogue.ts';
import { registerReferenceKind } from '../../core/store/references.ts';
import { argumentRefused } from '../../core/store/args.ts';

export const DOCK_STATES = ['collapsed', 'open', 'max'] as const;
export type DockState = (typeof DOCK_STATES)[number];

// A panel that left its dock as a window of its own, at a point of the window (spec floating-panels)
export interface FloatingPanel {
  readonly panel: Panel;
  readonly x: number;
  readonly y: number;
}

// A panel combined with another panel's area (spec panel-combine-tabs): as one of its tabs (the host's tab strip shows
// both, the active one's body fills the area), or stacked under it (each keeps its own body, one above the other).
export interface CombinedPanel {
  readonly panel: Panel;
  readonly host: Panel;
  readonly mode: 'tabs' | 'stack';
}

export interface LayoutState {
  readonly dock: DockState;
  // the dock tab whose body shows
  readonly activeDockTab: Panel | null;
  // the inspector tab chosen (Style, Settings, Interactions); absent while the first one
  // shows
  readonly inspectorTab?: string | undefined;
  // the panels floating as windows of their own, in the order they were floated (spec floating-panels)
  readonly floating?: readonly FloatingPanel[] | undefined;
  // the panels docked to the right edge, in the order they were docked; the first of them shows (spec floating-panels)
  readonly right?: readonly Panel[] | undefined;
  // the panels combined with another panel's area (spec panel-combine-tabs)
  readonly combined?: readonly CombinedPanel[] | undefined;
  // which tab of a combined area shows, by the panel that hosts it; a host absent shows the host itself
  readonly tabActive?: Readonly<Record<string, Panel>> | undefined;
}

const firstOpen = (place: string): Panel | null =>
  (Object.entries(manifest.layout.panels).find(([, data]) => data.place === place && data.open)?.[0] as Panel | undefined) ?? null;

// The inspector's tabs: the tab doors its header draws, in their order there, each naming its group and its tab
// (manifest data: the arguments of their doors). The first is the tab shown at the start.
const INSPECTOR_TAB_DOORS = doorsIn('inspector-header').flatMap((d) => (d.door.kind === 'panel-control' && d.door.drawnAs === 'tab' ? [d.door.args] : []));
export const INSPECTOR_TABS: readonly string[] = INSPECTOR_TAB_DOORS.flatMap((args) => (typeof args.panel === 'string' ? [args.panel] : []));
const INSPECTOR_GROUP = INSPECTOR_TAB_DOORS[0]?.group;
const FIRST_TAB = INSPECTOR_TABS[0];
if (typeof INSPECTOR_GROUP !== 'string' || FIRST_TAB === undefined) throw new Error('the manifest draws no tab in the inspector header');
const FIRST_INSPECTOR_TAB: string = FIRST_TAB;
// the dock's tab strip names its group so (dock.tsx), and so does a combined area's (spec panel-combine-tabs)
const WORKBENCH_GROUP = 'workbench';
const SIDEBAR_GROUP = 'sidebar';

export const INITIAL_LAYOUT: LayoutState = {
  dock: firstOpen('workbench') !== null ? 'open' : 'collapsed',
  activeDockTab: firstOpen('dock'),
};

// the inspector tab whose body shows
export function inspectorTab(ui: EditorUi): string {
  return ui.layout.inspectorTab ?? FIRST_INSPECTOR_TAB;
}

// The inspector tab that draws a region: each tab draws the region named after it, inspector-<tab> (PRODUCT.md §5.3
// "Regions": inspector-style, inspector-settings, inspector-interactions); null when no tab draws it.
export function inspectorTabDrawing(region: string): string | null {
  return INSPECTOR_TABS.find((tab) => region === `inspector-${tab}`) ?? null;
}

// The editor state with an inspector tab shown: the same state when it shows already.
export function withInspectorTab(ui: EditorUi, panel: string): EditorUi {
  if (!INSPECTOR_TABS.includes(panel)) throw new Error(`the inspector has no tab ${panel}`);
  if (inspectorTab(ui) === panel) return ui;
  return { ...ui, layout: { ...ui.layout, inspectorTab: panel === FIRST_INSPECTOR_TAB ? undefined : panel } };
}

type WorkbenchRequest = 'collapsed' | 'open' | 'max' | 'toggle' | 'toggle-max';

// toggle shows or hides the workbench; toggle-max maximises it, or restores it to open
function nextDock(current: DockState, request: WorkbenchRequest): DockState {
  if (request === 'toggle') return current === 'collapsed' ? 'open' : 'collapsed';
  if (request === 'toggle-max') return current === 'max' ? 'open' : 'max';
  return request;
}

export function withDock(ui: EditorUi, dock: DockState): EditorUi {
  return ui.layout.dock === dock ? ui : { ...ui, layout: { ...ui.layout, dock } };
}

export function withActiveDockTab(ui: EditorUi, tab: Panel | null): EditorUi {
  return ui.layout.activeDockTab === tab ? ui : { ...ui, layout: { ...ui.layout, activeDockTab: tab } };
}

// workspace.setActiveTab (spec inspector-panel): shows a tab of its group. The inspector's tab stays chosen when the
// selection changes and records nothing; a dock tab shows its panel, and a collapsed dock opens to show it (as View's
// items show a dock panel, panels.ts). A door stands for the tab its group shows now.
export const setActiveTab = registerHandler<'workspace.setActiveTab', EditorUi>(
  'workspace.setActiveTab',
  ({ state }, { group, panel }) => {
    const ui = state.ui;
    if (group === INSPECTOR_GROUP) {
      // a door names a tab of the inspector's header; anything else is a defect of the door
      if (!INSPECTOR_TABS.includes(panel)) return { kind: 'refused', message: argumentRefused('panel') };
      if (inspectorTab(ui) === panel) return { kind: 'change' };
      return { kind: 'change', ui: withInspectorTab(ui, panel) };
    }
    if (group === WORKBENCH_GROUP) {
      const tab = panel as Panel;
      // the dock's strip draws a tab for each of its open panels only
      if (!ui.panels.dockTabs.includes(tab)) return { kind: 'refused', message: argumentRefused('panel') };
      return { kind: 'change', ui: withDock(withActiveDockTab(ui, tab), ui.layout.dock === 'collapsed' ? 'open' : ui.layout.dock) };
    }
    if (group === SIDEBAR_GROUP) {
      // an area's tab strip (spec panel-combine-tabs): the tab chosen is the panel the strip draws, and it shows in
      // the area that hosts it (its own, while it hosts the strip itself)
      if (!(panel in PANELS)) return { kind: 'refused', message: argumentRefused('panel') };
      const tab = panelOf(panel);
      const host = combinedOf(ui, tab)?.host ?? tab;
      if (host !== tab && combinedOf(ui, tab)?.mode !== 'tabs') return { kind: 'refused', message: argumentRefused('panel') };
      if (combinationAt(ui, host).active === tab) return { kind: 'change' };
      return { kind: 'change', ui: withLayout(ui, { ...ui.layout, tabActive: { ...ui.layout.tabActive, [host]: tab } }) };
    }
    return { kind: 'refused', message: argumentRefused('group') };
  },
  (state, args) => {
    if (args.group === INSPECTOR_GROUP) return inspectorTab(state.ui) === args.panel;
    if (args.group === WORKBENCH_GROUP) return state.ui.layout.dock !== 'collapsed' && state.ui.layout.activeDockTab === args.panel;
    if (args.group === SIDEBAR_GROUP && typeof args.panel === 'string' && args.panel in PANELS) {
      const tab = args.panel as Panel;
      const host = combinedOf(state.ui, tab)?.host ?? tab;
      return combinationAt(state.ui, host).active === tab;
    }
    return false;
  },
);

export const setWorkbenchState = registerHandler<'workspace.setWorkbenchState', EditorUi>(
  'workspace.setWorkbenchState',
  ({ state }, args) => ({
    kind: 'change',
    ui: withDock(state.ui, nextDock(state.ui.layout.dock, args.state)),
  }),
  // maximise says whether the workbench is maximised; the others whether it shows
  (state, args) => (args.state === 'toggle-max' ? state.ui.layout.dock === 'max' : state.ui.layout.dock !== 'collapsed'),
);

// ---------------------------------------------------------------- floating panels and combining (specs
// floating-panels, panel-combine-tabs): which panels left their place, where they are now, and the command that moves
// them.
const withLayout = (ui: EditorUi, layout: LayoutState): EditorUi => ({ ...ui, layout });

// the panel a name stands for, or a defect of the door
function panelOf(value: unknown): Panel {
  if (typeof value !== 'string' || !(value in PANELS)) throw new Error(`workspace.movePanel: layout.json declares no panel ${String(value)}`);
  return value as Panel;
}

// the floating window of a panel, or null while it is not floating
export const floatingOf = (ui: EditorUi, panel: Panel): FloatingPanel | null => (ui.layout.floating ?? []).find((f) => f.panel === panel) ?? null;
// whether a panel is docked in the right dock
export const rightDocked = (ui: EditorUi, panel: Panel): boolean => (ui.layout.right ?? []).includes(panel);
// the combination a panel is part of, as the one that was dropped (its host), or the one it hosts
export const combinedOf = (ui: EditorUi, panel: Panel): CombinedPanel | null => (ui.layout.combined ?? []).find((c) => c.panel === panel) ?? null;
// the panels combined with an area, in the order they were dropped: the ones that host it, then the ones it hosts
const combinedWith = (ui: EditorUi, panel: Panel): readonly CombinedPanel[] => (ui.layout.combined ?? []).filter((c) => c.host === panel || c.panel === panel);

// The area a panel hosts: the panels whose tab strip it shows (the panel itself first) and the panels stacked under
// it, in the order they were dropped, with the tab whose body fills the area.
export function combinationAt(ui: EditorUi, host: Panel): { readonly tabs: readonly Panel[]; readonly stack: readonly Panel[]; readonly active: Panel } {
  const mine = combinedWith(ui, host).filter((c) => c.host === host);
  const tabs = [host, ...mine.filter((c) => c.mode === 'tabs').map((c) => c.panel)];
  const stack = mine.filter((c) => c.mode === 'stack').map((c) => c.panel);
  const asked = ui.layout.tabActive?.[host];
  const active = asked !== undefined && tabs.includes(asked) ? asked : host;
  return { tabs, stack, active };
}

// The editor state with the panel out of every place it was in — its sidebar place (a view or a section: the section
// closes, a view stops showing and the sidebar shows another view), the right dock, a floating window and every
// combination: what a move takes before it places. Exported for panels.ts, which closes a panel wherever it went.
export function detachPanel(ui: EditorUi, panel: Panel): EditorUi {
  const layout: LayoutState = {
    ...ui.layout,
    floating: (ui.layout.floating ?? []).filter((f) => f.panel !== panel),
    right: (ui.layout.right ?? []).filter((p) => p !== panel),
    combined: (ui.layout.combined ?? []).filter((c) => c.panel !== panel && c.host !== panel),
  };
  const data = PANELS[panel];
  const panels = ui.panels;
  // a section of the sidebar closes; a view stops showing and the sidebar falls back to another view
  if (data.place === 'section') return withLayout({ ...ui, panels: { ...panels, open: { ...panels.open, [panel]: false } } }, layout);
  if (data.place === 'sidebar' && panels.sidebarView === panel) {
    const others = panelsAt('sidebar').filter((p) => p !== panel);
    const showing = others[0];
    return showing === undefined ? withLayout(ui, layout) : withLayout({ ...ui, panels: { ...panels, sidebarView: showing } }, layout);
  }
  return withLayout(ui, layout);
}

// A panel back in the sidebar: a view shows there, a section of the sidebar opens in its stack (the same rule every
// View item follows, panels.ts).
function dockedLeft(ui: EditorUi, panel: Panel): EditorUi {
  const data = PANELS[panel];
  const panels = ui.panels;
  if (data.place === 'sidebar') return { ...ui, panels: { ...panels, sidebar: true, sidebarView: panel } };
  if (data.place === 'section') {
    const view = data.in === null ? { sidebar: true } : { sidebar: true, sidebarView: data.in as Panel };
    return { ...ui, panels: { ...panels, ...view, open: { ...panels.open, [panel]: true } } };
  }
  // a dock panel returns to its dock, shown there (there is no other left dock to give it)
  return { ...ui, panels: { ...panels, dockTabs: panels.dockTabs.includes(panel) ? panels.dockTabs : [...panels.dockTabs, panel] } };
}

const panelMessage = (key: MessageId, panel: Panel, params: Readonly<Record<string, Message['params'][string]>> = {}): Message => message(key, { panel: { key: panelName(panel) }, ...params });

// workspace.movePanel (specs floating-panels and panel-combine-tabs): the panel leaves wherever it was and goes where
// the command says — a floating window at `at`, the left or the right dock, a tab of the workbench, a second tab of
// `host`'s area or a panel stacked under it. The pointer chooses the door (its zone) and the place; this command
// holds the one rule of what each place means. Nothing in the document changes and no history is recorded.
export const movePanel = registerHandler<'workspace.movePanel', EditorUi>(
  'workspace.movePanel',
  ({ state }, args) => {
    const panel = panelOf(args.panel);
    const ui = detachPanel(state.ui, panel);
    const layout = ui.layout;
    if (args.to === FLOAT) {
      const at = args.at ?? { x: 0, y: 0 };
      const floating = [...(layout.floating ?? []), { panel, x: Math.round(at.x), y: Math.round(at.y) }];
      return { kind: 'change', ui: withLayout(ui, { ...layout, floating }), message: panelMessage('status.panel.floating', panel) };
    }
    if (args.to === 'dock-left') {
      return { kind: 'change', ui: dockedLeft(ui, panel), message: panelMessage('status.panel.dockedLeft', panel) };
    }
    if (args.to === 'dock-right') {
      const right = [...(layout.right ?? []), panel];
      return { kind: 'change', ui: withLayout(ui, { ...layout, right }), message: panelMessage('status.panel.dockedRight', panel) };
    }
    if (args.to === 'workbench') {
      const panels = ui.panels;
      const dockTabs = panels.dockTabs.includes(panel) ? panels.dockTabs : [...panels.dockTabs, panel];
      const next = withActiveDockTab({ ...ui, panels: { ...panels, dockTabs } }, panel);
      return { kind: 'change', ui: withDock(next, 'open'), message: panelMessage('status.panel.opened', panel) };
    }
    const host = args.host === undefined ? null : panelOf(args.host);
    if (host === null) throw new Error(`workspace.movePanel: ${args.to} names the panel it combines with`);
    const mode: CombinedPanel['mode'] = args.to === STACK ? 'stack' : 'tabs';
    const combined = [...(layout.combined ?? []), { panel, host, mode }];
    return { kind: 'change', ui: withLayout(ui, { ...layout, combined }), message: panelMessage(args.to === 'tabs' ? 'status.panel.tabs' : 'status.panel.stacked', panel, { host: { key: panelName(host) } }) };
  },
);

// The places workspace.movePanel offers, in the manifest's order (its own arguments): floating as a window, the two
// side docks, the workbench's tabs, and the two combining places (a tab of the host, or stacked under it). Read from
// the manifest rather than written here, so a place added to it arrives without a code edit.
const PLACES: readonly string[] = commandOf(movePanel.command).args.to?.values ?? [];
const [FLOAT, , , , , STACK] = PLACES;
if (FLOAT === undefined) throw new Error('workspace.movePanel offers no place');

// workspace.reset (spec workspace-persist-reset): the default docks, sizes and panels — the panels of layout.json and
// the first state of the layout — with the splitter sizes and the collapsed sections let go, and the status bar says
// so. The document is untouched: nothing of the project is this command's.
export const resetWorkspace = registerHandler<'workspace.reset', EditorUi>('workspace.reset', ({ state }) => {
  const { splitterSizes: _sizes, collapsedSections: _sections, ...preferences } = state.ui.preferences;
  void _sizes;
  void _sections;
  return {
    kind: 'change',
    ui: { ...state.ui, panels: INITIAL_PANELS, layout: INITIAL_LAYOUT, preferences },
    message: message('status.workspace.reset'),
  };
});

// ---------------------------------------------------------------- splitters (spec panel-resize)
// Every splitter and its bounds are data (layout.json's `splitters`): the axis it drags along, the arrow direction
// that grows the panel it sizes, its first size and its bounds, in px. The size the person chose is a preference
// (ui.preferences.splitterSizes), kept between sessions with the others. workspace.resizeSplitter sets it: a drag
// hands the size it reached (size), an arrow key its direction, stepped by the splitter.step constant — the arrow
// along the splitter's own axis, and only it, changes the size.
export const SPLITTERS = manifest.layout.splitters;
export type SplitterId = keyof typeof SPLITTERS;
type SplitterData = (typeof SPLITTERS)[SplitterId];

function constant(id: string): number {
  const value = manifest.interactions.constants.find((c) => c.id === id)?.value;
  if (typeof value !== 'number') throw new Error(`interactions.json has no number ${id}`);
  return value;
}
const STEP = constant('splitter.step');

const clamped = (data: SplitterData, size: number): number => Math.min(data.max, Math.max(data.min, Math.round(size)));
// the grow direction's sign comes from the splitter's own directions (layout.json, the negative side first)
const sign = (data: SplitterData): number => (data.grow === data.directions[0] ? -1 : 1);
// the directions along the splitter's axis: an arrow across it is no step at all
const along = (data: SplitterData, direction: string): boolean => (data.directions as readonly string[]).includes(direction);

// the size a splitter shows now: the person's, else the one layout.json declares, always within its bounds; null for
// a name the manifest does not declare (a defect of the caller)
export function splitterSize(ui: EditorUi, splitter: string): number | null {
  const data = SPLITTERS[splitter as SplitterId] as SplitterData | undefined;
  if (data === undefined) return null;
  return clamped(data, ui.preferences.splitterSizes?.[splitter] ?? data.size);
}

export const resizeSplitter = registerHandler<'workspace.resizeSplitter', EditorUi>(
  'workspace.resizeSplitter',
  ({ state }, { splitter, size, distance, direction }) => {
    const data = SPLITTERS[splitter as SplitterId] as SplitterData | undefined;
    // a splitter layout.json does not declare is a defect of the door
    if (data === undefined) throw new Error(`workspace.resizeSplitter: layout.json declares no ${splitter} splitter`);
    // what every size means: the size the gesture started from (the one at the press of a drag) — the one the
    // splitter shows now when the door names none, a key's step doing so
    const base = typeof size === 'number' ? size : splitterSize(state.ui, splitter) ?? data.size;
    // what the door asks: the pointer's travel along the splitter's own axis (positive down or right: the travel
    // towards the panel it sizes grows it), or the arrow's step — an arrow across the axis is no step at all
    const wanted =
      typeof distance === 'number' ? base + sign(data) * distance : direction !== undefined && along(data, direction) ? base + (direction === data.grow ? STEP : -STEP) : base;
    const next = clamped(data, wanted);
    if (next === (splitterSize(state.ui, splitter) ?? data.size)) return { kind: 'change' };
    const preferences = { ...state.ui.preferences, splitterSizes: { ...state.ui.preferences.splitterSizes, [splitter]: next } };
    return { kind: 'change', ui: { ...state.ui, preferences } };
  },
);

// a splitter an argument names (manifest refers: splitter), one layout.json declares
registerReferenceKind('splitter', (_document, splitter) => splitter in SPLITTERS);
// a tab group an argument names (manifest refers: tab-group): the inspector's, the dock's, the sidebar's areas
registerReferenceKind('tab-group', (_document, group) => group === INSPECTOR_GROUP || group === WORKBENCH_GROUP || group === SIDEBAR_GROUP);

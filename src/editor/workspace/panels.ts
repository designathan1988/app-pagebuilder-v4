// Panel visibility (PRODUCT.md §5): which sidebar view is shown, and whether the sidebar, each section of a view,
// the inspector, the canvas tools and each dock tab are open. The commands workspace.setPanelOpen, toggleLeftDock,
// toggleInspector and collapseDocks change it; the status bar reports each change (spec dock-toggles, Problems 1).
// What a panel is (its name, its place, whether it is open at the first start) is data: `panels` of layout.json,
// read by panel-catalogue.ts.
import { message, registerHandler, type Message } from '../../core/commands/registry.ts';
import { asking } from '../focus/focus.ts';
import type { EditorUi } from '../state.ts';
import { detachPanel, floatingOf, combinedOf, rightDocked, withActiveDockTab, withDock } from './layout.ts';
import { INITIAL_PANELS, PANELS, panelName, panelsAt, type Panel, type PanelsState } from './panel-catalogue.ts';

// Whether a panel shows where its own place says: a panel that left its place (a floating window, the right dock, a
// combined area) shows somewhere else and is drawn there, never twice (spec floating-panels).
export function atPlace(ui: EditorUi, panel: Panel): boolean {
  return floatingOf(ui, panel) === null && !rightDocked(ui, panel) && combinedOf(ui, panel) === null;
}

export function isPanelOpen(ui: EditorUi, panel: Panel): boolean {
  const p = ui.panels;
  const data = PANELS[panel];
  // a panel that left its place shows where it went: a floating window, the right dock, or a combined area
  // (specs floating-panels, panel-combine-tabs), whatever its place would say
  if (floatingOf(ui, panel) !== null || rightDocked(ui, panel) || combinedOf(ui, panel) !== null) return true;
  switch (data.place) {
    case 'sidebar':
      return p.sidebar && p.sidebarView === panel;
    case 'section':
      // a section of no view belongs to every one: it shows in the stack below whatever the sidebar shows
      return p.sidebar && (data.in === null || p.sidebarView === data.in) && p.open[panel];
    // a dock panel is open when it shows: its tab is the active one of a dock that is not folded, so a View item
    // that toggles it shows it first (the user's decision) and takes the tab out only while it shows
    case 'dock':
      return p.dockTabs.includes(panel) && ui.layout.dock !== 'collapsed' && ui.layout.activeDockTab === panel;
    case 'workbench':
      return ui.layout.dock !== 'collapsed';
    default:
      return p.open[panel];
  }
}

function withPanel(ui: EditorUi, panel: Panel, open: boolean): EditorUi {
  const p = ui.panels;
  const data = PANELS[panel];
  // closing a panel takes it out of where it went; opening one brings it back to its own place
  const moved = floatingOf(ui, panel) !== null || rightDocked(ui, panel) || combinedOf(ui, panel) !== null;
  if (moved) ui = detachPanel(ui, panel);
  switch (data.place) {
    case 'sidebar':
      return { ...ui, panels: open ? { ...p, sidebar: true, sidebarView: panel } : { ...p, sidebar: p.sidebarView === panel ? false : p.sidebar } };
    case 'section': {
      // showing one shows the sidebar: a section of one view switches to it, a section of no view keeps the view shown
      const view = open ? (data.in !== null ? { sidebar: true, sidebarView: data.in as Panel } : { sidebar: true }) : {};
      return { ...ui, panels: { ...p, ...view, open: { ...p.open, [panel]: open } } };
    }
    case 'workbench':
      return withDock(ui, open ? 'open' : 'collapsed');
    case 'dock': {
      if (open) {
        const dockTabs = p.dockTabs.includes(panel) ? p.dockTabs : [...p.dockTabs, panel];
        return withDock(withActiveDockTab({ ...ui, panels: { ...p, dockTabs } }, panel), ui.layout.dock === 'collapsed' ? 'open' : ui.layout.dock);
      }
      // closing the last tab collapses the workbench (spec workbench-panel, Problems 1)
      const dockTabs = p.dockTabs.filter((t) => t !== panel);
      const active = ui.layout.activeDockTab === panel ? (dockTabs[dockTabs.length - 1] ?? null) : ui.layout.activeDockTab;
      const next = withActiveDockTab({ ...ui, panels: { ...p, dockTabs } }, active);
      return dockTabs.length === 0 ? withDock(next, 'collapsed') : next;
    }
    default:
      return { ...ui, panels: { ...p, open: { ...p.open, [panel]: open } } };
  }
}

// The editor state with a panel shown, for a command whose work is drawn in that panel (a rename in place, in Layers):
// its view and the sidebar shown first, as when it is opened.
export const showPanel = (ui: EditorUi, panel: Panel): EditorUi => (isPanelOpen(ui, panel) ? ui : withPanel(ui, panel, true));
// The editor state with a panel hidden (a tool that needs the room while it is on: the Layout tool folds the Layers).
export const hidePanel = (ui: EditorUi, panel: Panel): EditorUi => (isPanelOpen(ui, panel) ? withPanel(ui, panel, false) : ui);

const panelMessage = (panel: Panel, open: boolean): Message => message(open ? 'status.panel.opened' : 'status.panel.closed', { panel: { key: panelName(panel) } });

export const setPanelOpen = registerHandler<'workspace.setPanelOpen', EditorUi>(
  'workspace.setPanelOpen',
  ({ state }, args) => {
    const open = args.open === 'toggle' ? !isPanelOpen(state.ui, args.panel) : args.open === 'open';
    const shown = open ? showPanel(state.ui, args.panel) : withPanel(state.ui, args.panel, false);
    const ui = args.focus === true && open ? asking(shown, `panel:${args.panel}`) : shown;
    return { kind: 'change', ui, message: panelMessage(args.panel, open) };
  },
  // a toggle shows whether its panel is open; an open or a close button stands for no state
  (state, args) => args.open !== 'close' && typeof args.panel === 'string' && args.panel in PANELS && isPanelOpen(state.ui, args.panel as Panel),
);

// a toggle stands for what it shows being shown: View › Toggle left dock wears its check while the sidebar shows (the
// audit's A3.23)
export const toggleLeftDock = registerHandler<'workspace.toggleLeftDock', EditorUi>(
  'workspace.toggleLeftDock',
  ({ state }) => {
    const sidebar = !state.ui.panels.sidebar;
    return { kind: 'change', ui: { ...state.ui, panels: { ...state.ui.panels, sidebar } }, message: message(sidebar ? 'status.sidebar.shown' : 'status.sidebar.hidden') };
  },
  (state) => state.ui.panels.sidebar,
);

// the inspector column: the panels placed there (layout.json names one, the inspector), shown or hidden (Ctrl+Alt+B,
// Ctrl+\, and Page properties, which shows the page in it: page-properties.ts)
export const withInspector = (ui: EditorUi, open: boolean): EditorUi => panelsAt('inspector').reduce((next, panel) => withPanel(next, panel, open), ui);
const inspectorOpen = (ui: EditorUi): boolean => panelsAt('inspector').some((panel) => isPanelOpen(ui, panel));

export const toggleInspector = registerHandler<'workspace.toggleInspector', EditorUi>(
  'workspace.toggleInspector',
  ({ state }) => {
    const open = !inspectorOpen(state.ui);
    return { kind: 'change', ui: withInspector(state.ui, open), message: message(open ? 'status.inspector.shown' : 'status.inspector.hidden') };
  },
  (state) => inspectorOpen(state.ui),
);

// Developer tools (spec workbench-panel, Problems in Pager 2): a preference that gives the dock its Document tab, where
// the live document shows read-only (dock.tsx); turned on it shows the tab, turned off the tab goes. The editor starts
// with the tab while the stored preference is on.
const DOCUMENT_TAB: Panel = 'document';
export const panelsFor = (developerTools: boolean): PanelsState =>
  developerTools && !INITIAL_PANELS.dockTabs.includes(DOCUMENT_TAB) ? { ...INITIAL_PANELS, dockTabs: [...INITIAL_PANELS.dockTabs, DOCUMENT_TAB] } : INITIAL_PANELS;

export const toggleDeveloperTools = registerHandler<'workspace.toggleDeveloperTools', EditorUi>(
  'workspace.toggleDeveloperTools',
  ({ state }) => {
    const on = state.ui.preferences.developerTools !== true;
    const preferences = { ...state.ui.preferences, developerTools: on ? (true as const) : undefined };
    return { kind: 'change', ui: withPanel({ ...state.ui, preferences }, DOCUMENT_TAB, on), message: panelMessage(DOCUMENT_TAB, on) };
  },
  (state) => state.ui.preferences.developerTools === true,
);

// Ctrl+\: collapses every dock; the second press puts back exactly what was open (spec dock-toggles).
export const collapseDocks = registerHandler<'workspace.collapseDocks', EditorUi>('workspace.collapseDocks', ({ state }) => {
  const { ui } = state;
  const p = ui.panels;
  const inspector = inspectorOpen(ui);
  const anyOpen = p.sidebar || inspector || ui.layout.dock !== 'collapsed';
  if (!anyOpen && p.collapsed !== null) {
    const back = p.collapsed;
    const restored = withInspector({ ...ui, panels: { ...p, sidebar: back.sidebar, collapsed: null } }, back.inspector);
    return { kind: 'change', ui: withDock(restored, back.dock), message: message('status.docks.restored') };
  }
  const collapsed = { sidebar: p.sidebar, inspector, dock: ui.layout.dock };
  const hidden = withInspector({ ...ui, panels: { ...p, sidebar: false, collapsed } }, false);
  return { kind: 'change', ui: withDock(hidden, 'collapsed'), message: message('status.docks.collapsed') };
});

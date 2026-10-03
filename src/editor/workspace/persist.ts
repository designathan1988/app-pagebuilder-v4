// The workspace between sessions (spec dock-toggles; the user's real-use audit, A3.18: "o estado dos painéis
// sobrevive a recarregar"): which sidebar view shows, whether the sidebar and each section are open, the dock's tabs
// and state, and the inspector's tab, kept in the browser's storage under its own key — the preferences' writer owns
// the preferences, this one the panels and the layout. A stored value that no longer names a panel or a dock state of
// the manifest is left out, so an older or edited state never opens a panel the editor does not draw.
import type { EditorUi } from '../state.ts';
import { DOCK_STATES, INITIAL_LAYOUT, type LayoutState } from './layout.ts';

import { INITIAL_PANELS, PANELS, type Panel, type PanelsState } from './panel-catalogue.ts';

// Where the workspace is kept between sessions; the browser's localStorage by default, a map in tests
export interface WorkspaceStorage {
  read(): string | null;
  write(text: string): void;
}
const KEY = 'workspace';
export const browserWorkspace: WorkspaceStorage = {
  read: () => {
    try {
      return window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (text) => {
    try {
      window.localStorage.setItem(KEY, text);
    } catch {
      // storage refused (private window, quota): the workspace lasts for this session only
    }
  },
};

export interface WorkspacePrefs {
  readonly panels: PanelsState;
  readonly layout: LayoutState;
  // the page the editor showed (ui.page, core/project/pages.ts): the active page is restored after a reload (the
  // manifest's explorer-pages). An id no page of the restored document holds falls back to the project's first.
  readonly page?: string | undefined;
}

const isPanel = (value: unknown): value is Panel => typeof value === 'string' && value in PANELS;

function readPanels(value: unknown): PanelsState | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const stored = value as Record<string, unknown>;
  // the sidebar shows a view of the manifest, and each section, the inspector and the canvas tools are open or not
  const view = isPanel(stored.sidebarView) && PANELS[stored.sidebarView].place === 'sidebar' ? stored.sidebarView : INITIAL_PANELS.sidebarView;
  const open: Record<string, boolean> = { ...INITIAL_PANELS.open };
  for (const [panel, shown] of Object.entries((stored.open ?? {}) as Record<string, unknown>)) if (panel in PANELS && typeof shown === 'boolean') open[panel] = shown;
  // the dock's tabs are its panels, in the order they were opened
  const tabs: readonly unknown[] = Array.isArray(stored.dockTabs) ? (stored.dockTabs as unknown[]) : [];
  const dockTabs = tabs.filter((tab): tab is Panel => isPanel(tab) && PANELS[tab].place === 'dock');
  return { sidebar: stored.sidebar === true, sidebarView: view, open: open as PanelsState['open'], dockTabs, collapsed: null };
}

// The panels that left their place, as stored: a floating window at a point, a right dock, a combination and the tab
// shown of a combined area. Every entry naming a panel of the manifest and a place the manifest offers is kept; the
// rest is left out, so an older or an edited arrangement never draws a place the editor does not know.
function readMoved(stored: Record<string, unknown>): Pick<LayoutState, 'floating' | 'right' | 'combined' | 'tabActive'> {
  const windows: readonly unknown[] = Array.isArray(stored.floating) ? (stored.floating as unknown[]) : [];
  const floating = windows.flatMap((one) => {
    if (one === null || typeof one !== 'object') return [];
    const { panel, x, y } = one as Record<string, unknown>;
    return isPanel(panel) && typeof x === 'number' && typeof y === 'number' ? [{ panel, x, y }] : [];
  });
  const docked: readonly unknown[] = Array.isArray(stored.right) ? (stored.right as unknown[]) : [];
  const right = docked.filter((one): one is Panel => isPanel(one));
  const joined: readonly unknown[] = Array.isArray(stored.combined) ? (stored.combined as unknown[]) : [];
  const combined = joined.flatMap((one) => {
    if (one === null || typeof one !== 'object') return [];
    const { panel, host, mode } = one as Record<string, unknown>;
    return isPanel(panel) && isPanel(host) && (mode === 'tabs' || mode === 'stack') ? [{ panel, host, mode: mode as 'tabs' | 'stack' }] : [];
  });
  const active: Record<string, Panel> = {};
  for (const [host, tab] of Object.entries((stored.tabActive ?? {}) as Record<string, unknown>)) if (host in PANELS && isPanel(tab)) active[host] = tab;
  return {
    ...(floating.length === 0 ? {} : { floating }),
    ...(right.length === 0 ? {} : { right }),
    ...(combined.length === 0 ? {} : { combined }),
    ...(Object.keys(active).length === 0 ? {} : { tabActive: active }),
  };
}

function readLayout(value: unknown): LayoutState | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const stored = value as Record<string, unknown>;
  const dock = (DOCK_STATES as readonly unknown[]).includes(stored.dock) ? (stored.dock as LayoutState['dock']) : INITIAL_LAYOUT.dock;
  const activeDockTab = isPanel(stored.activeDockTab) ? stored.activeDockTab : INITIAL_LAYOUT.activeDockTab;
  const inspectorTab = typeof stored.inspectorTab === 'string' ? stored.inspectorTab : undefined;
  return { dock, activeDockTab, ...(inspectorTab === undefined ? {} : { inspectorTab }), ...readMoved(stored) };
}

export function readWorkspace(storage: WorkspaceStorage): WorkspacePrefs | undefined {
  const text = storage.read();
  if (text === null) return undefined;
  try {
    const stored = JSON.parse(text) as { panels?: unknown; layout?: unknown; page?: unknown };
    const panels = readPanels(stored.panels);
    const layout = readLayout(stored.layout);
    if (panels === undefined || layout === undefined) return undefined;
    return typeof stored.page === 'string' ? { panels, layout, page: stored.page } : { panels, layout };
  } catch {
    return undefined;
  }
}

// Writes the panels, the layout and the open page every time a command changes them, once its gesture is over (a
// splitter drag changes the sizes many times; its release keeps the last, Escape none)
export function persistWorkspace(store: { getState(): { readonly ui: EditorUi }; subscribe(listener: () => void): () => void }, storage: WorkspaceStorage = browserWorkspace): () => void {
  let last = store.getState().ui;
  return store.subscribe(() => {
    const ui = store.getState().ui;
    if (ui.panels === last.panels && ui.layout === last.layout && ui.page === last.page) return;
    last = ui;
    storage.write(JSON.stringify({ panels: { ...ui.panels, collapsed: null }, layout: ui.layout, page: ui.page ?? null }));
  });
}

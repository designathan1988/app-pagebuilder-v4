// What the panels are (PRODUCT.md §5): each panel's name, place and whether it is open at the first start, read from
// `panels` of layout.json, and the first state of the panels. Data only: the panel commands (panels.ts) and the
// workspace layout (layout.ts) both read it without importing each other (plan I.8: no cycle).
import type { CommandArgs } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { DockState } from './layout.ts';

export type Panel = CommandArgs['workspace.setPanelOpen']['panel'];
export type PanelData = (typeof manifest.layout.panels)[string];
export type PanelPlace = PanelData['place'];

// manifest:check rule panel proves layout.json declares every panel of workspace.setPanelOpen, and only those
export const PANELS = manifest.layout.panels as Readonly<Record<Panel, PanelData>>;

// A door's arguments open a panel without its content: they name a panel the shell draws no body for (drawsBody, from
// the tables the shell draws its bodies from: src/editor/shell/bodies.ts) and do not close it. Such a door is drawn
// disabled with "not available yet" (AGENTS.md), as a door of a command that is not built.
export function opensEmptyPanel(args: Readonly<Record<string, unknown>>, drawsBody: (panel: Panel) => boolean): boolean {
  return typeof args.panel === 'string' && args.panel in PANELS && args.open !== 'close' && !drawsBody(args.panel as Panel);
}

// a panel's name in the catalogue
export const panelName = (panel: Panel): MessageId => PANELS[panel].labelKey as MessageId;

// the panels that live in a place, in the order of layout.json
export function panelsAt(place: PanelPlace): readonly Panel[] {
  return (Object.keys(PANELS) as Panel[]).filter((panel) => PANELS[panel].place === place);
}

// The sections of the sidebar's stack (spec panel-resize): the sections whose `in` is null show under every sidebar
// view, below the view that shows, in the order of layout.json.
export function stackedSections(): readonly Panel[] {
  return panelsAt('section').filter((panel) => PANELS[panel].in === null);
}

export interface PanelsState {
  // the sidebar column (Ctrl+B) and the view it shows
  readonly sidebar: boolean;
  readonly sidebarView: Panel;
  // whether each section, the inspector and the canvas tools are open
  readonly open: Readonly<Record<Panel, boolean>>;
  // the dock's tabs, in the order they were opened
  readonly dockTabs: readonly Panel[];
  // what the first Ctrl+\ collapsed, put back by the second
  readonly collapsed: { readonly sidebar: boolean; readonly inspector: boolean; readonly dock: DockState } | null;
}

const sidebarViews = panelsAt('sidebar');
const firstView = sidebarViews.find((panel) => PANELS[panel].open) ?? sidebarViews[0];
if (firstView === undefined) throw new Error('layout.json declares no sidebar view');

export const INITIAL_PANELS: PanelsState = {
  sidebar: sidebarViews.some((panel) => PANELS[panel].open),
  sidebarView: firstView,
  open: Object.fromEntries((Object.keys(PANELS) as Panel[]).map((panel) => [panel, PANELS[panel].open])) as Record<Panel, boolean>,
  dockTabs: panelsAt('dock').filter((panel) => PANELS[panel].open),
  collapsed: null,
};

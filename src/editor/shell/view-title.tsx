// The title every sidebar view draws (the explorer, Insert, the data panel…): its own file, so a view drawn by a module
// of its own imports it without importing the sidebar that draws the views (plan I.8: no cycle).
import { DoorControl } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useEditorState } from '../store.ts';
import { floatingOf } from '../workspace/layout.ts';
import type { Panel } from '../workspace/panel-catalogue.ts';
import { PanelGrip } from '../workspace/windows.tsx';

// the panel header's doors (PRODUCT.md §5.3 `panel-header`: put the panel back in its place, close it), drawn in the
// title of each sidebar view; the first only while the panel is away from its place (floating, or docked right)
const PANEL_HEADER = doorSlots('panel-header');
// (the door that names a place to move the panel to)
export const DOCK_BACK = PANEL_HEADER.find((entry) => 'to' in entry.door.args);

// A sidebar view's title: its name, and the panel header's doors, each standing for the view it acts on. It is the
// view's drag source too (spec floating-panels: a press on a panel's header moves the panel).
export function ViewTitle({ panel, title }: { readonly panel: Panel; readonly title: string }) {
  // a view drawn inside a floating window carries the window's own drag too (spec floating-panels)
  const floating = useEditorState((state) => floatingOf(state.ui, panel) !== null);
  const away = useEditorState((state) => floatingOf(state.ui, panel) !== null || (state.ui.layout.right ?? []).includes(panel));
  return (
    <div className="view__title" data-region="panel-header" data-panel-header={panel}>
      <span className="view__name">{title}</span>
      <PanelGrip panel={panel} floating={floating === true} />
      {PANEL_HEADER.filter((entry) => entry !== DOCK_BACK || away).map((entry) => (
        <DoorControl key={entry.ref} entry={entry} args={{ panel }} />
      ))}
    </div>
  );
}

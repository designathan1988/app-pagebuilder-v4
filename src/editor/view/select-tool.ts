// The Select tool (view.selectTool: the canvas toolbar's first tool, and V): the editor's ordinary way of working,
// where a click selects and a drag moves or resizes what is selected. Choosing it puts away whatever other tool the
// canvas held: a module's tool (the Layout Composer keeps its intent in the document, so leaving it loses nothing)
// and the grid edit mode. It is current while no other tool is.
import { message, registerHandler } from '../../core/commands/registry.ts';
import type { EditorUi } from '../state.ts';
import { showPanel } from '../workspace/panels.ts';

// the editor state with no tool but Select. A tool says in its state what it changed of the workspace while on: the
// Layers it folded to give its panel the room (layers: true) open again, and the sidebar view its options were drawn
// in (shows) gives the sidebar back to the Explorer.
function selecting(ui: EditorUi): EditorUi {
  const { modules, gridEdit: _gridEdit, ...rest } = ui;
  void _gridEdit;
  const states = Object.values(modules ?? {}).filter((state): state is { layers?: unknown; shows?: unknown; back?: unknown } => typeof state === 'object' && state !== null);
  const opened = states.some((state) => state.layers === true) ? showPanel(rest, 'layers') : rest;
  // the view the sidebar showed before the tool came on (`back`), else the Explorer
  const showing = states.find((state) => state.shows === opened.panels.sidebarView);
  return showing === undefined ? opened : showPanel(opened, (typeof showing.back === 'string' ? showing.back : 'explorer') as Parameters<typeof showPanel>[1]);
}

const otherTool = (ui: EditorUi): boolean => Object.keys(ui.modules ?? {}).length > 0 || ui.gridEdit !== undefined;

export const selectTool = registerHandler<'view.selectTool', EditorUi>(
  'view.selectTool',
  ({ state }) => (otherTool(state.ui) ? { kind: 'change', ui: selecting(state.ui), message: message('status.tool.select') } : { kind: 'change', message: message('status.tool.select') }),
  (state) => !otherTool(state.ui),
);

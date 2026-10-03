// The editor's wiring (src/editor/wiring.ts): the command table and predicates, the feature table, and the installed
// modules' editor side, handed to the editor through its port instead of imported by it (plan I.9).
// the feature table before the command table: it installs itself in the core's registry, which modules of the editor
// the command table loads read as they load
import './features.ts';
import type { EditorWiring } from '../editor/wiring.ts';
import { COMMANDS, PREDICATES } from './commands.ts';
import { MODULE_CANVAS_LAYERS, MODULE_SIDEBAR_VIEWS, installModuleTools } from './modules-view.ts';

export const EDITOR_WIRING: EditorWiring = {
  commands: COMMANDS,
  predicates: PREDICATES,
  sidebarViews: MODULE_SIDEBAR_VIEWS,
  canvasLayers: MODULE_CANVAS_LAYERS,
  installTools: installModuleTools,
};

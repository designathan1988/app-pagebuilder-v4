// The centre column's view (INVENTORY.md, owners; the manifest's code-panel-view): what the column beside
// the sidebar shows — the canvas, the canvas with the code pane beside it, or the code pane alone.
// One owner of which it is and of the door that sets it; the shell draws per `editorView` and
// the editor keeps the choice in `ui` (workspace/persist.ts carries it between sessions, as it carries the page).
import { message, registerHandler } from '../../core/commands/registry.ts';
import type { EditorUi } from '../state.ts';

export type EditorView = 'canvas' | 'split' | 'code';

// The view in force: the canvas, until one is chosen.
export const editorView = (ui: EditorUi): EditorView => ui.editorView ?? 'canvas';

// what the status bar says for each view: its own message, so the words are the catalogue's and a scenario names one
const SAID = { canvas: 'status.view.canvas', split: 'status.view.split', code: 'status.view.code' } as const;

export const setEditorView = registerHandler<'view.setEditorView', EditorUi>(
  'view.setEditorView',
  ({ state }, { view }) => ({ kind: 'change', ui: { ...state.ui, editorView: view === 'canvas' ? undefined : view }, message: message(SAID[view]) }),
  // a door stands for the view it shows, so the segments mark the one in force
  (state, { view }) => editorView(state.ui) === view,
);

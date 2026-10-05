// The code files open in the code pane (INVENTORY.md, owners; the manifest's code-panel-view): which files
// are open, which one the pane shows, and the door that closes one. One owner: the tab strip draws a tab per open file
// (shell/canvas.tsx, the file-tabs region) beside the pages' tabs, and the code pane draws the active one.
// A page's own tab is pages.switch's (core/project/pages.ts): the page shows on the canvas, a code file in the pane.
import { message, registerHandler } from '../../core/commands/registry.ts';
import type { EditorUi } from '../state.ts';
import { editorView } from '../view/editor-view.ts';

export interface CodeTabsState {
  // the paths open, in the order they were opened
  readonly open: readonly string[];
  // the path the pane shows (always one of `open`)
  readonly active: string;
}

export const codeTabs = (ui: EditorUi): CodeTabsState | null => ui.code ?? null;
const isFileOpen = (ui: EditorUi, path: string): boolean => codeTabs(ui)?.open.includes(path) === true;
export const activeFile = (ui: EditorUi): string | null => codeTabs(ui)?.active ?? null;
// The file a person sees: the active one while the centre shows the code (the Code view, or Split beside the canvas).
// Its tab is the current one, and the page's while the canvas alone shows (FT1: every open file's tab, and the active
// one's close button, were drawn current over the canvas, two tabs selected at once where the design marks one).
export const isFileShown = (ui: EditorUi, path: string): boolean => activeFile(ui) === path && editorView(ui) !== 'canvas';

// The state with a file open and shown; a file already open is shown, not opened twice.
export function openedFile(ui: EditorUi, path: string): EditorUi {
  const tabs = codeTabs(ui);
  const open = tabs === null || tabs.open.includes(path) ? tabs?.open ?? [path] : [...tabs.open, path];
  return { ...ui, code: { open, active: path } };
}

// A file closed; the pane falls back to the file opened before it (the last remaining), and the pane closes with the
// last tab. Closing the file the pane shows is allowed: the pane moves to the tab beside it.
function closedFile(ui: EditorUi, path: string): EditorUi {
  const tabs = codeTabs(ui);
  if (tabs === null) return ui;
  const at = tabs.open.indexOf(path);
  if (at < 0) return ui;
  const open = tabs.open.filter((one) => one !== path);
  if (open.length === 0) return { ...ui, code: undefined };
  const active = tabs.active === path ? (open[Math.min(at, open.length - 1)] ?? open[0] ?? '') : tabs.active;
  return { ...ui, code: { open, active } };
}

// files.closeTab: the tab's own close button (the file-tabs region). It changes the editor, never the document.
export const closeFileTab = registerHandler<'files.closeTab', EditorUi>(
  'files.closeTab',
  ({ state }, { path }) => {
    if (typeof path !== 'string' || path === '') throw new Error('files.closeTab: a door hands the path of the file it closes');
    if (!isFileOpen(state.ui, path)) return { kind: 'change' };
    const ui = closedFile(state.ui, path);
    // the pane goes with its last file: the centre column shows the canvas again (Split stays as it is)
    return { kind: 'change', ui: ui.code === undefined && editorView(ui) === 'code' ? { ...ui, editorView: undefined } : ui, message: message('status.files.closed', { path }) };
  },
  (state, { path }) => typeof path === 'string' && isFileShown(state.ui, path),
);

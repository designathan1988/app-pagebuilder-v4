// Renaming in Layers (PRODUCT.md §5, "Renaming in Layers"; spec rename-element): layers.startRename and the editor
// state of a rename (`ui.rename`). F2 on the canvas, a double-click on a Layers row's name, the context menu's Rename
// and Arrange › Rename start the one inline edit (spec, Problems in Pager 2: no dialog): the selected node's Layers row
// draws its name as a field holding that name, selected, with the focus (src/editor/shell/sidebar/layers.tsx). The
// Layers
// section is shown first when it is hidden, and the branches that hide the row unfold (layers/tree.ts). What the field
// holds is kept by element.rename (src/core/nodes/names.ts) when it is submitted with Enter or loses the focus.
//
// A rename ends when element.rename runs (like any undoable command: the document may change under it), and when the
// selection is no longer its node alone (a click elsewhere, a loaded project). A locked element, or one inside a
// locked element, is not renamed: the status bar says what to unlock (spec lock-element, `lockRefusal`).
import { message, registerHandler } from '../../core/commands/registry.ts';
import { locate, type NodeId } from '../../core/document/model.ts';
import { lockRefusal } from '../../core/nodes/flags.ts';
import { selectedAlone } from '../../core/selection/selection.ts';
import type { StoreState } from '../../core/store/store.ts';
import type { Command } from '../../manifest/schema.ts';
import type { EditorUi } from '../state.ts';
import { showPanel } from '../workspace/panels.ts';
import { revealSelection } from './tree.ts';

export interface RenameState {
  // the node whose name is edited in its Layers row, or null
  readonly node: NodeId | null;
}

export const INITIAL_RENAME: RenameState = { node: null };

// the node renamed now, or null
export const renamedNode = (ui: EditorUi): NodeId | null => ui.rename.node;

const ended = (ui: EditorUi): EditorUi => (ui.rename.node === null ? ui : { ...ui, rename: INITIAL_RENAME });

// layers.cancelRename: Escape in the name field (its key context, rename-field) ends the rename keeping the name the
// node holds; nothing is recorded (spec rename-element: "Escape cancels")
export const cancelRename = registerHandler<'layers.cancelRename', EditorUi>('layers.cancelRename', ({ state }) => ({ kind: 'change', ui: ended(state.ui) }));

export const startRename = registerHandler<'layers.startRename', EditorUi>('layers.startRename', ({ state }) => {
  const [only, ...others] = state.selection;
  // the availability predicate (singleSelection) lets no door run with none or several selected
  if (only === undefined || others.length > 0) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const found = locate(state.document, only);
  // the page root is no element of the page and carries no element name to change (spec rename-element); its page's
  // name belongs to the page (pages.rename)
  if (found === null) throw new Error(`layers.startRename: the document has no node ${only}`);
  if (found.parent === null) return { kind: 'refused', message: message('status.rename.root') };
  const locked = lockRefusal(state.document, only, 'status.locked.rename');
  if (locked !== null) return { kind: 'refused', message: locked };
  // the row that draws the field is on screen: Layers shown, and every folded branch above the node unfolded
  const shown = revealSelection({ ...state, ui: showPanel(state.ui, 'layers') });
  return { kind: 'change', ui: { ...shown, rename: { node: only } } };
});

// The editor state after the selection changed: a rename ends when the selection is no longer its node alone.
export function endRenameOffSelection(state: StoreState<EditorUi>): EditorUi {
  const node = state.ui.rename.node;
  if (node === null) return state.ui;
  return selectedAlone(state.document, state.selection, node) ? state.ui : ended(state.ui);
}

// The editor state after a command ran: an undoable command (element.rename keeping the name among them) ends it.
export function endRenameOnUndoable(state: StoreState<EditorUi>, command: Command): EditorUi {
  return command.history.undoable ? ended(state.ui) : state.ui;
}

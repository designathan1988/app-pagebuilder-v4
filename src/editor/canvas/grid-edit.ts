// The canvas grid editor (INVENTORY.md, owners; spec canvas-grid-editor; the user's real-use audit, item
// 8.2): a grid container is edited on the canvas itself. A double click on it enters the editor (grid.enterEdit), the
// Escape of its own key context leaves it (grid.exitEdit; interactions.json grid-edit, which the keymap takes for the
// canvas's while it is on, canvas/edit-mode.ts keyContextIn). While it lasts the canvas chrome (canvas/grid-editor.tsx)
// draws the column numbers, a grip on every track boundary and, on the selected item, a grip at its bottom-right
// corner; every grip is the canvas-handle door of the command that writes:
//  - a track's size: the handle-grid-track door of style.setGridTracks (the one owner of a grid's tracks),
//  - an item's span: grid.spanItem, which reads the track width from the item's own box (the layout port) and asks
//    style.setGridItem — the one owner of an item's place — for the start and the span it covers.
// The keys of the editing context change the grid: + adds a column and − takes the last away (through the track
// owner), Ctrl+M merges the selected item's cell with the next one and Ctrl+Shift+M splits its last cell away (only
// where the cells are free; the status names what stands in the way). Everything is one undo step, at the breakpoint
// and state the editor edits — the per-breakpoint grid.
//
// Everything of the editor is editor state (ui.gridEdit: the grid it edits, absent while none): nothing of it is
// document state, and every write goes through the owners above. An element that is not a grid container is refused
// with the reason, and so is a grid the document no longer holds.
import { message, registerHandler, type Outcome } from '../../core/commands/registry.ts';
import { locate, type DocNode, type NodeId, type StyleClass } from '../../core/document/model.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import type { Layout } from '../../core/ports/layout.ts';
import type { KeyContextId } from '../../generated/ids.ts';
import { valuePredicateHolds } from '../../core/style/couplings.ts';
import { setGridItemCommand, storedPlace } from '../../core/style/grid-item.ts';
import { setGridTracksCommand } from '../../core/style/tracks.ts';
import type { EditorUi } from '../state.ts';

// the value predicate that says an element lays its children out as a grid (properties.json)
const GRID_CONTAINER = 'gridContainer';
// the key context of the canvas while the grid editor is on (interactions.json grid-edit, inheriting the canvas's)
export const GRID_EDIT_CONTEXT: KeyContextId = 'grid-edit';

export const gridEditOf = (ui: EditorUi): NodeId | null => ui.gridEdit ?? null;

// whether a node is a grid container the editor can open on
// (its own display, else its classes')
const isGridContainer = (node: DocNode | null, rules: ModelRules, classes: readonly StyleClass[] = []): boolean => node !== null && valuePredicateHolds(node, GRID_CONTAINER, rules, classes);

export const enterGridEdit = registerHandler<'grid.enterEdit', EditorUi>('grid.enterEdit', ({ state, rules }, { target }) => {
  const node = (target as NodeId | undefined) ?? state.selection[0];
  const found = node === undefined ? null : locate(state.document, node);
  if (found === null) return { kind: 'change' };
  if (!isGridContainer(found.node, rules, state.document.classes)) return { kind: 'refused', message: message('status.gridEdit.notGrid', { name: found.node.name }) };
  if (state.ui.gridEdit === found.node.id) return { kind: 'change' };
  return { kind: 'change', ui: { ...state.ui, gridEdit: found.node.id as NodeId } };
});

export const exitGridEdit = registerHandler<'grid.exitEdit', EditorUi>('grid.exitEdit', ({ state }) => {
  if (state.ui.gridEdit === undefined) return { kind: 'change' };
  const { gridEdit: _left, ...rest } = state.ui;
  void _left;
  return { kind: 'change', ui: rest };
});

// the node of the grid being edited, or null (the document no longer holding it, or no editor on)
function editedGrid(state: { readonly document: Parameters<typeof locate>[0]; readonly ui: EditorUi }): DocNode | null {
  const id = gridEditOf(state.ui);
  return id === null ? null : (locate(state.document, id)?.node ?? null);
}

// the grid an editing command acts on: the one being edited, else the selection's own grid container
function gridOf(state: { readonly document: Parameters<typeof locate>[0]; readonly selection: readonly NodeId[]; readonly ui: EditorUi }, rules: ModelRules): DocNode | null {
  const edited = editedGrid(state);
  if (edited !== null) return edited;
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0])?.node ?? null;
  return isGridContainer(primary, rules, state.document.classes) ? primary : null;
}

// the item of the grid the span keys act on: the selected element, a child of the grid being edited
function itemOf(state: { readonly document: Parameters<typeof locate>[0]; readonly selection: readonly NodeId[]; readonly ui: EditorUi }, rules: ModelRules): DocNode | null {
  const grid = gridOf(state, rules);
  const [only, ...others] = state.selection;
  if (grid === null || only === undefined || others.length > 0) return null;
  const at = locate(state.document, only);
  return at !== null && at.parent?.id === grid.id ? at.node : null;
}

// An edit of the tracks: the grid being edited takes the selection for the one owner of a grid's tracks (the write
// acts on the selected element), so the keys change the grid the editor holds, whatever is selected in it.
function tracksOn(
  context: { readonly state: { readonly document: Parameters<typeof locate>[0]; readonly selection: readonly NodeId[]; readonly ui: EditorUi }; readonly rules: ModelRules },
  edit: { readonly property: string; readonly edit: { readonly add?: true; readonly remove?: true } }
): Outcome<EditorUi> {
  const grid = gridOf(context.state, context.rules);
  if (grid === null) return { kind: 'change' };
  const aimed = { ...context, state: { ...context.state, selection: [grid.id as NodeId] } };
  return setGridTracksCommand.run(aimed as never, { property: edit.property, edit: edit.edit } as never) as Outcome<EditorUi>;
}

export const addGridTrack = registerHandler<'grid.addTrack', EditorUi>('grid.addTrack', (context, { property }) =>
  tracksOn(context, { property, edit: { add: true } }),
);

export const removeGridTrack = registerHandler<'grid.removeTrack', EditorUi>('grid.removeTrack', (context, { property }) =>
  tracksOn(context, { property, edit: { remove: true } }),
);

// the item's span on an axis, written through the one owner of an item's place; null when the selection is no item of
// the grid being edited
function spanThrough(context: { readonly state: Parameters<typeof gridOf>[0]; readonly rules: ModelRules; readonly layout: Layout }, property: string, span: number): Outcome<EditorUi> | null {
  const { state, rules } = context;
  const item = itemOf(state, rules);
  if (item === null) return null;
  const held = storedPlace(item, property, rules);
  const start = held.start ?? undefined;
  return setGridItemCommand.run(context as never, { property, ...(start === undefined ? {} : { start }), span } as never) as Outcome<EditorUi>;
}

// grid.spanItem (spec canvas-grid-editor; the audit's item 8.2): the grip at the item's bottom-right corner writes
// the span the drag covers — the px the drag makes divided by the width of one track, which the item's own box and its
// current span give (the layout port). A drag that would cover no track writes span 1.
export const spanGridItem = registerHandler<'grid.spanItem', EditorUi>('grid.spanItem', (context, { property, value, span: heldSpan, width }) => {
  const { state, rules, layout } = context;
  const item = itemOf(state, rules);
  if (item === null) return { kind: 'change' };
  const held = storedPlace(item, property, rules);
  const asked = Number.parseFloat(value);
  // the width of one track: what the grip measured at the press (the width it carries, else the item's box in the
  // layout port), divided by the span the item covered then — never the box mid-drag, which the write itself changes
  const measured = typeof width === 'number' && width > 0 ? width : (layout.box(item.id as NodeId)?.width ?? 0);
  const coveredThen = typeof heldSpan === 'number' && heldSpan > 0 ? heldSpan : held.span;
  if (measured <= 0 || !Number.isFinite(asked)) return { kind: 'change' };
  const tracks = Math.max(1, Math.round(asked / (measured / coveredThen)));
  return spanThrough(context, property, tracks) ?? { kind: 'change' };
});

// The cells an item covers on an axis: its start (its own, else 1) and its span.
function covered(item: DocNode, property: string, rules: ModelRules): { readonly start: number; readonly span: number } {
  const held = storedPlace(item, property, rules);
  return { start: held.start ?? 1, span: held.span };
}

// what holds a child of the grid in the cells an item would cover (the audit's item 8.2: a merge only where the cells
// are free), or null. A child with no place of its own takes the next free cell (the grid's auto flow), so a merge
// covers it by moving it along, never by colliding with it.
function holdsCells(grid: DocNode, property: string, rules: ModelRules, item: DocNode, start: number, span: number): DocNode | null {
  for (const child of grid.children) {
    if (child === item) continue;
    if (storedPlace(child, property, rules).start === null) continue;
    const at = covered(child, property, rules);
    if (at.start < start + span && at.start + at.span > start) return child;
  }
  return null;
}

export const mergeGridCells = registerHandler<'grid.mergeCells', EditorUi>('grid.mergeCells', (context, { property }) => {
  const { state, rules } = context;
  const grid = gridOf(state, rules);
  const item = itemOf(state, rules);
  if (grid === null || item === null) return { kind: 'change' };
  const at = covered(item, property, rules);
  const standing = holdsCells(grid, property, rules, item, at.start, at.span + 1);
  if (standing === null) return spanThrough(context, property, at.span + 1) ?? { kind: 'change' };
  return { kind: 'refused', message: message('status.gridEdit.cellTaken', { name: standing.name }) };
});

export const splitGridCells = registerHandler<'grid.splitCells', EditorUi>('grid.splitCells', (context, { property }) => {
  const { state, rules } = context;
  const item = itemOf(state, rules);
  if (item === null) return { kind: 'change' };
  const at = covered(item, property, rules);
  if (at.span <= 1) return { kind: 'refused', message: message('status.gridEdit.nothingToSplit', { name: item.name }) };
  return spanThrough(context, property, at.span - 1) ?? { kind: 'change' };
});


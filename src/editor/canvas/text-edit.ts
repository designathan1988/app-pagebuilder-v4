// Inline text editing (PRODUCT.md §5, "The text editing surface"; spec text-edit-inline): text.startEdit,
// text.cancelEdit and text.insertLineBreak, and the editor state of an edit (`ui.textEdit`). The edit happens on the
// page itself, in the zoomed iframe: the handlers only record the edit in the editor state, and the canvas frame
// (frame.tsx) has the renderer carry it out on the page (the edited element made editable and focused with the caret
// at the end of its text, a line break inserted at the caret, the element given back its text when the edit ends)
// and has the keymap read the keys on the frame's window meanwhile, in the text-editing key context. What the edit
// holds is kept by text.set (src/core/text/text.ts), whose doors take the node and the text from `editArgs`.
//
// The marks of the edited text (spec text-inline-formatting): text.toggleBold, text.toggleItalic, text.editLink and
// text.paste only ask for a change of the marks (src/core/text/inline.ts: a mark toggled over the text selection, a
// link's address, pasted runs), and the canvas frame has the renderer read the edited element's runs and its text
// selection, apply the change and draw the result. text.editLink without an address opens the link prompt (the text
// toolbar draws it, text-toolbar.tsx: the command's own question, as a confirmation is), which runs it again with the
// address typed; an address that is not allowed is refused and the prompt stays, an empty one removes the link, and a
// dismissal (its backdrop) closes it. text.paste runs with what the system clipboard held (its door reads it,
// src/editor/clipboard.ts): nothing there, or nothing that reads as text, is refused, and so is a clipboard the
// browser does not let the editor read.
//
// An edit ends when its text is kept (text.set, like any undoable command, ends it: the document may change under
// it), when Escape cancels it, and when the selection is no longer the edited node alone (a click elsewhere, a
// loaded project).
import { message, registerHandler, registerPredicate } from '../../core/commands/registry.ts';
import { locate, type DocNode, type DocumentJson, type NodeId } from '../../core/document/model.ts';
import { lockRefusal } from '../../core/nodes/flags.ts';
import { selectedAlone } from '../../core/selection/selection.ts';
import type { StoreState } from '../../core/store/store.ts';
import { canonical, hasMarks, isSafeHref, keptHref, linkAddressAt, pastedRuns, plainText, type InlineChange, type InlineRun, type TextRange } from '../../core/text/inline.ts';
import type { KeyContextId, RegionId } from '../../generated/ids.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { Command } from '../../manifest/schema.ts';
import type { EditorUi } from '../state.ts';

export interface TextEditState {
  // the node whose text is edited, or null
  readonly node: NodeId | null;
  // the line breaks asked for (Shift+Enter); the count tells a new request from one carried out
  readonly lineBreaks: number;
  // the "select all the text" asked for (Ctrl+A while editing, select-container-children), counted the same way
  readonly selectAlls: number;
  // the changes of the edited text's marks asked for (a mark toggled, a link's address, a paste), counted the same
  // way, and the last one
  readonly changes: number;
  readonly change: InlineChange | null;
  // the link prompt while it asks for an address: which opening it is and how many overlay dismissals had arrived then
  // (a newer one closes it, menus/overlays.ts); null while it is closed
  readonly linkPrompt: { readonly count: number; readonly dismissals: number } | null;
}

export const INITIAL_TEXT_EDIT: TextEditState = { node: null, lineBreaks: 0, selectAlls: 0, changes: 0, change: null, linkPrompt: null };

// the key context of the edited text (interactions.json): it inherits nothing, so the tree's keys never reach it
export const TEXT_EDITING: KeyContextId = 'text-editing';
// the region of the text toolbar (layout.json), drawn over the canvas while a text is edited (text-toolbar.tsx)
export const TEXT_TOOLBAR: RegionId = 'text-toolbar';

// the elements whose content is a text (elements.json)
const TEXTUAL = new Set<string>(manifest.elements.elements.filter((e) => e.content === 'text').map((e) => e.id));

export const editedNode = (state: StoreState<EditorUi>): NodeId | null => state.ui.textEdit.node;

// whether a node of the document is a text element (a double-click's "text-element")
export function isTextElement(document: DocumentJson, id: NodeId): boolean {
  const found = locate(document, id);
  return found !== null && TEXTUAL.has(found.node.type);
}

const withEdit = (ui: EditorUi, textEdit: TextEditState): EditorUi => ({ ...ui, textEdit });
// an edit that ends takes its link prompt with it
const ended = (ui: EditorUi): EditorUi => (ui.textEdit.node === null ? ui : withEdit(ui, { ...ui.textEdit, node: null, linkPrompt: null }));

// The link prompt's opening while it is open, null while it is closed: closed by a dismissal newer than its opening,
// by the address it asked for, and with the edit.
export function openLinkPrompt(ui: EditorUi): TextEditState['linkPrompt'] {
  const { node, linkPrompt } = ui.textEdit;
  return node !== null && linkPrompt !== null && linkPrompt.dismissals === ui.overlays.dismissals ? linkPrompt : null;
}

// the one selected node, when it is a text element
function singleText(state: StoreState<EditorUi>): DocNode | null {
  const [only, ...others] = state.selection;
  if (only === undefined || others.length > 0 || !isTextElement(state.document, only)) return null;
  return locate(state.document, only)?.node ?? null;
}

// text.startEdit's availability: one text element selected. Refused, the status bar says why (spec, Problems 3):
// a selection of none or several needs one element, and an element with no text has none to edit.
export const singleTextSelection = registerPredicate<EditorUi>(
  'singleTextSelection',
  (state) => singleText(state) !== null,
  (state) => {
    const [only, ...others] = state.selection;
    if (only === undefined || others.length > 0) return message('status.needsSingleSelection');
    return message('status.textEdit.notText', { name: locate(state.document, only)?.node.name ?? '' });
  },
);

export const startEdit = registerHandler<'text.startEdit', EditorUi>('text.startEdit', ({ state }) => {
  const node = singleText(state);
  if (node === null) return { kind: 'refused', message: message('status.needsSingleSelection') };
  // the text of a locked element, or of one inside a locked element, is not edited, and the status bar says what to
  // unlock (spec lock-element, Problems in Pager 3)
  const locked = lockRefusal(state.document, node.id, 'status.locked.editText');
  if (locked !== null) return { kind: 'refused', message: locked };
  return { kind: 'change', ui: withEdit(state.ui, { ...state.ui.textEdit, node: node.id }), message: message('status.textEdit.editing') };
});

// Escape: the text goes back to what the document holds, and nothing is recorded: the element edited in place ends its
// edit; with none, the inspector's text field of the one selected text element (spec inspector-panel) is told so by
// the message, after which it shows the document's text again (src/editor/shell/inspector.tsx)
export const cancelEdit = registerHandler<'text.cancelEdit', EditorUi>('text.cancelEdit', ({ state }) => {
  const node = state.ui.textEdit.node;
  if (node === null) {
    const field = singleText(state);
    return field === null ? { kind: 'change' } : { kind: 'change', message: message('status.textEdit.cancelled', { name: field.name }) };
  }
  return { kind: 'change', ui: ended(state.ui), message: message('status.textEdit.cancelled', { name: locate(state.document, node)?.node.name ?? '' }) };
});

// Shift+Enter: a line break at the caret, kept as "\n" when the text is kept (spec, Problems 1)
export const insertLineBreak = registerHandler<'text.insertLineBreak', EditorUi>('text.insertLineBreak', ({ state }) => {
  if (state.ui.textEdit.node === null) return { kind: 'change' };
  return { kind: 'change', ui: withEdit(state.ui, { ...state.ui.textEdit, lineBreaks: state.ui.textEdit.lineBreaks + 1 }) };
});

// Ctrl+A while editing (spec select-container-children): every character of the edited text becomes the text
// selection, so what is typed next replaces it; the element selection stays as it is
export const selectAllText = registerHandler<'text.selectAll', EditorUi>('text.selectAll', ({ state }) => {
  if (state.ui.textEdit.node === null) return { kind: 'change' };
  return { kind: 'change', ui: withEdit(state.ui, { ...state.ui.textEdit, selectAlls: state.ui.textEdit.selectAlls + 1 }) };
});

// A change of the edited text's marks asked for, which the renderer carries out on the page (frame.tsx); the link
// prompt as given.
const changed = (ui: EditorUi, change: InlineChange, linkPrompt = ui.textEdit.linkPrompt): EditorUi =>
  withEdit(ui, { ...ui.textEdit, changes: ui.textEdit.changes + 1, change, linkPrompt });

// Ctrl+B and the text toolbar's Bold: bold on the selected characters, or off when they are all bold; a caret takes
// the word it touches (spec text-inline-formatting, Problems in Pager 2)
export const toggleBold = registerHandler<'text.toggleBold', EditorUi>('text.toggleBold', ({ state }) =>
  state.ui.textEdit.node === null ? { kind: 'change' } : { kind: 'change', ui: changed(state.ui, { kind: 'mark', mark: 'strong' }) },
);

// Ctrl+I and the text toolbar's Italic, as Bold
export const toggleItalic = registerHandler<'text.toggleItalic', EditorUi>('text.toggleItalic', ({ state }) =>
  state.ui.textEdit.node === null ? { kind: 'change' } : { kind: 'change', ui: changed(state.ui, { kind: 'mark', mark: 'em' }) },
);

// Ctrl+K and the text toolbar's Link: with no address, the link prompt opens (the status bar says what it asks); with
// the address typed there, the selected characters (a caret: the link it touches, else its word) link to it, or,
// with an empty one, lose their link, and the prompt closes. An address that is not allowed is refused, and the prompt
// stays open (Problems in Pager 1).
export const editLink = registerHandler<'text.editLink', EditorUi>('text.editLink', ({ state }, { href }) => {
  const edit = state.ui.textEdit;
  if (edit.node === null) return { kind: 'change' };
  if (href === undefined) {
    const linkPrompt = { count: (edit.linkPrompt?.count ?? 0) + 1, dismissals: state.ui.overlays.dismissals };
    return { kind: 'change', ui: withEdit(state.ui, { ...edit, linkPrompt }), message: message('status.link.asking') };
  }
  const address = href.trim();
  if (address !== '' && !isSafeHref(address)) return { kind: 'refused', message: message('status.link.unsafe') };
  // the link keeps the address the rule reads, a bare domain as https:// (the audit's AD2)
  return { kind: 'change', ui: changed(state.ui, { kind: 'link', href: address === '' ? null : keptHref(address) }, null), message: message('status.textEdit.editing') };
});

// Ctrl+V while editing: what the system clipboard held, as marked text (its bold, italic and allowed links kept, the
// rest as its text; Problems in Pager 3), in place of the text selection. Nothing there that reads as text is refused,
// and so is a clipboard the browser does not let the editor read.
export const pasteText = registerHandler<'text.paste', EditorUi>('text.paste', ({ state, rules }, { clipboard }) => {
  if (state.ui.textEdit.node === null) return { kind: 'change' };
  // asked before its door read the clipboard (core/store/args.ts): a paste lands in the text being edited
  if ((clipboard as typeof clipboard | undefined) === undefined) return { kind: 'change' };
  if (clipboard.status === 'denied') return { kind: 'refused', message: message('status.clipboard.denied') };
  const runs = pastedRuns(clipboard, rules.contentModel);
  if (plainText(runs) === '') return { kind: 'refused', message: message('status.paste.empty') };
  return { kind: 'change', ui: changed(state.ui, { kind: 'insert', runs }) };
});

// The editor state after the selection changed: an edit ends when the selection is no longer its node alone.
export function endOffSelection(state: StoreState<EditorUi>): EditorUi {
  const node = state.ui.textEdit.node;
  if (node === null) return state.ui;
  return selectedAlone(state.document, state.selection, node) ? state.ui : ended(state.ui);
}

// The editor state after a command ran: an undoable command (text.set keeping the text among them) ends the edit.
export function endOnUndoable(state: StoreState<EditorUi>, command: Command): EditorUi {
  return command.history.undoable ? ended(state.ui) : state.ui;
}

// What the page's edited element holds now, read by the renderer: its runs and its text selection as a range of their
// characters (null when the selection is not in it). The canvas frame registers the reader.
export interface EditReading {
  readonly runs: readonly InlineRun[];
  readonly range: TextRange | null;
}
let reader: (() => EditReading | null) | null = null;
export function registerEditReader(read: () => EditReading | null): () => void {
  reader = read;
  return () => {
    if (reader === read) reader = null;
  };
}

// The address of the link the edited text's selection is in, or null: what the link prompt starts from (the caret at
// the end of the text when the selection is not in it).
export function editedLinkAddress(): string | null {
  const reading = reader?.() ?? null;
  if (reading === null) return null;
  const end = plainText(reading.runs).length;
  return linkAddressAt(reading.runs, reading.range ?? { start: end, end });
}

// The arguments a door of the edit takes from it, for the argument names its command declares: the edited node
// (`target`) and what the edit holds now (`content`: its plain text, or, when something in it is marked or the node
// held marks, its whole tree of runs, so marks taken off are gone too; src/core/text/inline.ts). Null while nothing is
// edited.
export function editArgs(state: StoreState<EditorUi>, command: Command): Record<string, unknown> | null {
  const node = state.ui.textEdit.node;
  if (node === null) return null;
  const names = Object.keys(command.args);
  const args: Record<string, unknown> = {};
  if (names.includes('target')) args.target = node;
  if (names.includes('content')) {
    const reading = reader?.() ?? null;
    if (reading === null) return null;
    const marked = locate(state.document, node)?.node.inline !== undefined;
    args.content = marked || hasMarks(reading.runs) ? canonical(reading.runs) : plainText(reading.runs);
  }
  return args;
}

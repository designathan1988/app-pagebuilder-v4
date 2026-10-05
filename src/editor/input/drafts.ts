import { saveFieldDraft } from '../persistence/drafts.ts';
// Whether a value field holds typing not kept yet (jornada03 J7): the field's element says so in data-draft, for the
// keymap (with data-shown, the value it shows of the document), which leaves Ctrl+Z to the field while it does and
// gives it to the editor's history once the field is kept (keymap.ts). The value fields write it
// (src/editor/shell/field.tsx).
const DRAFT_TYPED = 'typed';
export const DRAFT_KEPT = 'kept';

export type DraftField = HTMLInputElement | HTMLTextAreaElement;

export function markFieldKept(field: DraftField, value: string): void {
  field.dataset.shown = value;
  field.dataset.draft = DRAFT_KEPT;
  field.dataset.draftRedo = '0';
}

export const hasDraftRedo = (field: DraftField): boolean => Number(field.dataset.draftRedo ?? 0) > 0;

// Native text history is separate from document history. Returning to the confirmed value enables document undo,
// but its native redo must remain reachable until another document command or confirmation ends that draft.
export function recordFieldInput(field: DraftField, event: Event): boolean {
  const inputType = event instanceof InputEvent ? event.inputType : '';
  const redo = Number(field.dataset.draftRedo ?? 0);
  field.dataset.draftRedo = String(inputType === 'historyUndo' ? redo + 1 : inputType === 'historyRedo' ? Math.max(0, redo - 1) : 0);
  const typed = !inputType.startsWith('history') || field.value !== field.dataset.shown;
  field.dataset.draft = typed ? DRAFT_TYPED : DRAFT_KEPT;
  saveFieldDraft(field);
  return typed;
}

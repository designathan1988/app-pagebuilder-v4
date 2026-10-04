// Tab-local, unconfirmed editing. Document autosave remains the owner of confirmed work;
// its revision binds a draft to exactly the saved project it was typed against.
import { z } from 'zod';
import { locate, type NodeId } from '../../core/document/model.ts';
import { canonical, parseInline, type InlineRun, type TextRange } from '../../core/text/inline.ts';
import type { CommandArgs } from '../../generated/commands.ts';
import { startEdit } from '../canvas/text-edit.ts';
import { setOpen } from '../quick-panel/quick-panel.ts';
import { setStyleTarget } from '../inspector/style-target.ts';
import { setStyleState, STATES } from '../view/style-state.ts';
import { revealField } from '../inspector/sections.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { EditorStore } from '../store.ts';

const KEY = 'editing-draft';
const runsSchema = z.unknown().transform((value, context) => {
  const runs = parseInline(value);
  if (runs !== null && runs !== 'unsafe') return runs;
  context.addIssue({ code: 'custom', message: 'Invalid inline draft' });
  return z.NEVER;
});
const rangeSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
const common = {
  version: z.literal(1), revision: z.number().int().nonnegative(), selection: z.array(z.string()),
  context: z.object({ quick: z.boolean(), styleState: z.string().nullable(), styleTarget: z.string().nullable(), revealed: z.string().nullable() }),
};
const schema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('field'), key: z.string(), shown: z.string(), value: z.string(), range: rangeSchema.nullable() }),
  z.object({ ...common, kind: z.literal('canvas'), node: z.string(), runs: runsSchema, range: rangeSchema.nullable() }),
]);
type Draft = z.infer<typeof schema>;
type Field = HTMLInputElement | HTMLTextAreaElement;
let store: EditorStore | null = null;
let revision = () => 0;
let mayWrite = () => false;
let held: Draft | null = null;
let restoring = false;
let pending = false;
let canvasCapture: (() => void) | null = null;
const draftListeners = new Set<() => void>();

export function subscribePendingDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

export function registerDraftCapture(capture: () => void): () => void {
  canvasCapture = capture;
  return () => {
    if (canvasCapture === capture) canvasCapture = null;
  };
}
export function flushDraftCaret(): void {
  if (held?.kind === 'canvas') canvasCapture?.();
  const field = document.activeElement;
  if (held?.kind === 'field' && !pending && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && fieldKey(field) === held.key) saveFieldDraft(field);
}

export const hasPendingDraft = (): boolean => held !== null && mayWrite();
function persist(next: Draft | null): void {
  held = next;
  try {
    if (next === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* The in-memory draft still enables the leave-page warning if storage is unavailable. */ }
  if (next !== null) for (const listener of [...draftListeners]) listener();
}
function context() {
  const state = store?.getState();
  return {
    version: 1 as const, revision: revision(), selection: [...(state?.selection ?? [])],
    context: { quick: state?.ui.quickPanelOpen === true, styleState: state?.ui.styleState ?? null, styleTarget: state?.ui.styleTarget ?? null, revealed: state?.ui.revealed?.field ?? null },
  };
}
const fieldKey = (field: Field): string | null => {
  const door = field.closest<HTMLElement>('[data-door]');
  return door ? JSON.stringify([door.dataset.door, door.dataset.args ?? '', field.getAttribute('aria-label')]) : null;
};
const fieldRange = (field: Field): TextRange | null => field.selectionStart === null || field.selectionEnd === null ? null : { start: field.selectionStart, end: field.selectionEnd };

export function saveFieldDraft(field: Field): void {
  if (restoring || !store || !mayWrite()) return;
  const key = fieldKey(field);
  if (key === null || field.dataset.shown === undefined) return;
  if (field.value === field.dataset.shown) {
    if (held?.kind === 'field' && held.key === key) persist(null);
    return;
  }
  pending = false;
  persist({ ...context(), kind: 'field', key, shown: field.dataset.shown, value: field.value, range: fieldRange(field) });
}

// Restore after React's mount/cleanup rehearsal. Each field keeps its own dirty marker; the journal never commits it.
export function restoreFieldDraft(field: Field, restored: () => void): () => void {
  const key = fieldKey(field);
  if (!pending || held?.kind !== 'field' || held.key !== key) {
    if (!pending && held?.kind === 'field' && held.key === key) persist(null);
    return () => {};
  }
  const draft = held;
  if (draft.shown !== field.dataset.shown) {
    pending = false;
    persist(null);
    return () => {};
  }
  let frame = 0;
  const apply = () => {
    if (!field.isConnected || held !== draft || !mayWrite()) return;
    // Floating panels measure while hidden. Wait for their actual placement before restoring focus and native undo.
    if (getComputedStyle(field).visibility !== 'visible' || field.getClientRects().length === 0) {
      frame = requestAnimationFrame(apply);
      return;
    }
    restoring = true;
    field.focus();
    field.select();
    // A native insertion gives the recovered draft a native Undo back to its confirmed value.
    field.ownerDocument.execCommand('insertText', false, draft.value);
    if (field.value !== draft.value) field.value = draft.value;
    if (draft.range) field.setSelectionRange(draft.range.start, draft.range.end);
    restored();
    pending = false;
    restoring = false;
  };
  frame = requestAnimationFrame(apply);
  return () => cancelAnimationFrame(frame);
}

export function saveCanvasDraft(node: NodeId, runs: readonly InlineRun[], range: TextRange | null): void {
  if (restoring || !store || !mayWrite()) return;
  const original = locate(store.getState().document, node)?.node;
  if (!original) return;
  if (JSON.stringify(canonical(runs)) === JSON.stringify(canonical(original.inline ?? [original.text ?? '']))) {
    if (held?.kind === 'canvas') persist(null);
    return;
  }
  pending = false;
  persist({ ...context(), kind: 'canvas', node, runs: [...runs], range });
}
export function canvasDraft(node: NodeId): { runs: readonly InlineRun[]; range: TextRange | null } | null {
  if (held?.kind !== 'canvas' || held.node !== node || !mayWrite()) return null;
  pending = false;
  return held;
}

export function startDrafts(owner: EditorStore, currentRevision: () => number, canWrite: () => boolean): () => void {
  store = owner;
  revision = currentRevision;
  mayWrite = canWrite;
  held = null;
  pending = false;
  try {
    const parsed = schema.safeParse(JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null'));
    if (parsed.success && canWrite() && parsed.data.revision === revision() && JSON.stringify(parsed.data.selection) === JSON.stringify(owner.getState().selection)) held = parsed.data;
  } catch { /* Invalid or unavailable session storage never prevents opening confirmed work. */ }
  if (held !== null) {
    pending = true;
    const draft = held;
    const styleState = STATES.find(s => s.id === draft.context.styleState);
    if (styleState) owner.dispatch(setStyleState.command, { state: styleState.id as CommandArgs[typeof setStyleState.command]['state'] });
    if (draft.context.styleTarget && owner.getState().document.classes?.some(c => c.name === draft.context.styleTarget)) owner.dispatch(setStyleTarget.command, { target: 'class', className: draft.context.styleTarget });
    if (draft.context.quick) owner.dispatch(setOpen.command, { open: 'open' });
    if (draft.kind === 'field' && draft.context.revealed) {
      const property = manifest.properties.properties.find(p => p.id === draft.context.revealed);
      const attribute = manifest.elements.attributes.find(a => a.id === draft.context.revealed);
      if (property) owner.dispatch(revealField.command, { property: property.id as NonNullable<CommandArgs[typeof revealField.command]['property']> });
      else if (attribute) owner.dispatch(revealField.command, { attribute: attribute.id as NonNullable<CommandArgs[typeof revealField.command]['attribute']> });
    }
    if (draft.kind === 'canvas') {
      const result = owner.dispatch(startEdit.command, {});
      if (result.status === 'refused' || owner.getState().ui.textEdit.node !== draft.node) {
        pending = false;
        persist(null);
      }
    }
  } else persist(null);
  let last = owner.getState();
  const stop = owner.subscribe(() => {
    const next = owner.getState();
    if (held && (next.document !== last.document || next.selection !== last.selection || (held.kind === 'canvas' && next.ui.textEdit.node !== held.node) || (held.context.quick && next.ui.quickPanelOpen !== true))) {
      pending = false;
      persist(null);
    }
    last = next;
  });
  document.addEventListener('selectionchange', flushDraftCaret);
  return () => {
    stop();
    document.removeEventListener('selectionchange', flushDraftCaret);
    store = null;
  };
}

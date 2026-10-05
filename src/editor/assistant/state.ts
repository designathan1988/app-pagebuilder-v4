import { z } from 'zod';
import { message, registerHandler, type RegisteredHandler } from '../../core/commands/registry.ts';
import type { EditorUi } from '../state.ts';
import type { PickedFile } from '../../generated/commands.ts';
import { imageBlock } from './provider.ts';

export const DEFAULT_ASSISTANT_MODEL = 'claude-opus-5-5';
const entrySchema = z.object({ id: z.string(), role: z.enum(['user', 'assistant', 'tool']), text: z.string(), error: z.boolean().optional(), image: z.string().optional() });
export interface AssistantState {
  readonly draft: string;
  readonly preferences: boolean;
  readonly busy: boolean;
  readonly hasKey: boolean;
  readonly connection: 'connecting' | 'connected' | 'disconnected';
  readonly session: string;
  readonly entries: readonly z.infer<typeof entrySchema>[];
  readonly reference: PickedFile | null;
  readonly request: { readonly serial: number; readonly kind: string } | null;
  readonly serial: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}
const INITIAL_ASSISTANT: AssistantState = { draft: '', preferences: false, busy: false, hasKey: false, connection: 'disconnected', session: '', entries: [], reference: null, request: null, serial: 0, inputTokens: 0, outputTokens: 0 };
export const assistantOf = (ui: EditorUi): AssistantState => ui.assistant ?? INITIAL_ASSISTANT;
const nextUi = (ui: EditorUi, patch: Partial<AssistantState>): EditorUi => ({ ...ui, assistant: { ...assistantOf(ui), ...patch } });
export const setAssistantPreferences = registerHandler<'assistant.setPreferences', EditorUi>('assistant.setPreferences', ({ state }, { open }) => ({ kind: 'change', ui: nextUi(state.ui, { preferences: open }) }));
export const setAssistantModel = registerHandler<'assistant.setModel', EditorUi>('assistant.setModel', ({ state }, { value }) => {
  if (assistantOf(state.ui).busy) return { kind: 'refused', message: message('assistant.busy') };
  const model = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model)) return { kind: 'refused', message: message('assistant.invalidModel') };
  return { kind: 'change', ui: { ...nextUi(state.ui, { entries: [] }), preferences: { ...state.ui.preferences, assistantModel: model } }, message: message('assistant.modelChanged') };
});
export const attachAssistantReference = registerHandler<'assistant.attachReference', EditorUi>('assistant.attachReference', ({ state }, { file }) => {
  try {
    // the door reads the chosen file as an upload record (doors/door.tsx fileReading "upload": a list of one); a JSON
    // text of one record is taken too (the MCP tools hand text)
    const given: unknown = typeof file === 'string' ? JSON.parse(file) : file;
    const record: unknown = Array.isArray(given) ? given[0] : given;
    const picked = z.object({ name: z.string(), type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), bytes: z.string() }).parse(record);
    imageBlock(Uint8Array.from(atob(picked.bytes), char => char.charCodeAt(0)), picked.type);
    return { kind: 'change', ui: nextUi(state.ui, { reference: { name: picked.name, type: picked.type, bytes: picked.bytes } }), message: message('assistant.referenceAdded') };
  } catch { return { kind: 'refused', message: message('assistant.invalidImage') }; }
});
export const clearAssistantReference = registerHandler<'assistant.clearReference', EditorUi>('assistant.clearReference', ({ state }) => ({ kind: 'change', ui: nextUi(state.ui, { reference: null }) }));
// Secret drafts belong to the password control and credential vault, never the state or command history.
export const editAssistantKey = registerHandler('assistant.editKey', () => ({ kind: 'change' }));

function request(ui: EditorUi, kind: string): EditorUi {
  const current = assistantOf(ui), serial = current.serial + 1;
  return nextUi(ui, { serial, request: { serial, kind } });
}
export const sendAssistant = registerHandler<'assistant.send', EditorUi>('assistant.send', ({ state }) => {
  const current = assistantOf(state.ui);
  if (current.busy) return { kind: 'refused', message: message('assistant.busy') };
  if (!current.hasKey) return { kind: 'refused', message: message('assistant.keyRequired') };
  if (current.connection !== 'connected') return { kind: 'refused', message: message('assistant.connectionRequired') };
  if (!current.draft.trim() && current.reference === null) return { kind: 'refused', message: message('assistant.emptyInput') };
  return { kind: 'change', ui: request(nextUi(state.ui, { busy: true }), 'send'), message: message('assistant.started') };
});
export const cancelAssistant = registerHandler<'assistant.cancel', EditorUi>('assistant.cancel', ({ state }) => ({ kind: 'change', ui: request(state.ui, 'cancel') }));
export const connectAssistant = registerHandler<'assistant.connect', EditorUi>('assistant.connect', ({ state }) => ({ kind: 'change', ui: request(state.ui, 'connect') }));
export const disconnectAssistant = registerHandler<'assistant.disconnect', EditorUi>('assistant.disconnect', ({ state }) => ({ kind: 'change', ui: request(state.ui, 'disconnect') }));
export const saveAssistantKey = registerHandler<'assistant.saveKey', EditorUi>('assistant.saveKey', ({ state }) => ({ kind: 'change', ui: request(state.ui, 'save-key') }));
export const deleteAssistantKey = registerHandler<'assistant.deleteKey', EditorUi>('assistant.deleteKey', ({ state }) => ({ kind: 'change', ui: request(state.ui, 'delete-key') }));
export const selectAssistantSession = registerHandler<'assistant.selectSession', EditorUi>('assistant.selectSession', ({ state }) => ({ kind: 'change', ui: request(state.ui, 'select-session') }));
export const clearAssistantConversation = registerHandler<'assistant.clearConversation', EditorUi>('assistant.clearConversation', ({ state }) => {
  if (assistantOf(state.ui).busy) return { kind: 'refused', message: message('assistant.busy') };
  return { kind: 'change', ui: request(nextUi(state.ui, { entries: [], draft: '', reference: null }), 'clear-conversation') };
});
const reportSchema = z.strictObject({ busy: z.boolean().optional(), hasKey: z.boolean().optional(), connection: z.enum(['connecting', 'connected', 'disconnected']).optional(), session: z.string().optional(), entries: z.array(entrySchema).optional(), draft: z.string().optional(), inputTokens: z.number().nonnegative().optional(), outputTokens: z.number().nonnegative().optional() });
export const reportAssistant: RegisteredHandler<'assistant.update', EditorUi> = registerHandler('assistant.update', ({ state }, { value }) => {
  const parsed = reportSchema.safeParse(typeof value === 'string' ? { draft: value } : value);
  if (!parsed.success) return { kind: 'refused', message: message('assistant.failed') };
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)) as Partial<AssistantState>;
  return { kind: 'change', ui: nextUi(state.ui, patch) };
});

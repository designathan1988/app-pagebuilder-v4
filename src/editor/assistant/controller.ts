import { isBuilt, message } from '../../core/commands/registry.ts';
import { credentialNonce, randomIds } from '../../core/ports/ids.ts';
import type { CommandArgs, JsonValue } from '../../generated/commands.ts';
import type { CommandId, MessageId } from '../../generated/ids.ts';
import { describeText } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import { captureCanvasPng } from '../canvas/screenshot.ts';
import type { EditorStore } from '../store.ts';
import { toolCatalogue } from './catalogue.ts';
import { connectEditor } from './client.ts';
import { openCredentialVault, type CredentialVault } from './credentials.ts';
import { editorTools, readTools } from './editor.ts';
import { companionFetch } from './proxy-client.ts';
import { createAssistantSession } from './session.ts';
import { assistantOf, DEFAULT_ASSISTANT_MODEL, reportAssistant, type AssistantState } from './state.ts';
import { wiring } from '../wiring.ts';

interface Pairing { url: string; token: string }
export interface AssistantController {
  stageKey(value: string): void;
  stageConnection(text: string): void;
  dispose(): void;
}
const controllers = new WeakMap<EditorStore, AssistantController>();
export const assistantController = (store: EditorStore): AssistantController | undefined => controllers.get(store);
// The assistant lives as long as the editor, not as long as its panel: a turn goes on while another view takes the
// sidebar (its own layout_enter opens the Layout panel there, which unmounted the panel and cancelled the turn: plan
// G5, AV1). The panel installs it when first shown; the shell uninstalls it with the editor (shell.tsx).
const uninstallers = new WeakMap<EditorStore, () => void>();
export function uninstallAssistant(store: EditorStore): void {
  uninstallers.get(store)?.();
  uninstallers.delete(store);
}

export function installAssistant(store: EditorStore): () => void {
  if (controllers.has(store)) return () => { };
  let alive = true, secret = '', pairing: Pairing | null = null, disconnect: (() => void) | null = null;
  let vault: CredentialVault | null = null;
  let session: ReturnType<typeof createAssistantSession> | null = null;
  let lastRequest = 0, revision = 0;
  const report = (value: Partial<AssistantState>) => {
    if (alive) store.dispatch(reportAssistant.command, { value: value as unknown as JsonValue });
  };
  const notice = (key: MessageId) => {
    if (alive) store.notice(message(key));
  };
  const httpBase = () => {
    if (!pairing) throw new Error('assistant.connectionRequired');
    const address = new URL(pairing.url);
    address.protocol = 'http:';
    address.pathname = '/';
    return address.href;
  };
  const commands = manifest.commands.filter(command => isBuilt(wiring().commands[command.id as CommandId]));
  const words = (key: string) => describeText(store.getState().ui.preferences.locale, key as MessageId);
  const tools = editorTools(commands, {
    read: () => ({ document: store.getState().document, selection: store.getState().selection, revision }),
    screenshot: () => captureCanvasPng(store.getState().document),
    dispatch: (id, args) => store.dispatch(id as CommandId, args as CommandArgs[CommandId]),
    beginGroup: () => {
      const group = store.commandGroup(message('assistant.busy'));
      return { dispatch: (id, args) => group.dispatch(id as CommandId, args as CommandArgs[CommandId]), commit: group.commit, cancel: group.cancel };
    },
    // Assistant settings and secret actions are controlled only by the person using their doors.
    authorize: async command => !command.id.startsWith('assistant.'),
  });
  const append = (role: 'user' | 'assistant' | 'tool', text: string, error = false, image?: string) => {
    const entry = { id: randomIds.next(), role, text, ...(error ? { error } : {}), ...(image ? { image } : {}) };
    report({ entries: [...assistantOf(store.getState().ui).entries, entry] });
    return entry.id;
  };
  let replyId: string | null = null;
  let failure: MessageId | null = null;
  const ready = openCredentialVault(indexedDB, crypto, credentialNonce).then(value => {
    if (!alive) {
      value.close();
      return;
    }
    vault = value;
    return value.read().then(key => report({ hasKey: key !== null }));
  }).catch(() => notice('assistant.storageFailed'));
  const buildSession = () => {
    if (!vault) throw new Error('assistant.storageFailed');
    session = createAssistantSession({
      tools: [...toolCatalogue(commands, words), ...readTools], begin: tools.begin, reserve: tools.reserve, vault,
      settings: () => ({ model: store.getState().ui.preferences.assistantModel ?? DEFAULT_ASSISTANT_MODEL, maxTokens: 8192 }),
      fetch: (input, init) => {
        if (!pairing) throw new Error('assistant.connectionRequired');
        return companionFetch(httpBase(), pairing.token)(input, init);
      },
      onText: text => {
        const current = assistantOf(store.getState().ui);
        if (replyId === null) replyId = append('assistant', text);
        else report({ entries: current.entries.map(entry => entry.id === replyId ? { ...entry, text: entry.text + text } : entry) });
      },
      onTool: (name, result) => {
        const command = commands.find(command => command.id.replaceAll('.', '_') === name);
        const label = command ? words(command.labelKey) : name;
        const resultText = result.content.filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('\n');
        append('tool', `${label}\n${resultText}`, result.isError === true);
        if (result.isError === true) notice('assistant.refused');
        replyId = null;
      },
      onState: state => {
        report({ busy: state.busy });
        if (state.error) {
          failure = state.error;
          notice(state.error);
        }
      },
    });
    return session;
  };
  let model = store.getState().ui.preferences.assistantModel ?? DEFAULT_ASSISTANT_MODEL;
  async function execute(kind: string): Promise<void> {
    if (kind === 'cancel') {
      session?.cancel();
      return;
    }
    if (kind === 'disconnect') {
      session?.cancel();
      disconnect?.();
      disconnect = null;
      pairing = null;
      return;
    }
    await ready;
    if (!alive) return;
    if (kind === 'save-key') {
      const value = secret;
      secret = '';
      if (!vault || !value.trim()) {
        notice('assistant.keyRequired');
        return;
      }
      await vault.save(value);
      report({ hasKey: true });
      notice('assistant.keySaved');
      return;
    }
    if (kind === 'delete-key') {
      session?.cancel();
      await vault?.clear();
      report({ hasKey: false });
      notice('assistant.keyRemoved');
      return;
    }
    if (kind === 'clear-conversation') {
      session?.clear();
      return;
    }
    if (kind === 'connect') {
      if (!pairing) throw new Error('assistant.invalidConnection');
      disconnect?.();
      let close: (() => void) | null = null;
      close = connectEditor(pairing.url, pairing.token, {
        execute: tools.execute,
        onState: (connection, id) => {
          // a drop the person did not ask for: Disconnect clears `disconnect` before the socket closes
          const lost = connection === 'disconnected' && assistantOf(store.getState().ui).connection === 'connected' && disconnect === close;
          report({ connection, session: id ?? '' });
          if (connection === 'connected') notice('assistant.connected');
          if (lost) notice('assistant.disconnected');
        },
        onError: () => notice('assistant.connectionFailed'),
      });
      disconnect = close;
      return;
    }
    if (kind === 'select-session') {
      if (!pairing) throw new Error('assistant.connectionRequired');
      const response = await fetch(new URL('/session/select', httpBase()), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pairing.token}` }, body: JSON.stringify({ session: assistantOf(store.getState().ui).session }), redirect: 'error' });
      if (!response.ok) throw new Error('assistant.connectionFailed');
      notice('assistant.sessionSelected');
      return;
    }
    if (kind === 'send') {
      const current = assistantOf(store.getState().ui);
      const reference = current.reference;
      append('user', current.draft, false, reference ? `data:${reference.type};base64,${reference.bytes}` : undefined);
      report({ draft: '' });
      replyId = null;
      failure = null;
      const active = session ?? buildSession();
      const result = await active.send(current.draft, reference ? { bytes: Uint8Array.from(atob(reference.bytes), char => char.charCodeAt(0)), mime: reference.type as 'image/png' } : undefined);
      report({ inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      notice('assistant.finished');
    }
  }
  const controller: AssistantController = {
    stageKey: value => { secret = value; },
    stageConnection: text => {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object') throw new Error('assistant.invalidConnection');
      const candidate = value as Record<string, unknown>;
      if (candidate.version !== 1 || typeof candidate.url !== 'string' || typeof candidate.token !== 'string' || !/^ws:\/\/127\.0\.0\.1:\d+\/editor$/.test(candidate.url) || !/^[A-Za-z0-9_-]{32,128}$/.test(candidate.token)) throw new Error('assistant.invalidConnection');
      pairing = { url: candidate.url, token: candidate.token };
    },
    dispose: () => {
      alive = false;
      secret = '';
      pairing = null;
      session?.dispose();
      if (!session) vault?.close();
      disconnect?.();
      controllers.delete(store);
    },
  };
  controllers.set(store, controller);
  const unwatchDocument = store.subscribeDocument(() => {
    revision++;
  });
  const unwatch = store.subscribe(() => {
    const ui = store.getState().ui, current = assistantOf(ui);
    const nextModel = ui.preferences.assistantModel ?? DEFAULT_ASSISTANT_MODEL;
    if (nextModel !== model && !current.busy) {
      model = nextModel;
      session?.clear();
    }
    if (current.request === null || current.request.serial === lastRequest) return;
    lastRequest = current.request.serial;
    void execute(current.request.kind).catch(error => {
      console.warn('Assistant turn failed:', error instanceof Error ? error.message : String(error));
      report({ busy: false });
      const key = error instanceof Error && ['assistant.invalidConnection', 'assistant.connectionRequired', 'assistant.connectionFailed', 'assistant.storageFailed', 'assistant.modelUnavailable'].includes(error.message) ? error.message as MessageId : 'assistant.failed';
      notice(failure ?? key);
    });
  });
  const uninstall = () => {
    unwatch();
    unwatchDocument();
    controller.dispose();
  };
  uninstallers.set(store, uninstall);
  return uninstall;
}

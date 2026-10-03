import { useEffect, useRef, type ReactNode } from 'react';
import { message, isFeatureBuilt } from '../../core/commands/registry.ts';
import type { CommandId, FeatureId, MessageId } from '../../generated/ids.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import { doorSlots } from '../doors/placement.ts';
import { DoorControl, useDoor } from '../doors/door.tsx';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { assistantController, installAssistant } from './controller.ts';
import { assistantOf, DEFAULT_ASSISTANT_MODEL } from './state.ts';
import { AssistantPreferences, ChatSurface } from './surface.tsx';
import './surface.css';

const controls = doorSlots('assistant-panel');
const entryOf = (name: string): DoorEntry => {
  const entry = controls.find(entry => entry.door.kind === 'panel-control' && entry.door.control === name);
  if (!entry) throw new Error(`Missing assistant control ${name}`);
  return entry;
};
function AssistantField({ entry, value, multiline = false, live = false }: { readonly entry: DoorEntry; readonly value: string; readonly multiline?: boolean; readonly live?: boolean }) {
  const store = useStore(), t = useT();
  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const label = t(entry.door.labelKey as MessageId);
  const busy = useEditorState(state => assistantOf(state.ui).busy);
  const door = useDoor(entry, {}, label, isFeatureBuilt(entry.door.feature as FeatureId));
  useEffect(() => {
    if (field.current && field.current.value !== value) field.current.value = value;
  }, [value]);
  const keep = () => {
    if (!field.current || busy) return;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { value: field.current.value });
  };
  const props = { className: 'input', 'aria-label': label, disabled: busy || !door.available, defaultValue: value, onBlur: keep, onInput: live ? keep : undefined, 'data-key-context': multiline ? 'assistant-input' : 'command-field' };
  return <form className="assistant-field" data-door={entry.ref} onSubmit={event => {
    event.preventDefault();
    keep();
  }}>
    <label>{label}</label>
    {multiline ? <textarea {...props} ref={field as React.RefObject<HTMLTextAreaElement>} rows={4} /> : <input {...props} ref={field as React.RefObject<HTMLInputElement>} />}
  </form>;
}

export function AssistantPanel(): ReactNode {
  const store = useStore(), t = useT();
  const state = useEditorState(state => assistantOf(state.ui));
  const model = useEditorState(state => state.ui.preferences.assistantModel ?? DEFAULT_ASSISTANT_MODEL);
  const key = useRef<HTMLInputElement>(null), connection = useRef<HTMLInputElement>(null);
  // installed once for the editor, never uninstalled with the panel (controller.ts: the shell does it with the editor)
  useEffect(() => {
    installAssistant(store);
  }, [store]);
  const invoke = (entry: DoorEntry, args: unknown = {}) => (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, args);
  const door = (name: string, props: Readonly<Record<string, unknown>>): ReactNode => {
    if (name === 'assistant-provider') return <p>{t('assistant.providerAnthropic')}</p>;
    const entry = entryOf(name);
    if (name === 'assistant-input') return <AssistantField entry={entry} value={state.draft} multiline live />;
    if (name === 'assistant-model') return <AssistantField entry={entry} value={model} />;
    if (name === 'assistant-key') return <label className="assistant-field" data-door={entry.ref}>{t('assistant.key')}<input ref={key} className="input" type="password" autoComplete="off" aria-label={t('assistant.key')} disabled={state.busy} /></label>;
    if (name === 'assistant-save-key') return <button type="button" className="door door--button" data-door={entry.ref} disabled={state.busy} onClick={() => {
      assistantController(store)?.stageKey(key.current?.value ?? '');
      if (key.current) key.current.value = '';
      invoke(entry);
    }}>{t(entry.door.labelKey as MessageId)}</button>;
    if (name === 'assistant-bridge-connect') return <button type="button" className="door door--button" data-door={entry.ref} disabled={state.busy} onClick={() => connection.current?.click()}>{t(entry.door.labelKey as MessageId)}</button>;
    return <DoorControl entry={entry} ready={props.disabled !== true} />;
  };
  return <div className="view assistant-panel" data-region="assistant-panel">
    <input ref={connection} className="visually-hidden" type="file" accept="application/json,.json" tabIndex={-1} aria-hidden onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      void file.text().then(text => {
        assistantController(store)?.stageConnection(text);
        invoke(entryOf('assistant-bridge-connect'));
      }).catch(() => store.notice(message('assistant.invalidConnection')));
    }} />
    {state.preferences ? <>
      <AssistantPreferences model={model} hasKey={state.hasKey} keyDraft="" connected={state.connection === 'connected'} door={door} t={key => t(key as MessageId)} />
      <p className="assistant-help">{t('assistant.setupHelp')}</p>
      <code>{t('assistant.setupCommand')}</code>
      <DoorControl entry={entryOf('assistant-close-preferences')} />
    </> : <ChatSurface entries={state.entries} draft={state.draft} busy={state.busy} configured={state.hasKey && state.connection === 'connected'} model={model} door={door} t={key => t(key as MessageId)} />}
    <div className="assistant-connection" role="group" aria-label={t('assistant.status')}>
      <span className="assistant-connection__state">{t(`assistant.connection.${state.connection}` as MessageId)}</span>
      {state.connection === 'connected' && <DoorControl entry={entryOf('assistant-select-session')} ready={!state.busy} />}
    </div>
    {state.reference && <div className="assistant-reference"><img src={`data:${state.reference.type};base64,${state.reference.bytes}`} alt={t('assistant.referenceImage')} /><DoorControl entry={entryOf('assistant-clear-reference')} ready={!state.busy} /></div>}
    <DoorControl entry={entryOf('assistant-clear-conversation')} ready={!state.busy} />
    <p className="assistant-help">{t('assistant.usage', { input: state.inputTokens, output: state.outputTokens })}</p>
  </div>;
}

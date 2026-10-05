import type { ReactNode } from 'react';
interface ChatEntry { id: string; role: 'user' | 'assistant' | 'tool'; text: string; error?: boolean | undefined; image?: string | undefined }
export interface ChatSurfaceProps { entries: readonly ChatEntry[]; draft: string; busy: boolean; configured: boolean; model: string; door: (control: string, props: Readonly<Record<string, unknown>>) => ReactNode; t: (key: string) => string }
// Controlled by existing editor UI state. Render messages as text; document/model output is never injected HTML.
export function ChatSurface({ entries, draft, busy, configured, model, door, t }: ChatSurfaceProps) {
  return <section className="assistant-chat" aria-label={t('assistant.title')}>
    <header>{door('assistant-model', { value: model, disabled: busy })}{door('assistant-preferences', {})}</header>
    {!configured && <p className="assistant-note">{t('assistant.configure')}</p>}
    <div className="assistant-chat__messages" role="log" aria-live="polite" aria-relevant="additions text">
      {entries.map(entry => <article key={entry.id} className={`assistant-chat__message assistant-chat__message--${entry.role}`}>
        <span>{t(`assistant.role.${entry.role}`)}</span><p role={entry.error ? 'alert' : undefined}>{entry.text}</p>
        {entry.image && <img src={entry.image} alt={t('assistant.referenceImage')} />}
      </article>)}
    </div>
    <footer>{door('assistant-input', { value: draft, disabled: busy })}{door('assistant-reference', { disabled: busy })}{busy ? door('assistant-cancel', {}) : door('assistant-send', { disabled: !configured || !draft.trim() })}</footer>
  </section>;
}
export function AssistantPreferences({ model, hasKey, keyDraft, connected, door, t }: Pick<ChatSurfaceProps, 'model' | 'door' | 't'> & { hasKey: boolean; keyDraft: string; connected: boolean }) {
  return <section className="assistant-preferences" aria-label={t('assistant.preferences')}>
    {door('assistant-provider', {})}{door('assistant-model', { value: model })}
    {door('assistant-key', { type: 'password', autoComplete: 'off', value: keyDraft })}
    <p className="assistant-note">{t(hasKey ? 'assistant.keySaved' : 'assistant.keyRequired')}</p>
    {door('assistant-save-key', {})}{door('assistant-delete-key', { disabled: !hasKey })}
    {door('assistant-bridge-connect', {})}{door('assistant-bridge-disconnect', { disabled: !connected })}
  </section>;
}

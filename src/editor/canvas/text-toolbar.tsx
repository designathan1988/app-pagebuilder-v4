// The text toolbar (PRODUCT.md §5, text-toolbar, and "Canvas", text): while a text is
// edited in place, the doors the manifest places in the text-toolbar region, in their order (Bold, Italic, Link), float
// with the edit's label above the element; the canvas chrome places them (chrome.tsx). Each is titled with its key in
// the text editing key context. A press on them leaves the focus, and so the text selection, in the edited text
// (pointer.ts), so they act on what is selected there.
//
// The link prompt: while text.editLink asks for an address (text-edit.ts), a small panel under the toolbar holds the
// address field, filled with the address of the link the selection is in and selected, so what is typed replaces it.
// Typing there is not a command (PRODUCT.md §5.3: data-local); Enter answers text.editLink with the address typed. An
// address the command refuses shows its refusal under the field, as the status bar does, and the prompt stays open;
// the backdrop door under it (ui.dismiss) closes it. It is drawn over the whole window, never on the canvas overlay.
import { useId, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, KeyContextId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { DoorControl } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useEditorState, useStore } from '../store.ts';
import { Popover } from '../shell/popover.tsx';
import { useT } from '../text.ts';
import { TEXT_EDITING, TEXT_TOOLBAR, editedLinkAddress, openLinkPrompt } from './text-edit.ts';

const DOORS = doorSlots(TEXT_TOOLBAR);
const DISMISS = doorSlots('overlay')[0];
// the door of the toolbar whose command takes the address the prompt asks for (its argument href)
const LINK = DOORS.find((entry) => 'href' in entry.command.args) ?? null;
const KEYS: KeyContextId = TEXT_EDITING;

// `bar` is the toolbar's element, which the chrome measures to place it and the link prompt is drawn under.
export function TextToolbar({ bar, className, style }: { readonly bar: RefObject<HTMLDivElement | null>; readonly className: string; readonly style: CSSProperties | undefined }) {
  const t = useT();
  const opened = useEditorState((s) => openLinkPrompt(s.ui));
  return (
    <div ref={bar} className={['text-toolbar', className].filter((c) => c !== '').join(' ')} data-region={TEXT_TOOLBAR} data-chrome="text-toolbar" role="toolbar" aria-label={t('textToolbar.label')} style={style}>
      {DOORS.map((entry) => (
        <DoorControl key={entry.ref} entry={entry} keysIn={KEYS} />
      ))}
      {opened !== null && LINK !== null ? <LinkPrompt key={opened.count} entry={LINK} anchor={bar} /> : null}
    </div>
  );
}

function LinkPrompt({ entry, anchor }: { readonly entry: DoorEntry; readonly anchor: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const store = useStore();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  // what is typed in the field before Enter answers the prompt: the field's own text, not the editor's state
  const [address, setAddress] = useState(() => editedLinkAddress() ?? '');
  // the refusal of the address typed last: the store's message while it is one the command declares
  const refusal = useEditorState((s) => (s.message !== null && (entry.command.refusals as readonly string[]).includes(s.message.key) ? s.message : null));
  const answer = (event: FormEvent) => {
    event.preventDefault();
    (store.dispatch as (command: CommandId, args: unknown) => DispatchResult)(entry.command.id, { ...entry.door.args, href: address });
  };
  // a popover under the toolbar (popover.tsx): inside the window, over its backdrop; the field takes the focus once it
  // is placed, before the next key arrives, with what it holds selected
  return (
    <Popover onDismiss={() => { if (DISMISS) (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(DISMISS.command.id, DISMISS.door.args); }} anchor={anchor} as="form" className="link-prompt__panel" label={t('textEdit.linkPrompt.label')} onSubmit={answer}>
        <label className="link-prompt__label" htmlFor={`${id}-address`}>
          {t('textEdit.linkPrompt.label')}
        </label>
        <input
          ref={field}
          id={`${id}-address`}
          className="link-prompt__field"
          // Escape closes the prompt (ui.dismiss, the dismissal it listens to) and keeps nothing (the audit's U-009)
          data-key-context="dialog"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={address}
          placeholder={t('textEdit.linkPrompt.placeholder')}
          aria-invalid={refusal !== null}
          aria-describedby={`${id}-hint`}
          data-local="link-address"
          onChange={(event) => setAddress(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          data-autofocus
        />
        <p id={`${id}-hint`} className={`link-prompt__hint${refusal !== null ? ' is-refused' : ''}`}>
          {refusal !== null ? t(refusal.key, refusal.params) : t('textEdit.linkPrompt.hint')}
        </p>
    </Popover>
  );
}

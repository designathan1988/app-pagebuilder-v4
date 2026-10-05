// The component name prompt's view (the user's real-use audit, item A3.12): a small panel over a shield, its field
// filled with the element's own name and selected, Enter (or the form's submission) handing components.create the
// name the person typed, the close button and a click on the shield closing it. Typing is not a command: the form
// dispatches the create itself, as the link prompt's field does, and the prompt's field is the door
// components.create#prompt-name, whose control this form is.
import { useEffect, useRef } from 'react';
import { locate } from '../../core/document/model.ts';
import type { MessageId } from '../../generated/ids.ts';
import { DoorControl } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useEditorState, useStore } from '../store.ts';
import { useOutsideLayer } from './outside-layer.ts';
import { useT } from '../text.ts';

const PARTS = doorSlots('component-prompt');
const NAME = PARTS.find((p) => p.door.kind === 'panel-control' && p.door.control === 'name') ?? null;
const CLOSE = PARTS.find((p) => p.door.kind === 'panel-control' && p.door.control === 'close') ?? null;
// the form the create button submits, by id (a submit button may stand outside the form it submits)
const FORM_ID = 'component-prompt-name';

export function ComponentPrompt() {
  const t = useT();
  const store = useStore();
  const open = useEditorState((s) => s.ui.componentPrompt);
  const document = useEditorState((s) => s.document);
  const field = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => {
    if (CLOSE) (store.dispatch as (id: string, args: unknown) => unknown)(CLOSE.command.id, {});
  };
  useOutsideLayer(panel, open !== null, close);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [open]);
  if (open === null) return null;
  const node = locate(document, open.node);
  if (node === null) return null;
  return (
    <div className="picker-shield">
      <div ref={panel} className="picker picker--component" role="dialog" aria-label={t('components.prompt.title')} data-region="component-prompt" onClick={(event) => event.stopPropagation()}>
        {/* its title names its field, and its close stands at its head, as every picker's (LR2: a side label in two
            lines beside a 95 px field that cut the name, under a title saying the same, the close at the foot) */}
        <div className="picker__head">
          <label className="picker__header" htmlFor={`${FORM_ID}-name`}>
            {t('components.prompt.title')}
          </label>
          {CLOSE === null ? null : <DoorControl entry={CLOSE} />}
        </div>
        {NAME === null ? null : (
          <form
            id={FORM_ID}
            className="picker__form"
            data-door={NAME.ref}
            data-args="{}"
            onSubmit={(event) => {
              event.preventDefault();
              const value = field.current?.value ?? '';
              close();
              (store.dispatch as (id: string, args: unknown) => unknown)(NAME.command.id, { name: value });
            }}
          >
            <input ref={field} id={`${FORM_ID}-name`} className="input" defaultValue={node.node.name} spellCheck={false} data-key-context="component-prompt" />
          </form>
        )}
        <div className="picker__actions">
          {/* the button a person presses: it submits the field's form, so it creates with the typed name — the same
              command the form dispatches, named by the manifest (a door a click could run carries no name of its own) */}
          {NAME === null ? null : (
            <button type="submit" form={FORM_ID} className="door door--button">
              {t(NAME.command.labelKey as MessageId)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

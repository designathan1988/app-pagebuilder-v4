// A panel's text field (the timeline's settings and name fields, an interaction's card fields): the control of a
// panel-control door drawn as a field. The door's data (its label, the values it offers, the arguments it fixes) comes
// from the manifest; the text it holds is the one argument of its command that neither the door nor the drawing gives
// (textArgument: the command's manifest contract). The field is a form of one input, so Enter submits it and runs the
// door with what it holds; what the document holds is shown again as soon as the field is left. The values the door
// offers are drawn as a datalist, so the person may pick one or type their own.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommandId } from '../../generated/ids.ts';
import { GENERATED_VALUES } from '../../generated/value-lists.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import { useStore } from '../store.ts';
import { isDoorBuilt, useDoor } from '../doors/door.tsx';
import { EasingCurveButton } from './easing-curve.tsx';

// The one argument a door's text goes in: the argument its command declares that neither the door fixes (its own
// `args`) nor the drawing gives. A command whose fields do not come to exactly one is a defect of the manifest.
export function textArgument(entry: DoorEntry, given: Readonly<Record<string, unknown>>): string | null {
  const free = Object.keys(entry.command.args).filter((name) => !(name in entry.door.args) && !(name in given));
  return free.length === 1 ? (free[0] as string) : null;
}

// The values a door's field offers, from the manifest: the generated list of the property its adapter offers (a
// timeline setting: the keywords of animation-duration and its siblings); a list the door does not offer has none (the
// drawing site passes the enum its own command declares).
export function offeredValues(entry: DoorEntry): readonly string[] {
  const offered = entry.door.adapter?.offers;
  if (offered === null || offered === undefined) return [];
  const list = GENERATED_VALUES[offered.property as never] as { readonly keywords: readonly string[] } | undefined;
  return list?.keywords ?? [];
}

export function PanelField({
  entry,
  args = {},
  value,
  offered,
  label,
  disabled = false,
  autoFocus = false,
  placeholder,
  display,
  accept,
  onDone,
  curve = false,
}: {
  readonly entry: DoorEntry;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly value: string;
  readonly offered?: readonly string[] | undefined;
  readonly label: string;
  readonly disabled?: boolean;
  // a field a control just opened takes the focus (New animation's name field)
  readonly autoFocus?: boolean;
  // what an empty value means, said inside the field (an interaction's scope: this element)
  readonly placeholder?: string;
  // a value shown in words (an interaction's trigger: "Click" for click), and the value a typed text stands for (the
  // value itself, or its words, in any case); the offered values are listed in their words
  readonly display?: (value: string) => string;
  readonly accept?: (typed: string) => string;
  readonly onDone?: () => void;
  // the field holds an easing: a button beside it draws the easing's curve and chooses another (easing-curve.tsx)
  readonly curve?: boolean;
}) {
  const door = useDoor(entry, args, label);
  const store = useStore();
  const [draft, setDraft] = useState(value);
  const [edited, setEdited] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const list = offered ?? [];
  const id = `panel-field-${entry.ref.replaceAll('#', '-')}-${String(args.animation ?? args.interaction ?? '')}`;
  // the door run with a text in its free argument (typed and kept, or a curve chosen beside the field)
  const runWith = (chosen: string) => {
    const argument = textArgument(entry, args);
    if (argument === null || chosen === value) return;
    const outcome = (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, ...args, [argument]: chosen });
    if (outcome.status === 'done') onDone?.();
  };
  const keep = (event: FormEvent) => {
    event.preventDefault();
    // nothing typed since the field last showed the document's value: nothing to keep (the draft is that old value)
    if (!edited) return;
    setEdited(false);
    runWith(accept === undefined ? draft : accept(draft));
  };
  const ready = door.built && !disabled;
  return (
    <div className={`field-row panel-field${ready ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify({ ...entry.door.args, ...args })} title={door.title}>
      <label className="field-row__label" htmlFor={`${id}-input`}>
        {label}
      </label>
      <form className="panel-field__form" onSubmit={keep}>
        <input
          id={`${id}-input`}
          ref={input}
          className="panel-field__text"
          type="text"
          // a value (a class, an address, a duration), never prose: the browser's spelling marks are noise on it, as on
          // the inspector's fields
          spellCheck={false}
          // an empty value is nothing chosen yet: shown empty, never put into words (the placeholder says what it
          // means)
          value={edited ? draft : display === undefined || value === '' ? value : display(value)}
          // the value whole in the field's tooltip, for a value the field cannot hold (it ends in an ellipsis)
          title={value === '' ? undefined : display === undefined ? value : display(value)}
          placeholder={placeholder}
          disabled={!ready}
          list={list.length > 0 ? `${id}-list` : undefined}
          onChange={(event) => {
            setEdited(true);
            setDraft(event.target.value);
          }}
          // left without keeping it, the typing goes and the document's value shows again (the audit's FD2)
          onBlur={() => setEdited(false)}
        />
        {curve ? <EasingCurveButton value={value} label={label} disabled={!ready} run={runWith} /> : null}
        <button type="submit" className="visually-hidden" tabIndex={-1}>
          {label}
        </button>
      </form>
      {list.length > 0 ? (
        <datalist id={`${id}-list`}>
          {list.map((one) => (
            <option key={one} value={display === undefined ? one : display(one)} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

// A panel's small button (a play control, a keyframe's actions): the control of a panel-control door drawn as it says
// (an icon button or a text button), the arguments the drawing gives beside the door's own.
export function PanelButton({
  entry,
  args = {},
  icon,
  label,
  pressed = null,
  disabled = false,
  onDone,
  children,
}: {
  readonly entry: DoorEntry;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly icon?: React.ReactNode;
  readonly label?: string;
  readonly pressed?: boolean | null;
  readonly disabled?: boolean;
  readonly onDone?: () => void;
  readonly children?: React.ReactNode;
}) {
  const door = useDoor(entry, args, label);
  const store = useStore();
  const ready = door.available && !disabled;
  return (
    <button
      type="button"
      className={`door ${pressed === null ? 'door--button' : 'door--toggle'}${ready ? '' : ' is-unavailable'}${pressed === true ? ' is-current' : ''}`}
      data-door={entry.ref}
      data-args={JSON.stringify({ ...entry.door.args, ...args })}
      aria-disabled={ready ? undefined : true}
      aria-pressed={pressed === null ? undefined : pressed}
      title={door.title}
      disabled={!isDoorBuilt(entry)}
      onClick={() => {
        if (!ready) return;
        const outcome = (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, ...args });
        if (outcome.status === 'done') onDone?.();
      }}
    >
      {icon ?? null}
      <span className="door__label">{children ?? door.face}</span>
    </button>
  );
}

// The Data panel's controls (spec content-data): every button, field and menu of the panel is one door of the
// manifest's data regions (manifest/commands/content.json), found by its region and its control and drawn here. A
// field keeps what is typed on Enter or when it loses the focus, a menu on its choice, a form on its submit button —
// each one dispatch of the door's command with the arguments the door, its place and its value give. Nothing here
// listens to the pointer or the keys: presses and drags belong to the pointer owner (input/pointer.ts), keys to the
// keymap.
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId, RegionId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { useDoor } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useEditorState, useStore } from '../store.ts';

// The door a region draws for a control (the panel's controls are the manifest's, never a list written here).
export function doorOf(region: RegionId, control: string): DoorEntry {
  const found = doorSlots(region).find((entry) => entry.door.kind === 'panel-control' && entry.door.control === control);
  if (found === undefined) throw new Error(`the region ${region} draws no control ${control}`);
  return found;
}

// The one way the panel runs a door it draws as a field or a form: its command with the door's own arguments, the
// place's and the value's.
export function useRun(entry: DoorEntry): (args: Readonly<Record<string, unknown>>) => DispatchResult {
  const store = useStore();
  return (args) => (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { ...entry.door.args, ...args });
}

export interface Option {
  readonly value: string;
  readonly label: string;
}

// A field door: a text, a number or a menu, labelled by its door, standing for the arguments its place gives
// (data-args), and keeping its value in the argument `name` — on Enter or when it loses the focus for a text, on the
// choice for a menu. It shows what the document holds again after any change (an undo, a refusal).
export function DoorField({ entry, args, name, value, options, kind = 'text', label, className, transform }: {
  readonly entry: DoorEntry;
  readonly args: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly value: string;
  readonly options?: readonly Option[];
  readonly kind?: 'text' | 'number' | 'textarea';
  readonly label?: string;
  readonly className?: string;
  // the argument the typed or chosen text stands for (a query made of it); the text itself when absent
  readonly transform?: (typed: string) => unknown;
}): ReactNode {
  const door = useDoor(entry, args, label, isFeatureBuilt(entry.door.feature as FeatureId));
  const run = useRun(entry);
  const said = useEditorState((state) => state.message);
  const field = useRef<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(null);
  const menu = options !== undefined;
  useEffect(() => {
    // a menu holds no draft: after a choice the document refused it shows the document's value again even while it
    // keeps the focus (the audit's FD2); a text field being typed in keeps its typing
    if (field.current !== null && (menu || document.activeElement !== field.current)) field.current.value = value;
  }, [value, said, menu]);
  const keep = (typed: string) => {
    if (!door.available || typed === value) return;
    if (kind === 'number' && typed.trim() !== '' && !Number.isFinite(Number(typed))) return;
    run({ ...args, [name]: transform === undefined ? (kind === 'number' ? Number(typed) : typed) : transform(typed) });
  };
  const common = {
    name,
    'aria-label': door.label,
    title: door.title,
    disabled: !door.available,
    defaultValue: value,
    className: 'input',
  };
  const control =
    options !== undefined ? (
      <select {...common} ref={field} onChange={(event) => keep(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : kind === 'textarea' ? (
      <textarea {...common} ref={field} rows={3} onBlur={(event) => keep(event.currentTarget.value)} />
    ) : (
      <input {...common} ref={field} type={kind === 'number' ? 'number' : 'text'} spellCheck={false} autoComplete="off" onBlur={(event) => keep(event.currentTarget.value)} />
    );
  return (
    <form
      className={['data-field', className ?? ''].filter((c) => c !== '').join(' ')}
      data-door={entry.ref}
      data-args={JSON.stringify(args)}
      onSubmit={(event) => {
        event.preventDefault();
        if (field.current !== null) keep(field.current.value);
      }}
    >
      {control}
    </form>
  );
}

// A form door: the inputs a person fills (each named after an argument of its command) and the submit button, which is
// the door's control; the door's own arguments and the place's (data-args on the button) join what the inputs hold.
export function DoorForm({ entry, args, children, className, label }: {
  readonly entry: DoorEntry;
  readonly args: Readonly<Record<string, unknown>>;
  readonly children: ReactNode;
  readonly className?: string;
  readonly label?: string;
}): ReactNode {
  const door = useDoor(entry, args, label, isFeatureBuilt(entry.door.feature as FeatureId));
  const run = useRun(entry);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!door.available) return;
    const form = new FormData(event.currentTarget);
    const values: Record<string, unknown> = {};
    for (const key of new Set(form.keys())) {
      const all = form.getAll(key).map(String);
      // an argument several checkboxes stand for is the list of the ticked ones' values; any other, its one value
      values[key] = event.currentTarget.querySelectorAll(`[name="${CSS.escape(key)}"][type="checkbox"]`).length > 0 ? all : all[0];
    }
    // an argument whose checkboxes are all unticked is the empty list
    event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((box) => {
      if (!(box.name in values)) values[box.name] = [];
    });
    run({ ...args, ...values });
  };
  const drawn = entry.door.kind === 'panel-control' ? entry.door.drawnAs : 'button';
  return (
    <form className={['data-form', className ?? ''].filter((c) => c !== '').join(' ')} onSubmit={submit}>
      {children}
      <button
        type="submit"
        className={`door door--${drawn}${door.available ? '' : ' is-unavailable'}`}
        data-door={entry.ref}
        data-args={JSON.stringify(args)}
        title={door.title}
        aria-disabled={door.available ? undefined : true}
      >
        <span className="door__label">{door.face}</span>
      </button>
    </form>
  );
}

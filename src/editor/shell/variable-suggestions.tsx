// A value field's variable suggestions (WISH-10; spec css-variables-tokens, Problem 5): while the field's text is "--"
// or "var(" and the start of a name, it lists the project's variables of the field's kind whose names start with what
// is typed (else hold it), the first one active — as Webflow's value editor suggests variables while one is typed. The
// field is then a combobox (the WAI-ARIA pattern the command bar's search field follows, focus.ts comboboxMove) in the
// field-suggestions key context: its arrows move the active variable (focus.next, focus.previous), Enter writes it
// (focus.activate clicks the active item), Escape closes the list and keeps the text (ui.dismiss); a press on an item
// writes it, the focus staying in the field (the pointer owner's onOwnOption). Each item is the field's own door, its
// value the variable, as the unit menu's suggestions are. Typing goes on in the field, and the focus never leaves it.
import { useEffect, useId, useLayoutEffect, useState, type RefObject } from 'react';
import type { KeyContextId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { setActiveOption } from '../focus/focus.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { Popover } from './popover.tsx';

// "--na", "var(--na", "var(--name)": the name begun, read without its case
const TYPED = /^\s*(?:var\(\s*)?--([\w-]*)\)?\s*$/i;
const PREFIX = 'var(--';
const nameOf = (value: string) => value.slice(PREFIX.length, -1).toLowerCase();

// The variables (each written var(--name)) a field's text begins: those whose names start with the name typed, else
// those that hold it; none when the text begins no variable.
function variablesTyped(text: string, variables: readonly string[]): readonly string[] {
  const typed = TYPED.exec(text)?.[1]?.toLowerCase();
  if (typed === undefined) return [];
  const starting = variables.filter((value) => nameOf(value).startsWith(typed));
  return starting.length > 0 ? starting : variables.filter((value) => nameOf(value).includes(typed));
}

const SUGGESTIONS: KeyContextId = 'field-suggestions';

// The field made the combobox of its list (its key context, role and the list's attributes, the first option active),
// what it was kept to be put back.
function enterCombobox(field: HTMLInputElement, list: string): void {
  field.dataset.restContext ??= field.dataset.keyContext ?? '';
  field.dataset.restRole ??= field.getAttribute('role') ?? '';
  field.dataset.keyContext = SUGGESTIONS;
  field.setAttribute('role', 'combobox');
  field.setAttribute('aria-expanded', 'true');
  field.setAttribute('aria-controls', list);
  field.setAttribute('aria-autocomplete', 'list');
  const options = [...(document.getElementById(list)?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  setActiveOption(field, options, options.length > 0 ? 0 : null);
}
// the field as it was before its list opened
function leaveCombobox(field: HTMLInputElement): void {
  if (field.dataset.restContext === undefined) return;
  field.dataset.keyContext = field.dataset.restContext;
  delete field.dataset.restContext;
  if (field.dataset.restRole === '') field.removeAttribute('role');
  else field.setAttribute('role', field.dataset.restRole ?? '');
  delete field.dataset.restRole;
  for (const name of ['aria-expanded', 'aria-controls', 'aria-autocomplete', 'aria-activedescendant']) field.removeAttribute(name);
}

export function VariableSuggestions({ entry, property, label, input, anchor, variables, choose }: {
  readonly entry: DoorEntry;
  readonly property: string;
  // the list's name: the variables the field's property takes
  readonly label: string;
  readonly input: RefObject<HTMLInputElement | null>;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly variables: readonly string[];
  // writes a variable with the field's door, as the field keeps a value typed
  readonly choose: (value: string) => void;
}) {
  const t = useT();
  const store = useStore();
  const dismissals = useEditorState((s) => s.ui.overlays.dismissals);
  // the variables the text begins, and the dismissal they were offered under: a newer one (Escape, a press outside)
  // closes the list, as it closes every layer
  const [offered, setOffered] = useState<{ readonly matches: readonly string[]; readonly at: number } | null>(null);
  const id = useId();
  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    const read = () => {
      const matches = variablesTyped(element.value, variables);
      setOffered(matches.length === 0 ? null : { matches, at: store.getState().ui.overlays.dismissals });
    };
    const leave = () => setOffered(null);
    element.addEventListener('input', read);
    element.addEventListener('blur', leave);
    return () => {
      element.removeEventListener('input', read);
      element.removeEventListener('blur', leave);
    };
  }, [input, variables, store]);
  const shown = offered !== null && offered.at === dismissals ? offered.matches : null;
  // while the list is shown the field is its combobox, in the list's key context, its first variable active; then it is
  // the field it was again
  useLayoutEffect(() => {
    const element = input.current;
    if (element === null) return;
    if (shown === null) leaveCombobox(element);
    else enterCombobox(element, id);
  }, [shown, id, input]);
  if (shown === null) return null;
  return (
    <Popover anchor={anchor} className="menu field__variables" role="listbox" label={label} keyContext={SUGGESTIONS} takesFocus={false} onDismiss={() => setOffered(null)}>
      <div id={id} role="presentation">
        {shown.map((value, i) => (
          <button
            key={value}
            id={`${id}-${i}`}
            type="button"
            role="option"
            aria-selected={i === 0}
            tabIndex={-1}
            className="menu__item"
            data-door={entry.ref}
            data-args={JSON.stringify({ property, value })}
            title={t('field.variables.choose', { value })}
            onClick={() => {
              setOffered(null);
              choose(value);
            }}
          >
            <span className="menu__label">{value}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

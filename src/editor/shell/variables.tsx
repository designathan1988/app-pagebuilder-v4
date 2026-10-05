// The project's variables in the Styles view (archive/DESIGN.md "Regions", styles; spec css-variables-tokens): the
// design tokens grouped by kind (Colours, Sizes, Fonts), each a row of its name field (tokens.rename), its value field
// (tokens.update) and Delete (tokens.delete), under the section's New variable (tokens.create), which opens the list of
// kinds: each item makes a variable of its kind with the next free name (the kind, a dash and a number) and its kind's
// first value. A field keeps its text on Enter or when it is left, as the inspector's text fields do, for the variable
// it was drawn for.
import { useEffect, useRef, type CSSProperties, type FormEvent } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { tokensOf, type Token } from '../../core/design/tokens.ts';
import { siteColoursOf } from '../../core/design/site-colours.ts';
import { suggestedName, suggestionsOf } from '../../core/design/suggest.ts';
import { pluralForm } from '../../i18n/index.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId, KeyContextId, MessageId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { DoorControl, Icon, useDoor } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { afterGesture } from '../input/pointer.ts';
import { useEditorState, useStore } from '../store.ts';
import { useLocale, useT } from '../text.ts';
import { Popover, usePopover } from './popover.tsx';

const DOORS = doorSlots('styles');
// the key context of the list of kinds: a list of items has the menu's keys (interactions.json)
const MENU_KEYS: KeyContextId = 'menu';
// the doors of the section: New variable (its command takes a kind), a row's name field (a name), value field (a value
// for a token) and Delete (the token alone)
const ADD = DOORS.find((d) => 'kind' in d.command.args);
const RENAME = DOORS.find((d) => 'name' in d.command.args && 'token' in d.command.args);
const UPDATE = DOORS.find((d) => 'value' in d.command.args && 'token' in d.command.args);
const DELETE = DOORS.find((d) => Object.keys(d.command.args).join() === 'token');
// the site's colours (spec site-colours): a colour's replace field (a colour and a value) and its variable button (a
// colour and a name)
const REPLACE_COLOUR = DOORS.find((d) => 'colour' in d.command.args && 'value' in d.command.args);
const COLOUR_VARIABLE = DOORS.find((d) => 'colour' in d.command.args && 'name' in d.command.args);
// a suggestion's button (spec style-suggestions): the type it stands for and the class's name
const SUGGESTION = DOORS.find((d) => 'type' in d.command.args && 'name' in d.command.args);
// tokens.create's kinds, in their manifest order (a colour, a length, a font size), and a first value for each, the
// value a new variable of the kind starts with, and the words of each kind's group
const KINDS: readonly string[] = ADD?.command.args.kind?.values ?? [];
// the colour kind: the first the manifest lists (tokens.create's kinds: colour, length, font size)
const COLOUR_KIND = KINDS[0];
const FIRST_VALUES: readonly string[] = ['#000000', '16px', '16px'];
const GROUPS: readonly MessageId[] = ['styles.group.colours', 'styles.group.sizes', 'styles.group.fonts'];

// the next free name of a kind: the kind, a dash and the first number no variable has
function nextName(kind: string, tokens: readonly Token[]): string {
  for (let n = 1; ; n += 1) if (!tokens.some((t) => t.name === `${kind}-${n}`)) return `${kind}-${n}`;
}

// An item of New variable's list: it makes a variable of its kind, and the list closes. The first holds the list's Tab
// stop; the arrows reach the others.
function KindItem({ entry, args, label, onDone, first }: { readonly entry: DoorEntry; readonly args: Readonly<Record<string, string>>; readonly label: string; readonly onDone: () => void; readonly first: boolean }) {
  const door = useDoor(entry, args, label, isFeatureBuilt(entry.door.feature as FeatureId));
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      tabIndex={first ? 0 : -1}
      className={`variables__kind${door.available ? '' : ' is-unavailable'}`}
      data-door={entry.ref}
      data-args={JSON.stringify(args)}
      title={door.title}
      aria-disabled={door.available ? undefined : true}
      onClick={() => {
        if (!door.available) return;
        door.run();
        onDone();
        // the new variable is brought into view and its name takes the focus, selected, so the name typed next is its
        // own (jornada03 plan, stage 5: the focus fell to the page and the row could be out of sight)
        requestAnimationFrame(() => {
          const name = RENAME === undefined ? null : document.querySelector<HTMLInputElement>(`[data-door="${RENAME.ref}"][data-args="${CSS.escape(JSON.stringify({ token: args.name }))}"] input`);
          name?.scrollIntoView({ block: 'nearest' });
          name?.focus();
          name?.select();
        });
      }}
    >
      {label}
    </button>
  );
}

// New variable's + opens the list of kinds in the editor's popover (popover.tsx), a listbox with the menu's keys: the
// first kind takes the focus, the arrows, Home and End move it, Enter makes the variable, and Escape or a press outside
// closes the list and gives the focus back to the + (the audit's AUD-26: the focus stayed on the +, and the kinds could
// not be reached from the keyboard).
function NewVariable({ entry, tokens }: { readonly entry: DoorEntry; readonly tokens: readonly Token[] }) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const { open, setOpen } = usePopover(trigger);
  const door = useDoor(entry, {}, undefined, isFeatureBuilt(entry.door.feature as FeatureId));
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`door door--icon-button${door.available ? '' : ' is-unavailable'}`}
        data-door={entry.ref}
        data-args="{}"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={door.label}
        title={door.title}
        aria-disabled={door.available ? undefined : true}
        onClick={() => (door.available ? setOpen((was) => !was) : undefined)}
      >
        {entry.door.icon !== null ? <Icon name={entry.door.icon} size="md" /> : null}
      </button>
      {open ? (
        <Popover onDismiss={() => setOpen(false)} anchor={trigger} className="variables__kinds" role="listbox" label={door.label} keyContext={MENU_KEYS}>
          {KINDS.map((kind, i) => (
            <KindItem key={kind} entry={entry} args={{ kind, name: nextName(kind, tokens), value: FIRST_VALUES[i] ?? '' }} label={t(`styles.newVariable.${kind}` as MessageId)} onDone={() => setOpen(false)} first={i === 0} />
          ))}
        </Popover>
      ) : null}
    </>
  );
}

// A field of a variable's row: its text kept with its door's command for the variable it was drawn for, on Enter or
// when it is left, whenever it differs from what the variable holds.
function VariableField({ entry, token, filled, held, label }: { readonly entry: DoorEntry; readonly token: string; readonly filled: string; readonly held: string; readonly label: string }) {
  const store = useStore();
  const args = { token };
  const door = useDoor(entry, args, label, isFeatureBuilt(entry.door.feature as FeatureId));
  const input = useRef<HTMLInputElement>(null);
  const said = useEditorState((s) => s.message);
  useEffect(() => {
    if (input.current !== null) input.current.value = held;
  }, [held, said]);
  const keep = () => {
    const text = input.current?.value ?? '';
    if (text === held) return;
    afterGesture(store, () => (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, ...args, [filled]: text }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    keep();
  };
  return (
    <form className={`variables__field${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify(args)} title={door.title} onSubmit={submit}>
      <input ref={input} className="input" aria-label={label} spellCheck={false} disabled={!door.available} onBlur={keep} />
    </form>
  );
}

export function Variables() {
  const t = useT();
  const tokens = useEditorState((s) => tokensOf(s.document));
  return (
    <div className="variables">
      <div className="section-title">
        <span className="section-title__text">{t('panel.variables')}</span>
        <span className="section-title__actions">{ADD !== undefined ? <NewVariable entry={ADD} tokens={tokens} /> : null}</span>
      </div>
      {/* none yet: how one is made (LR2: an empty project's view was a title over nothing) */}
      {tokens.length === 0 ? <p className="styles__none">{t('styles.noVariables')}</p> : null}
      {KINDS.map((kind, i) => {
        const group = tokens.filter((token) => token.kind === kind);
        if (group.length === 0) return null;
        return (
          <div key={kind} className="variables__group" role="group" aria-label={t(GROUPS[i] ?? 'panel.variables')}>
            <div className="variables__group-title">{t(GROUPS[i] ?? 'panel.variables')}</div>
            {group.map((token) => (
              <div key={token.name} className={`variables__row${kind === COLOUR_KIND ? ' variables__row--colour' : ''}`}>
                {/* a colour variable wears its colour (the canonical Styles view's 14 px swatch) */}
                {kind === COLOUR_KIND ? <span className="variables__swatch" style={{ '--swatch-colour': token.value } as CSSProperties} aria-hidden /> : null}
                {RENAME !== undefined ? <VariableField key={`${token.name}-name`} entry={RENAME} token={token.name} filled="name" held={token.name} label={t('styles.variableName')} /> : null}
                {UPDATE !== undefined ? <VariableField key={`${token.name}-value`} entry={UPDATE} token={token.name} filled="value" held={token.value} label={t('styles.variableValue')} /> : null}
                {DELETE !== undefined ? <DoorControl entry={DELETE} args={{ token: token.name }} ready={isFeatureBuilt(DELETE.door.feature as FeatureId)} /> : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// A field kept with its door's command on Enter or when it is left, standing for the arguments given (a colour of the
// site's), whenever its text differs from what it showed.
function KeptField({ entry, args, filled, held, label }: { readonly entry: DoorEntry; readonly args: Readonly<Record<string, string>>; readonly filled: string; readonly held: string; readonly label: string }) {
  const store = useStore();
  const door = useDoor(entry, args, label, isFeatureBuilt(entry.door.feature as FeatureId));
  const input = useRef<HTMLInputElement>(null);
  const said = useEditorState((s) => s.message);
  useEffect(() => {
    if (input.current !== null) input.current.value = held;
  }, [held, said]);
  const keep = () => {
    const text = input.current?.value ?? '';
    if (text === held) return;
    afterGesture(store, () => (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, ...args, [filled]: text }));
  };
  return (
    <form className={`variables__field${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify(args)} title={door.title} onSubmit={(event: FormEvent) => { event.preventDefault();
      keep();
    }}>
      <input ref={input} className="input" aria-label={label} spellCheck={false} disabled={!door.available} onBlur={keep} />
    </form>
  );
}

// Colours in use (spec site-colours): every colour the site's values name, the most used first, each with its swatch,
// its field (the colour typed there replaces it everywhere: design.replaceColour), how many values name it and its
// variable button (design.colourToVariable, with the next free colour variable name)
export function SiteColours() {
  const t = useT();
  const locale = useLocale();
  const document = useEditorState((s) => s.document);
  const colours = siteColoursOf(document);
  if (colours.length === 0 || REPLACE_COLOUR === undefined) return null;
  const name = nextName(COLOUR_KIND ?? '', tokensOf(document));
  return (
    <div className="variables site-colours">
      <div className="section-title">
        <span className="section-title__text">{t('styles.siteColours')}</span>
      </div>
      {colours.map(({ colour, uses }) => (
        <div key={colour} className="variables__row variables__row--colour site-colours__row">
          <span className="variables__swatch" style={{ '--swatch-colour': colour } as CSSProperties} aria-hidden />
          <KeptField entry={REPLACE_COLOUR} args={{ colour }} filled="value" held={colour} label={t('command.design.replaceColour')} />
          <span className="site-colours__uses">{t(`styles.siteColours.uses.${pluralForm(locale, uses)}` as MessageId, { count: uses })}</span>
          {COLOUR_VARIABLE !== undefined ? <DoorControl entry={COLOUR_VARIABLE} args={{ colour, name }} ready={isFeatureBuilt(COLOUR_VARIABLE.door.feature as FeatureId)} /> : null}
        </div>
      ))}
    </div>
  );
}

// Suggestions (spec style-suggestions): each type of element whose elements all repeat some declarations, with the
// button that makes one class of them
export function Suggestions() {
  const t = useT();
  const document = useEditorState((s) => s.document);
  const suggestions = suggestionsOf(document);
  if (suggestions.length === 0 || SUGGESTION === undefined) return null;
  return (
    <div className="variables suggestions">
      <div className="section-title">
        <span className="section-title__text">{t('styles.suggestions')}</span>
      </div>
      {suggestions.map(({ type, nodes, declarations }) => {
        const name = suggestedName(document, type);
        return (
          <div key={type} className="suggestions__row">
            <span className="suggestions__text">
              {t('styles.suggestion', { count: nodes.length, element: t(`element.${type}.label` as MessageId), properties: Object.keys(declarations).join(', ') })}
            </span>
            <DoorControl entry={SUGGESTION} args={{ type, name }} label={t(SUGGESTION.door.labelKey as MessageId, { name })} ready={isFeatureBuilt(SUGGESTION.door.feature as FeatureId)} />
          </div>
        );
      })}
    </div>
  );
}

// The command bar (PRODUCT.md §5.3 `command-palette`; spec command-bar): a search field over the list of the entries
// the command bar offers (command-bar/command-bar.ts), each drawn by its command-bar door, with its shortcut. Its keys
// are the doors of its key context: ArrowDown and ArrowUp move the active entry, Enter runs it (focus.ts: the field is
// a combobox), Escape and a press on the backdrop close it (ui.dismiss). An entry pressed runs its command, then the
// bar closes (the close waits for the entry's own click: closing first took the entry away before it ran).
import { Fragment, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { CommandId, FeatureId, MessageId } from '../../generated/ids.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import { elementIcon, manifest } from '../../manifest/runtime.ts';
import { BAR_DOORS, SCOPE_PILLS, askedSet, openCommandBar, entryKey, groupedEntries, matchedRanges, scopeOf, kindOf, namedProperties, recentEntries, remember, setEntryFor, shownEntries, type BarEntry, type NamedProperty } from '../command-bar/command-bar.ts';
import { labelParamsOf } from '../doors/current.ts';
import { DoorControl, Icon, appliesNow, isDoorBuilt } from '../doors/door.tsx';
import { GLYPHS, doorSlots, menuOf } from '../doors/placement.ts';
import { setActiveOption } from '../focus/focus.ts';
import { chordCap, chordHint } from '../input/keymap.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { PANELS, panelName, type Panel } from '../workspace/panel-catalogue.ts';
import { PanelBodies } from './bodies.ts';
import { walk } from '../../core/document/model.ts';
import { openedPage } from '../../core/project/pages.ts';
import { classesOf } from '../../core/design/classes.ts';

const BACKDROP = doorSlots('overlay')[0];
const LIST_ID = 'command-bar-list';
const PALETTE = manifest.elements.palette.flatMap((g) => g.entries);
// The footer's hints, as the canonical palette writes them (the audit's AUD-28): the arrows choose, Enter runs, Tab
// reaches the scope pills (the browser's own Tab: the pills follow the field), and the bar's other chord opens it too.
// Escape, which closes the bar, stands at the field's end. The keys are the bar's key context's shortcut doors.
const KEY_DOORS = manifest.doors.filter((d) => d.door.kind === 'shortcut' && d.door.context === 'command-bar');
const keyOf = (key: string): string | null => (KEY_DOORS.some((d) => d.door.kind === 'shortcut' && d.door.chord === key) ? key : null);
const CHOOSE_KEYS = ['ArrowUp', 'ArrowDown'].map(keyOf).filter((key): key is string => key !== null);
const RUN_KEY = keyOf('Enter');
const FILTER_KEY = 'Tab';
// the chords that open the bar besides the one the top bar's search shows
const ALSO_CHORDS = manifest.doors.flatMap((d) => (d.command.id === openCommandBar.command && d.door.kind === 'shortcut' && d.door.context === 'global' && d.door.chord !== chordHint(openCommandBar.command) ? [d.door.chord] : []));
// the menu a command stands in, which its entry names after its label (the canonical palette: Export project (ZIP),
// File); a command in no menu names none
const MENU_OF = new Map(manifest.doors.flatMap((d) => (d.door.kind === 'menu' ? [[d.command.id, menuOf(d.door.menu).labelKey] as const] : [])).reverse());

export function CommandBar() {
  const open = useEditorState((s) => s.ui.commandBar === true);
  return open ? <CommandBarDialog /> : null;
}

function CommandBarDialog() {
  const t = useT();
  const store = useStore();
  const drawsBody = useContext(PanelBodies);
  // what the field holds: the bar's own view (a filter, not a command), as the Insert panel's search
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // every entry offered now: a built door that applies to the selection (appliesNow; the bar is modal: nothing
  // changes while it is open)
  const offered = useMemo(() => {
    const state = store.getState();
    const runs = (entry: (typeof BAR_DOORS)[number], args: Readonly<Record<string, unknown>>) => isDoorBuilt(entry) && appliesNow(entry, args, store);
    return BAR_DOORS.flatMap((entry): BarEntry[] => {
      const kind = kindOf(entry);
      if (kind === 'insert') {
        return PALETTE.filter((p) => isFeatureBuilt(p.feature as FeatureId) && runs(entry, { entry: p.id })).map((p) => {
          const args = { entry: p.id };
          return { entry, args, label: t(entry.door.labelKey as MessageId, { element: { key: p.labelKey as MessageId } }), key: entryKey(entry, args) };
        });
      }
      if (kind === 'open-panel') {
        return (Object.keys(PANELS) as Panel[])
          .filter((panel) => drawsBody(panel) && runs(entry, { panel }))
          .map((panel) => {
            const args = { panel };
            return { entry, args, label: t(entry.door.labelKey as MessageId, { panel: { key: panelName(panel) } }), key: entryKey(entry, args) };
          });
      }
      // a property entry (spec command-bar-set-property): a query of the form "<name> <value>" offers to set the
      // property the manifest declares that name for, with the value the property's own writer takes, and a query that
      // names one offers to reveal it in the inspector. An invalid value is not offered: the store is asked whether
      // the write would run (its handler is pure), so what is shown is what would happen.
      if (kind === 'edit-property') {
        // the property the query names exactly comes first: every other one is ranked by the scorer
        const asked = query.trim().toLowerCase();
        const all = namedProperties();
        const named = [...all.filter((one) => one.id === asked), ...all.filter((one) => one.id !== asked)];
        return named.flatMap((property: NamedProperty): BarEntry[] => {
          const args = { property: property.id };
          return !isDoorBuilt(entry) || !appliesNow(entry, args, store) ? [] : [{ entry, args, label: t(entry.door.labelKey as MessageId, { property: property.id }), key: entryKey(entry, args) }];
        });
      }
      if (kind === 'set-property') {
        const asked = askedSet(query);
        const all = asked === null ? [] : namedProperties();
        // the name is the property's CSS name, or the words the bar shows for it (what a person reads can be typed
        // back)
        const property = asked === null ? undefined : (all.find((one) => one.id === asked.name) ?? all.find((one) => t(one.labelKey as MessageId).toLowerCase() === asked.name));
        if (asked === null || property === undefined) return [];
        const write = setEntryFor(property, asked.value);
        // what would not run is not offered: the store is asked, and its answer is what a change would meet
        if (write === null || write.entry.command.id !== entry.command.id || !isDoorBuilt(entry) || !store.canRun(entry.command.id, write.args as never)) return [];
        // the CSS name, as the spec asks (the status names the CSS property), and what a person types to reach it
        return [{ entry, args: write.args, label: t(entry.door.labelKey as MessageId, { property: property.id, value: asked.value }), key: entryKey(entry, write.args) }];
      }
      // the project's own things (jornada03 J12): its pages to go to, the open page's elements to select, its classes
      // to apply to the selection, each an entry of its own door with the item as its argument
      if (kind === 'go-to-page') {
        return state.document.pages.flatMap((one): BarEntry[] => {
          const args = { page: one.tree.id };
          return runs(entry, args) ? [{ entry, args, label: t(entry.door.labelKey as MessageId, { page: one.name }), key: entryKey(entry, args) }] : [];
        });
      }
      if (kind === 'select-layer') {
        const tree = state.document.pages[openedPage(state)]?.tree;
        return (tree === undefined ? [] : [...walk(tree)].slice(1)).flatMap((node): BarEntry[] => {
          const args = { target: node.id };
          return runs(entry, args) ? [{ entry, args, label: t(entry.door.labelKey as MessageId, { name: node.name }), key: entryKey(entry, args) }] : [];
        });
      }
      if (kind === 'apply-class') {
        return classesOf(state.document).flatMap((one): BarEntry[] => {
          const args = { className: one.name };
          return runs(entry, args) ? [{ entry, args, label: t(entry.door.labelKey as MessageId, { className: one.name }), key: entryKey(entry, args) }] : [];
        });
      }
      if (!runs(entry, {})) return [];
      return [{ entry, args: {}, label: t(entry.door.labelKey as MessageId, labelParamsOf(entry, state)), key: entryKey(entry, {}) }];
    });
  }, [store, drawsBody, t, query]);
  const shown = useMemo(() => shownEntries(query, offered, recentEntries()), [query, offered]);
  // with nothing to offer, a command the query names that cannot run now says why (the dogfooding pass: "dup" with
  // nothing selected answered only that nothing matched); it is still not offered (Problems in Pager 2)
  const blocked = useMemo(() => {
    if (query.trim() === '' || shown.length > 0) return null;
    const state = store.getState();
    const plain = BAR_DOORS.filter((entry) => kindOf(entry) === 'command' && isDoorBuilt(entry) && !appliesNow(entry, {}, store));
    const named = plain.map((entry) => ({ entry, args: {}, label: t(entry.door.labelKey as MessageId, labelParamsOf(entry, state)), key: entryKey(entry, {}) }));
    const first = shownEntries(query, named, [])[0];
    return first === undefined ? null : { label: first.label, reason: t(first.entry.door.disabledReasonKey as MessageId) };
  }, [query, shown, store, t]);

  // the field takes the focus while the bar is open, and gives it back to what had it
  useLayoutEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.current?.focus();
    return () => {
      if ((document.activeElement === null || document.activeElement === document.body) && before?.isConnected) before.focus();
    };
  }, []);
  // the first entry shown is the active one after every change of the list
  useLayoutEffect(() => {
    const input = field.current;
    const options = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (input) setActiveOption(input, options, options.length > 0 ? 0 : null);
  }, [shown]);

  // closes the bar once an entry ran
  const close = () => {
    if (BACKDROP) (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(BACKDROP.command.id, BACKDROP.door.args);
  };
  return (
    <div className="command-bar">
      {BACKDROP ? <DoorControl entry={BACKDROP} className="command-bar__backdrop" /> : null}
      <div className="command-bar__panel" role="dialog" aria-modal="true" aria-label={t('command.commandBar')} data-region="command-palette" data-key-context="command-bar">
        {/* the field in its row (the canonical palette): the search glyph, the query, the key that closes the bar */}
        <div className="command-bar__search">
        <Icon name={GLYPHS.search} size="sm" />
        <input
          ref={field}
          className="command-bar__field"
          type="text"
          role="combobox"
          data-key-context="command-bar"
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-label={t('command.commandBar')}
          placeholder={t('command.commandBar')}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {BACKDROP === undefined ? null : <kbd className="command-bar__close-key">{chordCap(chordHint(BACKDROP.command.id, 'command-bar') ?? '')}</kbd>}
        </div>
        {/* the scope pills (the canonical palette): the scope the query's prefix keeps is pressed; a press puts its
            prefix before the words typed, All takes it away */}
        <div className="command-bar__scopes" role="group" aria-label={t('commandBar.hint.filter')}>
          {SCOPE_PILLS.map((pill) => (
            <button
              key={pill.labelKey}
              type="button"
              className={`command-bar__scope${scopeOf(query).prefix === pill.prefix ? ' is-current' : ''}`}
              aria-pressed={scopeOf(query).prefix === pill.prefix}
              onClick={() => {
                setQuery(`${pill.prefix}${scopeOf(query).words}`);
                field.current?.focus();
              }}
            >
              {t(pill.labelKey as MessageId)}
            </button>
          ))}
        </div>
        {shown.length === 0 && query.trim() !== '' ? (
          <p className="command-bar__none" role="status">
            {blocked === null ? t('commandBar.none', { query: query.trim() }) : t('commandBar.unavailable', { command: blocked.label, reason: blocked.reason })}
          </p>
        ) : null}
        <ul className="command-bar__list" role="listbox" id={LIST_ID} ref={list} aria-label={t('command.commandBar')}>
          {/* the entries under their groups' titles (the canonical palette: Commands, Panels); a title is no option */}
          {groupedEntries(shown).flatMap((group) => [
            <li key={`group-${group.title}`} role="presentation" className="command-bar__group">
              {t(group.title as MessageId)}
            </li>,
            ...group.entries.map((e) => (
              <li key={e.key} id={`${LIST_ID}-${shown.indexOf(e)}`} role="option" aria-selected="false" className="command-bar__option" onClick={() => { remember(e.key);
                close();
              }}>
                <Entry e={e} query={query} />
              </li>
            )),
          ])}
        </ul>
        <p className="command-bar__hints">
          {CHOOSE_KEYS.length > 0 ? (
            <span className="command-bar__key">
              {CHOOSE_KEYS.map((key, index) => (
                <Fragment key={key}>
                  {index > 0 ? ' ' : null}
                  <kbd>{chordCap(key)}</kbd>
                </Fragment>
              ))}{' '}
              {t('commandBar.hint.choose')}
            </span>
          ) : null}
          {RUN_KEY !== null ? (
            <span className="command-bar__key">
              <kbd>{chordCap(RUN_KEY)}</kbd> {t('commandBar.hint.run')}
            </span>
          ) : null}
          <span className="command-bar__key">
            <kbd>{chordCap(FILTER_KEY)}</kbd> {t('commandBar.hint.filter')}
          </span>
          {ALSO_CHORDS.length > 0 ? (
            <span className="command-bar__key">
              {t('commandBar.hint.also')} {ALSO_CHORDS.map((chord) => <kbd key={chord}>{chordCap(chord)}</kbd>)}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

// an entry's row: its icon (an insert entry's element's), its label with the parts the query matches marked, the menu
// its command stands in (drawn by the style sheet from data-menu, so the option's text stays its label), and its
// command's shortcut
function Entry({ e, query }: { readonly e: BarEntry; readonly query: string }) {
  const t = useT();
  const chord = chordHint(e.entry.command.id);
  const menu = kindOf(e.entry) === 'command' ? MENU_OF.get(e.entry.command.id) : undefined;
  const ranges = matchedRanges(query, e.label);
  const parts = ranges.flatMap(([from, to], i) => [e.label.slice(i === 0 ? 0 : (ranges[i - 1]?.[1] ?? 0), from), <mark key={from} className="command-bar__match">{e.label.slice(from, to)}</mark>]);
  const element = kindOf(e.entry) === 'insert' ? PALETTE.find((p) => p.id === e.args.entry)?.element : undefined;
  // an open-panel entry draws its panel's own icon (layout.json; the canonical palette: Open Explorer with the
  // Explorer's files, the audit's AUD-28), as the activity bar and the View menu draw it
  const panel = kindOf(e.entry) === 'open-panel' && typeof e.args.panel === 'string' ? PANELS[e.args.panel as Panel] : undefined;
  const icon = element !== undefined ? elementIcon(element) : (panel?.icon ?? e.entry.door.icon);
  return (
    // one icon, drawn by the control itself (the audit's U-003: the entry drew its icon a second time)
    <DoorControl entry={e.entry} args={e.args} label={e.label} className="command-bar__entry" tabbable={false} icon={icon ?? null}>
      {icon !== null && icon !== undefined ? null : <span className="command-bar__no-icon" />}
      {/* the menu's name is drawn after the label (its data-menu), never part of the entry's own text */}
      <span className="command-bar__label" data-menu={menu === undefined ? undefined : t(menu as MessageId)}>
        {ranges.length === 0 ? e.label : [...parts, e.label.slice(ranges[ranges.length - 1]?.[1] ?? 0)]}
      </span>
      {chord !== null && kindOf(e.entry) === 'command' ? <kbd className="command-bar__chord">{chordCap(chord)}</kbd> : null}
    </DoorControl>
  );
}

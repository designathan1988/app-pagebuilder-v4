// The inspector (spec inspector-panel): its header (the tabs, Page properties, the
// Element actions menu) and the body of the tab it shows (workspace.setActiveTab). A tab whose body the inspector does
// not draw yet (Interactions, until events-actions) is not available yet.
//  - Style: the selector bar, then the Style tab's region, as tall as what it shows (the inspector column scrolls it):
//    with nothing selected, the hints first (and the fields stay empty); then the value-origin legend, Essentials only
//    / All properties, the property search and the sections, always all eight and in order (properties.json), each
//    with the fields the manifest
//    places in inspector-style in their order. A section's header collapses and expands it (inspector.toggleSection);
//    a collapsed one shows no field and summarises the values the page computes (sections.ts). A field offers every
//    value of the catalogue in All properties (the generated list and the presets, PRODUCT.md §5.3) and draws a
//    keyword-buttons control with the keyword icons of properties.json; the commands behind them arrive with their
//    features, so each shows "not available yet".
//  - Settings: no selector bar; its region starts under the header. The text of the one selected text element (its
//    field keeps the text with text.set), then the attribute fields that apply to the element's type, in their order;
//    on the page root, the fields of the page's settings keep what is typed with page.setSetting; on a Link Block or a
//    link, the Link address keeps it with element.setLink; the HTML tag field keeps a typed tag with element.setTag.
import { Splitter } from './splitter.tsx';
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { CommandId, FeatureId, MessageId, SectionId } from '../../generated/ids.ts';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { componentHolders, instanceRootOf } from '../../core/design/instances.ts';
import { locate, type DocNode, type StoredValue } from '../../core/document/model.ts';
import { structuredCss } from '../../core/render/output.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import { elementIcon, manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { DoorControl, Icon, useDoor } from '../doors/door.tsx';
import { MenuButton } from '../doors/menu.tsx';
import { GLYPHS, doorSlots, drawnAsOf, partOf, slotsIn } from '../doors/placement.ts';
import { setActiveOption } from '../focus/focus.ts';
import { authoredProperties, declaredBorderValues, editedProperties, editedPropertiesByDoor, inspectorMode, inspectorSearchOf, isEssential, searchMatches, sectionClosed, sectionProperties, summaryOf, summaryProperties } from '../inspector/sections.ts';
import { orderByGroup, pairRowOf, rowPrefixKey, type PairRow } from '../inspector/rows.ts';
import { CONCEPT_ROWS, pairItem, rowClosed, rowOfItem, shortLabelOf } from '../inspector/concept-rows.ts';
import { ConceptRowView } from './concept-row.tsx';
import { valueOrigin } from '../inspector/origin.ts';
import { MODEL_RULES, useEditorState, useStore, layeredRules } from '../store.ts';
import { FieldOrigin } from './field-origin.tsx';
import './settings.css';
import { inspectorTab } from '../workspace/layout.ts';
import { isPanelOpen } from '../workspace/panels.ts';
import { panelName } from '../workspace/panel-catalogue.ts';
import { messageText, useLocale, useT } from '../text.ts';
import { firstLockRefusal } from '../../core/nodes/flags.ts';
import { activeBreakpoint } from '../view/breakpoints.ts';
import { activeState } from '../view/style-state.ts';
import { keepAfterGesture, useMixed, usePageValues, useSelectionContext, useSelectionContexts } from './field.tsx';
import { shownForContext, shownForKinds, type ElementContext } from '../../core/style/applies.ts';
import { ANCHOR_CONTROL, AnchorControl, BoxModel, Field, GridItemField, GridTracks, SPACING_LINK, TARGETS, TRACK_DOORS, fieldLabelKey, sectionOf, targetOf, useSelectionKinds } from './inspector-controls.tsx';
import { Slots } from './slots.tsx';
import { InteractionsTab } from './interactions.tsx';
import { SettingsTab } from './inspector-settings.tsx';
import { Hints, useSingleNode } from '../inspector/selection.tsx';
import { Affects, TargetChips, classBarControl } from './class-bar.tsx';
import { Popover, usePopover } from './popover.tsx';
import { installRowFit } from './row-fit.ts';
import { breakpointName } from '../../core/document/breakpoints.ts';
import { openedPage } from '../../core/project/pages.ts';
import { CapturedInspector } from './captured-inspector.tsx';

const SECTIONS = manifest.properties.sections;

const CHIP = doorSlots('inspector-selector-bar').find((d) => drawnAsOf(d) === 'item');

const CHIP_PART = CHIP ? partOf('inspector-selector-bar', CHIP) : null;

const ORIGINS: readonly { readonly key: MessageId; readonly origin: string }[] = [
  { key: 'inspector.legend.here', origin: 'here' },
  { key: 'inspector.legend.breakpoint', origin: 'breakpoint' },
  { key: 'inspector.legend.state', origin: 'state' },
  { key: 'inspector.legend.inherited', origin: 'inherited' },
  { key: 'inspector.legend.default', origin: 'default' },
];


const SECTION_HEADER = doorSlots('inspector-style').find((d) => d.door.kind === 'panel-control' && d.door.drawnAs === 'disclosure');
// Find a property's field (spec inspector-property-search): the region's search field
const FOUND_SEARCH = doorSlots('inspector-style').find((d) => d.door.kind === 'panel-control' && d.door.control === 'search-field');
if (FOUND_SEARCH === undefined) throw new Error('inspector-style has no search field');
const PROPERTY_SEARCH: DoorEntry = FOUND_SEARCH;
// the CSS names a door of the Style tab edits, for the search: a field's property (a composite with its longhands), an
// editor control's writes
const cssNamesOf = (entry: DoorEntry): readonly string[] => {
  const target = editedTarget(entry);
  return target !== null ? [target, ...editedProperties(target)] : entry.door.adapter.writes;
};
// The order of the section header in the Style region: the doors placed before it are the panel's own controls (the
// mode segments, Add a property), the ones after it belong to the sections.
const HEADER_ORDER = SECTION_HEADER && typeof SECTION_HEADER.door.placement === 'object' ? SECTION_HEADER.door.placement.order : 0;
const SECTION_DOORS = (() => {
  const bySection = new Map<string, DoorEntry[]>();
  for (const slot of slotsIn('inspector-style')) {
    if (slot.kind !== 'door') continue;
    // each door in its own section (style-places.ts); a control above the sections (the modes, Find a property) in none
    const section = sectionOf(slot.entry);
    if (section === null) continue;
    const list = bySection.get(section) ?? [];
    list.push(slot.entry);
    bySection.set(section, list);
  }
  return bySection;
})();
const STYLE_SECTIONS = SECTIONS.filter((s) => (SECTION_DOORS.get(s.id) ?? []).length > 0);

// The section header's origin dot (the value-origin legend; the mockup's .has mark):
// where the values the section holds come from, read by inspector/origin.ts over every
// field in that section. Its marks stay visible when the section is closed.
function SectionOrigin({ section }: { readonly section: SectionId }) {
  const kinds = useEditorState((s) => {
    const found = new Set(sectionProperties(section).map((property) => valueOrigin(s, [property], layeredRules(s))?.kind));
    return ['here', 'breakpoint', 'state', 'class', 'inherited'].filter((kind) => found.has(kind as 'here' | 'breakpoint' | 'state' | 'class' | 'inherited')).join(' ');
  });
  return <>{kinds.split(' ').filter(Boolean).map((kind) => <span key={kind} className="inspector-section__origin" data-origin={kind} aria-hidden="true" />)}</>;
}

function StyleSections() {
  const t = useT();
  const locale = useLocale();
  // The sections drawn collapsed: the user's own collapses and openings (the preferences), and, for a section nobody
  // has touched, whether the edit target holds a value in it — the element, or the class while a class is the target
  // (sections.ts authoredProperties). As one text, so the hook's answer is stable while nothing changes.
  const collapsedText = useEditorState((s) => {
    const held = authoredProperties(s);
    return STYLE_SECTIONS.filter((section) => sectionClosed(s.ui, section.id as SectionId, held))
      .map((section) => section.id)
      .join(' ');
  });
  const collapsed = useMemo(() => collapsedText.split(' ').filter((id) => id !== '') as readonly SectionId[], [collapsedText]);
  // the concept rows drawn closed (concept-rows.ts rowClosed), as one text for a stable answer
  const rowsClosedText = useEditorState((s) => {
    const held = authoredProperties(s);
    return CONCEPT_ROWS.filter((row) => rowClosed(s.ui, row, held)).map((row) => row.id).join(' ');
  });
  const rowsClosed = useMemo(() => rowsClosedText.split(' ').filter((id) => id !== ''), [rowsClosedText]);
  // the one selected element, whose values a collapsed section summarises
  const only = useEditorState((s) => (s.selection.length === 1 ? (s.selection[0] ?? null) : null));
  const properties = useMemo(() => collapsed.flatMap((section) => summaryProperties(section)), [collapsed]);
  const values = usePageValues(only, properties);
  const borderValuesText = useEditorState((state) => {
    const id = state.selection.length === 1 ? state.selection[0] : undefined;
    const selected = id === undefined ? null : locate(state.document, id)?.node ?? null;
    return selected === null ? null : JSON.stringify(declaredBorderValues(state.document, selected, layeredRules(state)));
  });
  const borderValues = useMemo(() => borderValuesText === null ? null : JSON.parse(borderValuesText) as Readonly<Record<string, string>>, [borderValuesText]);
  const node = useSingleNode();
  const mode = useEditorState((s) => inspectorMode(s.ui));
  const revealed = useEditorState((s) => s.ui.revealed?.field ?? null);
  const kinds = useSelectionKinds();
  const context = useSelectionContext();
  // several selected: the context of each, so a field shows only where it applies to them all (the audit's S-011)
  const several = useSelectionContexts();
  const contexts = several ?? (context === null ? null : [context]);
  // Find a property's query: every section keeps only its matching fields, in either mode (spec
  // inspector-property-search)
  const query = useEditorState((s) => inspectorSearchOf(s.ui));
  const searching = query.trim() !== '';
  // What the edit target holds a value of, in any layer: the element, or the class while a class is the target. One
  // text, so the hook's answer is stable while nothing changes; the Essentials filter and the headers' counts read it
  // (the interface audit, findings F05 and F17).
  const heldText = useEditorState((s) => [...authoredProperties(s)].sort().join(' '));
  const held = useMemo(() => new Set(heldText.split(' ').filter((property) => property !== '')), [heldText]);
  const shownDoors = (section: string) =>
    (SECTION_DOORS.get(section) ?? []).filter((d) => shownForSelection(d, kinds, contexts) && (searching ? searchMatches(query, t(fieldLabelKey(d)), cssNamesOf(d)) : mode === 'all' || shownInEssentials(d, held, revealed)));
  if (searching && STYLE_SECTIONS.every((s) => shownDoors(s.id).length === 0)) return <p className="inspector-search__none">{t('inspector.searchNoMatch', { query: query.trim() })}</p>;
  return (
    <>
      {STYLE_SECTIONS.map((s) => {
        const section = s.id as SectionId;
        // the fields of a section are drawn group by group (rows.ts): the section's groups in the order properties.json
        // declares them, the manifest's placement order inside each group
        const doors = orderByGroup(s.id, shownDoors(s.id));
        // a section with no match is not drawn while searching
        if (searching && doors.length === 0) return null;
        const set = sectionProperties(section).filter((p) => held.has(p)).length;
        // The field just revealed (inspector.reveal) is drawn in its section and takes the focus (spec
        // inspector-add-property): a section drawn collapsed shows no field, so the section holding it is drawn open —
        // the person asked for that field by name. A collapsed section with a match is drawn open for the search too;
        // its collapsed state is kept.
        const holdsRevealed = revealed !== null && doors.some((d) => {
          const target = editedTarget(d);
          return target === revealed || (target !== null && editedProperties(target).includes(revealed));
        });
        const closed = !searching && collapsed.includes(section) && !holdsRevealed;
        const summary = closed ? summaryOf(section, section === 'border' ? borderValues : values, t, locale) : null;
        const boxDoors = doors.filter((d) => targetOf(d)?.control === 'box-model');
        // The manifest orders the fields by group; the design draws the fields without subgroup headings.
        const units: ReactNode[] = [];
        // the item each unit draws (its door, or its pair row: concept-rows.ts), beside the unit, so the pass below can
        // gather a concept row's head and details
        const unitItem: string[] = [];
        const rowDrawn = new Set<string>();
        // the fields of a pair row this section draws, in the row's own order; a row with one field left keeps a field
        const pairMembers = (row: PairRow): readonly DoorEntry[] => row.fields.map((f) => doors.find((x) => editedTarget(x) === f.target)).filter((x): x is DoorEntry => x !== undefined);
        const drawer = (d: DoorEntry): ReactNode => {
          if (targetOf(d)?.control === 'box-model') return boxDoors[0] === d ? <BoxModel key={d.ref} doors={boxDoors} /> : null;
          if (d.door.kind === 'panel-control' && d.door.drawnAs === 'field' && cssTextArg(d) !== null && node !== null) return <DeclarationsField key={`${d.ref}@${node.id}`} entry={d} node={node} />;
          if (d === SPACING_LINK) return null;
          // a grid item's start or span: its own field
          if (d.door.kind === 'panel-control' && d.door.control === 'grid-item-field') {
            const half = d.ref.endsWith('-span') ? 'span' : 'start';
            return <GridItemField key={d.ref} entry={d} half={half} />;
          }
          // the grid's tracks are one editor per axis, drawn at the first of its own doors (the door names the
          // axis it edits); the raw value keeps its field
          const axis = typeof d.door.args.property === 'string' ? d.door.args.property : null;
          const trackDoors = axis === null ? [] : TRACK_DOORS.filter((x) => x.door.args.property === axis);
          if (trackDoors.includes(d)) return trackDoors[0] === d ? <GridTracks key={d.ref} entry={d} /> : null;
          if (d.door.kind === 'panel-control' && d.door.control === ANCHOR_CONTROL) return <AnchorControl key={d.ref} entry={d} />;
          if (d.door.kind === 'panel-control') return <Fragment key={d.ref}>{d.door.drawnAs === 'icon-button' ? <DoorControl entry={d} /> : <PanelField entry={d} />}</Fragment>;
          return (
            <Fragment key={d.ref}>
              <Field entry={d} rowLabel={shortLabelOf(d.ref)} />
              <FieldOrigin entry={d} target={editedTarget(d)} />
            </Fragment>
          );
        };
        for (const d of doors) {
          const target = editedTarget(d);
          const row = searching || target === null ? null : pairRowOf(target);
          if (row === null || rowDrawn.has(d.ref)) {
            if (row === null) {
              units.push(<Fragment key={d.ref}>{drawer(d)}</Fragment>);
              unitItem.push(d.ref);
            }
            continue;
          }
          // the fields of the row this section draws, in the row's own order; a row with one field left keeps a row
          const members = pairMembers(row);
          if (members.length < 2) {
            units.push(<Fragment key={d.ref}>{drawer(d)}</Fragment>);
            unitItem.push(d.ref);
            continue;
          }
          for (const m of members) rowDrawn.add(m.ref);
          const rowSet = members.some((m) => {
            const t2 = editedTarget(m);
            return t2 !== null && editedProperties(t2).some((p) => held.has(p));
          });
          units.push(
            <Fragment key={row.id}>
              {/* The first column names the concept (Size, Min, Max); each field its axis by its short name. */}
              <div>
                <div className={`field-row field-row--pair${rowSet ? ' is-set' : ''}`} data-pair={row.id} data-number-field={rowSet || members.some((m) => targetOf(m)?.control === 'length-field') ? true : undefined}>
                  {members.map((m, index) => {
                    const prefixKey = rowPrefixKey(row, editedTarget(m) ?? '');
                    return (
                      <Field
                        key={m.ref}
                        entry={m}
                        bare
                        labelled={index === 0}
                        rowLabel={index === 0 ? row.labelKey : null}
                        prefix={prefixKey === null ? null : t(prefixKey)}
                      />
                    );
                  })}
                </div>
              </div>
              {members.map((m) => <FieldOrigin key={`${m.ref}-origin`} entry={m} target={editedTarget(m)} />)}
            </Fragment>,
          );
          unitItem.push(pairItem(row.id));
        }
        // The concept rows (concept-rows.ts): a row is drawn where its first unit stands, its head always and its
        // details in place under it while it is open. While searching every row is drawn flat, so a match is never
        // hidden; a row whose head the mode or the element leaves out draws its details flat too.
        const ordered: ReactNode[] = [];
        const rowsDrawn = new Set<string>();
        units.forEach((node, index) => {
          const found = searching ? null : rowOfItem(unitItem[index] ?? '');
          if (found === null) {
            ordered.push(node);
            return;
          }
          const { row } = found;
          if (rowsDrawn.has(row.id)) return;
          rowsDrawn.add(row.id);
          const head = units.filter((_, i) => rowOfItem(unitItem[i] ?? '')?.row === row && rowOfItem(unitItem[i] ?? '')?.part === 'head');
          const details = units.filter((_, i) => rowOfItem(unitItem[i] ?? '')?.row === row && rowOfItem(unitItem[i] ?? '')?.part === 'details');
          // a row with a head of its own that the mode or the element leaves out (the anchors of a relative element)
          if (head.length === 0 && row.head.length > 0) {
            ordered.push(...details);
            return;
          }
          // the field just revealed opens its row for as long as it is revealed
          const holdsRevealed = revealed !== null && row.details.some((item) => {
            const door = doors.find((x) => x.ref === item);
            const target = door === undefined ? null : editedTarget(door);
            return target === revealed || (target !== null && editedProperties(target).includes(revealed));
          });
          ordered.push(<ConceptRowView key={`row:${row.id}`} row={row} head={head} details={details} open={!rowsClosed.includes(row.id) || holdsRevealed} />);
        });
        return (
          <section key={s.id} className="inspector-section" data-section={section} aria-label={t(s.labelKey as MessageId)}>
            {SECTION_HEADER ? (
              <DoorControl entry={SECTION_HEADER} args={{ section }} expanded={!closed} className="inspector-section__header">
                <span className="door__label">{t(s.labelKey as MessageId)}</span>
                <SectionOrigin section={section} />
                {summary !== null ? <span className="inspector-section__summary">{summary}</span> : null}
                {/* how many values are set in the section: in the header's name, which a screen reader reads, never drawn —
                    the origin dot and the summary say it to the eye (the owner's decision D-3; jornada02 R-07) */}
                {set > 0 ? <span className="inspector-section__count visually-hidden">{t('inspector.valuesSet', { count: set })}</span> : null}
              </DoorControl>
            ) : null}
            {closed ? null : ordered}
          </section>
        );
      })}
    </>
  );
}

// Find a property (spec inspector-property-search): each change runs inspector.search with what the field holds; Enter
// keeps it (the form submits nothing)
function PropertySearch() {
  const store = useStore();
  const query = useEditorState((s) => inspectorSearchOf(s.ui));
  const door = useDoor(PROPERTY_SEARCH);
  const change = (value: string) => {
    if (door.built) (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(PROPERTY_SEARCH.command.id, { ...PROPERTY_SEARCH.door.args, query: value });
  };
  return (
    <form className="inspector-search" data-door={PROPERTY_SEARCH.ref} data-args="{}" onSubmit={(event) => event.preventDefault()}>
      {PROPERTY_SEARCH.door.icon !== null ? <Icon name={PROPERTY_SEARCH.door.icon} size="sm" /> : null}
      <input className="search" type="search" placeholder={door.label} aria-label={door.label} title={door.title} disabled={!door.built} spellCheck={false} autoComplete="off" value={query} onChange={(event) => change(event.currentTarget.value)} />
    </form>
  );
}

// the property, composite or recipe a door of the Style tab edits, or null (an editor control)
function editedTarget(entry: DoorEntry): string | null {
  if (entry.door.kind !== 'inspector-field') return null;
  return entry.door.property ?? entry.door.composite ?? entry.door.recipe ?? null;
}
// Whether the essentials mode draws a door (spec inspector-advanced-mode): an editor control always; a field when its
// property is one of the essentials, when the element holds a value of it, or when it was just revealed.
function shownInEssentials(entry: DoorEntry, held: ReadonlySet<string>, revealed: string | null): boolean {
  const target = editedTarget(entry);
  if (target === null) return true;
  return isEssential(target) || target === revealed || editedProperties(target).some((p) => held.has(p));
}
// Whether a door of the Style tab is drawn for the selection (spec props-element-specific): a field of a kind of
// element (a table's, a list's, a form control's, a medium's) only while every selected element is of that kind, and a
// field of a layout the element is in (a flex container's, an item's) only while the page computes that layout for it.
function shownForSelection(entry: DoorEntry, kinds: readonly string[], contexts: readonly ElementContext[] | null): boolean {
  const target = editedTarget(entry);
  // a field names its property, composite or recipe; an editor control (the alignment matrix) is named by the manifest
  // entries whose doors list it, so the same rules read it
  const properties = target !== null ? editedProperties(target) : editedPropertiesByDoor(entry.ref);
  if (properties === null) return true;
  if (!shownForKinds(properties, kinds, MODEL_RULES)) return false;
  // no measured context yet: the context predicates do not hide anything (as for one element being measured)
  return contexts === null || contexts.every((context) => shownForContext(properties, context, MODEL_RULES));
}


// The Add a property button (spec inspector-add-property): it opens the list of the properties the Style tab does not
// draw now (essentials mode), filtered by what is typed; choosing one reveals its field (inspector.reveal), which takes
// the focus. The button and each item are the reveal door, the items standing for their property. The list closes as
// every menu does (Problems in Pager 4): a dismissal newer than its opening (Escape in its filter or on an item, a
// press on the backdrop drawn under it) closes it, and the focus goes back to the button.
const REVEAL = doorSlots('inspector-style').find((d) => d.door.kind === 'panel-control' && d.door.control === 'add-property-item');
function AddProperty() {
  const t = useT();
  const context = useSelectionContext();
  const several = useSelectionContexts();
  const contexts = several ?? (context === null ? null : [context]);
  // the list is a popover (popover.tsx): opened by "+", closed by a choice, the backdrop or Escape; opened, its filter
  // takes the focus (spec inspector-add-property, Problems in Pager 3), and dismissed, the focus goes back to "+"
  const button = useRef<HTMLButtonElement>(null);
  const { open, setOpen } = usePopover(button);
  const [query, setQuery] = useState('');
  const filter = useRef<HTMLInputElement>(null);
  const listId = useId();
  const mode = useEditorState((s) => inspectorMode(s.ui));
  const revealed = useEditorState((s) => s.ui.revealed?.field ?? null);
  const node = useSingleNode();
  const kinds = useSelectionKinds();
  // what the edit target holds: the element, or the class while a class is the target (findings F05 and F17), so a
  // property the class already sets is never offered as one to add
  const heldText = useEditorState((s) => [...authoredProperties(s)].sort().join(' '));
  const held = useMemo(() => new Set(heldText.split(' ').filter((property) => property !== '')), [heldText]);
  // the first property listed is the marked one after every change of the list (what is typed, the selection)
  const kindsKey = kinds.join(' ');
  useLayoutEffect(() => {
    const input = filter.current;
    // the options of the list the filter stands in (the popover it opened with)
    const options = [...(input?.closest('.add-property__menu')?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (open && input) setActiveOption(input, options, options.length > 0 ? 0 : null);
  }, [open, query, mode, revealed, node, kindsKey]);
  const door = useDoor(REVEAL ?? (manifest.doors[0] as DoorEntry), {}, t('inspector.addProperty'), REVEAL !== undefined && isFeatureBuilt(REVEAL.door.feature as FeatureId));
  if (REVEAL === undefined) return null;
  // the properties the panel hides in essentials mode, listed in the catalogue's own order (properties.json): the
  // doors' placement order is the order the panel draws them, not the order a person reads a list of properties in
  // (spec add-property-focus reads the list's first two entries, font-style and font-stretch, as the catalogue has
  // them)
  const hiddenTargets = new Set(
    SECTIONS.flatMap((s) => SECTION_DOORS.get(s.id) ?? [])
      .filter((d) => shownForSelection(d, kinds, contexts) && !shownInEssentials(d, held, revealed))
      .flatMap((d) => editedTarget(d) ?? []),
  );
  const hidden =
    mode === 'all'
      ? []
      : manifest.properties.properties
          .map((property) => property.id)
          .filter((target) => {
            if (!hiddenTargets.has(target)) return false;
            const label = TARGETS.get(target)?.labelKey;
            const words = `${label === undefined ? '' : t(label as MessageId)} ${target}`.toLowerCase();
            return words.includes(query.trim().toLowerCase());
          });
  return (
    <div className="add-property">
      <button ref={button} type="button" className={`door door--icon-button${door.available ? '' : ' is-unavailable'}`} data-door={REVEAL.ref} data-args="{}" aria-haspopup="dialog" aria-expanded={open} aria-label={door.label} title={door.title} aria-disabled={door.available ? undefined : true} onClick={() => (door.available ? setOpen(!open) : undefined)}>
        {REVEAL.door.icon !== null ? <Icon name={REVEAL.door.icon} size="md" /> : null}
      </button>
      {open ? (
        // a property chosen closes the list; its field takes the focus (inspector.reveal)
        <Popover onDismiss={() => setOpen(false)} anchor={button} className="add-property__menu" label={door.label} onClick={(event) => (event.target instanceof Element && event.target.closest('[data-door]') ? setOpen(false) : undefined)}>
          {/* the filter is a combobox of the menu key context: the arrows move the marked property, Enter chooses
              it */}
          <input
            ref={filter}
            className="input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={t('inspector.addProperty.filter')}
            placeholder={t('inspector.addProperty.filter')}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            data-local="add-property-filter"
            data-key-context="menu"
            data-autofocus
          />
          {/* nothing hidden (All properties), or hidden properties none of which the filter matches: two different
             things */}
          {hidden.length === 0 ? <p className="add-property__none">{hiddenTargets.size === 0 || mode === 'all' ? t('inspector.addProperty.none') : t('inspector.addProperty.noMatch', { query: query.trim() })}</p> : null}
          <div id={listId} role="listbox" aria-label={door.label} className="add-property__list">
            {hidden.map((target, i) => (
              <div key={target} id={`${listId}-${i}`} role="option" aria-selected="false">
                <DoorControl entry={REVEAL} args={{ property: target }} label={`${t((TARGETS.get(target)?.labelKey ?? '') as MessageId)} · ${target}`} className="add-property__item" />
              </div>
            ))}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

// The command argument a panel field's CSS text fills: its one text argument besides the node it stands for
// (style.setCustomDeclarations' declarations), when the command stands for a node; null otherwise.
function cssTextArg(entry: DoorEntry): string | null {
  const args = Object.entries(entry.command.args);
  if (!args.some(([name, arg]) => name === 'target' && arg.type === 'node')) return null;
  const text = args.filter(([name, arg]) => name !== 'target' && arg.type === 'string');
  return text.length === 1 ? (text[0] as [string, unknown])[0] : null;
}

// the node's declarations at the base breakpoint and state, "property: value;" each, on one line
function declarationsText(node: DocNode): string {
  const byState = (node.styles as Record<string, Record<string, Record<string, StoredValue>> | undefined>)[MODEL_RULES.base.breakpoint];
  // a structured value (a shadow's layers) as the page writes it
  return Object.entries(byState?.[MODEL_RULES.base.state] ?? {})
    .map(([property, value]) => `${property}: ${typeof value === 'string' ? value : structuredCss(value, MODEL_RULES.structures.get(property) ?? [])};`)
    .join(' ');
}

// The element's CSS declarations (style.setCustomDeclarations): a field showing what the element holds at the base
// breakpoint and state, the declarations separated by ";"; Enter (the field is the one field of its form, so Enter
// submits it) or leaving it (Tab, a click elsewhere, another selection) keeps what it holds for the node it was drawn
// for, one undo step, when it differs from what it last showed. A refused text is shown again as the document holds it
// after the command says why.
function DeclarationsField({ entry, node }: { readonly entry: DoorEntry; readonly node: DocNode }) {
  const store = useStore();
  const filled = cssTextArg(entry) ?? '';
  const args = useMemo(() => ({ target: node.id }), [node.id]);
  const door = useDoor(entry, args);
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const shown = useRef('');
  const stored = declarationsText(node);
  const said = useEditorState((s) => s.message);
  const command = entry.command.id;
  useEffect(() => {
    if (field.current === null) return;
    field.current.value = stored;
    shown.current = stored;
  }, [stored, said]);
  useEffect(() => {
    const row = form.current;
    const element = field.current;
    if (row === null || element === null) return;
    const keep = () => {
      if (element.value === shown.current) return;
      shown.current = element.value;
      const text = element.value;
      keepAfterGesture(store, () => {
        if (locate(store.getState().document, args.target) === null) return;
        (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(command, { ...args, [filled]: text });
      });
    };
    const submit = (event: Event) => {
      event.preventDefault();
      keep();
    };
    row.addEventListener('submit', submit);
    element.addEventListener('blur', keep);
    return () => {
      row.removeEventListener('submit', submit);
      element.removeEventListener('blur', keep);
      keep();
    };
  }, [store, command, args, filled]);
  return (
    <form ref={form} className={`field-row field-row--wide${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify(args)} title={door.title}>
      <span className="field-row__label">{door.label}</span>
      <input ref={field} className="input" disabled={!door.available} aria-label={door.label} spellCheck={false} />
    </form>
  );
}

// The alignment matrix (spec props-flex-container): three rows of three cells, each the matrix's door standing for
// where the cell is drawn (x across, y down: start, center, end), named from the catalogue; the cell standing for what
// the element holds is pressed.
const MATRIX_PLACES = ['start', 'center', 'end'] as const;
function MatrixCell({ entry, x, y, mixed }: { readonly entry: DoorEntry; readonly x: string; readonly y: string; readonly mixed: boolean }) {
  const t = useT();
  const name = t('inspector.alignment.cell', { x: { key: `inspector.alignment.x.${x}` as MessageId }, y: { key: `inspector.alignment.y.${y}` as MessageId } });
  return (
    <DoorControl entry={entry} args={{ x, y }} label={name} className="matrix__cell" current={mixed ? false : undefined} tabbable={mixed && x === MATRIX_PLACES[0] && y === MATRIX_PLACES[0]} roving={!mixed}>
      <span className="matrix__bars" aria-hidden="true" />
    </DoorControl>
  );
}
// several elements with different alignments: no cell pressed, and Mixed beside it, as every field says it (A3.35)
function AlignmentMatrix({ entry, label }: { readonly entry: DoorEntry; readonly label: string }) {
  const t = useT();
  const mixed = useMixed(entry.door.adapter.writes);
  // the group's one Tab stop: the pressed cell, else the first — with no cell pressed (a value no cell stands for,
  // "normal") every cell was out of the Tab order (the audit's S-006)
  const group = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const cells = [...(group.current?.querySelectorAll<HTMLElement>('.matrix__cell') ?? [])];
    const first = cells[0];
    if (first !== undefined && !cells.some((cell) => cell.tabIndex === 0)) first.tabIndex = 0;
  });
  // the plate and its Mixed in one cell of the row: Mixed stays beside the plate, never on a line of its own (S-032)
  return (
    <span className="field-choice field-choice--plate">
      {/* three columns: the arrows move across and down the grid (keymap.ts, data-columns) */}
      <span ref={group} className={`matrix${mixed ? ' is-mixed' : ''}`} role="group" aria-label={label} data-mixed={mixed ? '' : undefined} data-columns={MATRIX_PLACES.length}>
        {MATRIX_PLACES.flatMap((y) => MATRIX_PLACES.map((x) => <MatrixCell key={`${x}-${y}`} entry={entry} x={x} y={y} mixed={mixed} />))}
      </span>
      {mixed ? <span className="field-row__mixed">{t('inspector.mixedValue')}</span> : null}
    </span>
  );
}

// an editor control of the Style tab that is not a property field (the alignment matrix, the anchors, the custom
// declarations)
function PanelField({ entry }: { readonly entry: DoorEntry }) {
  const door = useDoor(entry);
  return (
    <div className={`field-row${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} title={door.title}>
      <span className="field-row__label">{door.label}</span>
      {entry.door.kind === 'panel-control' && entry.door.control === 'alignment-matrix' ? (
        <AlignmentMatrix entry={entry} label={door.label} />
      ) : (
        <input className="input" disabled={!door.available} aria-label={door.label} />
      )}
    </div>
  );
}

// What the selector bar names (the element's icon, name and tag): the one selected
// element, with its exported tag (the page root's is body); with several selected, how many; with none, that nothing
// is. Read from the store's selection, so the inspector never says something the store contradicts.
function SelectedElement() {
  const t = useT();
  const count = useEditorState((s) => s.selection.length);
  const node = useSingleNode();
  // several: how many, and their tags (the canonical "3 elements  article × 3"; distinct tags listed), as one text so
  // the hook's answer is stable
  const several = useEditorState((s) => {
    if (s.selection.length < 2) return '';
    const nodes = s.selection.map((id) => locate(s.document, id)?.node ?? null).filter((one): one is DocNode => one !== null);
    const tags = [...new Set(nodes.map((one) => one.tag ?? ''))].filter((tag) => tag !== '');
    return JSON.stringify({ type: nodes[0]?.type ?? null, tags });
  });
  if (count > 1) {
    const { type, tags } = JSON.parse(several || '{"type":null,"tags":[]}') as { readonly type: string | null; readonly tags: readonly string[] };
    return (
      <div className="selector-bar__element">
        <Icon name={(type === null ? null : elementIcon(type)) ?? GLYPHS.folder} size="sm" />
        <span className="selector-bar__name">{t('inspector.elementCount', { count })}</span>
        <small className="selector-bar__tag">{tags.length === 1 ? `${tags[0]} × ${count}` : tags.join(', ')}</small>
      </div>
    );
  }
  if (node === null) return <div className="selector-bar__element">{t('inspector.nothingSelected')}</div>;
  return (
    <div className="selector-bar__element">
      <Icon name={elementIcon(node.type) ?? GLYPHS.folder} size="sm" />
      <span className="selector-bar__name">{node.name}</span>
      <small className="selector-bar__tag">{node.tag ?? ''}</small>
    </div>
  );
}


// The notice an element of an instance wears in the Style tab (the user's real-use audit, item A3.12): a style write
// there reaches the component and every copy of it, and the person is told before anything is typed.
function ComponentNotice() {
  const t = useT();
  // the store's own values (the selector returns what it holds, never a fresh object: the state subscription
  // compares them by identity)
  const document = useEditorState((s) => s.document);
  const only = useEditorState((s) => (s.selection.length === 1 ? (s.selection[0] ?? null) : null));
  if (only === null) return null;
  const root = instanceRootOf(document, only);
  const holders = componentHolders(document, only);
  if (root?.component === undefined || holders === null) return null;
  const copies = holders.length - 1;
  return (
    <p className="inspector-notice" role="note" data-region="inspector-component-notice">
      {copies === 1 ? t('inspector.componentNotice', { component: root.component }) : t('inspector.componentNoticeMany', { component: root.component, count: copies })}
    </p>
  );
}

// A locked selection's notice (the audit's S-030: 110 of 113 controls were disabled with nothing in the panel saying
// why): the lock's own refusal — the element to unlock, the lock above it named (spec lock-element) — said once at the
// top of the tab, before anything is tried.
function LockNotice() {
  const locale = useLocale();
  // the store's own values (a fresh refusal per read would never compare equal)
  const document = useEditorState((s) => s.document);
  const selection = useEditorState((s) => s.selection);
  const refusal = useMemo(() => firstLockRefusal(document, selection, 'status.locked.edit'), [document, selection]);
  if (refusal === null) return null;
  return (
    <p className="inspector-notice inspector-notice--lock" role="note">
      {messageText(locale, refusal)}
    </p>
  );
}

// The Style tab: the selector bar, then its region, as tall as what it shows inside the scrolling column.
function StyleTab() {
  const t = useT();
  const none = useEditorState((s) => s.selection.length === 0);
  if (none) return (
    <>
      <SelectorBar />
      <div className="inspector-style" data-region="inspector-style">
        {/* with nothing selected the tab is the guidance alone (spec inspector-empty-style): the sections are a map of
            the selected element's values, and there is no element */}
        <div className="inspector-body inspector-body--empty"><Hints /></div>
      </div>
    </>
  );
  return (
    <>
      <SelectorBar />
      <div className="inspector-style" data-region="inspector-style">
          <div className="inspector-controls">
            <ul className="legend">
              {ORIGINS.map((o) => (
                <li key={o.origin} className={`legend__item legend__item--${o.origin}`}>
                  {t(o.key)}
                </li>
              ))}
            </ul>
            <div className="inspector-mode">
              <div className="segmented segmented--wide" role="group">
                {/* the segments placed before the sections alone: a section's own segmented control (the anchor control
                    of Position) is drawn by its section, never here (the audit's S-001) */}
                <Slots region="inspector-style" to={HEADER_ORDER - 1} render={(slot) => (slot.kind === 'door' && slot.entry.door.kind === 'panel-control' && slot.entry.door.drawnAs === 'segment' ? undefined : null)} />
              </div>
            </div>
            <div className="inspector-searchline"><PropertySearch /><AddProperty /></div>
          </div>
        <div className="inspector-scroll">
        <div className="inspector-body">
          <LockNotice />
          <ComponentNotice />
          <div className="inspector-sections" data-region="inspector-sections">
            <StyleSections />
          </div>
        </div>
        </div>
      </div>
    </>
  );
}

// The Settings tab under the selected element's head, as the Style tab's selector bar and the Interactions tab's head
// name it (the user's audit order of 2026-10-05: the Settings tab did not say whose settings it showed); with nothing
// or several selected the tab says so itself
function SettingsWithHead() {
  const single = useSingleNode() !== null;
  return (
    <SettingsTab head={single ? <div className="selector-bar selector-bar--head" data-region="inspector-settings-head"><SelectedElement /></div> : null} />
  );
}

// The body of each inspector tab the editor draws; the tab of any other is not available yet.
const TAB_BODIES: Readonly<Record<string, ComponentType>> = { style: StyleTab, settings: SettingsWithHead, interactions: InteractionsTab };

export function Inspector() {
  const t = useT();
  const open = useEditorState((s) => isPanelOpen(s.ui, 'inspector'));
  const captured = useEditorState((s) => s.document.pages[openedPage(s)]?.capture !== undefined);
  const tab = useEditorState((s) => inspectorTab(s.ui));
  // a row whose label or value does not fit beside the other stacks (row-fit.ts)
  const aside = useRef<HTMLElement>(null);
  useEffect(() => (open && aside.current !== null ? installRowFit(aside.current) : undefined), [open]);
  if (!open) return null;
  if (captured) return <aside ref={aside} className="inspector" aria-label={t(panelName('inspector'))} data-panel-focus="inspector">
    <Splitter splitter="inspector-width" className="splitter--column-start" />
    <CapturedInspector />
  </aside>;
  const Body = TAB_BODIES[tab];
  return (
    <aside ref={aside} className="inspector" aria-label={t(panelName('inspector'))} data-panel-focus="inspector">
      {/* the inspector's width, which the person sets (spec panel-resize) */}
      <Splitter splitter="inspector-width" className="splitter--column-start" />
      <div className="inspector-header" data-region="inspector-header">
        {/* its tabs rove with the arrows (the tab-strip key context; the audit's U-034) */}
        <div className="inspector-header__tabs" role="tablist" data-key-context="tab-strip">
          <Slots
            region="inspector-header"
            render={(slot) => {
              if (slot.kind !== 'door' || drawnAsOf(slot.entry) !== 'tab') return null;
              const panel = slot.entry.door.args.panel;
              return <DoorControl key={slot.entry.ref} entry={slot.entry} ready={typeof panel === 'string' && panel in TAB_BODIES} />;
            }}
          />
        </div>
        <span className="inspector-header__actions">
          <Slots region="inspector-header" render={(slot) => (slot.kind === 'door' && drawnAsOf(slot.entry) === 'tab' ? null : undefined)} />
        </span>
      </div>
      {Body ? <Body /> : null}
    </aside>
  );
}

// The selector bar of the Style tab : the selected element, its targets, the state
// picker and the active breakpoint.
function SelectorBar() {
  const t = useT();
  const none = useEditorState((s) => s.selection.length === 0);
  // the state and the breakpoint the editor edits (view/style-state.ts, view/breakpoints.ts)
  const state = useEditorState((s) => activeState(s.ui));
  const breakpoint = useEditorState((s) => activeBreakpoint(s));
  const breakpointIcon = doorSlots('canvas-breakpoints').find((d) => d.door.args.breakpoint === breakpoint.id)?.door.icon ?? null;
  if (none) return <div className="selector-bar selector-bar--empty" data-region="inspector-selector-bar"><SelectedElement /></div>;
  return (
    <div className="selector-bar" data-region="inspector-selector-bar">
      <SelectedElement />
      <div className="selector-bar__targets">
        <TargetChips />
        <Slots
          region="inspector-selector-bar"
          render={(slot) => {
            if (slot.kind === 'menu') return null;
            const drawn = slot.entry.door.kind === 'panel-control' ? slot.entry.door.drawnAs : null;
            // the target chips and the × drawn inside them stand for the element's targets (TargetChips draws them)
            if (drawn === 'item' || slot.entry === CHIP_PART) return null;
            return classBarControl(slot.entry);
          }}
        />
      </div>
      <Affects />
      <div className="selector-bar__state" data-edited-state={state.id === MODEL_RULES.baseLayer.state ? 'base' : 'variant'}>
        <Slots
          region="inspector-selector-bar"
          render={(slot) =>
            slot.kind === 'menu' ? (
              <MenuButton key={slot.menu} menu={slot.menu} anchor={slot.anchor} indicator className="state-picker">
                <span className="state-picker__key">{t('menu.styleState')}</span>
                <span className="state-picker__value">{t(state.labelKey as MessageId)}</span>
              </MenuButton>
            ) : null
          }
        />
        <span className="active-breakpoint" data-variant={breakpoint.id !== MODEL_RULES.baseLayer.breakpoint ? 'true' : undefined} title={t('inspector.activeBreakpoint')}>
          {breakpointIcon !== null ? <Icon name={breakpointIcon} size="sm" /> : null}
          <span>{breakpointName(breakpoint, t)}</span>
          <span className="active-breakpoint__width">{breakpoint.width}</span>
        </span>
      </div>
    </div>
  );
}

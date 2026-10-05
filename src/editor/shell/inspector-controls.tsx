import { styleSections, type StyleDoor } from '../../manifest/style-places.ts';
import { useEffect, useRef, type ReactNode } from 'react';
import type { CommandId, FeatureId, KeyContextId, MessageId, StyleTargetId } from '../../generated/ids.ts';
import { GENERATED_VALUES, INITIAL_VALUES } from '../../generated/value-lists.ts';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { locate } from '../../core/document/model.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { DoorControl, Icon, useDoor } from '../doors/door.tsx';
import { GLYPHS, doorSlots } from '../doors/placement.ts';
import { isColourValue } from '../inspector/sections.ts';
import { MODEL_RULES, useEditorState, useStore, layeredRules } from '../store.ts';
import { isLinked } from '../inspector/spacing.ts';
import { styleSource } from '../inspector/style-target.ts';
import { pluralForm } from '../../i18n/index.ts';
import { useLocale, useT } from '../text.ts';
import { usePrimarySize } from '../view/selection-size.ts';
import { KeywordButtons, NumberField, propertyWord, TextStyleField, keepAfterGesture, presetsOf, useEffectiveText, useMixed, type FieldPart } from './field.tsx';
import { shownText } from '../../core/style/set.ts';
import { storedValue } from '../../core/style/stored.ts';
import { kindsOf } from '../../core/style/applies.ts';
import { storedPlace } from '../../core/style/grid-item.ts';
import { tracksOf } from '../../core/style/tracks.ts';
import { functionArgument, functionOfControl, translateAxis, translateWith } from '../../core/style/functions.ts';
import { GradientControl, isGradientControl } from './gradient.tsx';
import { ShadowControl, isShadowControl } from './shadow.tsx';
import { compactFieldValue, useFieldAppearance } from './field-face.tsx';
import { valuePresetsOf, ValuePresets } from './value-presets.tsx';
export interface Target {
  readonly id: string;
  readonly section: string;
  readonly labelKey: string;
  readonly control: string;
  readonly icons: Readonly<Record<string, string>>;
  readonly subsets: readonly { readonly id: string; readonly values: readonly string[] | null }[];
  // a composite's longhands, in its shorthand's order
  readonly longhands?: readonly string[];
}
export const TARGETS = new Map<string, Target>([

  ...manifest.properties.properties.map((p) => [p.id, p] as const),
  ...manifest.properties.composites.map((c) => [c.id, { ...c, icons: {} }] as const),
  ...manifest.properties.recipes.map((r) => [r.id, { ...r, icons: {}, subsets: [] }] as const),
]);
// The track editor's doors (manifest commands/style.json, style.setGridTracks): the track field, the add and the
// remove button, one of each per axis.
export const TRACK_DOORS: readonly DoorEntry[] = manifest.properties.properties.filter((p) => p.control === 'track-editor').flatMap((p) => p.doors.flatMap((ref) => manifest.doorByRef.get(ref as never) ?? []));
// the controls drawn as the text field of a style value (field.tsx TextStyleField): typed, Enter keeps it
const TEXT_CONTROLS: readonly string[] = ['keyword-menu', 'font-menu', 'text-field', 'number-field', 'slider', 'track-editor', 'transform-fields'];

export const targetOf = (entry: DoorEntry): Target | null => {
  const d = entry.door;
  if (d.kind !== 'inspector-field') return null;
  const id = d.property ?? d.composite ?? d.recipe;
  return id !== null ? (TARGETS.get(id) ?? null) : null;
};

// The section of the Style tab a door is drawn in (src/manifest/style-places.ts): the one of the property, composite
// or recipe its field edits, of the entry of properties.json that lists it (the grid's track editor, filed under
// grid-template-columns), or the one properties.json's controls gives a control that edits no property (the spacing
// link, the custom declarations); null for a control drawn above the sections. manifest:check proves every Style door
// has one.
const PLACE = styleSections(manifest.properties);
export const sectionOf = (entry: DoorEntry): string | null => PLACE(entry.ref, entry.door as StyleDoor) ?? null;

// The values a field offers in All properties: the generated list of its property and its presets.
function offered(entry: DoorEntry): readonly string[] {
  const offers = entry.door.adapter.offers;
  if (!offers) return [];
  const generated = offers.list === 'generated' ? (GENERATED_VALUES[offers.property as StyleTargetId]?.keywords ?? []) : [];
  return [...new Set([...generated, ...presetsOf(entry)])];
}

// A field's controls, disabled while its door is (not available yet, or its predicate does not hold).
function FieldInput({ entry, target, label, available }: { readonly entry: DoorEntry; readonly target: Target; readonly label: string; readonly available: boolean }) {
  const d = entry.door;
  const off = available ? '' : ' is-unavailable';
  const ariaDisabled = available ? undefined : true;
  // a field the door draws as a button (its drawnAs): an editor's action, or one fixed value (Spread writes
  // space-between)
  if (d.kind === 'inspector-field' && d.drawnAs === 'button') {
    return (
      <button type="button" className={`door door--button${off}`} aria-disabled={ariaDisabled} aria-label={label}>
        <span className="door__label">{typeof d.args.value === 'string' ? d.args.value : label}</span>
      </button>
    );
  }
  if (target.control === 'keyword-buttons' && entry.door.kind === 'inspector-field' && entry.door.control === 'field') {
    return (
      <span className="segmented segmented--values" role="group" aria-label={label}>
        {offered(entry).map((value) => {
          const icon = target.icons[value];
          return (
            <button key={value} type="button" className={`door door--segment${off}`} aria-disabled={ariaDisabled} title={value} aria-label={value}>
              {icon !== undefined ? <Icon name={icon} size="sm" /> : <span className="door__label">{value}</span>}
            </button>
          );
        })}
      </span>
    );
  }
  if (target.control === 'keyword-menu' || target.control === 'font-menu') {
    return (
      <button type="button" className={`select${off}`} aria-disabled={ariaDisabled} aria-label={label} aria-haspopup="listbox">
        <span className="select__value" />
        <Icon name={GLYPHS.dropdown} size="xs" />
      </button>
    );
  }
  return (
    <span className="input-wrap">
      {target.control === 'color-field' ? <span className="swatch" /> : null}
      <input className="input" disabled={!available} aria-label={label} />
    </span>
  );
}

// The label a door of the Style tab shows: one that carries only its command's label is labelled by its property,
// composite or recipe (the glossary's term, rule label-term), or, for an editor control, by the first property it
// writes; a button with a label of its own (Spread, Stretch) keeps it. Find a property matches it too.
export function fieldLabelKey(entry: DoorEntry): MessageId {
  if (entry.door.labelKey !== entry.command.labelKey) return entry.door.labelKey as MessageId;
  const named = targetOf(entry) ?? TARGETS.get(entry.door.adapter.writes[0] ?? '');
  return (named?.labelKey ?? entry.door.labelKey) as MessageId;
}

type FieldProps = { readonly entry: DoorEntry; readonly bare?: boolean; readonly labelled?: boolean; readonly prefix?: string | null; readonly rowLabel?: MessageId | null };

// A property's field, and, under the first field of a property or composite that offers ready-made values, their
// thumbnails (value-presets.tsx)
export function Field(props: FieldProps) {
  const t = useT();
  const target = targetOf(props.entry);
  const presented = target !== null && 'doors' in target && Array.isArray(target.doors) && target.doors[0] === props.entry.ref && valuePresetsOf(target.id).length > 0;
  if (!presented) return <FieldControl {...props} />;
  return (
    <>
      <FieldControl {...props} />
      <ValuePresets target={target.id} label={t(target.labelKey as MessageId)} />
    </>
  );
}

function FieldControl({ entry, bare = false, labelled = false, prefix = null, rowLabel = null }: FieldProps) {
  const t = useT();
  const target = targetOf(entry);
  // named as fieldLabelKey says, or by the shorter name its concept row gives a detail (rowLabel: under Border, "Top
  // width"): what a screen reader reads and its step buttons are named after ("Step Width up"). A pair row's first
  // field (bare) shows the row's own label (Size) where its label stands and keeps its own name, so no two controls
  // share one (the Size row's Width and the background's Size). A field is usable only once its own feature is
  // registered as built (archive/DESIGN.md "Build order"): style.set runs Width and Height long before Display or
  // Color.
  const own = entry.door.labelKey !== entry.command.labelKey;
  const door = useDoor(entry, {}, rowLabel !== null && !bare ? t(rowLabel) : target && !own ? t(fieldLabelKey(entry)) : undefined, isFeatureBuilt(entry.door.feature as FeatureId));
  const rowText = rowLabel === null || !bare ? null : t(rowLabel);
  if (!target) return null;
  const cssName = entry.door.kind === 'inspector-field' ? (entry.door.property ?? target.id) : target.id;
  // a composite of lengths (gap: row-gap and column-gap) is a text field of its longhands, one or two lengths
  if (target.control === 'length-field' && entry.door.kind === 'inspector-field' && entry.door.drawnAs === 'field' && entry.door.composite !== null && 'property' in entry.command.args) {
    return <TextStyleField entry={entry} door={door} property={entry.door.composite} longhands={target.longhands ?? null} label={door.label} rowText={rowText} bare={bare} labelled={labelled} prefix={prefix} />;
  }
  // the shadow editor's controls (shadow.tsx)
  if (isShadowControl(entry)) return <ShadowControl entry={entry} door={door} />;
  // the gradient editor's controls (gradient.tsx)
  if (isGradientControl(entry)) return <GradientControl entry={entry} door={door} />;
  // a field of a part of a value: a translate axis (Move X, Move Y), one function of a filter or a transform (Blur,
  // Skew X), by its door's control
  const part = partOfField(entry);
  if (part !== null && entry.door.kind === 'inspector-field' && entry.door.drawnAs === 'field' && entry.door.property !== null) {
    return <TextStyleField entry={entry} door={door} property={entry.door.property} longhands={null} label={door.label} part={part} />;
  }
  // a field drawn as a button that writes one fixed value (Stretch: align-items stretch; Spread: justify-content
  // space-between): its door, standing for that value
  if (entry.door.kind === 'inspector-field' && entry.door.drawnAs === 'button') {
    return (
      <div className={`field-row${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify(entry.door.args)} title={door.title}>
        <span className="field-row__label" />
        <button type="button" className={`door door--button${door.available ? '' : ' is-unavailable'}`} aria-disabled={door.available ? undefined : true} onClick={door.run}>
          <span className="door__label">{door.face}</span>
        </button>
      </div>
    );
  }
  // a length field is the field component: typing, units, steps and the scrub (spec inspector-number-fields)
  if (target.control === 'length-field' && entry.door.kind === 'inspector-field' && entry.door.property !== null) return <NumberField entry={entry} door={door} property={entry.door.property} label={door.label} rowText={rowText} bare={bare} labelled={labelled} prefix={prefix} />;
  // keyword buttons: one button per value the property offers (field.tsx)
  if (target.control === 'keyword-buttons' && entry.door.kind === 'inspector-field' && entry.door.control === 'field' && entry.door.property !== null && 'property' in entry.command.args) {
    return <KeywordButtons entry={entry} door={door} property={entry.door.property} values={offered(entry)} icons={target.icons} label={door.label} />;
  }
  // a keyword menu, a font menu, a text field, a number field, a slider or a track list of a property or composite: a
  // text field suggesting its keywords
  if (TEXT_CONTROLS.includes(target.control) && entry.door.kind === 'inspector-field' && entry.door.drawnAs === 'field' && 'property' in entry.command.args) {
    // a keyword menu or a font menu also draws the button that opens every value at once (A3.33)
    return <TextStyleField entry={entry} door={door} property={entry.door.property ?? target.id} longhands={entry.door.composite !== null ? (target.longhands ?? null) : null} label={door.label} values={target.control === 'keyword-menu' || target.control === 'font-menu'} bare={bare} labelled={labelled} prefix={prefix} />;
  }
  // a border or radius field: its own command (style.setBorder, style.setRadius), the same field; the typed text is
  // parted into the command's arguments (field.tsx)
  if ((target.control === 'border-editor' || target.control === 'radius-editor') && entry.door.kind === 'inspector-field' && entry.door.drawnAs === 'field') {
    const edited = entry.door.composite ?? entry.door.property ?? target.id;
    // A row whose value is a colour, whatever the command that types its text (the border's colour, outline-color):
    // its swatch opens the colour picker on that property, which writes it through the one writer of a property
    // (core/style/set.ts writePropertyText) — the composite landing on its longhands (A3.29, finding 57)
    return (
      <TextStyleField
        entry={entry}
        door={door}
        property={edited}
        longhands={entry.door.composite !== null ? (target.longhands ?? null) : null}
        label={door.label}
        ownCommand
        colour={isColourValue(edited)}
        bare={bare}
        labelled={labelled}
        prefix={prefix}
      />
    );
  }
  // an image field (the background image): its own command, the same field
  if (target.control === 'image-field' && entry.door.kind === 'inspector-field' && entry.door.drawnAs === 'field' && entry.door.property !== null && 'property' in entry.command.args) {
    return <TextStyleField entry={entry} door={door} property={entry.door.property} longhands={null} label={door.label} ownCommand />;
  }
  // a colour field: its swatch opens the colour picker (color.tsx), its text keeps a typed colour like a text field
  if (target.control === 'color-field' && entry.door.kind === 'inspector-field' && entry.door.drawnAs === 'field' && entry.door.property !== null && 'property' in entry.command.args) {
    return <TextStyleField entry={entry} door={door} property={entry.door.property} longhands={null} label={door.label} colour />;
  }
  return (
    <div className={`field-row${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} title={door.title}>
      <span className="field-row__label" title={cssName}>
        {door.label}
      </span>
      <FieldInput entry={entry} target={target} label={door.label} available={door.available} />
    </div>
  );
}

// The part of a value a field edits alone, by its door's control (manifest data): a translate axis (translate-x,
// translate-y: style.set with the whole translate, core/style/functions.ts translateWith), or one function of a filter
// or a transform (filter-blur, transform-skew-x: the door's command with that function's argument); null for any other.
function partOfField(entry: DoorEntry): FieldPart | null {
  if (entry.door.kind !== 'inspector-field' || entry.door.property === null) return null;
  const { control, property } = entry.door;
  const axis = ['translate-x', 'translate-y'].indexOf(control);
  if (axis >= 0) return { show: (held) => translateAxis(held, axis), args: (text, held) => ({ property, value: translateWith(held, axis, text) }) };
  const list = Object.entries(entry.command.args).find(([name, arg]) => name !== 'property' && arg.type === 'json')?.[0];
  if (list === undefined || !/^(filter|transform)-/.test(control)) return null;
  const name = functionOfControl(control);
  return { show: (held) => functionArgument(held, name), args: (text) => ({ property, [list]: { [name]: text } }) };
}

// A grid item's start or span (spec props-grid-container, the user's real-use audit, item A1.3): a whole number
// kept on Enter or on leaving the field, written with the item's own command (style.setGridItem), which reads the half
// the field leaves out from the value the element holds.
export function GridItemField({ entry, half }: { readonly entry: DoorEntry; readonly half: 'start' | 'span' }) {
  const store = useStore();
  const t = useT();
  const property = typeof entry.door.args.property === 'string' ? entry.door.args.property : '';
  // where the value comes from is read on the longhands the document stores (grid-column-start, grid-column-end)
  const appearance = useFieldAppearance(MODEL_RULES.compositeFacts.get(property)?.longhands ?? [property]);
  const place = (s: Parameters<typeof styleSource>[0]) => {
    const node = styleSource(s);
    return node ? storedPlace(node, property, layeredRules(s)) : null;
  };
  const start = useEditorState((s) => place(s)?.start ?? null);
  const span = useEditorState((s) => place(s)?.span ?? 1);
  const shown = half === 'start' ? (start === null ? '' : String(start)) : String(span);
  const door = useDoor(entry, {}, t(fieldLabelKey(entry)), isFeatureBuilt(entry.door.feature as FeatureId));
  const input = useRef<HTMLInputElement>(null);
  const draft = useRef(false);
  useEffect(() => {
    const element = input.current;
    if (element !== null && !draft.current) element.value = shown;
  }, [shown]);
  const keep = () => {
    const element = input.current;
    if (element === null || !draft.current) return;
    draft.current = false;
    const typed = element.value.trim();
    const number = /^-?\d+$/.test(typed) ? Number.parseInt(typed, 10) : Number.NaN;
    // what is no whole number is not kept: the field shows the element's value again
    if (!Number.isInteger(number)) {
      element.value = shown;
      return;
    }
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { property, [half]: number });
  };
  return (
    <form
      className="field-row"
      data-origin={appearance.kind}
      data-door={entry.ref}
      data-args={JSON.stringify({ property })}
      title={door.title}
      onSubmit={(event) => {
        event.preventDefault();
        keep();
      }}
    >
      <span className="field-row__label" title={t(entry.door.labelKey as MessageId)}>{t(entry.door.labelKey as MessageId)}</span>
      <input
        ref={input}
        className="input"
        type="text"
        role="spinbutton"
        inputMode="numeric"
        spellCheck={false}
        disabled={!door.available}
        aria-label={t(entry.door.labelKey as MessageId)}
        placeholder={half === 'start' ? (INITIAL_VALUES[`${property}-start`] ?? undefined) : undefined}
        onInput={() => { draft.current = true; }}
        onBlur={keep}
      />
    </form>
  );
}

// The grid's track editor (spec props-grid-container, Problems in Pager 3; the user's real-use audit, item A1.2): for
// a grid container's columns or rows, one field per track of the axis, each keeping its track in its place
// (style.setGridTracks), a count line, and the doors that add and remove a track. The raw value keeps its own field
// beside the editor.
export function GridTracks({ entry }: { readonly entry: DoorEntry }) {
  const t = useT();
  const locale = useLocale();
  // the axis the door edits (its own argument: a panel control carries no property of its own)
  const property = typeof entry.door.args.property === 'string' ? entry.door.args.property : '';
  // where the value comes from is read on the longhands the document stores (grid-column-start, grid-column-end)
  const appearance = useFieldAppearance(MODEL_RULES.compositeFacts.get(property)?.longhands ?? [property]);
  // the element's own tracks here, else the ones it inherits along the cascade (another breakpoint, a class): a
  // breakpoint that inherits two columns shows those two, with the origin its row says, never "0 tracks" (J10)
  const value = useEditorState((s) => {
    const node = styleSource(s);
    return node ? (storedValue(node, property, layeredRules(s)) ?? shownText(node, property, layeredRules(s))) : undefined;
  });
  const tracks = tracksOf(value);
  const control = (d: DoorEntry) => (d.door.kind === 'panel-control' ? d.door.control : null);
  const doors = TRACK_DOORS.filter((d) => String(d.door.args.property ?? '') === property);
  const field = doors.find((d) => control(d) === 'track-field');
  const add = doors.find((d) => control(d) === 'add-track');
  const remove = doors.find((d) => control(d) === 'remove-track');
  const primary = useEditorState((s) => s.selection[0] ?? null);
  return (
    <div className="grid-tracks" data-door={entry.ref} data-args={JSON.stringify({ property })}>
      {/* the axis named with its count, and the add and remove buttons in this header: they stay in place however many
          tracks the list holds (J10: the + moved after the first add, and the two lists were not named) */}
      <div className="field-row grid-tracks__header" data-origin={appearance.kind}>
        <span className="field-row__label">{propertyWord(t, property)}</span>
        <span className="grid-tracks__count">{t(`inspector.grid.trackCount.${pluralForm(locale, tracks.length)}`, { count: tracks.length })}</span>
        <span className="grid-tracks__buttons">
          {add ? <DoorControl entry={add} args={{ property, edit: { add: true } }} /> : null}
          {remove ? <DoorControl entry={remove} args={{ property, edit: { remove: true } }} /> : null}
        </span>
      </div>
      {tracks.map((track, index) => (
        <GridTrackField key={index} entry={field} property={property} index={index} track={track} available={primary !== null} />
      ))}
    </div>
  );
}

// One track of the editor: its text kept on Enter or on leaving the field, written by its place (style.setGridTracks).
function GridTrackField({ entry, property, index, track, available }: { readonly entry: DoorEntry | undefined; readonly property: string; readonly index: number; readonly track: string; readonly available: boolean }) {
  const store = useStore();
  const t = useT();
  const appearance = useFieldAppearance([property]);
  const door = useDoor(entry ?? (manifest.doors[0] as DoorEntry), {}, t('inspector.grid.track'), entry !== undefined && available);
  const input = useRef<HTMLInputElement>(null);
  const draft = useRef(false);
  useEffect(() => {
    const element = input.current;
    if (element !== null && !draft.current) element.value = track;
  }, [track]);
  const keep = () => {
    const element = input.current;
    if (element === null || !draft.current || entry === undefined) return;
    draft.current = false;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { property, track: index, value: element.value });
  };
  if (entry === undefined) return null;
  return (
    <form
      className="field-row"
      data-origin={appearance.kind}
      data-door={entry.ref}
      data-args={JSON.stringify({ property, track: index })}
      title={door.title}
      onSubmit={(event) => {
        event.preventDefault();
        keep();
      }}
    >
      <span className="field-row__label">{t('inspector.grid.track')}</span>
      <input
        ref={input}
        className="input"
        role="spinbutton"
        inputMode="numeric"
        aria-label={`${t('inspector.grid.track')} ${String(index + 1)}`}
        spellCheck={false}
        disabled={!door.available}
        onInput={() => { draft.current = true; }}
        onBlur={keep}
      />
    </form>
  );
}

// The sides of a box in the order a box composite lists its longhands (CSS Box 3: top, right, bottom, left), each named
// as CSS Logical Properties name it in a horizontal, top-to-bottom writing mode; the side argument of style.setSpacing.
const BOX_SIDES = ['block-start', 'inline-end', 'block-end', 'inline-start'] as const;
// the link of a box (inspector.toggleSpacingLink): the style region's control whose command takes a box and nothing
// else
export const SPACING_LINK = doorSlots('inspector-style').find((d) => d.door.kind === 'panel-control' && d.door.drawnAs === 'icon-button' && Object.keys(d.command.args).join() === 'box');

// A field of the box model (spec props-spacing): one side of a box, or, while the box is linked, its four sides. It
// shows the value the primary selected element holds (the four sides' when they agree, else nothing), else the value
// the page computes; it is the one field of a form of its own, so Enter submits it and keeps what it holds with its
// door's command (style.setSpacing, with its box and sides), as leaving it with typing not kept yet does (one undo
// step).
// the key context of a side of the box, whose Escape (field.cancel for the box: the form stands for it as `property`)
// puts back the value the document holds; the message it gives rewrites the side, so leaving it writes nothing (spec
// inspector-number-fields, Problems in Pager 4)
const SPACING_KEYS: KeyContextId = 'spacing-field';
function SpacingField({ entry, box, sides, properties, where, label }: { readonly entry: DoorEntry; readonly box: string; readonly sides: string; readonly properties: readonly string[]; readonly where: string; readonly label: string }) {
  const store = useStore();
  const door = useDoor(entry, { box, sides }, label, isFeatureBuilt(entry.door.feature as FeatureId));
  const primary = useEditorState((st) => st.selection[0] ?? null);
  const stored = useEditorState((st) => {
    const node = styleSource(st);
    if (!node) return undefined;
    const values = properties.map((p) => storedValue(node, p, layeredRules(st)));
    return values.some((v) => v === undefined) ? undefined : new Set(values).size === 1 ? values[0] : '';
  });
  // the document's value, else nothing; the effective value (one the sides share) is the placeholder (spec
  // inspector-provenance-reset, Problems in Pager 4)
  const effectiveSides = useEffectiveText(properties[0] ?? '', properties, stored !== undefined);
  const effective = new Set(effectiveSides.split(' ')).size === 1 ? effectiveSides : '';
  // several elements with different values, or four sides that differ: said Mixed, as every field says it (A3.35)
  const mixed = useMixed(properties) || stored === '';
  const appearance = useFieldAppearance(properties, mixed);
  const t = useT();
  const shown = mixed ? '' : (stored ?? '');
  const said = useEditorState((st) => st.message);
  const field = useRef<HTMLInputElement>(null);
  const typed = useRef(false);
  const command = entry.command.id;
  useEffect(() => {
    if (field.current === null) return;
    field.current.value = shown;
    typed.current = false;
  }, [shown, said]);
  const keep = () => {
    const element = field.current;
    if (element === null || !typed.current) return;
    typed.current = false;
    const value = element.value;
    keepAfterGesture(store, () => {
      if (store.getState().selection.length === 0) return;
      (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(command, { box, sides, value });
    });
  };
  return (
    <form
      className={`box__side box__side--${where}`}
      data-origin={appearance.kind}
      data-door={entry.ref}
      // a side stands for its longhand (its arrows step it: field.step, and Escape names it), the linked box for the
      // box
      data-args={JSON.stringify({ box, sides, property: properties.length === 1 ? properties[0] : box })}
      title={door.title}
      onSubmit={(event) => {
        event.preventDefault();
        keep();
      }}
    >
      <input
        ref={field}
        className="box__input"
        disabled={!door.available || primary === null}
        aria-label={door.label}
        spellCheck={false}
        placeholder={mixed ? t('inspector.mixedValue') : effective || undefined}
        onInput={() => {
          typed.current = true;
        }}
        onBlur={keep}
        data-key-context={SPACING_KEYS}
      />
      <span className="box__rest-value" aria-hidden="true">{mixed ? t('inspector.mixedValue') : compactFieldValue(shown || effective, true).value}</span>
    </form>
  );
}

// The innermost cell of the box model (archive/DESIGN.md "Sections", the design's centre): the selection's own measured
// size, in page pixels whatever the zoom — the number a person compares the Width and Height fields against — or, with
// several elements selected, how many there are. Nothing with nothing selected.
function BoxCore() {
  const t = useT();
  const count = useEditorState((s) => s.selection.length);
  const primary = useEditorState((s) => (s.selection.length === 1 ? (s.selection[0] ?? null) : null));
  const size = usePrimarySize(primary);
  const words = size !== null ? t('statusBar.size', { width: size.width, height: size.height }) : count > 1 ? t('inspector.elementCount', { count }) : '';
  return <span className="box__core">{words}</span>;
}

// The box model (archive/DESIGN.md "Sections": margin outside, padding inside): the composites drawn as a box model
// (properties.json control box-model), each a box around the next in their placement order, the first outermost. Each
// box has its label and its link (inspector.toggleSpacingLink); unlinked, a field on each side writes that side's
// longhand; linked, one field (the box's own door) writes its four sides. No property is named here.
// no box linked (one value, so the selector returns the same list while nothing changes)
const NO_LINKS: readonly string[] = [];
export function BoxModel({ doors }: { readonly doors: readonly DoorEntry[] }) {
  const t = useT();
  const boxes = doors.filter((d) => d.door.kind === 'inspector-field' && d.door.composite !== null);
  // the boxes linked for the element the tab edits (inspector/spacing.ts, J27), as one text so the selector's answer
  // stays the same while nothing changes
  const linkedText = useEditorState((st) => boxes.map((d) => targetOf(d)?.id ?? '').filter((id) => id !== '' && isLinked(st, id, layeredRules(st))).join(' '));
  const links = linkedText === '' ? NO_LINKS : linkedText.split(' ');
  const sideField = (css: string | undefined) => doors.find((d) => d.door.kind === 'inspector-field' && d.door.property === css);
  const draw = (level: number): ReactNode => {
    const box = boxes[level];
    const target = box ? targetOf(box) : null;
    if (!box || !target) return <BoxCore />;
    const linked = (links as readonly string[]).includes(target.id);
    const longhands = target.longhands ?? [];
    const side = (where: (typeof BOX_SIDES)[number]) => {
      const index = BOX_SIDES.indexOf(where);
      const css = longhands[index];
      const entry = sideField(css);
      const label = css !== undefined ? TARGETS.get(css)?.labelKey : undefined;
      // the side a longhand is: its name after the box's (padding-top: top), a value of style.setSpacing's sides
      return entry && css ? <SpacingField key={entry.ref} entry={entry} box={target.id} sides={css.slice(target.id.length + 1)} properties={[css]} where={where} label={label !== undefined ? t(label as MessageId) : css} /> : null;
    };
    return (
      <div className={`box box--${target.id}${linked ? ' is-linked' : ''}`}>
        {/* the box's label stands for its composite door while the box is unlinked; linked, the four sides' field
           does */}
        <span className="box__label" data-door={linked ? undefined : box.ref} data-args={linked ? undefined : JSON.stringify({ box: target.id, sides: 'all' })}>
          {t(target.labelKey as MessageId)}
        </span>
        {/* its own name: "Link the four sides of Margin", "… of Padding" (A3.35) */}
        {SPACING_LINK ? <DoorControl entry={SPACING_LINK} args={{ box: target.id }} className="box__link" label={t('inspector.spacing.linkBox', { box: { key: target.labelKey as MessageId } })} /> : null}
        {/* the grid places each side; the document order is the Tab's: a box's four sides clockwise from the top, then
            the box inside it (the audit's S-014: margin top and left, the padding, then margin right and bottom) */}
        {linked ? (
          <SpacingField entry={box} box={target.id} sides="all" properties={longhands} where="all" label={t(target.labelKey as MessageId)} />
        ) : (
          <>
            {side('block-start')}
            {side('inline-end')}
            {side('block-end')}
            {side('inline-start')}
          </>
        )}
        {draw(level + 1)}
      </div>
    );
  };
  return draw(0);
}

export const ANCHOR_CONTROL = 'anchor-control';
// the rows follow position.setAnchors's edges in the manifest's order: left, right, top, bottom, the two centres, the
// two stretches; a door's label is its edge's (command.anchor.<edge in camel case>)
const camel = (edge: string) => edge.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
function anchorRows(entry: DoorEntry): readonly (readonly string[])[] {
  const [left = '', right = '', top = '', bottom = '', horizontalCenter = '', verticalCenter = '', horizontalStretch = '', verticalStretch = ''] = entry.command.args.edge?.values ?? [];
  return [
    [left, horizontalCenter, right, horizontalStretch],
    [top, verticalCenter, bottom, verticalStretch],
  ];
}
// The arrow each anchor edge wears: the manifest's door for the control is one entry drawn once per edge, so the
// face has to come from the edge itself — and the edges' own names ("at the horizontal centre") are longer than the
// 38 px cell. The icons the panel already draws elsewhere (the direction arrows) say it at a glance. (A door drawn
// as an area has no face at all: the anchors used to be eight invisible boxes.)
const EDGE_ICONS: Readonly<Record<string, string>> = {
  left: 'arrow-left-to-line',
  'horizontal-center': 'align-center-horizontal',
  right: 'arrow-right-to-line',
  'horizontal-stretch': 'arrow-left-right',
  top: 'arrow-up-to-line',
  'vertical-center': 'align-center-vertical',
  bottom: 'arrow-down-to-line',
  'vertical-stretch': 'chevrons-up-down',
};

// The anchor control (spec absolute-anchors, Problems in Pager 2): per axis, the start edge, the centre, the end edge
// and both edges, each the control's door standing for that edge set (position.setAnchors, mode set), the anchors held
// drawn pressed; disabled while the selection is not positioned.
export function AnchorControl({ entry }: { readonly entry: DoorEntry }) {
  const t = useT();
  const ready = isFeatureBuilt(entry.door.feature as FeatureId);
  return (
    <div className="field-row anchor-control" role="group" aria-label={t('anchors.title')}>
      <span className="field-row__label">{t('anchors.title')}</span>
      <div className="anchor-control__rows">
        {anchorRows(entry).map((row, i) => (
          <div key={i} className="segmented segmented--wide">
            {row.map((edge) => (
              <DoorControl key={edge} entry={entry} args={{ edge, mode: 'set' }} label={t(`command.anchor.${camel(edge)}` as MessageId)} className="anchor-control__item" ready={ready}>
                {EDGE_ICONS[edge] === undefined ? undefined : <Icon name={EDGE_ICONS[edge] as Parameters<typeof Icon>[0]['name']} size="xs" />}
              </DoorControl>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// The kinds of element every selected element is of (core/style/applies.ts), as one text so the hook's answer is
// stable.
export const useSelectionKinds = (): readonly string[] =>
  useEditorState((s) => kindsOf(s.selection.flatMap((id) => locate(s.document, id)?.node ?? []), MODEL_RULES).join(' '))
    .split(' ')
    .filter((kind) => kind !== '');

// The field component (archive/DESIGN.md "Component regions": `field`, its parts in order: 1 unit menu, 2 step up, 3
// step down, 4 reset this value; spec inspector-number-fields): a number or length field of the inspector, drawn for
// the inspector-field door of its property (style.set). Every part is a door of the `field` region, in its order.
//  - The field shows the value the primary selected element holds for the property at the base breakpoint and state,
//    else the value the page computes for it (a field never shows a blank, archive/DESIGN.md "Inspector"). Typing
//    changes only the field; it shows the document's value again after every message (Enter kept the value or was
//    refused, Escape put it back, another command ran) and whenever that value changes.
//  - Its input names the key context `number-field` (interactions.json), whose doors are Enter (style.set keeps what
//    the field holds), Escape (field.cancel), ArrowUp/ArrowDown with Shift and Alt and PageUp/PageDown (field.step):
//    the keymap hands them the field's property and the text it holds; any other key (Delete, Backspace, letters,
//    pending text undo) stays the input's own. Confirmed values forward undo/redo to document history via keymap.
//  - Leaving the field with typing not kept yet (Tab, a click elsewhere, a step button, the unit menu, the label's
//    scrub) keeps it: one undo step, before whatever the press does.
//  - Its label is the scrub handle (the panel drag field.scrub#…, run by the pointer owner,
//    src/editor/input/pointer.ts, which reads the text of the field marked data-number-field at the press).
//  - The step buttons run field.step with the text the field holds and the key the click holds (Shift ×10, Alt ×0.1).
//  - The unit menu lists the units and keywords the property offers (the generated lists, All properties) and runs
//    field.setUnit with the one chosen; like any menu it closes on a dismissal (Escape, its backdrop).
// A field whose door is not available (its feature not registered yet, or nothing selected) draws every part disabled.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { DispatchResult } from '../../core/store/store.ts';
import { locate, type DocNode, type NodeId } from '../../core/document/model.ts';
import { DEFAULT_UNIT, codecOf } from '../../core/style/codecs.ts';
import { borderArgs } from '../../core/style/border.ts';
import { composedText, lineStyles, propertyName, shownText } from '../../core/style/set.ts';
import { storedLayers, storedValue } from '../../core/style/stored.ts';
import type { AttributeId, CommandId, FeatureId, KeyContextId, MessageId, StyleTargetId } from '../../generated/ids.ts';
import type { CommandArgs } from '../../generated/commands.ts';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { droppedInputAttributes } from '../../core/elements/inputs.ts';
import { imageFiles } from '../../core/files/files.ts';
import { holdsExecutableCode } from '../../core/elements/embed.ts';
import { equivalentTags } from '../../core/elements/tag.ts';
import { elementPredicate, type ElementContext } from '../../core/style/applies.ts';
import { ATTRIBUTES, inputValueEditorOf } from '../inspector/attributes.ts';
import { editedProperties, inspectorMode } from '../inspector/sections.ts';
import { useSettingsRefusal } from '../inspector/attribute-feedback.ts';
import { GENERATED_VALUES, INITIAL_VALUES } from '../../generated/value-lists.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { computedValues } from '../canvas/coordinates.ts';
import { DoorControl, Icon, useDoor, type DoorState } from '../doors/door.tsx';
import { GLYPHS, doorSlots } from '../doors/placement.ts';
import { quickPanelOpen } from '../quick-panel/quick-panel.ts';
import { unitMenu } from '../../core/style/units.ts';
import { cssFamily, familyOf, isFontFile } from '../../core/files/fonts.ts';
import { afterGesture, registerRepeat, registerSlider } from '../input/pointer.ts';
import { wheelStep } from '../input/wheel-step.ts';
import { pointerViews } from '../input/pointer/views.ts';
import { MODEL_RULES, useEditorState, useStore, type EditorState, type EditorStore, layeredRules } from '../store.ts';
import { styleClassOf, styleSource } from '../inspector/style-target.ts';
import { useMenuLayer } from '../doors/menu.tsx';
import { useT, useValueLabel } from '../text.ts';
import { createToken, tokenKindOf, tokensOf } from '../../core/design/tokens.ts';
import { compactFieldValue, FieldOriginBadge, FieldValueSlot, useFieldAppearance } from './field-face.tsx';
import { restoreFieldDraft } from '../persistence/drafts.ts';
import { DRAFT_KEPT, markFieldKept, recordFieldInput } from '../input/drafts.ts';
// A cleared status is still a change for a field with typing pending; one stable value keeps the store snapshot pure.
const CLEARED_MESSAGE = Symbol('cleared field message');
import { floatBelow, type Placed } from './float.ts';
import { onPageChange } from '../canvas/page-clock.ts';
import { VariableSuggestions } from './variable-suggestions.tsx';

// the key context a number field's input names (interactions.json)
const NUMBER_FIELD_CONTEXT: KeyContextId = 'number-field';
// the key context of a field its own command keeps (a border, a background image: its form submits on Enter), whose
// Escape puts the document's value back (interactions.json command-field)
const COMMAND_FIELD_CONTEXT: KeyContextId = 'command-field';
// the command a number field's Enter keeps its text with (its shortcut door in the number field's key context); a
// field of another command keeps it with its own form (TextStyleField ownCommand)
const FIELD_ENTER = manifest.doors.find((d) => d.door.kind === 'shortcut' && d.door.context === NUMBER_FIELD_CONTEXT && d.door.chord === 'Enter')?.command.id ?? null;
export const keptByFieldEnter = (entry: DoorEntry): boolean => entry.command.id === FIELD_ENTER;
// the parts of the field component, in their order (layout.json region `field`): a number field's, and the swatch of
// a colour field, which opens the colour picker (color.tsx)
export const COLOR_SWATCH = doorSlots('field').find((p) => p.door.kind === 'panel-control' && p.door.control === 'color-swatch');
// the part that takes the field's value away (style.reset)
const RESET = doorSlots('field').find((p) => p.door.kind === 'panel-control' && p.door.control === 'property-reset');
// The parts a number field draws, in their order (archive/DESIGN.md "Component regions": the `field` row is 1 unit menu
// · 2 step up · 3 step down · 4 reset this value). The region also carries the doors other components draw beside a
// field — the colour swatch (a colour field, color.tsx) and the choose buttons of a field that names a file or a
// link (inspector.tsx) — and those are no parts of it: drawing them here put a stray item button inside every field.
// the parts a number field draws (spec inspector-number-fields, Problem 5): its unit menu, its step buttons (shown
// while it is hovered or holds the focus, so they take no room from its value at rest) and its Reset
const STEP_CONTROLS = new Set(['step-up', 'step-down']);
const PART_CONTROLS = new Set(['unit-menu', ...STEP_CONTROLS, 'property-reset']);
const PARTS = doorSlots('field').filter((p) => p.door.kind === 'panel-control' && PART_CONTROLS.has(p.door.control));
// the label's scrub: the panel drag pressed on a field's label
const SCRUB = manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'field-label') ?? null;
// the codec of a list of font families (properties.json: the font menu's property)
const FAMILY_CODEC = 'font-family-list';

// A field's values menu (the audit's J15: drawn inside the inspector, a long font list was cut by the panel's edge):
// a layer on the body, under the field's value cell (float.ts, as every floating layer), inside the window.
function FieldMenu({ anchor, list, label, children }: { readonly anchor: RefObject<HTMLElement | null>; readonly list: RefObject<HTMLDivElement | null>; readonly label: string; readonly children: ReactNode }) {
  const [at, setAt] = useState<Placed | null>(null);
  useLayoutEffect(() => {
    const from = anchor.current?.getBoundingClientRect();
    const panel = list.current;
    if (from === undefined || panel === null) return;
    const style = getComputedStyle(panel);
    const edge = parseFloat(style.getPropertyValue('--space-4')) || 0;
    const { width, height } = panel.getBoundingClientRect();
    setAt(floatBelow(from, { width, height }, { width: window.innerWidth, height: window.innerHeight }, edge));
  }, [anchor, list]);
  // unplaced for its first frame it is transparent, not hidden: the layer puts the focus in its first item then, and a
  // hidden item takes no focus (Escape then went to another key context and closed nothing)
  const style: CSSProperties = at === null ? { opacity: 0, left: 0, top: 0 } : { left: at.left, top: at.top };
  return createPortal(
    <div className="menu field__menu field__menu--floating" role="menu" ref={list} aria-label={label} data-key-context="menu" style={style}>
      {children}
    </div>,
    document.body,
  );
}

// The wheel over a field that holds the focus (the plan's stage 3, "setas e arrasto"): each notch runs the field's own
// ArrowUp or ArrowDown door (field.step), Shift ×10 and Alt ×0.1 as with the keys; a field without the focus lets the
// panel scroll. The doors are the number field's step keys (interactions.json number-field context).
const WHEEL_STEPS = manifest.doors.filter((d) => d.door.kind === 'shortcut' && typeof d.door.args.direction === 'string' && d.door.context === NUMBER_FIELD_CONTEXT && d.door.args.size === 'step');
function useWheelSteps(input: RefObject<HTMLInputElement | null>, property: string, store: EditorStore): void {
  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      const direction = document.activeElement === element ? wheelStep(event) : null;
      if (direction === null) return;
      const door = WHEEL_STEPS.find((d) => d.door.args.direction === direction);
      if (door === undefined) return;
      event.preventDefault();
      const modifier = event.shiftKey ? 'Shift' : event.altKey ? 'Alt' : undefined;
      (store.dispatch as Dispatch)(door.command.id as CommandId, { ...door.door.args, property, value: element.value, ...(modifier === undefined ? {} : { modifier }) });
    };
    // not passive: the wheel steps the value instead of scrolling the panel
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [input, property, store]);
}

// The values the page computes for a node (coordinates.ts computedValues). The page changes after the store does (the
// renderer applies each change) and loads after the inspector is drawn, so the values are read whenever the page may
// have changed (the page clock, canvas/page-clock.ts): a measure of the page, not editor state.
export function usePageValues(node: NodeId | null, properties: readonly string[]): Readonly<Record<string, string>> | null {
  const [read, setRead] = useState<{ readonly node: NodeId; readonly values: Readonly<Record<string, string>> | null } | null>(null);
  useEffect(() => {
    if (node === null || properties.length === 0) return;
    let request = 0;
    let last: string | null = null;
    const measure = () => {
      const values = computedValues(node, properties, lineStyles(MODEL_RULES));
      const text = JSON.stringify(values);
      if (text !== last) {
        last = text;
        setRead({ node, values });
      }
    };
    // once now, then whenever the page may have changed (canvas/page-clock.ts), never at every frame
    request = requestAnimationFrame(measure);
    const stop = onPageChange(measure);
    return () => {
      cancelAnimationFrame(request);
      stop();
    };
  }, [node, properties]);
  return read !== null && read.node === node ? read.values : null;
}

// The refusal of the field's own command, said beside the field (spec inspector-number-fields, Problems in Pager 3):
// the store's last refusal when it was the field's command asked for the field's property, in a short text (what was
// typed, quoted once), until the field is typed in again.
function useFieldRefusal(command: CommandId, property: string): { readonly text: string | null; readonly dismiss: () => void } {
  const t = useT();
  const refusal = useEditorState((s) => {
    const r = s.refusal;
    if (!r || r.command !== command) return null;
    const args = r.args as { readonly property?: unknown } | null;
    return args !== null && typeof args === 'object' && args.property === property ? r : null;
  });
  const [dismissed, setDismissed] = useState<unknown>(null);
  if (refusal === null || refusal === dismissed) return { text: null, dismiss: () => undefined };
  const said = refusal.message;
  const text = said.key === 'status.value.invalid' && typeof said.params.value === 'string' ? t('field.invalid', { value: said.params.value }) : t(said.key, said.params);
  return { text, dismiss: () => setDismissed(refusal) };
}

// The effective value a field's placeholder shows while the element holds none of its own at the edited target,
// breakpoint and state (spec inspector-provenance-reset, Problems in Pager 4): the value the document gives it along
// the cascade (another breakpoint or state), else what the page computes (inherited or the default), composed as a
// value is (composedText). Nothing while the element holds its own.
export function useEffectiveText(property: string, parts: readonly string[], own: boolean): string {
  const primary = useEditorState((s) => s.selection[0] ?? null);
  const cascaded = useEditorState((s) => {
    const node = own ? null : styleSource(s);
    if (!node) return undefined;
    const values = parts.map((p) => shownText(node, p, layeredRules(s)));
    return values.every((v) => v === undefined) ? undefined : composedText(property, values.map((v) => v ?? ''), MODEL_RULES);
  });
  const computed = usePageValues(own || cascaded !== undefined ? null : primary, parts);
  if (own) return '';
  if (cascaded !== undefined) return cascaded;
  const shown = computed === null ? '' : composedText(property, parts.map((p) => computed[p] ?? ''), MODEL_RULES);
  // what the page computes nothing for (Chrome reads no line-clamp) shows the property's initial value: an empty field
  // read as a missing value (the user's review of 2026-10-05)
  return shown === '' && computed !== null ? (INITIAL_VALUES[property] ?? '') : shown;
}

// Whether the selected elements show different values of these properties (spec multi-select-edit, Problems in Pager
// 2): an element's value is the one it declares at the base breakpoint and state, else the one the page computes; a
// field is mixed when any selected element's differs from the primary's. One element is never mixed. The values the
// page computes are read at every frame while several elements are selected, as usePageValues reads them.
// Whether any selected element holds a value of its own of these properties (the user's real-use audit, A3.35): Reset
// this value is drawn then, and takes the value away from every selected element that holds one, in one step
// (style.reset). With a class as the style target, the class is the one holder.
function useAnyStored(properties: readonly string[]): boolean {
  return useEditorState((s) => {
    const rules = layeredRules(s);
    const holds = (node: DocNode | null | undefined) => node != null && properties.some((p) => storedValue(node, p, rules) !== undefined);
    if (styleClassOf(s) !== null || s.selection.length < 2) return holds(styleSource(s));
    return s.selection.some((id) => holds(locate(s.document, id)?.node));
  });
}

export function useMixed(properties: readonly string[]): boolean {
  const selection = useEditorState((s) => s.selection);
  const storedText = useEditorState((s) =>
    s.selection.length < 2
      ? '[]'
      : JSON.stringify(
          s.selection.map((id) => {
            const node = locate(s.document, id)?.node;
            return node ? properties.map((p) => storedValue(node, p, layeredRules(s)) ?? null) : null;
          }),
        ),
  );
  const [read, setRead] = useState<{ readonly selection: readonly NodeId[]; readonly text: string } | null>(null);
  // one class as the style target: the elements share its one value (spec shared-style-classes)
  const classTargeted = useEditorState((s) => styleClassOf(s) !== null);
  useEffect(() => {
    if (selection.length < 2) return;
    let request = 0;
    let last: string | null = null;
    const measure = () => {
      const text = JSON.stringify(selection.map((id) => computedValues(id, properties, lineStyles(MODEL_RULES))));
      if (text !== last) {
        last = text;
        setRead({ selection, text });
      }
    };
    // once now, then whenever the page may have changed (canvas/page-clock.ts), never at every frame
    request = requestAnimationFrame(measure);
    const stop = onPageChange(measure);
    return () => {
      cancelAnimationFrame(request);
      stop();
    };
  }, [selection, properties]);
  if (selection.length < 2 || classTargeted) return false;
  const stored = JSON.parse(storedText) as ((string | null)[] | null)[];
  const page = read !== null && read.selection === selection ? (JSON.parse(read.text) as (Record<string, string> | null)[]) : [];
  const shown = stored.map((values, i) => JSON.stringify(properties.map((p, j) => values?.[j] ?? page[i]?.[p] ?? '')));
  return shown.some((value) => value !== shown[0]);
}

// The design tokens a field of a property offers next to typed values (spec css-variables-tokens, Problems in Pager 4):
// the project's variables of the kind the property takes, as var(--name).
const TOKEN_KINDS: readonly string[] = manifest.commandById.get(createToken.command)?.args.kind?.values ?? [];
export function useTokenSuggestions(property: string): readonly string[] {
  const text = useEditorState((s) => {
    const kind = tokenKindOf(property, TOKEN_KINDS, MODEL_RULES);
    return kind === null ? '' : tokensOf(s.document).filter((t) => t.kind === kind).map((t) => `var(--${t.name})`).join('\n');
  });
  return useMemo(() => (text === '' ? [] : text.split('\n')), [text]);
}

type Dispatch = (id: CommandId, args: unknown) => DispatchResult;

// A step button (field.step, the plan's stage 3): a press steps the text the field holds by one, by ten with Shift and
// by a tenth with Alt (the command reads the modifier); held down, it steps again and again, the pointer owner's
// press-and-hold (input/pointer.ts registerRepeat), and the whole hold is one undo step (the command coalesces steps
// within numberField.stepBurstWindow). The press keeps the focus where it is, so a field being typed in keeps its
// text; the keys step the field itself, so the button is no Tab stop.
// a step button's name says the field it steps ("Step Width up"): every field draws its own pair, and two controls of
// the Style tab never share a name (accessibility-audit.spec.ts)
const STEP_NAMES: Readonly<Record<string, MessageId>> = { 'field.stepUp': 'field.stepUp.of', 'field.stepDown': 'field.stepDown.of' };
function StepButton({ entry, property, shown, input, ready }: { readonly entry: DoorEntry; readonly property: string; readonly shown: string; readonly input: RefObject<HTMLInputElement | null>; readonly ready: boolean }) {
  const t = useT();
  const store = useStore();
  const door = useDoor(entry, { property }, undefined, ready);
  const button = useRef<HTMLButtonElement>(null);
  const available = door.available;
  useEffect(() => {
    const element = button.current;
    if (element === null || !available) return;
    return registerRepeat(element, (modifier) => {
      const held = modifier !== null && entry.command.args.modifier?.values.includes(modifier) === true ? { modifier } : {};
      (store.dispatch as Dispatch)(entry.command.id, { ...entry.door.args, property, value: input.current?.value || shown, ...held });
    });
  }, [store, entry, property, shown, input, available]);
  return (
    <button
      ref={button}
      type="button"
      className={`field__step${available ? '' : ' is-unavailable'}`}
      data-door={entry.ref}
      data-args={JSON.stringify({ property, value: shown })}
      data-repeat=""
      tabIndex={-1}
      aria-label={STEP_NAMES[entry.door.labelKey] === undefined ? door.label : t(STEP_NAMES[entry.door.labelKey] as MessageId, { property: propertyWord(t, property) })}
      title={door.title}
      aria-disabled={available ? undefined : true}
    >
      {entry.door.icon !== null ? <Icon name={entry.door.icon} size="xs" /> : null}
    </button>
  );
}

// The project's fonts (the manifest's custom-fonts; core/files/fonts.ts): the families the font menu offers above the
// system stacks, each drawn in its own face (the menu previews a value by the family it names).
function useProjectFontFamilies(): readonly string[] {
  const files = useEditorState((s) => s.document.files);
  return useMemo(() => (files ?? []).filter(isFontFile).map(familyOf), [files]);
}

// The units and keywords the unit menu offers for a property (its generated lists), and the one the value shows.
// the items the menu shows: the common units the property offers, and (behind More units) the rest of its units
// and its keywords (values the field itself suggests; src/core/style/units.ts owns the list)
function unitsOf(property: string): { readonly common: readonly string[]; readonly more: readonly string[] } {
  const offered = GENERATED_VALUES[property as StyleTargetId];
  const units = offered?.units ?? [];
  const { common, more } = unitMenu(units);
  return { common, more: [...more, ...(offered?.keywords ?? [])] };
}
function unitShown(property: string, text: string): string {
  const offered = GENERATED_VALUES[property as StyleTargetId];
  const codec = codecOf(MODEL_RULES.propertyFacts.get(property)?.codec ?? '');
  const value = codec?.read(text, { units: offered?.units ?? [], keywords: offered?.keywords ?? [], defaultUnit: DEFAULT_UNIT }) ?? null;
  return value?.kind === 'length' ? value.unit : value?.kind === 'keyword' ? value.keyword : '';
}

// The unit menu: its button shows the unit (or keyword) of the value, and opens the list of what the property offers;
// an item runs field.setUnit with the text the field holds. It closes when a dismissal newer than its opening arrives.
// The word a control names its property by (the reset and the unit button): the catalogue text of the property.
export function propertyWord(t: ReturnType<typeof useT>, property: string): string {
  const said = propertyName(property, MODEL_RULES);
  if (typeof said === 'string') return said;
  if (typeof said === 'number') return String(said);
  return 'key' in said ? t(said.key) : '';
}
// The values the field suggests (the project's variables of its kind, the presets its door declares: Height's Screen
// height) head the unit menu, each named as the catalogue names it and written with the field's own door: a number
// field draws no datalist, whose arrow Chrome reserved inside a narrow value until it took no typed character at all (a
// pair's Height kept "").
interface Suggestions {
  readonly field: DoorEntry;
  readonly values: readonly string[];
  readonly labelOf: (value: string) => string;
  readonly keep: (value: string) => void;
}
function UnitMenu({ entry, property, shown, input, ready, suggestions }: {
  readonly entry: DoorEntry;
  readonly property: string;
  readonly shown: string;
  readonly input: { readonly current: HTMLInputElement | null };
  readonly ready: boolean;
  readonly suggestions: Suggestions
}) {
  const store = useStore();
  const t = useT();
  const door = useDoor(entry, { property }, undefined, ready);
  // the same layer owner the menu buttons and the values menu stand on (doors/menu.tsx)
  const unitButton = useRef<HTMLButtonElement>(null);
  const unitList = useRef<HTMLDivElement>(null);
  const layer = useMenuLayer(unitButton, unitList);
  // the rest of the units and the keywords are drawn only while the menu is expanded (More units)
  const [expanded, setExpanded] = useState(false);
  const open = layer.open && door.available;
  const list = useRef<HTMLDivElement>(null);
  const current = unitShown(property, shown);
  const menu = unitsOf(property);
  const shownUnits = expanded ? [...menu.common, ...menu.more] : menu.common;
  const more = menu.more;
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [open]);
  const choose = (unit: string) => {
    layer.close();
    (store.dispatch as Dispatch)(entry.command.id, { ...entry.door.args, property, value: input.current?.value || shown, unit });
    input.current?.focus();
  };
  return (
    <span className="menu-anchor field__unit">
      <button
        ref={unitButton}
        type="button"
        className="field__unit-button"
        data-door={entry.ref}
        data-args={JSON.stringify({ property, value: shown })}
        aria-haspopup="menu"
        aria-expanded={layer.open}
        aria-label={t('field.unit.of', { property: propertyWord(t, property) })}
        title={door.title}
        aria-disabled={door.available ? undefined : true}
        onClick={() => {
          if (door.available) layer.toggle();
        }}
      >
        {/* a keyword is shown by the field itself: the button then shows only its menu's glyph, leaving the field
           its room */}
        <span className="field__unit-value">{current === shown.trim() ? '' : current}</span>
        <Icon name={GLYPHS.dropdown} size="xs" />
      </button>

      {open ? (
        <div className="menu field__menu" role="menu" ref={(element) => { list.current = element;
          unitList.current = element;
        }} aria-label={door.label} data-key-context="menu">
          {suggestions.values.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitem"
              className="menu__item"
              data-door={suggestions.field.ref}
              data-args={JSON.stringify({ property, value })}
              onClick={() => {
                layer.close();
                suggestions.keep(value);
                input.current?.focus();
              }}
            >
              <span className="menu__icon" />
              <span className="menu__label">{suggestions.labelOf(value) === value ? value : `${suggestions.labelOf(value)} · ${value}`}</span>
            </button>
          ))}
          {suggestions.values.length > 0 ? <div className="menu__separator" role="separator" /> : null}
          {shownUnits.map((unit) => (
            <button
              key={unit}
              type="button"
              role="menuitemradio"
              aria-checked={unit === current}
              className="menu__item"
              data-door={entry.ref}
              data-args={JSON.stringify({ property, value: shown, unit })}
              onClick={() => choose(unit)}
            >
              <span className="menu__icon">{unit === current ? <Icon name={GLYPHS.checked} size="sm" /> : null}</span>
              {/* the menu's own label: the field's unit slot (field__unit-value) hides while the field holds the focus, and the
                  menu opens from that focus (the audit's S-017: every unit was blank) */}
              <span className="menu__label field__unit-option">{unit}</span>
            </button>
          ))}
          {/* the rest of the units and the keywords wait behind it (the user's real-use audit, item 5.2): the list a
              person opens stays short */}
          {more.length > 0 ? (
            <button
              type="button"
              className="menu__item"
              data-menu-more=""
              aria-label={t(expanded ? 'field.unit.fewer' : 'field.unit.more')}
              onClick={() => setExpanded(!expanded)}
            >
              <span className="menu__icon">{expanded ? <Icon name={GLYPHS.collapsed} size="sm" /> : null}</span>
              <span className="menu__label">{t(expanded ? 'field.unit.fewer' : 'field.unit.more')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

// The values a field's door offers besides its property's keywords: its presets (the properties.json subset its door's
// offers name: the counter styles list-style-type's menu offers).
const SUBSETS = new Map([...manifest.properties.properties, ...manifest.properties.composites].map((p) => [p.id, p.subsets] as const));
export function presetsOf(entry: DoorEntry): readonly string[] {
  const offers = entry.door.adapter.offers;
  if (!offers || offers.presets === null) return [];
  return SUBSETS.get(offers.property)?.find((s) => s.id === offers.presets)?.values ?? [];
}

// The values a field's door offers in Essentials only (its offers' essentials: the Display menu's nine of the 22 the
// browser takes), or null when it offers the same values in both modes. All properties lists them first and the rest
// behind More values (the audit's S-027: the menu listed the 22 raw keywords).
function essentialsOf(entry: DoorEntry): readonly string[] | null {
  const offers = entry.door.adapter.offers;
  if (!offers || offers.essentials === null) return null;
  return SUBSETS.get(offers.property)?.find((s) => s.id === offers.essentials)?.values ?? null;
}

// The arguments a field whose door is a command of its own runs it with: its door's (a border field's sides), the
// property it edits and the text typed as the command takes them (the background image: property and value; a
// radius: the value; a border: its width, style and colour, parted by core/style/border.ts).
function ownArgs(entry: DoorEntry, property: string, text: string, extra: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const takes = entry.command.args;
  return { ...entry.door.args, ...extra, ...('property' in takes ? { property } : {}), ...('value' in takes ? { value: text } : borderArgs(property, text, MODEL_RULES)) };
}

// The field the inspector was asked to show (inspector.reveal, the Add a property list) takes the focus: the field of
// that property, or the one editor that edits it — the border and the radius draw one field for their longhands, and a
// person who asked for border-top-color is answered by the border editor that holds it.
function useRevealed(property: string, input: { readonly current: HTMLInputElement | null }): void {
  const revealed = useEditorState((s) => s.ui.revealed);
  useEffect(() => {
    if (revealed !== undefined && (revealed.field === property || editedProperties(property).includes(revealed.field))) input.current?.focus();
  }, [revealed, property, input]);
}

// The number and the unit the shown text carries ("24px" -> 24 and "px"; "0.35" -> 0.35 and the fallback), for the
// slider a door declares (the user's real-use audit, item A3.30); null while the text is no number a slider can read
// (a keyword, a var(), a calc()): the slider is disabled and says so.
const SLIDER_NUMBER = /^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]*)$/i;
function slidNumber(text: string, fallbackUnit: string): { readonly value: number; readonly unit: string } | null {
  const match = SLIDER_NUMBER.exec(text.trim());
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (match[2] ?? '') === '' ? fallbackUnit : (match[2] as string) };
}

// What a slider stands on: the number the text holds, else — a value with no number to slide, a filter function absent
// — the neutral the slider declares, else nothing (the slider is then disabled)
function slidValue(text: string, range: { readonly unit: string; readonly neutral?: number | undefined }): { readonly value: number; readonly unit: string } | null {
  return slidNumber(text, range.unit) ?? (range.neutral === undefined ? null : { value: range.neutral, unit: range.unit });
}

// Keeps what a field holds with its door's command (style.set), once no gesture is open, on the elements that were
// selected when the field was left (`targets`): the press that left it may select another element before the value is
// kept (a click on the canvas, a Layers row), and the value belongs to the element it was typed for. Nothing for a
// selection that was empty.
function keepValue(store: EditorStore, command: CommandId, property: string, value: string, targets: readonly string[]): void {
  if (targets.length === 0) return;
  afterGesture(store, () => {
    const now = store.getState().selection;
    const same = now.length === targets.length && now.every((id, i) => id === targets[i]);
    (store.dispatch as Dispatch)(command, same ? { property, value } : { property, value, targets: [...targets] });
  });
}

export interface NumberFieldProps {
  // the field's door (an inspector-field door of style.set) and its state, whose availability includes its feature's
  readonly entry: DoorEntry;
  readonly door: DoorState;
  readonly property: string;
  readonly label: string;
  // A field standing in a pair row (properties.json rows, archive/DESIGN.md "Inspector"): it draws its cells for the
  // row's grid instead of a row of its own — the value cell alone, with the short prefix the row gives it (the height's
  // H, the gap's axis mark) — and, when it is the row's first field, its label beside it (the row's label, whose scrub
  // handle it is). Its label stays its accessible name and its tooltip.
  readonly bare?: boolean;
  readonly labelled?: boolean;
  readonly prefix?: string | null;
  // the text a pair row's first field shows where its label stands: the row's own (Size), the field keeping its name
  readonly rowText?: string | null;
}

export function NumberField({ entry, door, property, label, bare = false, labelled = false, prefix = null, rowText = null }: NumberFieldProps) {
  const store = useStore();
  const draft = useRef<{ typed: boolean; message: EditorState['message'] }>({ typed: false, message: store.getState().message });
  const primary = useEditorState((s) => s.selection[0] ?? null);
  const stored = useEditorState((s) => {
    const node = styleSource(s);
    return node ? storedValue(node, property, layeredRules(s)) : undefined;
  });
  const properties = useMemo(() => [property], [property]);
  const effective = useEffectiveText(property, properties, stored !== undefined);
  // several elements with different values: no value, and Mixed as the field's placeholder (spec multi-select-edit)
  const mixed = useMixed(properties);
  const appearance = useFieldAppearance(properties, mixed);
  const anyStored = useAnyStored(properties);
  // the document's value, else nothing: the effective value is the placeholder (spec inspector-provenance-reset, P4)
  const shown = mixed ? '' : (stored ?? '');
  // what a step, the scrub and the unit menu start from: the value, else the effective one
  const base = mixed ? '' : (stored ?? effective);
  const t = useT();
  // the project's variables the field offers (a length field: the length variables), then the presets its door
  // declares (Height's Screen height: 100vh; item 2.3)
  const valueLabel = useValueLabel();
  const variables = useTokenSuggestions(property);
  const tokens = [...variables, ...presetsOf(entry)];
  const said = useEditorState((s) => (draft.current.typed && s.message !== draft.current.message ? s.message ?? CLEARED_MESSAGE : null));
  const available = door.available && primary !== null;
  const input = useRef<HTMLInputElement>(null);
  // whether the person typed since the field last showed the document's value: the field's own draft, never document
  // state
  const command = entry.command.id;
  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    // a keyword is shown as CSS writes it in every language, a word of the person's language typed is read back as its
    // keyword (keyword-words.ts)
    const face = shown;
    element.value = face;
    draft.current.typed = false;
    markFieldKept(element, face);
    return restoreFieldDraft(element, () => {
      draft.current.message = store.getState().message;
      draft.current.typed = recordFieldInput(element, new Event('input'));
    });
  }, [shown, said, t, store]);
  useEffect(() => {
    const element = input.current;
    const typing = draft.current;
    if (element === null) return;
    const keep = () => {
      if (!typing.typed) return;
      typing.typed = false;
      element.dataset.draft = DRAFT_KEPT;
      // one task later: a press on a control of this same field (its unit menu, its reset) must not see the layout the
      // commit makes (the reset appearing, the field narrowing) change what lies under the pointer
      const text = element.value;
      // the elements the value was typed for, read now: the press that left the field may change the selection
      const targets = store.getState().selection;
      window.setTimeout(() => keepValue(store, command, property, text, targets), 0);
    };
    const onInput = (event: Event) => {
      typing.message = store.getState().message;
      typing.typed = recordFieldInput(element, event);
    };
    element.addEventListener('input', onInput);
    element.addEventListener('blur', keep);
    return () => {
      element.removeEventListener('input', onInput);
      element.removeEventListener('blur', keep);
      // the field goes (another selection, another tab) with typing not kept yet: it is kept
      keep();
    };
  }, [store, command, property]);
  useRevealed(property, input);
  useWheelSteps(input, property, store);
  // a variable chosen from the suggestions a name typed opens (variable-suggestions.tsx): written as a value typed is
  const cellRef = useRef<HTMLSpanElement>(null);
  const chooseVariable = (value: string) => {
    const element = input.current;
    if (element === null) return;
    element.value = value;
    draft.current.typed = false;
    element.dataset.draft = DRAFT_KEPT;
    keepValue(store, command, property, value, store.getState().selection);
  };
  const scrub = SCRUB === null ? null : <ScrubLabel entry={SCRUB} property={property} shown={base} label={rowText ?? label} ready={available} origin={appearance.kind} />;
  const refused = useFieldRefusal(command, property);
  const state = `${available ? '' : ' is-unavailable'}${stored !== undefined ? ' is-set' : ''}${refused.text !== null ? ' is-invalid' : ''}`;
  const cell = (
    <span ref={cellRef} className="input-wrap input-wrap--number" data-face="" data-origin={appearance.kind}>
      {prefix !== null ? <span className="field__prefix">{prefix}</span> : null}
      <FieldValueSlot value={mixed ? t('inspector.mixedValue') : compactFieldValue(base, true).value}>
        <input ref={input} className="input" role="spinbutton" disabled={!available} aria-label={label} inputMode="decimal" spellCheck={false} data-key-context={NUMBER_FIELD_CONTEXT} placeholder={mixed ? t('inspector.mixedValue') : effective || undefined} aria-invalid={refused.text !== null ? true : undefined} onInput={refused.dismiss} />
        {/* the step buttons lie over the value's end, so they take no room from the number (inspector.css
           .field__steps) */}
        <span className="field__steps">
          {PARTS.filter((part) => part.door.kind === 'panel-control' && STEP_CONTROLS.has(part.door.control)).map((part) => (
            <StepButton key={part.ref} entry={part} property={property} shown={base} input={input} ready={available} />
          ))}
        </span>
      </FieldValueSlot>
        {PARTS.filter((part) => part.door.kind === 'panel-control' && part.door.control === 'unit-menu').map((part) => (
          <UnitMenu key={part.ref} entry={part} property={property} shown={base} input={input} ready={available} suggestions={{
            field: entry,
            values: tokens,
            labelOf: (value) => valueLabel(property, value),
            keep: (value) => keepValue(store, command, property, value, store.getState().selection)
          }} />
        ))}
        {bare ? null : <FieldOriginBadge label={appearance.label} />}
        <VariableSuggestions entry={entry} property={property} label={t('field.variables.of', { property: propertyWord(t, property) })} input={input} anchor={cellRef} variables={variables} choose={chooseVariable} />
    </span>
  );
  // Reset this value stands at the row's end, never inside the value cell (jornada02 A.0, J6 of the jornada03 study:
  // inside the cell it shrank the number of a pair to nothing while the field was focused). It is drawn only while
  // the element holds a value of its own (spec inspector-provenance-reset, Problems in Pager 5), and shows while its
  // field is hovered or holds the focus (inspector.css .field__end).
  const resets = PARTS.filter((part) => !(part.door.kind === 'panel-control' && (part.door.control === 'unit-menu' || STEP_CONTROLS.has(part.door.control)))).map((part) => {
    if (part === RESET && !anyStored) return null;
    // the reset names what it resets (A3.24): what a screen reader reads
    const named = part === RESET ? { label: t('field.reset.of', { property: propertyWord(t, property) }) } : {};
    return <DoorControl key={part.ref} entry={part} args={{ property }} ready={available} {...named} />;
  });
  // a row of its own: at the row's end; a field of a pair: at the end of the row's label column (inspector.css)
  const end = <span className="field__end">{resets}</span>;
  const refusedText = refused.text !== null ? <span className="field-row__refusal" role="alert">{refused.text}</span> : null;
  // a field of a pair row draws its cells for the row's grid: its label (the row's own, when it is the row's first
  // field) beside its value cell, never a row of its own. Its cell is the field: the door, the value and, under it, a
  // refusal said beside it.
  if (bare) {
    return (
      <>
        {labelled ? (scrub ?? <span className="field-row__label">{rowText ?? label}</span>) : null}
        <span className={`field-cell${state}`} data-origin={appearance.kind} data-door={entry.ref} data-args={JSON.stringify({ property })} data-number-field title={door.title}>
          {cell}
          {refusedText}
        </span>
        {end}
      </>
    );
  }
  return (
    <div className={`field-row${state}`} data-origin={appearance.kind} data-door={entry.ref} data-args={JSON.stringify({ property })} data-number-field title={door.title}>
      {scrub ?? <span className="field-row__label">{label}</span>}
      {cell}
      {end}
      {refusedText}
    </div>
  );
}

// A text field of a style value that is no length (a keyword menu, a ratio, a composite of two longhands such as
// Overflow; spec props-size-overflow): an input that suggests the keywords the property offers, in the same key
// context as a number field, so Enter keeps what it holds with style.set and Escape puts the document's value back
// (field.cancel); leaving it with typing not kept yet keeps it. It shows the value the primary selected element holds
// (a composite's longhands, one value when they are the same), else the value the page computes.
// What a style field shows (TextStyleField): the value the primary selected element holds for the property (a
// composite's longhands composed, a part's own piece), the value the page computes as its placeholder, Mixed when the
// selected elements differ, and whether the element, or another selected one, holds a value of its own.
function useStyleFieldValue(property: string, parts: readonly string[], part: FieldPart | null) {
  const storedText = useEditorState((s) => {
    const node = styleSource(s);
    if (!node) return undefined;
    const values = parts.map((p) => storedValue(node, p, layeredRules(s)));
    if (values.every((v) => v === undefined)) return undefined;
    return composedText(property, values.map((v) => v ?? ''), MODEL_RULES);
  });
  const effective = useEffectiveText(property, parts, storedText !== undefined);
  const held = useEditorState((s) => {
    const node = styleSource(s);
    return node ? storedValue(node, property, layeredRules(s)) : undefined;
  });
  // the layers of a structured value it holds (a shadow), counted
  const storedLayersOf = useEditorState((s) => {
    const node = styleSource(s);
    return node ? storedLayers(node, property, layeredRules(s)).length : 0;
  });
  // several elements with different values: no value, and Mixed as the field's placeholder (spec multi-select-edit)
  const mixed = useMixed(parts);
  const appearance = useFieldAppearance(parts, mixed);
  const t = useT();
  // the document's value, else nothing: the effective value is the placeholder (spec inspector-provenance-reset, P4)
  const shown = mixed ? '' : part !== null ? part.show(held) : (storedText ?? '');
  // a part of a function (a filter's Blur, a translate's axis) shows the property's effective value too: with no
  // function set, "none" is what a browser applies, and a row that showed nothing said less than its siblings did
  const placeholder = mixed ? t('inspector.mixedValue') : effective !== '' ? effective : undefined;
  // the element holds a value of its own for what the field edits (the row shows it; Reset this value takes it away)
  const set = part !== null ? held !== undefined || storedLayersOf !== 0 : storedText !== undefined || storedLayersOf !== 0;
  // another selected element holds one: Reset takes it away from them all (A3.35)
  const anyStored = useAnyStored(parts);
  return { effective, held, mixed, appearance, shown, placeholder, set, anyStored };
}

// the range a field's slider covers (the manifest's inspector-field slider)
type SliderRange = NonNullable<Extract<DoorEntry['door'], { kind: 'inspector-field' }>['slider']>;
// the slider each property's Style tab door declares, by property
const INSPECTOR_SLIDERS = new Map<string, SliderRange>(manifest.doors.flatMap((d) => (d.door.kind === 'inspector-field' && d.door.property !== null && d.door.slider !== undefined && d.door.slider !== null ? [[d.door.property, d.door.slider] as const] : [])));

// The slider a style field's door declares beside it (A3.30): it follows the value and writes what the pointer releases
// on (a drag writes once, on release), through the same command the text field uses, with the unit the shown value
// carries, so a value written in another unit of the property keeps it.
function FieldSlider({ range, value, available, label, said, keep }: {
  readonly range: SliderRange;
  readonly value: string;
  readonly available: boolean;
  readonly label: string;
  // the status bar's message: a write that comes back moves the thumb
  readonly said: unknown;
  readonly keep: (text: string) => void;
}) {
  const t = useT();
  const sliderInput = useRef<HTMLInputElement>(null);
  // the unit the release writes with: the one the value carries, read with the value and kept for the release
  const slidUnit = useRef('');
  const slid = slidValue(value, range);
  useEffect(() => {
    const element = sliderInput.current;
    if (element === null) return;
    slidUnit.current = slid === null ? range.unit : slid.unit;
    // the thumb holds still while the pointer drags it; on release the write comes back as the value and moves it
    if (document.activeElement === element) return;
    element.value = slid === null ? String(range.min) : String(slid.value);
  }, [slid, range, said]);
  const keepSlide = () => {
    const element = sliderInput.current;
    // nothing is written when the value holds no number to slide (the thumb sits at the range's start without a value
    // behind it) or when the thumb never left the value the field shows
    if (element === null || !available || slid === null || element.value === String(slid.value)) return;
    keep(`${element.value}${slidUnit.current}`);
  };
  useEffect(() => {
    const element = sliderInput.current;
    if (element === null) return undefined;
    return registerSlider(element, () => keepSlide());
  });
  return (
    <input
      ref={sliderInput}
      type="range"
      className="field__slider"
      min={range.min}
      max={range.max}
      step={range.step}
      disabled={!available || slid === null}
      title={slid === null ? t('field.slider.none') : undefined}
      // the field's own name: a filter's eight functions share their property, never their slider's name
      aria-label={t('field.slider.of', { property: label })}
      onBlur={keepSlide}
    />
  );
}

// The list of every value a style field offers (A3.33), opened by its own button: the door's essentials first (the only
// ones in Essentials only), the rest behind More values; the project's own fonts lead the first list, never behind
// More values, Essentials only too (the audit's AUD-12: an uploaded font showed only in the longer list; Webflow
// groups uploaded fonts as their own source); a font menu draws every family in its own face (the plan's stage 3).
function FieldValues({ entry, property, label, anchor, list, suggestions, projectFonts, checked, choose }: {
  readonly entry: DoorEntry;
  readonly property: string;
  readonly label: string;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly list: RefObject<HTMLDivElement | null>;
  readonly suggestions: readonly string[];
  readonly projectFonts: readonly string[];
  // the item checked: the value the element holds, else the one the page computes
  readonly checked: string;
  readonly choose: (value: string) => void;
}) {
  const t = useT();
  const valueLabel = useValueLabel();
  const faces = codecOf(MODEL_RULES.propertyFacts.get(property)?.codec ?? '')?.id === FAMILY_CODEC;
  const essentials = essentialsOf(entry);
  const essentialsMode = useEditorState((s) => inspectorMode(s.ui) === 'essentials');
  const [moreValues, setMoreValues] = useState(false);
  const first = essentials === null ? null : [...projectFonts, ...essentials.filter((v) => !projectFonts.includes(v))];
  const menuValues = first === null ? suggestions : [...first.filter((v) => suggestions.includes(v)), ...(moreValues && !essentialsMode ? suggestions.filter((v) => !first.includes(v)) : [])];
  const hasMoreValues = first !== null && !essentialsMode && suggestions.some((v) => !first.includes(v));
  return (
    <FieldMenu anchor={anchor} list={list} label={label}>
      {menuValues.map((value) => (
        <button
          key={value}
          type="button"
          role="menuitemradio"
          aria-checked={value === checked}
          tabIndex={-1}
          className="menu__item"
          data-door={entry.ref}
          data-args={JSON.stringify({ property, value })}
          onClick={() => choose(value)}
        >
          <span className="menu__icon">{value === checked ? <Icon name={GLYPHS.checked} size="sm" /> : null}</span>
          {/* a font's item is drawn in its own face: a project font (the manifest's custom-fonts) by its
              family, a stack of the font menu as it is written */}
          <span className={faces ? 'menu__label menu__label--face' : 'menu__label'} style={faces ? ({ '--font-face': projectFonts.includes(value) ? cssFamily(value) : value } as CSSProperties) : undefined}>
            {valueLabel(property, value)}
          </span>
        </button>
      ))}
      {hasMoreValues ? (
        <button type="button" role="menuitem" tabIndex={-1} className="menu__item" data-menu-more="" aria-label={t(moreValues ? 'field.values.fewer' : 'field.values.more')} onClick={() => setMoreValues(!moreValues)}>
          <span className="menu__icon">{moreValues ? <Icon name={GLYPHS.collapsed} size="sm" /> : null}</span>
          <span className="menu__label">{t(moreValues ? 'field.values.fewer' : 'field.values.more')}</span>
        </button>
      ) : null}
    </FieldMenu>
  );
}

// A part of a value a field edits alone (a translate axis, one function of a filter or a transform): what the field
// shows of the value the element holds, and the arguments of its door's command for a text typed.
const NO_EXTRA: Readonly<Record<string, unknown>> = {};

export interface FieldPart {
  show(held: string | undefined): string;
  args(text: string, held: string | undefined): Record<string, unknown>;
}

export function TextStyleField({
  entry,
  door,
  property,
  longhands,
  label,
  colour = false,
  ownCommand = false,
  part = null,
  extra = NO_EXTRA,
  values = false,
  sample = false,
  keepOnLeave = true,
  bare = false,
  labelled = false,
  prefix = null,
  rowText = null,
}: {
  readonly entry: DoorEntry;
  readonly door: DoorState;
  readonly property: string;
  readonly longhands: readonly string[] | null;
  readonly label: string;
  readonly colour?: boolean;
  readonly ownCommand?: boolean;
  readonly part?: FieldPart | null;
  // arguments of its own command the field gives beyond its door's (the quick panel's Border: every side)
  readonly extra?: Readonly<Record<string, unknown>>;
  // a field of a fixed list of values (a keyword menu, a font menu): it draws a button that opens every value at once,
  // so a typed one never hides the others (the user's real-use audit, item A3.33)
  readonly values?: boolean;
  // a field whose value is a colour that is a part of a larger value (a border's colour, a shadow's, a stop's): the
  // colour is shown as a sample, a chip of it; the picker opens on the fields whose colour is the whole property
  // (A3.29)
  readonly sample?: boolean;
  // whether a text not kept yet is kept when the field is left or goes (true, the inspector's rule: no typing is
  // lost); a quick panel field leaves it false: it keeps while the panel is open and loses the draft when the panel
  // closes (its dismissal cancels; spec quick-panel)
  readonly keepOnLeave?: boolean;
  // a field standing in a pair row: it draws its cells for the row's grid (NumberFieldProps)
  readonly bare?: boolean;
  readonly labelled?: boolean;
  readonly prefix?: string | null;
  // the text a pair row's first field shows where its label stands: the row's own (Size), the field keeping its name
  readonly rowText?: string | null;
}) {
  const store = useStore();
  const draft = useRef<{ typed: boolean; message: EditorState['message'] }>({ typed: false, message: store.getState().message });
  const primary = useEditorState((s) => s.selection[0] ?? null);
  const parts = useMemo(() => longhands ?? [property], [longhands, property]);
  const t = useT();
  const { effective, held, mixed, appearance, shown, placeholder, set, anyStored } = useStyleFieldValue(property, parts, part);
  const said = useEditorState((s) => (draft.current.typed && s.message !== draft.current.message ? s.message ?? CLEARED_MESSAGE : null));
  // Enter in a field of its own form (a command of its own, or a part) and leaving any field keep the text the same way
  const own = ownCommand || part !== null;
  const keepText = useRef<(text: string, targets: readonly string[]) => void>(() => undefined);
  useEffect(() => {
    keepText.current = (text: string, targets: readonly string[]) => {
      if (!own) {
        keepValue(store, entry.command.id, property, text, targets);
        return;
      }
      const args = part !== null ? { ...entry.door.args, ...part.args(text, held) } : ownArgs(entry, property, text, extra);
      afterGesture(store, () => {
        const now = store.getState().selection;
        const same = now.length === targets.length && now.every((id, i) => id === targets[i]);
        // a press that selected another element: the value goes to the elements it was typed for (the command's
        // targets, as style.set's: the audit's FD1); a command that takes none keeps it only on the same selection
        if (!same && (targets.length === 0 || !('targets' in entry.command.args))) return;
        (store.dispatch as Dispatch)(entry.command.id, same ? args : { ...args, targets: [...targets] });
      });
    };
  });
  const available = door.available && primary !== null;
  const input = useRef<HTMLInputElement>(null);
  useRevealed(property, input);
  // the slider the door declares beside the field (A3.30; FieldSlider)
  const sliderRange = entry.door.kind === 'inspector-field' ? entry.door.slider : undefined;
  // how the value reads: by that slider's range, else by the range the Style tab's door of the property declares, so a
  // quick panel's Opacity reads 100 % as the Style tab's does (the user's review of 2026-10-05: it read 1)
  const readRange = sliderRange ?? INSPECTOR_SLIDERS.get(property);
  // the list of every value the field offers, opened by its own button (A3.33): all of them, whatever the field holds
  // the layer contract of the field values menu: the same owner the menu buttons stand on (doors/menu.tsx)
  const valueScope = useRef<HTMLSpanElement>(null);
  const keepPending = useRef<() => void>(() => {});
  const valuesButton = useRef<HTMLButtonElement>(null);
  const valuesList = useRef<HTMLDivElement>(null);
  const valuesLayer = useMenuLayer(valuesButton, valuesList, undefined, { onOutside: () => keepPending.current(), returnFocus: input });
  const closeValues = useRef(valuesLayer.close);
  useLayoutEffect(() => {
    closeValues.current = valuesLayer.close;
  }, [valuesLayer.close]);
  const valueLabel = useValueLabel();
  const command = entry.command.id;
  // the list of its suggestions, one per field (the inspector and the quick panel may draw the same property)
  const listId = useId();
  // the project's variables of the field's kind, then the keywords the property offers
  const tokenSuggestions = useTokenSuggestions(property);
  const keywords = GENERATED_VALUES[(parts[0] ?? property) as StyleTargetId]?.keywords;
  // the font menu lists the project's fonts above the system stacks (the manifest's custom-fonts): the property whose
  // control the manifest draws as the font menu
  const fontMenu = manifest.properties.properties.some((one) => one.id === property && one.control === 'font-menu');
  const families = useProjectFontFamilies();
  const projectFonts = useMemo(() => (fontMenu ? families : []), [fontMenu, families]);
  const suggestions = useMemo(() => [...projectFonts, ...new Set([...tokenSuggestions, ...(keywords ?? []), ...presetsOf(entry)])], [projectFonts, tokenSuggestions, keywords, entry]);
  // the browser's own list offers the keywords and presets; the variables come in the field's suggestions list, which a
  // name typed opens (variable-suggestions.tsx), never twice
  const listed = useMemo(() => suggestions.filter((value) => !tokenSuggestions.includes(value)), [suggestions, tokenSuggestions]);
  // the item checked: the value the element holds, else the one the page computes (the audit's S-027: no mark at all)
  const checkedValue = shown !== '' ? shown : mixed ? '' : effective.trim();
  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    // a keyword is shown as CSS writes it, and a word typed in the person's language read back as its keyword
    // (keyword-words.ts)
    const face = shown;
    element.value = face;
    draft.current.typed = false;
    markFieldKept(element, face);
    return restoreFieldDraft(element, () => {
      draft.current.message = store.getState().message;
      draft.current.typed = recordFieldInput(element, new Event('input'));
    });
  }, [shown, said, t, store]);
  useEffect(() => {
    const element = input.current;
    const typing = draft.current;
    if (element === null) return;
    const keep = () => {
      if (!typing.typed) return;
      typing.typed = false;
      element.dataset.draft = DRAFT_KEPT;
      // a quick panel field keeps what it holds only while the panel is open: the panel's dismissal cancels the draft
      // as an Escape in an inspector field does (spec quick-panel)
      if (!keepOnLeave && !quickPanelOpen(store.getState().ui)) return;
      // one task later, as the number field's keep above, for the elements selected now
      const text = element.value;
      const targets = store.getState().selection;
      window.setTimeout(() => keepText.current(text, targets), 0);
    };
    const onInput = (event: Event) => {
      typing.message = store.getState().message;
      typing.typed = recordFieldInput(element, event);
    };
    keepPending.current = keep;
    const scope = valueScope.current;
    const inside = (target: EventTarget | null) => target === element || target === valuesButton.current || (target instanceof Node && valuesList.current?.contains(target) === true);
    const finish = () => {
      keep();
      closeValues.current();
    };
    const leave = (event: FocusEvent) => {
      const next = event.relatedTarget;
      // Removing a menu can report null before its focus restoration completes (Escape).
      if (next === null) {
        queueMicrotask(() => {
          if (!inside(document.activeElement)) finish();
        });
        return;
      }
      // A pointer opens the list without committing. Tab is an explicit confirmation, even onto its trigger.
      if (inside(next) && !(next === valuesButton.current && !pointerViews(store).pointerPressing())) return;
      finish();
    };
    // the values menu floats on the body (FieldMenu), outside the field's scope: the focus leaving one of its items is
    // heard too, so Tab and Shift+Tab out of the open list keep the draft and close it
    const leaveAnywhere = (event: FocusEvent) => {
      const from = event.target;
      if (from instanceof Node && (scope?.contains(from) === true || valuesList.current?.contains(from) === true)) leave(event);
    };
    element.addEventListener('input', onInput);
    document.addEventListener('focusout', leaveAnywhere, true);
    return () => {
      element.removeEventListener('input', onInput);
      document.removeEventListener('focusout', leaveAnywhere, true);
      keepPending.current = () => {};
      // the field goes: the inspector keeps a text not kept yet; a quick panel field drops it (its dismissal cancels)
      if (keepOnLeave) keep();
    };
  }, [store, command, property, keepOnLeave]);
  const refused = useFieldRefusal(entry.command.id, property);
  // a field whose door is a command of its own (the background image: style.setBackgroundImage), not style.set: Enter
  // submits its form and keeps what it holds with that command, since the number field's Enter is style.set's
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const element = input.current;
    if (element === null || !draft.current.typed) return;
    draft.current.typed = false;
    element.dataset.draft = DRAFT_KEPT;
    keepText.current(element.value, store.getState().selection);
  };
  // a variable chosen from the suggestions a name typed opens (variable-suggestions.tsx): kept as a text typed is
  const chooseVariable = (value: string) => {
    const element = input.current;
    if (element === null) return;
    element.value = value;
    draft.current.typed = false;
    element.dataset.draft = DRAFT_KEPT;
    keepText.current(value, store.getState().selection);
  };
  const state = `${available ? '' : ' is-unavailable'}${set ? ' is-set' : ''}${refused.text !== null ? ' is-invalid' : ''}`;
  const visible = mixed ? t('inspector.mixedValue') : shown || placeholder || '';
  const percent = readRange?.min === 0 && readRange.max === 1 && visible.trim() !== '' && Number.isFinite(Number(visible));
  const face = percent ? { value: String(Math.round(Number(visible) * 100)), unit: '%' } : compactFieldValue(visible, sliderRange !== undefined, colour);
  const cell = (
    <span ref={valueScope} className="input-wrap" data-face="" data-origin={appearance.kind}>
        {prefix !== null ? <span className="field__prefix">{prefix}</span> : null}
        {!colour && !sample && (entry.door.kind === 'inspector-field' || entry.door.kind === 'quick-panel') && entry.door.icon !== null ? <Icon name={entry.door.icon} size="sm" /> : null}
        {sample ? <span className="field__sample swatch" style={{ '--swatch-colour': shown || effective } as CSSProperties} title={shown || effective} /> : null}
        {colour && COLOR_SWATCH !== undefined ? (
          // each swatch names the field it opens the picker for (three of them read the same, the audit's accessible
          // names)
          <DoorControl entry={COLOR_SWATCH} args={{ property }} ready={door.built && primary !== null} className="field__swatch" label={t('field.swatch.of', { property: label })}>
            <span className="field__sample swatch" style={{ '--swatch-colour': shown || effective } as CSSProperties} />
          </DoorControl>
        ) : null}
        <FieldValueSlot value={face.value}>{own ? (
          <form key="input-form" className="input-wrap__form" onSubmit={submit}>
            <input ref={input} className="input" disabled={!available} aria-label={label} spellCheck={false} data-key-context={COMMAND_FIELD_CONTEXT} placeholder={placeholder} aria-invalid={refused.text !== null ? true : undefined} onInput={refused.dismiss} />
          </form>
        ) : (
          <input key="input" ref={input} className="input" disabled={!available} aria-label={label} spellCheck={false} list={listed.length > 0 ? listId : undefined} data-key-context={NUMBER_FIELD_CONTEXT} placeholder={placeholder} aria-invalid={refused.text !== null ? true : undefined} onInput={refused.dismiss} />
        )}</FieldValueSlot>
        {face.unit ? <span className="field__suffix" aria-hidden="true">{face.unit}</span> : null}
        {bare ? null : <FieldOriginBadge label={appearance.label} />}
        <VariableSuggestions entry={entry} property={property} label={t('field.variables.of', { property: propertyWord(t, property) })} input={input} anchor={valueScope} variables={tokenSuggestions} choose={chooseVariable} />
        {listed.length > 0 ? (
          <datalist key="suggestions" id={listId}>
            {listed.map((value) => (
              // a value the catalogue names (the Screen height preset: 100vh) carries its name, so the list reads
              <option key={value} value={value} label={valueLabel(property, value) === value ? undefined : valueLabel(property, value)} />
            ))}
          </datalist>
        ) : null}
        {values && suggestions.length > 0 ? (
          <span key="values" className="menu-anchor field__values">
            <button
              ref={valuesButton}
              type="button"
              className="field__values-button"
              aria-haspopup="menu"
              aria-expanded={valuesLayer.open}
              aria-label={t('field.values.of', { property: propertyWord(t, property) })}
              aria-disabled={available ? undefined : true}
              onClick={valuesLayer.toggle}
            >
              <Icon name={GLYPHS.dropdown} size="xs" />
            </button>
            {valuesLayer.open ? (
              <FieldValues entry={entry} property={property} label={door.label} anchor={valueScope} list={valuesList} suggestions={suggestions} projectFonts={projectFonts} checked={checkedValue} choose={(value) => {
                draft.current.typed = false;
                if (input.current) input.current.dataset.draft = DRAFT_KEPT;
                valuesLayer.close();
                keepText.current(value, store.getState().selection);
              }} />
            ) : null}
          </span>
        ) : null}
        {sliderRange !== undefined ? <FieldSlider key="slider" range={sliderRange} value={shown !== '' ? shown : effective} available={available} label={label} said={said} keep={(text) => keepText.current(text, store.getState().selection)} /> : null}
    </span>
  );
  // Reset this value at the row's end, as a number field's (jornada02 A.0, J6): never inside the value cell
  const reset = RESET !== undefined && (set || anyStored) ? <DoorControl key="reset" entry={RESET} args={{ property }} ready={available} label={t('field.reset.of', { property: propertyWord(t, property) })} /> : null;
  // a row of its own: at the row's end; a field of a pair: at the end of the row's label column (inspector.css)
  const end = <span className="field__end">{reset}</span>;
  const refusedText = refused.text !== null ? <span className="field-row__refusal" role="alert">{refused.text}</span> : null;
  // a field of a pair row draws its cells for the row's grid: its label (the row's own, when it is the row's first
  // field) beside its value cell, never a row of its own. Its cell is the field: the door, the value and, under it, a
  // refusal said beside it.
  if (bare) {
    return (
      <>
        {labelled ? (
          <span className="field-row__label" data-origin={appearance.kind} title={property}>
            {rowText ?? label}
          </span>
        ) : null}
        <span className={`field-cell${state}`} data-origin={appearance.kind} data-door={entry.ref} data-args={JSON.stringify({ property })} title={door.title}>
          {cell}
          {refusedText}
        </span>
        {end}
      </>
    );
  }
  return (
    <div className={`field-row${state}`} data-origin={appearance.kind} data-door={entry.ref} data-args={JSON.stringify({ property })} title={door.title}>
      <span className="field-row__label" data-origin={appearance.kind} title={property}>
        {label}
      </span>
      {cell}
      {end}
      {refusedText}
    </div>
  );
}
// Keyword buttons: one button per value, each the field's door standing for its value; a click keeps that value with
// its command (one undo step), and the button of the value the primary selected element holds (else the page computes)
// is pressed. The buttons never wrap: when their words do not fit the row's value column (Position's five), the field
// is drawn as a keyword menu — its value on a button that opens the list of the values, each item the same door
// standing for its value (jornada02 GENERALISATION "Keyword buttons"; the audit's S-015).
export function KeywordButtons({ entry, door, property, values, icons, label }: {
  readonly entry: DoorEntry;
  readonly door: DoorState;
  readonly property: string;
  readonly values: readonly string[];
  readonly icons: Readonly<Record<string,
  string>>;
  readonly label: string
}) {
  const store = useStore();
  const primary = useEditorState((s) => s.selection[0] ?? null);
  const stored = useEditorState((s) => {
    const node = styleSource(s);
    return node ? storedValue(node, property, layeredRules(s)) : undefined;
  });
  const properties = useMemo(() => [property], [property]);
  const effective = useEffectiveText(property, properties, stored !== undefined);
  // several elements with different values: no button pressed (spec multi-select-edit)
  const mixed = useMixed(properties);
  const appearance = useFieldAppearance(properties, mixed);
  const anyStored = useAnyStored(properties);
  const t = useT();
  // pressed: the document's value; the effective one, while the element holds none, is marked muted (spec
  // inspector-provenance-reset, Problems in Pager 4)
  const shown = mixed ? '' : (stored ?? '');
  const muted = mixed || stored !== undefined ? '' : effective;
  const available = door.available && primary !== null;
  const command = entry.command.id;
  // the argument the value goes in: style.set's value, position.setMode's mode
  const valueArg = Object.keys(entry.command.args).find((name) => name !== 'property') ?? 'value';
  const choose = (value: string) => {
    if (available) (store.dispatch as Dispatch)(command, { property, [valueArg]: value });
  };
  // whether the buttons' words fit the room the row gives them: an unseen copy of the buttons is measured against it
  const room = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  // (Mixed is said beside the buttons, so it is measured with them)
  const worded = mixed || values.some((value) => icons[value] === undefined);
  const fits = useFits(room, measure, worded);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuList = useRef<HTMLDivElement>(null);
  const layer = useMenuLayer(menuButton, menuList);
  const words = worded ? (
    <span ref={measure} className="segmented segmented--values field-choice__measure" aria-hidden="true">
      {values.map((value) => (
        <span key={value} className="door door--segment">
          {icons[value] !== undefined ? <Icon name={icons[value]} size="sm" /> : <span className="door__label">{value}</span>}
        </span>
      ))}
      {mixed ? <span className="field-row__mixed">{t('inspector.mixedValue')}</span> : null}
    </span>
  ) : null;
  if (!fits) {
    const current = shown || muted;
    return (
      <div className={`field-row${available ? '' : ' is-unavailable'}`} data-origin={appearance.kind} title={door.title}>
        <span className="field-row__label" data-origin={appearance.kind} title={property}>
          {label}
        </span>
        <span ref={room} className="field-choice field-choice--menu menu-anchor">
          {words}
          <button
            ref={menuButton}
            type="button"
            className={`input-wrap field__keyword${mixed ? ' is-mixed' : ''}`}
            data-face=""
            data-origin={appearance.kind}
            data-door={entry.ref}
            data-args={JSON.stringify({ property })}
            aria-haspopup="menu"
            aria-expanded={layer.open}
            aria-label={label}
            aria-disabled={available ? undefined : true}
            onClick={() => {
              if (available) layer.toggle();
            }}
          >
            <span className="field__keyword-value">{mixed ? t('inspector.mixedValue') : current}</span>
            <Icon name={GLYPHS.dropdown} size="xs" />
          </button>

          {layer.open && available ? (
            <div className="menu field__menu" role="menu" ref={menuList} aria-label={label} data-key-context="menu">
              {values.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={shown === value}
                  className="menu__item"
                  data-door={entry.ref}
                  data-args={JSON.stringify({ property, [valueArg]: value })}
                  onClick={() => {
                    layer.close();
                    choose(value);
                    menuButton.current?.focus();
                  }}
                >
                  <span className="menu__icon">{shown === value ? <Icon name={GLYPHS.checked} size="sm" /> : null}</span>
                  {icons[value] !== undefined ? <Icon name={icons[value]} size="sm" /> : null}
                  <span className="menu__label">{value}</span>
                </button>
              ))}
            </div>
          ) : null}
          {RESET !== undefined && anyStored ? <span className="field__actions"><DoorControl entry={RESET} args={{ property }} ready={available} label={t('field.reset.of', { property: propertyWord(t, property) })} /></span> : null}
        </span>
      </div>
    );
  }
  return (
    <div className={`field-row${available ? '' : ' is-unavailable'}`} data-origin={appearance.kind} title={door.title}>
      <span className="field-row__label" data-origin={appearance.kind} title={property}>
        {label}
      </span>
      <span ref={room} className="field-choice">
      {words}
      <span className={`segmented segmented--values${mixed ? ' is-mixed' : ''}`} role="group" aria-label={label} data-mixed={mixed ? '' : undefined}>
        {values.map((value) => {
          const icon = icons[value];
          return (
            <button
              key={value}
              type="button"
              className={`door door--segment${available ? '' : ' is-unavailable'}${shown === value ? ' is-current' : ''}${muted === value ? ' is-default' : ''}`}
              aria-disabled={available ? undefined : true}
              aria-pressed={shown === value}
              title={value}
              aria-label={value}
              data-door={entry.ref}
              data-args={JSON.stringify({ property, [valueArg]: value })}
              // one Tab stop for the group, and the arrows move among its buttons (keymap.ts roving groups; the
              // audit's S-016: the arrows did nothing)
              data-key-context="roving-group"
              tabIndex={shown === value || (shown === '' && values.indexOf(value) === 0) ? undefined : -1}
              onClick={() => choose(value)}
            >
              {icon !== undefined ? <Icon name={icon} size="sm" /> : <span className="door__label">{value}</span>}
            </button>
          );
        })}
      </span>
      {/* several elements with different values: said as every field says it (A3.35), beside the buttons, in the
          field's own cell (the audit's S-032: it dropped to a line of its own under the label) */}
      {mixed ? <span className="field-row__mixed">{t('inspector.mixedValue')}</span> : null}
      {RESET !== undefined && anyStored ? <span className="field__actions"><DoorControl entry={RESET} args={{ property }} ready={available} label={t('field.reset.of', { property: propertyWord(t, property) })} /></span> : null}
      </span>
    </div>
  );
}

// Whether a row of words fits its room: the unseen copy's width against the width the room may take (its row's value
// column), measured before the paint and again whenever the room changes size. Icons always fit.
function useFits(room: RefObject<HTMLElement | null>, measure: RefObject<HTMLElement | null>, worded: boolean): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const cell = room.current?.parentElement ?? null;
    if (!worded || cell === null) return undefined;
    const check = () => {
      const copy = measure.current;
      if (copy === null) return;
      // the row's value column: the last track of its grid, as the browser resolves it
      const available = parseFloat(getComputedStyle(cell).gridTemplateColumns.split(' ').at(-1) ?? '');
      if (Number.isFinite(available)) setFits(copy.offsetWidth <= available + 0.5);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [room, measure, worded]);
  return fits;
}

// The field's label, the handle its scrub is pressed on (the pointer owner runs the drag); its tooltip is the CSS
// property name (archive/DESIGN.md "Inspector").
function ScrubLabel({ entry, property, shown, label, ready, origin }: { readonly entry: DoorEntry; readonly property: string; readonly shown: string; readonly label: string; readonly ready: boolean; readonly origin?: string }) {
  const door = useDoor(entry, { property }, undefined, ready);
  return (
    <span
      className={`field-row__label${door.available ? ' field-row__label--scrub' : ''}`}
      data-origin={origin}
      data-door={entry.ref}
      data-args={JSON.stringify({ property, value: shown })}
      aria-disabled={door.available ? undefined : true}
      title={property}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------- the text fields of a panel
// The text of an element (spec inspector-panel, "Text field") and the attribute fields of the Settings tab, drawn
// for their doors; both keep what they hold through their command (text.set / the attribute command) once no gesture
// is open. They live here so a canvas module (the quick panel) and the inspector import the same field module.

// What the page computes for the one selected element and for its parent (spec props-element-specific, "Our rule"): the
// values the applicability predicates read, named in properties.json (its `context`). Null while the editor cannot
// read them (no single selection, the page not drawn, no parent above the page root): a context field shows then.
const CONTEXT = manifest.properties.context;
export function useSelectionContext(): ElementContext | null {
  const only = useEditorState((s) => (s.selection.length === 1 ? (s.selection[0] ?? null) : null));
  const parent = useEditorState((s) => {
    const found = only === null ? null : locate(s.document, only);
    return found?.parent?.id ?? null;
  });
  const box = useEditorState((s) => {
    const found = only === null ? null : locate(s.document, only);
    return found === null ? false : elementPredicate('hasBox', found.node, MODEL_RULES) === true;
  });
  const own = usePageValues(only, CONTEXT.own);
  const above = usePageValues(parent, CONTEXT.parent);
  if (only === null || own === null) return null;
  // the manifest names the properties; the context reads them by their camelCase key (column-count -> columnCount)
  const camel = (property: string): string => property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const keyed = (values: Readonly<Record<string, string>>, names: readonly string[]): Readonly<Record<string, string | undefined>> =>
    Object.fromEntries(names.map((property) => [camel(property), values[property]]));
  return { box, own: keyed(own, CONTEXT.own), parent: parent === null || above === null ? null : keyed(above, CONTEXT.parent) };
}

// The layout context of every selected element (the inspector's filter for a selection of several): a field whose
// context predicate holds for one element and not for another does not apply to the selection (the audit's S-011:
// two paragraphs showed every flex, grid and column field). Measured on the page in one frame loop, as usePageValues.
export function useSelectionContexts(): readonly ElementContext[] | null {
  const store = useStore();
  const ids = useEditorState((s) => s.selection.join(' '));
  const [read, setRead] = useState<{ readonly ids: string; readonly contexts: readonly ElementContext[] } | null>(null);
  useEffect(() => {
    const nodes = ids === '' ? [] : (ids.split(' ') as NodeId[]);
    if (nodes.length < 2) return;
    let request = 0;
    let last: string | null = null;
    const camel = (property: string): string => property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const keyed = (values: Readonly<Record<string, string>>, names: readonly string[]): Readonly<Record<string, string | undefined>> =>
      Object.fromEntries(names.map((property) => [camel(property), values[property]]));
    const measure = () => {
      const document = store.getState().document;
      const contexts: ElementContext[] = [];
      for (const id of nodes) {
        const found = locate(document, id);
        const own = computedValues(id, CONTEXT.own, lineStyles(MODEL_RULES));
        const parentId = found?.parent?.id ?? null;
        const above = parentId === null ? null : computedValues(parentId, CONTEXT.parent, lineStyles(MODEL_RULES));
        const box = found === null ? false : elementPredicate('hasBox', found.node, MODEL_RULES) === true;
        if (own !== null) contexts.push({ box, own: keyed(own, CONTEXT.own), parent: above === null ? null : keyed(above, CONTEXT.parent) });
      }
      const text = JSON.stringify(contexts);
      if (text !== last) {
        last = text;
        setRead({ ids, contexts });
      }
    };
    // once now, then whenever the page may have changed (canvas/page-clock.ts), never at every frame
    request = requestAnimationFrame(measure);
    const stop = onPageChange(measure);
    return () => {
      cancelAnimationFrame(request);
      stop();
    };
  }, [ids, store]);
  return read !== null && read.ids === ids ? read.contexts : null;
}

// Runs what a field keeps as it loses the focus once no pointer gesture is open (afterGesture of the pointer owner): a
// command recorded once per dispatch never joins a gesture.
export function keepAfterGesture(store: EditorStore, run: () => void): void {
  afterGesture(store, run);
}

// Keeps a text with the door's command (text.set), from a field (keepAfterGesture). Nothing is kept for a node the
// document no longer holds.
function keepTextWith(store: EditorStore, command: CommandId, target: NodeId, content: string): void {
  keepAfterGesture(store, () => {
    if (locate(store.getState().document, target) === null) return;
    (store.dispatch as (id: CommandId, args: CommandArgs['text.set']) => DispatchResult)(command, { target, content });
  });
}

// the key context the text field names (interactions.json), whose doors are Enter (text.set keeps what the field holds,
// which the keymap reads as the command's content) and Escape (text.cancelEdit); Shift+Enter is not bound there, so
// the text area takes its own line break
const TEXT_FIELD_CONTEXT: KeyContextId = 'element-text-field';

// The text of the one selected text element (spec inspector-panel, "Text field"), drawn for its door (the command that
// takes the node's `content`). Typing changes only the field; its keys are the keymap's doors of its key context.
// The field shows the text the document holds: when it is drawn, when that text changes, and after every command
// that says something (the store's last message): Enter kept the text or was refused (a locked element), Escape
// cancelled what was typed. Leaving the field with typing not kept yet (Tab, a click elsewhere, another selection or
// tab) keeps it, one undo step. The field is drawn once per node (its key), so a node's typing is kept for that node.
export function TextField({ entry, node, label, keepOnLeave = true }: { readonly entry: DoorEntry; readonly node: DocNode; readonly label: string; readonly keepOnLeave?: boolean }) {
  const store = useStore();
  const draft = useRef<{ typed: boolean; message: EditorState['message'] }>({ typed: false, message: store.getState().message });
  const door = useDoor(entry, { target: node.id }, label);
  const field = useRef<HTMLTextAreaElement>(null);
  // whether the person typed since the field last showed the document's text: the field's own draft, never document
  // state
  const said = useEditorState((s) => (draft.current.typed && s.message !== draft.current.message ? s.message ?? CLEARED_MESSAGE : null));
  const stored = node.text ?? '';
  const target = node.id;
  const command = entry.command.id;
  useEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.value = stored;
    draft.current.typed = false;
    markFieldKept(element, stored);
    return restoreFieldDraft(element, () => {
      draft.current.message = store.getState().message;
      draft.current.typed = recordFieldInput(element, new Event('input'));
    });
  }, [stored, said, store]);
  useEffect(() => {
    const element = field.current;
    const typing = draft.current;
    if (element === null) return;
    const keep = () => {
      if (!typing.typed) return;
      typing.typed = false;
      element.dataset.draft = DRAFT_KEPT;
      // a quick panel field keeps what it holds only while the panel is open (spec quick-panel)
      if (!keepOnLeave && !quickPanelOpen(store.getState().ui)) return;
      keepTextWith(store, command, target, element.value);
    };
    const onInput = (event: Event) => {
      typing.message = store.getState().message;
      typing.typed = recordFieldInput(element, event);
    };
    element.addEventListener('input', onInput);
    element.addEventListener('blur', keep);
    return () => {
      element.removeEventListener('input', onInput);
      element.removeEventListener('blur', keep);
      // the field goes (another selection, another tab) with typing not kept yet: it is kept — unless it is a quick
      // panel field, whose dismissal cancels what it held (spec quick-panel)
      if (keepOnLeave) keep();
    };
  }, [store, command, target, keepOnLeave]);
  return (
    <div className={`field-row field-row--wide${door.available ? '' : ' is-unavailable'}`} data-door={entry.ref} data-args={JSON.stringify({ target })} title={door.title}>
      <span className="field-row__label">{label}</span>
      <textarea ref={field} className="input input--area" rows={3} disabled={!door.available} aria-label={label} spellCheck={false} data-key-context={TEXT_FIELD_CONTEXT} />
    </div>
  );
}

// How an attribute field's text reaches its door's command, what the field shows and what it suggests, or null for a
// field that keeps no text:
//  - a setting of the page (spec page-properties, Problems in Pager 1), on the page root: the field stands for its
//    setting (the command's argument that takes an attribute, by its manifest type, names it) and its text fills the
//    command's other argument;
//  - an attribute whose command takes a text argument of the attribute's own name (element.setLink's href, spec
//    elements-structure; element.setTag's tag, spec semantic-tag-switch): the field stands for its node (the command's
//    target, when it takes one; element.setTag acts on the selection) and its text fills that argument.
// The field shows the value the node stores for the attribute (empty while it has none), except the HTML tag, which is
// the node's own tag, shown with the element's equivalent tags as suggestions (core/elements/tag.ts). A boolean
// attribute (a toggle) keeps no text.
export interface KeptText {
  readonly args: Readonly<Record<string, string>>;
  readonly filled: string;
  readonly stored: string;
  readonly suggestions: readonly string[];
  // a text of several lines (an embed's markup): a text area kept when the field is left, Enter breaking the line
  readonly multiline?: boolean;
}
// the value type of the attribute that is an element's HTML tag (elements.json), and a field that suggests nothing
const TAG_VALUE = 'tag';
// the value type of an attribute that names another node by its id (a label's for)
export const ID_REF = 'id-ref';
// the keywords an attribute takes (elements.json), offered as suggestions
const keywordsOf = (attribute: AttributeId): readonly string[] => ATTRIBUTES.get(attribute)?.keywords ?? NO_SUGGESTIONS;
// The attribute whose field offers the project's own files (elements.json filePicker names it, on the element type):
// an image's Source picks the file it draws with, the media library of the Explorer's Files list being the other way to
// see them (spec explorer-assets-use).
const filePickerOf = (node: DocNode): string | null => MODEL_RULES.elements.get(node.type)?.filePicker ?? null;
// the attribute whose field a link's choose button follows (elements.json: the link's href)
const HREF_ATTRIBUTE = ATTRIBUTES.get('href')?.id ?? 'href';
// the choose button of a field that names a file (layout.json region "field", control "source-choose")
const SOURCE_CHOOSE = doorSlots('field').find((p) => p.door.kind === 'panel-control' && p.door.control === 'source-choose') ?? null;
// the icons the choose buttons are drawn as: a file of the project, a page or address
const PICK_FILE_ICON = 'image';
const PICK_LINK_ICON = 'link';
// the choose button of a link's address (element.setLink#inspector-href draws it too; the picker is its view)
const HREF_CHOOSE = doorSlots('field').find((p) => p.door.kind === 'panel-control' && p.door.control === 'href-choose') ?? null;
// the value type of an attribute that is the element's own markup (an embed's), edited as several lines
const MARKUP_VALUE = 'markup';
// the attribute that is the node's list of classes (elements.json), kept in the node's own classes
const CLASSES = 'classes';
const NO_SUGGESTIONS: readonly string[] = [];
export function keptTextOf(entry: DoorEntry, attribute: AttributeId, valueType: string, node: DocNode): KeptText | null {
  if (valueType === 'boolean') return null;
  const args = Object.entries(entry.command.args);
  const value = node.attributes[attribute];
  // the classes are the node's own list, shown as its words
  const stored = attribute === CLASSES ? node.classes.join(' ') : value === undefined ? '' : String(value);
  const target = args.find(([name, arg]) => name === 'target' && arg.type === 'node');
  const forNode = target === undefined ? {} : { target: node.id };
  // a command that names the attribute it sets (page.setSetting, element.setAttribute): the field stands for its
  // attribute and its node, and its text fills the command's other argument
  const named = args.find(([, arg]) => arg.type === 'attribute')?.[0];
  if (named !== undefined) {
    const filled = args.find(([name]) => name !== named && name !== 'target')?.[0];
    return filled === undefined ? null : { args: { [named]: attribute, ...forNode }, filled, stored, suggestions: keywordsOf(attribute) };
  }
  // a command whose one argument is a choice (element.setInputType's type): the field suggests its values
  const choices = args.filter(([name]) => name !== 'target');
  const choice = choices.length === 1 ? choices[0] : undefined;
  if (choice !== undefined && (choice[1].type === 'enum' || (choice[1].type === 'string' && valueType === 'keyword')))
    return { args: forNode, filled: choice[0], stored, suggestions: choice[1].type === 'enum' ? choice[1].values : keywordsOf(attribute) };
  // markup (an embed's, kept as the node's text; an SVG's, kept in its attribute): the command's one text argument
  // besides its node, several lines
  if (valueType === MARKUP_VALUE) {
    const text = args.filter(([name, arg]) => name !== 'target' && arg.type === 'string');
    const filled = text.length === 1 ? (text[0] as [string, unknown])[0] : undefined;
    return filled === undefined ? null : { args: forNode, filled, stored: value !== undefined ? stored : (node.text ?? ''), suggestions: NO_SUGGESTIONS, multiline: true };
  }
  const own = args.find(([name, arg]) => name === attribute && (arg.type === 'string' || arg.type === 'json'));
  if (own === undefined) return null;
  const kept = { args: forNode, filled: attribute };
  if (valueType !== TAG_VALUE) return { ...kept, stored, suggestions: NO_SUGGESTIONS };
  const element = MODEL_RULES.elements.get(node.type);
  return { ...kept, stored: node.tag ?? '', suggestions: element === undefined ? NO_SUGGESTIONS : equivalentTags(element) };
}

// An attribute field that keeps its text (keptTextOf): a one-line text field of its door, standing for its arguments,
// whose text fills the command's argument named for it. Typing changes only the field, which keeps its keys (the
// field key context binds no Enter). The field is the one field of a form of its own, so Enter submits it, as the
// browser submits a form implicitly (no key is handled here): the submission keeps its text, and so does leaving the
// field (Tab, a click elsewhere) or its going (another selection, another tab), whenever the text differs from the one
// it last showed or kept; each keeping is one undo step (keepAfterGesture), for the node the field was drawn for. The
// field shows what keptTextOf says the node stores: when it is drawn, when that value changes, and after every command
// that says something (the value kept, or refused while the document keeps its own). The values it suggests (the
// element's equivalent tags) are offered under it as the browser offers a list of suggestions for a text field. A
// field whose door's feature is not registered as built (the page's description, until page-seo-meta) is not
// available yet, although the command it shares is built.
export function KeptTextField({ entry, node, kept, label, attribute, keepOnLeave = true }: {
  readonly entry: DoorEntry;
  readonly node: DocNode;
  readonly kept: KeptText;
  readonly label: string;
  readonly attribute?: string;
  readonly keepOnLeave?: boolean
}) {
  const store = useStore();
  const t = useT();
  // an image's Source also suggests the images the project holds (spec explorer-assets-use): the library the Explorer
  // lists, offered right where the source is written
  const picksFiles = attribute !== undefined && filePickerOf(node) === attribute;
  const projectFiles = useEditorState((s) => (picksFiles ? JSON.stringify(imageFiles(s.document).map((file) => file.path)) : '[]'));
  const keptSuggestions = useMemo(() => (JSON.parse(projectFiles) as readonly string[]).length === 0 ? kept.suggestions : [...new Set([...kept.suggestions, ...(JSON.parse(projectFiles) as readonly string[])])], [kept.suggestions, projectFiles]);
  const { filled, stored } = kept;
  const suggestions = keptSuggestions;
  const json = JSON.stringify(kept.args);
  const args = useMemo(() => JSON.parse(json) as Readonly<Record<string, string>>, [json]);
  const door = useDoor(entry, args, label, isFeatureBuilt(entry.door.feature as FeatureId));
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const listId = useId();
  // the text the field last showed or kept: the field's own draft, never document state
  const draft = useRef({ shown: '' });
  const [typed, setTyped] = useState(stored);
  const said = useEditorState((s) => s.message);
  const command = entry.command.id;
  const owner = node.id;
  const refused = useSettingsRefusal(command, attribute, owner);
  const pickerType = attribute === 'value' ? inputValueEditorOf(node) : null;
  const pickerValue = pickerType === manifest.elements.inputValueEditors.color && !/^#[0-9a-f]{6}$/i.test(stored) ? '#000000' : stored;
  const dropped = attribute === 'inputType' && node.type === 'input' && typed !== stored && suggestions.includes(typed.trim().toLowerCase())
    ? droppedInputAttributes(node, typed.trim().toLowerCase())
    : [];
  const droppedLabels = dropped.map((id) => ATTRIBUTES.get(id)?.labelKey).filter((key): key is string => key !== undefined).map((key) => t(key as MessageId));
  useEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.value = stored;
    draft.current.shown = stored;
    markFieldKept(element, stored);
    setTyped(stored);
    return restoreFieldDraft(element, () => {
      recordFieldInput(element, new Event('input'));
      setTyped(element.value);
    });
  }, [stored, said]);
  // the field the inspector was asked to show (inspector.reveal) takes the focus
  const revealed = useEditorState((s) => s.ui.revealed);
  useEffect(() => {
    if (revealed !== undefined && revealed.field === attribute) field.current?.focus();
  }, [revealed, attribute]);
  useEffect(() => {
    const row = form.current;
    const element = field.current;
    const typing = draft.current;
    if (row === null || element === null) return;
    const keep = () => {
      const text = element.value;
      if (text === typing.shown) return;
      // a quick panel field keeps what it holds only while the panel is open (spec quick-panel)
      if (!keepOnLeave && !quickPanelOpen(store.getState().ui)) return;
      typing.shown = text;
      keepAfterGesture(store, () => {
        // nothing is kept for a node the document no longer holds
        if (locate(store.getState().document, owner) === null) return;
        (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(command, { ...args, [filled]: text });
      });
    };
    // the form's submission never leaves the editor
    const submit = (event: Event) => {
      event.preventDefault();
      keep();
    };
    row.addEventListener('submit', submit);
    const onInput = (event: Event) => {
      recordFieldInput(element, event);
    };
    element.addEventListener('input', onInput);
    element.addEventListener('blur', keep);
    return () => {
      row.removeEventListener('submit', submit);
      element.removeEventListener('input', onInput);
      element.removeEventListener('blur', keep);
      // the field goes (another selection, another tab) with a text not kept yet: it is kept — unless it is a quick
      // panel field, whose dismissal cancels what it held (spec quick-panel)
      if (keepOnLeave) keep();
    };
  }, [store, command, args, filled, owner, keepOnLeave]);
  const choose = (value: string) => {
    if (field.current === null) return;
    field.current.value = value;
    draft.current.shown = value;
    setTyped(value);
    refused.dismiss();
    keepAfterGesture(store, () => {
      if (locate(store.getState().document, owner) !== null)
        (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(command, { ...args, [filled]: value });
    });
  };
  return (
    <form ref={form} className={`field-row${door.available ? '' : ' is-unavailable'}${refused.text !== null ? ' is-invalid' : ''}`} data-door={entry.ref} data-args={JSON.stringify(args)} title={door.title}>
      <span className="field-row__label">{label}</span>
      {kept.multiline === true ? (
        <textarea ref={field} className="input input--area" rows={4} disabled={!door.available} aria-label={label} aria-invalid={refused.text !== null} spellCheck={false} onInput={(event) => { setTyped(event.currentTarget.value);
          refused.dismiss();
        }} />
      ) : (
        <span className="settings-field__value">
          <input ref={field} className="input" disabled={!door.available} aria-label={label} aria-invalid={refused.text !== null} placeholder={(attribute === 'buttonType' || attribute === 'inputType') && stored === '' ? suggestions[0] : undefined} spellCheck={false} list={suggestions.length > 0 ? listId : undefined} onInput={(event) => { setTyped(event.currentTarget.value);
            refused.dismiss();
          }} />
          {pickerType !== null ? (
            <input className="settings-field__picker" type={pickerType} aria-label={t('settings.valuePicker', { attribute: label })} disabled={!door.available} value={pickerValue} onChange={(event) => choose(event.currentTarget.value)} />
          ) : null}
          {/* the choose buttons are drawn as their icon in the field's 24 px cell, their names their tooltips (J28: the
              text ran over the path the field holds) */}
          {picksFiles && SOURCE_CHOOSE !== null ? <DoorControl entry={SOURCE_CHOOSE} args={{ attribute }} className="settings-field__picker" icon={PICK_FILE_ICON} /> : null}
          {attribute !== undefined && attribute === HREF_ATTRIBUTE && HREF_CHOOSE !== null ? <DoorControl entry={HREF_CHOOSE} args={{ target: node.id }} className="settings-field__picker" icon={PICK_LINK_ICON} /> : null}
        </span>
      )}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} disabled={!door.available} />
      {suggestions.length > 0 ? (
        <datalist id={listId}>
          {suggestions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      ) : null}
      {droppedLabels.length > 0 ? <span className="field-row__warning" role="status">{t('settings.inputTypeDrops', { attributes: droppedLabels.join(', ') })}</span> : null}
      {attribute !== undefined && holdsExecutableCode(typed) ? <span className="field-row__warning" role="status">{t('settings.embedRunsCode')}</span> : null}
      {refused.text !== null ? <span className="field-row__refusal" role="alert">{refused.text}</span> : null}
    </form>
  );
}

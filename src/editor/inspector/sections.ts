// The inspector's sections (INVENTORY.md, owners; spec inspector-panel): which of them are collapsed, and
// what a collapsed section's header summarises.
//
// inspector.toggleSection collapses or expands one section. Every section starts open;
// the collapsed set is one per section, the same for every element (spec, Problems in Pager 1), so it survives
// selection changes, and it lives in the preferences (src/editor/preferences/preferences.ts), which keep it after a
// reload. Toggling records nothing in the history and never touches the document.
//
// A collapsed section's header summarises the values in force of the properties and composites its manifest entry
// names (properties.json sections[].summary). Most read CSS computed values; Border reads the document's declarations
// because the scaled canvas changes CSSOM border widths. How each section writes them is below (SUMMARIES); the words
// come from the catalogue.
import { message, registerHandler, type RegisteredHandler } from '../../core/commands/registry.ts';
import { classesOf } from '../../core/design/classes.ts';
import { locate, type DocNode, type DocumentJson } from '../../core/document/model.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import type { StoreState } from '../../core/store/store.ts';
import { shownText } from '../../core/style/set.ts';
import { fold } from '../../core/text/fold.ts';
import type { CommandArgs } from '../../generated/commands.ts';
import { SECTION_IDS, type MessageId, type SectionId } from '../../generated/ids.ts';
import type { Locale } from '../../i18n/index.ts';
import { pluralForm } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';
import { chosen } from '../preferences/said.ts';
import { styleClassOf } from './style-target.ts';
import { withInspectorTab } from '../workspace/layout.ts';
import { withInspector } from '../workspace/panels.ts';
import { registerReferenceKind } from '../../core/store/references.ts';

// no element holds anything (nothing selected): every section the user has not opened stays collapsed
const EMPTY_HELD: ReadonlySet<string> = new Set();

// the inspector's tabs that show an attribute's field and a property's field (PRODUCT.md §5.3)
const SETTINGS_TAB = 'settings';
const STYLE_TAB = 'style';

// The value types the colour fields hold, read from the manifest: the properties whose control is the colour field.
// Whether a property or a composite is a colour is then read against them, never against a name written here.
const COLOUR_TYPES: ReadonlySet<string> = new Set(manifest.properties.properties.filter((p) => p.control === 'color-field').map((p) => p.valueType));

// Whether a property or a composite is a colour: every longhand it writes holds one of them (properties.json). The
// fields whose colour is a part of a larger value (a border's colour, a shadow's, a gradient stop's) show it as a
// sample; the picker opens where the colour is the whole value (the user's real-use audit, A3.29).
export function isColourValue(id: string): boolean {
  const composite = manifest.properties.composites.find((c) => c.id === id);
  const names = composite === undefined ? [id] : composite.longhands;
  return names.every((name) => {
    const type = manifest.properties.properties.find((p) => p.id === name)?.valueType;
    return type !== undefined && COLOUR_TYPES.has(type);
  });
}

function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && (SECTION_IDS as readonly string[]).includes(value);
}

const NONE: readonly SectionId[] = [];

// the sections the user collapsed, in their order; and the ones the user opened although the element holds nothing
// in them (the opening rule below) — both live in the preferences, so they survive a reload
export function collapsedSections(ui: EditorUi): readonly SectionId[] {
  return ui.preferences.collapsedSections ?? NONE;
}
const openedSections = (ui: EditorUi): readonly SectionId[] => ui.preferences.expandedSections ?? NONE;

// The properties a section holds (properties.json), for the rule below and the header's count.
export function sectionProperties(section: SectionId): readonly string[] {
  return manifest.properties.properties.filter((p) => p.section === section).map((p) => p.id);
}

// Whether the element holds a value in the section: the properties the section holds, read on the element's own
// styles at the base breakpoint and state (the same set the header's "N set" counts).
function sectionHoldsValue(section: SectionId, held: ReadonlySet<string>): boolean {
  return sectionProperties(section).some((p) => held.has(p));
}

// Whether the section holds a property the manifest marks as essential (properties.json): the ones the panel shows at
// first (docs/PRODUCT.md, The interface contract), so a section that carries them stays open while the element has no
// value in it — the essentials are what the person came for, and a panel whose every section is a closed strip shows
// nothing at all (the user's correction, 2026-09-28).
function sectionEssential(section: SectionId): boolean {
  return manifest.properties.properties.some((p) => p.section === section && p.essential === true);
}

// Whether a section is drawn collapsed: what the user said, else — a section the element holds no value in is drawn
// collapsed (the user's real-use audit, item 5.1: the panel stays short, and the header's summary says what is in
// force; the mockup draws it so). A value set in the section opens it again by itself, and the user's own choice —
// opening an empty section, closing a full one — wins over the value.
export function sectionClosed(ui: EditorUi, section: SectionId, held: ReadonlySet<string>): boolean {
  if (collapsedSections(ui).includes(section)) return true;
  if (openedSections(ui).includes(section)) return false;
  // a section that carries the essentials stays open with no value set: it is what the panel shows at first
  return !sectionEssential(section) && !sectionHoldsValue(section, held);
}

// The properties a styles object holds, in any layer (every breakpoint, every state).
function heldInStyles(styles: DocNode['styles'] | undefined): ReadonlySet<string> {
  const held = new Set<string>();
  for (const states of Object.values(styles ?? {})) {
    for (const declarations of Object.values(states ?? {})) for (const property of Object.keys(declarations ?? {})) held.add(property);
  }
  return held;
}

// The properties the edit target holds a value of, in any layer: the element, or the class definition while a class is
// the target. The panel's counts, its Essentials filter, the sections' opening and the header's origin dot read this
// one answer, so a value authored on the class or at another breakpoint is never invisible (the interface audit,
// findings F05 and F17). emptyHeld for nothing selected.
export function authoredProperties(state: StoreState<EditorUi>): ReadonlySet<string> {
  const className = styleClassOf(state);
  if (className !== null) return heldInStyles(classesOf(state.document).find((one) => one.name === className)?.styles);
  const node = state.selection.length === 1 ? (locate(state.document, state.selection[0] ?? '')?.node ?? null) : null;
  return node === null ? EMPTY_HELD : heldInStyles(node.styles);
}

export const toggleSection = registerHandler<'inspector.toggleSection', EditorUi>('inspector.toggleSection', ({ state }, { section }) => {
  // the header door of a section names it; anything else is a defect of the door
  if (!isSectionId(section)) throw new Error(`inspector.toggleSection: the inspector has no section ${section}`);
  // what the edit target holds decides what the click does to a section nobody has touched yet: the door opens a
  // section drawn collapsed and closes one drawn open, the way the header reads to the person clicking it
  const closed = sectionClosed(state.ui, section, authoredProperties(state));
  const drop = (list: readonly SectionId[]) => list.filter((s) => s !== section);
  const add = (list: readonly SectionId[]) => SECTION_IDS.filter((s) => s === section || list.includes(s));
  const { collapsedSections: wasClosed, expandedSections: wasOpen, ...rest } = state.ui.preferences;
  void wasClosed;
  void wasOpen;
  // drawn collapsed: the click opens it, and it stays open for this user whatever the element holds; drawn open: the
  // click closes it, and it stays closed
  const collapsed = closed ? drop(collapsedSections(state.ui)) : add(collapsedSections(state.ui));
  const expanded = closed ? add(openedSections(state.ui)) : drop(openedSections(state.ui));
  return {
    kind: 'change',
    ui: { ...state.ui, preferences: { ...rest, collapsedSections: collapsed.length > 0 ? collapsed : undefined, expandedSections: expanded.length > 0 ? expanded : undefined } },
  };
});

// inspector.setMode (spec inspector-advanced-mode): the Style tab shows every property that applies (All properties,
// the default) or its essentials only (the properties properties.json marks essential, a composite when one of its
// longhands is; a field whose property the element holds a value for, or the one just revealed, shows in both). An
// editor preference, kept after a reload; nothing in the document changes.
export type InspectorMode = CommandArgs['inspector.setMode']['mode'];
export const inspectorMode = (ui: EditorUi): InspectorMode => ui.preferences.inspectorMode ?? 'all';

export const setMode: RegisteredHandler<'inspector.setMode', EditorUi> = registerHandler(
  'inspector.setMode',
  ({ state }, { mode }) => {
    const { inspectorMode: _dropped, ...rest } = state.ui.preferences;
    void _dropped;
    return { kind: 'change', ui: { ...state.ui, preferences: mode === 'essentials' ? { ...rest, inspectorMode: mode } : rest }, message: chosen(setMode.command, { mode }) };
  },
  (state, args) => inspectorMode(state.ui) === args.mode,
);

// The essentials (spec inspector-advanced-mode, PP_ESSENTIAL): the properties and composites properties.json marks,
// each by its own entry — a composite is essential as the composite (Border), not through a longhand of it.
const ESSENTIAL = new Set([
  ...manifest.properties.properties.filter((p) => p.essential).map((p) => p.id),
  ...manifest.properties.composites.filter((c) => c.essential).map((c) => c.id),
]);
// the properties a field edits: its property, a composite's longhands (LONGHANDS, below), a recipe's own id
export const editedProperties = (target: string): readonly string[] => LONGHANDS.get(target) ?? [target];
// What an editor control edits (the alignment matrix, a spacing box, a shadow editor): properties.json lists the door
// of every property, composite and recipe among its doors, so a control the inspector draws from a door the manifest
// declares there reads its properties here — the applicability rules then read it as they read a field's.
const BY_DOOR = new Map<string, string[]>();
for (const entry of [...manifest.properties.properties, ...manifest.properties.composites, ...(manifest.properties.recipes ?? [])]) {
  for (const ref of entry.doors) BY_DOOR.set(ref, [...(BY_DOOR.get(ref) ?? []), entry.id]);
}
export const editedPropertiesByDoor = (ref: string): readonly string[] | null => BY_DOOR.get(ref) ?? null;
// whether a field of this property, composite or recipe is one of the essentials: the target itself, or one of the
// longhands it writes (a longhand marked essential keeps the composite that writes it drawn too)
export const isEssential = (target: string): boolean => ESSENTIAL.has(target) || editedProperties(target).some((p) => ESSENTIAL.has(p));

// ---------------------------------------------------------------- summaries

// What a section's summary reads, in the order its manifest entry names them: each a property (its value) or a
// composite (the values of its longhands, in the composite's order).
const LONGHANDS = new Map<string, readonly string[]>([
  ...manifest.properties.properties.map((p) => [p.id, [p.id]] as const),
  ...manifest.properties.composites.map((c) => [c.id, c.longhands] as const),
]);
const READS = new Map<SectionId, readonly (readonly string[])[]>(
  manifest.properties.sections.map((s) => [
    s.id as SectionId,
    s.summary.map((id) => {
      const longhands = LONGHANDS.get(id);
      if (longhands === undefined) throw new Error(`properties.json: the summary of the section ${s.id} names ${id}, which is no property or composite`);
      return longhands;
    }),
  ]),
);

// The CSS properties a section's summary reads on the page, for the page reader (coordinates.ts computedValues).
export function summaryProperties(section: SectionId): readonly string[] {
  return (READS.get(section) ?? []).flat();
}

// A border's CSSOM width is rounded to device pixels in the scaled canvas frame. The inspector must instead report
// the declarations in force: an element's own layer first, then its classes in stylesheet order. Missing longhands
// take their CSS initial value, without measuring the page or its zoom.
export function declaredBorderValues(document: DocumentJson, node: DocNode, rules: ModelRules): Readonly<Record<string, string>> {
  const declared = (property: string): string | undefined => {
    const own = shownText(node, property, rules);
    if (own !== undefined) return own;
    for (const styleClass of [...classesOf(document)].reverse()) {
      if (!node.classes.includes(styleClass.name)) continue;
      const value = shownText({ ...node, styles: styleClass.styles }, property, rules);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  return Object.fromEntries(summaryProperties('border').map((property) => {
    const value = declared(property);
    if (value !== undefined) return [property, value];
    if (property.endsWith('-style')) return [property, 'none'];
    if (property.endsWith('-width')) {
      const style = declared(property.slice(0, -'-width'.length) + '-style');
      return [property, style === undefined || style === 'none' || style === 'hidden' ? '0px' : 'medium'];
    }
    return [property, '0px'];
  }));
}

type Words = (key: MessageId, params?: Readonly<Record<string, string | number>>) => string;
// one read item: its longhands' values, in order
type Item = readonly string[];

const isZero = (value: string) => value.trim() !== '' && Number.parseFloat(value) === 0 && /^-?0*\.?0*[a-z%]*$/.test(value.trim());
const allZero = (values: Item) => values.every(isZero);
// four sides (top, right, bottom, left) written as their shorthand would write them: one, two, three or four values
function sides(values: Item): string {
  const [top = '', right = top, bottom = top, left = right] = values;
  if (top === right && top === bottom && top === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}
// a colour whose alpha is zero: rgba(…, 0), or a colour function's "/ 0"
const isTransparent = (colour: string) => colour === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(colour) || /\/\s*0(?:\.0+)?\)$/.test(colour);
// a value that says nothing about the advanced properties: the writing mode, the containment and the hyphenation are
// each left out of the header while they stand at their initial value
const NEUTRAL_ADVANCED = new Set(['horizontal-tb', 'visible', 'manual']);
// a value that is none, or the number 1 (opacity, scale), does nothing
const isNoEffect = (value: string) => value === 'none' || value === '1' || value === '';
const first = (item: Item | undefined) => item?.[0] ?? '';

// How each section writes what it reads (the items, in its manifest order); null: the section has no summary.
const SUMMARIES: Readonly<Record<SectionId, ((items: readonly Item[], words: Words, locale: Locale) => string) | null>> = {
  content: null,
  // the advanced values that say something, in the summary's own order (writing mode, containment, hyphenation), and
  // None while all of them stand at their initial value — the section's properties are rare, so the values themselves
  // are what the header tells, and the fields' own count is already on the badge (the owner's call, the dogfooding
  // pass)
  advanced: (items, words) => joined(items.map(first).filter((value) => value !== '' && !NEUTRAL_ADVANCED.has(value)), words),
  // the display, and the direction of a flex layout
  layout: ([display, direction], words) => (first(display).includes('flex') ? words('inspector.summary.pair', { first: first(display), second: first(direction) }) : first(display)),
  // M margin · P padding, each left out when it is zero on every side
  space: ([margin = [], padding = []], words) => {
    const parts = [
      ...(allZero(margin) ? [] : [words('inspector.summary.margin', { value: sides(margin) })]),
      ...(allZero(padding) ? [] : [words('inspector.summary.padding', { value: sides(padding) })]),
    ];
    return joined(parts, words);
  },
  size: ([width, height], words) => words('inspector.summary.size', { width: first(width), height: first(height) }),
  position: ([position, zIndex], words) => words('inspector.summary.position', { position: first(position), zIndex: first(zIndex) }),
  // the background colour, or None when it is transparent
  paint: ([background], words) => (isTransparent(first(background)) ? words('inspector.summary.none') : first(background)),
  // the edge (width and style) when a side has a style, and R radius when a corner is rounded
  border: ([width = [], style = [], radius = []], words) => {
    const parts = [
      ...(style.every((s) => s === 'none' || s === 'hidden') ? [] : [words('inspector.summary.edge', { width: sides(width), style: sides(style) })]),
      ...(allZero(radius) ? [] : [words('inspector.summary.radius', { value: sides(radius) })]),
    ];
    return joined(parts, words);
  },
  text: ([size, weight], words) => words('inspector.summary.pair', { first: first(size), second: first(weight) }),
  // how many of the effects it reads are on
  effects: (items, words, locale) => {
    const count = items.filter((item) => !item.every(isNoEffect)).length;
    return count === 0 ? words('inspector.summary.none') : words(`inspector.summary.effects.${pluralForm(locale, count)}`, { count });
  },
  interactions: null,
};

function joined(parts: readonly string[], words: Words): string {
  if (parts.length === 0) return words('inspector.summary.none');
  return parts.reduce((all, part) => words('inspector.summary.pair', { first: all, second: part }));
}

// The summary of a section from the values the page computes (property → value), or null when the section has none
// or the page does not draw the element.
export function summaryOf(section: SectionId, values: Readonly<Record<string, string>> | null, words: Words, locale: Locale): string | null {
  const write = SUMMARIES[section];
  if (write === null || values === null) return null;
  const items = (READS.get(section) ?? []).map((longhands) => longhands.map((p) => values[p] ?? ''));
  return write(items, words, locale);
}

// inspector.reveal (spec elements-form-inputs-rules, Problems in Pager 1): the inspector shows the field of a property
// (the Style tab) or of an attribute (the Settings tab), opened if hidden, and that field takes the focus; a
// double-click on a form control on the canvas reveals its Value field, where its value is edited. Nothing in the
// document changes and nothing is recorded. `revealed` counts the requests, so a field tells a new one from one it
// has answered.
export interface Revealed {
  readonly field: string;
  readonly count: number;
}

export const revealField = registerHandler<'inspector.reveal', EditorUi>('inspector.reveal', ({ state }, { property, attribute }) => {
  const field = attribute ?? property;
  if (field === undefined) return { kind: 'change' };
  const shown = withInspectorTab(withInspector(state.ui, true), attribute !== undefined ? SETTINGS_TAB : STYLE_TAB);
  return { kind: 'change', ui: { ...shown, revealed: { field, count: (state.ui.revealed?.count ?? 0) + 1 } } };
});

// Find a property (spec inspector-property-search): inspector.search keeps the Style tab's query in the editor state
// (ui.inspectorSearch, as typed; absent once nothing but spaces is left), never in the document; the tab draws only
// what searchMatches keeps.
export const inspectorSearchOf = (ui: EditorUi): string => ui.inspectorSearch ?? '';
export const searchInspector = registerHandler<'inspector.search', EditorUi>('inspector.search', ({ state }, { query }) => {
  const typed = query.trim();
  const { inspectorSearch: _was, ...rest } = state.ui;
  void _was;
  if (typed === '') return { kind: 'change', ui: rest, message: message('status.inspector.searchCleared') };
  return { kind: 'change', ui: { ...rest, inspectorSearch: query }, message: message('status.inspector.searchFor', { query: typed }) };
});

// Whether a field or an editor control of the Style tab matches a query: the query (case and accents ignored) is part
// of its label as shown, or of one of the CSS names it edits. An empty query matches everything.
export function searchMatches(query: string, label: string, cssNames: readonly string[]): boolean {
  const wanted = fold(query.trim());
  if (wanted === '') return true;
  return fold(label).includes(wanted) || cssNames.some((name) => fold(name).includes(wanted));
}

// a section of the inspector an argument names (manifest refers: inspector-section)
registerReferenceKind('inspector-section', (_document, section) => isSectionId(section));

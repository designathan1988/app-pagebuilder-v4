// The manifest is the single contract of the product: every command, every door
// (entry point) and every scenario is data in manifest/, validated by these schemas.
// Every object is strict, so an unknown field is an error, and every field is
// required, so a missing field is an error. Types are derived from the schemas.
// Data holds no logic: predicates, actions, codecs and handlers are named by id and
// listed in references.json; no field holds an expression (manifest:check rule no-logic).
import { z } from 'zod';

const featureId = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'a kebab-case feature id');
const commandId = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, 'a dotted camelCase command id');
const doorId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'a kebab-case door id');
const doorRef = z.string().regex(/^[a-z][a-zA-Z0-9.]*#[a-z0-9-]+$/, 'a door reference "<command>#<door>"');
const i18nKey = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/, 'a dotted i18n key');
// A reference into the one behaviour file: the section's id is the anchor (spec/BEHAVIOUR.md#<id>), so one document
// holds every spec and a manifest entry points at its section of it.
const specPath = z.string().regex(/^spec\/BEHAVIOUR\.md#[a-z0-9-]+$/, 'a section of spec/BEHAVIOUR.md (spec/BEHAVIOUR.md#<id>)');
const camelId = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'a camelCase id');
const kebabId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'a kebab-case id');
const constantId = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/, 'a dotted constant id');
// a CSS property name as the official data writes it (vendor-prefixed names start with "-")
const cssName = z.string().regex(/^-?[a-z]+(-[a-z0-9]+)*$/, 'a CSS property name');
const htmlTag = z.string().regex(/^[a-z][a-z0-9]*$/, 'an HTML tag name');
const ownerPath = z.string().regex(/^src\/[a-z0-9/-]+\.ts$/, 'a planned module path under src/');
// an icon of the editor's one icon library, Lucide : manifest:check rule icon-name proves it
// exists
const iconName = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'a Lucide icon name');
// a predicate, codec or action id: code registers it under this id (references.json)
const predicateId = camelId;
const codecId = kebabId;
const actionId = camelId;

const localeSchema = z.enum(['pt-BR', 'en']);

// JSON values, for document diffs and fixed door arguments.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

// ---------------------------------------------------------------- environment

export const environmentSchema = z.strictObject({
  browser: z.strictObject({ channel: z.literal('chrome') }),
  viewports: z
    .array(z.strictObject({ id: kebabId, width: z.number().int().positive(), height: z.number().int().positive() }))
    .min(1),
  locales: z.strictObject({ default: localeSchema, available: z.array(localeSchema).min(1) }),
  // a fresh profile's theme: one of the themes preferences.setTheme offers (manifest:check rule unknown-reference)
  theme: z.strictObject({ default: kebabId }),
  // the canvas zoom levels, in percent, a scenario may start at (setup.zoom)
  zoomLevels: z.array(z.number().int().positive()).min(1),
  reducedMotion: z.boolean(),
});

// ---------------------------------------------------------------- elements (editor data only)
// The content model (permitted children and parents, void and text-only elements) is not here:
// it comes from manifest/generated/html-elements.json, keyed by tag.

const elementSchema = z.strictObject({
  id: camelId,
  // null only for an element that writes its markup verbatim (content "markup" without its own tag)
  tag: htmlTag.nullable(),
  // "svg": the tag is an SVG element, placed only inside a foreign (svg) element
  namespace: z.enum(['html', 'svg']),
  alternativeTags: z.array(htmlTag),
  labelKey: i18nKey,
  // the element's icon in Layers, the Insert grid and the breadcrumb: an icon of the library (rule icon-name)
  icon: iconName,
  palette: z.boolean(),
  // how the editor edits what is inside: element children, rich text, verbatim markup, or nothing
  content: z.enum(['children', 'text', 'markup', 'none']),
  // what a new element is created holding, so it is never empty: one element type, or several in order (a definition
  // list's term and description)
  naturalChild: z.union([camelId, z.array(camelId).min(1)]).nullable(),
  // longhand property → value
  defaultStyles: z.record(cssName, z.string()),
  defaultTextKey: i18nKey.nullable(),
  // The attribute whose field picks a file of the project (an image's Source: "src"; spec explorer-assets-use): its
  // field offers the project's images, the ones the Explorer's Files list holds. Null or absent: no field of the
  // element picks a file.
  filePicker: camelId.nullable().optional(),
  // A block a page is built of, one after another (a section, a header, a footer; spec palette-click-insert, Problems
  // 4): one clicked from the palette with a selection lands right after the page block holding the selection, never
  // inside it. Absent: false.
  pageBlock: z.boolean().optional(),
});

const attributeSchema = z.strictObject({
  id: camelId,
  // its attribute's name in the markup: HTML's, or SVG's, whose may hold digits (a line's x1, y2)
  html: z.string().regex(/^[a-z][a-z0-9-]*$/).nullable(),
  labelKey: i18nKey,
  valueType: z.enum(['text', 'url', 'number', 'boolean', 'keyword', 'id-ref', 'markup', 'tag', 'class-list', 'path-list']),
  // for a keyword attribute, the values offered: each is in the attribute's generated HTML enum
  keywords: z.array(z.string()),
  elements: z.union([z.literal('all'), z.array(camelId).min(1)]),
  command: commandId,
  // one of HTML's global attributes: every tag takes it, so a tag switch never drops it and the Settings always shows
  // its field (the audit's A3.7)
  global: z.boolean().optional(),
  // an empty text is a value of its own and is stored (alt: an image with no alternative text is decorative, and the
  // export writes alt=""; the audit's A3.6); absent: emptying the field removes the attribute
  keepsEmpty: z.boolean().optional(),
  // a page setting written in the exported head as "<form>:<name>" (meta:description, meta:og:title, link:canonical,
  // link:icon, script:), or null: the export writes it there rather than as an attribute (the audit A3.39/7.2)
  head: z.string().regex(/^(meta|link|script):[a-zA-Z0-9:-]*$/).nullable().optional(),
});

const settingsSectionSchema = z.strictObject({
  id: kebabId,
  labelKey: i18nKey,
  descriptionKey: i18nKey,
  elements: z.union([z.literal('all'), z.array(camelId).min(1)]),
  attributes: z.array(camelId),
});

// A node of a template's tree (a palette entry of kind "template"): its element type, the tag when not its first one,
// its name and text as catalogue keys (in the person's language), a wrapper whose styles it takes (the wrap commands'
// Row and Column), its styles at the base breakpoint and state, its attributes, and its children; without children, it
// holds its natural children like any new element.
export interface TemplateNode {
  readonly element: string;
  readonly tag?: string | undefined;
  readonly nameKey?: string | undefined;
  readonly textKey?: string | undefined;
  readonly wrapper?: string | undefined;
  readonly styles?: Readonly<Record<string, string>> | undefined;
  readonly attributes?: Readonly<Record<string, string | number | boolean>> | undefined;
  readonly children?: readonly TemplateNode[] | undefined;
}
const templateNodeSchema: z.ZodType<TemplateNode> = z.lazy(() =>
  z.strictObject({
    element: camelId,
    tag: z.string().optional(),
    nameKey: i18nKey.optional(),
    textKey: i18nKey.optional(),
    wrapper: kebabId.optional(),
    styles: z.record(cssName, z.string().min(1)).optional(),
    attributes: z.record(camelId, z.union([z.string(), z.number(), z.boolean()])).optional(),
    children: z.array(templateNodeSchema).optional(),
  }),
);

const paletteEntrySchema = z.strictObject({
  id: kebabId,
  labelKey: i18nKey,
  element: camelId,
  kind: z.enum(['element', 'template']),
  inputType: z.string().nullable(),
  feature: featureId,
  // the tree a template inserts (kind "template"); absent for an element entry
  template: templateNodeSchema.optional(),
  // the tile's icon where the element's own does not say which entry it is (every input type is an input: the audit
  // of 2026-10-05 found eleven field tiles wearing one icon); absent: the element's icon
  icon: iconName.optional(),
});

const paletteGroupSchema = z.strictObject({
  id: kebabId,
  labelKey: i18nKey,
  entries: z.array(paletteEntrySchema).min(1),
});

// The Row, Column, Container and Grid wrappers (element.wrapRow, element.wrapColumn, element.wrapContainer,
// element.wrapGrid; spec wrap-row-column, Problems 1 and 3; the user's real-use audit, item 8.1): one definition each,
// the same for every door and for the layout templates. The new node is an element of `element`, named by `nameKey` in
// the person's language, with `styles` (longhand property → value) at the base breakpoint and state, and nothing else.
const wrapperSchema = z.strictObject({
  id: z.enum(['row', 'column', 'container', 'grid']),
  element: camelId,
  nameKey: i18nKey,
  styles: z.record(cssName, z.string()),
  // The styles a wrapper built by a key or a side drop writes on its children, so every path builds the same wrapper
  // as the template does (the Row's columns grow alike: spec wrap-row-column, Problems in Pager 4)
  childStyles: z.record(cssName, z.string()).optional(),
  // The wrapper lays one equal track per element it holds (the grid wrapper): grid-template-columns is written for the
  // count of its children at the base breakpoint and, per breakpoint, the number interactions.json names
  // (layout.gridTracks.<breakpoint>: two at Tablet while it holds more, one at Phone), the responsive grid the user's
  // real-use audit asks for (item A1.4). The wrap command and the template that names this wrapper both write it.
  perChildTracks: z.boolean().optional(),
});

export const elementsFileSchema = z.strictObject({
  elements: z.array(elementSchema).min(1),
  attributes: z.array(attributeSchema).min(1),
  settingsSections: z.array(settingsSectionSchema).min(1),
  autocompleteTokens: z.array(z.string().min(1)).min(1),
  inputValueEditors: z.record(z.string(), z.enum(['date', 'time', 'month', 'week', 'datetime-local', 'color', 'number'])),
  palette: z.array(paletteGroupSchema).min(1),
  wrappers: z.array(wrapperSchema).min(1),
});

// ---------------------------------------------------------------- properties (the editor layer)
// Keywords, units and longhand lists are never written here: they come from
// manifest/generated/css-properties.json, and manifest:check validates every value a door offers
// or writes against the property's official syntax with CSSTree's lexer.
// What browsers implement comes from manifest/generated/css-compat.json (MDN's browser-compat-data):
// a property or keyword is edited only when Chrome, Firefox and Safari all support it. The document
// stores the finest-grained property browsers implement: the longhands when every engine implements
// all of them (a composite writes them). When an engine lacks a longhand, the manifest declares the
// choice: a composite that omits the missing longhands (omits, with the reason), or the shorthand
// stored whole (storedWhole, with the reason: box-shadow, text-align, vertical-align).

// The browsers an exported site must work in.
export const BROWSERS = ['chrome', 'firefox', 'safari'] as const;
export type Browser = (typeof BROWSERS)[number];

export const VALUE_TYPES = [
  'length',
  'length-percentage',
  'number',
  'integer',
  'percentage',
  'angle',
  'time',
  'color',
  'keyword',
  'image',
  'gradient',
  'shadow-list',
  'text-shadow-list',
  'transform-list',
  'font-family-list',
  'url',
  'string',
] as const;

const CONTROL_TYPES = [
  'keyword-menu',
  'keyword-buttons',
  'length-field',
  'number-field',
  'slider',
  'angle-field',
  'time-field',
  'color-field',
  'text-field',
  'font-menu',
  'image-field',
  'gradient-editor',
  'shadow-editor',
  'filter-editor',
  'transform-fields',
  'track-editor',
  'box-model',
  'border-editor',
  'radius-editor',
  'alignment-matrix',
  'anchor-control',
  // a longhand that has no control of its own: it is written only through its composite
  'part-of-composite',
] as const;

// A declared subset of what the generated data allows, with the reason the editor offers less.
// null for values or units means "the generated list" for that part.
const subsetSchema = z.strictObject({
  id: kebabId,
  values: z.array(z.string().min(1)).min(1).nullable(),
  units: z.array(z.string().min(1)).nullable(),
  reason: z.string().min(1),
});

// A value offered ready-made (the plan's stage 3, "valores com prévia"): its name in the catalogues and the CSS text
// it writes, drawn as a thumbnail of that value (src/editor/shell/value-presets.tsx).
const presetSchema = z.strictObject({
  id: kebabId,
  labelKey: i18nKey,
  value: z.string().min(1),
});

const propertySchema = z.strictObject({
  // the CSS property name: a longhand, or the coarser property browsers implement when an engine
  // lacks one of its longhands (css-compat.json)
  id: cssName,
  labelKey: i18nKey,
  section: kebabId,
  group: kebabId,
  control: z.enum(CONTROL_TYPES),
  // keyword → the icon its button shows, for a keyword-buttons control drawn as icon buttons (one icon for every
  // value its doors offer); empty when the buttons show the keywords as text
  icons: z.record(z.string(), iconName),
  valueType: z.enum(VALUE_TYPES),
  // parses and serialises the value; the document stores the canonical CSS text, or the typed
  // fields of a structured value type, which only the codec turns into CSS
  codec: codecId,
  // the element predicate that decides where the property applies
  appliesTo: predicateId,
  essential: z.boolean(),
  // every door that writes this property
  doors: z.array(doorRef),
  subsets: z.array(subsetSchema),
  // values offered ready-made, each drawn as a thumbnail of itself
  presets: z.array(presetSchema).optional(),
});

// A shorthand whose longhands every browser implements exists only as a composite control: its door
// writes every longhand in one command and one undo step, and rendering and export write the stored
// longhands as they are. A longhand an engine lacks is left out (omits, with the reason).
const compositeSchema = z.strictObject({
  id: kebabId,
  // the CSS shorthand this composite stands for; null for an editor composite (the alignment matrix)
  shorthand: cssName.nullable(),
  labelKey: i18nKey,
  section: kebabId,
  group: kebabId,
  control: z.enum(CONTROL_TYPES),
  codec: codecId,
  // (where it applies is its longhands' to say: the inspector shows a composite where every longhand applies)
  // the Essentials tab draws its rows (spec inspector-advanced-mode: "border", the composite, not its longhands)
  essential: z.boolean(),
  longhands: z.array(cssName).min(2),
  // longhands of the shorthand this composite never writes, and why
  omits: z.strictObject({ longhands: z.array(cssName).min(1), reason: z.string().min(1) }).nullable(),
  doors: z.array(doorRef),
  subsets: z.array(subsetSchema),
  // values offered ready-made, each drawn as a thumbnail of itself
  presets: z.array(presetSchema).optional(),
});

// A structured value type: the document stores typed fields, never CSS text, and the codec is the only
// code that turns them into CSS. Handles and fields edit one typed field (a door's adapter.fields).
// These value types of VALUE_TYPES are structured; each needs its structure declared in properties.json.
export const STRUCTURED_VALUE_TYPES: readonly (typeof VALUE_TYPES)[number][] = ['shadow-list', 'text-shadow-list'];
const STRUCTURE_FIELD_TYPES = ['length', 'color', 'boolean'] as const;
const structureSchema = z.strictObject({
  // a structured value type of VALUE_TYPES
  id: z.enum(VALUE_TYPES),
  codec: codecId,
  // true: the value is a list of layers (first painted on top), written comma-separated; none is the empty list
  list: z.boolean(),
  fields: z
    .array(
      z.strictObject({
        id: camelId,
        type: z.enum(STRUCTURE_FIELD_TYPES),
        // how the field reaches CSS: "value" writes it, "keyword" writes `keyword` when true, and
        // "hides-layer" keeps the layer in the document JSON but out of the CSS when true
        css: z.enum(['value', 'keyword', 'hides-layer']),
        keyword: z.string().min(1).nullable(),
        // for a length field, the unit list of manifest/generated/css-properties.json (units) it offers; null otherwise
        units: z.string().min(1).nullable(),
        // the field's value in the sample layer manifest:check serialises and matches against the syntax
        sample: z.union([z.string().min(1), z.boolean()]),
      }),
    )
    .min(1),
});

// A compatibility recipe: the declarations browsers need for one effect that no standard property
// provides in every engine (legacy line clamp; user-select, which Safari supports only prefixed).
// One door writes all of them in one command and one undo step, and clearing it removes all of them.
// Recipes are the only place where vendor-prefixed properties or values appear; their fixed values
// are matched against the syntax browsers implement (CSSTree's MDN data), because they exist for
// legacy values the official grammar does not define.
const recipeSchema = z.strictObject({
  id: kebabId,
  labelKey: i18nKey,
  section: kebabId,
  group: kebabId,
  control: z.enum(CONTROL_TYPES),
  codec: codecId,
  appliesTo: predicateId,
  // value null: the value the door edits
  declarations: z.array(z.strictObject({ property: cssName, value: z.string().min(1).nullable() })).min(2),
  // How the recipe shares the edited properties it also writes (the line clamp writes display, overflow-x
  // and overflow-y); null when it writes none. Applying the recipe keeps their previous values with it and
  // clearing it restores them; a door that writes one of them while the recipe is set clears the recipe
  // in the same command and undo step; their fields show the recipe while it is set.
  shared: z
    .strictObject({ clear: z.literal('restores-previous'), otherWrite: z.literal('clears-recipe') })
    .nullable(),
  // the spec section that defines the legacy behaviour, and the BCD entry that records the browsers' support
  // of the declaration that carries the door's value
  source: z.strictObject({
    spec: z.string().regex(/^https:\/\/\S+#\S+$/, 'a spec URL with its section anchor'),
    bcd: z.string().regex(/^css\.properties\.[a-z-]+$/, 'a BCD entry such as css.properties.line-clamp'),
  }),
  doors: z.array(doorRef),
});

// Closed lists: a coupling rule names one predicate and one action, never an expression.
export const COUPLING_PREDICATES = [
  'always', // no condition
  'valueIn', // the element's current value of `property` is one of `values`
  'valueNotIn', // the element's current value of `property` is none of `values`
  'parentValueIn', // the parent's current value of `property` is one of `values`
] as const;
export const COUPLING_ACTIONS = [
  'setValue', // also write `value` to `property` of the element
  'setParentValue', // also write `value` to `property` of the parent
  'swapWith', // the value meant for the trigger goes to `property`, and the other way round
  'keepVisualPlace', // also write `property` from the element's current rendered place
  'mirror', // the value about to be written to `property` is mirrored along its axis: flex-start ↔ flex-end, start ↔ end
] as const;

const couplingSchema = z.strictObject({
  id: kebabId,
  // the write that triggers the rule: a longhand, optionally only some values, optionally only from one composite
  trigger: z.strictObject({ property: cssName, values: z.array(z.string().min(1)).min(1).nullable(), via: kebabId.nullable() }),
  condition: z.strictObject({ predicate: predicateId, property: cssName.nullable(), values: z.array(z.string().min(1)) }),
  effect: z.strictObject({ action: actionId, property: cssName, value: z.string().min(1).nullable() }),
  // the feature that brings the rule
  feature: featureId,
});

export const propertiesFileSchema = z.strictObject({
  sections: z
    .array(
      z.strictObject({
        id: kebabId,
        labelKey: i18nKey,
        // what the header of the section summarises while it is collapsed, in order: properties or composites of
        // this file, read as the page computes them (src/editor/inspector/sections.ts writes them); empty for a
        // section the inspector draws no header for
        summary: z.array(z.union([cssName, kebabId])),
        groups: z.array(z.strictObject({ id: kebabId, labelKey: i18nKey })).min(1),
      }),
    )
    .min(1),
  // in cascade order: the first is the base breakpoint (base: true, the only one), the others inherit
  // from the one before them (desktop-first: Desktop, Laptop, Tablet, Phone)
  // A breakpoint's width is the page's usable width there; its height is the screen the canvas resolves vh, svh and dvh
  // against and the page breaks at (the fold lines; the user's real-use audit, item 2.3).
  breakpoints: z
    .array(z.strictObject({ id: kebabId, labelKey: i18nKey, width: z.number().int().positive(), height: z.number().int().positive(), base: z.boolean() }))
    .min(1),
  // the style states: the id the document stores, the label the menu shows, the pseudo-class (or pseudo-element) the
  // export writes, and the element ids it stands on (elements.json; null for every element) — an h2 takes no :disabled
  // (the user's real-use audit, item A3.36)
  states: z.array(z.strictObject({ id: kebabId, labelKey: i18nKey, pseudo: z.string().nullable(), elements: z.array(camelId).min(1).nullable() })).min(1),
  structures: z.array(structureSchema),
  properties: z.array(propertySchema).min(1),
  composites: z.array(compositeSchema),
  recipes: z.array(recipeSchema),
  // a coupling's effect runs inside the triggering command: same transaction, same undo step
  couplings: z.array(couplingSchema),
  // Availability predicates that read one value of the primary selected element: the predicate holds while the value
  // it holds for `property` is one of `values` (flexOrGridContainer: display is flex, inline-flex, grid or
  // inline-grid). Their code registers them (registerPredicate) and reads this data, never a property written by hand.
  valuePredicates: z.array(z.strictObject({ id: predicateId, property: cssName, values: z.array(z.string().min(1)).min(1) })),
  // The computed values the context predicates read (spec props-element-specific, "Our rule"): those of the selected
  // element, own, and those of its parent. The inspector reads them on the canvas and never names a property by hand.
  context: z.strictObject({ own: z.array(cssName).min(1), parent: z.array(cssName).min(1) }),
  // The pair rows of the Style tab : two properties or composites drawn side by side on
  // one row, under the row's own label — the first field's own name, or the concept both fields serve when the design
  // names it (the gap's two axes read "Gap", not "Row gap"). A row is where the fields are read together (width and
  // height, the two gap axes); every other field keeps a row of its own. A row may carry a short prefix for the fields
  // whose value would otherwise be ambiguous (the height's H, the gap axes' arrows).
  rows: z
    .array(
      z.strictObject({
        id: kebabId,
        // the section both fields live in (properties.json sections)
        section: kebabId,
        // the row's own label; null: the first field's label names the row
        labelKey: i18nKey.nullable(),
        // the fields, in the order they are drawn
        fields: z.array(z.strictObject({ target: z.union([cssName, kebabId]), prefixKey: i18nKey.nullable() })).min(2).max(2),
      }),
    ),
  // The concept rows of the Style tab (plan item 2.D; jornada02 G-S1): one row per concept, its head drawn always, its
  // details in an in-place disclosure (inspector.toggleRow). An item is a door of the Style tab ("<command>#<door>")
  // or a pair row ("pair:<id>"). A row with no head draws a summary head: its label (labelKey) and what its details
  // hold. Every item stands in one row, in the row's section (manifest:check rule concept-row).
  conceptRows: z.array(
    z.strictObject({
      id: kebabId,
      section: kebabId,
      labelKey: i18nKey.nullable(),
      head: z.array(z.string().min(1)),
      details: z.array(z.string().min(1)).min(1),
      // the shorter name a detail takes under the row that already names the concept ("Repeat" under Background), so
      // no label wraps in the 100 px column; a detail not listed keeps its own
      shortLabels: z.record(z.string(), i18nKey).optional(),
    }),
  ),
  // The Style tab's controls that edit no property of their own, and the section each is drawn in (null: above the
  // sections — the modes, Find a property). Every other Style door is placed by the property, composite or recipe its
  // field edits (src/manifest/style-places.ts); manifest:check refuses a Style door with no place (rule
  // style-door-section).
  controls: z.array(z.strictObject({ door: doorRef, section: kebabId.nullable() })),
  // Shorthands stored whole: an engine lacks one of their longhands, and the reason says why the
  // manifest stores the shorthand instead of a composite that omits the missing longhands.
  storedWhole: z.array(z.strictObject({ property: cssName, reason: z.string().min(1) })),
  // The lexer fallback allowlist: the only values accepted by the syntax browsers implement (CSSTree's
  // MDN data) where the official syntax rejects them or lacks a definition, each with its reason.
  // values null: every value of the property. recipe: the entry holds only for that recipe's
  // declarations, and it also vouches for its values where BCD does not track them.
  syntaxFallbacks: z.array(
    z.strictObject({
      property: cssName,
      values: z.array(z.string().min(1)).min(1).nullable(),
      recipe: kebabId.nullable(),
      reason: z.string().min(1),
    }),
  ),
});

// ---------------------------------------------------------------- interactions

// a key held through a gesture: a modifier, Space, or a letter held as a spring-loaded tool (the Layout tool's S and M)
const modifierKeySchema = z.enum(['Shift', 'Alt', 'Ctrl', 'Meta', 'Space', 'S', 'M']);

export const interactionsFileSchema = z.strictObject({
  keyContexts: z
    // absorbsFields: a field inside a region of this context runs the context's keys first and keeps its own after them
    // (the quick panel: Escape closes it wherever its focus is, while Enter and the arrows stay the field's)
    .array(z.strictObject({ id: kebabId, labelKey: i18nKey, inherits: kebabId.nullable(), absorbsFields: z.boolean() }))
    .min(1),
  constants: z
    .array(
      z.strictObject({
        id: constantId,
        value: z.union([z.number(), z.array(z.number()).min(1)]),
        unit: z.enum(['screen-px', 'css-px', 'ms', 'fraction', 'percent', 'deg', 'count', 'factor', 'zoom-percent']),
        source: specPath,
        note: z.string().min(1),
      }),
    )
    .min(1),
  // the properties the accessibility checks read (core/a11y/checks.ts): the text colour and the background it sits
  // on, so no property id is written by hand in the code
  checks: z.strictObject({ colourProperty: cssName, backgroundProperty: cssName }),
  // the label colours a Layers row offers (core/nodes/flags.ts element.setLayerColor): the design tokens whose values
  // the row draws as its palette, in their order
  layerColours: z.array(z.string().startsWith('--')).min(1),
  gestures: z
    .array(
      z.strictObject({
        id: kebabId,
        source: specPath,
        modifiers: z.array(z.strictObject({ key: modifierKeySchema, meaning: kebabId })),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------- commands and doors

const selectionNormalisationSchema = z.enum([
  'none', // the command does not act on the selection
  'primary', // the primary selected element
  'single', // exactly one selected element, refused otherwise
  'roots', // every selected root, in document order
  'roots-same-parent', // selected roots that share one parent, refused otherwise
  'all', // every selected element
  'target', // the element or item the door itself points at (row, option, pointer target)
  'focused-row', // the Layers row that has keyboard focus
]);

const offersSchema = z.strictObject({
  // the property, composite or recipe whose values the door offers
  property: z.union([cssName, kebabId]),
  // "generated": the keywords of manifest/generated/css-properties.json that css-compat.json says
  // Chrome, Firefox and Safari all support, and the units; otherwise the id of a subset declared on
  // that property or composite. An inspector field offers in All properties every value the browser data
  // allows, so its list is always "generated" (manifest:check rule all-properties); only a quick panel
  // field names a subset here.
  list: kebabId,
  // a list declared on that property or composite whose values an inspector field offers in All properties
  // besides the generated ones: the presets that compose values (font stacks, named weights 100 to 900,
  // "100% 100%", "top left"); null when it offers none
  presets: kebabId.nullable(),
  // the declared list an inspector field offers in Essentials only: never a value All properties lacks
  // (generated plus presets). null for every other door, and for a field that offers the same values in both modes
  essentials: kebabId.nullable(),
});

const adapterSchema = z.strictObject({
  selection: selectionNormalisationSchema,
  offers: offersSchema.nullable(),
  // the properties this door's hit area or control writes (never a shorthand whose longhands every
  // browser implements); a recipe door writes the recipe's declarations
  writes: z.array(cssName),
  // the typed fields of a structured value this door edits (a shadow layer's offsetX, blur...);
  // empty for a door that edits a plain value or adds, removes or resets whole layers
  fields: z.array(camelId),
  // How a door whose command takes a file reads the one the chooser hands over: "text" (the default: a project file
  // the command reads as text, File › Open), "upload" (the file's bytes and, for an image, its intrinsic size, which
  // core/project/files.ts readUploadFile reads; spec explorer-assets) or "folder" (a whole folder, File › Open folder:
  // the browser's directory picker, every file with the path it holds inside the folder; spec explorer-open-folder).
  // "data": a data file the Data panel imports, read into its sheets (src/editor/data/read-file.ts; spec content-data).
  // One chooser, one reader per kind, never two for one.
  fileReading: z.enum(['text', 'upload', 'folder', 'data']).optional(),
});

// A region of the interface PRODUCT.md §5.3 names (layout.json lists them); a menu's own region is "menu:<menu>".
const regionId = z.string().regex(/^[a-z]+(-[a-z]+)*(:[a-z]+(-[a-z]+)*)?$/, 'a region id such as "canvas-toolbar" or "menu:view"');

const placementSchema = z.union([
  z.literal('none'), // a key or a canvas gesture has no control of its own
  z.literal('unplaced'), // not placed yet: manifest:check rule placement refuses it
  // the region of PRODUCT.md §5.3 that draws the control, and its position there (1 first)
  z.strictObject({ region: regionId, order: z.number().int().positive() }),
]);

// How a toolbar or panel control is drawn : an icon button (the icon alone, the label as its
// tooltip), a button (its label, after its icon when it has one), the primary button (a button filled with the accent,
// the region's main action), one of a segmented group, a tab, an item (a row, a tile, a file tab, a chip, the page
// switcher: its icon and text come from the item it stands for), a field (an input, or a control drawn as one, such as
// the palette's search), a toggle, an area of a larger control (a ruler, a matrix, a backdrop), or a disclosure (a
// caret or a section header, whose icon is the layout's expanded or collapsed glyph, by its state, and never its own).
const DRAWN_AS = ['icon-button', 'button', 'primary', 'segment', 'tab', 'item', 'field', 'toggle', 'area', 'disclosure'] as const;

// Whether an icon button or a button is a toggle button: it switches a state on and off and says whether it is on
// (aria-pressed, from the current state of its built command). A segment and a tab always say it; other controls never.
const pressedSchema = z.boolean();

// How a menu item says it stands for the current state: one choice of a set (radio: a theme, a language, a zoom level),
// an option on or off (checkbox), or not at all (null: a command).
const menuCheckedSchema = z.enum(['radio', 'checkbox']).nullable();

const doorCommon = {
  id: doorId,
  feature: featureId,
  labelKey: i18nKey,
  // the shorter text its control shows when the drawing does not show the label ("+ Class" for "Apply a class"); the
  // label stays its accessible name and tooltip. null: the control shows its label, or the item it stands for.
  faceLabelKey: i18nKey.nullable(),
  // the icon its control shows; null for a key or a pointer gesture, a text-only control, or an item whose icon
  // comes from the item (an element's icon, a file's type). A toolbar door and an icon button always have one.
  icon: iconName.nullable(),
  disabledReasonKey: i18nKey,
  placement: placementSchema,
  adapter: adapterSchema,
  args: z.record(camelId, jsonValue),
};

// A field drawn with a slider beside its text (the user's real-use audit, item A3.30): the range it covers and the
// unit its number falls back to ('' for none: opacity). The slider reads the number and the unit the shown value
// carries, so a value written with another unit of the same property slides without changing its unit, and writes
// what the pointer releases on through the same command the text field uses.
const sliderSchema = z
  .strictObject({
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    unit: z.string(),
    // the number the value means while the element holds none of it (a filter function absent is its identity:
    // brightness 100 %, blur 0): the thumb sits there and a slide from it writes (the audit's S-024: the sliders stayed
    // disabled until a value existed). Absent: a value with no number to slide leaves the slider disabled.
    neutral: z.number().optional(),
  })
  .refine((s) => s.min < s.max, { message: 'a slider covers a range: min below max' })
  .refine((s) => s.neutral === undefined || (s.neutral >= s.min && s.neutral <= s.max), { message: "a slider's neutral lies inside its range" });

// Where a panel lives: a view of the sidebar (the activity bar switches them), a section of a sidebar view, the
// inspector column, the tools of the canvas toolbar, the workbench (the dock itself) or a tab of the dock.
const PANEL_PLACES = ['sidebar', 'section', 'inspector', 'canvas-toolbar', 'workbench', 'dock'] as const;

export const menuIdSchema = z.enum([
  'file',
  'edit',
  'arrange',
  'view',
  'help',
  'theme',
  'language',
  'element-actions',
  'zoom',
  'snap',
  'style-state',
  'layers-row-details',
]);

const doorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...doorCommon, kind: z.literal('shortcut'), chord: z.string().min(1), context: kebabId, gesture: kebabId.nullable() }),
  z.strictObject({ ...doorCommon, kind: z.literal('menu'), menu: menuIdSchema, checked: menuCheckedSchema }),
  z.strictObject({ ...doorCommon, kind: z.literal('context-menu') }),
  z.strictObject({ ...doorCommon, kind: z.literal('toolbar'), drawnAs: z.enum(DRAWN_AS), pressed: pressedSchema }),
  // a quick panel field, drawn by its control: an attribute field names the attribute it edits (the Settings fields'
  // vocabulary), a value field names the property through its command's arguments
  // its group: one of layout.json's quickPanelGroups, under whose name the panel draws it (the audit's U-044: the
  // groups were ranges of placement orders in the code); null for the panel's head (the tag, More actions, Edit on
  // canvas)
  z.strictObject({ ...doorCommon, kind: z.literal('quick-panel'), control: kebabId, attribute: camelId.nullable(), group: kebabId.nullable() }),
  z.strictObject({
    ...doorCommon,
    kind: z.literal('command-bar'),
    entry: z.enum(['command', 'insert', 'open-panel', 'set-property', 'edit-property', 'go-to-page', 'select-layer', 'apply-class']),
  }),
  z.strictObject({
    ...doorCommon,
    kind: z.literal('inspector-field'),
    // how the field is drawn: a field (its property's control of properties.json: keyword buttons, a menu, a value
    // field…) or a button (an editor's action such as Add a shadow, or a fixed value such as Spread); nothing else,
    // since the inspector draws nothing else
    drawnAs: z.enum(['field', 'button']),
    // exactly one of property, composite, recipe and attribute
    property: cssName.nullable(),
    composite: kebabId.nullable(),
    recipe: kebabId.nullable(),
    attribute: camelId.nullable(),
    control: kebabId,
    // the range of the slider drawn beside the field (A3.30); absent: a field with no slider
    slider: sliderSchema.optional(),
  }),
  z.strictObject({ ...doorCommon, kind: z.literal('canvas-drag'), source: kebabId, zone: kebabId, gesture: kebabId }),
  z.strictObject({
    ...doorCommon,
    kind: z.literal('canvas-click'),
    target: kebabId,
    button: z.enum(['primary', 'secondary']),
    count: z.union([z.literal(1), z.literal(2)]),
    modifier: modifierKeySchema.nullable(),
    gesture: kebabId,
  }),
  z.strictObject({ ...doorCommon, kind: z.literal('canvas-wheel'), modifier: modifierKeySchema.nullable(), gesture: kebabId }),
  z.strictObject({ ...doorCommon, kind: z.literal('layers-drag'), source: kebabId, zone: kebabId, gesture: kebabId }),
  z.strictObject({ ...doorCommon, kind: z.literal('canvas-handle'), handle: kebabId, gesture: kebabId }),
  z.strictObject({
    ...doorCommon,
    kind: z.literal('panel-control'),
    drawnAs: z.enum(DRAWN_AS),
    pressed: pressedSchema,
    panel: kebabId,
    control: kebabId,
    modifier: modifierKeySchema.nullable(),
    gesture: kebabId.nullable(),
    // the mouse button that runs the door when it is not the primary one: "secondary" for a Layers row's secondary
    // click (the context menu). Such a door is drawn by the control of the same panel and control that the primary
    // button runs with no key held (a row is one control whatever button presses it); absent: a click.
    button: z.literal('secondary').optional(),
    // the clicks that run the door when it is not one: 2 for a Layers row's name, whose double-click renames it in
    // place; absent: a single click
    count: z.literal(2).optional(),
  }),
  z.strictObject({ ...doorCommon, kind: z.literal('panel-drag'), source: kebabId, zone: kebabId, gesture: kebabId }),
]);

// Door kinds that are pointer gestures: a command with one of them records one transaction per gesture.
export const GESTURE_DOOR_KINDS = ['canvas-drag', 'canvas-handle', 'layers-drag', 'panel-drag'] as const;

// The argument types a text a door hands reads as a value directly (the command bar's own rule): the vocabulary's
// owner is here, beside the schema that declares every type, so no module writes the list by hand.
export const TEXTY_ARG_TYPES = ['string', 'number', 'enum', 'color'] as const;

// The kinds of thing a command's argument may name (`refers`), each with one owner that finds it
// (registerReferenceKind: core/store/references.ts)
export const REFERS = ['collection', 'token', 'component', 'guide', 'page', 'palette-entry', 'splitter', 'inspector-section', 'concept-row', 'tab-group'] as const;

const argSchema = z.strictObject({
  type: z.enum([
    'node',
    'nodes',
    'string',
    'number',
    'integer',
    'boolean',
    'enum',
    'json',
    'color',
    'path',
    'palette-entry',
    // a property of properties.json, a composite id or a recipe id
    'property',
    'attribute',
    'breakpoint',
    'state',
    'point',
    'rect',
    'file',
    // the files a door that reads several at once hands the command (File › Import HTML): each picked file's name and
    // its bytes, the entries of an archive it stands for (core/import/import.ts readPickedFiles); a scenario names them
    // by the scheme the runner resolves ("import:<name>"), one value per file
    'files',
    // what the clipboard holds when the door runs — the system's when it holds something, else the editor's own copy
    // (src/editor/clipboard.ts): the door reads it and the command runs with it, so a scenario's step leaves it out,
    // as it leaves out a gesture's rect or point
    'clipboard',
  ]),
  values: z.array(z.string()),
  optional: z.boolean(),
  // what the value names, when it names something the project or the editor holds (a collection, a variable, a guide…):
  // the store refuses a name that names nothing before the handler runs (core/store/args.ts, core/store/references.ts;
  // the audit's AUD-09), each kind found by the module that owns what it names
  refers: z.enum(REFERS).optional(),
});

// How a command meets the history. Undo always restores the selection from before the command,
// and a command that changes nothing creates no entry.
const historySchema = z.discriminatedUnion('undoable', [
  z.strictObject({ undoable: z.literal(false) }),
  z.strictObject({
    undoable: z.literal(true),
    // "none", or merge with the previous entry when it has the same target and the same property
    // and came less than the named interval (a constant of interactions.json, in ms) before
    coalesce: z.union([
      z.literal('none'),
      z.strictObject({ same: z.literal('target-and-property'), within: constantId }),
    ]),
    undoRestoresSelection: z.literal('before-command'),
    // "per-gesture": everything one pointer gesture dispatches is one transaction and one entry
    transaction: z.enum(['per-dispatch', 'per-gesture']),
    noChange: z.literal('no-entry'),
  }),
]);

const commandSchema = z
  .strictObject({
    id: commandId,
    labelKey: i18nKey,
    // the command's name without placeholders ("Set a style"), for the texts that name the command with none of its
    // arguments at hand (a refused or failed change: store.ts). Required when the label's text has placeholders
    // (manifest:check, rule command-name); absent, the label is the name.
    nameKey: i18nKey.optional(),
    owner: ownerPath,
    introducedBy: featureId,
    args: z.record(camelId, argSchema),
    availability: z.strictObject({ predicate: predicateId, refusalKey: i18nKey.nullable() }),
    refusals: z.array(i18nKey),
    confirmation: z.strictObject({ messageKey: i18nKey, confirmKey: i18nKey, cancelKey: i18nKey }).nullable(),
    history: historySchema,
    entryPoints: z.array(doorSchema),
  })
  .superRefine((command, ctx) => {
    const always = command.availability.predicate === 'always';
    if (always !== (command.availability.refusalKey === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['availability', 'refusalKey'],
        message: always
          ? 'must be null when the predicate is "always"'
          : 'is missing: a command that can be unavailable names its refusal key',
      });
    }
  });

export const commandsFileSchema = z.strictObject({
  domain: kebabId,
  commands: z.array(commandSchema).min(1),
});

// ---------------------------------------------------------------- layout (the regions of PRODUCT.md §5.3)
// Every region PRODUCT.md §5.3 draws, and the control that opens each menu. A door's placement names one of
// these regions. The area says where the region sits: a fixed part of the window, an overlay that
// opens over it, or "component", the parts of a control repeated wherever it is drawn (every field,
// every Layers row, every tab strip).

const REGION_AREAS = ['top-bar', 'left', 'centre', 'right', 'dock', 'status-bar', 'overlay', 'component'] as const;
// The regions a state control never occupies: a state belongs to the element's class selector, never
// to the page, so it is chosen only in the inspector's selector bar (manifest:check rule state-placement). Every
// region of the canvas's own chrome is here (the frame, its toolbar, the breakpoint tabs beside it and its stage).
export const PAGE_REGIONS = ['canvas-frame', 'canvas-toolbar', 'canvas-breakpoints', 'canvas-stage'] as const;

export const layoutFileSchema = z.strictObject({
  // each region, where it sits, and the orders before which it draws a separator between groups of its controls
  regions: z.array(z.strictObject({ id: regionId, area: z.enum(REGION_AREAS), breaks: z.array(z.number().int().positive()).optional() })).min(1),
  // the button that opens each menu (its items are the menu's doors): its label, where it is drawn, and its order there
  menus: z.array(
    z.strictObject({
      id: menuIdSchema,
      labelKey: i18nKey,
      // each button that opens the menu: an icon button, a button, or an item of another menu (a submenu)
      anchors: z
        .array(z.strictObject({ region: regionId, order: z.number().int().positive(), drawnAs: z.enum(['icon-button', 'button', 'item']), icon: iconName.nullable() }))
        .min(1),
      // the orders of the items a line stands before: the menu's groups (jornada02 G-18; the audit's U-033: Arrange's
      // 23 items read as one run). Optional: absent, the menu is one group.
      breaks: z.array(z.number().int().positive()).optional(),
    }),
  ),
  // The icons every control or item of a kind draws besides a door's own: the arrow of a button or field that opens a
  // list, the arrow of an item that opens a submenu, the disclosure of an expanded and of a collapsed section or tree
  // row, the mark of a checked item, a folder of the Explorer, a size variable of the Styles view, the warning of the
  // breakpoint band, the search glyph of the command palette's field. The shell draws no
  // other icon than these, the panels', the elements', the keywords' and the ones the doors name.
  // the quick panel's groups, in the order it draws them, each under its name (a quick-panel door names its group)
  quickPanelGroups: z.array(z.strictObject({ id: kebabId, labelKey: i18nKey })).min(1),
  glyphs: z.strictObject({
    dropdown: iconName,
    submenu: iconName,
    expanded: iconName,
    collapsed: iconName,
    checked: iconName,
    folder: iconName,
    sizeVariable: iconName,
    sideRow: iconName,
    sideColumn: iconName,
    quickPanel: iconName,
    grip: iconName,
    rotate: iconName,
    warning: iconName,
    search: iconName
  }),
  // Each panel (the panel values of workspace.setPanelOpen): its icon (on its dock tab and its palette entry), its
  // name, where it lives, the sidebar view a section belongs to ("in", a section only; null: the stack under every
  // sidebar view, the panels a sidebar shows below the view that shows, spec panel-resize), and whether it is open at
  // the first start (a dock panel: a tab of the dock; the workbench: the dock expanded). The dock's panels are its
  // tabs in this order.
  panels: z.record(kebabId, z.strictObject({ icon: iconName, labelKey: i18nKey, place: z.enum(PANEL_PLACES), in: kebabId.nullable(), open: z.boolean() })),
  // Each splitter (the splitter values of workspace.resizeSplitter): the axis it drags along and the arrow direction
  // that grows the panel it sizes, which starts at `size` and stays within `min` and `max`, in px (spec panel-resize).
  // Its `directions` are the two arrow directions along its axis, the negative side of the axis first (the sign of
  // `grow` comes from them): an arrow across the axis is no step at all, and the code reads both instead of comparing
  // direction words by hand.
  splitters: z.record(
    kebabId,
    z.strictObject({
      axis: z.enum(['x', 'y']),
      grow: z.enum(['up', 'down', 'left', 'right']),
      directions: z.tuple([z.enum(['up', 'down', 'left', 'right']), z.enum(['up', 'down', 'left', 'right'])]),
      size: z.number().int().positive(),
      min: z.number().int().positive(),
      max: z.number().int().positive(),
      labelKey: i18nKey,
    }),
  ),
  // The controls that are no door (the audit's AUD-33): each `data-local` name the editor draws, with why it runs no
  // command of its own — a field that filters a view, a field whose text a door's command takes as its argument, the
  // answer buttons of a confirmation, a readout. tools/inventory/local-controls.test.ts fails on a name drawn and not
  // declared here, and on one declared and drawn nowhere.
  localControls: z.array(z.strictObject({ id: kebabId, reason: z.string().min(1) })),
});

// ---------------------------------------------------------------- checks (the Checks tab of the dock)
// The categories the Checks tab groups its issues by, each arriving with the feature that produces its checks.
// A check's automatic fix (the plan's stage 6; the audit's AUD-16): the rule it fixes, the door of checks.applyFix that
// offers it beside the issue, and how the fix is made, by the owner of what it changes: an element inserted at the end
// of the element the issue is about (element.insert, the palette entry), the heading's next level (element.setTag), or
// the element's attribute field opened in Settings (inspector.reveal).
const checkFixSchema = z.discriminatedUnion('kind', [
  z.strictObject({ rule: i18nKey, door: doorRef, kind: z.literal('insert'), entry: kebabId }),
  z.strictObject({ rule: i18nKey, door: doorRef, kind: z.literal('next-level') }),
  z.strictObject({ rule: i18nKey, door: doorRef, kind: z.literal('reveal'), attribute: camelId }),
]);
export const checksFileSchema = z.strictObject({
  categories: z.array(z.strictObject({ id: kebabId, labelKey: i18nKey, feature: featureId })).min(1),
  fixes: z.array(checkFixSchema),
});

// ---------------------------------------------------------------- glossary (src/i18n/glossary.json)
// One term per concept in each language. Each concept names the CSS property whose label is its term;
// manifest:check rule label-term proves every label of that property is the term, and that no label, in
// either language, names two different CSS properties.
export const glossarySchema = z.strictObject({
  concepts: z
    .array(
      z.strictObject({
        id: kebabId,
        property: cssName,
        terms: z.strictObject({ en: z.string().min(1), 'pt-BR': z.string().min(1) }),
        note: z.string().min(1),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------- scenarios and features

// A node path: the node names from the fixture's root, such as "/Page/Section/Heading" (src/manifest/scenario.ts
// resolves it; manifest:check proves every one names exactly one node). A document path may go on into a field of
// that node after "/@": "/Page/Section/@styles/desktop/base/padding-top".
const nodeRef = z.string().regex(/^(\/[^/@][^/]*)+$/, 'a node path from the fixture root, such as "/Page/Section/Heading"');
// (a field's name is camelCase: @customAttributes)
// a field of the project itself has no node path: "/@swatches"
const documentPath = z.string().regex(/^(\/@[a-zA-Z]+|(\/[^/@][^/]*)+(\/@[a-zA-Z]+(\/[^/]+)*)?)$/, 'a node path, optionally followed by /@<field>, such as "/Page/Section/@styles/desktop/base/padding-top", or a field of the project, such as "/@swatches"');

// One step of a scenario: a door run with the command's arguments as data (for element.insert, `entry` is the
// palette entry whose tile the runner uses), on the node the gesture acts on, dropped before, after or inside a node
// for a drag. The action step is the one the scenario is about: the runner runs the scenario once per door of
// `doors`, putting that door in the action step.
// Arguments: a node argument is a node path; for a drag, the arguments are the parent and index its drop produces;
// a rect or point argument is produced by the gesture (the marquee band, a pointer position), so a step leaves it
// out; every other required argument the door does not fix is present (manifest:check rule step).
// A `file` argument names what the runner hands the browser's file chooser: "fixture:<id>" the fixture's JSON,
// "download" the file an earlier step downloaded last, "json:<text>" a project.json holding that text, "png:<name>"
// the runner's own 4x3 PNG, "woff2:<name>" the runner's own test font, "folder:<id>" the directory
// tests/support/folders/<id> (a whole folder, for a command whose door reads one; spec explorer-open-folder).
const stepSchema = z.strictObject({
  door: doorRef,
  args: z.record(camelId, jsonValue),
  target: nodeRef.nullable(),
  // Where a drag is released: over the canvas (absent), or over the node's row in the Layers panel ("layers-row": a
  // palette tile dropped on a row, the user's real-use audit item 3.9, and a Layers row drag, whose door says so
  // already). The placement and the reference are the same either way; only the point the runner releases at changes.
  drop: z.strictObject({ placement: z.enum(['before', 'after', 'inside']), reference: nodeRef, on: z.enum(['canvas', 'layers-row']).optional() }).nullable(),
  action: z.boolean(),
  // A drag step with hold: true presses on its target (for a palette drag, on the tile of args.entry), moves to its
  // drop and keeps the button down; the steps after it run during the drag. The drag ends at a later step on the same
  // drag door with target null, drop null and hold false (a release where the pointer is), or at drag.cancel.
  // A panel drag (a number field's label scrubbed) is pressed on the control its arguments stand for, never on a node:
  // with no hold of its door before it, its step with target null is a whole drag, pressed, moved and released.
  // Optional: absent is false.
  hold: z.boolean().optional(),
  // The characters the runner types with the real keyboard after the step's door has run; "\n" presses Enter (the
  // edited text, the link prompt, the rename field), U+2028, the line separator, presses Shift+Enter (a line break
  // typed in a text field) and "\t" presses Tab (the focus leaves a field, a text area that keeps what it holds when
  // it is left). Optional: absent is null.
  type: z.string().nullable().optional(),
  // The button the step presses in the confirmation its command asks (a command with `confirmation` in the manifest,
  // such as File › Open over a page that holds work): "confirm" or "cancel". A step that leaves a confirmation
  // unanswered fails. Optional: absent is null.
  answer: z.enum(['confirm', 'cancel']).nullable().optional(),
  // The milliseconds the runner waits after this step, the pointer and the keys as the step left them (a held drag at
  // an edge scrolls while it waits: spec drag-autoscroll). Optional: absent is no wait.
  wait: z.number().int().nonnegative().optional(),
});

// A measure of a region of the editor (layout.json): measure(region) compared, by relation, with
// measure(reference) + value, or with value alone when reference is null.
const editorGeometry = z.strictObject({
  region: regionId,
  measure: z.enum(['x', 'y', 'width', 'height']),
  relation: z.enum(['equals', 'less-than', 'greater-than']),
  value: z.number(),
  reference: regionId.nullable(),
});

const scenarioSchema = z.strictObject({
  id: kebabId,
  setup: z.strictObject({
    // a fixture of manifest/features/fixtures/<id>.json, loaded through File › Open; "empty" is a fresh profile's
    // empty project and has no file
    fixture: kebabId,
    selection: z.array(nodeRef),
    context: kebabId,
    breakpoint: kebabId,
    state: kebabId,
    locale: localeSchema,
    viewport: kebabId,
    // "fit": the canvas as it opens, the frame fitted to the stage; a number: the canvas zoom in percent, one of
    // environment.zoomLevels, which the runner sets through View › Zoom before the steps, so only once the feature
    // zoom-keyboard-buttons is built (manifest:check rule zoom).
    zoom: z.union([z.literal('fit'), z.number().int().positive()]),
    // the browser's storage before the steps (optional: absent is as the fixture leaves it): "corrupt-current-record"
    // makes the record autosave saved for the fixture unreadable, and reloads the editor (spec
    // autosave-corruption-recovery)
    storage: z.enum(['corrupt-current-record']).optional(),
    // the editor's other tabs (optional: absent is none): "another-tab-editing" opens one first, which opens the
    // fixture and saves it, so the scenario's tab reads it (spec multi-tab-guard)
    tabs: z.enum(['another-tab-editing']).optional(),
    // the browser's clipboard for the editor (optional: absent is the granted, empty one the runner sets): "denied"
    // withdraws the permission, so reading and writing it both fail, as when a person refuses the browser's prompt;
    // copy and paste then work inside the editor alone (the user's real-use audit, item 3.8). An object holds what
    // the clipboard carries from outside the editor (spec clipboard-paste-external): its text/html markup and its
    // text/plain text, which the runner writes to the system clipboard before the steps, so a paste reads it through
    // the same door a person's Ctrl+V does
    clipboard: z
      .union([z.literal('denied'), z.strictObject({ html: z.string().optional(), text: z.string().optional() })])
      .optional(),
    // the local Companion the assistant talks to (optional: absent is none running; spec assistant-chat): "running"
    // starts one before the steps, whose connection file the runner hands the chooser Connect to Companion opens;
    // "paired" also saves a test-only service key and connects this editor, as a person does in the preferences. Its
    // model answers "Done." at once, and holds a reply whose request says [hold] until the turn is stopped.
    companion: z.enum(['running', 'paired']).optional(),
  }),
  // run in order after the fixture is loaded; exactly one is the action step
  steps: z.array(stepSchema).min(1),
  // the doors of the action step, each of the action step's command: one run per door
  doors: z.array(doorRef).min(1),
  expect: z.strictObject({
    // The document diff, applied to the fixture in order. A node value omits id (ids are generated) and its
    // children array gives their order; a new node appears through the value of its parent or of the parent's
    // @children.
    document: z.array(
      z.discriminatedUnion('op', [
        z.strictObject({ op: z.literal('set'), path: documentPath, value: jsonValue }),
        z.strictObject({ op: z.literal('remove'), path: documentPath }),
      ]),
    ),
    selection: z.array(nodeRef),
    history: z.strictObject({
      undoSteps: z.number().int().nonnegative(),
      undoRestores: z.literal(true),
      redoRestores: z.literal(true),
    }),
    // End terminals. Every assertion names the value it expects: there is no "exists" or "is visible".
    render: z
      .strictObject({
        computed: z.array(z.strictObject({ node: nodeRef, property: cssName, value: z.string().min(1) })),
        // measure(node) compared, by relation, with measure(reference) + value, or with value alone when reference is
        // null
        geometry: z.array(
          z.strictObject({
            node: nodeRef,
            measure: z.enum(['x', 'y', 'width', 'height']),
            relation: z.enum(['equals', 'less-than', 'greater-than']),
            value: z.number(),
            reference: nodeRef.nullable(),
          }),
        ),
        feedback: z.array(z.strictObject({ key: i18nKey, params: z.record(z.string(), z.union([z.string(), z.number()])) })),
      })
      .nullable(),
    // The pointer resting on a node once the steps are done (spec hover-measure): the browser runner moves the mouse to
    // the node on the canvas (its centre, or a point inside its top-left corner, in the padding its children leave
    // free:
    // an ancestor's own area), holding Alt when `alt`, and a region of the canvas chrome shows each text (a
    // message, as the status bar's feedback is named); the fast runner, which lays nothing out, leaves it to the
    // browser. Optional: absent is no hover.
    hover: z
      .strictObject({
        node: nodeRef,
        at: z.enum(['centre', 'corner']),
        alt: z.boolean(),
        shows: z.array(z.strictObject({ region: regionId, key: i18nKey, params: z.record(z.string(), z.union([z.string(), z.number()])) })).min(1),
      })
      .optional(),
    // The editor itself: the geometry and the computed style of its regions (layout.json).
    editor: z
      .strictObject({
        regions: z.array(editorGeometry),
        computed: z.array(z.strictObject({ region: regionId, property: cssName, value: z.string().min(1) })),
      })
      .nullable(),
    // what must survive an immediate reload: the document, the stored preferences, the selection, the workspace (the
    // panels, docks and sizes, kept apart under their own key: spec workspace-persist-reset; the last two optional,
    // absent is null), or several of them
    persistence: z
      .strictObject({
        reload: z.literal('immediate'),
        document: z.literal('same').nullable(),
        preferences: z.literal('same').nullable(),
        selection: z.literal('same').nullable().optional(),
        workspace: z.literal('same').nullable().optional(),
      })
      .nullable(),
    export: z
      .strictObject({
        // A file of the archive the action hands out: the text pieces it holds (present), the ones it must not
        // (absent), and the patterns it must not match (absentPattern, a regular expression: an id selector, which a
        // raw "#" cannot say — the exported base stylesheet carries hex colours)
        files: z
          .array(z.strictObject({ path: z.string().min(1), present: z.array(z.string()), absent: z.array(z.string()), absentPattern: z.array(z.string()).optional() }))
          .min(1),
      })
      .nullable(),
  }),
  refusals: z.array(z.strictObject({ key: i18nKey, document: z.literal('unchanged') })),
});

const featureSchema = z.strictObject({
  id: featureId,
  titleKey: i18nKey,
  commands: z.array(commandId),
  dependsOn: z.array(featureId),
  // the section of spec/BEHAVIOUR.md that holds its behaviour in words, anchored by its id: every feature has one (the
  // audit's AUD-18: 39 had none, so nothing said what they must do beyond their scenarios)
  spec: specPath,
  // The module the tooth proof replaces with a no-op, for a feature without commands of its own (the renderer for
  // canvas-page-iframe); a feature with commands disables their handlers instead. Optional, so no feature has to
  // name it; manifest:check requires it of a feature with scenarios and no commands.
  toothProof: ownerPath.optional(),
  // Guidance for scenario authors only. No test reads it.
  intent: z.strictObject({
    title: z.string().min(1),
    steps: z.array(z.string().min(1)).min(1),
    expected: z.array(z.string().min(1)).min(1),
  }),
  scenarios: z.array(scenarioSchema),
});

export const featuresFileSchema = z.strictObject({
  group: kebabId,
  titleKey: i18nKey,
  features: z.array(featureSchema).min(1),
});

// ---------------------------------------------------------------- references and consumers

export const REFERENCE_KINDS = ['handler', 'predicate', 'action', 'codec'] as const;

// Every id the manifest names for code to provide. "planned" until code registers it; a
// "registered" entry must be found registered in src/ (registerHandler/Predicate/Action/Codec).
export const referencesFileSchema = z.strictObject({
  references: z.array(
    z.strictObject({
      kind: z.enum(REFERENCE_KINDS),
      id: z.string().min(1),
      status: z.enum(['planned', 'registered']),
    }),
  ),
});

// Every schema field and the module that reads it. A field nobody reads is dead data.
export const consumersFileSchema = z.strictObject({
  consumers: z.array(
    z.strictObject({
      // "<file>:<path>", arrays as "[]" and record values as "{}", e.g. "commands:commands[].history.coalesce"
      field: z.string().regex(/^[a-z/-]+:[a-zA-Z$]+([.[\]{}a-zA-Z$]*)$/, 'a field path "<file>:<path>"'),
      // a planned module path, or CLAUDE.md for guidance that only authors read
      reader: z.string().regex(/^((src|tools)\/[a-z0-9/._-]+\.tsx?|CLAUDE\.md)$/, 'a module path under src/ or tools/, or CLAUDE.md'),
    }),
  ),
});

// ---------------------------------------------------------------- generated files

const generatedHeader = z.strictObject({
  notice: z.string().min(1),
  by: z.string().min(1),
  from: z.record(z.string(), z.string()),
});

export const generatedCssSchema = z.strictObject({
  $generated: generatedHeader,
  units: z.record(z.string(), z.array(z.string())),
  properties: z.record(
    cssName,
    z.strictObject({
      syntax: z.string().nullable(),
      initial: z.string().nullable(),
      inherited: z.boolean().nullable(),
      // expanded longhands: empty for a longhand
      longhands: z.array(cssName),
      legacyAliasOf: cssName.nullable(),
      // single keywords the official syntax accepts on their own (CSS-wide keywords left out)
      keywords: z.array(z.string()),
      // units the official syntax accepts on a number on its own
      units: z.array(z.string()),
    }),
  ),
  types: z.record(z.string(), z.string()),
  // functions webref defines only in scoped versions (rect() of <basic-shape> and of clip) → the scope
  // roots; each version is written inline into the syntaxes its scope reaches
  scopedFunctions: z.record(z.string(), z.array(z.string())),
});

// A browser's support: the version that added it, or false (why says what is missing).
const supportVersion = z.union([z.string().regex(/^≤?\d+(\.\d+)*$/, 'a release number'), z.literal(false)]);
const supportFields = {
  chrome: supportVersion,
  firefox: supportVersion,
  safari: supportVersion,
  why: z.partialRecord(z.enum(BROWSERS), z.string().min(1)),
};

// The value shape a syntax form BCD tracks stands for: at least N space-separated components in a layer,
// at least two keywords, at least two comma-separated layers, or a negative number.
const FORM_SHAPES_LIST = ['components-2', 'components-3', 'components-4', 'keywords-2', 'layers-2', 'negative'] as const;
export type FormShape = (typeof FORM_SHAPES_LIST)[number];

const entrySupport = z.strictObject({ bcd: z.string().nullable(), ...supportFields });

export const generatedCompatSchema = z.strictObject({
  $generated: generatedHeader,
  // the current stable release of each browser according to BCD
  browsers: z.strictObject({ chrome: z.string().min(1), firefox: z.string().min(1), safari: z.string().min(1) }),
  // the general-purpose functions CSS Values defines (calc(), min(), clamp()...), usable wherever their
  // result type is accepted, so no property's syntax names them: lower-case name, without "()" → support
  valueFunctions: z.record(z.string(), entrySupport),
  // every unit of css-properties.json's unit lists, lower-case ("%" for percentages) → its support
  units: z.record(z.string(), entrySupport),
  properties: z.record(
    cssName,
    z.strictObject({
      // the BCD entry that decided, null when BCD has none
      bcd: z.string().nullable(),
      // how the name maps to that entry when it is not the entry's own name (a prefix, an alternative name)
      via: z.string().nullable(),
      ...supportFields,
      // lower-case keyword → its support outside functions, and inside each function it appears in
      keywords: z.record(z.string(), z.strictObject({ bcd: z.string().nullable(), ...supportFields, inFunctions: z.record(z.string(), entrySupport) })),
      // lower-case function name, without "()" → its support
      functions: z.record(z.string(), entrySupport),
      // BCD subfeature key of a syntax form (two_value_syntax, multiple_shadows) → the value shape and its support
      forms: z.record(z.string(), z.strictObject({ shape: z.enum(FORM_SHAPES_LIST), bcd: z.string().nullable(), ...supportFields })),
    }),
  ),
});

const htmlFlag = z.union([z.boolean(), z.literal('conditional')]);

export const generatedHtmlSchema = z.strictObject({
  $generated: generatedHeader,
  elements: z.record(
    z.string(),
    z.strictObject({
      deprecated: z.boolean(),
      void: z.boolean(),
      foreign: z.boolean(),
      textOnly: z.boolean(),
      categories: z.strictObject({
        metadata: htmlFlag,
        flow: htmlFlag,
        sectioning: htmlFlag,
        heading: htmlFlag,
        phrasing: htmlFlag,
        embedded: htmlFlag,
        interactive: htmlFlag,
        labelable: htmlFlag,
        form: htmlFlag,
        scriptSupporting: htmlFlag,
      }),
      transparent: z.union([z.boolean(), z.literal('conditional'), z.array(z.string())]),
      permittedContent: z.array(z.string()).nullable(),
      permittedDescendants: z.array(z.strictObject({ exclude: z.array(z.string()) })).nullable(),
      permittedOrder: z.array(z.string()).nullable(),
      permittedParent: z.array(z.string()).nullable(),
      requiredAncestors: z.array(z.string()).nullable(),
      requiredContent: z.array(z.string()).nullable(),
      attributes: z.record(
        z.string(),
        z.strictObject({ boolean: z.boolean(), deprecated: z.boolean(), enum: z.array(z.string()).nullable() }),
      ),
    }),
  ),
});

// The icons of the editor's one icon library (Lucide), by name.
// ---------------------------------------------------------------- css-exclusions (generator input)
// Values the browsers do not act on although the data says they do: a keyword every browser parses but none
// implements (BCD has no entry of its own, so css-compat.json gives it the support of its property), or a keyword or a
// unit the installed Chrome's own parser refuses (tests/e2e/css-support.spec.ts, CSS.supports). npm run gen marks an
// excluded keyword unsupported in every browser and leaves an excluded unit out of the property's list, so neither is
// in any generated list; manifest:check rule exclusion requires the evidence and refuses an excluded value in any
// declared list. Each entry names a keyword or a unit, not both. Never a menu subset: this is data about the browsers.
export const exclusionsFileSchema = z.strictObject({
  exclusions: z.array(
    z.strictObject({
      property: cssName,
      keyword: z.string().min(1).nullable(),
      unit: z.string().min(1).nullable(),
      evidence: z.strictObject({
        // what shows the keyword does nothing: the specification's status, BCD, or the observed behaviour in Chrome
        kind: z.enum(['spec', 'bcd', 'chrome']),
        // where to read it (a specification section, a BCD path, the steps of the observation)
        source: z.string(),
        note: z.string(),
      }),
    }),
  ),
});

export const generatedIconsSchema = z.strictObject({
  $generated: generatedHeader,
  icons: z.array(iconName),
});

// Each manifest file and its schema, keyed as consumers.json names them.
export const FILE_SCHEMAS = {
  environment: environmentSchema,
  elements: elementsFileSchema,
  properties: propertiesFileSchema,
  interactions: interactionsFileSchema,
  commands: commandsFileSchema,
  layout: layoutFileSchema,
  checks: checksFileSchema,
  features: featuresFileSchema,
  references: referencesFileSchema,
  consumers: consumersFileSchema,
  'generated/css-properties': generatedCssSchema,
  'generated/css-compat': generatedCompatSchema,
  'generated/html-elements': generatedHtmlSchema,
  'generated/icons': generatedIconsSchema,
  'css-exclusions': exclusionsFileSchema,
} as const;

export type Environment = z.infer<typeof environmentSchema>;
export type ElementType = z.infer<typeof elementSchema>;
export type Attribute = z.infer<typeof attributeSchema>;
export type ElementsFile = z.infer<typeof elementsFileSchema>;
export type Composite = z.infer<typeof compositeSchema>;
export type Structure = z.infer<typeof structureSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type Coupling = z.infer<typeof couplingSchema>;
export type Subset = z.infer<typeof subsetSchema>;
export type PropertiesFile = z.infer<typeof propertiesFileSchema>;
export type InteractionsFile = z.infer<typeof interactionsFileSchema>;
export type Door = z.infer<typeof doorSchema>;
export type DoorKind = Door['kind'];
export type Command = z.infer<typeof commandSchema>;
export type CommandsFile = z.infer<typeof commandsFileSchema>;
export type LayoutFile = z.infer<typeof layoutFileSchema>;
export type ChecksFile = z.infer<typeof checksFileSchema>;
export type Glossary = z.infer<typeof glossarySchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type FeaturesFile = z.infer<typeof featuresFileSchema>;
export type ReferencesFile = z.infer<typeof referencesFileSchema>;
export type ConsumersFile = z.infer<typeof consumersFileSchema>;
export type GeneratedCss = z.infer<typeof generatedCssSchema>;
export type GeneratedCompat = z.infer<typeof generatedCompatSchema>;
export type GeneratedHtml = z.infer<typeof generatedHtmlSchema>;
export type GeneratedIcons = z.infer<typeof generatedIconsSchema>;
export type ExclusionsFile = z.infer<typeof exclusionsFileSchema>;

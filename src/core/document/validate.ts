// Whole-tree validation: the store runs it on every commit and refuses a state that fails it. It checks a
// document and its selection against the model (model.ts) and the manifest: element types, tags and content
// (elements.json), attributes and where they apply, edited properties, breakpoints and states (properties.json).
// It never repairs or changes anything. The HTML content model (which element may sit in which) is owned by
// src/core/elements/content-model.ts; the rules carry it for the commands that place an element, and validation
// checks it once nesting-grammar completes it.
import { formAttributeIssue } from '../forms/config.ts';
import { dataProblems } from '../data/validate.ts';
import { hasIncompatibleMask } from '../elements/inputs.ts';
import { IDENTIFIER_SOURCE, isIdentifier } from '../text/identifier.ts';
import { languageTagAllowed } from '../text/language-tag.ts';
import { stateStandsOn } from '../style/state-elements.ts';
import type { ElementType, MessageId } from '../../generated/ids.ts';
import { boxSizeOf, outputModelFromManifest, type OutputModel } from '../render/output.ts';
import type { Attribute, Coupling, ElementsFile, GeneratedHtml, PropertiesFile, TemplateNode } from '../../manifest/schema.ts';
import { contentModelFrom, type ContentModel } from '../elements/content-model.ts';
import { orphanReferences, setReferenceAttributes } from '../elements/references.ts';
import { addressAllowed } from '../elements/address.ts';
import { projectPathProblem } from '../files/path-rule.ts';
import { motionProblems } from '../motion/document.ts';
import { interactionProblems } from '../events/interaction-rule.ts';
import { deepEqual } from '../history/transaction.ts';
import { authoringProblems } from './authoring.ts';
import { settingOf } from '../page/grid-settings.ts';
import { canonical, hasMarks, parseInline, plainText } from '../text/inline.ts';
import { DOCUMENT_VERSION, walk, type DocNode, type DocumentJson, type Selection } from './model.ts';
import { capturedProblems } from './captured.ts';
import { breakpointProblems, rulesForDocument, type ProjectBreakpoint } from './breakpoint-rules.ts';

export interface ElementRules {
  // its tag first, then its alternative tags
  readonly tags: readonly (string | null)[];
  readonly content: 'children' | 'text' | 'markup' | 'none';
  // its namespace: an HTML element, or an SVG shape drawn inside an SVG
  readonly namespace: 'html' | 'svg';
  // what a new element of the type is (element.insert): its name, its styles at the base breakpoint and state, its text
  readonly labelKey: MessageId;
  readonly defaultStyles: Readonly<Record<string, string>>;
  readonly defaultTextKey: MessageId | null;
  // the elements a new one is created holding, in order, so it is never empty (a blockquote's paragraph, a list's item,
  // a definition list's term and description); empty for none
  readonly naturalChildren: readonly string[];
  // the attribute whose field picks a file of the project (an image's Source), or null (spec explorer-assets-use)
  readonly filePicker: string | null;
  // a block a page is built of (a section, a header, a footer): a click-insert lands after the one holding the
  // selection
  readonly pageBlock: boolean;
}

// What an attribute's value is (elements.json): its value type, the keywords a keyword attribute takes one of, its
// HTML attribute (null when it is none) and its name in the catalogue.
export interface AttributeRules {
  // one of HTML global attributes: every tag takes it (the audit A3.7: the tag switch keeps it, the Settings shows it)
  readonly global: boolean;
  readonly valueType: Attribute['valueType'];
  // an empty text is a value of its own (alt: decorative)
  readonly keepsEmpty: boolean;
  readonly keywords: readonly string[];
  readonly html: string | null;
  // where the export writes it: "<form>:<name>" in the head, or null for an attribute (the audit 7.2)
  readonly head: string | null;
  readonly labelKey: MessageId;
  // the command that sets it (elements.json)
  readonly command: string;
}

export interface ModelRules {
  readonly elements: ReadonlyMap<string, ElementRules>;
  // attribute id → the element types it applies to, or "all"
  readonly attributes: ReadonlyMap<string, readonly string[] | 'all'>;
  // attribute id → what its value is
  readonly attributeValues: ReadonlyMap<string, AttributeRules>;
  readonly autocompleteTokens: readonly string[];
  readonly properties: ReadonlySet<string>;
  // each edited property's codec, which reads and writes its values, its label and the predicate of the elements it
  // applies to (properties.json; src/core/style/applies.ts)
  readonly propertyFacts: ReadonlyMap<string, { readonly codec: string; readonly labelKey: MessageId; readonly appliesTo: string }>;
  // each composite control (a shorthand the model stores as its longhands, such as overflow): its codec, its label and
  // the longhands it writes (properties.json composites)
  // and, when its longhands name the keywords of their axis (the subset `keywords`: background-position), those
  readonly compositeFacts: ReadonlyMap<string, { readonly codec: string; readonly labelKey: MessageId; readonly longhands: readonly string[]; readonly axes: readonly (readonly string[])[] | null }>;
  // each compatibility recipe (properties.json recipes): its codec, its label and the declarations it writes (a value
  // null stands for the value typed; user-select: -webkit-user-select and user-select)
  readonly recipeFacts: ReadonlyMap<
    string,
    { readonly codec: string; readonly labelKey: MessageId; readonly appliesTo: string; readonly declarations: readonly { readonly property: string; readonly value: string | null }[]; readonly shared: { readonly otherWrite: string } | null }
  >;
  // each property whose value is structured (properties.json structures, by the property's valueType): its fields in
  // order, each with its type and how it reaches CSS
  readonly structures: ReadonlyMap<string, readonly StructureField[]>;
  // the couplings a style write triggers, in the manifest's order (properties.json couplings;
  // src/core/style/couplings.ts)
  readonly couplings: readonly Coupling[];
  // availability predicates that read one value of the primary selected element (properties.json valuePredicates)
  readonly valuePredicates: ReadonlyMap<string, { readonly property: string; readonly values: readonly string[] }>;
  readonly breakpoints: ReadonlySet<string>;
  // the breakpoints themselves, widest first: the project's (core/document/breakpoints.ts rulesForDocument), else the
  // default table, with what names them in a message
  readonly breakpointTable: readonly ProjectBreakpoint[];
  readonly states: ReadonlySet<string>;
  // state id → the element types it stands on (null for every one): a rule a browser ignores is refused (A3.36)
  readonly stateElements: ReadonlyMap<string, readonly string[] | null>;
  // state id → its name in the catalogues, for the words that name it (a refusal: nodes/flags.ts)
  readonly stateLabels: ReadonlyMap<string, MessageId>;
  // breakpoint id → the screen width it stands for (properties.json): the import maps a media query's width to it
  readonly breakpointWidths: ReadonlyMap<string, number>;
  // the pseudo-class of a state, without its colons ("hover") → the state id: the import reads a selector's state
  readonly statePseudos: ReadonlyMap<string, string>;
  // the breakpoint and the state a value belongs to when none is chosen (properties.json: base)
  readonly base: { readonly breakpoint: string; readonly state: string };
  // the base breakpoint and state themselves, never the layer a handler writes (the store hands handlers the layer the
  // editor edits as `base`): a new element's default styles and an SVG's own size belong here
  readonly baseLayer: { readonly breakpoint: string; readonly state: string };
  // the properties of a box's size, width then height: what the size section of properties.json summarises
  readonly boxSize: readonly string[];
  // the element every page's root is: the element type whose tag is <body> in elements.json
  readonly root: { readonly type: ElementType; readonly tag: string };
  // palette entry id → the element type it inserts and the feature that brings it (elements.json palette)
  readonly palette: ReadonlyMap<string, { readonly element: ElementType; readonly feature: string; readonly inputType: string | null; readonly labelKey: MessageId; readonly template: TemplateNode | null }>;
  // the Row and Column wrappers (elements.json wrappers): the element type, the name's catalogue key, the styles
  readonly wrappers: ReadonlyMap<WrapperId, { readonly element: ElementType; readonly nameKey: MessageId; readonly styles: Readonly<Record<string, string>>; readonly childStyles: Readonly<Record<string, string>>; readonly perChildTracks: boolean }>;
  readonly contentModel: ContentModel;
  // what the page's output needs (render.ts): the canvas and the export write elements and CSS from it
  readonly output: OutputModel;
}

export type WrapperId = ElementsFile['wrappers'][number]['id'];

export function rulesFromManifest(elements: ElementsFile, properties: PropertiesFile, html: GeneratedHtml): ModelRules {
  const body = elements.elements.find((e) => e.tag === 'body');
  if (!body) throw new Error('elements.json has no element whose tag is body: a page has no root element');
  const baseBreakpoint = properties.breakpoints.find((b) => b.base);
  const baseState = properties.states.find((s) => s.pseudo === null);
  if (!baseBreakpoint || !baseState) throw new Error('properties.json names no base breakpoint or no base state');
  // the attributes that hold a reference (a label's for, a link's #anchor): the reference owner reads them
  setReferenceAttributes(elements.attributes.map((a) => ({ id: a.id, html: a.html })));
  return {
    elements: new Map(
      elements.elements.map((e) => [
        e.id,
        {
          tags: [e.tag, ...e.alternativeTags],
          content: e.content,
          namespace: e.namespace,
          labelKey: e.labelKey as MessageId,
          defaultStyles: e.defaultStyles,
          defaultTextKey: e.defaultTextKey as MessageId | null,
          naturalChildren: [e.naturalChild ?? []].flat(),
          filePicker: e.filePicker ?? null,
          pageBlock: e.pageBlock ?? false
        },
      ]),
    ),
    attributes: new Map(elements.attributes.map((a) => [a.id, a.elements])),
    attributeValues: new Map(elements.attributes.map((a) => [
      a.id,
      { valueType: a.valueType, keywords: a.keywords, html: a.html, global: a.global === true, keepsEmpty: a.keepsEmpty === true, head: a.head ?? null, labelKey: a.labelKey as MessageId, command: a.command }
    ] as const)),
    autocompleteTokens: elements.autocompleteTokens,
    // what a node stores: the edited properties, and the recipes by their ids (the output writes their declarations)
    properties: new Set([...properties.properties.map((p) => p.id), ...properties.recipes.map((r) => r.id)]),
    propertyFacts: new Map(properties.properties.map((p) => [p.id, { codec: p.codec, labelKey: p.labelKey as MessageId, appliesTo: p.appliesTo }] as const)),
    compositeFacts: new Map(
      (properties.composites ?? []).map((c) => {
        const axes = c.longhands.map((l) => properties.properties.find((p) => p.id === l)?.subsets.find((s) => s.id === AXIS_KEYWORDS)?.values ?? []);
        return [c.id, { codec: c.codec, labelKey: c.labelKey as MessageId, longhands: c.longhands, axes: axes.some((a) => a.length > 0) ? axes : null }] as const;
      }),
    ),
    recipeFacts: new Map(properties.recipes.map((r) => [
      r.id,
      { codec: r.codec, labelKey: r.labelKey as MessageId, appliesTo: r.appliesTo, declarations: r.declarations, shared: r.shared === null ? null : { otherWrite: r.shared.otherWrite } }
    ] as const)),
    structures: new Map(
      properties.properties.flatMap((p) => {
        const structure = properties.structures.find((s) => s.id === p.valueType);
        return structure === undefined ? [] : [[p.id, structure.fields.map((f) => ({ id: f.id, type: f.type, css: f.css, keyword: f.keyword }))] as const];
      }),
    ),
    couplings: properties.couplings,
    valuePredicates: new Map(properties.valuePredicates.map((p) => [p.id, { property: p.property, values: p.values }] as const)),
    breakpoints: new Set(properties.breakpoints.map((b) => b.id)),
    breakpointTable: properties.breakpoints.map(({ id, width, height, base }) => ({ id, name: null, width, height, base })),
    states: new Set(properties.states.map((s) => s.id)),
    stateElements: new Map(properties.states.map((s) => [s.id, s.elements] as const)),
    stateLabels: new Map(properties.states.map((s) => [s.id, s.labelKey as MessageId] as const)),
    breakpointWidths: new Map(properties.breakpoints.map((b) => [b.id, b.width] as const)),
    statePseudos: new Map(properties.states.flatMap((s) => (s.pseudo === null || s.pseudo.startsWith('::') ? [] : [[s.pseudo.slice(1), s.id] as const]))),
    base: { breakpoint: baseBreakpoint.id, state: baseState.id },
    baseLayer: { breakpoint: baseBreakpoint.id, state: baseState.id },
    boxSize: boxSizeOf(properties),
    root: { type: body.id as ElementType, tag: 'body' },
    palette: new Map(elements.palette.flatMap((g) => g.entries.map((e) => [e.id, { element: e.element as ElementType, feature: e.feature, inputType: e.inputType ?? null, labelKey: e.labelKey as MessageId, template: e.template ?? null }] as const))),
    wrappers: new Map(elements.wrappers.map((w) => [w.id, { element: w.element as ElementType, nameKey: w.nameKey as MessageId, styles: w.styles, childStyles: w.childStyles ?? {}, perChildTracks: w.perChildTracks === true }] as const)),
    // a foreign element (<svg>) and the elements of its namespace: elements.json's elements whose namespace is its tag
    contentModel: contentModelFrom(html, new Map([...new Set(elements.elements.map((e) => e.namespace))].map((ns) => [ns, elements.elements.flatMap((e) => (e.namespace === ns && e.tag !== null ? [e.tag] : []))] as const))),
    output: outputModelFromManifest(elements, properties),
  };
}

export interface Invalid {
  // a JSON pointer into the document, or "/selection/<i>"
  readonly path: string;
  readonly message: string;
}

// A field of a structured value (properties.json structures): its id, its type, how it reaches CSS (value: written;
// keyword: its keyword when true; hides-layer: the layer out of the CSS when true) and the keyword it writes.
export interface StructureField {
  readonly id: string;
  readonly type: 'length' | 'color' | 'boolean';
  readonly css: 'value' | 'keyword' | 'hides-layer';
  readonly keyword: string | null;
}

// Why a stored structured value breaks the model, or null: a list of layers, each holding exactly its structure's
// fields, a length or a colour as non-empty text, a flag as a boolean.
function layersProblem(value: unknown, fields: readonly StructureField[]): string | null {
  if (!Array.isArray(value)) return 'a structured value is a list of layers';
  for (const [i, layer] of value.entries()) {
    if (!isRecord(layer)) return `layer ${i} is an object`;
    for (const key of Object.keys(layer)) if (!fields.some((f) => f.id === key)) return `layer ${i} holds "${key}", no field of its structure`;
    for (const f of fields) {
      const v = layer[f.id];
      if (f.type === 'boolean' ? typeof v !== 'boolean' : typeof v !== 'string' || v.trim() === '') return `layer ${i}: ${f.id} is ${f.type === 'boolean' ? 'a boolean' : 'non-empty CSS text'}`;
    }
  }
  return null;
}

// the subset of a longhand that lists the keywords of its axis (properties.json)
const AXIS_KEYWORDS = 'keywords';
const CLASS_NAME = new RegExp(`^${IDENTIFIER_SOURCE}$`, 'u');
// A page's file: a path of segments ending in .html, no segment empty and none holding a separator of its own (a
// renamed or imported file keeps its exact name — "Contact Us.html" stays as it is; spec explorer-file-system).
const PAGE_FILE = /^([^/\\]+\/)*[^/\\]+\.html$/;

// The values an element's own attributes may take, by its tag and, for an input, its type (the user's real-use audit,
// A3.1 and A3.44). One owner: the validator refuses an impossible document whatever path wrote it (a field, File ›
// Open, a paste), and the fields only ask it. A number where the attribute is a number, a type of the closed list the
// input offers, a pattern that compiles, a language tag, ranges that make sense, a control that measures something.

// Why one attribute's value breaks the model, or null: the attribute's own name and value only, so the reason is
// reported once, at that attribute's path. The fields ask it (core/import/import.ts reads an imported attribute through
// it, so an address that runs code never reaches the document), one owner for the rule.
export function attributeValueRefusal(name: string, value: unknown, rules: ModelRules): string | null {
  const facts = rules.attributeValues.get(name);
  if (facts === undefined || typeof value === 'boolean') return null;
  const text = String(value);
  if (facts.valueType === 'number' && !Number.isFinite(Number(text))) return `${name} takes a number, not "${text}"`;
  if (facts.valueType === 'keyword' && facts.keywords.length > 0 && !facts.keywords.includes(text)) return `${name} is one of ${facts.keywords.join(', ')}, not "${text}"`;
  // an address is one the one rule of an address allows (the audit's A3.2 and A3.44): a file that arrives with
  // javascript: in an image's source is refused with the reason, whatever road it took
  if (facts.valueType === 'url' && text !== '' && !addressAllowed(text)) return `"${text}" is not an address this page can use`;
  if (facts.html === 'pattern' && text !== '') {
    try {
      // as the HTML Standard compiles it: anchored, with the v flag (unicodeSets; whatwg/html#7908, the audit's PT1)
      new RegExp(`^(?:${text})$`, 'v');
    } catch {
      return `"${text}" is not a pattern the browser takes`;
    }
  }
  if (facts.html === 'lang' && !languageTagAllowed(text)) return `"${text}" is not a language tag`;
  if (facts.html === 'autocomplete' && !text.split(/\s+/).every((token) => token === '' || rules.autocompleteTokens.includes(token))) return `"${text}" is not an autocomplete token`;
  if (facts.html === 'step' && !(Number(text) > 0)) return `step is more than 0, not "${text}"`;
  return null;
}

// Why the pairs a control cannot hold at once break the model, or null, with the attribute the reason stands at: an
// input's least above its most, a value outside its own range. The node's attributes read as a whole, once.
function attributePairRefusal(node: DocNode, rules: ModelRules): { readonly attribute: string; readonly message: string } | null {
  if (hasIncompatibleMask(node)) return { attribute: 'formField', message: 'A text mask requires a text-compatible input or textarea' };
  const attributes: Readonly<Record<string, unknown>> = node.attributes;
  const idOf = (html: string): string | undefined => Object.keys(attributes).find((key) => rules.attributeValues.get(key)?.html === html);
  const number = (id: string | undefined): number | null => {
    const held = id === undefined ? undefined : attributes[id];
    if (held === undefined || typeof held === 'boolean') return null;
    const parsed = Number(String(held));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const minId = idOf('min');
  const maxId = idOf('max');
  const valueId = idOf('value');
  const min = number(minId);
  const max = number(maxId);
  const value = number(valueId);
  if (minId !== undefined && min !== null && max !== null && min > max) return { attribute: minId, message: `a minimum of ${min} is above the maximum of ${max}` };
  if (valueId !== undefined && value !== null && min !== null && value < min) return { attribute: valueId, message: `a value of ${value} is below the minimum of ${min}` };
  if (valueId !== undefined && value !== null && max !== null && value > max) return { attribute: valueId, message: `a value of ${value} is above the maximum of ${max}` };
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// An element's or a class's styles: breakpoints of properties.json holding its states, each holding declarations of its
// edited properties, a structured value as its structure, any other as non-empty CSS text.
function validateStyles(styles: unknown, at: string, rules: ModelRules, bad: (path: string, message: string) => void, type?: string): void {
  if (!isRecord(styles)) bad(`${at}/styles`, 'styles is an object');
  else {
    for (const [breakpoint, byState] of Object.entries(styles)) {
      if (!rules.breakpoints.has(breakpoint)) bad(`${at}/styles/${breakpoint}`, `"${breakpoint}" is not a breakpoint`);
      if (!isRecord(byState)) {
        bad(`${at}/styles/${breakpoint}`, 'a breakpoint holds its states');
        continue;
      }
      for (const [state, declarations] of Object.entries(byState)) {
        if (!rules.states.has(state)) bad(`${at}/styles/${breakpoint}/${state}`, `"${state}" is not a style state`);
        // a state the element does not stand on (visited on a div, disabled on an h2) is no state for it (A3.36): the
        // export would write a rule a browser ignores
        else if (type !== undefined && !stateStandsOn(state, type, rules)) bad(`${at}/styles/${breakpoint}/${state}`, `"${state}" is not a state ${type} takes`);
        if (!isRecord(declarations)) {
          bad(`${at}/styles/${breakpoint}/${state}`, 'a state holds its declarations');
          continue;
        }
        for (const [property, value] of Object.entries(declarations)) {
          // a custom property of the person's own (the free declarations field) is theirs to write
          if (!rules.properties.has(property) && !property.startsWith('--')) bad(`${at}/styles/${breakpoint}/${state}/${property}`, `"${property}" is not an edited property of properties.json`);
          const fields = rules.structures.get(property);
          if (fields !== undefined) {
            const problem = layersProblem(value, fields);
            if (problem !== null) bad(`${at}/styles/${breakpoint}/${state}/${property}`, problem);
          } else if (typeof value !== 'string' || value.trim() === '') bad(`${at}/styles/${breakpoint}/${state}/${property}`, 'a stored value is non-empty CSS text');
        }
      }
    }
  }
}

// the default breakpoints' ids: only those go without a name of the person's
const defaultIds = (rules: ModelRules): readonly string[] => rules.breakpointTable.map((b) => b.id);

export function validateDocument(doc: DocumentJson, selection: Selection, manifestRules: ModelRules): Invalid[] {
  const problems: Invalid[] = [];
  const bad = (path: string, message: string) => problems.push({ path, message });
  // the project's breakpoints, when it has its own table: the styles are checked against those (breakpoints.ts)
  if (doc.breakpoints !== undefined) for (const problem of breakpointProblems(doc.breakpoints, defaultIds(manifestRules))) bad(problem.path, problem.message);
  const rules = doc.breakpoints !== undefined && breakpointProblems(doc.breakpoints, defaultIds(manifestRules)).length === 0 ? rulesForDocument(manifestRules, doc) : manifestRules;
  const ids = new Map<string, string>();
  const claim = (id: unknown, path: string) => {
    if (typeof id !== 'string' || id === '') return bad(path, 'an id is a non-empty string');
    const first = ids.get(id);
    if (first !== undefined) bad(path, `id "${id}" is already used at ${first}`);
    else ids.set(id, path);
  };

  if (doc.language !== undefined && (typeof doc.language !== 'string' || !languageTagAllowed(doc.language))) bad('/language', 'invalid project language');
  if (doc.codeLanguage !== undefined && (typeof doc.codeLanguage !== 'string' || !languageTagAllowed(doc.codeLanguage))) bad('/codeLanguage', 'invalid code language');
  if (doc.version !== DOCUMENT_VERSION) bad('/version', `the document version is ${DOCUMENT_VERSION}`);
  // the collections, bindings, bound lists, item pages and shared regions (core/data/validate.ts)
  for (const problem of dataProblems(doc, rules)) bad(problem.path, problem.message);
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) bad('/pages', 'a project has at least one page');
  // the saved colours: CSS colour texts, at least one when the list is there
  // the design tokens: a name (a letter, then letters, digits and -), once each, a kind and a value
  if (doc.tokens !== undefined) {
    const names = new Set<string>();
    const tokenOk = (t: unknown) => {
      if (t === null || typeof t !== 'object') return false;
      const { name, kind, value } = t as Record<string, unknown>;
      if (typeof name !== 'string' || !isIdentifier(name) || names.has(name) || typeof kind !== 'string' || kind === '' || typeof value !== 'string' || value.trim() === '') return false;
      names.add(name);
      return true;
    };
    if (!Array.isArray(doc.tokens) || doc.tokens.length === 0 || !doc.tokens.every(tokenOk)) bad('/tokens', 'the design tokens are a list of named variables, each once, with a kind and a value');
  }
  // the components: a name, once each, and a definition tree whose elements are validated as a page's (their ids are
  // the document's too)
  const componentNames = new Set<string>();
  if (doc.components !== undefined) {
    if (!Array.isArray(doc.components) || doc.components.length === 0) bad('/components', 'the components are a list of named definitions, absent while there is none');
    else
      doc.components.forEach((c, i) => {
        if (!isRecord(c) || typeof c.name !== 'string' || c.name.trim() === '' || !isRecord(c.tree)) return bad(`/components/${i}`, 'a component has a name and a definition tree');
        if (componentNames.has(c.name)) bad(`/components/${i}/name`, `the component ${c.name} is made twice`);
        componentNames.add(c.name);
        if (c.tree.type === rules.root.type) bad(`/components/${i}/tree/type`, 'a page root is no component');
        validateNode(c.tree as unknown as DocNode, `/components/${i}/tree`, rules, claim, bad, false);
      });
  }
  // the style classes: a class name, once each, and its styles
  if (doc.classes !== undefined) {
    if (!Array.isArray(doc.classes) || doc.classes.length === 0) bad('/classes', 'the style classes are a list of named classes, absent while there is none');
    else {
      const names = new Set<string>();
      doc.classes.forEach((c, i) => {
        if (!isRecord(c) || typeof c.name !== 'string' || !CLASS_NAME.test(c.name)) return bad(`/classes/${i}`, 'a class has a class name and its styles');
        if (names.has(c.name)) bad(`/classes/${i}/name`, `the class ${c.name} is made twice`);
        names.add(c.name);
        validateStyles(c.styles, `/classes/${i}`, rules, bad);
      });
    }
  }
  if (doc.swatches !== undefined && (!Array.isArray(doc.swatches) || doc.swatches.length === 0 || doc.swatches.some((c) => typeof c !== 'string' || c.trim() === ''))) bad('/swatches', 'the saved colours are a list of colour texts');
  // the project's folders (spec explorer-file-system): a path each, no empty segment (the root is '')
  if (doc.folders !== undefined && (!Array.isArray(doc.folders) || doc.folders.some((one) => typeof one !== 'string' || one.trim() === '' || projectPathProblem(one) !== null))) bad('/folders', 'the folders are a list of paths');
  // the project's files (spec explorer-file-system): each a path of the one rule of a project path (the audit's FP1:
  // the export writes it as a ZIP entry), a type and its bytes as base64 text, once each
  if (doc.files !== undefined) {
    if (!Array.isArray(doc.files)) bad('/files', 'the files are a list');
    else {
      const paths = new Set<string>();
      doc.files.forEach((file: unknown, i) => {
        const at = `/files/${i}`;
        if (!isRecord(file)) return bad(at, 'a file is an object');
        const path = file.path;
        const problem = typeof path === 'string' ? projectPathProblem(path) : 'a file has a path';
        if (problem !== null) bad(`${at}/path`, problem);
        else if (paths.has(path as string)) bad(`${at}/path`, `two files are ${String(path)}`);
        else paths.add(path as string);
        if (typeof file.type !== 'string') bad(`${at}/type`, 'a file has a type');
        if (typeof file.bytes !== 'string') bad(`${at}/bytes`, 'a file holds its bytes as base64 text');
      });
    }
  }
  const files = new Set<string>();
  (doc.pages ?? []).forEach((page, i) => {
    const at = `/pages/${i}`;
    claim(page.id, `${at}/id`);
    if (typeof page.name !== 'string' || page.name.trim() === '') bad(`${at}/name`, 'a page has a name');
    if (typeof page.file !== 'string' || !PAGE_FILE.test(page.file) || projectPathProblem(page.file) !== null) bad(`${at}/file`, `"${String(page.file)}" is not a page file path such as index.html`);
    else if (files.has(page.file)) bad(`${at}/file`, `two pages are ${page.file}`);
    else files.add(page.file);
    if (!isRecord(page.tree)) return bad(`${at}/tree`, 'a page has a tree');
    if (page.tree.type !== rules.root.type) bad(`${at}/tree/type`, `a page's root is a ${rules.root.type} element`);
    validateNode(page.tree, `${at}/tree`, rules, claim, bad, true);
    validateInstances(page.tree, `${at}/tree`, componentNames, false, bad);
    if (page.capture !== undefined) {
      if (page.tree.children.length > 0) bad(`${at}/tree/children`, 'captured content is stored only in capture snapshots');
      for (const problem of capturedProblems(page.capture)) bad(`${at}/capture${problem.path}`, problem.message);
    }
  });

  const nodeIds = new Set<string>();
  for (const page of doc.pages ?? []) {
    if (isRecord(page.tree)) for (const node of walk(page.tree)) nodeIds.add(node.id);
    // the captured tree's ids, read with care: a malformed capture is reported above, never thrown on here
    const visit = (node: unknown): void => {
      if (!isRecord(node)) return;
      if (typeof node.id === 'string') nodeIds.add(node.id);
      if (Array.isArray(node.children)) node.children.forEach(visit);
      if (isRecord(node.shadow) && Array.isArray(node.shadow.children)) node.shadow.children.forEach(visit);
    };
    if (isRecord(page.capture)) visit(page.capture.root);
  }
  const seen = new Set<string>();
  selection.forEach((id, i) => {
    if (!nodeIds.has(id)) bad(`/selection/${i}`, `the selection names "${id}", which is no node of the document`);
    if (seen.has(id)) bad(`/selection/${i}`, `"${id}" is selected twice`);
    seen.add(id);
  });
  // a reference that names no element of the document is refused with its reason (the audit's A3.4 and A3.44): a file
  // whose label points at a control that is not there, or whose link opens a section that does not exist, never opens
  // quietly. The references owner says which those are (src/core/elements/references.ts).
  // the motion data: each timeline, interaction and behaviour read strictly, the timeline names unique, every timeline
  // played and every element picked held by the document (core/motion/document.ts)
  for (const problem of motionProblems(doc)) bad(problem.path, problem.message);
  // the event interactions of every element (core/events/interactions.ts, the audit's EV2): read as strictly as the
  // motion data, so an opened file never holds an address that runs code or a target that is not there
  doc.pages.forEach((page, p) => {
    const visit = (node: DocNode, at: string): void => {
      if ('interactions' in node) {
        const held: unknown = node.interactions;
        if (!Array.isArray(held) || held.length === 0) bad(`${at}/interactions`, 'interactions is a list of at least one interaction, or absent');
        else held.forEach((one, i) => {
          for (const problem of interactionProblems(one, nodeIds)) bad(`${at}/interactions/${i}${problem.field === '' ? '' : `/${problem.field}`}`, problem.message);
        });
      }
      if (Array.isArray(node.children)) node.children.forEach((child, i) => visit(child, `${at}/children/${i}`));
    };
    if (isRecord(page) && isRecord(page.tree)) visit(page.tree as DocNode, `/pages/${p}/tree`);
  });
  for (const orphan of orphanReferences(doc)) {
    bad('/pages', `${orphan.node.name} holds ${orphan.attribute} "${orphan.value}", which names no element of the document`);
  }
  return problems;
}

// The marks of the instances of components (model.ts, spec reusable-components): an instance's root names a component
// the project has and its part is []; every element inside an instance carries its part, a list of child indexes, or
// none when it was added to that instance alone; no element outside an instance carries one; no instance lies inside
// another.
function validateInstances(node: DocNode, at: string, components: ReadonlySet<string>, inside: boolean, bad: (path: string, message: string) => void): void {
  const part: unknown = node.componentPart;
  const isPart = Array.isArray(part) && part.every((n) => Number.isInteger(n) && (n as number) >= 0);
  if ('component' in node) {
    if (typeof node.component !== 'string' || !components.has(node.component)) bad(`${at}/component`, `"${String(node.component)}" is no component of the project`);
    if (inside) bad(`${at}/component`, 'an instance lies inside another');
    if (!isPart || (part as unknown[]).length !== 0) bad(`${at}/componentPart`, 'an instance’s root is the definition’s root: its part is []');
  } else if ('componentPart' in node) {
    if (!inside) bad(`${at}/componentPart`, 'only an element of an instance has a part');
    else if (!isPart) bad(`${at}/componentPart`, 'a part is a list of child indexes');
  }
  const within = inside || 'component' in node;
  node.children.forEach((child, i) => validateInstances(child, `${at}/children/${i}`, components, within, bad));
}

// Why a name cannot be a custom attribute (feature element-attributes-aria), or null: an attribute name of HTML (a
// letter, then letters, digits, "-", "_", ".", ":"), never an event handler (on…), never one of the editor's own marks
// (data-node, data-container, data-hidden, data-key-context, contenteditable), which the page never carries.
export const EDITOR_ATTRIBUTES: ReadonlySet<string> = new Set(['data-node', 'data-container', 'data-hidden', 'data-empty-text', 'data-key-context', 'data-editor-style', 'data-node-style']);
// A dedicated field owns these names even when its element type is not selected. The rule also
// catches every HTML attribute declared in elements.json, through ModelRules.attributeValues.
const RESERVED_OWNER: Readonly<Record<string, string>> = {
  style: 'inspector.tab.style', class: 'attribute.classes.label', id: 'attribute.id.label',
  srcdoc: 'attribute.embedMarkup.label', hidden: 'command.hide', tabindex: 'settings.section.accessibility',
  contenteditable: 'attribute.text.label',
};
export function reservedAttributeOwner(name: string, rules: ModelRules): string | null {
  const special = RESERVED_OWNER[name];
  if (special !== undefined) return special;
  const declared = [...rules.attributeValues.values()].find((attribute) => attribute.html === name);
  return declared?.labelKey ?? null;
}
// The HTML attributes whose value is an address the browser follows (a navigation, a submission, a fetch) that no field
// of the editor owns, so a person may write them as their own (a button's formaction, an object's data): their value
// passes the one rule of an address like every address field's, so none runs code (OWASP's XSS filter evasion lists
// <button formaction="javascript:…">; the audit's XA1). The others an address field owns are reserved names already.
const ADDRESS_ATTRIBUTES: ReadonlySet<string> = new Set(['formaction', 'action', 'href', 'src', 'xlink:href', 'data', 'poster', 'background', 'ping', 'codebase', 'cite', 'longdesc', 'manifest', 'lowsrc', 'dynsrc']);
// why a custom attribute cannot hold this value, or null: an address attribute's value is an address the rule allows
export function customAttributeValueRefusal(name: string, value: string): string | null {
  if (!ADDRESS_ATTRIBUTES.has(name) || value.trim() === '') return null;
  return addressAllowed(value) ? null : `"${value}" is not an address this page can use`;
}
export function customAttributeRefusal(name: string, rules: ModelRules): string | null {
  if (!/^[a-z][a-z0-9_.:-]*$/.test(name)) return 'not an attribute name';
  if (name.startsWith('on')) return 'an event handler attribute';
  if (EDITOR_ATTRIBUTES.has(name)) return 'an attribute of the editor';
  if (reservedAttributeOwner(name, rules) !== null) return 'a reserved attribute with a dedicated field';
  return null;
}

function validateNode(
  node: DocNode,
  at: string,
  rules: ModelRules,
  claim: (id: unknown, path: string) => void,
  bad: (path: string, message: string) => void,
  root: boolean,
): void {
  claim(node.id, `${at}/id`);
  const element = rules.elements.get(node.type);
  if (!element) {
    bad(`${at}/type`, `"${String(node.type)}" is not an element type of elements.json`);
    return;
  }
  if (!root && node.type === rules.root.type) bad(`${at}/type`, `only a page's root is a ${rules.root.type} element`);
  if (typeof node.name !== 'string' || node.name.trim() === '') bad(`${at}/name`, 'an element has a name');
  if (!element.tags.includes(node.tag)) bad(`${at}/tag`, `<${String(node.tag)}> is not a tag of ${node.type} (${element.tags.map(String).join(', ')})`);
  // the hidden flag (model.ts): true, or absent while the element shows; a page's root always shows
  if ('hidden' in node) {
    if (node.hidden !== true) bad(`${at}/hidden`, 'hidden is true, or absent while the element shows');
    else if (root) bad(`${at}/hidden`, 'a page’s root is never hidden');
  }
  // the lock flag (model.ts): true, or absent while the element is unlocked; a page's root is never locked
  if ('locked' in node) {
    if (node.locked !== true) bad(`${at}/locked`, 'locked is true, or absent while the element is unlocked');
    else if (root) bad(`${at}/locked`, 'a page’s root is never locked');
  }

  // the page's guides (model.ts): on a page's root only, each once, on an axis, at a place from 0 on
  if ('guides' in node) {
    const list: unknown = node.guides;
    const ids = new Set<string>();
    const guideOk = (g: unknown) => {
      if (!isRecord(g) || typeof g.id !== 'string' || g.id === '' || ids.has(g.id) || (g.axis !== 'horizontal' && g.axis !== 'vertical') || typeof g.at !== 'number' || !Number.isFinite(g.at) || g.at < 0) return false;
      if ('locked' in g && g.locked !== true) return false;
      ids.add(g.id);
      return true;
    };
    if (!root) bad(`${at}/guides`, 'only a page’s root holds the page’s guides');
    else if (!Array.isArray(list) || list.length === 0 || !list.every(guideOk)) bad(`${at}/guides`, 'guides is a list of guides, each once, on an axis, at a place from 0, absent while there is none');
  }
  // the page's grid settings (model.ts; the user's real-use audit, A1.6): on a page's root only, each grid's settings
  // per breakpoint, each a number from 0 on — the shape read as { grid: { breakpoint: { setting: number } } }
  if ('grid' in node) {
    const grid: unknown = node.grid;
    const breakpoints = rules.breakpoints;
    const settingsOk = (name: string, held: unknown) =>
      isRecord(held) && Object.keys(held).length > 0 && Object.entries(held).every(([b, values]) => breakpoints.has(b) && isRecord(values) && Object.keys(values).length > 0 && Object.entries(values).every(([s, v]) => settingOf(name, s) !== undefined && typeof v === 'number' && Number.isFinite(v) && v >= 0));
    if (!root) bad(`${at}/grid`, 'only a page’s root holds the page’s grid settings');
    else if (!isRecord(grid) || Object.keys(grid).length === 0 || !Object.entries(grid).every(([name, held]) => settingsOk(name, held)))
      bad(`${at}/grid`, 'grid holds the settings of the columns, rows and dots grids, each by breakpoint and a number from 0, absent while none is set');
  }
  // the label colours (model.ts; the user's real-use audit): on a page's root only, an id of that page to a colour
  if ('layerColors' in node) {
    const colors: unknown = node.layerColors;
    if (!root) bad(`${at}/layerColors`, 'only a page’s root holds the label colours');
    else if (!Array.isArray(colors) || colors.length === 0 || !colors.every((one) => isRecord(one) && typeof one.node === 'string' && one.node !== '' && typeof one.colour === 'string' && one.colour.trim() !== '')) bad(`${at}/layerColors`, 'layerColors is a list of the label colours of the page, each an element and its colour, absent while there is none');
  }
  // the authoring data of removable modules: JSON by namespace, each checked by its installed module (authoring.ts)
  if ('authoring' in node) for (const problem of authoringProblems(node.authoring)) bad(`${at}/authoring${problem.path}`, problem.message);
  if ('customAttributes' in node) {
    const custom: unknown = node.customAttributes;
    if (!isRecord(custom) || Object.keys(custom).length === 0) bad(`${at}/customAttributes`, 'customAttributes is an object with at least one attribute, or absent');
    else
      for (const [name, value] of Object.entries(custom)) {
        const why = customAttributeRefusal(name, rules);
        if (why !== null) bad(`${at}/customAttributes/${name}`, why);
        if (typeof value !== 'string') bad(`${at}/customAttributes/${name}`, 'a custom attribute value is a string');
        else {
          const unsafe = customAttributeValueRefusal(name, value);
          if (unsafe !== null) bad(`${at}/customAttributes/${name}`, unsafe);
        }
      }
  }

  if (!isRecord(node.attributes)) bad(`${at}/attributes`, 'attributes is an object');
  else {
    for (const [name, value] of Object.entries(node.attributes)) {
      const appliesTo = rules.attributes.get(name);
      if (appliesTo === undefined) bad(`${at}/attributes/${name}`, `"${name}" is not an attribute of elements.json`);
      else if (appliesTo !== 'all' && !appliesTo.includes(node.type)) {
        // an attribute the tag cannot hold: its value is moot, so the reason stays one
        bad(`${at}/attributes/${name}`, `${name} does not apply to ${node.type}`);
        continue;
      }
      if (!['string', 'number', 'boolean'].includes(typeof value)) bad(`${at}/attributes/${name}`, 'an attribute value is a string, a number or a boolean');
      // the value itself, by what the tag and the input's type allow (the audit's A3.1 and A3.44: one owner for the
      // rules, which the fields, File › Open and a paste all ask)
      const refused = attributeValueRefusal(name, value, rules) ?? formAttributeIssue(name, value);
      if (refused !== null) bad(`${at}/attributes/${name}`, refused);
    }
    // the pairs the node's attributes cannot hold at once, read once, at the attribute the reason stands at
    const pair = attributePairRefusal(node, rules);
    if (pair !== null) bad(`${at}/attributes/${pair.attribute}`, pair.message);
  }

  if (!Array.isArray(node.classes)) bad(`${at}/classes`, 'classes is a list');
  else {
    const names = new Set<string>();
    node.classes.forEach((name, i) => {
      if (typeof name !== 'string' || !CLASS_NAME.test(name)) bad(`${at}/classes/${i}`, `"${String(name)}" is not a class name`);
      else if (names.has(name)) bad(`${at}/classes/${i}`, `the class ${name} is listed twice`);
      names.add(name);
    });
  }

  validateStyles(node.styles, at, rules, bad, node.type);

  const holdsText = element.content === 'text' || element.content === 'markup';
  if (holdsText && typeof node.text !== 'string') bad(`${at}/text`, `a ${node.type} holds its ${element.content}`);
  if (!holdsText && node.text !== null) bad(`${at}/text`, `a ${node.type} holds no text`);
  // the marks of a text element's text (model.ts, src/core/text/inline.ts): the canonical tree of its text, links with
  // allowed addresses only, and only while something is marked
  if ('inline' in node) {
    const runs = parseInline(node.inline);
    if (element.content !== 'text') bad(`${at}/inline`, `a ${node.type} holds no marked text`);
    else if (runs === null) bad(`${at}/inline`, 'inline is a tree of strings, strong, em and a runs');
    else if (runs === 'unsafe') bad(`${at}/inline`, 'a link’s address starts with http, https, mailto or tel');
    else if (!hasMarks(runs)) bad(`${at}/inline`, 'inline is absent while nothing in the text is marked');
    else if (plainText(runs) !== node.text) bad(`${at}/inline`, 'the text of inline is the element’s text');
    else if (!deepEqual(canonical(runs), runs)) bad(`${at}/inline`, 'inline is the canonical tree of the marked text');
  }
  if (!Array.isArray(node.children)) {
    bad(`${at}/children`, 'children is a list');
    return;
  }
  if (element.content !== 'children' && node.children.length > 0) bad(`${at}/children`, `a ${node.type} holds ${element.content}, not element children`);
  node.children.forEach((child, i) => {
    if (!isRecord(child)) bad(`${at}/children/${i}`, 'a child is an element');
    else validateNode(child as unknown as DocNode, `${at}/children/${i}`, rules, claim, bad, false);
  });
}

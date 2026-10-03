// The manifest checker's ground (plan I.12: checkManifest split into one module per rule family): the rule ids, the
// problems and the summary it reports, the parsing of the manifest's files and the helpers the rule families share.
import type { z } from 'zod';
import { createCssMatcher, type CssMatcher } from '../css.ts';
import { FIXTURE_FILE } from '../scenario.ts';
import {
  BROWSERS,
  REFERENCE_KINDS,
  checksFileSchema,
  commandsFileSchema,
  consumersFileSchema,
  elementsFileSchema,
  environmentSchema,
  featuresFileSchema,
  generatedCompatSchema,
  generatedCssSchema,
  generatedHtmlSchema,
  generatedIconsSchema,
  exclusionsFileSchema,
  type ExclusionsFile,
  interactionsFileSchema,
  layoutFileSchema,
  propertiesFileSchema,
  referencesFileSchema,
  type Browser,
  type ChecksFile,
  type Command,
  type CommandsFile,
  type ConsumersFile,
  type Door,
  type ElementsFile,
  type Environment,
  type FeaturesFile,
  type GeneratedCompat,
  type GeneratedCss,
  type LayoutFile,
  type GeneratedHtml,
  type GeneratedIcons,
  type InteractionsFile,
  type PropertiesFile,
  type Recipe,
  type ReferencesFile,
} from '../schema.ts';


export const RULES = [
  'no-logic',
  'schema',
  'duplicate-id',
  'unknown-reference',
  'door-unknown-command',
  'command-without-door',
  'feature-command-link',
  'i18n-missing',
  'command-name',
  'handler-reference',
  'value-set',
  'all-properties',
  'css-syntax',
  'syntax-fallback',
  'browser-support',
  'vendor-prefix',
  'recipe',
  'structured-value',
  'shorthand-write',
  'composite',
  'door-writes',
  'individual-transform',
  'coupling',
  'history',
  'reference',
  'consumer',
  'html-model',
  'chord-conflict',
  'modifier-conflict',
  'order',
  'spec-missing',
  'scenario-terminal',
  'placement',
  'state-placement',
  'label-term',
  'icon-name',
  'icon-required',
  'panel',
  'exclusion',
  'fixture',
  'document-path',
  'step',
  'door-coverage',
  'tooth-proof',
  'zoom',
  'pressed',
  'style-door-section',
  'concept-row',
  'quick-panel-group',
] as const;

export type RuleId = (typeof RULES)[number];
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export interface Problem {
  rule: RuleId;
  file: string;
  path: string;
  message: string;
}

export interface ManifestInput {
  // path relative to manifest/ (forward slashes) → parsed JSON
  files: Readonly<Record<string, unknown>>;
  // locale → i18n catalogue (key → text)
  catalogues: Readonly<Record<string, unknown>>;
  // src/i18n/glossary.json: one term per concept in each language
  glossary: unknown;
  // whether a path relative to the repository root exists
  fileExists: (repoPath: string) => boolean;
  // ids that code under src/ registers, by kind (registerHandler, registerPredicate, ...)
  registered: Readonly<Record<ReferenceKind, readonly string[]>>;
  // the text of the documents the manifest's spec references point into (spec/BEHAVIOUR.md), by path
  documents: Readonly<Record<string, string>>;
}

export interface ManifestSummary {
  features: number;
  featureGroups: number;
  commands: number;
  undoableCommands: number;
  doors: number;
  doorsByKind: Record<string, number>;
  // placed doors per region of PRODUCT.md §5.3 (layout.json), and the regions and menus declared
  doorsByRegion: Record<string, number>;
  regions: number;
  menuAnchors: number;
  glossaryConcepts: number;
  elements: number;
  paletteEntries: number;
  attributes: number;
  generatedProperties: number;
  generatedShorthands: number;
  generatedElements: number;
  properties: number;
  composites: number;
  recipes: number;
  structures: number;
  couplings: number;
  // the current stable releases css-compat.json was generated for, and its BCD version
  browsers: Record<Browser, string>;
  compatSource: string;
  // generated keywords of offered lists left out because a browser lacks them
  keywordsLeftOut: number;
  // generated units of offered lists left out because a browser lacks them
  unitsLeftOut: number;
  // recipe values the official syntax rejects and the browser syntax accepts
  recipeBrowserSyntax: string[];
  // each recipe with the spec section and BCD entry it rests on
  recipeSources: string[];
  // each shorthand stored whole, with its reason
  storedWhole: string[];
  // the icon library (name and version, number of icons) and the icons the manifest names
  iconLibrary: string;
  iconsNamed: number;
  doorsWithIcon: number;
  plannedReferences: number;
  registeredReferences: number;
  referencesByKind: Record<string, number>;
  consumers: number;
  // values the official syntax rejects and the browser syntax (CSSTree's MDN data) accepts, all of
  // them for a property of the fallback allowlist
  implementedOnly: string[];
  fallbackAllowlist: string[];
  constants: number;
  gestures: number;
  keyContexts: number;
  scenarios: number;
  fixtures: number;
  // property: keyword of every excluded keyword (css-exclusions.json)
  exclusions: string[];
  i18nKeys: number;
}

export interface CheckResult {
  problems: Problem[];
  summary: ManifestSummary | null;
}

export interface Parsed {
  environment: Environment;
  elements: ElementsFile;
  properties: PropertiesFile;
  interactions: InteractionsFile;
  layout: LayoutFile;
  checks: ChecksFile;
  references: ReferencesFile;
  consumers: ConsumersFile;
  css: GeneratedCss;
  compat: GeneratedCompat;
  html: GeneratedHtml;
  icons: GeneratedIcons;
  exclusions: ExclusionsFile;
  commandFiles: { file: string; data: CommandsFile }[];
  featureFiles: { file: string; data: FeaturesFile }[];
  // fixture id → the project document of manifest/features/fixtures/<id>.json, validated by rule fixture
  fixtures: Map<string, unknown>;
}

const SINGLE_FILES: Record<string, { key: keyof Parsed; schema: z.ZodType }> = {
  'environment.json': { key: 'environment', schema: environmentSchema },
  'elements.json': { key: 'elements', schema: elementsFileSchema },
  'properties.json': { key: 'properties', schema: propertiesFileSchema },
  'interactions.json': { key: 'interactions', schema: interactionsFileSchema },
  'layout.json': { key: 'layout', schema: layoutFileSchema },
  'checks.json': { key: 'checks', schema: checksFileSchema },
  'references.json': { key: 'references', schema: referencesFileSchema },
  'consumers.json': { key: 'consumers', schema: consumersFileSchema },
  'generated/css-properties.json': { key: 'css', schema: generatedCssSchema },
  'generated/css-compat.json': { key: 'compat', schema: generatedCompatSchema },
  'generated/html-elements.json': { key: 'html', schema: generatedHtmlSchema },
  'generated/icons.json': { key: 'icons', schema: generatedIconsSchema },
  'css-exclusions.json': { key: 'exclusions', schema: exclusionsFileSchema },
};

function issuePath(path: readonly PropertyKey[]): string {
  return path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '');
}

export function schemaProblems(file: string, error: z.ZodError): Problem[] {
  return error.issues.map((issue) => {
    let message = issue.message;
    if (issue.code === 'unrecognized_keys') message = `unknown field(s): ${issue.keys.join(', ')}`;
    else if (issue.code === 'invalid_type' && /received undefined/.test(issue.message)) message = 'missing field';
    return { rule: 'schema', file, path: issuePath(issue.path), message };
  });
}

// ---------------------------------------------------------------- no logic in data

// Operators and code that never belong in a data value. CSS values and prose pass.
const EXPRESSION = /(===|!==|==|!=|&&|\|\||=>|<=|>=|\$\{|\bfunction\s*\(|\breturn\s+\S.*;)/;

export function logicProblems(files: Readonly<Record<string, unknown>>): Problem[] {
  const problems: Problem[] = [];
  for (const [file, json] of Object.entries(files)) {
    if (file.startsWith('generated/')) continue;
    const visit = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        if (EXPRESSION.test(value)) {
          problems.push({ rule: 'no-logic', file, path, message: `holds an expression (${JSON.stringify(value)}): data names predicates, actions and codecs by id and never holds code or conditions as text` });
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, `${path}[${i}]`));
      } else if (value !== null && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) visit(item, path === '' ? key : `${path}.${key}`);
      }
    };
    visit(json, '');
  }
  return problems;
}

// ---------------------------------------------------------------- vendor prefixes

// A vendor-prefixed name or value (-webkit-box, -moz-user-select) inside a string.
export const VENDOR_PREFIX = /(^|[^a-zA-Z0-9_-])-(webkit|moz|ms|o|khtml|apple|epub)-[a-zA-Z]/i;

// Every string and object key of the hand-written files that holds a vendor prefix, except where skip()
// says a prefix belongs (a compatibility recipe and the writes of its doors).
export function prefixProblems(files: Readonly<Record<string, unknown>>, skip: (file: string, path: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  for (const [file, json] of Object.entries(files)) {
    if (file.startsWith('generated/')) continue;
    const visit = (value: unknown, path: string): void => {
      if (skip(file, path)) return;
      if (typeof value === 'string') {
        if (VENDOR_PREFIX.test(value)) problems.push({ rule: 'vendor-prefix', file, path, message: `holds a vendor prefix (${JSON.stringify(value)}): prefixed properties and values appear only in a compatibility recipe` });
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, `${path}[${i}]`));
      } else if (value !== null && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          const at = path === '' ? key : `${path}.${key}`;
          if (VENDOR_PREFIX.test(key) && !skip(file, at)) problems.push({ rule: 'vendor-prefix', file, path: at, message: `the key ${JSON.stringify(key)} holds a vendor prefix: prefixed properties and values appear only in a compatibility recipe` });
          visit(item, at);
        }
      }
    };
    visit(json, '');
  }
  return problems;
}

// A frozen file cannot change, so its parsed form is kept, per schema: the generated web data, frozen by the
// loader, is parsed once however many times the manifest is checked (every planted fixture shares it).
const parsedFrozen = new WeakMap<z.ZodType, WeakMap<object, z.ZodSafeParseResult<unknown>>>();
function parseFile(schema: z.ZodType, json: unknown): z.ZodSafeParseResult<unknown> {
  if (json === null || typeof json !== 'object' || !Object.isFrozen(json)) return schema.safeParse(json);
  let bySchema = parsedFrozen.get(schema);
  if (!bySchema) {
    bySchema = new WeakMap();
    parsedFrozen.set(schema, bySchema);
  }
  let result = bySchema.get(json);
  if (!result) {
    result = schema.safeParse(json);
    bySchema.set(json, result);
  }
  return result;
}

export function parseFiles(input: ManifestInput): { parsed: Parsed | null; problems: Problem[] } {
  const problems: Problem[] = [];
  const out: Partial<Parsed> & { commandFiles: Parsed['commandFiles']; featureFiles: Parsed['featureFiles']; fixtures: Parsed['fixtures'] } = {
    commandFiles: [],
    featureFiles: [],
    fixtures: new Map(),
  };
  for (const [file, json] of Object.entries(input.files)) {
    const single = SINGLE_FILES[file];
    if (single) {
      const result = parseFile(single.schema, json);
      if (result.success) (out as Record<string, unknown>)[single.key] = result.data;
      else problems.push(...schemaProblems(file, result.error));
    } else if (/^commands\/[a-z0-9-]+\.json$/.test(file)) {
      const result = commandsFileSchema.safeParse(json);
      if (result.success) out.commandFiles.push({ file, data: result.data });
      else problems.push(...schemaProblems(file, result.error));
    } else if (/^features\/\d{2}-[a-z0-9-]+\.json$/.test(file)) {
      const result = featuresFileSchema.safeParse(json);
      if (result.success) out.featureFiles.push({ file, data: result.data });
      else problems.push(...schemaProblems(file, result.error));
    } else if (FIXTURE_FILE.test(file)) {
      // a project document: the model (validateDocument) is its schema, checked by rule fixture
      out.fixtures.set(FIXTURE_FILE.exec(file)?.[1] ?? '', json);
    } else {
      problems.push({ rule: 'schema', file, path: '', message: `not a manifest file: expected one of ${Object.keys(SINGLE_FILES).join(', ')}, commands/<domain>.json, features/<NN>-<group>.json, features/fixtures/<id>.json` });
    }
  }
  for (const file of Object.keys(SINGLE_FILES)) {
    if (!(file in input.files)) problems.push({ rule: 'schema', file, path: '', message: file.startsWith('generated/') ? 'missing generated file: run npm run gen' : 'missing manifest file' });
  }
  if (out.commandFiles.length === 0 && !Object.keys(input.files).some((f) => f.startsWith('commands/'))) {
    problems.push({ rule: 'schema', file: 'commands/', path: '', message: 'missing: no command file' });
  }
  if (out.featureFiles.length === 0 && !Object.keys(input.files).some((f) => f.startsWith('features/'))) {
    problems.push({ rule: 'schema', file: 'features/', path: '', message: 'missing: no feature file' });
  }
  if (problems.length > 0) return { parsed: null, problems };
  out.commandFiles.sort((a, b) => a.file.localeCompare(b.file));
  out.featureFiles.sort((a, b) => a.file.localeCompare(b.file));
  return { parsed: out as Parsed, problems };
}

// ---------------------------------------------------------------- PRODUCT.md §5

// The rows of the table under "## Command owners": a module path in backticks, then the command ids it owns in
// backticks. null when the section is missing.
// ---------------------------------------------------------------- HTML content model

type HtmlMeta = GeneratedHtml['elements'][string];
const CATEGORY_OF: Record<string, keyof HtmlMeta['categories']> = {
  '@metadata': 'metadata',
  '@flow': 'flow',
  '@sectioning': 'sectioning',
  '@heading': 'heading',
  '@phrasing': 'phrasing',
  '@embedded': 'embedded',
  '@interactive': 'interactive',
  '@labelable': 'labelable',
  '@form': 'form',
  '@script': 'scriptSupporting',
};

function matchesContent(tag: string, meta: HtmlMeta | undefined, pattern: string): boolean {
  const p = pattern.replace(/[?*]$/, '');
  const category = CATEGORY_OF[p];
  if (category !== undefined) return meta !== undefined && meta.categories[category] !== false;
  return p === tag;
}

// null when HTML permits <child> directly inside <parent>, the reason otherwise
export function htmlRefusal(html: GeneratedHtml, parentTag: string, childTag: string): string | null {
  const parent = html.elements[parentTag];
  const child = html.elements[childTag];
  if (!parent) return `<${parentTag}> is not an HTML element of the generated data`;
  if (parent.void) return `<${parentTag}> is a void element`;
  if (parent.textOnly) return `<${parentTag}> holds text only`;
  if (parent.permittedContent !== null && !parent.permittedContent.some((p) => matchesContent(childTag, child, p))) {
    return `<${parentTag}> permits ${parent.permittedContent.join(', ')}, not <${childTag}>`;
  }
  for (const rule of parent.permittedDescendants ?? []) {
    if (rule.exclude.some((p) => matchesContent(childTag, child, p))) return `<${parentTag}> excludes <${childTag}> from its descendants`;
  }
  if (child?.permittedParent && !child.permittedParent.includes(parentTag)) return `<${childTag}> is permitted only in ${child.permittedParent.join(', ')}`;
  if (child?.requiredAncestors) {
    const ok = child.requiredAncestors.some((selector) => {
      const parts = selector.split('>').map((s) => s.trim());
      return parts[parts.length - 2] === parentTag;
    });
    if (!ok) return `<${childTag}> requires ${child.requiredAncestors.join(' or ')}`;
  }
  return null;
}

// ---------------------------------------------------------------- browser support

// The keywords a door offers as the "generated" list of a property: the keywords of its official syntax
// (css-properties.json) that Chrome, Firefox and Safari all support (css-compat.json).
// The units a door offers with the "generated" list of a property: the units its official syntax accepts
// (css-properties.json) that Chrome, Firefox and Safari all support (css-compat.json units).
export function supportedUnits(css: GeneratedCss, compat: GeneratedCompat, property: string): string[] {
  return (css.properties[property]?.units ?? []).filter((u) => {
    const c = compat.units[u.toLowerCase()];
    return c !== undefined && BROWSERS.every((b) => c[b] !== false);
  });
}

export function supportedKeywords(css: GeneratedCss, compat: GeneratedCompat, property: string): string[] {
  const entry = compat.properties[property];
  return (css.properties[property]?.keywords ?? []).filter((k) => {
    const c = entry?.keywords[k.toLowerCase()];
    return c !== undefined && BROWSERS.every((b) => c[b] !== false);
  });
}

export const PREFIX = /^-[a-z]+-/i;
export const baseName = (name: string) => name.replace(PREFIX, '').toLowerCase();

// A recipe's generated list: the keywords every browser supports through at least one declaration of
// each group of declarations that carry the door's value (a property and its prefixed forms).
function recipeKeywords(css: GeneratedCss, compat: GeneratedCompat, recipe: Recipe): string[] {
  const valued = recipe.declarations.filter((d) => d.value === null);
  const groups = [...new Set(valued.map((d) => baseName(d.property)))].map((base) => valued.filter((d) => baseName(d.property) === base));
  const candidates = [...new Set(valued.flatMap((d) => (css.properties[d.property]?.keywords ?? []).map((k) => k.toLowerCase())))];
  return candidates.filter((k) =>
    BROWSERS.every((b) =>
      groups.every((group) =>
        group.some((d) => {
          const property = compat.properties[d.property];
          const keyword = property?.keywords[k];
          return property !== undefined && property[b] !== false && keyword !== undefined && keyword[b] !== false;
        }),
      ),
    ),
  );
}

export interface OfferData {
  properties: PropertiesFile;
  css: GeneratedCss;
  compat: GeneratedCompat;
  // the units css-exclusions.json takes out of a property's, composite's or recipe's list, as "id:unit"
  excludedUnits: ReadonlySet<string>;
}

// the units css-exclusions.json excludes, as "property:unit"
export function excludedUnitsOf(exclusions: ExclusionsFile): Set<string> {
  return new Set(exclusions.exclusions.flatMap((x) => (x.unit === null ? [] : [`${x.property}:${x.unit.toLowerCase()}`])));
}

// The keywords a door's "generated" list offers for a property, composite or recipe id: the generated
// keywords of its CSS property that all three browsers support; for a recipe, those every browser
// supports through at least one declaration of each group that carries the door's value. null for an
// unknown id. The editor's value lists and manifest:check both read the list from here.
// The units a door's "generated" list offers for a property or composite id (see supportedUnits); a recipe
// offers the units of the declarations that carry its value; null for an unknown id.
export function generatedUnits(data: OfferData, id: string): string[] | null {
  const kept = (units: string[]) => units.filter((u) => !data.excludedUnits.has(`${id}:${u.toLowerCase()}`));
  if (data.properties.properties.some((p) => p.id === id)) return kept(supportedUnits(data.css, data.compat, id));
  const composite = data.properties.composites.find((c) => c.id === id);
  if (composite) return composite.shorthand === null ? [] : kept(supportedUnits(data.css, data.compat, composite.shorthand));
  const recipe = data.properties.recipes.find((r) => r.id === id);
  if (recipe) return kept([...new Set(recipe.declarations.filter((d) => d.value === null).flatMap((d) => supportedUnits(data.css, data.compat, d.property)))]);
  return null;
}

export function generatedOffer(data: OfferData, id: string): string[] | null {
  if (data.properties.properties.some((p) => p.id === id)) return supportedKeywords(data.css, data.compat, id);
  const composite = data.properties.composites.find((c) => c.id === id);
  if (composite) return composite.shorthand === null ? [] : supportedKeywords(data.css, data.compat, composite.shorthand);
  const recipe = data.properties.recipes.find((r) => r.id === id);
  if (recipe) return recipeKeywords(data.css, data.compat, recipe);
  return null;
}

// ---------------------------------------------------------------- the rules

export interface DoorEntry {
  file: string;
  path: string;
  command: Command;
  door: Door;
  ref: string;
}

export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

// Controls that present a list of values: their doors must say which list they offer.
export const LIST_CONTROLS = new Set(['keyword-menu', 'keyword-buttons', 'length-field', 'font-menu']);

const matcherCache = new WeakMap<object, CssMatcher>();
export function cssMatcher(css: GeneratedCss): CssMatcher {
  let matcher = matcherCache.get(css);
  if (!matcher) {
    matcher = createCssMatcher({ properties: Object.fromEntries(Object.entries(css.properties).map(([name, p]) => [name, p.syntax])), types: css.types });
    matcherCache.set(css, matcher);
  }
  return matcher;
}

// a { key: number } object with exactly these keys
export function isNumbers(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === keys.length && keys.every((k) => typeof record[k] === 'number');
}

// Browser support of the generated CSS data, from MDN's browser-compat-data (BCD): for every CSS
// property and value keyword of manifest/generated/css-properties.json, whether the current stable
// Chrome, Firefox and Safari support it, and since which version. npm run gen writes the result to
// manifest/generated/css-compat.json; manifest:check lets the editor write only what all three support.
import { createRequire } from 'node:module';
import type { Lexer } from 'css-tree';
import { implementedLexer, matchImplemented, syntaxMentions } from '../../src/manifest/css.ts';
import { BROWSERS as ENGINES, type Browser as Engine, type FormShape } from '../../src/manifest/schema.ts';

const require = createRequire(import.meta.url);

// How css-compat.json decides:
// - A browser supports a property, keyword, function or unit when BCD has a support statement for its
//   current stable release (the release BCD marks "current") that needs no prefix, alternative name or
//   flag, is not a preview, was not removed, and is not a partial implementation.
// - A vendor-prefixed property (-webkit-x) is looked up as the prefixed form of the BCD entry x; a
//   property BCD lists only as the alternative name of another entry is looked up there. The keywords and
//   functions of a prefixed property have the prefixed property's support when its browser syntax names
//   them: BCD's value entries under the base entry describe the standard property.
// - keywords holds every keyword the property's official syntax or browser syntax (MDN data, bundled
//   with css-tree) names, inside functions too, and the identifier values BCD tracks for the property
//   that the browser syntax accepts (generic font families, counter styles); functions holds every
//   function either syntax names. Keys are lower-case: CSS keywords are ASCII case-insensitive.
// - An entry is a keyword's own when its key is the keyword, when its description is nothing but
//   <code> items naming it ("AccentColor and AccentColorText"), or when its description is
//   "<code>jump-</code> keywords" (every keyword starting with jump-). An entry is a function's own when
//   its key is name_function or its description starts with <code>name()</code>.
// - A function is looked up in each context it is met in: a function webref defines only in scoped
//   versions (rect() of <basic-shape> and of clip; type() of image-set(), attr() and @function) under the
//   entry of the scope on its path, which stands for it when BCD lists nothing for it there; otherwise
//   under a type on its path (css.types.basic-shape.rect), then the property's BCD entry, then its
//   longhands' entries (grid's minmax() is under grid-template-columns), then anywhere in css.types (by
//   the name its description starts with, so linear() is css.types.easing-function.linear-function). A function BCD
//   tracks nowhere is a legacy alias when its official grammar is another function's once renamed (rgba() of rgb());
//   otherwise it has no support (image(), device-cmyk()).
// - A keyword is looked up under the property's entry and its longhands' entries. Otherwise it is
//   decided in each context the syntax has it in (every path of types and functions that reaches it):
//   - an entry of its own under the css.types entry of a type on the way, innermost first
//     (<system-color> → css.types.color.system-color.mark);
//   - inside a function, through a type BCD tracks (red in linear-gradient(), through <color>): the
//     keyword belongs to that type and is decided as outside functions; the function is checked as one;
//   - inside a function, in the function's own grammar: the function's subfeature that names it in its description
//     (colorSpace_parameter_accepts_display-p3-linear_value) or that BCD's convention ties to it
//     (KEYWORD_SUBFEATURES: relative_syntax is from); else the function's support when MDN's syntax
//     names the keyword inside that very function; else no support. BCD tracks shape() and
//     contrast-color() but none of their keywords, and MDN's syntax does not know them, so their
//     keywords (from, line, tbd-fg) have no support;
//   - outside functions: a type's entry that lists none of its values stands for them when the browser
//     syntax names the keyword.
//   inFunctions records the keyword's support inside each function every browser supports (omitted
//   where it equals the keyword's own; inside any other function, the function itself is refused); the
//   checker reads the one of the function a written keyword sits in.
// - A keyword outside functions that no context decides has its property's support when both syntaxes
//   name it, and no support when it is prefixed, when only the browser syntax names it (context-fill),
//   when MDN files it under a -non-standard-* or -legacy-* type, or when MDN does not name it. A keyword
//   that exists only inside functions has its support inside the functions every browser has.
// - valueFunctions holds the general-purpose functions CSS Values defines (webref), which CSSTree matches
//   wherever their result type is accepted and so no property's syntax names: calc(), min(), max(),
//   clamp(), round()...
// - units holds every unit of css-properties.json's unit lists, from the css.types entry of its list
//   (generateUnits).
// - forms holds the syntax forms BCD tracks as subfeatures (two-value syntax, multiple layers, negative
//   values), with the value shape each stands for (FORM_SHAPES).

interface Statement {
  version_added: string | false | null;
  version_removed?: string;
  prefix?: string;
  alternative_name?: string;
  flags?: unknown[];
  partial_implementation?: boolean;
}
interface CompatBlock {
  support: Partial<Record<string, Statement | Statement[]>>;
}
interface BcdNode {
  __compat?: CompatBlock;
  [key: string]: unknown;
}
interface Bcd {
  __meta: { version: string };
  browsers: Record<string, { releases: Record<string, { status: string }> }>;
  css: { properties: Record<string, BcdNode>; types: Record<string, BcdNode> };
}

interface Support {
  chrome: string | false;
  firefox: string | false;
  safari: string | false;
  // why a browser has no support; only browsers without support appear
  why: Partial<Record<Engine, string>>;
}
export interface KeywordCompat extends Support {
  // the BCD entry that decided: the keyword's own entry, or its property's entry for an untracked keyword
  bcd: string | null;
}
// a keyword: its support, and its support inside each function it appears in
interface KeywordEntry extends KeywordCompat {
  inFunctions: Record<string, KeywordCompat>;
}
interface FormCompat extends KeywordCompat {
  shape: FormShape;
}
export interface PropertyCompat extends Support {
  bcd: string | null;
  // how the name maps to the BCD entry when it is not the entry's own name
  via: string | null;
  keywords: Record<string, KeywordEntry>;
  functions: Record<string, KeywordCompat>;
  forms: Record<string, FormCompat>;
}

function loadBcd(): Bcd {
  return require('@mdn/browser-compat-data') as Bcd;
}

function versionParts(version: string): number[] {
  return version.replace(/^≤/, '').split('.').map(Number);
}

// a ≤ b for release numbers such as "10.1" and "≤4"
function atMost(a: string, b: string): boolean {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return true;
}

function currentReleases(bcd: Bcd): Record<Engine, string> {
  const out = {} as Record<Engine, string>;
  for (const engine of ENGINES) {
    const current = Object.entries(bcd.browsers[engine]?.releases ?? {}).filter(([, r]) => r.status === 'current').map(([v]) => v);
    const latest = current.sort((a, b) => (atMost(a, b) ? 1 : -1))[0];
    if (latest === undefined) throw new Error(`BCD marks no current ${engine} release`);
    out[engine] = latest;
  }
  return out;
}

interface Form {
  prefix: string | null;
  alternativeName: string | null;
}
const PLAIN: Form = { prefix: null, alternativeName: null };

type Verdict = { since: string } | { since: null; why: string };

// The reasons a browser lacks support, most telling first.
const REASON_ORDER = ['partial', 'prefix', 'alternative', 'flag', 'preview', 'later', 'removed', 'no', 'unknown'] as const;

function verdict(block: CompatBlock, engine: Engine, current: string, form: Form): Verdict {
  const statements = [block.support[engine] ?? []].flat();
  if (statements.length === 0) return { since: null, why: 'BCD has no data for this browser' };
  const reasons = new Map<(typeof REASON_ORDER)[number], string>();
  const note = (kind: (typeof REASON_ORDER)[number], text: string) => {
    if (!reasons.has(kind)) reasons.set(kind, text);
  };
  for (const s of statements) {
    const prefix = s.prefix ?? null;
    const alternativeName = s.alternative_name ?? null;
    const usable = typeof s.version_added === 'string' && s.version_added !== 'preview' && s.flags === undefined && s.version_removed === undefined;
    if (prefix !== form.prefix || alternativeName !== form.alternativeName) {
      if (usable && prefix !== null) note('prefix', `only with the ${prefix} prefix (since ${String(s.version_added)})`);
      else if (usable && alternativeName !== null) note('alternative', `only under the name ${alternativeName} (since ${String(s.version_added)})`);
      continue;
    }
    if (s.version_added === false) {
      note('no', 'not supported');
      continue;
    }
    if (s.version_added === null) {
      note('unknown', 'support unknown');
      continue;
    }
    if (s.flags !== undefined) {
      note('flag', 'only behind a flag');
      continue;
    }
    if (s.version_added === 'preview') {
      note('preview', 'only in a preview release');
      continue;
    }
    if (!atMost(s.version_added, current)) {
      note('later', `added in ${s.version_added}, after the current release ${current}`);
      continue;
    }
    if (s.version_removed !== undefined && s.version_removed !== 'preview' && atMost(s.version_removed, current)) {
      note('removed', `removed in ${s.version_removed}`);
      continue;
    }
    if (s.partial_implementation === true) {
      note('partial', `partial implementation since ${s.version_added}`);
      continue;
    }
    return { since: s.version_added };
  }
  const why = REASON_ORDER.filter((k) => reasons.has(k)).map((k) => reasons.get(k)).join('; ');
  return { since: null, why: why === '' ? 'not supported' : why };
}

function supportOf(block: CompatBlock | undefined, current: Record<Engine, string>, form: Form): Support {
  const out: Support = { chrome: false, firefox: false, safari: false, why: {} };
  for (const engine of ENGINES) {
    const v = block ? verdict(block, engine, current[engine], form) : { since: null, why: 'BCD has no entry' };
    if (v.since !== null) out[engine] = v.since;
    else out.why[engine] = v.why;
  }
  return out;
}

function supportedCount(s: Support): number {
  return ENGINES.filter((e) => s[e] !== false).length;
}

// every engine supports it only if every entry supports it; the version is the latest of them
function combine(all: Support[]): Support {
  const out: Support = { chrome: false, firefox: false, safari: false, why: {} };
  for (const engine of ENGINES) {
    const missing = all.find((s) => s[engine] === false);
    if (missing) {
      out.why[engine] = missing.why[engine] ?? 'not supported';
      continue;
    }
    const versions = all.map((s) => s[engine]).filter((v): v is string => v !== false);
    out[engine] = versions.sort((a, b) => (atMost(a, b) ? 1 : -1))[0] ?? false;
  }
  return out;
}

const IDENTIFIER = /^-?[a-z][a-z0-9]*(-[a-z0-9]+)*$/i;

function children(node: BcdNode): [string, BcdNode][] {
  return Object.entries(node).filter(([key]) => key !== '__compat') as [string, BcdNode][];
}

// The <code>…</code> items of an entry's description, lower-cased, when the description is nothing but
// those items ("<code>AccentColor</code> and <code>AccentColorText</code>", "<code>fit-content()</code>").
// A description with more words tells something about a value ("<code>oblique</code> can accept an
// <code>&lt;angle&gt;</code>"): that entry is not the value's own.
function codes(node: BcdNode): string[] {
  const description = (node.__compat as { description?: string } | undefined)?.description ?? '';
  const rest = description.replace(/<code>.*?<\/code>/g, '').replace(/\b(and|or)\b|[,\s]/g, '');
  if (rest !== '') return [];
  return [...description.matchAll(/<code>(.*?)<\/code>/g)].map((m) => (m[1] ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').toLowerCase());
}

// the first <code>…</code> item of an entry's description, lower-cased: "color()" in "<code>color()</code>
// (Profiled color values)", "<image>" in "<code>&lt;image&gt;</code>"
function firstCode(node: BcdNode): string | null {
  const description = (node.__compat as { description?: string } | undefined)?.description ?? '';
  const first = /^<code>(.*?)<\/code>/.exec(description)?.[1];
  return first === undefined ? null : first.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').toLowerCase();
}

// every <code>…</code> item of an entry's description, lower-cased, whatever else the description says
// ("<code>colorSpace</code> parameter accepts <code>display-p3-linear</code> value")
function allCodes(node: BcdNode): string[] {
  const description = (node.__compat as { description?: string } | undefined)?.description ?? '';
  return [...description.matchAll(/<code>(.*?)<\/code>/g)].map((m) => (m[1] ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').toLowerCase());
}

// BCD's convention for a function's subfeature that concerns one keyword without naming it: the relative
// color syntax (rgb(from …), color(from …)) is the subfeature relative_syntax of each color function.
const KEYWORD_SUBFEATURES: { key: RegExp; keyword: string }[] = [{ key: /^relative_syntax$/, keyword: 'from' }];

type Kind = 'keyword' | 'function';

// Whether a BCD entry is the entry of a keyword or a function. A keyword's: its key, or a description made
// only of <code> items that name it. A function's: the key name_function, or a description that starts
// with <code>name()</code> (a type's description starts with <code>&lt;name&gt;</code>: css.types.image
// is the <image> type, not the image() function).
function entryIs(key: string, node: BcdNode, name: string, kind: Kind): boolean {
  const k = key.toLowerCase();
  // "<code>jump-</code> keywords for <code>steps()</code>": every keyword that starts with jump-
  const family = /^<code>([a-z-]+-)<\/code> keywords\b/.exec((node.__compat as { description?: string } | undefined)?.description ?? '')?.[1];
  if (kind === 'keyword') return k === name || codes(node).includes(name) || (family !== undefined && name.startsWith(family));
  return k === `${name}_function` || firstCode(node) === `${name}()`;
}

interface Found {
  path: string;
  block: CompatBlock;
}

// the entries of a keyword or function under a node: its children, and the children of *_context groups
function entriesUnder(node: BcdNode, path: string, name: string, kind: Kind): Found[] {
  const direct = children(node).filter(([key, child]) => child.__compat !== undefined && entryIs(key, child, name, kind));
  if (direct.length > 0) return direct.map(([key, child]) => ({ path: `${path}.${key}`, block: child.__compat as CompatBlock }));
  const found: Found[] = [];
  for (const [group, child] of children(node).filter(([key]) => key.endsWith('_context'))) {
    for (const [key, entry] of children(child)) {
      if (entry.__compat && entryIs(key, entry, name, kind)) found.push({ path: `${path}.${group}.${key}`, block: entry.__compat });
    }
  }
  return found;
}

// The BCD entry of a value type or function under css.types (<system-color> → css.types.color.system-color;
// the function color() → css.types.color.color, whose description starts with <code>color()</code>).
// Nodes under a feature group (a key with "_", such as attr's type_function) are not types. The
// shallowest entry wins; a function takes only an entry that is a function's.
function typeIndex(types: Record<string, BcdNode>): (name: string) => { path: string; node: BcdNode } | undefined {
  // types by their lower-case key; functions by the name their description starts with
  // (css.types.easing-function.linear-function is "<code>linear()</code>")
  const byKey = new Map<string, { path: string; node: BcdNode; depth: number }[]>();
  const byFunction = new Map<string, { path: string; node: BcdNode; depth: number }[]>();
  const add = (map: typeof byKey, name: string, entry: { path: string; node: BcdNode; depth: number }) => {
    if (!map.has(name)) map.set(name, []);
    map.get(name)?.push(entry);
  };
  const visit = (node: BcdNode, path: string, depth: number) => {
    for (const [key, child] of children(node)) {
      if (key.includes('_')) continue;
      const at = `${path}.${key}`;
      if (child.__compat) {
        add(byKey, key.toLowerCase(), { path: at, node: child, depth });
        const code = firstCode(child);
        if (code !== null && /^[a-z][a-z0-9-]*\(\)$/.test(code)) add(byFunction, code, { path: at, node: child, depth });
      }
      visit(child, at, depth + 1);
    }
  };
  visit(types as BcdNode, 'css.types', 1);
  return (name) => {
    const n = name.toLowerCase();
    if (n.endsWith('()')) return [...(byFunction.get(n) ?? [])].sort((a, b) => a.depth - b.depth)[0];
    const entries = [...(byKey.get(n) ?? [])].sort((a, b) => a.depth - b.depth);
    return entries.find((e) => firstCode(e.node) === `<${n}>`) ?? entries.find((e) => firstCode(e.node) !== `${n}()`);
  };
}

// The syntax forms BCD tracks as subfeatures of a property, and the value shape each one stands for.
const FORM_SHAPES: { key: RegExp; shape: FormShape }[] = [
  { key: /^(two_value_syntax|two-values|2-value)$/, shape: 'components-2' },
  { key: /^three_value_syntax$/, shape: 'components-3' },
  { key: /^4_values_for_4_corners$/, shape: 'components-4' },
  { key: /^(multiple_keywords|multi-keyword_values)$/, shape: 'keywords-2' },
  { key: /^multiple_(backgrounds|shadows|mask_images)$/, shape: 'layers-2' },
  { key: /^negative_values$/, shape: 'negative' },
];

interface Candidate {
  path: string;
  node: BcdNode;
  form: Form;
  via: string | null;
}

const untracked = (why: string): Support => ({ chrome: false, firefox: false, safari: false, why: { chrome: why, firefox: why, safari: why } });

// A function whose official grammar is another function's, once its name is replaced by the other's, is
// that function's legacy alias (rgba() of rgb(), hsla() of hsl()): the syntax of name() and of every type
// named after it must match the renamed syntax of the other function and its types.
function aliasOf(bare: string, syntaxes: Readonly<Record<string, string>>, candidates: Iterable<string>): string | null {
  const own = syntaxes[`${bare}()`];
  if (own === undefined) return null;
  for (const other of candidates) {
    if (other === bare || !bare.startsWith(other)) continue;
    const renamed = (text: string) => text.split(bare).join(other);
    if (syntaxes[`${other}()`] !== renamed(own)) continue;
    const related = Object.keys(syntaxes).filter((t) => t.includes(bare) && t !== `${bare}()`);
    if (related.every((t) => syntaxes[renamed(t)] !== undefined && syntaxes[renamed(t)] === renamed(syntaxes[t] ?? ''))) return other;
  }
  return null;
}

export function generateCompatProperties(
  names: Iterable<string>,
  officialLexer: Lexer,
  syntaxes: Readonly<Record<string, string>>,
  longhandsOf: (name: string) => readonly string[],
  // functions webref defines only in scoped versions → the scope roots (inlined by the generator)
  scopedFunctions: Readonly<Record<string, readonly string[]>>,
  bcd: Bcd = loadBcd(),
): { browsers: Record<Engine, string>; properties: Record<string, PropertyCompat> } {
  const current = currentReleases(bcd);
  const entries = bcd.css.properties;
  const typeEntry = typeIndex(bcd.css.types);
  const trackedFunctions = Object.keys(syntaxes).filter((t) => t.endsWith('()') && typeEntry(t) !== undefined).map((t) => t.slice(0, -2));
  // BCD entries that name another property as an alternative name of theirs
  const alternatives = new Map<string, string>();
  for (const [name, node] of Object.entries(entries)) {
    for (const statement of Object.values(node.__compat?.support ?? {}).flat()) {
      if (statement?.alternative_name && !alternatives.has(statement.alternative_name)) alternatives.set(statement.alternative_name, name);
    }
  }
  const candidatesOf = (name: string): Candidate[] => {
    const out: Candidate[] = [];
    const own = entries[name];
    if (own) out.push({ path: `css.properties.${name}`, node: own, form: PLAIN, via: null });
    const prefixed = /^(-[a-z]+-)(.+)$/.exec(name);
    const base = prefixed?.[2] !== undefined ? entries[prefixed[2]] : undefined;
    if (prefixed && base) out.push({ path: `css.properties.${prefixed[2]}`, node: base, form: { prefix: prefixed[1] ?? null, alternativeName: null }, via: `the ${prefixed[1]} prefix of ${prefixed[2]}` });
    const holder = alternatives.get(name);
    const alt = holder !== undefined ? entries[holder] : undefined;
    if (holder !== undefined && alt) out.push({ path: `css.properties.${holder}`, node: alt, form: { prefix: null, alternativeName: name }, via: `the alternative name of ${holder}` });
    return out;
  };

  const properties: Record<string, PropertyCompat> = {};
  for (const name of names) {
    // the candidate that most browsers support decides; the first one wins a tie
    let best: { candidate: Candidate; support: Support } | null = null;
    for (const candidate of candidatesOf(name)) {
      const support = supportOf(candidate.node.__compat, current, candidate.form);
      if (best === null || supportedCount(support) > supportedCount(best.support)) best = { candidate, support };
    }
    const property: Support = best?.support ?? supportOf(undefined, current, PLAIN);
    const node = best?.candidate.node;
    const path = best?.candidate.path ?? null;
    const prefixedForm = best !== null && best.candidate.form.prefix !== null;
    const official = syntaxMentions(officialLexer, name);
    const browserSyntax = syntaxMentions(implementedLexer, name);
    const inherit = (): KeywordCompat => ({ bcd: path, chrome: property.chrome, firefox: property.firefox, safari: property.safari, why: { ...property.why } });

    // The BCD entry of a function on a keyword's path: the property's own entry for it
    // (fit-content_function, repeat), or its entry under css.types (color(), shape()).
    // the property's BCD entry, then the entries of its longhands (BCD records grid's minmax() under
    // grid-template-columns)
    const ownNodes: { path: string; node: BcdNode }[] = [];
    if (node && path !== null) ownNodes.push({ path, node });
    for (const longhand of longhandsOf(name)) {
      const entry = entries[longhand];
      if (entry) ownNodes.push({ path: `css.properties.${longhand}`, node: entry });
    }
    // The BCD entry of a function met on a path of types and functions (context, outermost first):
    // - a function webref defines only in scoped versions takes the version whose scope is on the path, and
    //   is looked up under that scope's entry; the scope's own entry stands for it when BCD lists nothing
    //   for it there (type() of image-set() → css.types.image.image-set);
    // - otherwise an entry for it under a type on the path, innermost first (rect() of <basic-shape> →
    //   css.types.basic-shape.rect), then under the property and its longhands, then anywhere in
    //   css.types, then as a legacy alias.
    const functionEntry = (fn: string, context: string[] = [], seenAliases: string[] = []): { path: string; node: BcdNode } | undefined => {
      const bare = fn.replace(/\(\)$/, '');
      // never under the function's own entry: its subfeatures (color-mix()'s variadic_color_arguments) are not the
      // function
      const functionUnder = (entry: { path: string; node: BcdNode }) => {
        if (firstCode(entry.node) === `${bare}()`) return undefined;
        const found = children(entry.node).find(([key, child]) => child.__compat !== undefined && entryIs(key, child, bare, 'function'));
        return found ? { path: `${entry.path}.${found[0]}`, node: found[1] } : undefined;
      };
      const scopes = scopedFunctions[bare];
      if (scopes !== undefined) {
        const scope = scopes.find((root) => context.includes(root) || root === name);
        if (scope === undefined) return undefined;
        const scopeEntry = scope === name ? (node && path !== null ? { path, node } : undefined) : typeEntry(scope);
        return scopeEntry ? (functionUnder(scopeEntry) ?? scopeEntry) : undefined;
      }
      for (const t of [...context].reverse()) {
        const entry = typeEntry(t);
        const found = entry ? functionUnder(entry) : undefined;
        if (found) return found;
      }
      for (const own of ownNodes) {
        const found = children(own.node).find(([key, child]) => child.__compat !== undefined && entryIs(key, child, bare, 'function'));
        if (found) return { path: `${own.path}.${found[0]}`, node: found[1] };
      }
      const typed = typeEntry(`${bare}()`);
      if (typed) return typed;
      const alias = aliasOf(bare, syntaxes, trackedFunctions);
      return alias !== null && !seenAliases.includes(alias) ? functionEntry(`${alias}()`, context, [...seenAliases, bare]) : undefined;
    };
    // whether the browser syntax (MDN data) names the keyword inside that very function
    const mdnNamesIn = (keyword: string, fn: string) => (browserSyntax.keywords.get(keyword) ?? []).some((p) => p.includes(fn));

    // A keyword in one of its contexts: an entry of its own under a type on the path; inside a function,
    // the function's subfeature that names it (or the BCD convention for it), else the function's support
    // when MDN's syntax of that function names it, else none; outside functions, a type whose entry lists
    // none of its values stands for them when MDN names the keyword. null: no context decides.
    const inContext = (keyword: string, context: string[]): KeywordCompat | null => {
      const inner = [...context].reverse();
      for (const t of inner) {
        const entry = typeEntry(t);
        const own = entry ? entriesUnder(entry.node, entry.path, keyword, 'keyword') : [];
        if (own.length > 0) return { bcd: own.map((f) => f.path).join(' + '), ...combine(own.map((f) => supportOf(f.block, current, PLAIN))) };
      }
      // a type whose entry lists none of its values stands for them, when the browser syntax names the keyword
      const typeStandsFor = (types: string[]): KeywordCompat | null => {
        const innermost = [...types].reverse().map((t) => typeEntry(t)).find((e) => e !== undefined);
        if (innermost && browserSyntax.keywords.has(keyword) && !children(innermost.node).some(([key]) => IDENTIFIER.test(key))) return { bcd: innermost.path, ...supportOf(innermost.node.__compat, current, PLAIN) };
        return null;
      };
      const at = context.map((t) => t.endsWith('()')).lastIndexOf(true);
      if (at < 0) return typeStandsFor(context);
      const fn = context[at] ?? '';
      // A keyword of a general type used as an argument (red in linear-gradient(), through <color>) belongs
      // to that type, as outside functions; the function's own support is checked as a function.
      const between = context.slice(at + 1);
      if (between.some((t) => typeEntry(t) !== undefined)) return typeStandsFor(between) ?? untrackedKeyword(keyword, [context]);
      // a keyword of the function's own grammar (srgb in color(), from in rgb(), tbd-fg in contrast-color())
      const entry = functionEntry(fn, context.slice(0, at));
      if (!entry) return { bcd: null, ...untracked(`BCD does not track ${fn}, which it belongs to`) };
      const subfeatures = children(entry.node).filter(([key, child]) => child.__compat !== undefined && (allCodes(child).includes(keyword) || KEYWORD_SUBFEATURES.some((c) => c.key.test(key) && c.keyword === keyword)));
      if (subfeatures.length > 0) return { bcd: subfeatures.map(([key]) => `${entry.path}.${key}`).join(' + '), ...combine(subfeatures.map(([, child]) => supportOf(child.__compat, current, PLAIN))) };
      if (mdnNamesIn(keyword, fn)) return { bcd: entry.path, ...supportOf(entry.node.__compat, current, PLAIN) };
      return { bcd: null, ...untracked(`BCD tracks ${fn} but not this keyword, and the browser syntax (MDN data) of ${fn} does not name it`) };
    };

    const merge = (results: KeywordCompat[]): KeywordCompat => ({ bcd: [...new Set(results.map((r) => r.bcd).filter((b) => b !== null))].join(' + ') || null, ...combine(results) });
    const innermostFunction = (context: string[]) => [...context].reverse().find((t) => t.endsWith('()'))?.slice(0, -2) ?? null;
    const fullySupported = (s: Support) => ENGINES.every((e) => s[e] !== false);

    // A keyword outside any function (what a keyword list offers) when no entry of its own and no
    // context decides: its property's support when both syntaxes name it; no support when it is
    // prefixed, when only the browser syntax names it (context-fill), or when that syntax lists it as
    // non-standard or does not name it.
    const untrackedKeyword = (keyword: string, contexts: string[][]): KeywordCompat => {
      if (/^-[a-z]+-/.test(keyword)) return { bcd: null, ...untracked('a prefixed keyword BCD does not track') };
      // MDN files legacy values under types it names -non-standard-* or -legacy-*
      if (!official.keywords.has(keyword) && contexts.some((c) => c.some((t) => /^-(non-standard|legacy)/.test(t)))) return { bcd: null, ...untracked('not tracked by BCD, and the browser syntax (MDN data) lists it as non-standard') };
      if (!official.keywords.has(keyword)) return { bcd: null, ...untracked('not tracked by BCD, and only the browser syntax (MDN data) names it, not the official one') };
      if (browserSyntax.keywords.has(keyword) || matchImplemented(name, keyword) === null) return inherit();
      return { bcd: null, ...untracked('not tracked by BCD, and the browser syntax (MDN data) does not name it') };
    };

    const lookUpKeyword = (keyword: string): KeywordEntry => {
      if (path === null || !node) return { bcd: null, ...untracked('its property has no BCD entry'), inFunctions: {} };
      // BCD's value entries under the base entry describe the standard property, not its prefixed form
      if (prefixedForm) return { ...(browserSyntax.keywords.has(keyword) ? inherit() : { bcd: null, ...untracked(`the browser syntax (MDN data) of ${name} does not name it`) }), inFunctions: {} };
      const own = entriesUnder(node, path, keyword, 'keyword');
      if (own.length > 0) return { ...merge(own.map((f) => ({ bcd: f.path, ...supportOf(f.block, current, PLAIN) }))), inFunctions: {} };
      const inLonghands = ownNodes.slice(1).flatMap((o) => entriesUnder(o.node, o.path, keyword, 'keyword'));
      if (inLonghands.length > 0) return { ...merge(inLonghands.map((f) => ({ bcd: f.path, ...supportOf(f.block, current, PLAIN) }))), inFunctions: {} };
      // every context the official syntax (or, for a keyword only MDN names, the browser syntax) has it in
      const contexts = official.keywords.get(keyword) ?? browserSyntax.keywords.get(keyword) ?? [];
      // Inside a function, the keyword's support there (the checker reads it for a keyword in that function).
      // Only functions every browser supports are recorded: inside any other, the function itself is refused.
      const usableFunction = (fn: string, context: string[]) => {
        const entry = functionEntry(`${fn}()`, context.slice(0, context.lastIndexOf(`${fn}()`)));
        return entry !== undefined && fullySupported(supportOf(entry.node.__compat, current, PLAIN));
      };
      const inFunctions: Record<string, KeywordCompat> = {};
      const byFunction = new Map<string, KeywordCompat[]>();
      let onlyInLackingFunctions = contexts.length > 0;
      for (const context of contexts) {
        const fn = innermostFunction(context);
        if (fn === null || usableFunction(fn, context)) onlyInLackingFunctions = false;
        if (fn === null || !usableFunction(fn, context)) continue;
        const result = inContext(keyword, context);
        if (result !== null) byFunction.set(fn, [...(byFunction.get(fn) ?? []), result]);
      }
      for (const [fn, results] of [...byFunction].sort(([x], [y]) => x.localeCompare(y))) inFunctions[fn] = merge(results);
      // a function context that says the same as the keyword outside functions adds nothing: the checker falls back to
      // that
      const same = (x: KeywordCompat, y: KeywordCompat) => JSON.stringify(x) === JSON.stringify(y);
      const withoutEqual = (overall: KeywordCompat): Record<string, KeywordCompat> => Object.fromEntries(Object.entries(inFunctions).filter(([, v]) => !same(v, overall)));
      // outside functions: the contexts outside any function decide, else the untracked rules
      const outside = contexts.filter((c) => innermostFunction(c) === null);
      if (outside.length > 0) {
        const decided = outside.map((c) => inContext(keyword, c)).filter((r): r is KeywordCompat => r !== null);
        const overall = decided.length > 0 ? merge(decided) : untrackedKeyword(keyword, contexts);
        return { ...overall, inFunctions: withoutEqual(overall) };
      }
      // a keyword that exists only inside functions: its support inside the functions every browser has
      const inside = Object.values(inFunctions);
      if (inside.length > 0) {
        const overall = merge(inside);
        return { ...overall, inFunctions: withoutEqual(overall) };
      }
      if (onlyInLackingFunctions) return { bcd: null, ...untracked('it exists only inside functions a browser lacks'), inFunctions };
      return { ...untrackedKeyword(keyword, contexts), inFunctions };
    };

    // A function: its own entry under the property, or under css.types for a function the syntax reaches
    // through a type or another function; BCD tracks functions well, so one it does not track has no support.
    const lookUpFunction = (fn: string): KeywordCompat => {
      if (path === null || !node) return { bcd: null, ...untracked('its property has no BCD entry') };
      if (prefixedForm) return browserSyntax.functions.has(fn) ? inherit() : { bcd: null, ...untracked(`the browser syntax (MDN data) of ${name} does not name it`) };
      if (/^-[a-z]+-/.test(fn)) return { bcd: null, ...untracked('a prefixed function BCD does not track') };
      // every context the official syntax (or, for a function only MDN names, the browser syntax) meets it in
      const contexts = official.functions.get(fn) ?? browserSyntax.functions.get(fn) ?? [[]];
      const found = contexts.map((c) => functionEntry(`${fn}()`, c));
      if (found.every((e) => e !== undefined)) {
        const entries = [...new Map(found.map((e) => [e.path, e])).values()];
        return { bcd: entries.map((e) => e.path).join(' + '), ...combine(entries.map((e) => supportOf(e.node.__compat, current, PLAIN))) };
      }
      return { bcd: null, ...untracked('BCD does not track this function') };
    };

    // custom identifiers BCD tracks as values of the property (generic families, counter styles)
    const tracked: string[] = [];
    if (node) {
      const values = [...children(node), ...children(node).filter(([key]) => key.endsWith('_context')).flatMap(([, group]) => children(group))];
      for (const [key] of values) {
        const k = key.toLowerCase();
        if (IDENTIFIER.test(k) && !official.keywords.has(k) && !browserSyntax.keywords.has(k) && !tracked.includes(k) && matchImplemented(name, k) === null) tracked.push(k);
      }
    }
    const keywords: Record<string, KeywordEntry> = {};
    for (const keyword of new Set([...official.keywords.keys(), ...browserSyntax.keywords.keys(), ...tracked.sort()])) keywords[keyword] = lookUpKeyword(keyword);
    const functions: Record<string, KeywordCompat> = {};
    for (const fn of new Set([...official.functions.keys(), ...browserSyntax.functions.keys()])) functions[fn] = lookUpFunction(fn);
    const forms: Record<string, FormCompat> = {};
    if (node && path !== null && !prefixedForm) {
      for (const [key, child] of children(node)) {
        const shape = FORM_SHAPES.find((f) => f.key.test(key))?.shape;
        if (shape && child.__compat) forms[key] = { shape, bcd: `${path}.${key}`, ...supportOf(child.__compat, current, PLAIN) };
      }
    }
    properties[name] = { bcd: path, via: best?.candidate.via ?? null, ...property, keywords, functions, forms };
  }
  return { browsers: current, properties };
}

// The general-purpose functions CSS Values defines (calc(), min(), clamp(), round()...): CSSTree matches
// them wherever a number, length, angle... is accepted, so no property's syntax names them. Each is looked
// up as a function's entry anywhere under css.types, and has no support when BCD does not track it.
export function generateValueFunctions(names: Iterable<string>, bcd: Bcd = loadBcd()): Record<string, KeywordCompat> {
  const current = currentReleases(bcd);
  const found = new Map<string, { path: string; node: BcdNode; depth: number }[]>();
  const visit = (node: BcdNode, path: string, depth: number) => {
    for (const [key, child] of children(node)) {
      if (key.includes('_')) continue;
      const at = `${path}.${key}`;
      const code = child.__compat ? firstCode(child) : null;
      if (code !== null && code.endsWith('()')) {
        const name = code.slice(0, -2);
        if (!found.has(name)) found.set(name, []);
        found.get(name)?.push({ path: at, node: child, depth });
      }
      visit(child, at, depth + 1);
    }
  };
  visit(bcd.css.types as BcdNode, 'css.types', 1);
  const out: Record<string, KeywordCompat> = {};
  for (const name of [...names].sort()) {
    const entry = [...(found.get(name) ?? [])].sort((a, b) => a.depth - b.depth)[0];
    out[name] = entry ? { bcd: entry.path, ...supportOf(entry.node.__compat, current, PLAIN) } : { bcd: null, ...untracked('BCD does not track this function') };
  }
  return out;
}

// Every unit of css-properties.json's unit lists (length, angle, time...), looked up under the css.types
// entry of its list: its own entry (the key, or a description that names it in <code> among units:
// "<code>dvb</code>, <code>dvh</code>… units"); else the list's own entry, which stands for the units BCD
// does not list separately (px, cm, s, ms, %); a list BCD has no entry for (frequency, decibel) gives no
// support.
export function generateUnits(lists: Record<string, readonly string[]>, bcd: Bcd = loadBcd()): Record<string, KeywordCompat> {
  const current = currentReleases(bcd);
  const out: Record<string, KeywordCompat> = {};
  for (const [list, units] of Object.entries(lists).sort(([x], [y]) => x.localeCompare(y))) {
    const type = bcd.css.types[list];
    for (const unit of units) {
      const u = unit.toLowerCase();
      if (!type) {
        out[u] = { bcd: null, ...untracked(`BCD has no entry for the ${list} type`) };
        continue;
      }
      const own = children(type).filter(([key, child]) => child.__compat !== undefined && (key.toLowerCase() === u || (allCodes(child).includes(u) && /\bunits?\b/.test((child.__compat as { description?: string }).description ?? ''))));
      out[u] = own.length > 0
        ? { bcd: own.map(([key]) => `css.types.${list}.${key}`).join(' + '), ...combine(own.map(([, child]) => supportOf(child.__compat, current, PLAIN))) }
        : { bcd: `css.types.${list}`, ...supportOf(type.__compat, current, PLAIN) };
    }
  }
  return out;
}

export function bcdVersion(bcd: Bcd = loadBcd()): string {
  return bcd.__meta.version;
}

// CSSTree's lexer built from the official CSS syntaxes. The generator uses it to derive the
// keyword and unit lists of manifest/generated/css-properties.json, and manifest:check uses the
// same construction, from that generated file, to validate every value a door offers or writes.
//
// The official data "lives on the edge" and its grammar is known to be incomplete (for example the
// Fill and Stroke 3 draft's <paint> no longer lists <color>, although every browser accepts
// `fill: red`). A value the official syntax rejects can therefore also be matched against the syntax
// CSSTree bundles from MDN's browser data; the match says which syntax accepted it. CSSTree builds the
// official lexer as a fork of its MDN data, so a match that went through a property or type webref
// does not define (a property webref lists without a syntax, a type only MDN has) is a browser-syntax
// match too. manifest:check accepts browser-syntax values only where the allowlist (properties.json
// syntaxFallbacks) names them, and reports every one.
import { definitionSyntax, fork, lexer as implementedLexer, parse, walk, type CssNode, type DSNode, type Lexer } from 'css-tree';

export { implementedLexer };

export interface CssSyntaxes {
  // property name → value definition syntax
  properties: Readonly<Record<string, string | null>>;
  // type or function name (functions end with "()") → value definition syntax
  types: Readonly<Record<string, string>>;
}

export type CssMatch = { ok: true; by: 'official' | 'implemented' } | { ok: false; reason: string };

// What a matched value is made of, read from CSSTree's match tree.
export interface CssParts {
  // identifiers the syntax names as keywords, lower-cased ("x mandatory" → x, mandatory)
  keywords: string[];
  // the same keywords with the function each sits in, innermost, lower-case without "()" (from in
  // rgb(from red r g b) → rgb); null outside functions
  keywordFunctions: (string | null)[];
  // identifiers matched as custom identifiers (a font family, a counter style), lower-cased
  identifiers: string[];
  // properties the syntax references and the value sets (<'column-height'> in a columns value)
  properties: string[];
}

export type CssAnalysis = (CssMatch & { ok: true } & CssParts) | { ok: false; reason: string };

export interface CssMatcher {
  lexer: Lexer;
  // null when the value matches the property's syntax in the official lexer, the reason otherwise
  // (the generator's keyword and unit lists use it)
  match(property: string, value: string): string | null;
  // the official syntax first, then the syntax browsers implement (CSSTree's MDN data)
  matchEither(property: string, value: string): CssMatch;
  // matchEither, plus the keywords, custom identifiers and referenced properties of the matching syntax
  analyse(property: string, value: string): CssAnalysis;
}

interface MatchNode {
  syntax: DSNode | null;
  token?: string;
  node?: CssNode;
  match?: MatchNode[];
}

type Matched = { error: string } | { error: null; tree: MatchNode | null };

function matchTree(lexer: Lexer, property: string, value: string): Matched {
  let ast;
  try {
    ast = parse(value, { context: 'value' });
  } catch (error) {
    return { error: `not parseable as a CSS value: ${(error as Error).message}` };
  }
  let result;
  try {
    result = lexer.matchProperty(property, ast);
  } catch (error) {
    // the official grammar is known to be incomplete: a syntax may name a type nobody defines
    return { error: `the syntax cannot be matched: ${(error as Error).message}` };
  }
  if (result.error !== null) return { error: result.error.message.split('\n')[0] ?? 'mismatch' };
  return { error: null, tree: (result as unknown as { matched: MatchNode | null }).matched };
}

function matchWith(lexer: Lexer, property: string, value: string): string | null {
  const result = matchTree(lexer, property, value);
  return result.error;
}

// null when the syntax browsers implement (CSSTree's bundled MDN data) accepts the value
export function matchImplemented(property: string, value: string): string | null {
  return matchWith(implementedLexer, property, value);
}

// The keywords a matched value is made of (with the function each sits in), its custom identifiers, and
// the properties it went through. A function's arguments are the siblings between its Function node and
// the closing ")" in the match tree.
function partsOf(tree: MatchNode | null): CssParts & { types: string[] } {
  const parts: CssParts & { types: string[] } = { keywords: [], keywordFunctions: [], identifiers: [], properties: [], types: [] };
  const visit = (node: MatchNode, inType: boolean, root: boolean, fn: string | null) => {
    const syntax = node.syntax;
    if (syntax?.type === 'Keyword' && node.token !== undefined) {
      parts.keywords.push(node.token.toLowerCase());
      parts.keywordFunctions.push(fn);
    } else if (syntax === null && node.node?.type === 'Identifier' && inType) parts.identifiers.push(node.node.name.toLowerCase());
    if (syntax?.type === 'Property' && !root) parts.properties.push(syntax.name);
    if (syntax?.type === 'Type') parts.types.push(syntax.name);
    const inside: string[] = [];
    for (const child of node.match ?? []) {
      if (child.syntax?.type === 'Function') inside.push(child.syntax.name.toLowerCase());
      else if (child.syntax?.type === 'Token' && child.syntax.value === ')' && inside.length > 0) inside.pop();
      else visit(child, inType || syntax?.type === 'Type', false, inside[inside.length - 1] ?? fn);
    }
  };
  if (tree) visit(tree, false, true, null);
  return parts;
}

export interface SyntaxMentions {
  // every keyword the syntax names, lower-cased → each path the definition reaches it through: the types
  // and functions around it, outermost first ("rgb()" for a type function or an inline function)
  keywords: Map<string, string[][]>;
  // every function the syntax names (fit-content, element, rgb), lower-cased, without "()" → the same
  functions: Map<string, string[][]>;
}

// Every keyword and function a property's syntax names, inside functions too, with every path it is
// reached through. The generator uses it to list what css-compat.json records and to find each BCD entry.
// What a type or a referenced property contains is worked out once (per lexer) and composed into every
// path that reaches it; a type met again inside itself (<color> inside rgb(from <color>)) is not expanded
// a second time on that path.
const mentionMemo = new WeakMap<Lexer, Map<string, SyntaxMentions>>();

export function syntaxMentions(lexer: Lexer, property: string): SyntaxMentions {
  let memo = mentionMemo.get(lexer);
  if (!memo) {
    memo = new Map();
    mentionMemo.set(lexer, memo);
  }
  const cache = memo;
  const stack = new Set<string>();
  const empty = (): SyntaxMentions => ({ keywords: new Map(), functions: new Map() });
  const note = (map: Map<string, string[][]>, name: string, path: string[]) => {
    const key = name.toLowerCase();
    const paths = map.get(key) ?? [];
    const joined = path.join('>');
    if (!paths.some((p) => p.join('>') === joined)) paths.push(path);
    map.set(key, paths);
  };
  const compose = (into: SyntaxMentions, inner: SyntaxMentions, prefix: string[]) => {
    for (const [name, paths] of inner.keywords) for (const p of paths) note(into.keywords, name, [...prefix, ...p]);
    for (const [name, paths] of inner.functions) for (const p of paths) note(into.functions, name, [...prefix, ...p]);
  };
  // what a type or property contains, relative to it; null when it is already being expanded (a cycle)
  const contents = (key: string, syntax: DSNode | null | undefined): SyntaxMentions | null => {
    const known = cache.get(key);
    if (known) return known;
    if (stack.has(key)) return null;
    stack.add(key);
    const out = empty();
    collect(syntax, [], out);
    stack.delete(key);
    // a result that met a cycle is complete only for the outermost call; keep it, as it is for that entry
    cache.set(key, out);
    return out;
  };
  const collect = (node: DSNode | null | undefined, path: string[], out: SyntaxMentions): void => {
    if (!node) return;
    switch (node.type) {
      case 'Keyword':
        note(out.keywords, node.name, path);
        return;
      case 'Group': {
        // an inline function's arguments are the terms between its Function node and the closing ")"
        const inside: string[] = [];
        for (const term of node.terms) {
          if (term.type === 'Function') {
            note(out.functions, term.name, [...path, ...inside]);
            inside.push(`${term.name.toLowerCase()}()`);
          } else if (term.type === 'Token' && term.value === ')' && inside.length > 0) {
            inside.pop();
          } else {
            collect(term, [...path, ...inside], out);
          }
        }
        return;
      }
      case 'Multiplier':
      case 'Boolean':
        collect(node.term, path, out);
        return;
      case 'Type': {
        if (node.name.endsWith('()')) note(out.functions, node.name.slice(0, -2), path);
        const inner = contents(`type:${node.name}`, lexer.getType(node.name)?.syntax);
        if (inner) compose(out, inner, [...path, node.name.toLowerCase()]);
        return;
      }
      case 'Property': {
        const inner = contents(`property:${node.name}`, lexer.getProperty(node.name)?.syntax);
        if (inner) compose(out, inner, path);
        return;
      }
      default:
        return;
    }
  };
  const found = empty();
  collect(lexer.getProperty(property)?.syntax, [], found);
  return found;
}

// The shape of a value, for the functions, units and syntax forms BCD tracks separately (two-value
// syntax, multiple layers, negative values): its functions, its units (lower-case, "%" for a
// percentage), its comma-separated layers, the most space-separated components a layer has (outside
// functions), and whether a component is a negative number.
export interface ValueShape {
  functions: string[];
  units: string[];
  layers: number;
  components: number;
  negative: boolean;
}

export function valueShape(value: string): ValueShape {
  const shape: ValueShape = { functions: [], units: [], layers: 1, components: 0, negative: false };
  let ast;
  try {
    ast = parse(value, { context: 'value' });
  } catch {
    return shape;
  }
  walk(ast, (node) => {
    if (node.type === 'Function') shape.functions.push(node.name.toLowerCase());
    if (node.type === 'Dimension' && !shape.units.includes(node.unit.toLowerCase())) shape.units.push(node.unit.toLowerCase());
    if (node.type === 'Percentage' && !shape.units.includes('%')) shape.units.push('%');
  });
  if (ast.type !== 'Value') return shape;
  let count = 0;
  ast.children.forEach((node) => {
    if (node.type === 'Operator' && node.value === ',') {
      shape.layers += 1;
      shape.components = Math.max(shape.components, count);
      count = 0;
      return;
    }
    count += 1;
    if ((node.type === 'Number' || node.type === 'Dimension' || node.type === 'Percentage') && node.value.startsWith('-')) shape.negative = true;
  });
  shape.components = Math.max(shape.components, count);
  return shape;
}

// CSSTree's parser turns url(…) into a url token that only CSSTree's own <url> definition matches; webref's
// <url> (<url()> | <src()>) never matches it. The official lexer keeps CSSTree's definition of <url> and
// adds webref's <src()> to it, so url("a.png") is matched by the official syntax.
function withBuiltInUrl(types: Readonly<Record<string, string>>): Record<string, string> {
  const out = { ...types };
  const builtIn = implementedLexer.getType('url')?.syntax;
  if (out.url !== undefined && builtIn) out.url = `${definitionSyntax.generate(builtIn)}${types['src()'] !== undefined ? ' | <src()>' : ''}`;
  return out;
}

export function createCssMatcher(syntaxes: CssSyntaxes): CssMatcher {
  const properties: Record<string, string> = {};
  for (const [name, syntax] of Object.entries(syntaxes.properties)) if (syntax !== null) properties[name] = syntax;
  const lexer = fork({ properties, types: withBuiltInUrl(syntaxes.types) }).lexer;
  const officialTypes = new Set(Object.keys(syntaxes.types));
  // a type CSSTree matches in code (length, integer, custom-ident...) has no syntax of its own
  const generic = (name: string) => (lexer.getType(name)?.syntax ?? null) === null;
  const match = (property: string, value: string) => matchWith(lexer, property, value);
  const analyse = (property: string, value: string): CssAnalysis => {
    const official = matchTree(lexer, property, value);
    if (official.error === null) {
      const parts = partsOf(official.tree);
      // the fork answers from MDN data where webref has no definition: that is the browser syntax
      const mdnOnly = !(property in properties) || parts.properties.some((p) => !(p in properties)) || parts.types.some((t) => !officialTypes.has(t) && !generic(t));
      return { ok: true, by: mdnOnly ? 'implemented' : 'official', keywords: parts.keywords, keywordFunctions: parts.keywordFunctions, identifiers: parts.identifiers, properties: parts.properties };
    }
    const implemented = matchTree(implementedLexer, property, value);
    if (implemented.error === null) {
      const parts = partsOf(implemented.tree);
      return { ok: true, by: 'implemented', keywords: parts.keywords, keywordFunctions: parts.keywordFunctions, identifiers: parts.identifiers, properties: parts.properties };
    }
    return { ok: false, reason: official.error };
  };
  const matchEither = (property: string, value: string): CssMatch => {
    const result = analyse(property, value);
    return result.ok ? { ok: true, by: result.by } : result;
  };
  return { lexer, match, matchEither, analyse };
}

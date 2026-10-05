// Selector matching for the import (INVENTORY.md, owners; the manifest's html-import-styles and
// html-import-states): the one owner of "which elements a CSS selector matches" and of a selector's specificity. The
// importer resolves each stylesheet rule onto the nodes it built, so a declaration lands on the element it belongs to;
// nothing else in the editor matches selectors on the document (style.applyCssRule writes the rule of the one selected
// element). The canvas is a browser page: what matches an element drawn there the browser says (element.matches), and
// the specificity that ranks those rules is this module's (specificityOf, for any selector; canvas/coordinates.ts).
//
// What it reads: a compound selector of a type (or `*`), classes, an id and attribute tests ([attr], [attr=v],
// [attr~=v], [attr^=v], [attr$=v], [attr*=v]), joined by the descendant and the child combinators; a trailing
// pseudo-class is left to the caller (the state a rule belongs to: properties.json's states), and every other
// pseudo-class, a pseudo-element or a sibling combinator is not read — the caller reports such a rule instead of
// mapping it. Specificity counts (ids, classes and attributes, types), as CSS counts it.
export interface Facts {
  readonly tag: string | null;
  readonly classes: readonly string[];
  readonly id: string | null;
  readonly attributes: ReadonlyMap<string, string>;
}

interface AttributeTest {
  readonly name: string;
  readonly op: 'exists' | '=' | '~=' | '^=' | '$=' | '*=';
  readonly value: string;
}

export interface Compound {
  readonly tag: string | null;
  readonly universal: boolean;
  readonly classes: readonly string[];
  readonly id: string | null;
  readonly attributes: readonly AttributeTest[];
  // the pseudo-class the compound ends with (`hover` for `:hover`), which the caller reads as a state; null for none
  readonly pseudo: string | null;
}

export interface Selector {
  // the compound selectors, in the written order (the leftmost names the ancestor)
  readonly compounds: readonly Compound[];
  // the combinators between them, `compounds.length - 1` of them: ' ' (a descendant) or '>' (a child)
  readonly combinators: readonly (' ' | '>')[];
  readonly specificity: readonly [number, number, number];
}

// A type, universal, class, id, attribute or pseudo-class piece of a compound selector.
const TYPE = /^[a-z][a-z0-9-]*/i;
const CLASS = /^\.(-?[_a-z][\w-]*)/i;
const ID = /^#(-?[_a-z][\w-]*)/i;
const PSEUDO = /^::?([\w-]+)(\(([^)]*)\))?/;
const ATTRIBUTE = /^\[\s*([\w-]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/;

// The pieces of one compound selector, or null when a piece is one this module does not read.
function readCompound(text: string): Compound | null {
  let rest = text;
  let tag: string | null = null;
  let universal = false;
  const classes: string[] = [];
  let id: string | null = null;
  const attributes: AttributeTest[] = [];
  let pseudo: string | null = null;
  while (rest !== '') {
    if (pseudo !== null) return null; // nothing follows a pseudo-class (an unsupported chain: :hover:focus)
    const attribute = ATTRIBUTE.exec(rest);
    if (attribute !== null) {
      const [, name = '', op, dq, sq, bare] = attribute;
      const value = dq ?? sq ?? bare ?? '';
      attributes.push({ name: name.toLowerCase(), op: op === undefined ? 'exists' : (op as AttributeTest['op']), value });
      rest = rest.slice(attribute[0].length);
      continue;
    }
    const pseudoMatch = PSEUDO.exec(rest);
    if (pseudoMatch !== null) {
      const [, name = '', args] = pseudoMatch;
      // a pseudo-element, or a pseudo-class that takes arguments (:not, :nth-child): not read here
      if (rest.startsWith('::') || args !== undefined) return null;
      pseudo = name.toLowerCase();
      rest = rest.slice(pseudoMatch[0].length);
      continue;
    }
    const cls = CLASS.exec(rest);
    if (cls !== null) {
      classes.push(cls[1] as string);
      rest = rest.slice(cls[0].length);
      continue;
    }
    const ident = ID.exec(rest);
    if (ident !== null) {
      id = ident[1] as string;
      rest = rest.slice(ident[0].length);
      continue;
    }
    if (rest.startsWith('*')) {
      universal = true;
      rest = rest.slice(1);
      continue;
    }
    const type = TYPE.exec(rest);
    if (type !== null && tag === null && classes.length === 0 && id === null && attributes.length === 0) {
      tag = type[0].toLowerCase();
      rest = rest.slice(type[0].length);
      continue;
    }
    return null;
  }
  return { tag, universal, classes, id, attributes, pseudo };
}

// A selector read into its compounds and combinators, or null when it holds a piece this module does not read (a
// pseudo-element, :not(), a sibling combinator, an escape): the caller reports such a rule as not mapped.
export function readSelector(text: string): Selector | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // split on the combinators, outside brackets: a whitespace or a ">" outside a compound closes the one before it
  const compounds: Compound[] = [];
  const combinators: (' ' | '>')[] = [];
  let current = '';
  let depth = 0;
  let pending: ' ' | '>' | null = null;
  let failed = false;
  const commit = (): void => {
    if (current === '') return;
    const compound = readCompound(current);
    if (compound === null) {
      failed = true;
      return;
    }
    if (compounds.length > 0) combinators.push(pending ?? ' ');
    compounds.push(compound);
    current = '';
    pending = null;
  };
  for (let at = 0; at < trimmed.length; at += 1) {
    const char = trimmed[at] as string;
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;
    if (depth > 0) {
      current += char;
      continue;
    }
    if (char === '>') {
      if (current !== '') commit();
      pending = '>';
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== '') commit();
      pending ??= ' ';
      continue;
    }
    if (char === '+' || char === '~' || char === ',') return null;
    current += char;
  }
  commit();
  if (failed || compounds.length === 0 || current !== '' || pending === '>') return null;
  const ids = compounds.filter((c) => c.id !== null).length;
  const others = compounds.reduce((n, c) => n + c.classes.length + c.attributes.length + (c.pseudo === null ? 0 : 1), 0);
  const types = compounds.filter((c) => c.tag !== null).length;
  return { compounds, combinators, specificity: [ids, others, types] };
}

const attributeHolds = (facts: Facts, test: AttributeTest): boolean => {
  const value = test.name === 'id' ? facts.id : test.name === 'class' ? facts.classes.join(' ') : facts.attributes.get(test.name) ?? null;
  if (value === null || value === undefined) return false;
  switch (test.op) {
    case 'exists':
      return true;
    case '=':
      return value === test.value;
    case '~=':
      return value.split(/\s+/).includes(test.value);
    case '^=':
      return test.value !== '' && value.startsWith(test.value);
    case '$=':
      return test.value !== '' && value.endsWith(test.value);
    case '*=':
      return test.value !== '' && value.includes(test.value);
  }
};

// whether one compound selector holds for these facts
function compoundHolds(compound: Compound, facts: Facts): boolean {
  if (compound.tag !== null && facts.tag !== compound.tag) return false;
  if (compound.id !== null && facts.id !== compound.id) return false;
  for (const className of compound.classes) if (!facts.classes.includes(className)) return false;
  for (const test of compound.attributes) if (!attributeHolds(facts, test)) return false;
  return true;
}

// Whether the subject, at the place its ancestors name (nearest first), matches the selector. The caller reports a
// rule whose selector ends in a pseudo-class (a state) separately, matching only what stands before it.
export function matches(selector: Selector, subject: Facts, ancestors: readonly Facts[]): boolean {
  const last = selector.compounds.length - 1;
  if (last < 0 || !compoundHolds(selector.compounds[last] as Compound, subject)) return false;
  const holds = (at: number, above: number): boolean => {
    if (at < 0) return true;
    const compound = selector.compounds[at] as Compound;
    const combinator = selector.combinators[at] as ' ' | '>';
    if (combinator === '>') {
      const parent = ancestors[above];
      return parent !== undefined && compoundHolds(compound, parent) && holds(at - 1, above + 1);
    }
    for (let from = above; from < ancestors.length; from += 1) {
      if (compoundHolds(compound, ancestors[from] as Facts) && holds(at - 1, from + 1)) return true;
    }
    return false;
  };
  return holds(last - 1, 0);
}

export type Specificity = readonly [number, number, number];

// A selector list split at its own commas (never at one inside brackets, parentheses or a string).
export function splitSelectorList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] as string;
    if (quote !== null) {
      if (char === '\\') {
        current += char + (text[at + 1] ?? '');
        at += 1;
        continue;
      }
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

const higher = (a: Specificity, b: Specificity): Specificity => (compareSpecificity(a, b) >= 0 ? a : b);
// the most specific of a selector list's selectors
const mostSpecific = (list: string): Specificity => splitSelectorList(list).map(specificityOf).reduce(higher, [0, 0, 0]);

// How two specificities rank: positive when the first wins.
export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// the pseudo-elements CSS 2 wrote with one colon
const LEGACY_ELEMENTS: ReadonlySet<string> = new Set(['before', 'after', 'first-line', 'first-letter']);
// the pseudo-classes that count their most specific argument
const BY_ARGUMENT: ReadonlySet<string> = new Set(['is', 'not', 'has', 'matches', '-webkit-any']);
const IDENT = /^(?:\\.|[\w-]|\P{ASCII})+/u;

// The specificity of any complex selector, as CSS counts it (Selectors 4, "Calculating a selector's specificity"):
// ids; classes, attributes and pseudo-classes; types and pseudo-elements. :where() counts nothing; :is(), :not() and
// :has() count their most specific argument; :nth-child() and :nth-last-child() count one pseudo-class and the most
// specific selector of their "of S". readSelector's own count is the same on the selectors it reads; this one counts
// every selector, for the canvas, which asks the browser which rules match an element (canvas/coordinates.ts).
export function specificityOf(selector: string): Specificity {
  let ids = 0;
  let others = 0;
  let types = 0;
  const add = (more: Specificity): void => {
    ids += more[0];
    others += more[1];
    types += more[2];
  };
  let at = 0;
  // the text inside the parentheses that open at `from`, and the index after them
  const argument = (from: number): { readonly text: string; readonly end: number } => {
    let depth = 0;
    for (let end = from; end < selector.length; end += 1) {
      if (selector[end] === '(') depth += 1;
      if (selector[end] === ')') depth -= 1;
      if (depth === 0) return { text: selector.slice(from + 1, end), end: end + 1 };
    }
    return { text: selector.slice(from + 1), end: selector.length };
  };
  const ident = (from: number): { readonly text: string; readonly end: number } => {
    const found = IDENT.exec(selector.slice(from));
    const text = found === null ? '' : found[0];
    return { text, end: from + text.length };
  };
  while (at < selector.length) {
    const char = selector[at] as string;
    if (char === '[') {
      others += 1;
      const close = selector.indexOf(']', at);
      at = close < 0 ? selector.length : close + 1;
    } else if (char === '#') {
      ids += 1;
      at = ident(at + 1).end;
    } else if (char === '.') {
      others += 1;
      at = ident(at + 1).end;
    } else if (char === ':') {
      const element = selector[at + 1] === ':';
      const name = ident(at + (element ? 2 : 1));
      const lowered = name.text.toLowerCase();
      at = name.end;
      const args = selector[at] === '(' ? argument(at) : null;
      if (args !== null) at = args.end;
      if (element || LEGACY_ELEMENTS.has(lowered)) types += 1;
      else if (lowered === 'where') continue;
      else if (BY_ARGUMENT.has(lowered)) add(mostSpecific(args?.text ?? ''));
      else {
        others += 1;
        const of = (lowered === 'nth-child' || lowered === 'nth-last-child') && args !== null ? /\sof\s/iu.exec(args.text) : null;
        if (of !== null && args !== null) add(mostSpecific(args.text.slice(of.index + of[0].length)));
      }
    } else if (char === '*' || char === '|' || char === '&') {
      at += 1;
    } else if (IDENT.test(selector.slice(at, at + 1)) || char === '\\') {
      types += 1;
      at = ident(at).end;
    } else {
      at += 1;
    }
  }
  return [ids, others, types];
}

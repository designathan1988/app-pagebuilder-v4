// Codecs (PRODUCT.md §5): the one reader and writer of a property's values. Each property of properties.json names
// its codec; a codec reads the text a person typed into a value of its kind and writes that value back as the CSS text
// the document stores. Pure: what a property offers (its units, its keywords) comes from the generated lists
// (src/generated/value-lists.ts) and whether the browser takes the result is the CSS support port's answer, both asked
// by the caller (src/core/style/set.ts). A codec is registered under the id properties.json gives it (manifest:check
// reads `registerCodec('<id>'`); a property whose codec is not registered yet has no value a door can write.
//
// length-percentage (spec inspector-number-fields, "Accepted text"): a number with a unit the property offers, or a
// bare number, which takes the field's unit; one of the property's keywords; calc(), min(), max() or clamp(), kept as
// typed; arithmetic on plain numbers (+ - * / and parentheses), worked out and given the field's unit ("64/2" is 32).
// keyword (spec props-size-overflow): one of the property's keywords, in any case.
// ratio: a width, optionally "/" and a height ("16 / 9", "16/9", "1.5"), positive numbers, written "16 / 9"; or one of
// the property's keywords (auto).
// axis-pair (a composite of two longhands, overflow): one keyword for both axes, or two, the first for x and the second
// for y; each one of the keywords the longhands offer.
// font-family-list: one family or several, comma-separated, each a name or a quoted name, written joined by ", ".
// font-weight: a number from 1 to 1000, or one of the property's keywords (bold…).
// font-style: one of the property's keywords, or "oblique" with an angle ("oblique 10deg").
// line-height: a bare number stays a multiplier ("1.5"); a length or a percentage; one of the property's keywords.
// keyword-set: one or more of the property's keywords, each once (text-transform: "capitalize full-width").
// text-indent and vertical-align: as length-percentage (a bare number takes the field's unit), or a keyword.
// text-decoration (the composite of line, thickness, style and color, CSS Text Decoration 3 "text-decoration"): the
// line keywords (one or more), a style keyword, a thickness (auto, from-font or a length) and a color, in any order;
// what is left out takes its initial value (none, auto, solid, currentcolor). Written in the longhands' order.
// white-space (the composite of white-space-collapse and text-wrap-mode, CSS Text 4 "white-space"): one of its
// keywords, each standing for a pair of longhand values (nowrap: collapse and nowrap).
import type { CodecId } from '../../generated/ids.ts';
import { readAddress } from '../elements/address.ts';

export type Value =
  | { readonly kind: 'length'; readonly number: number; readonly unit: string }
  | { readonly kind: 'keyword'; readonly keyword: string }
  | { readonly kind: 'expression'; readonly text: string }
  | { readonly kind: 'ratio'; readonly width: number; readonly height: number | null }
  | { readonly kind: 'pair'; readonly first: string; readonly second: string }
  // a composite's longhand values, in its longhands' order, and the text it was written as
  | { readonly kind: 'longhands'; readonly values: readonly string[]; readonly text: string };

// What a value is read against: the units and keywords the property offers, and the unit a bare number takes
export interface ValueFacts {
  readonly units: readonly string[];
  readonly keywords: readonly string[];
  readonly defaultUnit: string;
  // a composite's axes: the keywords of each of its longhands, in its longhands' order (properties.json, the subset
  // `keywords` of each longhand); absent for a property, or a composite whose longhands name none
  readonly axes?: readonly (readonly string[])[];
}

export interface Codec {
  readonly id: CodecId;
  // the value the text stands for, or null when it stands for none this codec reads
  read(text: string, facts: ValueFacts): Value | null;
  // the CSS text of a value
  write(value: Value): string;
  // a composite's: the shorthand text of the longhand values it stores, in its longhands' order, as a person writes it
  // (a border as "2px solid #00aa00", never its twelve longhands); null when they are no one shorthand value
  compose?(values: readonly string[]): string | null;
}

function registerCodec(id: CodecId, codec: Omit<Codec, 'id'>): Codec {
  return Object.freeze({ id, read: codec.read, write: codec.write, ...(codec.compose ? { compose: codec.compose } : {}) });
}

// The unit a bare number takes in a field that holds no length yet (Pager's number fields: px).
export const DEFAULT_UNIT = 'px';

// A number as a value writes it: at most four decimals, never "-0".
export function writeNumber(n: number): string {
  const rounded = Math.round(n * 10_000) / 10_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

const NUMBER_WITH_UNIT = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-z%]*)$/i;
const ARITHMETIC = /^[\d.\s+\-*/()]+$/;
const EXPRESSION = /^(calc|min|max|clamp)\(.*\)$/i;

// Arithmetic on plain numbers, worked out by a small recursive descent over + - * / and parentheses; null when the
// text is not such a sum or its result is not a finite number. No text is ever evaluated as code.
export function workOut(text: string): number | null {
  const tokens = text.match(/\d+(?:\.\d*)?|\.\d+|[+\-*/()]/g) ?? [];
  if (tokens.join('') !== text.replace(/\s+/g, '')) return null;
  let at = 0;
  const peek = () => tokens[at];
  const factor = (): number | null => {
    const token = tokens[at++];
    if (token === '+' || token === '-') {
      const inner = factor();
      return inner === null ? null : token === '-' ? -inner : inner;
    }
    if (token === '(') {
      const inner = sum();
      return tokens[at++] === ')' ? inner : null;
    }
    return token !== undefined && /^[\d.]/.test(token) ? Number(token) : null;
  };
  const product = (): number | null => {
    let left = factor();
    while (left !== null && (peek() === '*' || peek() === '/')) {
      const op = tokens[at++];
      const right = factor();
      left = right === null ? null : op === '*' ? left * right : left / right;
    }
    return left;
  };
  const sum = (): number | null => {
    let left = product();
    while (left !== null && (peek() === '+' || peek() === '-')) {
      const op = tokens[at++];
      const right = product();
      left = right === null ? null : op === '+' ? left + right : left - right;
    }
    return left;
  };
  const result = sum();
  return result !== null && at === tokens.length && Number.isFinite(result) ? result : null;
}

// Arithmetic on lengths (the plan's stage 3, "contas"): numbers with the units the property offers, + - * / and
// parentheses. One unit throughout (a plain number beside it takes it) is worked out: "16px*2" is 32px, "10px + 4" is
// 14px. Lengths of different units added or taken away are the browser's to work out: written as calc(), spaced as
// CSS writes it ("100% - 20px" is calc(100% - 20px)). Two lengths multiplied, a division by a length or by zero, or
// a unit the property does not offer: null.
const LENGTH_TERM = /(\d+(?:\.\d*)?|\.\d+)([a-z%]*)|[+\-*/()]/gi;
export function workOutLengths(text: string, units: readonly string[]): Value | null {
  const tokens = [...text.matchAll(LENGTH_TERM)].map((m) => ({ text: m[0], number: m[1] === undefined ? null : Number(m[1]), unit: (m[2] ?? '').toLowerCase() || null }));
  if (tokens.map((t) => t.text).join('') !== text.replace(/\s+/g, '')) return null;
  if (tokens.some((t) => t.unit !== null && !units.includes(t.unit))) return null;
  type Quantity = { readonly n: number; readonly unit: string | null } | 'mixed';
  let at = 0;
  const peek = () => tokens[at]?.text;
  const factor = (): Quantity | null => {
    const token = tokens[at++];
    if (token === undefined) return null;
    if (token.text === '+' || token.text === '-') {
      const inner = factor();
      return inner === null || inner === 'mixed' ? inner : { n: token.text === '-' ? -inner.n : inner.n, unit: inner.unit };
    }
    if (token.text === '(') {
      const inner = sum();
      return tokens[at++]?.text === ')' ? inner : null;
    }
    return token.number === null ? null : { n: token.number, unit: token.unit };
  };
  const product = (): Quantity | null => {
    let left = factor();
    while (left !== null && (peek() === '*' || peek() === '/')) {
      const op = tokens[at++]?.text;
      const right = factor();
      if (right === null) return null;
      if (left === 'mixed' || right === 'mixed') {
        if (right !== 'mixed' && right.unit !== null) return null;
        left = 'mixed';
        continue;
      }
      if (op === '*') {
        if (left.unit !== null && right.unit !== null) return null;
        left = { n: left.n * right.n, unit: left.unit ?? right.unit };
      } else {
        if (right.unit !== null || right.n === 0) return null;
        left = { n: left.n / right.n, unit: left.unit };
      }
    }
    return left;
  };
  const sum = (): Quantity | null => {
    let left = product();
    while (left !== null && (peek() === '+' || peek() === '-')) {
      const op = tokens[at++]?.text;
      const right = product();
      if (right === null) return null;
      if (left === 'mixed' || right === 'mixed' || (left.unit !== null && right.unit !== null && left.unit !== right.unit)) {
        left = 'mixed';
        continue;
      }
      left = { n: op === '+' ? left.n + right.n : left.n - right.n, unit: left.unit ?? right.unit };
    }
    return left;
  };
  const result = sum();
  if (result === null || at !== tokens.length) return null;
  if (result === 'mixed') {
    const spaced = tokens
      .map((t, i) => (/^[+-]$/.test(t.text) && i > 0 && !/^[(+\-*/]$/.test(tokens[i - 1]?.text ?? '') ? ` ${t.text} ` : /^[*/]$/.test(t.text) ? ` ${t.text} ` : t.text))
      .join('');
    return { kind: 'expression', text: `calc(${spaced})` };
  }
  return result.unit === null || !Number.isFinite(result.n) ? null : { kind: 'length', number: result.n, unit: result.unit };
}

// Parentheses that open and close in order.
function balanced(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export const lengthPercentage = registerCodec('length-percentage', {
  read(text, facts) {
    const typed = text.trim();
    if (typed === '') return null;
    const lower = typed.toLowerCase();
    if (facts.keywords.includes(lower)) return { kind: 'keyword', keyword: lower };
    const plain = NUMBER_WITH_UNIT.exec(typed);
    if (plain !== null) {
      const unit = (plain[2] ?? '').toLowerCase() || facts.defaultUnit;
      return facts.units.includes(unit) ? { kind: 'length', number: Number(plain[1]), unit } : null;
    }
    if (ARITHMETIC.test(typed)) {
      const worked = workOut(typed);
      return worked === null ? null : { kind: 'length', number: worked, unit: facts.defaultUnit };
    }
    if (EXPRESSION.test(typed) && balanced(typed)) return { kind: 'expression', text: typed };
    return workOutLengths(typed, facts.units);
  },
  write(value) {
    if (value.kind === 'length') return `${writeNumber(value.number)}${value.unit}`;
    if (value.kind === 'keyword') return value.keyword;
    return value.kind === 'expression' ? value.text : '';
  },
});

const keyword = registerCodec('keyword', {
  read(text, facts) {
    const typed = text.trim().toLowerCase();
    return facts.keywords.includes(typed) ? { kind: 'keyword', keyword: typed } : null;
  },
  write(value) {
    return value.kind === 'keyword' ? value.keyword : '';
  },
});

const RATIO = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:\/\s*(\d+(?:\.\d+)?|\.\d+))?$/;
const ratio = registerCodec('ratio', {
  read(text, facts) {
    const typed = text.trim().toLowerCase();
    if (facts.keywords.includes(typed)) return { kind: 'keyword', keyword: typed };
    const parts = RATIO.exec(typed);
    if (parts === null) return null;
    const width = Number(parts[1]);
    const height = parts[2] === undefined ? null : Number(parts[2]);
    return width > 0 && (height === null || height > 0) ? { kind: 'ratio', width, height } : null;
  },
  write(value) {
    if (value.kind === 'ratio') return value.height === null ? writeNumber(value.width) : `${writeNumber(value.width)} / ${writeNumber(value.height)}`;
    return value.kind === 'keyword' ? value.keyword : '';
  },
});

const axisPair = registerCodec('axis-pair', {
  read(text, facts) {
    // each word a keyword the composite offers, or a length or percentage in one of its units (a bare number in the
    // field's unit: gap 8 is 8px)
    const words = text
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== '')
      .map((w) => (facts.keywords.includes(w) ? w : (lengthText(w, facts.units) ?? (facts.units.length > 0 && /^\d+(?:\.\d+)?$/.test(w) ? `${writeNumber(Number(w))}${facts.defaultUnit}` : null))));
    const [first, second] = words;
    if (first === undefined || first === null || second === null || words.length > 2) return null;
    return { kind: 'pair', first, second: second ?? first };
  },
  write(value) {
    if (value.kind !== 'pair') return '';
    return value.first === value.second ? value.first : `${value.first} ${value.second}`;
  },
});

const FAMILY = /^(?:"[^"]+"|'[^']+'|[A-Za-z_][\w -]*)$/;
const fontFamilyList = registerCodec('font-family-list', {
  read(text) {
    const families = text.split(',').map((f) => f.trim());
    if (families.length === 0 || families.some((f) => f === '' || !FAMILY.test(f))) return null;
    return { kind: 'expression', text: families.join(', ') };
  },
  write(value) {
    return value.kind === 'expression' ? value.text : '';
  },
});

const fontWeight = registerCodec('font-weight', {
  read(text, facts) {
    const typed = text.trim().toLowerCase();
    if (facts.keywords.includes(typed)) return { kind: 'keyword', keyword: typed };
    const weight = Number(typed);
    return typed !== '' && Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? { kind: 'expression', text: writeNumber(weight) } : null;
  },
  write(value) {
    return value.kind === 'keyword' ? value.keyword : value.kind === 'expression' ? value.text : '';
  },
});

const OBLIQUE = /^oblique\s+(-?\d+(?:\.\d+)?)(deg|grad|rad|turn)$/;
const fontStyle = registerCodec('font-style', {
  read(text, facts) {
    const typed = text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (facts.keywords.includes(typed)) return { kind: 'keyword', keyword: typed };
    return OBLIQUE.test(typed) ? { kind: 'expression', text: typed } : null;
  },
  write(value) {
    return value.kind === 'keyword' ? value.keyword : value.kind === 'expression' ? value.text : '';
  },
});

const lineHeight = registerCodec('line-height', {
  read(text, facts) {
    const typed = text.trim();
    // a bare number is a multiplier of the font size, never a length
    if (/^\d+(?:\.\d+)?$|^\.\d+$/.test(typed)) return { kind: 'expression', text: writeNumber(Number(typed)) };
    return lengthPercentage.read(typed, facts);
  },
  write(value) {
    return value.kind === 'expression' ? value.text : lengthPercentage.write(value);
  },
});

// Several keywords, each once (text-decoration-line: underline overline; scroll-snap-type: x mandatory). A word the
// generated list names, or one that only goes with another (mandatory, which is no value alone, so the list, made of
// the values each keyword is alone, leaves it out): any keyword, the CSS support port then deciding whether the
// browser takes the whole.
const keywordSet = registerCodec('keyword-set', {
  read(text, facts) {
    const words = text.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
    if (words.length === 0 || new Set(words).size !== words.length || !words.every((w) => facts.keywords.includes(w) || (words.length > 1 && /^[a-z][a-z-]*$/.test(w)))) return null;
    return { kind: 'expression', text: words.join(' ') };
  },
  write(value) {
    return value.kind === 'expression' ? value.text : '';
  },
});

const textIndent = registerCodec('text-indent', { read: (text, facts) => lengthPercentage.read(text, facts), write: (value) => lengthPercentage.write(value) });
const verticalAlign = registerCodec('vertical-align', { read: (text, facts) => lengthPercentage.read(text, facts), write: (value) => lengthPercentage.write(value) });

// the line, style and thickness keywords of text-decoration (CSS Text Decoration 3/4), and the initial values
const DECORATION_LINES = ['none', 'underline', 'overline', 'line-through', 'spelling-error', 'grammar-error'];
const DECORATION_STYLES = ['solid', 'double', 'dotted', 'dashed', 'wavy'];
const DECORATION_THICKNESS = ['auto', 'from-font'];
const DECORATION_INITIAL = { line: 'none', thickness: 'auto', style: 'solid', color: 'currentcolor' };
const textDecoration = registerCodec('text-decoration', {
  read(text) {
    const words = text.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
    if (words.length === 0) return null;
    const lines: string[] = [];
    let style: string | null = null;
    let thickness: string | null = null;
    let color: string | null = null;
    for (const word of words) {
      if (DECORATION_LINES.includes(word)) lines.push(word);
      else if (DECORATION_STYLES.includes(word) && style === null) style = word;
      else if ((DECORATION_THICKNESS.includes(word) || NUMBER_WITH_UNIT.test(word)) && thickness === null) thickness = word;
      else if (color === null) color = word;
      else return null;
    }
    if (lines.includes('none') && lines.length > 1) return null;
    const values = [lines.length > 0 ? lines.join(' ') : DECORATION_INITIAL.line, thickness ?? DECORATION_INITIAL.thickness, style ?? DECORATION_INITIAL.style, color ?? DECORATION_INITIAL.color];
    return { kind: 'longhands', values, text: words.join(' ') };
  },
  write(value) {
    return value.kind === 'longhands' ? value.text : '';
  },
});

// each white-space keyword as its white-space-collapse and text-wrap-mode (CSS Text 4, "white-space")
const WHITE_SPACE: Readonly<Record<string, readonly [string, string]>> = {
  normal: ['collapse', 'wrap'],
  nowrap: ['collapse', 'nowrap'],
  pre: ['preserve', 'nowrap'],
  'pre-wrap': ['preserve', 'wrap'],
  'pre-line': ['preserve-breaks', 'wrap'],
  'break-spaces': ['break-spaces', 'wrap'],
};
const whiteSpace = registerCodec('white-space', {
  read(text) {
    const typed = text.trim().toLowerCase();
    const pair = WHITE_SPACE[typed];
    return pair === undefined ? null : { kind: 'longhands', values: pair, text: typed };
  },
  write(value) {
    return value.kind === 'longhands' ? value.text : '';
  },
});

// color: any text the browser takes as a colour (the CSS support port decides), kept as typed; one of the property's
// keywords (currentcolor, transparent) in lower case.
const color = registerCodec('color', {
  read(text, facts) {
    const typed = text.trim();
    if (typed === '') return null;
    const lower = typed.toLowerCase();
    return facts.keywords.includes(lower) ? { kind: 'keyword', keyword: lower } : { kind: 'expression', text: typed };
  },
  write(value) {
    return value.kind === 'keyword' ? value.keyword : value.kind === 'expression' ? value.text : '';
  },
});

// paint (SVG's fill and stroke, spec elements-svg-shapes): one of the property's keywords (none) in lower case, or any
// text the browser takes as a paint (a colour), kept as typed: read and written as a colour is.
const paint = registerCodec('paint', { read: (text, facts) => color.read(text, facts), write: (value) => color.write(value) });

// A length or a percentage in one of the units the property offers (a bare 0 too), as written; null for anything else.
function lengthText(word: string, units: readonly string[]): string | null {
  const plain = NUMBER_WITH_UNIT.exec(word);
  if (plain === null) return null;
  const unit = (plain[2] ?? '').toLowerCase();
  if (unit === '') return Number(plain[1]) === 0 ? '0' : null;
  return units.includes(unit) ? `${writeNumber(Number(plain[1]))}${unit}` : null;
}

// A position (CSS Backgrounds 3, <bg-position> of one or two values), as its two axes (spec props-background,
// Problems in Pager 4): one keyword names its own axis and centres the other (top: x center, y top); two words may
// come in either order (top left: x left, y top); a length or a percentage is x first. Written x then y.
// The keywords of each axis are the composite's facts (properties.json); the one both axes share is the centre.
const position = registerCodec('position', {
  read(text, facts) {
    const words = text.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
    // a position of a property of its own (transform-origin, object-position) has no axes to tell its words by: the
    // browser checks it whole
    if (facts.axes === undefined) return cssText(text, facts);
    const [xs = [], ys = []] = facts.axes;
    const CENTRE = xs.find((k) => ys.includes(k)) ?? '';
    const X_SIDES = xs.filter((k) => k !== CENTRE);
    const Y_SIDES = ys.filter((k) => k !== CENTRE);
    if (words.length === 0 || words.length > 2) return null;
    const axis = (word: string, sides: readonly string[]): string | null => (word === CENTRE || sides.includes(word) ? word : lengthText(word, facts.units));
    const [a = '', b] = words;
    const flipped = b === undefined ? Y_SIDES.includes(a) : Y_SIDES.includes(a) || X_SIDES.includes(b);
    const [x, y] = b === undefined ? (flipped ? [CENTRE, a] : [a, CENTRE]) : flipped ? [b, a] : [a, b];
    const first = axis(x, X_SIDES);
    const second = axis(y, Y_SIDES);
    return first === null || second === null ? null : { kind: 'pair', first, second };
  },
  write(value) {
    return value.kind === 'pair' ? `${value.first} ${value.second}` : writeCssText(value);
  },
});

// A background size (CSS Backgrounds 3, <bg-size>): cover or contain, or one or two of auto, a length or a percentage.
const backgroundSize = registerCodec('background-size', {
  read(text, facts) {
    const words = text.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
    const [only] = words;
    if (words.length === 1 && only !== undefined && only !== 'auto' && facts.keywords.includes(only)) return { kind: 'keyword', keyword: only };
    if (words.length === 0 || words.length > 2) return null;
    const sizes = words.map((w) => (w === 'auto' ? w : lengthText(w, facts.units)));
    return sizes.every((s) => s !== null) ? { kind: 'expression', text: sizes.join(' ') } : null;
  },
  write(value) {
    return value.kind === 'keyword' ? value.keyword : value.kind === 'expression' ? value.text : '';
  },
});

// A background image typed as text (spec props-background, Problems in Pager 1 and 2): none, or one image address,
// typed bare or inside url(); written url("…"). The address is one a resource of the page may have
// (core/elements/address.ts readAddress); gradients and several layers arrive with the gradient editor.
// what url( ) holds, up to its last parenthesis, its quotes taken off (an address may hold parentheses of its own:
// url(javascript:alert(1)) names javascript:alert(1), which is then refused by its scheme)
const URL_CALL = /^url\(\s*(.*?)\s*\)$/is;
const QUOTED = /^(?:"([^"]*)"|'([^']*)')$/;
export function imageAddress(text: string): string | null {
  const typed = text.trim();
  const call = URL_CALL.exec(typed);
  if (call !== null) {
    const inside = call[1] ?? '';
    const quoted = QUOTED.exec(inside);
    const address = quoted === null ? inside : (quoted[1] ?? quoted[2] ?? '');
    return /["\s]/.test(address) ? null : address;
  }
  return /^[^\s"'()]+$/.test(typed) && typed.toLowerCase() !== 'none' ? typed : null;
}
const imageLayers = registerCodec('image-layers', {
  read(text, facts) {
    const typed = text.trim().toLowerCase();
    if (facts.keywords.includes(typed)) return { kind: 'keyword', keyword: typed };
    // several layers (an image under a gradient: the user's real-use audit, item A3.34): each is a gradient the browser
    // checks or an image address of the page; none of them may be `none`
    const parts = splitLayers(text);
    if (parts.length === 0) return null;
    const written: string[] = [];
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(lower) && balanced(lower)) {
        written.push(part);
        continue;
      }
      const address = imageAddress(part);
      if (address === null || address === '' || !readAddress(address).ok) return null;
      written.push(`url("${address}")`);
    }
    return { kind: 'expression', text: written.join(', ') };
  },
  write(value) {
    return value.kind === 'keyword' ? value.keyword : value.kind === 'expression' ? value.text : '';
  },
});

// A length (outline-offset), a line width (thin, medium, thick or a length: a border side's width) and a corner's
// radius read as a length or percentage does: a number with a unit the property offers, a keyword it offers.
const length = registerCodec('length', { read: (text, facts) => lengthPercentage.read(text, facts), write: (value) => lengthPercentage.write(value) });
const lineWidth = registerCodec('line-width', { read: (text, facts) => lengthPercentage.read(text, facts), write: (value) => lengthPercentage.write(value) });
const radius = registerCodec('radius', { read: (text, facts) => lengthPercentage.read(text, facts), write: (value) => lengthPercentage.write(value) });

// The words of a value, split at the spaces outside parentheses (rgb(1, 2, 3) is one word).
export function valueWords(text: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let word = '';
  for (const c of text.trim()) {
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (/\s/.test(c) && depth === 0) {
      if (word !== '') words.push(word);
      word = '';
    } else word += c;
  }
  if (word !== '') words.push(word);
  return depth === 0 ? words : [];
}

// One to four values for the four sides of a box (top, right, bottom, left) or its four corners (top left, top right,
// bottom right, bottom left), as CSS expands them: one for all, two for the opposite pairs, three with the last pair
// sharing the second. Each value a keyword the composite offers, a length in one of its units, or, for a composite with
// no units (the colours), any word the browser then checks longhand by longhand.
function fourValues(text: string, facts: ValueFacts): Value | null {
  const words = valueWords(text).map((word) => {
    if (facts.keywords.includes(word.toLowerCase())) return word.toLowerCase();
    if (facts.units.length === 0) return word;
    // Keep existing explicit lengths (including unitless zero); bare numbers and expressions use the same
    // interpreter as individual lengths, so a composite never imposes a different input language.
    const explicit = lengthText(word, facts.units);
    if (explicit !== null) return explicit;
    const value = lengthPercentage.read(word, facts);
    return value === null ? null : lengthPercentage.write(value);
  });
  if (words.length === 0 || words.length > 4 || words.some((w) => w === null)) return null;
  const [a = '', b = a, c = a, d = b] = words as string[];
  return { kind: 'longhands', values: [a, b, c, d], text: words.join(' ') };
}
// Four sides' or corners' values as CSS writes them shortest: one for all, two for the opposite pairs, three with the
// last pair sharing the second.
function composeFour(values: readonly string[]): string | null {
  const [a, b, c, d] = values;
  if (values.length !== 4 || a === undefined || b === undefined || c === undefined || d === undefined || values.some((v) => v === '')) return null;
  if (d !== b) return `${a} ${b} ${c} ${d}`;
  if (c !== a) return `${a} ${b} ${c}`;
  return b === a ? a : `${a} ${b}`;
}
export const boxSides = registerCodec('box-sides', { read: fourValues, write: (value) => (value.kind === 'longhands' ? value.text : ''), compose: composeFour });
export const boxCorners = registerCodec('box-corners', { read: fourValues, write: (value) => (value.kind === 'longhands' ? value.text : ''), compose: composeFour });

// A border side (or an outline): its width, style and colour in any order, each at most once, any of them left out
// (spec props-border-outline). A word is the style when the style longhand offers it, the width when the width
// longhand offers it or it is a length, else the colour (the browser checks it). The composite's axes name them.
function sideParts(text: string, facts: ValueFacts, [widths = [], styles = []]: readonly (readonly string[])[]): [string, string, string] | null {
  const parts: [string, string, string] = ['', '', ''];
  const words = valueWords(text);
  if (words.length === 0 || words.length > 3) return null;
  for (const word of words) {
    const lower = word.toLowerCase();
    const at = styles.includes(lower) ? 1 : widths.includes(lower) || lengthText(word, facts.units) !== null ? 0 : 2;
    if (parts[at] !== '') return null;
    parts[at] = at === 2 ? word : at === 0 ? (widths.includes(lower) ? lower : (lengthText(word, facts.units) ?? '')) : lower;
  }
  return parts;
}
// A side's width, style and colour as one value, the ones it holds in that order; a side with no style (none, hidden)
// draws no line, and reads none.
const NO_LINE: readonly string[] = ['none', 'hidden'];
function composeSide(width: string, style: string, colour: string): string | null {
  if (NO_LINE.includes(style)) return style;
  const text = [width, style, colour].filter((part) => part !== '').join(' ');
  return text === '' ? null : text;
}
const borderSide = registerCodec('border-side', {
  read(text, facts) {
    const parts = sideParts(text, facts, facts.axes ?? []);
    return parts === null ? null : { kind: 'longhands', values: parts, text: valueWords(text).join(' ') };
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
  compose: ([width = '', style = '', colour = '']) => composeSide(width, style, colour),
});
// Every side's border at once: the same width, style and colour for the four sides (longhands: the four widths, the
// four styles, the four colours).
const border = registerCodec('border', {
  read(text, facts) {
    const axes = facts.axes ?? [];
    const parts = sideParts(text, facts, [axes[0] ?? [], axes[4] ?? [], axes[8] ?? []]);
    if (parts === null) return null;
    const [w, s, c] = parts;
    return { kind: 'longhands', values: [w, w, w, w, s, s, s, s, c, c, c, c], text: valueWords(text).join(' ') };
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
  // one value for the four sides only while the sides hold the same width, style and colour
  compose(values) {
    const same = (from: number) => (new Set(values.slice(from, from + 4)).size === 1 ? (values[from] ?? '') : null);
    const [width, style, colour] = [same(0), same(4), same(8)];
    return values.length !== 12 || width === null || style === null || colour === null ? null : composeSide(width, style, colour);
  },
});

// A whole number (z-index, order) or a keyword the property offers (auto).
const integer = registerCodec('integer', {
  read(text, facts) {
    const typed = text.trim().toLowerCase();
    if (facts.keywords.includes(typed)) return { kind: 'keyword', keyword: typed };
    return /^[+-]?\d+$/.test(typed) ? { kind: 'expression', text: String(Number(typed)) } : null;
  },
  write: (value) => (value.kind === 'keyword' ? value.keyword : value.kind === 'expression' ? value.text : ''),
});
// A number that is not negative (flex-grow, flex-shrink).
const number = registerCodec('number', {
  read(text, facts) {
    const typed = text.trim().toLowerCase();
    if (facts.keywords.includes(typed)) return { kind: 'keyword', keyword: typed };
    return /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(typed) ? { kind: 'expression', text: writeNumber(Number(typed)) } : null;
  },
  write: (value) => (value.kind === 'keyword' ? value.keyword : value.kind === 'expression' ? value.text : ''),
});
// An opacity: a number from 0 to 1, or a percentage from 0 to 100 written as its number (50% is 0.5). A bare number
// above 1 is a percentage too: the field shows an opacity as a percentage ("100 %"), so what a person types there is
// one (the audit's S-020: "40" was refused).
const alpha = registerCodec('alpha', {
  read(text) {
    const typed = text.trim();
    const percent = /^(\d+(?:\.\d*)?|\.\d+)%$/.exec(typed);
    const bare = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(typed) ? Number(typed) : Number.NaN;
    const n = percent !== null ? Number(percent[1]) / 100 : bare > 1 ? bare / 100 : bare;
    return Number.isFinite(n) && n >= 0 && n <= 1 ? { kind: 'expression', text: writeNumber(n) } : null;
  },
  write: (value) => (value.kind === 'expression' ? value.text : ''),
});

// A value whose grammar is the browser's to check (a cursor, a transition, a filter, a clip path, grid lines and
// tracks, counters, font features): a keyword the property offers, or the text as typed, trimmed, with balanced
// parentheses and quotes; style.set writes it only when the CSS support port takes it for the property.
function cssText(text: string, facts: ValueFacts): Value | null {
  const typed = text.trim().replace(/\s+/g, ' ');
  if (typed === '') return null;
  const lower = typed.toLowerCase();
  if (facts.keywords.includes(lower)) return { kind: 'keyword', keyword: lower };
  const quotes = (typed.match(/"/g) ?? []).length % 2 === 0 && (typed.match(/'/g) ?? []).length % 2 === 0;
  return balanced(typed) && quotes ? { kind: 'expression', text: typed } : null;
}
const writeCssText = (value: Value): string => (value.kind === 'keyword' ? value.keyword : value.kind === 'expression' ? value.text : '');
// A grid item's lines on one axis (grid-column, grid-row): its start and its end, split at the slash; one line alone
// leaves the end auto, as CSS reads it, unless it names a line, whose end is then the same name.
const gridLinePair = registerCodec('grid-line-pair', {
  read(text, facts) {
    const parts = text.split('/').map((p) => cssText(p, facts));
    const [start, end] = parts;
    if (start === null || start === undefined || end === null || parts.length > 2) return null;
    const startText = writeCssText(start);
    const named = /^[a-z_-][\w-]*$/i.test(startText) && !['auto', 'span'].includes(startText.toLowerCase());
    const endText = end === undefined ? (named ? startText : 'auto') : writeCssText(end);
    return { kind: 'longhands', values: [startText, endText], text: end === undefined ? startText : `${startText} / ${endText}` };
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
});
// grid-area (spec props-grid-container, the audit item A1.3): one area name or line name (a CSS identifier, which
// the property offers no list of), written into all four of its longhands (grid-row-start, grid-column-start,
// grid-row-end, grid-column-end); what the field shows is the value it holds.
const gridArea = registerCodec('grid-area', {
  read(text, facts) {
    const typed = text.trim();
    const lower = typed.toLowerCase();
    if (facts.keywords.includes(lower)) return { kind: 'longhands', values: [lower, lower, lower, lower], text: lower };
    return /^-?[a-z_][a-z0-9_-]*$/i.test(typed) ? { kind: 'longhands', values: [typed, typed, typed, typed], text: typed } : null;
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
});
const trackList = registerCodec('track-list', { read: cssText, write: writeCssText });
const gridAreas = registerCodec('grid-areas', { read: cssText, write: writeCssText });
const cursor = registerCodec('cursor', { read: cssText, write: writeCssText });
const animateableFeatureList = registerCodec('animateable-feature-list', { read: cssText, write: writeCssText });
// Transitions (the composite of the transition longhands): transitions separated by commas, each a property, a
// duration, a timing function, a delay and a behaviour in any order, each at most once (the first time is the
// duration, the second the delay); what one leaves out is the initial value (all, 0s, ease, 0s, normal). Each
// longhand holds the transitions' values in order, separated by commas.
const TRANSITION_INITIAL = ['all', '0s', 'ease', '0s', 'normal'];
const transitionList = registerCodec('transition-list', {
  read(text, facts) {
    const [, , timings = [], , behaviours = []] = facts.axes ?? [];
    const items = splitOutside(text, ',');
    if (items.length === 0) return null;
    const columns: string[][] = TRANSITION_INITIAL.map(() => []);
    const written: string[] = [];
    for (const item of items) {
      const words = valueWords(item);
      if (words.length === 0) return null;
      const parts: (string | null)[] = [null, null, null, null, null];
      for (const word of words) {
        const lower = word.toLowerCase();
        const time = /^(?:\d+(?:\.\d*)?|\.\d+)(?:s|ms)$/.test(lower);
        const at = time ? (parts[1] === null ? 1 : 3) : timings.includes(lower) || /^(?:cubic-bezier|steps|linear)\(/.test(lower) ? 2 : behaviours.includes(lower) ? 4 : /^-?[a-z_][\w-]*$/.test(lower) ? 0 : -1;
        if (at < 0 || parts[at] !== null) return null;
        parts[at] = lower;
      }
      parts.forEach((part, i) => columns[i]?.push(part ?? TRANSITION_INITIAL[i] ?? ''));
      written.push(words.join(' '));
    }
    return { kind: 'longhands', values: columns.map((c) => c.join(', ')), text: written.join(', ') };
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
});
// A time or a list of them (an animation's duration and delay): a number with s or ms, in either unit the property
// offers, separated by commas. An animation's setting holds one; the codec reads a list because the properties of
// properties.json that name it (transition-duration, transition-delay) hold one per transition.
const TIME_ITEM = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(s|ms)$/;
const timeList = registerCodec('time-list', {
  read(text, facts) {
    const items = splitOutside(text, ',');
    if (items.length === 0) return null;
    const written: string[] = [];
    for (const item of items) {
      const typed = item.trim().toLowerCase();
      const time = TIME_ITEM.exec(typed);
      if (time !== null) {
        if (!facts.units.includes(time[2] ?? '')) return null;
        written.push(`${writeNumber(Number(time[1]))}${time[2] ?? ''}`);
        continue;
      }
      if (facts.keywords.includes(typed)) {
        written.push(typed);
        continue;
      }
      return null;
    }
    return { kind: 'longhands', values: written, text: written.join(', ') };
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
});

// An easing function or a list of them (a keyframe's easing, a property's timing function): a keyword the property
// offers, or the text of cubic-bezier(), steps() or linear(), separated by commas. The CSS support port judges the
// text as well (style.set asks it before it writes).
const EASING_FUNCTION = /^(?:cubic-bezier|steps|linear)\(/;
const easingList = registerCodec('easing-list', {
  read(text, facts) {
    const items = splitOutside(text, ',');
    if (items.length === 0) return null;
    const written: string[] = [];
    for (const item of items) {
      const typed = item.trim().replace(/\s+/g, ' ');
      const lower = typed.toLowerCase();
      if (facts.keywords.includes(lower)) written.push(lower);
      else if (EASING_FUNCTION.test(lower) && balanced(typed)) written.push(lower);
      else return null;
    }
    return { kind: 'longhands', values: written, text: written.join(', ') };
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
});

// The pieces of a text between the separators outside parentheses, trimmed; empty when a piece is empty.
// The layers of a value that holds several (a background image: an image under a gradient, the user's real-use audit,
// item A3.34): the commas outside parentheses part them. One owner reads it, the image codec and the gradient editor.
export function splitLayers(text: string | undefined): string[] {
  return splitOutside((text ?? '').trim(), ',').filter((part) => part !== '');
}

function splitOutside(text: string, separator: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let piece = '';
  for (const c of text) {
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === separator && depth === 0) {
      pieces.push(piece.trim());
      piece = '';
    } else piece += c;
  }
  pieces.push(piece.trim());
  return pieces.some((p) => p === '') ? [] : pieces;
}
const filterList = registerCodec('filter-list', { read: cssText, write: writeCssText });
const clipPath = registerCodec('clip-path', { read: cssText, write: writeCssText });
// Text columns (the composite of column-width and column-count): a width, a count, or both in either order, each or
// both auto; what is left out is auto, as CSS reads it.
const columns = registerCodec('columns', {
  read(text, facts) {
    const words = valueWords(text).map((w) => w.toLowerCase());
    if (words.length === 0 || words.length > 2) return null;
    let width: string | null = null;
    let count: string | null = null;
    for (const word of words) {
      if (/^\d+$/.test(word) && Number(word) > 0 && count === null) count = String(Number(word));
      else if (word !== 'auto' && lengthText(word, facts.units) !== null && width === null) width = lengthText(word, facts.units);
      else if (word === 'auto' && (width === null || count === null)) {
        if (width === null) width = 'auto';
        else count = 'auto';
      } else return null;
    }
    const values = [width ?? 'auto', count ?? 'auto'];
    return { kind: 'longhands', values, text: words.join(' ') };
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
});
const counterList = registerCodec('counter-list', { read: cssText, write: writeCssText });
const fontStretch = registerCodec('font-stretch', { read: cssText, write: writeCssText });
// A font variant (the composite of the font-variant longhands): each keyword goes to the longhand whose list names it
// (small-caps: font-variant-caps; tabular-nums: font-variant-numeric), several to one longhand together; the longhands
// no word names are left as they are; normal alone makes every longhand normal.
const fontVariant = registerCodec('font-variant', {
  read(text, facts) {
    const axes = facts.axes ?? [];
    const words = valueWords(text).map((w) => w.toLowerCase());
    if (words.length === 0 || new Set(words).size !== words.length) return null;
    const NORMAL = 'normal';
    if (words.length === 1 && words[0] === NORMAL) return { kind: 'longhands', values: axes.map(() => NORMAL), text: NORMAL };
    const values = axes.map(() => [] as string[]);
    for (const word of words) {
      const at = word === NORMAL ? -1 : axes.findIndex((keywords) => keywords.includes(word));
      if (at < 0) return null;
      values[at]?.push(word);
    }
    return { kind: 'longhands', values: values.map((v) => v.join(' ')), text: words.join(' ') };
  },
  write: (value) => (value.kind === 'longhands' ? value.text : ''),
});
// A line clamp (the recipe line-clamp): how many lines a text shows, a whole number from 1.
const lineClamp = registerCodec('line-clamp', {
  read(text) {
    const typed = text.trim();
    return /^\d+$/.test(typed) && Number(typed) >= 1 ? { kind: 'expression', text: String(Number(typed)) } : null;
  },
  write: (value) => (value.kind === 'expression' ? value.text : ''),
});
const translate = registerCodec('translate', { read: cssText, write: writeCssText });
const rotate = registerCodec('rotate', { read: cssText, write: writeCssText });
const scale = registerCodec('scale', { read: cssText, write: writeCssText });
const transformList = registerCodec('transform-list', { read: cssText, write: writeCssText });
const featureTagList = registerCodec('feature-tag-list', { read: cssText, write: writeCssText });
// A pair of lengths (border-spacing, spec props-element-specific): one length for both axes, or two, the first
// horizontal and the second vertical, each in a unit the property offers (no percentage: it offers none); a bare number
// takes the field's unit.
const lengthPair = registerCodec('length-pair', { read: (text, facts) => axisPair.read(text, facts), write: (value) => axisPair.write(value) });
// A counter style (list-style-type): a keyword the property offers (none), the name of a counter style (disc, decimal,
// lower-roman or any other: a CSS identifier), or a quoted string, the marker itself.
const counterStyle = registerCodec('counter-style', {
  read(text, facts) {
    const typed = text.trim();
    const lower = typed.toLowerCase();
    if (facts.keywords.includes(lower)) return { kind: 'keyword', keyword: lower };
    if (/^-?[a-z_][a-z0-9_-]*$/i.test(typed)) return { kind: 'expression', text: typed };
    return /^"[^"\\]*"$|^'[^'\\]*'$/.test(typed) ? { kind: 'expression', text: typed } : null;
  },
  write: writeCssText,
});
// One image (list-style-image): a keyword the property offers (none), a gradient, or an address, read as a background
// image's layer is (image-layers: written url("…"), never a script's source).
const image = registerCodec('image', { read: (text, facts) => imageLayers.read(text, facts), write: (value) => imageLayers.write(value) });

// Every codec registered, by the id properties.json names.
const CODECS: ReadonlyMap<string, Codec> = new Map(
  [
    lengthPercentage,
    keyword,
    ratio,
    axisPair,
    fontFamilyList,
    fontWeight,
    fontStyle,
    lineHeight,
    keywordSet,
    textIndent,
    verticalAlign,
    textDecoration,
    whiteSpace,
    color,
    paint,
    position,
    backgroundSize,
    imageLayers,
    length,
    lineWidth,
    radius,
    boxSides,
    boxCorners,
    borderSide,
    border,
    integer,
    number,
    alpha,
    gridLinePair,
    gridArea,
    trackList,
    gridAreas,
    cursor,
    animateableFeatureList,
    transitionList,
    timeList,
    easingList,
    filterList,
    clipPath,
    columns,
    counterList,
    fontStretch,
    fontVariant,
    featureTagList,
    lineClamp,
    translate,
    rotate,
    scale,
    transformList,
    lengthPair,
    counterStyle,
    image
  ].map((c) => [c.id, c]),
);

export function codecOf(id: string): Codec | null {
  return CODECS.get(id) ?? null;
}

// The units a number field steps by a tenth (numberField.fineStep; spec inspector-number-fields, Problems in Pager 4):
// the font-relative ones (CSS Values 4, "Font-relative lengths"), of which one is a large jump.
export const FINE_STEP_UNITS: ReadonlySet<string> = new Set(['em', 'rem', 'ex', 'rex', 'ch', 'rch', 'lh', 'rlh', 'cap', 'rcap', 'ic', 'ric']);

// How many CSS pixels one of each absolute length unit is (CSS Values 4, "Absolute lengths"): the only units a length
// converts between without measuring the page.
const PIXELS_PER: Readonly<Record<string, number>> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };

// A length in another unit, the same size: between absolute units, into its own unit, or zero into any unit; null for
// anything that needs the page to measure (%, em, rem, the viewport units), which a handler never measures.
export function convertLength(value: { readonly number: number; readonly unit: string }, to: string): number | null {
  if (value.unit === to || value.number === 0) return value.number;
  const from = PIXELS_PER[value.unit];
  const into = PIXELS_PER[to];
  return from === undefined || into === undefined ? null : (value.number * from) / into;
}

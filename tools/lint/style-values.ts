// What a literal style value is (PRODUCT.md §5, Tokens): the analysis behind builder-css/use-tokens (stylesheets)
// and builder/use-tokens (React style objects). Every colour, spacing, size, radius, shadow and font value of the
// interface comes from a custom property of the generated src/ui/tokens.css.
import { readFileSync, statSync } from 'node:fs';
import { lexer, parse, toPlainObject, walk, type CssNodePlain, type Declaration } from 'css-tree';

export const DEFAULT_TOKENS_FILE = 'src/ui/tokens.css';

type LiteralKind = 'colour' | 'length' | 'font' | 'layer' | 'variable';

export interface StyleLiteral {
  kind: LiteralKind;
  // The literal as written, or the custom property name for kind "variable".
  text: string;
  // Offsets of the literal in the text the value was parsed from (shifted by `at.offset`).
  start: number;
  end: number;
  property: string;
  // The tokens that replace it, for the message.
  hint: string;
}

export interface Position {
  offset: number;
  line: number;
  column: number;
}

// The kinds of property whose lengths or font values must come from tokens, with the tokens that replace them.
type Category = 'spacing' | 'position' | 'size' | 'radius' | 'shadow' | 'font' | 'layer' | 'custom';

const LENGTH_HINTS: Readonly<Record<Exclude<Category, 'font'>, string>> = {
  spacing: '--space-*',
  position: '--space-* or --size-*',
  size: '--size-* or --space-*',
  radius: '--radius-*',
  shadow: '--shadow-*',
  layer: '--z-*',
  custom: '--space-*, --size-* or --radius-*',
};

const FONT_HINTS: Readonly<Record<string, string>> = {
  font: '--fs-*, --lh-*, --fw-* and --font-*',
  'font-family': '--font-*',
  'font-size': '--fs-*',
  'font-weight': '--fw-* or --weight-*',
  'line-height': '--lh-*',
  'letter-spacing': '--ls-*',
};

const SIDES = '(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?';
const CATEGORY_PATTERNS: ReadonlyArray<readonly [RegExp, Category]> = [
  [new RegExp(`^(scroll-)?(margin|padding)${SIDES}$`), 'spacing'],
  [/^(grid-)?(row-|column-)?gap$/, 'spacing'],
  [/^(inset(-(inline|block)(-(start|end))?)?|top|right|bottom|left)$/, 'position'],
  [/^((min|max)-)?(width|height|inline-size|block-size)$/, 'size'],
  [/^(flex|flex-basis|grid-template-(columns|rows)|grid-auto-(columns|rows))$/, 'size'],
  [/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/, 'radius'],
  [/^(box|text)-shadow$/, 'shadow'],
  [/^z-index$/, 'layer'],
];

// The property a style applies to, without a vendor prefix: -webkit-box-shadow is checked as box-shadow.
function categoryOf(property: string): Category | null {
  if (property.startsWith('--')) return 'custom';
  const name = property.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, '');
  if (name in FONT_HINTS) return 'font';
  for (const [pattern, category] of CATEGORY_PATTERNS) if (pattern.test(name)) return category;
  return null;
}

function hintOf(property: string, category: Category): string {
  if (category === 'font') return FONT_HINTS[property.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, '')] ?? '';
  return LENGTH_HINTS[category];
}

// The colour keywords and colour functions, read from CSSTree's copy of the CSS syntax. transparent and currentColor
// are not in these lists; color-mix() and light-dark() are not colour functions here: they combine other colours,
// and their arguments are checked.
function keywordsOf(type: string): string[] {
  const syntax = lexer.getType(type)?.syntax;
  if (syntax?.type !== 'Group') return [];
  return syntax.terms.flatMap((term) => (term.type === 'Keyword' ? [term.name.toLowerCase()] : []));
}

function functionsOf(type: string): string[] {
  const syntax = lexer.getType(type)?.syntax;
  if (syntax?.type !== 'Group') return [];
  return syntax.terms.flatMap((term) => (term.type === 'Type' && term.name.endsWith('()') ? [term.name.slice(0, -2).toLowerCase()] : []));
}

const NAMED_COLOURS: ReadonlySet<string> = new Set([...keywordsOf('named-color'), ...keywordsOf('system-color')]);
const COLOUR_FUNCTIONS: ReadonlySet<string> = new Set([...functionsOf('color-function'), 'device-cmyk']);
if (NAMED_COLOURS.size === 0 || COLOUR_FUNCTIONS.size === 0) {
  throw new Error('CSSTree no longer lists <named-color> or <color-function>: the literal colour check needs them.');
}

// Absolute and font-relative lengths are literal sizes. Percentages, viewport and container units and fr are
// proportions of the layout, and pass.
const LITERAL_LENGTH_UNITS: ReadonlySet<string> = new Set(
  ['px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'em', 'rem', 'ex', 'rex', 'ch', 'rch', 'cap', 'rcap', 'ic', 'ric', 'lh', 'rlh'],
);

const MATH_FUNCTIONS: ReadonlySet<string> = new Set(
  ['calc', 'min', 'max', 'clamp', 'round', 'mod', 'rem', 'abs', 'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'sqrt', 'hypot', 'log', 'exp'],
);

const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const ALWAYS_ALLOWED_KEYWORDS: ReadonlySet<string> = new Set([...CSS_WIDE_KEYWORDS, 'auto', 'none']);
// The font shorthand also packs the style and variant, which have no tokens.
const FONT_SHORTHAND_KEYWORDS: ReadonlySet<string> = new Set(['normal', 'italic', 'oblique', 'small-caps']);

const LOCAL_LAYERS = 9;

function isZero(value: string): boolean {
  return Number(value) === 0;
}

// Every literal colour, spacing, size, radius, shadow or font value in the value of a property, and every var() it
// reads (kind "variable", for the caller to check against the tokens it knows). `at` places the value in its file.
export function styleLiterals(property: string, value: string, at: Position = { offset: 0, line: 1, column: 1 }): StyleLiteral[] {
  const category = categoryOf(property);
  const root = toPlainObject(parse(value, { context: 'value', positions: true, parseCustomProperty: true, ...at }));
  const found: StyleLiteral[] = [];
  const textOf = (node: CssNodePlain): string => (node.loc ? value.slice(node.loc.start.offset - at.offset, node.loc.end.offset - at.offset) : '');
  const add = (kind: LiteralKind, node: CssNodePlain, text = textOf(node)): void => {
    if (!node.loc) return;
    const hint = kind === 'colour' ? '--color-*' : category ? hintOf(property, category) : '';
    found.push({ kind, text, start: node.loc.start.offset, end: node.loc.end.offset, property, hint });
  };

  const visit = (node: CssNodePlain, inMath: boolean): void => {
    switch (node.type) {
      case 'Value':
      case 'Parentheses':
        for (const child of node.children) visit(child, inMath);
        return;
      case 'Function': {
        const name = node.name.toLowerCase();
        if (name === 'var') {
          const [variable, ...fallback] = node.children;
          if (variable?.type === 'Identifier') add('variable', variable, variable.name);
          for (const child of fallback) visit(child, inMath);
          return;
        }
        if (COLOUR_FUNCTIONS.has(name)) {
          add('colour', node);
          return;
        }
        for (const child of node.children) visit(child, inMath || MATH_FUNCTIONS.has(name));
        return;
      }
      case 'Hash':
        add('colour', node);
        return;
      case 'Identifier': {
        const name = node.name.toLowerCase();
        if (category === 'font') {
          const allowed = ALWAYS_ALLOWED_KEYWORDS.has(name) || (property.toLowerCase() === 'font' && FONT_SHORTHAND_KEYWORDS.has(name));
          if (!allowed) add('font', node);
          return;
        }
        if (NAMED_COLOURS.has(name)) add('colour', node);
        return;
      }
      case 'Dimension':
        if (isZero(node.value)) return;
        if (category === 'font') add('font', node);
        else if (category && LITERAL_LENGTH_UNITS.has(node.unit.toLowerCase())) add('length', node);
        return;
      case 'Number':
        if (category === 'font' && !inMath && !isZero(node.value)) add('font', node);
        // a layer of the interface (a menu, a dialog, the palette) comes from the z scale; 0 to 9 order the parts of
        // one component inside its own stacking
        if (category === 'layer' && Math.abs(Number(node.value)) > LOCAL_LAYERS) add('layer', node);
        return;
      case 'Percentage':
      case 'String':
        if (category === 'font') add('font', node);
        return;
      default:
        return;
    }
  };

  visit(root, false);
  return found;
}

// A number in a React style object: React writes it in px unless the property is unitless (flex, line-height,
// font-weight...). A number other than 0 in a length or font property is a literal.
export function numberLiteral(property: string, value: number): Omit<StyleLiteral, 'start' | 'end'> | null {
  const category = categoryOf(property);
  if (value === 0 || category === null || category === 'custom' || property === 'flex') return null;
  if (category === 'layer') return Math.abs(value) > LOCAL_LAYERS ? { kind: 'layer', text: String(value), property, hint: hintOf(property, category) } : null;
  return { kind: category === 'font' ? 'font' : 'length', text: String(value), property, hint: hintOf(property, category) };
}

// backgroundColor -> background-color, WebkitBoxShadow -> -webkit-box-shadow, msTransform -> -ms-transform.
export function cssPropertyName(key: string): string {
  if (key.startsWith('--')) return key;
  const kebab = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return kebab.startsWith('ms-') ? `-${kebab}` : kebab;
}

// The custom properties a tokens stylesheet defines, read once per change of the file.
const tokenCache = new Map<string, { mtimeMs: number; names: ReadonlySet<string> }>();

export function tokenNames(file: string): ReadonlySet<string> {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    throw new Error(`${file} does not exist: run npm run gen to write the tokens.`);
  }
  const cached = tokenCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.names;
  const names = new Set<string>();
  walk(parse(readFileSync(file, 'utf8')), {
    visit: 'Declaration',
    enter(node: Declaration) {
      if (node.property.startsWith('--')) names.add(node.property);
    },
  });
  tokenCache.set(file, { mtimeMs, names });
  return names;
}

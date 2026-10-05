// Builds src/ui/tokens.css from design/final/tokens.json (DTCG) with Style Dictionary. The editor and the
// mockups read only these custom properties: colours, type, spacing, sizes, radii and shadows come from
// the design tokens, never from a literal in a stylesheet.
// Theme groups (color.light / color.dark, elevation.light / elevation.dark) become one set of names, written
// for light on :root, for dark under prefers-color-scheme (the default "system" theme) and under
// [data-theme="dark"] (the Theme menu's explicit choice).
import path from 'node:path';
import StyleDictionary from 'style-dictionary';
import type { Dictionary, TransformedToken } from 'style-dictionary/types';

const TOKENS_SOURCE = 'design/final/tokens.json';
export const TOKENS_CSS = 'src/ui/tokens.css';

const THEMED = ['color', 'elevation'];
const THEMES = ['light', 'dark'] as const;

interface Dimension {
  value: number;
  unit: string;
}
interface Color {
  colorSpace: string;
  components: number[];
  hex: string;
  alpha?: number;
}
interface ShadowLayer {
  color: Color;
  offsetX: Dimension;
  offsetY: Dimension;
  blur: Dimension;
  spread: Dimension;
  inset?: boolean;
}
interface Typography {
  fontFamily: string[] | string;
  fontSize: Dimension;
  fontWeight: number;
  letterSpacing: Dimension;
  lineHeight: number;
}

const dimension = (d: Dimension) => `${d.value}${d.unit}`;
const color = (c: Color) => {
  if (c.alpha === undefined || c.alpha === 1) return c.hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${c.alpha})`;
};
const family = (f: string[] | string) => (Array.isArray(f) ? f : [f]).map((name) => (/\s/.test(name) ? `"${name}"` : name)).join(', ');
const shadow = (layers: ShadowLayer[]) =>
  layers.map((l) => `${l.inset === true ? 'inset ' : ''}${dimension(l.offsetX)} ${dimension(l.offsetY)} ${dimension(l.blur)} ${dimension(l.spread)} ${color(l.color)}`).join(', ');

// The CSS name of a token: the theme segment is dropped (color.light.surface → color-surface), and the
// groups the stylesheets use short names for keep them (font.family.ui → font-ui, elevation.2 → shadow-2).
function cssName(tokenPath: string[]): string {
  const [group = '', ...rest] = tokenPath.filter((part, i) => !(i === 1 && THEMED.includes(tokenPath[0] ?? '') && (THEMES as readonly string[]).includes(part)));
  if (group === 'font') return `${rest[0] === 'weight' ? 'weight' : 'font'}-${rest.at(-1) ?? ''}`;
  if (group === 'elevation') return `shadow-${rest.join('-')}`;
  return [group, ...rest].join('-');
}

// The declarations of one token. A typography token becomes its size, line height (in px), weight and
// letter spacing.
function declarations(token: TransformedToken): [string, string][] {
  const name = cssName(token.path);
  const value = token.$value as unknown;
  switch (token.$type) {
    case 'dimension':
      return [[name, dimension(value as Dimension)]];
    case 'color':
      return [[name, color(value as Color)]];
    case 'shadow':
      return [[name, shadow(value as ShadowLayer[])]];
    case 'fontFamily':
      return [[name, family(value as string[])]];
    case 'fontWeight':
    case 'number':
      return [[name, String(value)]];
    case 'typography': {
      const t = value as Typography;
      const id = token.path.at(-1) ?? '';
      return [
        [`fs-${id}`, dimension(t.fontSize)],
        [`lh-${id}`, `${Math.round(t.fontSize.value * t.lineHeight)}px`],
        [`fw-${id}`, String(t.fontWeight)],
        [`ls-${id}`, dimension(t.letterSpacing)],
      ];
    }
    default:
      throw new Error(`${token.path.join('.')}: no CSS for the token type ${String(token.$type)}`);
  }
}

// Legibility (WCAG 2.2, 1.4.3): in each theme every "on-X" colour reads on "X", the tooltip's text on its background,
// and the three text colours on every surface they sit on, at 4.5:1 or more. npm run gen fails otherwise.
const MIN_CONTRAST = 4.5;
const TEXT_ON = [
  ['text', 'surface'], ['text-muted', 'surface'], ['text-subtle', 'surface'],
  ['text-subtle', 'surface-raised'], ['text-subtle', 'surface-sunken'], ['text-subtle', 'bg-app'], ['tip-text', 'tip-bg'],
] as const;

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// The pairs of one theme that read below 4.5:1, as "on-x on x: 3.1:1".
function illegiblePairs(colors: ReadonlyMap<string, Color>): string[] {
  const solid = (name: string) => {
    const c = colors.get(name);
    return c !== undefined && (c.alpha === undefined || c.alpha === 1) ? c.hex : null;
  };
  const pairs: (readonly [string, string])[] = [...colors.keys()].filter((n) => n.startsWith('on-') && colors.has(n.slice(3))).map((n) => [n, n.slice(3)] as const);
  pairs.push(...TEXT_ON);
  return pairs.flatMap(([fg, bg]) => {
    const a = solid(fg);
    const b = solid(bg);
    if (a === null || b === null) return [];
    const ratio = contrast(a, b);
    return ratio < MIN_CONTRAST ? [`${fg} on ${bg}: ${ratio.toFixed(2)}:1`] : [];
  });
}

const block = (selector: string, tokens: TransformedToken[], indent = '') =>
  `${indent}${selector} {\n${tokens.flatMap(declarations).map(([n, v]) => `${indent}  --${n}: ${v};`).join('\n')}\n${indent}}`;

function themeTokens(dictionary: Dictionary, theme: (typeof THEMES)[number]) {
  return dictionary.allTokens.filter((t) => THEMED.includes(t.path[0] ?? '') && t.path[1] === theme);
}

function formatCss(dictionary: Dictionary): string {
  const shared = dictionary.allTokens.filter((t) => !THEMED.includes(t.path[0] ?? ''));
  const light = themeTokens(dictionary, 'light');
  const dark = themeTokens(dictionary, 'dark');
  const names = (tokens: TransformedToken[]) => tokens.flatMap(declarations).map(([n]) => n).join(',');
  if (names(light) !== names(dark)) throw new Error('design/final/tokens.json: the light and dark themes do not define the same tokens');
  for (const [theme, tokens] of [['light', light], ['dark', dark]] as const) {
    const colors = new Map(tokens.filter((t) => t.$type === 'color').map((t) => [t.path.at(-1) ?? '', t.$value as Color]));
    const illegible = illegiblePairs(colors);
    if (illegible.length > 0) throw new Error(`design/final/tokens.json: in the ${theme} theme ${illegible.join('; ')} (4.5:1 is the least)`);
  }
  return [
    `/* Generated by npm run gen (tools/gen/tokens.ts, Style Dictionary ${StyleDictionary.VERSION}) from ${TOKENS_SOURCE}. Do not edit. */`,
    block(':root', shared),
    block(':root', light).replace(':root {\n', ':root {\n  color-scheme: light;\n'),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', dark, '  ').replace('{\n', '{\n    color-scheme: dark;\n')}\n}`,
    block(':root[data-theme="dark"]', dark).replace('{\n', '{\n  color-scheme: dark;\n'),
    '',
  ].join('\n\n');
}

const FORMAT = 'builder/css-themes';

// Style Dictionary reads the DTCG file and resolves its references ({font.family.ui}); the format above
// writes the custom properties. The caller writes the returned text to TOKENS_CSS.
export async function generateTokens(root: string): Promise<string> {
  const sd = new StyleDictionary(
    {
      source: [path.join(root, TOKENS_SOURCE)],
      usesDtcg: true,
      log: { verbosity: 'silent', warnings: 'disabled' },
      platforms: { css: { transforms: [], files: [{ destination: path.basename(TOKENS_CSS), format: FORMAT }] } },
    },
    { verbosity: 'silent', warnings: 'disabled' },
  );
  sd.registerFormat({ name: FORMAT, format: ({ dictionary }) => formatCss(dictionary) });
  const [file] = await sd.formatPlatform('css');
  if (typeof file?.output !== 'string') throw new Error(`Style Dictionary wrote no ${TOKENS_CSS}`);
  return file.output;
}

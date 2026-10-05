// Colours (PRODUCT.md §5; spec color-picker, color-picker-oklch): the one reader and writer of the colours the picker
// works with. A colour is read from CSS text: #rgb, #rrggbb, #rgba, #rrggbbaa, transparent, and the functions rgb(),
// hsl(), hwb(), lab(), lch(), oklab(), oklch() and color() (srgb, srgb-linear, display-p3, xyz, xyz-d50, xyz-d65), in
// the modern and the legacy syntax (parseSrgb: sRGB channels from 0 to 1, beyond them for a colour outside sRGB); a
// named colour is read by the page, which computes it as rgb(). It is turned between RGB, HSB, OKLab and OKLCH, and
// written as the picker writes it: #rrggbb when opaque, else rgba(r, g, b, a), its channels whole numbers from 0 to 255
// and its alpha to two decimals (spec color-picker, Problems in Pager 2); a channel of OKLCH or OKLab typed writes the
// colour in that space (oklch(L% C H), oklab(L% a b)), so a colour outside sRGB is kept as it is (editedColour).
import type { CommandArgs } from '../../generated/commands.ts';
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}
export interface Hsba {
  // hue 0–360, saturation and brightness 0–1, alpha 0–1
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly a: number;
}

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION = /^([a-z-]+)\(\s*([^()]*)\)$/i;

// A colour in sRGB: its channels from 0 to 1 (below or above for a colour outside sRGB), and its alpha from 0 to 1.
export interface Srgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}
type Vector = readonly [number, number, number];
const times = (m: readonly Vector[], [x, y, z]: Vector): Vector => m.map(([a, b, c]) => a * x + b * y + c * z) as unknown as Vector;
// the sRGB transfer function and its inverse (also display-p3's), keeping the sign of a value beyond the range
const toLinear = (c: number) => Math.sign(c) * (Math.abs(c) <= 0.04045 ? Math.abs(c) / 12.92 : ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => Math.sign(c) * (Math.abs(c) <= 0.0031308 ? Math.abs(c) * 12.92 : 1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);
// CSS Color 4, "Sample code for color conversions": XYZ (D65) to linear sRGB, linear display-p3 to XYZ (D65), and the
// Bradford adaptation from D50 to D65
const XYZ_TO_SRGB: readonly Vector[] = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const P3_TO_XYZ: readonly Vector[] = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const D50_TO_D65: readonly Vector[] = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const D50_WHITE: Vector = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const fromXyz = (xyz: Vector): Vector => times(XYZ_TO_SRGB, xyz).map(fromLinear) as unknown as Vector;
// CIE Lab (D50) to XYZ (D65)
function labToXyz([l, a, b]: Vector): Vector {
  const k = 24389 / 27;
  const e = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xyz: Vector = [fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k, l > k * e ? fy ** 3 : l / k, fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k];
  return times(D50_TO_D65, xyz.map((v, i) => v * (D50_WHITE[i] ?? 1)) as unknown as Vector);
}
// OKLab (Björn Ottosson, as CSS Color 4 gives it) to and from linear sRGB
export interface Oklab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}
function oklabToSrgb({ l, a, b }: Oklab): Vector {
  const [l1, m1, s1] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((v) => v ** 3) as unknown as Vector;
  return [4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1, -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1, -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1].map(fromLinear) as unknown as Vector;
}
export function toOklab({ r, g, b }: Srgb): Oklab {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as unknown as Vector;
  const [l1, m1, s1] = [0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb, 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb, 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb].map(Math.cbrt) as unknown as Vector;
  return { l: 0.2104542553 * l1 + 0.793617785 * m1 - 0.0040720468 * s1, a: 1.9779984951 * l1 - 2.428592205 * m1 + 0.4505937099 * s1, b: 0.0259040371 * l1 + 0.7827717662 * m1 - 0.808675766 * s1 };
}
const polar = (a: number, b: number) => ({ c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 });
const cartesian = (c: number, h: number) => ({ a: c * Math.cos((h * Math.PI) / 180), b: c * Math.sin((h * Math.PI) / 180) });

// A number of a colour function: "none" is 0; a percentage is its share of `full`; an angle (a hue) in degrees.
function numberOf(word: string, full: number): number | null {
  if (word === 'none') return 0;
  const angle = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)$/.exec(word);
  if (angle !== null) {
    const n = Number(angle[1]);
    return angle[2] === 'rad' ? (n * 180) / Math.PI : angle[2] === 'grad' ? n * 0.9 : angle[2] === 'turn' ? n * 360 : n;
  }
  const n = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/.exec(word);
  if (n === null) return null;
  return n[2] === '%' ? (Number(n[1]) / 100) * full : Number(n[1]);
}

// The colour of a colour function's name and its three channel words (their full scale for a percentage), in sRGB.
const SPACES: Readonly<Record<string, { readonly full: Vector; readonly srgb: (v: Vector) => Vector }>> = {
  rgb: { full: [255, 255, 255], srgb: (v) => v.map((c) => c / 255) as unknown as Vector },
  hsl: { full: [360, 100, 100], srgb: ([h, sat, light]) => hslToSrgb(h, sat / 100, light / 100) },
  hwb: { full: [360, 100, 100], srgb: ([h, w, bl]) => hwbToSrgb(h, w / 100, bl / 100) },
  lab: { full: [100, 125, 125], srgb: (v) => fromXyz(labToXyz(v)) },
  lch: { full: [100, 150, 360], srgb: ([l, c, h]) => fromXyz(labToXyz([l, cartesian(c, h).a, cartesian(c, h).b])) },
  oklab: { full: [1, 0.4, 0.4], srgb: ([l, a, b]) => oklabToSrgb({ l, a, b }) },
  oklch: { full: [1, 0.4, 360], srgb: ([l, c, h]) => oklabToSrgb({ l, ...cartesian(c, h) }) },
};
// color()'s spaces, their channels 0 to 1
const PREDEFINED: Readonly<Record<string, (v: Vector) => Vector>> = {
  srgb: (v) => v,
  'srgb-linear': (v) => v.map(fromLinear) as unknown as Vector,
  'display-p3': (v) => fromXyz(times(P3_TO_XYZ, v.map(toLinear) as unknown as Vector)),
  xyz: fromXyz,
  'xyz-d65': fromXyz,
  'xyz-d50': (v) => fromXyz(times(D50_TO_D65, v)),
};
function hslToSrgb(h: number, sat: number, light: number): Vector {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
function hwbToSrgb(h: number, w: number, bl: number): Vector {
  if (w + bl >= 1) return [w / (w + bl), w / (w + bl), w / (w + bl)];
  return hslToSrgb(h, 1, 0.5).map((c) => c * (1 - w - bl) + w) as unknown as Vector;
}

// A colour function's three channel words read as sRGB, or null when they are not three numbers of its space.
const spaceReader =
  (space: { readonly full: Vector; readonly srgb: (v: Vector) => Vector }) =>
  (words: readonly string[]): Vector | null => {
    const values = words.map((w, i) => numberOf(w, space.full[i] ?? 1));
    return values.length !== 3 || values.some((v) => v === null) ? null : space.srgb(values as unknown as Vector);
  };
// Each colour function by its name (rgba() and hsla() are rgb() and hsl()), and color(<space> c1 c2 c3).
const READERS: Readonly<Record<string, (words: readonly string[]) => Vector | null>> = {
  ...Object.fromEntries(Object.entries(SPACES).map(([name, space]) => [name, spaceReader(space)])),
  rgba: spaceReader(SPACES.rgb as (typeof SPACES)[string]),
  hsla: spaceReader(SPACES.hsl as (typeof SPACES)[string]),
  color: ([space = '', ...channels]) => {
    const convert = PREDEFINED[space];
    const values = channels.map((w) => numberOf(w, 1));
    return convert === undefined || values.length !== 3 || values.some((v) => v === null) ? null : convert(values as unknown as Vector);
  },
};

// The colour a CSS text stands for, in sRGB (channels from 0 to 1, beyond them outside sRGB); null for a text this
// reader does not read (a named colour: the page computes it; relative colours, color-mix()).
export function parseSrgb(text: string): Srgb | null {
  const typed = text.trim().toLowerCase();
  if (typed === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = HEX.exec(typed);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const full = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
    const channel = (i: number) => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return { r: channel(0), g: channel(1), b: channel(2), a: full.length === 8 ? Math.round(channel(3) * 100) / 100 : 1 };
  }
  const call = FUNCTION.exec(typed);
  if (call === null) return null;
  const [body = '', alphaText] = (call[2] ?? '').split('/').map((p) => p.trim());
  const words = body.split(/[\s,]+/).filter((w) => w !== '');
  // the legacy syntax gives the alpha as a fourth comma-separated value
  const legacyAlpha = alphaText === undefined && words.length === 4 && body.includes(',') ? words.pop() : undefined;
  const alphaWord = alphaText ?? legacyAlpha;
  const alpha = alphaWord === undefined ? 1 : numberOf(alphaWord, 1);
  const read = READERS[call[1] ?? ''];
  const srgb = read === undefined || alpha === null ? null : read(words);
  if (srgb === null || alpha === null) return null;
  const [r, g, b] = srgb;
  return [r, g, b].every(Number.isFinite) ? { r, g, b, a: clamp(alpha, 0, 1) } : null;
}

// whether a colour lies in sRGB (a hair beyond, from rounding, counts as in)
export const inSrgbGamut = ({ r, g, b }: Srgb): boolean => [r, g, b].every((c) => c >= -0.0005 && c <= 1.0005);

// the colour a CSS text stands for, as the picker's RGB (the nearest in sRGB for a colour outside it), or null
export function parseColor(text: string): Rgba | null {
  const read = parseSrgb(text);
  if (read === null) return null;
  const channel = (c: number) => clamp(Math.round(c * 255), 0, 255);
  return { r: channel(read.r), g: channel(read.g), b: channel(read.b), a: read.a };
}

export function rgbToHsb({ r, g, b, a }: Rgba): Hsba {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / delta) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / delta + 2);
    else h = 60 * ((rr - gg) / delta + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max, a };
}

export function hsbToRgb({ h, s, v, a }: Hsba): Rgba {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const channel = (n: number) => clamp(Math.round((n + m) * 255), 0, 255);
  return { r: channel(r1), g: channel(g1), b: channel(b1), a: clamp(a, 0, 1) };
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
// the CSS text the picker writes for a colour
export function formatColor({ r, g, b, a }: Rgba): string {
  const alpha = Math.round(a * 100) / 100;
  return alpha >= 1 ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// The backgrounds the picker paints its parts with, as CSS text: the area (white to the hue across, to black down), the
// hue strip (the hues from 0 to 360) and the alpha strip (clear to the colour).
const pure = (h: number): string => formatColor(hsbToRgb({ h, s: 1, v: 1, a: 1 }));
export function areaBackground(h: number): string {
  const black = formatColor({ r: 0, g: 0, b: 0, a: 1 });
  const white = formatColor({ r: 255, g: 255, b: 255, a: 1 });
  const clear = formatColor({ r: 0, g: 0, b: 0, a: 0 });
  return `linear-gradient(to top, ${black}, ${clear}), linear-gradient(to right, ${white}, ${pure(h)})`;
}
export function hueBackground(): string {
  return `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 359.9].map(pure).join(', ')})`;
}
export function alphaBackground({ r, g, b }: Rgba): string {
  return `linear-gradient(to right, ${formatColor({ r, g, b, a: 0 })}, ${formatColor({ r, g, b, a: 1 })})`;
}

// The channels the picker's formats show (HSB, RGB, Hex, and the alpha in each): a channel's text for a colour, and the
// colour a typed text makes of it, or null for a text out of the channel's range (spec color-picker, Problems in Pager
// 1: hue 0–360, saturation, brightness and alpha 0–100 %, red, green and blue 0–255, whole numbers; six hex digits).
// OKLCH and OKLab (color-picker-oklch): L from 0 to 100 %, C from 0 to 0.5, H from 0 to 360, a and b from -0.5 to 0.5,
// with decimals.
export type ColorChannel = CommandArgs['colorPicker.setChannel']['channel'];
export const FORMAT_CHANNELS: Readonly<Record<string, readonly ColorChannel[]>> = {
  hsb: ['h', 's', 'v', 'alpha'],
  rgb: ['r', 'g', 'b', 'alpha'],
  hex: ['hex', 'alpha'],
  oklch: ['ok-l', 'ok-c', 'ok-h', 'alpha'],
  oklab: ['ok-l', 'ok-a', 'ok-b', 'alpha'],
};
const OK_CHANNELS: readonly ColorChannel[] = ['ok-l', 'ok-c', 'ok-h', 'ok-a', 'ok-b'];
const decimal = (text: string, low: number, high: number): number | null => {
  const typed = text.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(typed)) return null;
  const n = Number(typed);
  return n >= low && n <= high ? n : null;
};
const fixed = (n: number, digits: number) => String(Number(n.toFixed(digits)) + 0);

const whole = (text: string, low: number, high: number): number | null => {
  const typed = text.trim();
  if (!/^-?\d+$/.test(typed)) return null;
  const n = Number(typed);
  return n >= low && n <= high ? n : null;
};
const percent = (n: number): string => String(Math.round(n * 100));

// A channel's text for a colour; OKLCH and OKLab read `exact`, the colour as it is (outside sRGB too), when given.
export function channelText(colour: Rgba, channel: ColorChannel, exact: Srgb | null = null): string {
  const hsb = rgbToHsb(colour);
  const ok = toOklab(exact ?? { r: colour.r / 255, g: colour.g / 255, b: colour.b / 255, a: colour.a });
  switch (channel) {
    case 'ok-l':
      return fixed(ok.l * 100, 2);
    case 'ok-c':
      return fixed(polar(ok.a, ok.b).c, 4);
    case 'ok-h':
      return fixed(polar(ok.a, ok.b).h, 2);
    case 'ok-a':
      return fixed(ok.a, 4);
    case 'ok-b':
      return fixed(ok.b, 4);
    case 'h':
      return String(Math.round(hsb.h));
    case 's':
    case 'v':
      return percent(hsb[channel]);
    case 'r':
    case 'g':
    case 'b':
      return String(colour[channel]);
    case 'hex':
      return formatColor({ ...colour, a: 1 }).slice(1);
    case 'alpha':
      return percent(colour.a);
  }
}

// The alpha a picked colour takes (the user's real-use audit, item 6.5): the alpha the write carries, except that a
// pick that keeps the alpha (a hue, a saturation, a brightness, an RGB channel) writes it opaque when the colour the
// picker shows is fully transparent — rgba(…, 0) over a transparent background would be an invisible colour. A write
// that sets the alpha (its slider, its channel) is kept as written.
export const pickedAlpha = (shown: number, carried: number): number => (carried === shown && shown === 0 ? 1 : carried);

function withChannel(colour: Rgba, channel: ColorChannel, text: string): Rgba | null {
  const hsb = rgbToHsb(colour);
  switch (channel) {
    // a channel of OKLCH or OKLab writes the colour in its space (editedColour), never through RGB
    case 'ok-l':
    case 'ok-c':
    case 'ok-h':
    case 'ok-a':
    case 'ok-b':
      return null;
    case 'h': {
      const n = whole(text, 0, 360);
      return n === null ? null : hsbToRgb({ ...hsb, h: n % 360 });
    }
    case 's':
    case 'v': {
      const n = whole(text, 0, 100);
      return n === null ? null : hsbToRgb({ ...hsb, [channel]: n / 100 });
    }
    case 'r':
    case 'g':
    case 'b': {
      const n = whole(text, 0, 255);
      return n === null ? null : { ...colour, [channel]: n };
    }
    case 'hex': {
      const digits = text.trim().replace(/^#/, '');
      const read = /^[0-9a-f]{6}$/i.test(digits) ? parseColor(`#${digits}`) : null;
      return read === null ? null : { ...read, a: colour.a };
    }
    case 'alpha': {
      const n = whole(text, 0, 100);
      return n === null ? null : { ...colour, a: n / 100 };
    }
  }
}

// The CSS text a channel typed makes of a colour (the CSS text it has, '' for none: opaque black), or null for a text
// out of the channel's range. A channel of HSB, RGB or Hex writes as the picker writes (formatColor); one of OKLCH or
// OKLab writes oklch(L% C H) or oklab(L% a b) (L in the picker's format), with ' / alpha' when it is not opaque, from
// the colour as it is.
export function editedColour(base: string, channel: ColorChannel, text: string, format: string): string | null {
  const exact = parseSrgb(base) ?? { r: 0, g: 0, b: 0, a: 1 };
  // the alpha of a colour shown in OKLCH or OKLab is written in that space, from the colour as it is: through RGB
  // it was clamped to sRGB (the audit's CH1)
  if (channel === 'alpha' && (format === OKLAB || format === OKLCH)) {
    const n = whole(text, 0, 100);
    if (n === null) return null;
    const ok = toOklab(exact);
    const { c, h } = polar(ok.a, ok.b);
    const alpha = n < 100 ? ` / ${fixed(n / 100, 2)}` : '';
    const l = `${fixed(ok.l * 100, 2)}%`;
    return format === OKLAB ? `oklab(${l} ${fixed(ok.a, 4)} ${fixed(ok.b, 4)}${alpha})` : `oklch(${l} ${fixed(c, 4)} ${fixed(h % 360, 2)}${alpha})`;
  }
  if (!OK_CHANNELS.includes(channel)) {
    const edited = withChannel(parseColor(base) ?? { r: 0, g: 0, b: 0, a: 1 }, channel, text);
    const a = channel === 'alpha' ? edited?.a ?? exact.a : pickedAlpha(exact.a, edited?.a ?? exact.a);
    return edited === null ? null : formatColor({ ...edited, a });
  }
  const ok = toOklab(exact);
  const { c, h } = polar(ok.a, ok.b);
  // a channel of OKLCH or OKLab changes the colour, not the alpha: from a transparent one it is written opaque too
  // the alpha channel of OKLCH or OKLab does set the alpha; the others keep it (made opaque from a transparent one)
  // OKLab's a axis is a colour axis like b, never the alpha (CH1)
  const shown = pickedAlpha(exact.a, exact.a);
  const alpha = shown < 1 ? ` / ${fixed(shown, 2)}` : '';
  const lightness = channel === 'ok-l' ? decimal(text, 0, 100) : ok.l * 100;
  if (lightness === null) return null;
  const l = `${fixed(lightness, 2)}%`;
  if (channel === 'ok-a' || channel === 'ok-b') {
    const n = decimal(text, -0.5, 0.5);
    if (n === null) return null;
    return `oklab(${l} ${fixed(channel === 'ok-a' ? n : ok.a, 4)} ${fixed(channel === 'ok-b' ? n : ok.b, 4)}${alpha})`;
  }
  const chroma = channel === 'ok-c' ? decimal(text, 0, 0.5) : c;
  const hue = channel === 'ok-h' ? decimal(text, 0, 360) : h;
  if (chroma === null || hue === null) return null;
  return channel === 'ok-l' && format === OKLAB ? `oklab(${l} ${fixed(ok.a, 4)} ${fixed(ok.b, 4)}${alpha})` : `oklch(${l} ${fixed(chroma, 4)} ${fixed(hue % 360, 2)}${alpha})`;
}
// the format whose L writes oklab(); L in any other writes oklch()
const OKLAB = 'oklab';
const OKLCH = 'oklch';

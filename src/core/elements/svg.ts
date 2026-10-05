// SVG/Icon and its shapes (INVENTORY.md, owners; spec elements-svg-shapes). The one owner of:
//  - element.setSvgMarkup: the markup of the one selected SVG, kept in its svgMarkup attribute once it is SVG markup
//    whose scripts and event attributes are taken away (sanitizedSvgMarkup); the renderer and the export write it as
//    the SVG's content, after its shapes. Markup that is not well formed is refused, naming why (an element never
//    closed, a closing tag that closes none, a broken tag); a locked element keeps
//    its markup (spec lock-element);
//  - the SVG's viewBox (viewBoxOf): its own size, the width and height it declares in px at the base breakpoint and
//    state, so a unit of its drawing is a CSS px and resizing it keeps its shapes where they are (Problems in Pager 2);
//  - the geometry of a shape (Rectangle, Ellipse, Line), its attributes in the SVG's coordinates: where parts.add
//    places a new one (shapeGeometry: inside its SVG, clear of its edges) and what geometry.resize writes for the box
//    its handles give it (resizedShape: Problems in Pager 3). A shape's box is the box its geometry spans (shapeBox),
//    its stroke left out, so the stroke width never changes with it.
// The geometry attributes of each shape are the attributes elements.json gives its type for geometry.resize, in their
// order; how SVG draws each shape from them is SVG's own: a <rect> by its corner and size, an <ellipse> by its centre
// and radii, a <line> by its two ends.
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, type Message, type Outcome } from '../commands/registry.ts';
import { locate, type DocNode } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { lockRefusal } from '../nodes/flags.ts';
import type { ResizeFrom } from '../geometry/resize.ts';

// the value a node holds for an attribute named by its id (elements.json), whatever attribute it is
export const attributeOf = (node: DocNode, id: string): unknown => (node.attributes as Readonly<Record<string, unknown>>)[id];

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ------------------------------------------------------------------ markup

// The elements an SVG's markup keeps: SVG's own (SVG 2's element index, its filter primitives and its animation
// elements), as an allowlist (the way DOMPurify sanitizes SVG). Anything else goes with everything inside it: a script
// or a foreignObject runs code or holds HTML, and an HTML start tag (<p>, <img>, <font>…) ends the SVG when the page's
// HTML parser reads it inline (the HTML Standard's rules for parsing tokens in foreign content), so what followed it
// would be HTML (an <iframe src>, a <form action>): the audit's S1, second reading.
const SVG_ELEMENTS = new Set(
  [
    'a', 'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs', 'desc', 'ellipse', 'feBlend',
    'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap',
    'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage',
    'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile',
    // eslint-disable-next-line builder/no-manifest-id -- SVG element names (the filter element), not CSS properties.
    'feTurbulence', 'filter', 'g', 'image', 'line', 'linearGradient', 'marker', 'mask', 'metadata', 'mpath', 'path',
    'pattern', 'polygon', 'polyline', 'radialGradient', 'rect', 'set', 'stop', 'style', 'svg', 'switch', 'symbol', 'text',
    'textPath', 'title', 'tspan', 'use', 'view',
  ].map((name) => name.toLowerCase()),
);
const LINK_ATTRIBUTES = new Set(['href', 'xlink:href']);
// the attributes of an animation element that write a value at run time: a javascript: one there is a link that runs
// code once played (<set attributeName="href" to="javascript:…">: the audit's S1)
const ANIMATED_VALUES = new Set(['to', 'from', 'values', 'by']);
// The character references an attribute's value may spell its scheme with: the HTML parser decodes them before the
// address runs (java&#115;cript:, javascript&colon;). Numeric ones, with or without their semicolon, and the named ones
// that stand for a colon or a character the URL parser skips (no named reference stands for an ASCII letter).
const NAMED: Readonly<Record<string, string>> = { colon: ':', tab: '\t', newline: '\n' };
const decoded = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);?/gi, (_all, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/&#([0-9]+);?/g, (_all, digits: string) => String.fromCodePoint(Math.min(parseInt(digits, 10), 0x10ffff)))
    .replace(/&(colon|tab|newline);/gi, (all, name: string) => NAMED[name.toLowerCase()] ?? all);
// an address that runs code, whatever its case, its character references and the spaces or control characters in it
// (a browser skips them)
const SCRIPT_SCHEME = 'javascript:';
const scripted = (value: string) =>
  [...decoded(value)]
    .filter((c) => c.charCodeAt(0) > 32)
    .join('')
    .toLowerCase()
    .startsWith(SCRIPT_SCHEME);
const NAME = /^[A-Za-z_][\w:.-]*/;

type Parsed = { readonly markup: string } | { readonly refusal: Message };
const BROKEN: Parsed = { refusal: message('status.svg.broken') };

// A whole <svg> element pasted in is unwrapped: the element it is pasted into is the SVG the person drew in, and a
// doubled <svg> inside an <svg> is not what they pasted it for (the user's real-use audit, A3.6).
function unwrapped(text: string): string {
  const trimmed = text.trim();
  const opening = /^<svg\b[^>]*>/i.exec(trimmed);
  if (opening === null) return text;
  if (opening[0].endsWith('/>')) return trimmed.slice(opening[0].length).trim() === '' ? '' : text;
  const closing = trimmed.lastIndexOf('</svg>');
  if (closing < 0 || trimmed.slice(closing + '</svg>'.length).trim() !== '') return text;
  return trimmed.slice(opening[0].length, closing);
}

// The markup kept of a text of SVG: its elements, attributes and text as written (comments and processing
// instructions left out), with no script, no foreign object, no event attribute (on…) and no address that runs code;
// or why it is no well-formed markup.
export function sanitizedSvgMarkup(text: string): Parsed {
  text = unwrapped(text);
  const out: string[] = [];
  const open: string[] = [];
  // the depth of the element being dropped with its content, 0 when none is
  let dropping = 0;
  let at = 0;
  while (at < text.length) {
    const lt = text.indexOf('<', at);
    const chunk = lt < 0 ? text.slice(at) : text.slice(at, lt);
    if (dropping === 0 && chunk !== '') out.push(chunk.replaceAll('>', '&gt;'));
    if (lt < 0) break;
    at = lt;
    if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4);
      if (end < 0) return BROKEN;
      at = end + 3;
      continue;
    }
    if (text.startsWith('<?', at) || text.startsWith('<!', at)) {
      const end = text.indexOf('>', at);
      if (end < 0) return BROKEN;
      at = end + 1;
      continue;
    }
    if (text.startsWith('</', at)) {
      const name = NAME.exec(text.slice(at + 2))?.[0];
      const end = text.indexOf('>', at);
      if (name === undefined || end < 0 || text.slice(at + 2 + name.length, end).trim() !== '') return BROKEN;
      if (open.at(-1) !== name) return { refusal: message('status.svg.unmatched', { tag: name }) };
      open.pop();
      if (dropping > 0) {
        if (open.length < dropping) dropping = 0;
      } else out.push(`</${name}>`);
      at = end + 1;
      continue;
    }
    // an element's start tag: its name, then its attributes, then > or />
    const name = NAME.exec(text.slice(at + 1))?.[0];
    if (name === undefined) return BROKEN;
    let i = at + 1 + name.length;
    const attributes: string[] = [];
    let closed = false;
    for (;;) {
      while (i < text.length && /\s/.test(text[i] ?? '')) i += 1;
      if (i >= text.length) return BROKEN;
      if (text[i] === '>') break;
      if (text.startsWith('/>', i)) {
        closed = true;
        i += 1;
        break;
      }
      const attribute = NAME.exec(text.slice(i))?.[0];
      if (attribute === undefined) return BROKEN;
      i += attribute.length;
      while (/\s/.test(text[i] ?? '')) i += 1;
      let value = '';
      if (text[i] === '=') {
        i += 1;
        while (/\s/.test(text[i] ?? '')) i += 1;
        const quote = text[i];
        if (quote === '"' || quote === "'") {
          const end = text.indexOf(quote, i + 1);
          if (end < 0) return BROKEN;
          value = text.slice(i + 1, end);
          i = end + 1;
        } else {
          const bare = /^[^\s>"'=<`]+/.exec(text.slice(i))?.[0];
          if (bare === undefined) return BROKEN;
          value = bare;
          i += bare.length;
        }
      }
      const lower = attribute.toLowerCase();
      if (lower.startsWith('on') || ((LINK_ATTRIBUTES.has(lower) || ANIMATED_VALUES.has(lower)) && scripted(value))) continue;
      if (lower === 'values' && value.split(';').some(scripted)) continue;
      attributes.push(` ${attribute}="${value.replaceAll('"', '&quot;').replaceAll('<', '&lt;')}"`);
    }
    at = i + 1;
    if (dropping === 0 && !SVG_ELEMENTS.has(name.toLowerCase())) {
      if (!closed) {
        open.push(name);
        dropping = open.length;
      }
      continue;
    }
    if (!closed) open.push(name);
    if (dropping === 0) out.push(`<${name}${attributes.join('')}${closed ? '/>' : '>'}`);
  }
  const unclosed = open.at(-1);
  if (unclosed !== undefined) return { refusal: message('status.svg.unclosed', { tag: unclosed }) };
  return { markup: out.join('') };
}

const MARKUP = 'svgMarkup';

export const setSvgMarkupCommand = registerHandler('element.setSvgMarkup', ({ state, rules }, { markup }): Outcome<never> => {
  const id: NodeId | undefined = state.selection.length === 1 ? state.selection[0] : undefined;
  if (id === undefined) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const at = locate(state.document, id);
  if (at === null) throw new Error(`element.setSvgMarkup: the document has no node ${id}`);
  const applies = rules.attributes.get(MARKUP);
  if (applies === undefined || (applies !== 'all' && !applies.includes(at.node.type))) return { kind: 'refused', message: message('status.element.notApplicable', { command: { key: 'command.setSvgMarkup' }, name: at.node.name }) };
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const parsed = sanitizedSvgMarkup(String(markup));
  if ('refusal' in parsed) return { kind: 'refused', message: parsed.refusal };
  const said = message('status.svg.set', { name: at.node.name });
  const held = at.node.attributes[MARKUP];
  if ((held ?? '') === parsed.markup) return { kind: 'change', message: said };
  const path = [...at.path, 'attributes', MARKUP];
  if (parsed.markup === '') return { kind: 'change', patches: held === undefined ? [] : [{ op: 'remove', path }], message: said };
  return { kind: 'change', patches: [{ op: held === undefined ? 'add' : 'replace', path, value: parsed.markup }], message: said };
});

// The markup an SVG's node keeps, '' for none, read through the sanitizer: the one reader the canvas and the export
// write it with, so markup that arrived another way (a project file, an older version's rules) never reaches a page
// as it was stored (the audit's S1, second reading). The last answers are kept: the canvas asks at every render.
const SANITIZED = new Map<string, string>();
export const svgMarkupOf = (node: DocNode): string => {
  const held = node.attributes[MARKUP];
  if (typeof held !== 'string' || held === '') return '';
  const known = SANITIZED.get(held);
  if (known !== undefined) return known;
  const read = sanitizedSvgMarkup(held);
  const safe = 'markup' in read ? read.markup : '';
  if (SANITIZED.size > 200) SANITIZED.clear();
  SANITIZED.set(held, safe);
  return safe;
};

// ------------------------------------------------------------------ the SVG's size and viewBox

const PX = /^(\d+(?:\.\d+)?)px$/;

interface SizeRules {
  readonly base: { readonly breakpoint: string; readonly state: string };
  // the properties of a box's size, width then height
  readonly boxSize: readonly string[];
}

// The width and height an SVG declares in px at the base breakpoint and state, or null when it declares no px size.
function svgSize(node: DocNode, rules: SizeRules): { readonly width: number; readonly height: number } | null {
  const declared = (node.styles as Record<string, Record<string, Record<string, string>> | undefined>)[rules.base.breakpoint]?.[rules.base.state] ?? {};
  const [width, height] = rules.boxSize.map((property) => PX.exec(declared[property] ?? '')?.[1]);
  return width === undefined || height === undefined ? null : { width: Number(width), height: Number(height) };
}

// The viewBox of an SVG: its own size, from 0 0; null when it declares no px size.
export function viewBoxOf(node: DocNode, rules: SizeRules): string | null {
  const size = svgSize(node, rules);
  return size === null ? null : `0 0 ${size.width} ${size.height}`;
}

// ------------------------------------------------------------------ shapes

const RECT = 'rect';
const ELLIPSE = 'ellipse';
const LINE = 'line';
const round = (value: number) => Math.round(value * 100) / 100;

// the geometry attributes of a shape's type, in elements.json's order; empty for a type that is no shape
export function geometryAttributes(rules: ModelRules, type: string, resizeCommand: string): readonly string[] {
  return [...rules.attributeValues.entries()].filter(([id, facts]) => {
    const applies = rules.attributes.get(id);
    return facts.command === resizeCommand && applies !== undefined && applies !== 'all' && applies.includes(type);
  }).map(([id]) => id);
}

// The four numbers of a shape's geometry for a box, in its attributes' order, by how SVG draws its tag; `from` (the
// geometry it has) keeps a line's direction.
function geometryFor(tag: string, box: Box, from: readonly number[] | null): readonly number[] | null {
  const { x, y, width, height } = box;
  if (tag === RECT) return [x, y, width, height].map(round);
  if (tag === ELLIPSE) return [x + width / 2, y + height / 2, width / 2, height / 2].map(round);
  if (tag === LINE) {
    const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = from ?? [];
    const leftToRight = x1 <= x2;
    const topToBottom = y1 <= y2;
    return [leftToRight ? x : x + width, topToBottom ? y : y + height, leftToRight ? x + width : x, topToBottom ? y + height : y].map(round);
  }
  return null;
}

// The box a shape's geometry spans, in its SVG's coordinates, or null for a node that is no shape with its geometry.
export function shapeBox(node: DocNode, attributes: readonly string[]): Box | null {
  const values = attributes.map((id) => attributeOf(node, id));
  if (values.length !== 4 || values.some((v) => typeof v !== 'number')) return null;
  const [a, b, c, d] = values as number[] as [number, number, number, number];
  if (node.tag === RECT) return { x: a, y: b, width: c, height: d };
  if (node.tag === ELLIPSE) return { x: a - c, y: b - d, width: 2 * c, height: 2 * d };
  if (node.tag === LINE) return { x: Math.min(a, c), y: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b) };
  return null;
}

// The size a new shape is placed in: the SVG's own px size, else the size its type's default styles give it.
export function sizeForShapes(node: DocNode, rules: ModelRules): { readonly width: number; readonly height: number } | null {
  const defaults = rules.elements.get(node.type)?.defaultStyles ?? {};
  return svgSize(node, rules) ?? svgSize({ ...node, styles: { [rules.base.breakpoint]: { [rules.base.state]: defaults } } } as DocNode, rules);
}

// Where a new shape of a tag goes in an SVG of a size: its box an eighth of the smaller side in from every edge.
export function shapeGeometry(tag: string, attributes: readonly string[], size: { readonly width: number; readonly height: number }): Readonly<Record<string, number>> {
  const inset = Math.round(Math.min(size.width, size.height) / 8);
  const box = { x: inset, y: inset, width: size.width - 2 * inset, height: size.height - 2 * inset };
  // a new line runs from the bottom left to the top right
  const values = geometryFor(tag, box, tag === LINE ? [0, 1, 1, 0] : null) ?? [];
  return Object.fromEntries(attributes.map((id, i) => [id, values[i] ?? 0]));
}

// What a handle's drag starts from on a shape (geometry.resize's resizedBox): the box its geometry spans, placed like a
// positioned element's, so a west or north handle moves its corner; null for a node that is no shape.
export function shapeResizeFrom(node: DocNode, attributes: readonly string[]): ResizeFrom | null {
  const box = shapeBox(node, attributes);
  return box === null ? null : { width: box.width, height: box.height, extraX: 0, extraY: 0, contentBox: false, positioned: true, left: box.x, top: box.y };
}

// The geometry attributes of a shape resized to a box (geometry.resize), or null for a node that is no shape.
export function resizedShape(node: DocNode, attributes: readonly string[], box: Box): Readonly<Record<string, number>> | null {
  const from = attributes.map((id) => attributeOf(node, id));
  const values = geometryFor(node.tag ?? '', box, from.every((v) => typeof v === 'number') ? (from as number[]) : null);
  return values === null ? null : Object.fromEntries(attributes.map((id, i) => [id, values[i] ?? 0]));
}

// The page's output (PRODUCT.md §5): the one owner of what the page writes, on the canvas (render.ts) and in the
// export (core/export/export.ts): the manifest data both need (OutputModel), a node's CSS (nodeCss) and the HTML
// attributes of its element (elementAttributes). No class and no DOM: every tool can load it.
import type { ElementsFile, PropertiesFile } from '../../manifest/schema.ts';
import type { DocNode, StyleClass } from '../document/model.ts';
import { compactDeclarations, type Composite } from './clean.ts';
import { codecOf } from '../style/codecs.ts';
import { buttonKind, pageLanguage } from '../export/names.ts';
import { isPageSetting } from '../page/settings.ts';
import { viewBoxOf } from '../elements/svg.ts';

// The manifest data the page's output needs, on the canvas and in the export: the elements, their attributes' HTML
// names, the breakpoints, the states' pseudo-classes and the recipes.
export interface OutputModel {
  readonly composites?: readonly Composite[];
  readonly elements: ReadonlyMap<string, { readonly namespace: 'html' | 'svg'; readonly content: 'children' | 'text' | 'markup' | 'none' }>;
  // attribute id → its HTML attribute name, or null when it is not one (the text, the tag)
  readonly attributes: ReadonlyMap<string, string | null>;
  // attribute id → the element types it applies to, or "all" (a setting of the page applies to a page root's alone)
  readonly appliesTo: ReadonlyMap<string, readonly string[] | 'all'>;
  // the breakpoints in cascade order: the base first, with no media query
  readonly breakpoints: readonly { readonly id: string; readonly width: number; readonly base: boolean }[];
  // state id → its pseudo-class (or pseudo-element) and the element types it stands on (elements.json; null for every
  // one): a rule a browser would ignore is never written (A3.36)
  readonly states: ReadonlyMap<string, { readonly pseudo: string | null; readonly elements: readonly string[] | null }>;
  // recipe id → its declarations; a null value is the stored value
  readonly recipes: ReadonlyMap<string, readonly { readonly property: string; readonly value: string | null }[]>;
  // property → the fields of its structured value, in order, and how each reaches CSS (properties.json structures)
  readonly structures: ReadonlyMap<string, readonly { readonly id: string; readonly css: 'value' | 'keyword' | 'hides-layer'; readonly keyword: string | null }[]>;
  // the base breakpoint and state, and the properties of a box's size (width, height): an SVG's viewBox is its size
  readonly base: { readonly breakpoint: string; readonly state: string };
  readonly boxSize: readonly string[];
}

const SVG_TAG = 'svg';
const VIEW_BOX = 'viewBox';
// a media part (a <source> or a <track> the person added): HTML writes it only with an address (the audit's A3.6)
const MEDIA_PART_TAGS = new Set(['source', 'track']);
const ADDRESSES = ['src', 'srcset'];

// Whether an element of the page's HTML is written at all, on the canvas and in the export alike: a media part with no
// address is a draft (a Source or Track the person added and did not fill yet) — it stays in the document and in its
// parts editor, and nothing of it reaches the page (the user's real-use audit, A3.6). An image is never dropped: an
// <img> with no source draws its own alternative text (alt=""), the browser's own fallback, which the export keeps.
export function writesNode(node: DocNode, model: OutputModel): boolean {
  const tag = node.tag ?? '';
  if (!MEDIA_PART_TAGS.has(tag)) return true;
  return Object.entries(node.attributes).some(([id, value]) => {
    const name = model.attributes.get(id);
    return name !== null && name !== undefined && ADDRESSES.includes(name) && String(value ?? '') !== '';
  });
}

// The properties of a box's size, width then height: those the size section of properties.json summarises.
const SIZE_SECTION = 'size';
export const boxSizeOf = (properties: PropertiesFile): readonly string[] => properties.sections.find((s) => s.id === SIZE_SECTION)?.summary ?? [];

// A stylesheet's own addresses, resolved: every url(…) an address names goes through the resolver, the way an
// element's source attribute does (files.ts resolvedSource) — the canvas draws a project file through its object URL,
// since it holds the bytes and has no folder to fetch a path from, while the published stylesheet keeps the path.
export function fileUrlsIn(css: string, resolve: (address: string) => string | null): string {
  return css.replace(/url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")]*))\s*\)/g, (all, single: string | undefined, double: string | undefined, bare: string | undefined) => {
    const address = (single ?? double ?? bare ?? '').trim();
    if (address === '') return all;
    const resolved = resolve(address);
    return resolved === null || resolved === address ? all : `url("${resolved}")`;
  });
}

export function outputModelFromManifest(elements: ElementsFile, properties: PropertiesFile): OutputModel {
  return {
    elements: new Map(elements.elements.map((e) => [e.id, { namespace: e.namespace, content: e.content }])),
    attributes: new Map(elements.attributes.map((a) => [a.id, a.html])),
    appliesTo: new Map(elements.attributes.map((a) => [a.id, a.elements])),
    breakpoints: properties.breakpoints.map((b) => ({ id: b.id, width: b.width, base: b.base })),
    states: new Map(properties.states.map((s) => [s.id, { pseudo: s.pseudo, elements: s.elements }] as const)),
    base: { breakpoint: properties.breakpoints.find((b) => b.base)?.id ?? '', state: properties.states[0]?.id ?? '' },
    boxSize: boxSizeOf(properties),
    composites: properties.composites.flatMap(c => c.shorthand === null ? [] : [{ shorthand: c.shorthand, longhands: c.longhands, codec: c.codec, compose: codecOf(c.codec)?.compose }]),
    recipes: new Map(properties.recipes.map((r) => [r.id, r.declarations])),
    structures: new Map(
      properties.properties.flatMap((p) => {
        const structure = properties.structures.find((s) => s.id === p.valueType);
        return structure === undefined ? [] : [[p.id, structure.fields.map((f) => ({ id: f.id, css: f.css, keyword: f.keyword }))] as const];
      }),
    ),
  };
}

// The CSS of one node: every declaration of every breakpoint and state it stores, for the selector given; each rule on
// one line for the canvas, or, laid out as a stylesheet a person reads (the export), one declaration per line indented
// by two spaces.
// The units the canvas resolves itself (the user's real-use audit, item 2.3): the page inside the editor's frame takes
// the breakpoint's screen as its viewport, so vh, svh, dvh and lvh measure that screen — what the site shows in a
// window of the breakpoint's size — wherever a value writes them, while the export keeps the units the person typed. vw
// and its siblings need no rewriting: the frame is exactly the breakpoint wide.
const VIEWPORT_HEIGHT = new RegExp('(^|[^a-z0-9.-])(-?(?:[0-9]+[.]?[0-9]*|[.][0-9]+))(svh|dvh|lvh|vh)(?![a-z])', 'gi');
function viewportUnits(text: string, screen: { readonly height: number }): string {
  return text.replace(VIEWPORT_HEIGHT, (_all, before: string, n: string) => `${before}${Math.round((Number(n) * screen.height) / 100 * 100) / 100}px`);
}

// The media query a breakpoint's rules are written in: desktop-first, the breakpoint's width as the widest it covers.
// One writer for the node rules and for the export's cascade order (export.ts, clean.ts cascadeOrder).
export function mediaQuery(breakpoint: { readonly width: number }): string {
  return `@media (max-width: ${breakpoint.width}px)`;
}

export function nodeCss(node: Pick<DocNode, 'styles'> & { readonly type?: string }, selector: string, model: OutputModel, layout: 'line' | 'block' = 'line', screen: { readonly height: number } | null = null, extra: readonly string[] = []): string {
  const blocks: string[] = [];
  for (const breakpoint of model.breakpoints) {
    const byState = node.styles[breakpoint.id as keyof DocNode['styles']];
    // a base rule an animation adds to: written even where the element holds no value of its own (spec
    // export-keyframes)
    if (!byState && !(breakpoint.base && extra.length > 0)) continue;
    const rules: string[] = [];
    for (const [state, details] of model.states) {
      const declarations = byState?.[state as keyof typeof byState];
      const added = breakpoint.base && details.pseudo === null ? extra : [];
      if (!declarations && added.length === 0) continue;
      // a state the element does not stand on writes nothing, however it was stored (A3.36: no :disabled on an h2); a
      // class holds no type of its own and writes what it holds
      if (details.elements !== null && node.type !== undefined && !details.elements.includes(node.type)) continue;
      const pseudo = details.pseudo;
      const lines = declarationLines(declarations ?? {}, model, layout, screen).concat(added);
      if (lines.length === 0) continue;
      const indent = breakpoint.base ? '' : '  ';
      rules.push(layout === 'line' ? `${selector}${pseudo ?? ''} { ${lines.join(' ')} }` : `${indent}${selector}${pseudo ?? ''} {\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`);
    }
    if (rules.length === 0) continue;
    blocks.push(breakpoint.base ? rules.join('\n') : `${mediaQuery(breakpoint)} {\n${rules.join('\n')}\n}`);
  }
  return blocks.join('\n');
}

// The declarations of one layer's values as CSS lines ("width: 240px;"), in the order they are stored: a recipe by its
// own declarations, a structured value (a shadow's layers) by its writer, everything else its stored text; the units
// the canvas resolves itself (vh, svh, dvh, lvh) as the screen the page takes. The one writer of a declarations
// object, read by the node rules and by an animation's keyframes (core/animation/animation.ts keyframesCss).
export function declarationLines(
  declarations: Readonly<Record<string, unknown>>,
  model: OutputModel,
  layout: 'line' | 'block' = 'line',
  screen: { readonly height: number } | null = null,
): string[] {
  const lines = Object.entries(declarations).flatMap(([property, value]) => {
    const recipe = model.recipes.get(property);
    if (recipe) return recipe.map((d) => `${d.property}: ${d.value ?? String(value)};`);
    const fields = model.structures.get(property);
    if (fields !== undefined && Array.isArray(value)) return [`${property}: ${structuredCss(value as readonly Readonly<Record<string, string | boolean>>[], fields)};`];
    return [`${property}: ${screen === null ? String(value) : viewportUnits(String(value), screen)};`];
  });
  return layout === 'block' ? compactDeclarations(lines, model.composites ?? []) : lines;
}

// The project's style classes as their rules (spec shared-style-classes): each class that holds styles, in the
// project's order, its selector the class; the canvas and the export write them before every element's rules, so an
// element's own values, of the same specificity, override them.
export function classesCss(classes: readonly StyleClass[], model: OutputModel, layout: 'line' | 'block' = 'line'): string {
  return classes
    .map((c) => nodeCss(c, `.${c.name}`, model, layout))
    .filter((css) => css !== '')
    .join(layout === 'line' ? '\n' : '\n\n');
}

// The CSS of a structured value (a shadow's layers): each layer that is not hidden, its fields in their structure's
// order (a value as it is stored, a flag as its keyword while it is on), the layers separated by commas; none when no
// layer shows.
export function structuredCss(layers: readonly Readonly<Record<string, string | boolean>>[], fields: readonly { readonly id: string; readonly css: 'value' | 'keyword' | 'hides-layer'; readonly keyword: string | null }[]): string {
  const shown = layers.filter((layer) => !fields.some((f) => f.css === 'hides-layer' && layer[f.id] === true));
  if (shown.length === 0) return 'none';
  return shown
    .map((layer) =>
      fields
        .flatMap((f) => {
          const v = layer[f.id];
          if (f.css === 'value') return typeof v === 'string' ? [v] : [];
          if (f.css === 'keyword') return v === true && f.keyword !== null ? [f.keyword] : [];
          return [];
        })
        .join(' '),
    )
    .join(', ');
}

// The HTML attributes of a node's element as the page writes them, on the canvas and in the export (the editor's own
// marks apart): its classes, its attributes by their HTML names (never an event attribute; a link's address and tab
// only on an <a>; a new tab as target _blank with rel noopener noreferrer), and the person's own attributes (never
// over one of the model's). On the page root, the settings of the page go to the page's <html> (page).
export function elementAttributes(
  node: DocNode,
  tag: string,
  root: boolean,
  model: OutputModel,
  // how a stored value is written (a project file as its object URL on the canvas, a reference as the target's id
  // attribute): null writes nothing at all (a reference whose target holds no id; core/elements/references.ts)
  resolve: (name: string, value: string) => string | null = (_name, value) => value,
  context: { readonly language?: string; readonly inForm?: boolean } = {},
): { readonly element: Map<string, string | true>; readonly page: Map<string, string> } {
  const element = new Map<string, string | true>();
  const page = new Map<string, string>();
  if (node.classes.length > 0) element.set('class', node.classes.join(' '));
  for (const [id, value] of Object.entries(node.attributes)) {
    const name = model.attributes.get(id);
    if (name === null || name === undefined || name.startsWith('on') || value === false) continue;
    // a link switched to a button keeps its address and tab in the document, for when it is switched back, but a
    // button is no link
    if ((name === 'href' || name === 'target') && tag !== 'a') continue;
    if (name === 'target' && value === true) {
      element.set('target', '_blank');
      element.set('rel', 'noopener noreferrer');
      continue;
    }
    // a boolean attribute is written by its name alone (true); a text attribute with an empty value keeps its ""
    const written = value === true ? true : resolve(name, String(value));
    if (written === null) continue;
    (root && isPageSetting(model.appliesTo.get(id), node.type) ? page : element).set(name, written);
  }
  for (const [name, value] of Object.entries(node.customAttributes ?? {})) if (!element.has(name)) element.set(name, value);
  if (root) page.set('lang', pageLanguage(page.get('lang'), context.language));
  if (tag === 'button') element.set('type', buttonKind(element.get('type'), context.inForm === true, typeof element.get('form') === 'string' && element.get('form') !== ''));
  // an input says its type, the HTML default "text" included, as a button does (html-validate no-implicit-input-type;
  // the audit's AUD-22)
  if (tag === 'input' && !element.has('type')) element.set('type', 'text');
  // an SVG draws in its own size: a unit of its drawing is a CSS px (spec elements-svg-shapes, Problems in Pager 2)
  const viewBox = tag === SVG_TAG ? viewBoxOf(node, model) : null;
  if (viewBox !== null) element.set(VIEW_BOX, viewBox);
  return { element, page };
}


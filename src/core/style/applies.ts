// Which elements a property applies to (PRODUCT.md §5; spec props-element-specific). properties.json names, for every
// property, the predicate of the elements it applies to (appliesTo); the element predicates are this module's:
//  - the kinds, read from the tag the element is written with (a switched tag counts): table; tableOrCaption (a table
//    or its caption); list (ul, ol, menu and li); media (the replaced elements the object properties act on: img,
//    video, canvas and iframe); textarea; formControl (input, textarea, select, button, progress and meter); textInput
//    (input and textarea). A field of a kind is shown only while every selected element is of that kind
//    (KIND_PREDICATES).
//  - what an element holds (elements.json): text (it holds text), svgShape (an SVG shape), hasBox (not one). The quick
//    panel, compact, leaves out the text fields of an element that holds no text and the box fields of an SVG shape;
//    the inspector keeps them (a text property set on a container is inherited by the text inside).
// Every other predicate (always, a flex container's) reads more than the element: elementPredicate answers null for it.
import type { DocNode } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';

// the tags each kind of element is written with
const KINDS: Readonly<Record<string, readonly string[]>> = {
  table: ['table'],
  tableOrCaption: ['table', 'caption'],
  list: ['ul', 'ol', 'menu', 'li'],
  media: ['img', 'video', 'canvas', 'iframe'],
  textarea: ['textarea'],
  formControl: ['input', 'textarea', 'select', 'button', 'progress', 'meter'],
  textInput: ['input', 'textarea'],
};
const SVG = 'svg';
// the predicate of an element in the SVG namespace (HOLDS below); an SVG field is shown only on one
const SVG_SHAPE = 'svgShape';
// what an element of a type holds and its namespace
const HOLDS: Readonly<Record<string, (element: { readonly content: string; readonly namespace: string; readonly tags?: readonly (string | null)[] }) => boolean>> = {
  // an element that holds text of its own: a heading, a paragraph, a link's text. A container and a void element (an
  // image, a rule) hold none, so a text field is offered on neither (spec quick-panel, "a section holds no text of
  // its own"; the user's real-use audit, 5.1: an image showed the whole Text group)
  text: (element) => element.content === 'text',
  // an SVG shape, or the <svg> element itself: what it paints is inherited by the shapes inside it (the user's order,
  // item 5.1, "SVG só em SVG"). An HTML element, whatever it is, takes no fill.
  svgShape: (element) => element.namespace === SVG || (element.tags ?? []).includes(SVG),
  hasBox: (element) => element.namespace !== SVG,
};

// the predicates that name a kind of element: a field of one is shown only on elements of that kind
const KIND_PREDICATES: ReadonlySet<string> = new Set(Object.keys(KINDS));

// the tag a node is written with: its own, else its type's
const tagOf = (node: DocNode, rules: ModelRules): string | null => node.tag ?? rules.elements.get(node.type)?.tags[0] ?? null;

// Whether an element predicate holds for a node; null when the predicate is not an element predicate.
export function elementPredicate(predicate: string, node: DocNode, rules: ModelRules): boolean | null {
  const tags = KINDS[predicate];
  if (tags !== undefined) {
    const tag = tagOf(node, rules);
    return tag !== null && tags.includes(tag);
  }
  const holds = HOLDS[predicate];
  if (holds === undefined) return null;
  const element = rules.elements.get(node.type);
  return element !== undefined && holds(element);
}

// The context the layout predicates read (spec props-element-specific, "Our rule"): what the page computes for the
// selected element and for its parent, keyed by the manifest's own names in their camelCase form (properties.json
// `context`), plus whether the element draws a CSS box. Null where the editor cannot read them (the page is not drawn,
// no parent above the page root): a field of a context predicate shows then, so a value is never unreachable because a
// measurement was late.
type ContextValues = Readonly<Record<string, string | undefined>>;
export interface ElementContext {
  readonly box: boolean;
  readonly own: ContextValues;
  readonly parent: ContextValues | null;
}

// a computed display holds a keyword, in either of its forms ("inline flow-root" and "inline-block" both hold inline)
const has = (value: string, word: string): boolean => value.includes(word);
// a display that lays out content in the flow, or that takes part in fragmentation
const blockish = (display: string): boolean => !has(display, 'inline') && display !== 'contents' && display !== 'none';
// a scroll container: overflow on either axis is not visible
const scrolls = (x: string, y: string): boolean => x !== 'visible' || y !== 'visible';
// a transformable element: it draws a box and is not a bare inline (transform-box, perspective-origin, transform-style
// and backface-visibility act there)
const transformable = (box: boolean, display: string): boolean => box && display !== 'inline' && display !== 'contents' && display !== 'none';

// Whether a context predicate holds for this context; null when the predicate is not one of the context's (the caller
// shows the field then, as it does for an unknown context).
export function contextPredicate(predicate: string, context: ElementContext | null): boolean | null {
  if (context === null) return null;
  const own = context.own;
  const parent = context.parent;
  const display = own.display ?? '';
  const parentShows = (word: string): boolean | null => (parent === null || parent.display === undefined ? null : has(parent.display, word));
  switch (predicate) {
    case 'flexContainer':
      return has(display, 'flex');
    case 'gridContainer':
      return has(display, 'grid');
    case 'flexOrGridContainer':
      return has(display, 'flex') || has(display, 'grid');
    case 'container':
      return context.box && blockish(display);
    case 'fragmented':
      return blockish(display);
    case 'positioned':
      return (own.position ?? '') !== 'static';
    case 'staticBox':
      return own.position === 'static';
    case 'multicol':
      return (own.columnCount ?? 'auto') !== 'auto' || (own.columnWidth ?? 'auto') !== 'auto';
    case 'scrollContainer':
      return scrolls(own.overflowX ?? 'visible', own.overflowY ?? 'visible');
    case 'transformed':
    case 'perspectiveContext':
      return transformable(context.box, display);
    case 'inlineOrCell':
      return has(display, 'inline') || has(display, 'table-cell');
    case 'flexItem':
      return parentShows('flex');
    case 'gridItem':
      return parentShows('grid');
    case 'flexOrGridItem':
      return parent === null || parent.display === undefined ? null : has(parent.display, 'flex') || has(parent.display, 'grid');
    case 'snapChild':
      return parent === null || parent.display === undefined
        ? null
        : scrolls(parent.overflowX ?? 'visible', parent.overflowY ?? 'visible') && (parent.scrollSnapType ?? 'none') !== 'none';
    default:
      return null;
  }
}

// the predicate of the elements a property or a recipe applies to (properties.json: the line clamp, a text's), or null
// for anything else
export const appliesToOf = (property: string, rules: ModelRules): string | null => rules.propertyFacts.get(property)?.appliesTo ?? rules.recipeFacts.get(property)?.appliesTo ?? null;

// Whether a field of these properties shows for a selection in this context (the inspector and the quick panel): each
// kind property is of a kind of the selection (shownForKinds) and each context property's context holds.
export function shownForContext(properties: readonly string[], context: ElementContext | null, rules: ModelRules): boolean {
  return properties.every((property) => {
    const predicate = appliesToOf(property, rules);
    return predicate === null || contextPredicate(predicate, context) !== false;
  });
}

// The predicates that decide a field's kind: the tags above and the SVG shape. An SVG field (fill, stroke,
// stroke-width) is shown only on an SVG element — the user's order, item 5.1 ("SVG só em SVG"): a fill written on a
// paragraph paints nothing, so its field is not offered.
//
// What an element *holds* narrows the *Essentials* a type shows and the quick panel's own fields (quick-panel.ts
// trims them itself, spec quick-panel: "a section holds no text of its own"), never the inspector's Style tab, which
// keeps a text field on a container — the text inside inherits it — and on a form control, whose value wears it.
// Hiding a text field there was what left the styles a scenario writes on a container untypable (props-typography,
// state-styles). A box field, though, reads the element's own box, so it stays a kind: a rule takes none.
const KIND_FILTERS: ReadonlySet<string> = new Set([...KIND_PREDICATES, 'hasBox', SVG_SHAPE]);

// The kinds every node is of, in KINDS' order; none for no node.
export function kindsOf(nodes: readonly DocNode[], rules: ModelRules): readonly string[] {
  if (nodes.length === 0) return [];
  return [...KIND_FILTERS].filter((kind) => nodes.every((node) => elementPredicate(kind, node, rules) === true));
}

// Whether a field of these properties shows for a selection of these kinds (kindsOf): each property of a kind is of
// one of them; a property of any other predicate shows.
export function shownForKinds(properties: readonly string[], kinds: readonly string[], rules: ModelRules): boolean {
  return properties.every((property) => {
    const predicate = appliesToOf(property, rules);
    return predicate === null || !KIND_FILTERS.has(predicate) || kinds.includes(predicate);
  });
}


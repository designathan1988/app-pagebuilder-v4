// Coordinates under zoom (PRODUCT.md §5): the one place that converts between the page (the page's CSS pixels
// inside the iframe, from the top-left of the page, scroll included), the frame (the iframe's viewport: the page's
// CSS pixels from its visible top-left) and the screen (the editor window's client pixels). The iframe is scaled with
// the standard CSS zoom, so one page pixel is `zoom` screen pixels; its layout keeps the breakpoint's width.
import type { ResizeRoom } from '../../core/geometry/resize.ts';
import { NODE_ATTRIBUTE, nodeSelector } from './render/render.ts';
import type { Layout } from '../../core/ports/layout.ts';
import type { NodeId } from '../../generated/commands.ts';
import { compareSpecificity, specificityOf, splitSelectorList, type Specificity } from '../../core/import/selectors.ts';
import { browserLineWidth } from './browser-defaults.ts';
import { pageVersion } from './page-clock.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

// Where the frame sits on the screen, its zoom, and how far its page is scrolled.
export interface FrameGeometry {
  // the screen position of the iframe's content box
  readonly left: number;
  readonly top: number;
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

export function screenToFrame(point: Point, g: FrameGeometry): Point {
  return { x: (point.x - g.left) / g.zoom, y: (point.y - g.top) / g.zoom };
}

export function frameToScreen(point: Point, g: FrameGeometry): Point {
  return { x: g.left + point.x * g.zoom, y: g.top + point.y * g.zoom };
}

// The screen point of a point in the frame's own viewport: an HTML5 drag over the frame reports its own coordinates
// (spec explorer-assets-use), and every measurement here works on the screen's.
export function framePointOnScreen(iframe: HTMLIFrameElement, inside: Point): Point | null {
  const g = geometryOf(iframe);
  return g === null ? null : frameToScreen(inside, g);
}

export function frameToPage(point: Point, g: FrameGeometry): Point {
  return { x: point.x + g.scrollX, y: point.y + g.scrollY };
}

export function pageToFrame(point: Point, g: FrameGeometry): Point {
  return { x: point.x - g.scrollX, y: point.y - g.scrollY };
}

export function screenToPage(point: Point, g: FrameGeometry): Point {
  return frameToPage(screenToFrame(point, g), g);
}

export function pageToScreen(point: Point, g: FrameGeometry): Point {
  return frameToScreen(pageToFrame(point, g), g);
}

// The geometry of an iframe now. Its zoom is its effective CSS zoom (its own and its ancestors', Chrome 128+), exact
// where a ratio of rounded offset sizes is not. Its box on the screen is already zoomed; its computed border and
// padding are not (the border as Chrome snaps it to whole screen pixels), so they are zoomed to reach the content box.
export function geometryOf(iframe: HTMLIFrameElement): FrameGeometry | null {
  const win = iframe.contentWindow;
  const zoom = iframe.currentCSSZoom;
  const box = iframe.getBoundingClientRect();
  if (!win || !iframe.contentDocument || !(zoom > 0) || box.width === 0) return null;
  const style = getComputedStyle(iframe);
  const left = box.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoom;
  const top = box.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoom;
  return { left, top, zoom, scrollX: win.scrollX, scrollY: win.scrollY };
}

// The element of the page under a screen point, or null outside the frame's viewport (a scrollbar is not the page).
export function elementAt(iframe: HTMLIFrameElement, point: Point): Element | null {
  const g = geometryOf(iframe);
  const doc = iframe.contentDocument;
  // a page between two documents (the frame reloading) has no root element yet: nothing is under the point
  if (!g || !doc?.documentElement) return null;
  const f = screenToFrame(point, g);
  if (f.x < 0 || f.y < 0 || f.x >= doc.documentElement.clientWidth || f.y >= doc.documentElement.clientHeight) return null;
  return doc.elementFromPoint(f.x, f.y);
}

// The screen box of a page element: its frame box, scaled and placed.
export function screenBox(iframe: HTMLIFrameElement, element: Element): { x: number; y: number; width: number; height: number } | null {
  const g = geometryOf(iframe);
  if (!g) return null;
  const r = element.getBoundingClientRect();
  const topLeft = frameToScreen({ x: r.left, y: r.top }, g);
  return { x: topLeft.x, y: topLeft.y, width: r.width * g.zoom, height: r.height * g.zoom };
}

// The screen box inside a node's borders (its padding box), and whether one node's element holds another's: what the
// canvas measures a selection's distances to an ancestor's inner edges from (spec hover-measure).
export function innerBox(iframe: HTMLIFrameElement, id: string): { x: number; y: number; width: number; height: number } | null {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  const g = geometryOf(iframe);
  const box = element ? screenBox(iframe, element) : null;
  const style = element ? iframe.contentWindow?.getComputedStyle(element) : undefined;
  if (!box || !g || !style) return null;
  const px = (value: string) => (parseFloat(value) || 0) * g.zoom;
  const [left, top, right, bottom] = [px(style.borderLeftWidth), px(style.borderTopWidth), px(style.borderRightWidth), px(style.borderBottomWidth)];
  return { x: box.x + left, y: box.y + top, width: box.width - left - right, height: box.height - top - bottom };
}
export function holdsNode(iframe: HTMLIFrameElement, ancestor: string, id: string): boolean {
  const doc = iframe.contentDocument;
  const outer = doc?.querySelector(nodeSelector(ancestor as NodeId));
  const inner = doc?.querySelector(nodeSelector(id as NodeId));
  return outer != null && inner != null && outer !== inner && outer.contains(inner);
}

// The node under a screen point: the deepest page element there that stands for a node (data-node, written by the
// renderer), or the page root where no element is (the page's own background); null outside the frame's viewport.
// The editor learns which node, never the element: only the renderer writes the page (lint rule builder/frame-owner).
export function nodeAt(iframe: HTMLIFrameElement, point: Point): { readonly node: string; readonly root: boolean } | null {
  const hit = elementAt(iframe, point);
  if (!hit) return null;
  const body = hit.ownerDocument.body;
  const owner = hit.closest(`[${NODE_ATTRIBUTE}]`) ?? body;
  const node = owner?.getAttribute(NODE_ATTRIBUTE) ?? null;
  return node === null ? null : { node, root: owner === body };
}

// A captured page's element under a screen point (its canvas copy wears data-capture-node, spec capture-url): its
// captured id, or null where the point is on no captured element.
export function capturedNodeAt(iframe: HTMLIFrameElement, point: Point): string | null {
  return elementAt(iframe, point)?.closest('[data-capture-node]')?.getAttribute('data-capture-node') ?? null;
}

// The screen box and tag of a captured element by its captured id, or null when the canvas does not draw it.
export function capturedBox(iframe: HTMLIFrameElement, id: string): { readonly box: { x: number; y: number; width: number; height: number }; readonly tag: string } | null {
  const element = iframe.contentDocument?.querySelector(`[data-capture-node="${CSS.escape(id)}"]`) ?? null;
  const box = element === null ? null : screenBox(iframe, element);
  return element === null || box === null ? null : { box, tag: element.localName };
}

// Every node under a screen point, the deepest first, the page root last (a drag looks past the dragged element to
// what lies under it); empty outside the frame's viewport.
export function nodesUnder(iframe: HTMLIFrameElement, point: Point): string[] {
  const g = geometryOf(iframe);
  const doc = iframe.contentDocument;
  if (!g || !doc?.documentElement) return [];
  const f = screenToFrame(point, g);
  if (f.x < 0 || f.y < 0 || f.x >= doc.documentElement.clientWidth || f.y >= doc.documentElement.clientHeight) return [];
  const nodes: string[] = [];
  for (const element of doc.elementsFromPoint(f.x, f.y)) {
    const owner = element.closest(`[${NODE_ATTRIBUTE}]`) ?? doc.body;
    const node = owner?.getAttribute(NODE_ATTRIBUTE) ?? null;
    if (node !== null && !nodes.includes(node)) nodes.push(node);
  }
  return nodes;
}

// The axis a node lays its children along (spec drag-reorder-canvas, "Hit zones" and Problems in Pager 5): a grid
// along its auto-flow (rows: "x", columns: "y"), a flex along its direction, any other container along "x" when every
// child is inline-level (buttons side by side), else "y" (block flow). Its lines (rows along x, columns along y) are
// read from the children's boxes (core/geometry/lines.ts).
export function flowAxis(iframe: HTMLIFrameElement, id: string): 'x' | 'y' {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  const view = iframe.contentWindow;
  if (!element || !view) return 'y';
  const style = view.getComputedStyle(element);
  if (style.display.includes('grid')) return style.gridAutoFlow.startsWith('column') ? 'y' : 'x';
  if (style.display.includes('flex')) return style.flexDirection.startsWith('column') ? 'y' : 'x';
  const children = [...element.children].filter((c) => c.hasAttribute(NODE_ATTRIBUTE));
  return children.length > 0 && children.every((c) => view.getComputedStyle(c).display.startsWith('inline')) ? 'x' : 'y';
}

// Whether a node shows its children against the document's order along its flow (a row-reverse or column-reverse
// flex): before a child as shown is after it in the document (spec drag-reorder-canvas, Problems in Pager 5).
export function flowReversed(iframe: HTMLIFrameElement, id: string): boolean {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  const view = iframe.contentWindow;
  if (!element || !view) return false;
  const style = view.getComputedStyle(element);
  return style.display.includes('flex') && style.flexDirection.endsWith('-reverse');
}

// Whether a node lays its children out itself, a flex or a grid (spec drag-reorder-canvas, Problems in Pager 6: over
// one of its children the drop stays in it).
export function laysOut(iframe: HTMLIFrameElement, id: string): boolean {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  const view = iframe.contentWindow;
  if (!element || !view) return false;
  const display = view.getComputedStyle(element).display;
  return display.includes('flex') || display.includes('grid');
}

// The flow a node lays its children in, for a side drop (spec drag-layout, row 5): vertical (block, or a column flex),
// horizontal (a row flex that does not wrap), or null where children are not laid one after another along one line
// (a grid, a wrapping flex).
export function sideFlow(iframe: HTMLIFrameElement, id: string): 'vertical' | 'horizontal' | null {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  const view = iframe.contentWindow;
  if (!element || !view) return null;
  const style = view.getComputedStyle(element);
  if (style.display.includes('grid')) return null;
  if (!style.display.includes('flex')) return 'vertical';
  if (style.flexWrap !== 'nowrap') return null;
  return style.flexDirection.startsWith('column') ? 'vertical' : 'horizontal';
}

// Scrolls the canvas's page by a distance in screen pixels (the drag's autoscroll); whether it moved.
export function scrollPage(iframe: HTMLIFrameElement, screen: number): boolean {
  const view = iframe.contentWindow;
  const g = geometryOf(iframe);
  if (!view || !g) return false;
  const before = view.scrollY;
  view.scrollBy(0, screen / g.zoom);
  return view.scrollY !== before;
}

// A new zoom keeps the page point `at` screen px below the view's top there (spec zoom-keyboard-buttons: the middle of
// the view; zoom-wheel-pan: the pointer).
export function keepPagePoint(iframe: HTMLIFrameElement, before: number, after: number, at: number): void {
  const view = iframe.contentWindow;
  if (!view || before <= 0 || after <= 0) return;
  const point = view.scrollY + at / before;
  view.scrollTo(view.scrollX, point - at / after);
}

// What a resize starts from (spec resize-handles; items 4.2 and A3.16): the element's border box in CSS px, what its
// padding and border add to its content on each axis (the width and height it declares measure its content under
// content-box), whether it is positioned out of the flow (absolute or fixed: its left and top move with a west or
// north handle) and its computed left and top; plus what its parent allows: the margins a west or north drag
// compensates with (the dragged edge follows the pointer), how far the box may grow from each edge before the space
// its parent gives it ends (a grid item's own cell, else the parent's content box), whether its own declarations move
// its start edge at all, and the ratio it keeps (a medium's own, else its box's). Null when the page does not draw it.
export interface ResizeBasis {
  readonly width: number;
  readonly height: number;
  readonly extraX: number;
  readonly extraY: number;
  readonly contentBox: boolean;
  readonly positioned: boolean;
  readonly left: number;
  readonly top: number;
  readonly margins: { readonly left: number; readonly top: number };
  readonly room: ResizeRoom | null;
  readonly starts: { readonly x: boolean; readonly y: boolean };
  readonly ratio: number | null;
}

// The element's own rotation in degrees, as the page computes it (item 4.4): the chrome draws the outline and the
// handles turned by it, about the element's centre. A rotate of "none", or a value in another unit, reads 0.
export function elementRotation(iframe: HTMLIFrameElement, id: string): number {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  const view = iframe.contentWindow;
  if (!element || !view) return 0;
  const rotate = view.getComputedStyle(element).rotate;
  return rotate === '' || rotate === 'none' ? 0 : Number.parseFloat(rotate) || 0;
}

// A grid parent's track sizes along an axis, as the browser resolved them, and the gap between them; null when the
// page holds anything but plain px tracks (then the parent's content box is the only limit known)
function trackSizes(styles: CSSStyleDeclaration, axis: 'x' | 'y'): { readonly sizes: readonly number[]; readonly gap: number } | null {
  const raw = (axis === 'x' ? styles.gridTemplateColumns : styles.gridTemplateRows).trim();
  const parts = raw === 'none' || raw === '' ? [] : raw.split(/\s+/);
  const sizes = parts.map((part) => (/^-?[\d.]+px$/.test(part) ? Number.parseFloat(part) : Number.NaN));
  if (sizes.length === 0 || !sizes.every((size) => Number.isFinite(size))) return null;
  return { sizes, gap: cssPx(axis === 'x' ? styles.columnGap : styles.rowGap) };
}
// the span of a grid item's cell along an axis, measured from the parent's content box: the tracks its own box touches
function cellSpan(track: { readonly sizes: readonly number[]; readonly gap: number }, from: number, to: number): { readonly start: number; readonly end: number } | null {
  const starts: number[] = [];
  let at = 0;
  for (const size of track.sizes) {
    starts.push(at);
    at += size + track.gap;
  }
  const first = starts.map((start, i) => ({ start, i })).filter(({ start }) => start <= from + EPSILON).at(-1)?.i ?? -1;
  const last = starts.map((start, i) => ({ start, i })).filter(({ start, i }) => start + (track.sizes[i] ?? 0) >= to - EPSILON).at(0)?.i ?? -1;
  if (first < 0 || last < first) return null;
  const start = starts[first] ?? 0;
  return { start, end: (starts[last] ?? 0) + (track.sizes[last] ?? 0) };
}
const EPSILON = 0.5;
// the SVG namespace: a shape of an SVG is placed by its own geometry attributes, never by the flow
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function resizeBasis(iframe: HTMLIFrameElement, id: string): ResizeBasis | null {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  const view = iframe.contentWindow;
  if (!element || !view) return null;
  const style = view.getComputedStyle(element);
  const px = (value: string) => parseFloat(value) || 0;
  const box = element.getBoundingClientRect();
  const parent = element.parentElement;
  const parentStyle = parent === null ? null : view.getComputedStyle(parent);
  const parentBox = parent === null ? null : parent.getBoundingClientRect();
  let room: ResizeRoom | null = null;
  let starts = { x: false, y: false };
  if (parentStyle !== null && parentBox !== null) {
    const display = parentStyle.display;
    const grid = display.includes('grid');
    const places = grid || display.includes('flex');
    // where the element's own declarations can move its start edge: a positioned element's left/top, a block-level
    // element's margins; never where the parent lays it out, nor on an inline-level element, which the line places.
    // A shape inside an SVG is placed by its own geometry (spec elements-svg-shapes), whatever CSS says of it.
    const inSvg = element.namespaceURI === SVG_NAMESPACE && element.tagName.toLowerCase() !== 'svg';
    const inline = style.display.includes('inline');
    const positioned = style.position === 'absolute' || style.position === 'fixed';
    starts = inSvg ? { x: true, y: true } : { x: positioned || (!places && !inline), y: positioned || (!places && !inline) };
    const content = {
      left: parentBox.left + px(parentStyle.borderLeftWidth) + px(parentStyle.paddingLeft),
      top: parentBox.top + px(parentStyle.borderTopWidth) + px(parentStyle.paddingTop),
      right: parentBox.right - px(parentStyle.borderRightWidth) - px(parentStyle.paddingRight),
      bottom: parentBox.bottom - px(parentStyle.borderBottomWidth) - px(parentStyle.paddingBottom),
    };
    const span = grid ? trackSizes(parentStyle, 'x') : null;
    const cell = span === null ? null : cellSpan(span, box.left - content.left, box.right - content.left);
    room = {
      start: Math.max(0, box.left - (cell === null ? content.left : content.left + cell.start)),
      end: Math.max(0, (cell === null ? content.right : content.left + cell.end) - box.right),
    };
  }
  // the ratio a medium keeps by default: its intrinsic size where the page knows one, else its own box's
  const natural = element.tagName === 'IMG' ? { width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight } : null;
  const ratio = natural !== null && natural.width > 0 && natural.height > 0 ? natural.width / natural.height : box.width > 0 && box.height > 0 ? box.width / box.height : null;
  return {
    width: box.width,
    height: box.height,
    extraX: px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth),
    extraY: px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth),
    contentBox: style.boxSizing === 'content-box',
    positioned: style.position === 'absolute' || style.position === 'fixed',
    left: px(style.left),
    top: px(style.top),
    margins: { left: px(style.marginLeft), top: px(style.marginTop) },
    room,
    starts,
    ratio,
  };
}

// Every element the page draws, in document order: its node, its box and its padding on the screen, and whether it
// holds no element (spec canvas-outlines-zones)
export interface ElementBox {
  readonly id: string;
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly padding: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly empty: boolean;
}
export function elementBoxes(iframe: HTMLIFrameElement): ElementBox[] {
  const page = iframe.contentDocument;
  const view = iframe.contentWindow;
  const g = geometryOf(iframe);
  if (!page || !view || !g) return [];
  const px = (value: string) => (parseFloat(value) || 0) * g.zoom;
  return [...page.querySelectorAll(`[${NODE_ATTRIBUTE}]`)].flatMap((element) => {
    const box = screenBox(iframe, element);
    if (box === null) return [];
    const style = view.getComputedStyle(element);
    return [
      {
        id: element.getAttribute(NODE_ATTRIBUTE) ?? '',
        box,
        padding: { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) },
        empty: element.querySelector(`[${NODE_ATTRIBUTE}]`) === null,
      },
    ];
  });
}

// A pan's scroll of the page, in page px (spec zoom-wheel-pan)
export function scrollPageBy(iframe: HTMLIFrameElement, by: number): void {
  iframe.contentWindow?.scrollBy(0, by);
}

// The screen box of a node's element, or null when the page does not draw it.
export function nodeBox(iframe: HTMLIFrameElement, id: string): { x: number; y: number; width: number; height: number } | null {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  return element ? screenBox(iframe, element) : null;
}

// A node's size in the page's own CSS px: its box as the page lays it out, whatever the canvas's zoom (spec
// hover-measure: the size a hover shows is the measured geometry in the iframe at any zoom; the screen box divided by
// the zoom drifts by a pixel with the zoom's rounding).
export function nodeSize(iframe: HTMLIFrameElement, id: string): { readonly width: number; readonly height: number } | null {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return { width: box.width, height: box.height };
}

// a CSS length in px as the page computes it, 0 for none
const cssPx = (value: string): number => parseFloat(value) || 0;

// The columns a grid element lays out, on the screen: its computed track list (the resolved px sizes of
// grid-template-columns) laid out from its content box with the column gap between the tracks, each as tall as the
// element. What the canvas grid editor draws its line numbers and its track grips on (the user's real-use audit, item
// 8.2); an element the page does not draw as a grid has none.
export function trackBoxes(iframe: HTMLIFrameElement, id: string): readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[] {
  const element = iframe.contentDocument?.querySelector(nodeSelector(id as NodeId));
  const view = element?.ownerDocument.defaultView;
  const g = geometryOf(iframe);
  if (!element || !view || !g) return [];
  const style = view.getComputedStyle(element);
  if (!style.display.includes('grid')) return [];
  const tracks = style.gridTemplateColumns.split(' ').map(cssPx).filter((size) => size > 0);
  const gap = cssPx(style.columnGap);
  const r = element.getBoundingClientRect();
  const origin = frameToScreen({ x: r.left + cssPx(style.borderLeftWidth) + cssPx(style.paddingLeft), y: r.top + cssPx(style.borderTopWidth) + cssPx(style.paddingTop) }, g);
  const height = (r.height - cssPx(style.borderTopWidth) - cssPx(style.borderBottomWidth) - cssPx(style.paddingTop) - cssPx(style.paddingBottom)) * g.zoom;
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  let left = 0;
  for (const size of tracks) {
    boxes.push({ x: origin.x + left * g.zoom, y: origin.y, width: size * g.zoom, height });
    left += size + gap;
  }
  return boxes;
}

// The layout port of the core (src/core/ports/layout.ts), measured on the canvas's page: a node's box in page pixels,
// or null when the canvas does not draw it (no frame, or no element of that node).
export const pageLayout: Layout = {
  box(id) {
    const iframe = current;
    const g = iframe ? geometryOf(iframe) : null;
    const element = iframe?.contentDocument?.querySelector(nodeSelector(id));
    if (!g || !element) return null;
    const r = element.getBoundingClientRect();
    const topLeft = frameToPage({ x: r.left, y: r.top }, g);
    return { x: topLeft.x, y: topLeft.y, width: r.width, height: r.height };
  },
  paddingBox(id) {
    // where a positioned child of the node measures from: its padding box (the border box inset by the border widths)
    const iframe = current;
    const g = iframe ? geometryOf(iframe) : null;
    const element = iframe?.contentDocument?.querySelector(nodeSelector(id));
    const view = element?.ownerDocument.defaultView;
    if (!g || !element || !view) return null;
    const r = element.getBoundingClientRect();
    const style = view.getComputedStyle(element);
    const left = cssPx(style.borderLeftWidth);
    const top = cssPx(style.borderTopWidth);
    const right = cssPx(style.borderRightWidth);
    const bottom = cssPx(style.borderBottomWidth);
    const topLeft = frameToPage({ x: r.left, y: r.top }, g);
    return { x: topLeft.x + left, y: topLeft.y + top, width: Math.max(0, r.width - left - right), height: Math.max(0, r.height - top - bottom) };
  },
  fontPx(id) {
    // the root's font size for null (what rem stands on), the node's own otherwise (what its children's em and % stand
    // on)
    const document = current?.contentDocument;
    if (!document) return null;
    const element = id === null ? document.documentElement : document.querySelector(nodeSelector(id));
    const view = element?.ownerDocument.defaultView;
    return element && view ? cssPx(view.getComputedStyle(element).fontSize) : null;
  },
  place(id, within) {
    const element = current?.contentDocument?.querySelector(nodeSelector(id));
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) return null;
    const style = view.getComputedStyle(element);
    const r = element.getBoundingClientRect();
    // the margin edge, in the frame's own pixels (the page's: the frame is scaled from outside)
    const edge = { left: r.left - cssPx(style.marginLeft), top: r.top - cssPx(style.marginTop), right: r.right + cssPx(style.marginRight), bottom: r.bottom + cssPx(style.marginBottom) };
    // exact, as drawn: a writer rounds what it writes (two insets rounded apart can leave a box narrower than its text:
    // position.setAnchors)
    const size = { width: cssPx(style.width), height: cssPx(style.height) };
    // the containing block's padding edges: the viewport's, or the parent's border box less its borders
    const parent = element.parentElement;
    if (within === 'parent' && !parent) return null;
    const p = within === 'viewport' || !parent ? null : parent.getBoundingClientRect();
    const ps = p === null || !parent ? null : view.getComputedStyle(parent);
    const box =
      p === null || ps === null
        ? { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight }
        : { left: p.left + cssPx(ps.borderLeftWidth), top: p.top + cssPx(ps.borderTopWidth), right: p.right - cssPx(ps.borderRightWidth), bottom: p.bottom - cssPx(ps.borderBottomWidth) };
    return { left: edge.left - box.left, top: edge.top - box.top, right: box.right - edge.right, bottom: box.bottom - edge.bottom, ...size };
  },
};

// The page's content on the screen, which a canvas label must never cover : the box of
// every run of text and of every replaced element (an image, a video, an embedded frame, a form control).
const REPLACED = 'img, picture, video, audio, canvas, svg, iframe, embed, object, input, textarea, select, button, progress, meter';
// (read once per version of the page, canvas/page-clock.ts: the page and the frame are the same until it ticks, and
// reading every text box of a large page is the slow part of placing a label; the plan's stage 4)
let contentRead: { readonly iframe: HTMLIFrameElement; readonly version: number; readonly boxes: readonly { x: number; y: number; width: number; height: number }[] } | null = null;
export function contentBoxes(iframe: HTMLIFrameElement): { x: number; y: number; width: number; height: number }[] {
  const version = pageVersion();
  if (contentRead !== null && contentRead.iframe === iframe && contentRead.version === version) return [...contentRead.boxes];
  const boxes = readContentBoxes(iframe);
  contentRead = { iframe, version, boxes };
  return [...boxes];
}
function readContentBoxes(iframe: HTMLIFrameElement): { x: number; y: number; width: number; height: number }[] {
  const doc = iframe.contentDocument;
  const g = geometryOf(iframe);
  if (!doc || !g) return [];
  const toScreen = (r: DOMRect) => {
    const topLeft = frameToScreen({ x: r.left, y: r.top }, g);
    return { x: topLeft.x, y: topLeft.y, width: r.width * g.zoom, height: r.height * g.zoom };
  };
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    if ((text.textContent ?? '').trim() === '') continue;
    range.selectNodeContents(text);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) boxes.push(toScreen(r));
  }
  for (const element of doc.body.querySelectorAll(REPLACED)) {
    const r = element.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) boxes.push(toScreen(r));
  }
  return boxes;
}

// The CSS computed values of a node's element on the canvas's page, read through the typed object model
// (computedStyleMap: `auto` stays `auto`, a length is in px), so they are the values in force whatever sets them (the
// node's own styles, the browser's defaults); null when the canvas draws no element of the node. The inspector's
// collapsed sections summarise them (src/editor/inspector/sections.ts). A name the browser computes no property of (a
// recipe's own id, such as line-clamp, whose declarations are prefixed ones) reads as nothing: the typed object model
// throws on it. A line's width (a border side's, the outline's, the column rule's, with its style: `lines`,
// core/style/set.ts lineStyles) is the exception (spec inspector-provenance-reset, Problems in Pager 4): it computes to
// 0px under a style of none or hidden (CSS Backgrounds 3), and otherwise is the width the page declares
// (declaredWidth), never the one the zoomed canvas computes (BW1).
const NO_LINE: readonly string[] = ['none', 'hidden'];
export function computedValues(id: string, properties: readonly string[], lines: ReadonlyMap<string, string>): Readonly<Record<string, string>> | null {
  const element = current?.contentDocument?.querySelector(nodeSelector(id as NodeId));
  if (!element) return null;
  const map = element.computedStyleMap();
  const typed = (property: string): string => (CSS.supports(property, 'initial') ? (map.get(property)?.toString() ?? '') : '');
  return Object.fromEntries(
    properties.map((property) => {
      const style = lines.get(property);
      if (style === undefined) return [property, typed(property)];
      if (NO_LINE.includes(typed(style))) return [property, '0px'];
      return [property, declaredWidth(element, property) ?? browserLineWidth(element.localName, element.getAttribute('type'), property, style)];
    }),
  );
}

// The width keywords, as the browser draws them (CSS Backgrounds 3: thin ≤ medium ≤ thick; Chrome's 1, 3 and 5 px), and
// the keywords that set a line's width to its initial medium
const WIDTH_KEYWORDS: Readonly<Record<string, string>> = { thin: '1px', medium: '3px', thick: '5px', initial: '3px', unset: '3px' };
// a value the declaration alone cannot say (it takes a variable, the parent's or an earlier layer's value): the width
// the browser gives the line stands for it
const UNSAID = /var\(|env\(|attr\(|^inherit$|^revert/u;
// the cascade layer of a rule outside every layer: its declarations beat every layer's (CSS Cascade 5)
const UNLAYERED = Number.MAX_SAFE_INTEGER;
// the element's own style attribute: over every rule of its importance
const STYLE_ATTRIBUTE: Specificity = [Number.MAX_SAFE_INTEGER, 0, 0];

interface Declared {
  readonly value: string;
  readonly important: boolean;
  readonly layer: number;
  readonly specificity: Specificity;
  readonly order: number;
}

// Whether the first declaration wins over the second, as the cascade ranks them: !important first; then the layer (a
// later layer and no layer win among normal declarations, an earlier layer among important ones); then specificity;
// then the later one.
function wins(a: Declared, b: Declared): boolean {
  if (a.important !== b.important) return a.important;
  if (a.layer !== b.layer) return a.important ? a.layer < b.layer : a.layer > b.layer;
  return compareSpecificity(a.specificity, b.specificity) > 0 || (compareSpecificity(a.specificity, b.specificity) === 0 && a.order > b.order);
}

// The width a line of the element is declared with in the canvas page's stylesheets, or null when none declares one
// the page can say (BW1). The browser snaps a line's width to whole device pixels and reports it divided by the zoom
// (css-values-4 "snap as a border width"; Mozilla bug 287624), so the zoomed canvas computes a 1 px border as 1.69014px
// at 59 % and a 2 px one alike. The rules whose selector the browser matches on the element, inside the @media and
// @supports blocks that hold now, are ranked as the cascade ranks them (wins; their specificity is
// import/selectors.ts's specificityOf), and the winner's value is said in px when it is a keyword.
export function declaredWidth(element: Element, property: string): string | null {
  const view = element.ownerDocument.defaultView;
  if (view === null) return null;
  let best: Declared | null = null;
  let order = 0;
  const layers = new Map<string, number>();
  const consider = (style: CSSStyleDeclaration, specificity: Specificity, layer: number): void => {
    order += 1;
    const value = style.getPropertyValue(property).trim();
    if (value === '') return;
    const found: Declared = { value, important: style.getPropertyPriority(property) === 'important', layer, specificity, order };
    if (best === null || wins(found, best)) best = found;
  };
  // whether a selector matches the element (one the browser cannot read matches nothing)
  const holds = (selector: string): boolean => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  };
  // the most specific of a rule's selectors that match the element; null when none does
  const matching = (selectorText: string): Specificity | null => {
    let most: Specificity | null = null;
    for (const selector of splitSelectorList(selectorText)) {
      if (holds(selector) && (most === null || compareSpecificity(specificityOf(selector), most) > 0)) most = specificityOf(selector);
    }
    return most;
  };
  const walk = (rules: CSSRuleList, layer: number): void => {
    for (const rule of rules) {
      const kind = rule.constructor.name;
      if (kind === 'CSSStyleRule') {
        const specificity = matching((rule as CSSStyleRule).selectorText);
        if (specificity !== null) consider((rule as CSSStyleRule).style, specificity, layer);
      } else if (kind === 'CSSMediaRule') {
        if (view.matchMedia((rule as CSSMediaRule).conditionText).matches) walk((rule as CSSMediaRule).cssRules, layer);
      } else if (kind === 'CSSSupportsRule') {
        if (view.CSS.supports((rule as CSSSupportsRule).conditionText)) walk((rule as CSSSupportsRule).cssRules, layer);
      } else if (kind === 'CSSLayerBlockRule') {
        const name = (rule as CSSLayerBlockRule).name || `anonymous ${String(order)}`;
        if (!layers.has(name)) layers.set(name, layers.size);
        walk((rule as CSSLayerBlockRule).cssRules, layers.get(name) ?? 0);
      } else if (kind === 'CSSLayerStatementRule') {
        // "@layer a, b;" orders its layers as a block would, before any of their rules appear
        for (const name of (rule as CSSLayerStatementRule).nameList) if (!layers.has(name)) layers.set(name, layers.size);
      }
    }
  };
  for (const sheet of element.ownerDocument.styleSheets) {
    try {
      walk(sheet.cssRules, UNLAYERED);
    } catch {
      // a stylesheet of another origin keeps its rules to itself
    }
  }
  if (element instanceof view.HTMLElement) consider(element.style, STYLE_ATTRIBUTE, UNLAYERED);
  const winner = best as Declared | null;
  if (winner === null || UNSAID.test(winner.value)) return null;
  return WIDTH_KEYWORDS[winner.value] ?? winner.value;
}

// The canvas's iframe, for the pointer owner and the canvas overlays.
let current: HTMLIFrameElement | null = null;

export function registerFrame(iframe: HTMLIFrameElement | null): () => void {
  current = iframe;
  return () => {
    if (current === iframe) current = null;
  };
}

export function canvasFrame(): HTMLIFrameElement | null {
  return current;
}

export function canvasDocument(): Document | null {
  return current?.contentDocument ?? null;
}

// Whether the page moves on its own now (a CSS animation or transition running, a timeline or motion preview playing):
// its readers then measure at every frame while it lasts (canvas/page-clock.ts), never otherwise.
export function pageAnimating(): boolean {
  const page = current?.contentDocument;
  return page !== null && page !== undefined && page.getAnimations().some((animation) => animation.playState === 'running');
}


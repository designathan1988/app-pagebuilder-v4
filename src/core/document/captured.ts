// A captured page's DOM, separate from the authored element vocabulary (docs/CAPTURE-IMPORTER-ARCHITECTURE.md). One
// tree holds every observed width: each element, text and comment keeps its position in the ordered tree, and a node
// that differs at a width says so in `at` (absent there, or its attributes, text or state there). Tag and attribute
// namespaces are browser values, not inferred from names. An open shadow root is kept as the host's `shadow`. The
// editor's browser port parses HTML only for legacy packages and inserted markup; this model is plain JSON.
import type { IdGenerator } from '../ports/ids.ts';
import { browserPorts } from '../ports/browser.ts';
import { rewriteSrcsetUrls } from '../files/srcset.ts';

export interface CapturedAttribute {
  readonly name: string;
  readonly namespace: string | null;
  readonly value: string;
}

// What the page held beyond its markup: a field's value and checked state, an option's selection, a scrolled box's
// offsets (rrweb records the same: value, rr_scrollLeft, rr_scrollTop).
export interface CapturedState {
  readonly value?: string;
  readonly checked?: boolean;
  readonly selected?: boolean;
  readonly scrollLeft?: number;
  readonly scrollTop?: number;
}

// A node at one observed width where it is not what its own fields say: absent there, or its whole attribute list,
// its text or its state there. The node's own fields are its values at the widest width that has it.
export interface CapturedWidth {
  readonly absent?: true;
  readonly attributes?: readonly CapturedAttribute[];
  readonly value?: string;
  readonly state?: CapturedState;
}

export type CapturedAt = Readonly<Record<string, CapturedWidth>>;

export interface CapturedShadow {
  readonly mode: 'open' | 'closed';
  readonly children: readonly CapturedNode[];
}

export type CapturedNode =
  | {
    readonly kind: 'element'; readonly id: string; readonly namespace: string; readonly tag: string;
    readonly attributes: readonly CapturedAttribute[]; readonly children: readonly CapturedNode[];
    readonly shadow?: CapturedShadow; readonly state?: CapturedState; readonly at?: CapturedAt;
  }
  | { readonly kind: 'text'; readonly id: string; readonly value: string; readonly at?: CapturedAt }
  | { readonly kind: 'comment'; readonly id: string; readonly value: string; readonly at?: CapturedAt };

export type CapturedElement = Extract<CapturedNode, { readonly kind: 'element' }>;

export interface CapturedPage {
  // the observed widths, widest first
  readonly widths: readonly number[];
  readonly root: CapturedElement;
  readonly resourceProblems?: readonly CapturedResourceProblem[];
}

export interface CapturedResourceProblem {
  readonly url: string;
  readonly reason: 'unavailable' | 'blocked' | 'invalid-data';
}

// The capture package beside a captured page's file (`<page>.capture.json`). Format 2 holds the merged tree; format 1
// (before DEC-61) held one HTML text per width, read now by keeping its widest snapshot.
export type CapturedSnapshotPackage =
  | { readonly format: 2; readonly widths: readonly number[]; readonly root: CapturedElement; readonly resourceProblems?: readonly CapturedResourceProblem[] }
  | { readonly format: 1; readonly viewports: readonly { readonly width: number; readonly html: string }[]; readonly resourceProblems?: readonly CapturedResourceProblem[] };

export const captureSnapshotPath = (pageFile: string): string => `${pageFile}.capture.json`;

export interface CapturedProblem {
  readonly path: string;
  readonly message: string;
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const NAMESPACES = new Set([HTML_NAMESPACE, 'http://www.w3.org/2000/svg', 'http://www.w3.org/1998/Math/MathML']);
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'data', 'data-capture-paint']);
const NAME = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function unsafeAddress(value: string, image: boolean): boolean {
  if (!URL.canParse(value, 'https://capture.invalid/')) return true;
  const protocol = new URL(value, 'https://capture.invalid/').protocol;
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') return false;
  if (protocol === 'data:' && image && /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=+-]+)*,/i.test(value)) return false;
  return true;
}

// An element that acts on the document it stands in instead of drawing: a script; a <base>, which re-points every
// relative address of the page; a <meta http-equiv> pragma, whose refresh navigates the page away (the editor's parser
// reads a <noscript>'s content as elements, and sites commonly put a refresh there). The browser reader leaves them out
// of a new capture, and the canvas and the export never draw one a saved project still holds.
export function unsafeCapturedElement(tag: string, attributes: readonly Pick<CapturedAttribute, 'name'>[]): boolean {
  const name = tag.toLowerCase();
  return name === 'script' || name === 'base' || (name === 'meta' && attributes.some((one) => one.name.toLowerCase() === 'http-equiv'));
}

// Shared by the browser reader and saved-project validator: a parsed DOM is inert only until it is rendered.
export function unsafeCapturedAttribute(tag: string, attribute: Pick<CapturedAttribute, 'name' | 'value'>): boolean {
  const name = attribute.name.toLowerCase();
  if (name.startsWith('on') || name === 'srcdoc') return true;
  if (name === 'srcset') {
    let unsafe = false;
    rewriteSrcsetUrls(attribute.value, (url) => {
      if (unsafeAddress(url, tag === 'img' || tag === 'source')) unsafe = true;
      return url;
    });
    return unsafe;
  }
  return URL_ATTRIBUTES.has(name) && unsafeAddress(attribute.value, name === 'data-capture-paint' || ((tag === 'img' || tag === 'source') && name === 'src'));
}

// Validate plain saved JSON, including files a person opens later: one tree whose ids are unique, its widths, and
// every node's attributes and per-width values safe.
export function capturedProblems(value: unknown): CapturedProblem[] {
  const problems: CapturedProblem[] = [];
  const bad = (path: string, message: string): void => {
    problems.push({ path, message });
  };
  if (!isRecord(value) || !Array.isArray(value.widths) || value.widths.length === 0 || !isRecord(value.root)) {
    bad('', 'a captured page has its observed widths and one root element');
    return problems;
  }
  if (value.resourceProblems !== undefined && (!Array.isArray(value.resourceProblems) || value.resourceProblems.some((one: unknown) =>
    !isRecord(one) || typeof one.url !== 'string' || !['unavailable', 'blocked', 'invalid-data'].includes(String(one.reason))))) {
    bad('/resourceProblems', 'resource problems name an address and a known reason');
  }
  const widths = new Set<string>();
  value.widths.forEach((width: unknown, index: number) => {
    if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0 || widths.has(String(width))) bad(`/widths/${index}`, 'a width is a unique positive integer');
    else widths.add(String(width));
  });
  const ids = new Set<string>();
  const attributesOk = (list: unknown, tag: string, path: string): void => {
    if (!Array.isArray(list)) return bad(path, 'attributes are an ordered list');
    const names = new Set<string>();
    list.forEach((attribute: unknown, i: number) => {
      const place = `${path}/${i}`;
      if (!isRecord(attribute) || typeof attribute.name !== 'string' || !NAME.test(attribute.name) || !(attribute.namespace === null || typeof attribute.namespace === 'string') || typeof attribute.value !== 'string') return bad(place, 'an attribute has a name, namespace and value');
      const key = `${attribute.namespace ?? ''}:${attribute.name}`;
      if (names.has(key)) bad(place, 'an attribute occurs twice');
      names.add(key);
      if (unsafeCapturedAttribute(tag, attribute as unknown as CapturedAttribute)) bad(place, 'unsafe executable attribute or URL');
    });
  };
  const atOk = (at: unknown, tag: string | null, path: string): void => {
    if (at === undefined) return;
    if (!isRecord(at)) return bad(path, 'per-width values are a record by width');
    for (const [width, variant] of Object.entries(at)) {
      const place = `${path}/${width}`;
      if (!widths.has(width)) bad(place, `width ${width} is not one of the page's observed widths`);
      if (!isRecord(variant)) {
        bad(place, 'a width holds what the node is there');
        continue;
      }
      if (variant.absent !== undefined && variant.absent !== true) bad(`${place}/absent`, 'absent is true when given');
      if (variant.value !== undefined && typeof variant.value !== 'string') bad(`${place}/value`, 'a text value is a string');
      if (variant.attributes !== undefined) {
        if (tag === null) bad(`${place}/attributes`, 'only an element has attributes');
        else attributesOk(variant.attributes, tag, `${place}/attributes`);
      }
    }
  };
  const visit = (node: unknown, path: string): void => {
    if (!isRecord(node)) return bad(path, 'a captured node is an element, text or comment');
    if (typeof node.id !== 'string' || node.id === '' || ids.has(node.id)) bad(`${path}/id`, `id "${String(node.id)}" is empty or already used`);
    else ids.add(node.id);
    if (node.kind === 'text' || node.kind === 'comment') {
      if (typeof node.value !== 'string') bad(`${path}/value`, 'text and comments hold a string');
      atOk(node.at, null, `${path}/at`);
      return;
    }
    if (node.kind !== 'element') return bad(`${path}/kind`, 'a captured node has a known kind');
    if (typeof node.namespace !== 'string' || !NAMESPACES.has(node.namespace)) bad(`${path}/namespace`, 'the element has an HTML, SVG or MathML namespace');
    const tag = typeof node.tag === 'string' ? node.tag : '';
    if (!NAME.test(tag) || tag.toLowerCase() === 'script') bad(`${path}/tag`, 'the element has a safe tag name');
    attributesOk(node.attributes, tag, `${path}/attributes`);
    atOk(node.at, tag, `${path}/at`);
    if (!Array.isArray(node.children)) bad(`${path}/children`, 'children are an ordered list');
    else node.children.forEach((child, i) => visit(child, `${path}/children/${i}`));
    if (node.shadow !== undefined) {
      if (!isRecord(node.shadow) || !['open', 'closed'].includes(String(node.shadow.mode)) || !Array.isArray(node.shadow.children)) bad(`${path}/shadow`, 'a shadow root has a mode and children');
      else node.shadow.children.forEach((child, i) => visit(child, `${path}/shadow/children/${i}`));
    }
  };
  visit(value.root, '/root');
  const root = value.root;
  if (root.kind !== 'element' || root.namespace !== HTML_NAMESPACE || root.tag !== 'html') bad('/root', 'a captured root is HTML');
  return problems;
}

export function captureTree(markup: string, ids: IdGenerator): CapturedElement {
  return browserPorts().capturedTree(markup, ids);
}

// What a captured page's tree may hold, whatever made it: an element that acts on the page (unsafeCapturedElement)
// goes with its subtree, an executable attribute or address goes from the element and from its per-width lists, and
// every node takes a document id.
export function safeCaptured(node: CapturedNode, ids: IdGenerator): CapturedNode | null {
  const at = node.at === undefined ? undefined : Object.fromEntries(Object.entries(node.at).map(([width, variant]) => [width, variant.attributes === undefined || node.kind !== 'element'
    ? variant
    : { ...variant, attributes: variant.attributes.filter((one) => one.name !== 'data-capture-runtime' && !unsafeCapturedAttribute(node.tag, one)) }]));
  if (node.kind !== 'element') return { ...node, id: ids.next(), ...(at === undefined ? {} : { at }) };
  if (unsafeCapturedElement(node.tag, node.attributes)) return null;
  const children = node.children.flatMap((child) => safeCaptured(child, ids) ?? []);
  const shadow = node.shadow === undefined ? undefined : { mode: node.shadow.mode, children: node.shadow.children.flatMap((child) => safeCaptured(child, ids) ?? []) };
  return {
    ...node, id: ids.next(), children,
    attributes: node.attributes.filter((one) => one.name !== 'data-capture-runtime' && !unsafeCapturedAttribute(node.tag, one)),
    ...(shadow === undefined ? {} : { shadow }),
    ...(at === undefined ? {} : { at }),
  };
}

// A capture package read into a page's capture: format 2 holds the merged tree; format 1 (before DEC-61) one HTML text
// per width, of which the widest is kept, there being no node identity to merge the others by.
export function capturedFromPackage(value: unknown, ids: IdGenerator): CapturedPage {
  if (!isRecord(value)) throw new Error('a capture package is a JSON object');
  const resourceProblems = Array.isArray(value.resourceProblems) ? { resourceProblems: value.resourceProblems as CapturedResourceProblem[] } : {};
  if (value.format === 2) {
    if (!isRecord(value.root) || !Array.isArray(value.widths)) throw new Error('a capture package of format 2 holds its widths and one tree');
    const root = safeCaptured(value.root as unknown as CapturedNode, ids);
    if (root === null || root.kind !== 'element') throw new Error('a capture package of format 2 holds an html root');
    const page: CapturedPage = { widths: value.widths as number[], root, ...resourceProblems };
    const problems = capturedProblems(page);
    if (problems.length > 0) throw new Error(`invalid capture package: ${problems[0]?.path} ${problems[0]?.message}`);
    return page;
  }
  if (value.format === 1 && Array.isArray(value.viewports)) {
    const widest = [...(value.viewports as { width: number; html: string }[])].sort((a, b) => b.width - a.width)[0];
    if (widest === undefined || typeof widest.html !== 'string') throw new Error('a capture package of format 1 holds one snapshot or more');
    return { widths: [widest.width], root: captureTree(widest.html, ids), ...resourceProblems };
  }
  throw new Error('a capture package has format 1 or 2');
}

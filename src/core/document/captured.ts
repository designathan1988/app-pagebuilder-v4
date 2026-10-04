// A captured page's DOM, separate from the authored element vocabulary. Each element, text and comment keeps
// its position in the ordered tree; tag and attribute namespaces are browser values, not inferred from names.
// The editor's browser port parses HTML; this model contains plain JSON and no DOM objects.
import type { IdGenerator } from '../ports/ids.ts';
import { browserPorts } from '../ports/browser.ts';
import { rewriteSrcsetUrls } from '../files/srcset.ts';

export interface CapturedAttribute {
  readonly name: string;
  readonly namespace: string | null;
  readonly value: string;
}

export type CapturedNode =
  | { readonly kind: 'element'; readonly id: string; readonly namespace: string; readonly tag: string; readonly attributes: readonly CapturedAttribute[]; readonly children: readonly CapturedNode[] }
  | { readonly kind: 'text'; readonly id: string; readonly value: string }
  | { readonly kind: 'comment'; readonly id: string; readonly value: string };

export type CapturedElement = Extract<CapturedNode, { readonly kind: 'element' }>;

export interface CapturedViewport {
  readonly width: number;
  readonly root: CapturedElement;
}

export interface CapturedPage {
  readonly viewports: readonly CapturedViewport[];
  readonly resourceProblems?: readonly CapturedResourceProblem[];
}

export interface CapturedResourceProblem {
  readonly url: string;
  readonly reason: 'unavailable' | 'blocked' | 'invalid-data';
}

export interface CapturedSnapshotPackage {
  readonly format: 1;
  readonly viewports: readonly { readonly width: number; readonly html: string }[];
  readonly resourceProblems?: readonly CapturedResourceProblem[];
}

export const captureSnapshotPath = (pageFile: string): string => `${pageFile}.capture.json`;

export interface CapturedProblem {
  readonly path: string;
  readonly message: string;
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const NAMESPACES = new Set([HTML_NAMESPACE, 'http://www.w3.org/2000/svg', 'http://www.w3.org/1998/Math/MathML']);
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'data-capture-paint']);
const NAME = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function unsafeAddress(value: string, image: boolean): boolean {
  if (!URL.canParse(value, 'https://capture.invalid/')) return true;
  const protocol = new URL(value, 'https://capture.invalid/').protocol;
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') return false;
  if (protocol === 'data:' && image && /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=+-]+)*,/i.test(value)) return false;
  return true;
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

// Validate plain saved JSON, including files a person opens later. IDs are unique within a viewport; the same
// identity may intentionally occur in another viewport when both snapshots show the same source element.
export function capturedProblems(value: unknown): CapturedProblem[] {
  const problems: CapturedProblem[] = [];
  const bad = (path: string, message: string): void => {
    problems.push({ path, message });
  };
  if (!isRecord(value) || !Array.isArray(value.viewports) || value.viewports.length === 0) {
    bad('/viewports', 'a captured page has one or more viewport snapshots');
    return problems;
  }
  if (value.resourceProblems !== undefined && (!Array.isArray(value.resourceProblems) || value.resourceProblems.some((one: unknown) =>
    !isRecord(one) || typeof one.url !== 'string' || !['unavailable', 'blocked', 'invalid-data'].includes(String(one.reason))))) {
    bad('/resourceProblems', 'resource problems name an address and a known reason');
  }
  const widths = new Set<number>();
  value.viewports.forEach((viewport, index) => {
    const at = `/viewports/${index}`;
    if (!isRecord(viewport)) return bad(at, 'a viewport has a width and root element');
    if (typeof viewport.width !== 'number' || !Number.isInteger(viewport.width) || viewport.width <= 0 || widths.has(viewport.width)) bad(`${at}/width`, 'a viewport width is a unique positive integer');
    else widths.add(viewport.width);
    const ids = new Set<string>();
    const visit = (node: unknown, path: string): void => {
      if (!isRecord(node)) return bad(path, 'a captured node is an element, text or comment');
      if (typeof node.id !== 'string' || node.id === '' || ids.has(node.id)) bad(`${path}/id`, `id "${String(node.id)}" is empty or already used`);
      else ids.add(node.id);
      if (node.kind === 'text' || node.kind === 'comment') {
        if (typeof node.value !== 'string') bad(`${path}/value`, 'text and comments hold a string');
        return;
      }
      if (node.kind !== 'element') return bad(`${path}/kind`, 'a captured node has a known kind');
      if (typeof node.namespace !== 'string' || !NAMESPACES.has(node.namespace)) bad(`${path}/namespace`, 'the element has an HTML, SVG or MathML namespace');
      if (typeof node.tag !== 'string' || !NAME.test(node.tag) || node.tag.toLowerCase() === 'script') bad(`${path}/tag`, 'the element has a safe tag name');
      if (!Array.isArray(node.attributes)) bad(`${path}/attributes`, 'attributes are an ordered list');
      else {
        const names = new Set<string>();
        node.attributes.forEach((attribute, i) => {
          const place = `${path}/attributes/${i}`;
          if (!isRecord(attribute) || typeof attribute.name !== 'string' || !NAME.test(attribute.name) || !(attribute.namespace === null || typeof attribute.namespace === 'string') || typeof attribute.value !== 'string') return bad(place, 'an attribute has a name, namespace and value');
          const key = `${attribute.namespace ?? ''}:${attribute.name}`;
          if (names.has(key)) bad(place, 'an attribute occurs twice');
          names.add(key);
          if (unsafeCapturedAttribute(String(node.tag), attribute as unknown as CapturedAttribute)) bad(place, 'unsafe executable attribute or URL');
        });
      }
      if (!Array.isArray(node.children)) bad(`${path}/children`, 'children are an ordered list');
      else node.children.forEach((child, i) => visit(child, `${path}/children/${i}`));
    };
    visit(viewport.root, `${at}/root`);
    if (!isRecord(viewport.root) || viewport.root.kind !== 'element' || viewport.root.namespace !== HTML_NAMESPACE || viewport.root.tag !== 'html') bad(`${at}/root`, 'a viewport root is HTML');
  });
  return problems;
}

export function captureTree(markup: string, ids: IdGenerator): CapturedElement {
  return browserPorts().capturedTree(markup, ids);
}

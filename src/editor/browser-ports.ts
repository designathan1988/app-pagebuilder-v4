// The browser's own readers behind the core's ports (src/core/ports/browser.ts): the HTML parser turns a text into the
// core's tree of tags, attributes and texts, and an image element reads an image's intrinsic size. Installed by the app
// before the editor starts (src/main.tsx) and by the unit tests over happy-dom (tools/test/setup-browser.ts).
import type { MarkupChild, MarkupNode, MarkupPage, PageHead } from '../core/import/markup.ts';
import type { BrowserPorts } from '../core/ports/browser.ts';
import { unsafeCapturedAttribute, type CapturedNode, type CapturedElement } from '../core/document/captured.ts';
import type { IdGenerator } from '../core/ports/ids.ts';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

const parse = (text: string): Document => new DOMParser().parseFromString(text, 'text/html');

// the children of a parsed element as markup: its texts and its elements, each element with its attributes
function childrenOf(parent: Node): MarkupChild[] {
  const out: MarkupChild[] = [];
  for (const child of parent.childNodes) {
    if (child.nodeType === TEXT_NODE) out.push(child.nodeValue ?? '');
    else if (child.nodeType === ELEMENT_NODE) {
      const element = child as Element;
      const attributes = new Map<string, string>();
      for (const attribute of element.attributes) attributes.set(attribute.name.toLowerCase(), attribute.value);
      out.push({ tag: element.localName, attributes, children: childrenOf(element.localName === 'template' ? (element as HTMLTemplateElement).content : element) });
    }
  }
  return out;
}

const attributesOf = (element: Element | null): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const attribute of element?.attributes ?? []) out.set(attribute.name.toLowerCase(), attribute.value);
  return out;
};

// The markup's own elements and texts, as the browser parses them (the wrappers a fragment was written with are gone:
// parseFromString puts what it finds where the content model says, and its body holds the rest).
const fragment = (markup: string): readonly MarkupChild[] => childrenOf(parse(markup).body);

function page(markup: string): MarkupPage {
  const document = parse(markup);
  const html = document.documentElement;
  const head = html?.querySelector('head') ?? null;
  return {
    head: head === null ? [] : childrenOf(head).filter((child): child is MarkupNode => typeof child !== 'string'),
    title: head?.querySelector('title')?.textContent ?? '',
    htmlAttributes: attributesOf(html ?? null),
    body: childrenOf(document.body),
    bodyAttributes: attributesOf(document.body),
  };
}

function head(markup: string): PageHead {
  const document = parse(markup);
  const attribute = (name: string): string | null => {
    const value = document.documentElement.getAttribute(name)?.trim() ?? '';
    return value === '' ? null : value;
  };
  const written = (element: Element, name: string): string => (element.getAttribute(name) ?? '').trim();
  return {
    lang: attribute('lang'),
    dir: attribute('dir'),
    title: document.title.trim() === '' ? null : document.title.trim(),
    stylesheets: [...document.querySelectorAll('link[href]')].filter((link) => (link.getAttribute('rel') ?? '').split(/\s+/).includes('stylesheet')).map((link) => written(link, 'href')).filter((href) => href !== ''),
    scripts: [...document.querySelectorAll('script[src]')].map((script) => written(script, 'src')).filter((src) => src !== ''),
  };
}

// DOMParser is inert while parsing, but event attributes can run once copied into the canvas. Keep the source
// structure and visible attributes while excluding executable markup before it enters a project document.
function capturedTree(markup: string, ids: IdGenerator): CapturedElement {
  const document = parse(markup);
  const safeAttribute = (tag: string, attribute: Attr): boolean =>
    attribute.name !== 'data-capture-runtime' && !unsafeCapturedAttribute(tag, attribute);
  const visit = (node: Node): CapturedNode | null => {
    if (node.nodeType === TEXT_NODE) return { kind: 'text', id: ids.next(), value: node.nodeValue ?? '' };
    if (node.nodeType === COMMENT_NODE) return { kind: 'comment', id: ids.next(), value: node.nodeValue ?? '' };
    if (node.nodeType !== ELEMENT_NODE) return null;
    const element = node as Element;
    if (element.localName === 'script') return null;
    const parent = element.localName === 'template' ? (element as HTMLTemplateElement).content : element;
    return {
      kind: 'element', id: ids.next(), namespace: element.namespaceURI ?? 'http://www.w3.org/1999/xhtml',
      tag: element.localName,
      attributes: [...element.attributes].filter((attribute) => safeAttribute(element.localName, attribute)).map((attribute) => ({ name: attribute.name, namespace: attribute.namespaceURI, value: attribute.value })),
      children: [...parent.childNodes].map(visit).filter((child): child is CapturedNode => child !== null),
    };
  };
  const root = visit(document.documentElement);
  if (root?.kind !== 'element') throw new Error('captured page has no document element');
  return root;
}

// an image's intrinsic size, drawn by an image element from its bytes
function imageSize(bytes: string, type: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = `data:${type};base64,${bytes}`;
  });
}

export const browserPorts: BrowserPorts = { fragment, page, head, capturedTree, imageSize };

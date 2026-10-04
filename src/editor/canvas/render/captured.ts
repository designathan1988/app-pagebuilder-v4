import { unsafeCapturedElement, type CapturedElement, type CapturedNode } from '../../../core/document/captured.ts';
import type { DocumentJson, Page, ProjectFile } from '../../../core/document/model.ts';
import { dataUrl, fileAt, objectUrl } from '../../../core/files/files.ts';
import { rewriteSrcsetUrls } from '../../../core/files/srcset.ts';
import { fileUrlsIn } from '../../../core/render/output.ts';
import { capturedAt } from '../../../core/render/captured.ts';

const HTML = 'http://www.w3.org/1999/xhtml';
const RESOURCE = new Set(['src', 'poster', 'data', 'xlink:href', 'data-capture-paint']);

function projectFile(document: DocumentJson, from: string, address: string): ProjectFile | null {
  if (/^(?:data:|blob:|#)/i.test(address)) return null;
  const direct = fileAt(document, address);
  if (direct !== null) return direct;
  try {
    const resolved = new URL(address, new URL(from, 'https://capture.invalid/'));
    return resolved.origin === 'https://capture.invalid' ? fileAt(document, decodeURIComponent(resolved.pathname.slice(1))) : null;
  } catch {
    return null;
  }
}

function source(document: DocumentJson, from: string, address: string): string {
  const file = projectFile(document, from, address);
  return file === null ? address : objectUrl(file);
}

function css(document: DocumentJson, from: string, text: string): string {
  return fileUrlsIn(text, (address) => source(document, from, address));
}

function attributes(target: Element, node: CapturedElement, document: DocumentJson, page: Page): void {
  for (const attribute of [...target.attributes]) target.removeAttribute(attribute.name);
  for (const attribute of node.attributes) {
    // A captured document may embed a remote frame or plugin. The editing canvas never runs it;
    // export retains the original safe address, and opaque-frame capture supplies its visual fallback.
    if (['iframe', 'object', 'embed'].includes(node.tag) && ['src', 'data'].includes(attribute.name)) continue;
    let value = attribute.value;
    if (attribute.name === 'srcset') value = rewriteSrcsetUrls(value, (address) => source(document, page.file, address));
    else if (attribute.name === 'style') value = css(document, page.file, value);
    else if (RESOURCE.has(attribute.name)) value = source(document, page.file, value);
    else if (node.tag === 'link' && attribute.name === 'href') value = source(document, page.file, value);
    if (attribute.namespace === null) target.setAttribute(attribute.name, value);
    else target.setAttributeNS(attribute.namespace, attribute.name, value);
  }
  if (node.tag === 'iframe') target.setAttribute('sandbox', '');
}

// what the page held beyond its markup (a field's value, a selection, a scrolled box's offsets), given back once the
// element is in the page: offsets need its layout
type Scrolled = [Element, number, number];
function applyState(element: Element, node: CapturedElement, scrolled: Scrolled[]): void {
  const state = node.state;
  if (state === undefined) return;
  // the canvas's elements belong to the frame's window: known by their tag, not by this window's classes
  const html = node.namespace === HTML;
  if (html && node.tag === 'input') {
    const input = element as HTMLInputElement;
    if (state.value !== undefined) input.value = state.value;
    if (state.checked !== undefined) input.checked = state.checked;
  }
  if (html && node.tag === 'textarea' && state.value !== undefined) (element as HTMLTextAreaElement).value = state.value;
  if (html && node.tag === 'option' && state.selected !== undefined) (element as HTMLOptionElement).selected = state.selected;
  if (state.scrollLeft !== undefined || state.scrollTop !== undefined) scrolled.push([element, state.scrollLeft ?? 0, state.scrollTop ?? 0]);
}

function makeNode(target: Document, document: DocumentJson, page: Page, node: CapturedNode, elements: Map<string, Element>, scrolled: Scrolled[] = []): Node {
  if (node.kind === 'text') return target.createTextNode(node.value);
  if (node.kind === 'comment') return target.createComment(node.value);
  // an element that acts on the page instead of drawing (a refresh, a <base>) is never put on the canvas
  if (unsafeCapturedElement(node.tag, node.attributes)) return target.createComment('');
  const element = node.namespace === HTML ? target.createElement(node.tag) : target.createElementNS(node.namespace, node.tag);
  attributes(element, node, document, page);
  element.setAttribute('data-capture-node', node.id);
  elements.set(node.id, element);
  if (node.tag === 'link' && (node.attributes.find((one) => one.name === 'rel')?.value ?? '').split(/\s+/).includes('stylesheet')) {
    const href = node.attributes.find((one) => one.name === 'href')?.value ?? '';
    const file = projectFile(document, page.file, href);
    if (file !== null) {
      const sheet = target.createElement('style');
      const text = new TextDecoder().decode(Uint8Array.from(atob(file.bytes), (character) => character.charCodeAt(0)));
      sheet.textContent = css(document, file.path, text);
      sheet.setAttribute('data-capture-node', node.id);
      elements.set(node.id, sheet);
      return sheet;
    }
  }
  // an open shadow root is the host's own again (attachShadow refuses elements that cannot host one: drawn without it)
  if (node.shadow !== undefined) {
    try {
      const root = element.attachShadow({ mode: node.shadow.mode });
      for (const child of node.shadow.children) root.append(makeNode(target, document, page, child, elements, scrolled));
    } catch { /* not a valid shadow host */ }
  }
  for (const child of node.children) element.append(makeNode(target, document, page, child, elements, scrolled));
  applyState(element, node, scrolled);
  if (node.tag === 'style') element.textContent = css(document, page.file, element.textContent ?? '');
  const paint = node.attributes.find((one) => one.name === 'data-capture-paint')?.value;
  if (paint !== undefined && node.tag === 'canvas') {
    const canvas = element as HTMLCanvasElement;
    const image = new Image();
    image.onload = () => {
      const context = canvas.getContext('2d');
      if (context !== null)
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = source(document, page.file, paint);
  }
  if (paint !== undefined && node.tag === 'iframe') {
    const file = projectFile(document, page.file, paint);
    const image = file === null ? paint : dataUrl(file);
    const escaped = image.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    element.setAttribute('srcdoc', `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:fill}</style></head><body><img src="${escaped}"></body></html>`);
  }
  return element;
}

export function mountCaptured(target: Document, document: DocumentJson, page: Page, width: number): Map<string, Element> {
  if (page.capture === undefined) throw new Error('captured renderer requires a captured page');
  const root = capturedAt(page.capture, width);
  const elements = new Map<string, Element>();
  attributes(target.documentElement, root, document, page);
  target.documentElement.setAttribute('data-builder-capture', '');
  target.documentElement.setAttribute('data-capture-node', root.id);
  elements.set(root.id, target.documentElement);
  const head = root.children.find((one): one is CapturedElement => one.kind === 'element' && one.tag === 'head');
  const body = root.children.find((one): one is CapturedElement => one.kind === 'element' && one.tag === 'body');
  if (head === undefined || body === undefined) throw new Error('captured page lacks head or body');
  attributes(target.body, body, document, page);
  attributes(target.head, head, document, page);
  target.head.setAttribute('data-capture-node', head.id);
  target.body.setAttribute('data-capture-node', body.id);
  elements.set(head.id, target.head);
  elements.set(body.id, target.body);
  const scrolled: Scrolled[] = [];
  target.head.replaceChildren(...head.children.map((node) => makeNode(target, document, page, node, elements, scrolled)));
  target.body.replaceChildren(...body.children.map((node) => makeNode(target, document, page, node, elements, scrolled)));
  for (const [element, left, top] of scrolled) {
    element.scrollLeft = left;
    element.scrollTop = top;
  }
  return elements;
}

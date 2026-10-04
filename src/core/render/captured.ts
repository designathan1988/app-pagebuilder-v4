// Captured pages keep the browser's ordered DOM as project JSON, one tree for every observed width
// (docs/CAPTURE-IMPORTER-ARCHITECTURE.md). The canvas draws its projection at the nearest observed width; the export
// writes the widest projection as static HTML and a Builder-owned script that applies the other widths' nodes,
// attributes, text and scroll offsets when the window is nearest to them, on load and on resize.
import { unsafeCapturedElement, type CapturedAttribute, type CapturedElement, type CapturedNode, type CapturedPage } from '../document/captured.ts';

const HTML = 'http://www.w3.org/1999/xhtml';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['style']);
// What the HTML parser keeps inside <head> ("in head" insertion mode): any other element, or text that is not white
// space, ends the head there and sends it and everything after it into the body (HTML Standard, 13.2.6.4.4). A head
// is never drawn, so such content is left out of a written page rather than moving the rest.
const HEAD_CONTENT = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'noframes', 'noscript', 'script', 'style', 'template', 'title']);

const escapeText = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = (value: string): string => escapeText(value).replaceAll('"', '&quot;');
const isElement = (node: CapturedNode, tag: string): node is CapturedElement => node.kind === 'element' && node.tag === tag && node.namespace === HTML;

// The observed width a window of `width` px shows: the nearest one (an approximation between observed widths).
export function nearestWidth(capture: Pick<CapturedPage, 'widths'>, width: number): number {
  const nearest = [...capture.widths].sort((a, b) => Math.abs(a - width) - Math.abs(b - width) || b - a)[0];
  if (nearest === undefined) throw new Error('a captured page has no observed width');
  return nearest;
}

function project(node: CapturedNode, width: number): CapturedNode | null {
  const there = node.at?.[String(width)];
  if (there?.absent === true) return null;
  if (node.kind !== 'element') return { kind: node.kind, id: node.id, value: there?.value ?? node.value };
  const state = there?.state ?? node.state;
  const children = node.children.flatMap((child) => project(child, width) ?? []);
  const shadow = node.shadow === undefined ? undefined : { mode: node.shadow.mode, children: node.shadow.children.flatMap((child) => project(child, width) ?? []) };
  return {
    kind: 'element', id: node.id, namespace: node.namespace, tag: node.tag, attributes: there?.attributes ?? node.attributes, children,
    ...(shadow === undefined ? {} : { shadow }),
    ...(state === undefined || Object.keys(state).length === 0 ? {} : { state }),
  };
}

// The page as the observed width nearest `width` showed it: one tree with no per-width values.
export function capturedAt(capture: CapturedPage, width: number): CapturedElement {
  return project(capture.root, nearestWidth(capture, width)) as CapturedElement;
}

// A field's value, checked state and selection written as the attributes that give a static page the same state.
function stateAttributes(node: CapturedElement): readonly CapturedAttribute[] {
  const state = node.state;
  if (state === undefined) return node.attributes;
  const without = (names: readonly string[]) => node.attributes.filter((one) => !names.includes(one.name));
  if (node.tag === 'input' && node.namespace === HTML) {
    const kept = without(['value', 'checked']);
    return [...kept, ...(state.value === undefined ? node.attributes.filter((one) => one.name === 'value') : [{ name: 'value', namespace: null, value: state.value }]),
      ...(state.checked === true ? [{ name: 'checked', namespace: null, value: '' }] : state.checked === false ? [] : node.attributes.filter((one) => one.name === 'checked'))];
  }
  if (node.tag === 'option' && node.namespace === HTML && state.selected !== undefined) return [...without(['selected']), ...(state.selected ? [{ name: 'selected', namespace: null, value: '' }] : [])];
  return node.attributes;
}

export interface WriteOptions {
  // the elements written with their id (data-capture-node), which the width script finds them by
  readonly marked?: ReadonlySet<string>;
}

// HTML that the browser's parser reads back into the same tree: the head holds only head content; an open shadow root
// is a declarative shadow root (<template shadowrootmode>, MDN), first in its host; state is written as attributes.
export function capturedHtml(root: CapturedElement, options: WriteOptions = {}): string {
  const write = (node: CapturedNode, parent: CapturedElement | null): string => {
    if (node.kind === 'comment') return `<!--${node.value.replaceAll('-->', '--&gt;')}-->`;
    if (node.kind === 'text') {
      if (parent !== null && isElement(parent, 'head') && node.value.trim() !== '') return '';
      if (parent !== null && parent.tag === 'textarea' && parent.state?.value !== undefined) return '';
      return parent !== null && RAW_TEXT.has(parent.tag) ? node.value : escapeText(node.value);
    }
    // an element that acts on the page instead of drawing (a refresh, a <base>) is never written
    if (unsafeCapturedElement(node.tag, node.attributes)) return '';
    if (parent !== null && isElement(parent, 'head') && !HEAD_CONTENT.has(node.tag)) return '';
    const marked = options.marked?.has(node.id) === true ? ` data-capture-node="${escapeAttribute(node.id)}"` : '';
    const attributes = stateAttributes(node).map((one) => ` ${one.name}="${escapeAttribute(one.value)}"`).join('');
    const open = `<${node.tag}${attributes}${marked}>`;
    if (node.namespace === HTML && VOID.has(node.tag)) return open;
    const shadow = node.shadow === undefined || node.shadow.mode !== 'open' ? '' : `<template shadowrootmode="open">${node.shadow.children.map((child) => write(child, null)).join('')}</template>`;
    const text = node.tag === 'textarea' && node.state?.value !== undefined ? escapeText(node.state.value) : '';
    return `${open}${shadow}${text}${node.children.map((child) => write(child, node)).join('')}</${node.tag}>`;
  };
  return `<!DOCTYPE html>\n${write(root, null)}`;
}

// What an exported captured page needs and its source may lack, added without changing what it draws: the page's
// language on <html> (as an authored page's export writes it), a <title> (the page's title setting or name) and the
// capture mark, by which an import of the export knows the page and reads its tree back (spec capture-url).
export interface CapturedHead {
  readonly title: string;
  readonly lang: string;
}

export function exportedCapturedRoot(root: CapturedElement, head: CapturedHead): CapturedElement {
  const attributes = root.attributes.some((one) => one.name === 'lang') ? root.attributes : [...root.attributes, { name: 'lang', namespace: null, value: head.lang }];
  const children = root.children.map((child) => {
    if (!isElement(child, 'head')) return child;
    const extra: CapturedNode[] = [];
    if (!child.children.some((one) => isElement(one, 'meta') && one.attributes.some((a) => a.name === 'name' && a.value === 'builder-capture'))) {
      extra.push({ kind: 'element', id: `${child.id}-capture-mark`, namespace: HTML, tag: 'meta', attributes: [{ name: 'name', namespace: null, value: 'builder-capture' }, { name: 'content', namespace: null, value: 'exported' }], children: [] });
    }
    if (!child.children.some((one) => isElement(one, 'title'))) {
      extra.push({ kind: 'element', id: `${child.id}-title`, namespace: HTML, tag: 'title', attributes: [], children: [{ kind: 'text', id: `${child.id}-title-text`, value: head.title }] });
    }
    return extra.length === 0 ? child : { ...child, children: [...extra, ...child.children] };
  });
  return { ...root, attributes, children };
}

// --------------------------------------------------------------------------------------------- the width script

type Child = string | readonly ['t' | 'c', string];
interface Changing {
  // per observed width: the attributes and the children (an element's id, or a text or comment) it has there
  readonly a: Readonly<Record<string, readonly (readonly [string, string | null, string])[]>>;
  readonly c: Readonly<Record<string, readonly Child[]>>;
  readonly s?: Readonly<Record<string, readonly [number, number]>>;
}
interface Made {
  readonly t: string;
  readonly n: string;
  readonly a: Readonly<Record<string, readonly (readonly [string, string | null, string])[]>>;
  readonly c: Readonly<Record<string, readonly Child[]>>;
}

// What the width script needs: the elements in the static page whose attributes, children or scroll offsets differ at
// another width, and every element the widest width lacks, to be made at the widths that have it.
function widthData(root: CapturedElement, widths: readonly number[]): { readonly changing: Record<string, Changing>; readonly made: Record<string, Made>; readonly marked: Set<string> } {
  const changing: Record<string, Changing> = {};
  const made: Record<string, Made> = {};
  const marked = new Set<string>();
  const widest = widths[0] as number;
  const projected = new Map<number, Map<string, CapturedElement>>();
  for (const width of widths) {
    const byId = new Map<string, CapturedElement>();
    const index = (node: CapturedNode): void => {
      if (node.kind !== 'element') return;
      byId.set(node.id, node);
      node.children.forEach(index);
    };
    const at = project(root, width);
    if (at !== null) index(at);
    projected.set(width, byId);
  }
  const childList = (node: CapturedElement): Child[] => node.children.map((child) => (child.kind === 'element' ? child.id : [child.kind === 'text' ? 't' : 'c', child.value] as const));
  const attributeList = (node: CapturedElement) => stateAttributes(node).map((one) => [one.name, one.namespace, one.value] as const);
  const all = new Set<string>();
  for (const byId of projected.values()) for (const id of byId.keys()) all.add(id);
  for (const id of all) {
    const atWidths = widths.map((width) => ({ width, node: projected.get(width)?.get(id) }));
    const inStatic = projected.get(widest)?.has(id) === true;
    const a: Record<string, readonly (readonly [string, string | null, string])[]> = {};
    const c: Record<string, readonly Child[]> = {};
    const s: Record<string, readonly [number, number]> = {};
    for (const { width, node } of atWidths) {
      if (node === undefined) continue;
      a[String(width)] = attributeList(node);
      c[String(width)] = childList(node);
      if (node.state?.scrollLeft !== undefined || node.state?.scrollTop !== undefined) s[String(width)] = [node.state.scrollLeft ?? 0, node.state.scrollTop ?? 0];
    }
    const sample = atWidths.find((one) => one.node !== undefined)?.node as CapturedElement;
    if (!inStatic) {
      made[id] = { t: sample.tag, n: sample.namespace, a, c };
      continue;
    }
    const json = (record: Record<string, unknown>): string[] => Object.values(record).map((one) => JSON.stringify(one));
    const differs = new Set(json(a)).size > 1 || new Set(json(c)).size > 1 || Object.keys(s).length > 0;
    if (differs) {
      changing[id] = { a, c, ...(Object.keys(s).length === 0 ? {} : { s }) };
      marked.add(id);
    }
  }
  // a changing element's element children are found by their mark when they move
  for (const one of Object.values(changing)) for (const list of Object.values(one.c)) for (const child of list) if (typeof child === 'string' && projected.get(widest)?.has(child) === true) marked.add(child);
  return { changing, made, marked };
}

// The Builder-owned script of an exported captured page (its data first). At load and on resize it takes the observed
// width nearest the window and gives every changing element that width's attributes and children (finding elements by
// their mark, making the ones the static page lacks) and scroll offsets.
function widthScript(widths: readonly number[], changing: Record<string, Changing>, made: Record<string, Made>): string {
  const data = JSON.stringify({ w: widths, g: changing, m: made }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  return `<script>(function(){var d=${data},cur=null,cache=null;`
    + 'function near(){var x=window.innerWidth,b=d.w[0];for(var i=0;i<d.w.length;i++){var v=d.w[i];if(Math.abs(v-x)<Math.abs(b-x))b=v}return String(b)}'
    + 'function el(id){if(cache===null){cache={};var all=document.querySelectorAll("[data-capture-node]");for(var i=0;i<all.length;i++)cache[all[i].getAttribute("data-capture-node")]=all[i]}return cache[id]||null}'
    + 'function attrs(e,list,id){for(var i=e.attributes.length-1;i>=0;i--){var n=e.attributes[i];if(n.name!=="data-capture-node")e.removeAttributeNode(n)}'
    + 'for(var j=0;j<list.length;j++){var a=list[j];if(a[1])e.setAttributeNS(a[1],a[0],a[2]);else e.setAttribute(a[0],a[2])}e.setAttribute("data-capture-node",id)}'
    + 'function kids(e,list,w){var out=[];for(var i=0;i<list.length;i++){var k=list[i];if(typeof k==="string"){var c=el(k)||make(k,w);if(c)out.push(c)}'
    + 'else out.push(k[0]==="t"?document.createTextNode(k[1]):document.createComment(k[1]))}e.replaceChildren.apply(e,out)}'
    + 'function make(id,w){var m=d.m[id];if(!m||!m.a[w])return null;var e=m.n==="http://www.w3.org/1999/xhtml"?document.createElement(m.t):document.createElementNS(m.n,m.t);'
    + 'el(id);cache[id]=e;attrs(e,m.a[w],id);kids(e,m.c[w],w);return e}'
    + 'function apply(){var w=near();if(w===cur)return;cur=w;for(var id in d.g){var g=d.g[id],e=el(id);if(!e||!g.a[w])continue;attrs(e,g.a[w],id);kids(e,g.c[w],w)}'
    + 'for(var id2 in d.g){var s=d.g[id2].s&&d.g[id2].s[w],e2=el(id2);if(s&&e2){e2.scrollLeft=s[0];e2.scrollTop=s[1]}}}'
    + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",apply);else apply();window.addEventListener("resize",apply)})()</script>';
}

// The exported file of a captured page: the widest width as static HTML (seen without any script), and, when other
// widths differ, the width script before </body>.
export function capturedExportHtml(capture: CapturedPage, head?: CapturedHead): string {
  const root = head === undefined ? capture.root : exportedCapturedRoot(capture.root, head);
  const widest = capture.widths[0];
  if (widest === undefined) throw new Error('a captured page has no observed width');
  const staticRoot = project(root, widest) as CapturedElement;
  const { changing, made, marked } = widthData(root, capture.widths);
  let html = capturedHtml(staticRoot, { marked });
  if (Object.keys(changing).length > 0 || Object.keys(made).length > 0) html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${widthScript(capture.widths, changing, made)}</body>`);
  const mark = staticRoot.children.find((one): one is CapturedElement => isElement(one, 'head'))
    ?.children.find((one): one is CapturedElement => isElement(one, 'meta') && one.attributes.some((attribute) => attribute.name === 'name' && attribute.value === 'builder-capture'));
  const source = mark?.attributes.find((one) => one.name === 'content')?.value;
  if (source !== undefined) {
    let origin: string | null = null;
    try {
      const url = new URL(source);
      if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin;
    } catch { /* an imported capture with an invalid source has no original-host link delegation */ }
    if (origin !== null) {
      const encoded = JSON.stringify(origin).replaceAll('<', '\\u003c');
      const links = `<script>(function(){const origin=${encoded};document.addEventListener('click',function(event){if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;const link=event.target.closest('a[href^="/"]');if(!link)return;const target=link.getAttribute('href');if(!target)return;event.preventDefault();const destination=new URL(target,origin).href;if(link.target==='_blank')window.open(destination,'_blank','noopener');else location.href=destination},true)})()</script>`;
      html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${links}</body>`);
    }
  }
  const hasPaint = (node: CapturedNode): boolean => node.kind === 'element' &&
    (node.attributes.some((one) => one.name === 'data-capture-paint') || node.children.some(hasPaint));
  if (hasPaint(root)) {
    const paint = `<script>(function(){for(const canvas of document.querySelectorAll('canvas[data-capture-paint]')){const image=new Image();image.onload=function(){const context=canvas.getContext('2d');if(context)context.drawImage(image,0,0,canvas.width,canvas.height)};image.src=canvas.getAttribute('data-capture-paint')}for(const frame of document.querySelectorAll('iframe[data-capture-paint]')){const src=frame.getAttribute('data-capture-paint');if(!src)continue;const safe=src.replaceAll('&','&amp;').replaceAll('"','&quot;');frame.setAttribute('sandbox','');frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:fill}</style></head><body><img src="'+safe+'"></body></html>'}})()</script>`;
    html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${paint}</body>`);
  }
  return html;
}

// Formatting is a view of the saved tree. The export serializer above keeps the source text and
// whitespace exactly; this reader adds line breaks only around elements with block-like children.
export function formattedCapturedHtml(root: CapturedElement): string {
  const raw = (node: CapturedNode, parent = ''): string => {
    if (node.kind === 'comment') return `<!--${node.value}-->`;
    if (node.kind === 'text') return RAW_TEXT.has(parent) ? node.value : escapeText(node.value);
    const attributes = node.attributes.map((one) => ` ${one.name}="${escapeAttribute(one.value)}"`).join('');
    const open = `<${node.tag}${attributes}>`;
    return node.namespace === HTML && VOID.has(node.tag) ? open : `${open}${node.children.map((child) => raw(child, node.tag)).join('')}</${node.tag}>`;
  };
  const lines = (node: CapturedNode, depth: number): string[] => {
    const indent = '  '.repeat(depth);
    if (node.kind !== 'element') return node.kind === 'text' && node.value.trim() === '' ? [] : [`${indent}${raw(node)}`];
    if (node.children.length === 0 || node.children.some((child) => child.kind === 'text' && child.value.trim() !== '')) return [`${indent}${raw(node)}`];
    const attributes = node.attributes.map((one) => ` ${one.name}="${escapeAttribute(one.value)}"`).join('');
    const open = `${indent}<${node.tag}${attributes}>`;
    if (node.namespace === HTML && VOID.has(node.tag)) return [open];
    return [open, ...node.children.flatMap((child) => lines(child, depth + 1)), `${indent}</${node.tag}>`];
  };
  return ['<!DOCTYPE html>', ...lines(root, 0)].join('\n');
}

export function formattedCapturedCss(source: string): string {
  let depth = 0;
  let parentheses = 0;
  let quote: string | null = null;
  let comment = false;
  let out = '';
  const newline = () => {
    out = out.trimEnd() + '\n' + '  '.repeat(depth);
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (comment) {
      out += character;
      if (character === '*' && next === '/') {
        out += next;
        index += 1;
        comment = false;
      }
      continue;
    }
    if (quote !== null) {
      out += character;
      if (character === '\\') {
        out += next;
        index += 1;
      }
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '*') {
      out += '/*';
      index += 1;
      comment = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      out += character;
      continue;
    }
    if (character === '(') {
      parentheses += 1;
      out += character;
      continue;
    }
    if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
      out += character;
      continue;
    }
    if (parentheses === 0 && character === '{') {
      out = out.trimEnd() + ' {';
      depth += 1;
      newline();
      continue;
    }
    if (parentheses === 0 && character === '}') {
      depth = Math.max(0, depth - 1);
      newline();
      out += '}';
      newline();
      continue;
    }
    if (parentheses === 0 && character === ';') {
      out = out.trimEnd() + ';';
      newline();
      continue;
    }
    out += character;
  }
  return out.trim();
}

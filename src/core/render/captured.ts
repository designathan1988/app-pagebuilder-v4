// Captured pages keep the browser's ordered DOM as project JSON. Both the editing canvas and the
// exported file read this tree; neither maps it through the authored element vocabulary.
import type { CapturedElement, CapturedNode, CapturedPage } from '../document/captured.ts';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['style']);

const escapeText = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = (value: string): string => escapeText(value).replaceAll('"', '&quot;');

export function capturedViewport(capture: CapturedPage, width: number): CapturedElement {
  const exact = capture.viewports.find((one) => one.width === width);
  if (exact !== undefined) return exact.root;
  // Between observed widths, use the nearest independently recorded document. This is a stated
  // approximation; the corpus asserts fidelity only at widths with an exact observation.
  const nearest = [...capture.viewports].sort((a, b) => Math.abs(a.width - width) - Math.abs(b.width - width))[0];
  if (nearest === undefined) throw new Error('a captured page has no viewport');
  return nearest.root;
}

export function capturedHtml(root: CapturedElement): string {
  const write = (node: CapturedNode, parent = ''): string => {
    if (node.kind === 'comment') return `<!--${node.value.replaceAll('-->', '--&gt;')}-->`;
    if (node.kind === 'text') return RAW_TEXT.has(parent) ? node.value : escapeText(node.value);
    const attributes = node.attributes.map((one) => ` ${one.name}="${escapeAttribute(one.value)}"`).join('');
    const open = `<${node.tag}${attributes}>`;
    if (node.namespace === 'http://www.w3.org/1999/xhtml' && VOID.has(node.tag)) return open;
    return `${open}${node.children.map((child) => write(child, node.tag)).join('')}</${node.tag}>`;
  };
  let html = `<!DOCTYPE html>\n${write(root)}`;
  const head = root.children.find((one): one is CapturedElement => one.kind === 'element' && one.tag === 'head');
  const mark = head?.children.find((one): one is CapturedElement => one.kind === 'element' && one.tag === 'meta'
    && one.attributes.some((attribute) => attribute.name === 'name' && attribute.value === 'builder-capture'));
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
      html = html.replace(/<\/body>/i, `${links}</body>`);
    }
  }
  const hasPaint = (node: CapturedNode): boolean => node.kind === 'element' &&
    (node.attributes.some((one) => one.name === 'data-capture-paint') || node.children.some(hasPaint));
  if (hasPaint(root)) {
    const paint = `<script>(function(){for(const canvas of document.querySelectorAll('canvas[data-capture-paint]')){const image=new Image();image.onload=function(){const context=canvas.getContext('2d');if(context)context.drawImage(image,0,0,canvas.width,canvas.height)};image.src=canvas.getAttribute('data-capture-paint')}for(const frame of document.querySelectorAll('iframe[data-capture-paint]')){const src=frame.getAttribute('data-capture-paint');if(!src)continue;const safe=src.replaceAll('&','&amp;').replaceAll('"','&quot;');frame.setAttribute('sandbox','');frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:fill}</style></head><body><img src="'+safe+'"></body></html>'}})()</script>`;
    html = html.replace(/<\/body>/i, `${paint}</body>`);
  }
  return html;
}

// What an exported captured page needs and its source may lack, added without changing what it draws: the page's
// language on <html> (as an authored page's export writes it), a <title> (the page's title setting or name) and the
// capture mark, by which an import of the export knows the page and reads its snapshots back (spec capture-url).
export interface CapturedHead {
  readonly title: string;
  readonly lang: string;
}

const HTML = 'http://www.w3.org/1999/xhtml';
const isElement = (node: CapturedNode, tag: string): node is CapturedElement => node.kind === 'element' && node.tag === tag && node.namespace === HTML;

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

const titleOf = (root: CapturedElement): string | null => {
  const head = root.children.find((one): one is CapturedElement => isElement(one, 'head'));
  const title = head?.children.find((one): one is CapturedElement => isElement(one, 'title'));
  return title === undefined ? null : title.children.map((one) => (one.kind === 'text' ? one.value : '')).join('');
};

export function capturedResponsiveHtml(capture: CapturedPage, head?: CapturedHead): string {
  const roots = capture.viewports.map((one) => ({ width: one.width, root: head === undefined ? one.root : exportedCapturedRoot(one.root, head) }));
  const first = roots[0];
  if (first === undefined) throw new Error('a captured page has no viewport');
  if (roots.length === 1) return capturedHtml(first.root);
  const variants = roots.map((one) => ({ width: one.width, html: capturedHtml(one.root) }));
  const lang = first.root.attributes.find((one) => one.name === 'lang')?.value;
  const title = titleOf(first.root) ?? head?.title ?? '';
  // Escape the script delimiter in text from a captured page. This bootstrap is Builder-owned;
  // the captured site's executable scripts were removed before they entered the document.
  const encoded = JSON.stringify(variants).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  return `<!DOCTYPE html><html${lang === undefined ? '' : ` lang="${escapeAttribute(lang)}"`}><head><meta charset="utf-8"><meta name="builder-capture" content="exported variants"><title>${escapeText(title)}</title><script>(function(){const variants=${encoded};const width=window.innerWidth;let best=variants[0];for(const one of variants){if(Math.abs(one.width-width)<Math.abs(best.width-width))best=one}document.open();document.write(best.html);document.close()})()</script></head><body></body></html>`;
}

// Formatting is a view of the saved tree. The export serializer above keeps the source text and
// whitespace exactly; this reader adds line breaks only around elements with block-like children.
export function formattedCapturedHtml(root: CapturedElement): string {
  const raw = (node: CapturedNode, parent = ''): string => {
    if (node.kind === 'comment') return `<!--${node.value}-->`;
    if (node.kind === 'text') return RAW_TEXT.has(parent) ? node.value : escapeText(node.value);
    const attributes = node.attributes.map((one) => ` ${one.name}="${escapeAttribute(one.value)}"`).join('');
    const open = `<${node.tag}${attributes}>`;
    return node.namespace === 'http://www.w3.org/1999/xhtml' && VOID.has(node.tag) ? open : `${open}${node.children.map((child) => raw(child, node.tag)).join('')}</${node.tag}>`;
  };
  const lines = (node: CapturedNode, depth: number): string[] => {
    const indent = '  '.repeat(depth);
    if (node.kind !== 'element') return node.kind === 'text' && node.value.trim() === '' ? [] : [`${indent}${raw(node)}`];
    if (node.children.length === 0 || node.children.some((child) => child.kind === 'text' && child.value.trim() !== '')) return [`${indent}${raw(node)}`];
    const attributes = node.attributes.map((one) => ` ${one.name}="${escapeAttribute(one.value)}"`).join('');
    const open = `${indent}<${node.tag}${attributes}>`;
    if (node.namespace === 'http://www.w3.org/1999/xhtml' && VOID.has(node.tag)) return [open];
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

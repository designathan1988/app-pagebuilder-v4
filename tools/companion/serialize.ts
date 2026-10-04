// The capture's reading of a page (the plan's stage 12; docs/CAPTURE-IMPORTER-ARCHITECTURE.md, Observe), apart from
// Node and Playwright so the browser extension (companion/extension) bundles the same function the Companion runs in
// Chrome (tools/companion/capture.ts). Self-contained: it runs inside the page (page.evaluate sends its source), so it
// reads nothing but the page and calls nothing outside itself.
//
// The page travels as a tree of nodes, never as HTML text: a DOM a script built may not survive being written and
// parsed again (a <div> a script put in <head> sends every later head element into <body>; HTML Standard, parsing).
// rrweb serializes the same way. What it holds:
//   - every element, text and comment node in order, with namespaces and attributes; an open shadow root is kept as
//     the host's shadow (MDN: declarative shadow DOM writes it back);
//   - a stylesheet (<link rel=stylesheet>, <style>) stays at its place as a placeholder comment naming its entry in
//     `sheets`: a <style>'s text is read from its CSSOM when the page lets it be read (CSS-in-JS libraries insert their
//     rules with insertRule and leave the element's text empty), a link is fetched by its address; adopted
//     stylesheets follow the document's (or the shadow root's) own (CSSOM: document or shadow root CSS style sheets);
//   - state: a field's value and checked state, an option's selection, a scrolled box's offsets;
//   - images marked with the source the browser chose (currentSrc), srcset candidates marked one by one, canvas and
//     video paint and frames marked for their visual fallback, same-site links marked until the crawl knows its pages;
//   - left out: scripts, <noscript>, resource hints, the capture's own style.
export interface ObservedAttribute {
  readonly name: string;
  readonly namespace: string | null;
  readonly value: string;
}
export interface ObservedState {
  readonly value?: string;
  readonly checked?: boolean;
  readonly selected?: boolean;
  readonly scrollLeft?: number;
  readonly scrollTop?: number;
}
export type ObservedNode =
  | {
    readonly kind: 'element'; readonly id: string; readonly namespace: string; readonly tag: string; readonly attributes: readonly ObservedAttribute[];
    readonly children: readonly ObservedNode[]; readonly shadow?: { readonly mode: 'open' | 'closed'; readonly children: readonly ObservedNode[] }; readonly state?: ObservedState;
  }
  | { readonly kind: 'text'; readonly id: string; readonly value: string }
  | { readonly kind: 'comment'; readonly id: string; readonly value: string };
export type ObservedElement = Extract<ObservedNode, { readonly kind: 'element' }>;

export interface PageRead {
  readonly title: string;
  readonly viewportWidth?: number;
  readonly root: ObservedElement;
  readonly sheets: readonly { readonly href: string | null; readonly text: string | null; readonly media?: string | null }[];
  readonly images: readonly { readonly index: number; readonly src: string; readonly folder?: 'img' | 'media' }[];
  readonly links: readonly string[];
  readonly scripts?: readonly { readonly src: string | null; readonly text: string; readonly type: string }[];
  readonly opaque?: readonly { readonly path: string; readonly marker: string; readonly kind: 'canvas' | 'video' | 'frame' }[];
}

export function serializePage(origin: string): PageRead {
  const HTML = 'http://www.w3.org/1999/xhtml';
  const SETTLE = 'animation-play-state:paused!important';
  const HINTS = new Set(['preload', 'modulepreload', 'prefetch', 'preconnect', 'dns-prefetch', 'prerender']);
  let next = 0;
  const id = (): string => `k${next++}`;
  const scripts = [...document.querySelectorAll('script')].map((element) => ({
    src: element.hasAttribute('src') ? element.src : null,
    text: element.textContent ?? '',
    type: element.getAttribute('type') ?? '',
  }));
  const sheets: { readonly href: string | null; readonly text: string | null; readonly media?: string | null }[] = [];
  // a stylesheet's rules as the page holds them now: its CSSOM when readable (rules inserted by a script included),
  // else null (a cross-origin sheet the page may not read)
  const cssomText = (sheet: CSSStyleSheet | null): string | null => {
    if (sheet === null) return null;
    try {
      return [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
    } catch {
      return null;
    }
  };
  const sheetPlaceholder = (entry: { readonly href: string | null; readonly text: string | null; readonly media?: string | null }): ObservedNode => {
    sheets.push(entry);
    return { kind: 'comment', id: id(), value: `__capture_sheet_${sheets.length - 1}__` };
  };
  const adopted = (list: readonly CSSStyleSheet[]): ObservedNode[] => list.flatMap((sheet) => {
    const text = cssomText(sheet);
    return text === null ? [] : [sheetPlaceholder({ href: null, text, media: null })];
  });
  const images: { readonly index: number; readonly src: string; readonly folder?: 'img' | 'media' }[] = [];
  const opaque: { path: string; marker: string; kind: 'canvas' | 'video' | 'frame' }[] = [];
  const assetMarker = (value: string, folder: 'img' | 'media' = 'img'): string => {
    if (value === '' || value.startsWith('#') || !URL.canParse(value, document.baseURI)) return value;
    const source = new URL(value, document.baseURI).href;
    if (!['http:', 'https:', 'data:'].includes(new URL(source).protocol)) return value;
    const index = images.length;
    images.push({ index, src: source, folder });
    return `__capture_image_${index}__`;
  };
  // HTML's srcset parser treats a comma inside a URL differently from a separator after a descriptor.
  // Keep the candidate grammar and descriptors, replacing only each candidate URL with a localizable marker.
  const markedSrcset = (value: string): string => {
    const replacements: { readonly start: number; readonly end: number; readonly value: string }[] = [];
    const space = (character: string | undefined): boolean => character !== undefined && /[\t\n\f\r ]/.test(character);
    let at = 0;
    while (at < value.length) {
      while (at < value.length && (space(value[at]) || value[at] === ',')) at += 1;
      const start = at;
      while (at < value.length && !space(value[at])) at += 1;
      let end = at;
      while (end > start && value[end - 1] === ',') end -= 1;
      const candidate = value.slice(start, end);
      if (candidate !== '' && URL.canParse(candidate, document.baseURI)) {
        const source = new URL(candidate, document.baseURI).href;
        const index = images.length;
        images.push({ index, src: source });
        replacements.push({ start, end, value: `__capture_image_${index}__` });
      }
      // After a URL without a trailing comma, descriptors end at a comma outside parentheses.
      if (end === at) {
        let depth = 0;
        while (at < value.length) {
          const character = value[at];
          at += 1;
          if (character === '(') depth += 1;
          else if (character === ')') depth = Math.max(0, depth - 1);
          else if (character === ',' && depth === 0) break;
        }
      }
    }
    let marked = value;
    for (const replacement of replacements.reverse()) marked = marked.slice(0, replacement.start) + replacement.value + marked.slice(replacement.end);
    return marked;
  };
  const links: string[] = [];
  const linkMark = (raw: string): string => {
    if (raw === '' || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw) || !URL.canParse(raw, document.baseURI)) return raw;
    const at = new URL(raw, document.baseURI);
    if (at.origin !== origin) return at.href;
    links.push(`${at.origin}${at.pathname}`);
    return `__capture_link__${at.origin}${at.pathname}__${at.hash}__`;
  };
  const stateOf = (element: Element): ObservedState | undefined => {
    const state: { -readonly [K in keyof ObservedState]: ObservedState[K] } = {};
    if (element instanceof HTMLInputElement) {
      // only a field whose value a person types (the HTML Standard's "value" mode): a checkbox answers "on" by default,
      // and a password or file is never kept
      const typed = !['checkbox', 'radio', 'file', 'password', 'hidden', 'submit', 'reset', 'button', 'image'].includes(element.type);
      if (typed && element.value !== element.defaultValue) state.value = element.value;
      if (element.checked !== element.defaultChecked) state.checked = element.checked;
    }
    if (element instanceof HTMLTextAreaElement && element.value !== element.defaultValue) state.value = element.value;
    if (element instanceof HTMLOptionElement && element.selected !== element.defaultSelected) state.selected = element.selected;
    if (element.scrollLeft !== 0) state.scrollLeft = element.scrollLeft;
    if (element.scrollTop !== 0 && element !== document.documentElement && element !== document.body) state.scrollTop = element.scrollTop;
    return Object.keys(state).length === 0 ? undefined : state;
  };
  const read = (node: Node): ObservedNode | null => {
    if (node.nodeType === Node.TEXT_NODE) return { kind: 'text', id: id(), value: node.nodeValue ?? '' };
    if (node.nodeType === Node.COMMENT_NODE) return { kind: 'comment', id: id(), value: node.nodeValue ?? '' };
    if (!(node instanceof Element)) return null;
    const tag = node.localName;
    const html = node.namespaceURI === HTML;
    if (html && (tag === 'script' || tag === 'noscript')) return null;
    if (html && tag === 'link') {
      const rel = (node.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
      if (rel.some((one) => HINTS.has(one))) return null;
      if (rel.includes('stylesheet') && node.hasAttribute('href')) return sheetPlaceholder({ href: (node as HTMLLinkElement).href, text: null, media: node.getAttribute('media')?.trim() || null });
    }
    if (html && tag === 'style') {
      const style = node as HTMLStyleElement;
      if ((style.textContent ?? '').includes(SETTLE)) return null;
      return sheetPlaceholder({ href: null, text: cssomText(style.sheet) ?? style.textContent ?? '', media: node.getAttribute('media')?.trim() || null });
    }
    const attributes: ObservedAttribute[] = [];
    for (const attribute of node.attributes) {
      const name = attribute.name;
      let value = attribute.value;
      if (name === 'data-capture-runtime') continue;
      if (html && tag === 'img' && name === 'src') continue;
      if (html && tag === 'img' && name === 'loading') continue;
      if ((html && (tag === 'img' || tag === 'source') && name === 'srcset')) value = markedSrcset(value);
      else if (html && (tag === 'video' || tag === 'iframe') && (name === 'src' || name === 'srcdoc' || name === 'autoplay')) continue;
      else if (html && tag === 'video' && name === 'poster') continue;
      else if (['src', 'poster'].includes(name) || (name === 'data' && tag === 'object')) value = assetMarker(value, ['video', 'audio', 'source', 'track'].includes(tag) && name === 'src' ? 'media' : 'img');
      else if (((tag === 'image' && !html) || (html && tag === 'link' && /\bicon\b/i.test(node.getAttribute('rel') ?? ''))) && (name === 'href' || name === 'xlink:href')) value = assetMarker(value);
      else if (html && tag === 'a' && name === 'href') value = linkMark(value);
      attributes.push({ name, namespace: attribute.namespaceURI, value });
    }
    if (html && tag === 'img') {
      const image = node as HTMLImageElement;
      const src = image.currentSrc || image.getAttribute('src') || '';
      const index = images.length;
      images.push({ index, src: src === '' ? '' : new URL(src, document.baseURI).href });
      attributes.push({ name: 'src', namespace: null, value: `__capture_image_${index}__` });
    }
    if (html && tag === 'canvas') {
      let paint: string;
      try {
        paint = assetMarker((node as HTMLCanvasElement).toDataURL('image/png'));
      } catch {
        paint = `__capture_opaque_${opaque.length}__`;
        opaque.push({ path: node.getAttribute('data-capture-runtime') ?? '', marker: paint, kind: 'canvas' });
      }
      attributes.push({ name: 'data-capture-paint', namespace: null, value: paint });
    }
    if (html && tag === 'video') {
      const marker = `__capture_opaque_${opaque.length}__`;
      opaque.push({ path: node.getAttribute('data-capture-runtime') ?? '', marker, kind: 'video' });
      attributes.push({ name: 'poster', namespace: null, value: marker });
      for (const source of node.querySelectorAll('source[src]')) assetMarker(source.getAttribute('src') ?? '', 'media');
      const own = node.getAttribute('src');
      if (own !== null) assetMarker(own, 'media');
    }
    if (html && tag === 'iframe') {
      const marker = `__capture_opaque_${opaque.length}__`;
      opaque.push({ path: node.getAttribute('data-capture-runtime') ?? '', marker, kind: 'frame' });
      attributes.push({ name: 'data-capture-paint', namespace: null, value: marker });
    }
    const childOf = html && tag === 'template' ? (node as HTMLTemplateElement).content.childNodes : node.childNodes;
    const children = [...childOf].flatMap((child) => read(child) ?? []);
    const root = node.shadowRoot;
    const shadow = root === null ? undefined : { mode: root.mode, children: [...[...root.childNodes].flatMap((child) => read(child) ?? []), ...adopted(root.adoptedStyleSheets)] };
    const state = stateOf(node);
    return { kind: 'element', id: id(), namespace: node.namespaceURI ?? HTML, tag, attributes, children, ...(shadow === undefined ? {} : { shadow }), ...(state === undefined ? {} : { state }) };
  };
  const root = read(document.documentElement);
  if (root === null || root.kind !== 'element') throw new Error('the page has no document element');
  // The document's adopted stylesheets come after its own sheets: written last in its body.
  const extra = adopted(document.adoptedStyleSheets);
  // A root runtime style is kept as the root's own style attribute; it also takes a last sheet of its own, so the
  // project's stylesheet ranks it as the page did (spec capture-url).
  const rootStyle = document.documentElement.getAttribute('style')?.trim();
  if (rootStyle) extra.push(sheetPlaceholder({ href: null, text: `html:root{${rootStyle}}`, media: null }));
  const withExtra = extra.length === 0 ? root : {
    ...root,
    children: root.children.map((child) => (child.kind === 'element' && child.tag === 'body' && child.namespace === HTML ? { ...child, children: [...child.children, ...extra] } : child)),
  };
  return { title: document.title, viewportWidth: window.innerWidth, root: withExtra, sheets, images: images.filter((one) => one.src !== ''), links, scripts, opaque };
}

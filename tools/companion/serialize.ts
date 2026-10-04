// The capture's reading of a page (the plan's stage 12), apart from Node and Playwright so the browser extension
// (companion/extension) bundles the same function the Companion runs in Chrome (tools/companion/capture.ts).
// What a page holds as its scripts left it (run in the page: by Playwright for the Companion's capture, by the
// browser extension in the person's own tab): its markup with the shadow DOM flattened, scripts and the settle style
// left out, its sheets in order, its images, its links to other pages of the site (each marked until the crawl knows
// which pages it took) and the custom elements it met. Self-contained: it reads nothing but the page.
export interface PageRead {
  readonly title: string;
  readonly viewportWidth?: number;
  readonly html: string;
  readonly sheets: readonly { readonly href: string | null; readonly text: string | null; readonly scope: string | null; readonly media?: string | null }[];
  readonly images: readonly { readonly index: number; readonly src: string; readonly folder?: 'img' | 'media' }[];
  readonly links: readonly string[];
  readonly scripts?: readonly { readonly src: string | null; readonly text: string; readonly type: string }[];
  readonly opaque?: readonly { readonly path: string; readonly marker: string; readonly kind: 'canvas' | 'video' | 'frame' }[];
}
export function serializePage(origin: string): PageRead {
  const scripts = [...document.querySelectorAll('script')].map((element) => ({
    src: element.hasAttribute('src') ? element.src : null,
    text: element.textContent ?? '',
    type: element.getAttribute('type') ?? '',
  }));
  const sheets: { readonly href: string | null; readonly text: string | null; readonly scope: string | null; readonly media?: string | null }[] = [];
  const lightSheets = new Map<Element, number>();
  for (const el of document.querySelectorAll('link[rel~="stylesheet"][href], style')) {
    const media = el.getAttribute('media')?.trim() || null;
    if (el instanceof HTMLLinkElement) {
      lightSheets.set(el, sheets.length);
      sheets.push({ href: el.href, text: null, scope: null, media });
    }
    else if (el.textContent !== null && !el.textContent.includes('animation-play-state:paused!important')) {
      lightSheets.set(el, sheets.length);
      sheets.push({ href: null, text: el.textContent, scope: null, media });
    }
  }
  // Existing capture packages expose root runtime declarations as the last sheet. Keep that
  // representation while the captured DOM also retains the literal, higher-priority inline style.
  const rootStyle = document.documentElement.getAttribute('style')?.trim();
  if (rootStyle) sheets.push({ href: null, text: `html:root{${rootStyle}}`, scope: null });
  // The page as it is drawn, shadow DOM flattened (the plan's stage 12): a host's open shadow root stands in its
  // place, a <slot> holds the nodes assigned to it (its own fallback when none is), and the host's light children
  // that no slot takes are not drawn, so they go; a shadow root's styles join the page's sheets, :host written as
  // the host's own tag. An image is marked with the source the browser chose for it (its currentSrc).
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
  // `shadowed`: the node lies in a shadow tree or is slotted into one, where the rules that hide it (a closed
  // dropdown's slot, :host(:not([open]))) do not survive the flattening: an element the page does not draw there
  // comes hidden (kept, not drawn), as the page showed it
  const flat = (node: Node, shadowed = false): Node | null => {
    if (!(node instanceof Element)) return node.cloneNode(false);
    if (node instanceof HTMLStyleElement && (node.textContent ?? '').includes('animation-play-state:paused!important')) return null;
    const sheet = lightSheets.get(node);
    if (sheet !== undefined) return document.createComment(`__capture_sheet_${sheet}__`);
    const copy = node.cloneNode(false) as Element;
    const undrawn = shadowed && getComputedStyle(node).display === 'none';
    if (undrawn) copy.setAttribute('hidden', '');
    // the classes the markup gave it, kept apart: the import may make a class the element's own styles and drop
    // it, and the residual stylesheet's rules name these (core/import residualCss)
    if (copy.getAttribute('class')) copy.setAttribute('data-capture-class', copy.getAttribute('class') as string);
    if (node instanceof HTMLCanvasElement) {
      try {
        copy.setAttribute('data-capture-paint', assetMarker(node.toDataURL('image/png')));
      }
      catch {
        const marker = `__capture_opaque_${opaque.length}__`;
        copy.setAttribute('data-capture-paint', marker);
        opaque.push({ path: node.getAttribute('data-capture-runtime') ?? '', marker, kind: 'canvas' });
      }
      return copy;
    }
    if (node instanceof HTMLVideoElement) {
      const marker = `__capture_opaque_${opaque.length}__`;
      copy.removeAttribute('src');
      copy.removeAttribute('autoplay');
      copy.setAttribute('poster', marker);
      opaque.push({ path: node.getAttribute('data-capture-runtime') ?? '', marker, kind: 'video' });
      for (const source of node.querySelectorAll('source[src]')) {
        const address = source.getAttribute('src');
        if (address !== null) assetMarker(address, 'media');
      }
      const ownSource = node.getAttribute('src');
      if (ownSource !== null) assetMarker(ownSource, 'media');
      return copy;
    }
    if (node instanceof HTMLIFrameElement) {
      const marker = `__capture_opaque_${opaque.length}__`;
      copy.removeAttribute('src');
      copy.removeAttribute('srcdoc');
      copy.setAttribute('data-capture-paint', marker);
      opaque.push({ path: node.getAttribute('data-capture-runtime') ?? '', marker, kind: 'frame' });
      return copy;
    }
    if (node instanceof HTMLSourceElement) {
      const srcset = node.getAttribute('srcset');
      if (srcset !== null) copy.setAttribute('srcset', markedSrcset(srcset));
    }
    if (node instanceof HTMLImageElement) {
      const src = node.currentSrc || node.getAttribute('src') || '';
      const index = images.length;
      copy.removeAttribute('loading');
      copy.setAttribute('src', `__capture_image_${index}__`);
      images.push({ index, src: src === '' ? '' : new URL(src, document.baseURI).href });
      const srcset = node.getAttribute('srcset');
      if (srcset !== null) copy.setAttribute('srcset', markedSrcset(srcset));
      return copy;
    }
    const media = node.localName === 'video' || node.localName === 'audio' || node.localName === 'source' || node.localName === 'track';
    for (const name of ['src', 'poster', 'data']) {
      const original = node.getAttribute(name);
      if (original === null || (name === 'data' && node.localName !== 'object')) continue;
      copy.setAttribute(name, assetMarker(original, media && name === 'src' ? 'media' : 'img'));
    }
    if ((node.localName === 'image' && node.namespaceURI === 'http://www.w3.org/2000/svg') || (node.localName === 'link' && (node.getAttribute('rel') ?? '').split(/\s+/).includes('icon'))) {
      for (const name of ['href', 'xlink:href']) {
        const original = node.getAttribute(name);
        if (original !== null) copy.setAttribute(name, assetMarker(original));
      }
    }
    const root = node.shadowRoot;
    if (root !== null) {
      const tag = node.localName;
      for (const style of root.querySelectorAll('style')) if (style.textContent !== null) sheets.push({ href: null, text: style.textContent, scope: tag, media: style.getAttribute('media')?.trim() || null });
      for (const sheet of root.adoptedStyleSheets) {
        try {
          sheets.push({ href: null, text: [...sheet.cssRules].map((rule) => rule.cssText).join('\n'), scope: tag });
        } catch {
          // a sheet whose rules cannot be read is left out
        }
      }
    }
    const children = root === null ? [...node.childNodes] : [...root.childNodes];
    for (const child of children) {
      if (child instanceof HTMLStyleElement && root !== null) continue;
      if (child instanceof HTMLSlotElement) {
        const assigned = child.assignedNodes({ flatten: true });
        // a slot the page does not draw draws none of what it holds
        const shut = getComputedStyle(child).display === 'none';
        for (const one of assigned.length > 0 ? assigned : [...child.childNodes]) {
          const made = flat(one, true);
          if (made instanceof Element && shut) made.setAttribute('hidden', '');
          if (made !== null && (!shut || made instanceof Element)) copy.append(made);
        }
        continue;
      }
      const made = flat(child, shadowed || root !== null);
      if (made !== null) copy.append(made);
    }
    return copy;
  };
  const clone = flat(document.documentElement) as HTMLElement;
  // Keep root classes on <html>; a variable defined there cannot be inherited upward from <body>.
  const body = clone.querySelector('body');
  if (body !== null) {
    for (const attribute of document.documentElement.attributes) if (attribute.name.startsWith('data-') && attribute.name !== 'data-capture-class' && !body.hasAttribute(attribute.name)) body.setAttribute(attribute.name, attribute.value);
  }
  for (const el of clone.querySelectorAll('script, noscript, link[rel="preload"], link[rel="modulepreload"]')) el.remove();
  // an image with no source keeps none (its mark is cleared once the sources are written)
  const sourced = images.filter((one) => one.src !== '');
  const links: string[] = [];
  clone.querySelectorAll('a[href]').forEach((a) => {
    const raw = a.getAttribute('href') ?? '';
    if (raw === '' || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) return;
    const at = new URL(raw, document.baseURI);
    if (at.origin !== origin) {
      a.setAttribute('href', at.href);
      return;
    }
    a.setAttribute('href', `__capture_link__${at.origin}${at.pathname}__${at.hash}__`);
    links.push(`${at.origin}${at.pathname}`);
  });
  return { title: document.title, viewportWidth: window.innerWidth, html: `<!doctype html>\n${clone.outerHTML}`, sheets, images: sourced, links, scripts, opaque };
}

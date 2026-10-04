// The capture's reading of a page (the plan's stage 12), apart from Node and Playwright so the browser extension
// (companion/extension) bundles the same function the Companion runs in Chrome (tools/companion/capture.ts).
// What a page holds as its scripts left it (run in the page: by Playwright for the Companion's capture, by the
// browser extension in the person's own tab): its markup with the shadow DOM flattened, scripts and the settle style
// left out, its sheets in order, its images, its links to other pages of the site (each marked until the crawl knows
// which pages it took) and the custom elements it met. Self-contained: it reads nothing but the page.
export interface PageRead {
  readonly title: string;
  readonly html: string;
  readonly sheets: readonly { readonly href: string | null; readonly text: string | null; readonly scope: string | null; readonly media?: string | null }[];
  readonly images: readonly { readonly index: number; readonly src: string }[];
  readonly links: readonly string[];
  readonly custom: readonly string[];
}
export function serializePage(origin: string): PageRead {
  const sheets: { readonly href: string | null; readonly text: string | null; readonly scope: string | null; readonly media?: string | null }[] = [];
  for (const el of document.querySelectorAll('link[rel~="stylesheet"][href], style')) {
    const media = el.getAttribute('media')?.trim() || null;
    if (el instanceof HTMLLinkElement) sheets.push({ href: el.href, text: null, scope: null, media });
    else if (el.textContent !== null && !el.textContent.includes('animation-play-state:paused!important')) sheets.push({ href: null, text: el.textContent, scope: null, media });
  }
  // Scripts often set layout variables on <html> itself. The document model keeps no root style attribute, so
  // retain its declarations as the last sheet: the residual capture CSS keeps the html rule on canvas and export.
  const rootStyle = document.documentElement.getAttribute('style')?.trim();
  if (rootStyle) sheets.push({ href: null, text: `html:root{${rootStyle}}`, scope: null });
  // the custom elements met (a tag with a dash): each becomes a div wearing the class ce-<tag>, which the page's
  // and the shadow roots' rules are rewritten to (scopeCss), so the import keeps it as an element instead of
  // unwrapping it, and a shadow root's rules stay within their host
  const custom = new Set<string>();
  // The page as it is drawn, shadow DOM flattened (the plan's stage 12): a host's open shadow root stands in its
  // place, a <slot> holds the nodes assigned to it (its own fallback when none is), and the host's light children
  // that no slot takes are not drawn, so they go; a shadow root's styles join the page's sheets, :host written as
  // the host's own tag. An image is marked with the source the browser chose for it (its currentSrc).
  const images: { readonly index: number; readonly src: string }[] = [];
  // `shadowed`: the node lies in a shadow tree or is slotted into one, where the rules that hide it (a closed
  // dropdown's slot, :host(:not([open]))) do not survive the flattening: an element the page does not draw there
  // comes hidden (kept, not drawn), as the page showed it
  const flat = (node: Node, shadowed = false): Node | null => {
    if (!(node instanceof Element)) return node.cloneNode(false);
    let copy = node.cloneNode(false) as Element;
    const undrawn = shadowed && getComputedStyle(node).display === 'none';
    if (node.localName.includes('-')) {
      custom.add(node.localName);
      copy = document.createElement('div');
      for (const attribute of node.attributes) copy.setAttribute(attribute.name, attribute.value);
      copy.classList.add(`ce-${node.localName}`);
    }
    if (undrawn) copy.setAttribute('hidden', '');
    // the classes the markup gave it, kept apart: the import may make a class the element's own styles and drop
    // it, and the residual stylesheet's rules name these (core/import residualCss)
    if (copy.getAttribute('class')) copy.setAttribute('data-capture-class', copy.getAttribute('class') as string);
    if (node instanceof HTMLImageElement) {
      const src = node.currentSrc || node.getAttribute('src') || '';
      const index = images.length;
      copy.removeAttribute('srcset');
      copy.removeAttribute('loading');
      copy.setAttribute('src', `__capture_image_${index}__`);
      images.push({ index, src: src === '' ? '' : new URL(src, document.baseURI).href });
      return copy;
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
  for (const el of clone.querySelectorAll('script, noscript, link[rel~="stylesheet"], style, link[rel="preload"], link[rel="modulepreload"]')) el.remove();
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
  return { title: document.title, html: `<!doctype html>\n${clone.outerHTML}`, sheets, images: sourced, links, custom: [...custom] };
}

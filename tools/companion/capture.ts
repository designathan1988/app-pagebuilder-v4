// The Builder Companion's capture (the plan's stage 12, "abrir qualquer URL"): a browser page cannot read another
// site (CORS), so this Node process opens the address in the installed Chrome (Playwright, channel chrome), waits for
// the network to rest, scrolls to the end so lazy content loads, stops animations, and reads the page as its scripts
// left it: the DOM, every stylesheet (a linked one fetched whole, of any origin; a <style> as written), and the images,
// fonts and backgrounds they name, downloaded. With `pages` above one it follows the links to other pages of the same
// site, breadth first, up to that many pages. It hands back the files of a static copy — each page at a path like its
// address (index.html, about/index.html), css/, img/, fonts/ — every reference rewritten to them, and a link between
// two captured pages written from one file to the other: the files File › Import HTML takes
// (src/core/import/import.ts).
import fs from 'node:fs';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { generate as generateCss, parse as parseCss, walk as walkCss, type CssNode } from 'css-tree';
import { serializePage, type PageRead } from './serialize.ts';

export { serializePage, type PageRead } from './serialize.ts';

export interface CapturedFile {
  readonly path: string;
  readonly type: string;
  readonly base64: string;
}
export interface Capture {
  readonly title: string;
  readonly files: readonly CapturedFile[];
}

const TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
const extensionOf = (url: string, type: string): string => {
  const fromPath = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  if (fromPath !== undefined && fromPath in TYPES) return fromPath;
  const fromType = Object.entries(TYPES).find(([, t]) => type.startsWith(t))?.[0];
  return fromType ?? 'bin';
};
const isHttp = (url: string) => /^https?:$/.test(new URL(url).protocol);
// the most pages one capture follows
const MOST_PAGES = 30;

let shared: Browser | null = null;
async function browser(): Promise<Browser> {
  if (shared === null || !shared.isConnected()) shared = await chromium.launch({ channel: 'chrome' });
  return shared;
}
export async function closeBrowser(): Promise<void> {
  await shared?.close();
  shared = null;
}

// scrolls the page to its end and back, so lazy images and sections load, then stops every animation and transition
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}' });
}

// The project path a page of the site takes, from its address: / is index.html, /about/ about/index.html, /about
// about.html, /a.html a.html (the query and the fragment aside).
export function pagePath(url: string): string {
  const path = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
  if (path === '' || path.endsWith('/')) return `${path}index.html`;
  return /\.html?$/i.test(path) ? path : `${path}.html`;
}
// an address as a page of the site: no fragment, no query
const pageKey = (url: string): string => {
  const at = new URL(url);
  return `${at.origin}${at.pathname}`;
};
// a project path written from a page's own folder (img/a.png from about/index.html is ../img/a.png)
const fromPage = (page: string, target: string): string => '../'.repeat(page.split('/').length - 1) + target;
// A sheet's rules with its custom elements' tags written as the class their divs wear (mdn-dropdown is
// .ce-mdn-dropdown), and, for a shadow root's sheet (`scope`, its host's tag), every rule kept within its host: :host
// is the host itself, ::slotted(x) an x inside it, any other selector a descendant of it. A sheet that does not parse
// is kept as it is.
export function scopeCss(text: string, scope: string | null, custom: ReadonlySet<string>): string {
  if (scope === null && custom.size === 0) return text;
  let ast: CssNode;
  try {
    ast = parseCss(text);
  } catch {
    return text;
  }
  walkCss(ast, {
    visit: 'Rule',
    enter(rule) {
      if (rule.prelude.type !== 'SelectorList' || (this.atrule !== null && /keyframes$/i.test(this.atrule.name))) return;
      const selectors = rule.prelude.children.toArray().map((selector) => {
        let out = generateCss(selector).replace(/(^|[\s>+~(,])([a-z][a-z0-9]*-[a-z0-9-]*)(?=[\s>+~.#:[)]|$)/g, (all, before: string, tag: string) => (custom.has(tag) ? `${before}.ce-${tag}` : all));
        if (scope !== null) {
          out = out.replace(/::slotted\(([^)]*)\)/g, '$1');
          out = /:host\b/.test(out) ? out.replace(/:host\(([^)]*)\)/g, `.ce-${scope}$1`).replace(/:host\b/g, `.ce-${scope}`) : `.ce-${scope} ${out}`;
        }
        return out;
      });
      try {
        rule.prelude = parseCss(selectors.join(','), { context: 'selectorList' }) as typeof rule.prelude;
      } catch {
        // a selector the rewrite could not keep leaves the rule as it was
      }
    },
  });
  return generateCss(ast);
}

// a link between two pages of the project, written from one's folder to the other
function between(from: string, to: string): string {
  const base = from.split('/').slice(0, -1);
  const parts = to.split('/');
  while (base.length > 0 && parts.length > 1 && base[0] === parts[0]) {
    base.shift();
    parts.shift();
  }
  return '../'.repeat(base.length) + parts.join('/');
}

// a file the site serves: whether it answered, its type and its bytes
export interface Fetched {
  readonly ok: boolean;
  readonly type: string;
  readonly body: Buffer;
}
type Fetcher = (url: string) => Promise<Fetched | null>;

// The files of a static copy, built page by page from what each page held (serializePage) and the files the site
// serves, through a fetcher: the network, a HAR record, or what the browser extension read in the person's tab.
function siteBuilder(fetched: Fetcher) {
  const files: CapturedFile[] = [];
  const assets = new Map<string, string>();
  const sheetPaths = new Map<string, string>();
  // the custom elements the pages met so far (each a div wearing ce-<tag>)
  const customTags = new Set<string>();
  let inline = 0;
  // one asset of the site downloaded once, under its folder, by the order it was met
  const fetchAsset = async (url: string, folder: string): Promise<string | null> => {
    const known = assets.get(url);
    if (known !== undefined) return known;
    if (url.startsWith('data:')) return null;
    const response = await fetched(url);
    if (response === null || !response.ok) return null;
    const type = response.type;
    const path = `${folder}/${folder}-${assets.size + 1}.${extensionOf(url, type)}`;
    assets.set(url, path);
    files.push({ path, type: TYPES[extensionOf(url, type)] ?? (type.split(';')[0] ?? 'application/octet-stream'), base64: response.body.toString('base64') });
    return path;
  };
  // CSS imports are syntax nodes: a quoted URL may itself contain a semicolon (a Google Fonts axis list).
  // Their source ranges also keep the asset pass from treating an imported stylesheet as an image.
  const importsOf = (text: string): { start: number; end: number; url: string }[] => {
    let ast: CssNode;
    try {
      ast = parseCss(text, { positions: true });
    } catch {
      return [];
    }
    if (ast.type !== 'StyleSheet') return [];
    return ast.children.toArray().flatMap((rule) => {
      if (rule.type !== 'Atrule' || rule.name.toLowerCase() !== 'import' || rule.loc === null || rule.loc === undefined || rule.prelude?.type !== 'AtrulePrelude') return [];
      const values = rule.prelude.children.toArray();
      if (values.length !== 1) return [];
      const source = values[0];
      return source?.type === 'String' || source?.type === 'Url' ? [{ start: rule.loc.start.offset, end: rule.loc.end.offset, url: source.value }] : [];
    });
  };
  // a sheet with every url() it names downloaded (fonts to fonts/, the rest to img/), written from css/
  const localSheet = async (text: string, sheetUrl: string): Promise<string> => {
    let out = text;
    const imports = importsOf(text);
    const assetsToReplace: { start: number; end: number; value: string }[] = [];
    for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const start = match.index;
      if (start === undefined || imports.some((rule) => start >= rule.start && start < rule.end)) continue;
      const raw = match[2] ?? '';
      if (raw.startsWith('data:') || raw.startsWith('#')) continue;
      const absolute = new URL(raw, sheetUrl).href;
      const font = /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(absolute);
      const local = await fetchAsset(absolute, font ? 'fonts' : 'img');
      if (local !== null) assetsToReplace.push({ start, end: start + match[0].length, value: `url("../${local}")` });
    }
    for (const one of assetsToReplace.reverse()) out = out.slice(0, one.start) + one.value + out.slice(one.end);
    // an @import is fetched and laid in its place
    const sheetsToReplace: { start: number; end: number; value: string }[] = [];
    for (const rule of importsOf(out)) {
      const absolute = new URL(rule.url, sheetUrl).href;
      const response = await fetched(absolute);
      const inner = response !== null && response.ok ? await localSheet(response.body.toString('utf8'), absolute) : '';
      sheetsToReplace.push({ start: rule.start, end: rule.end, value: inner });
    }
    for (const one of sheetsToReplace.reverse()) out = out.slice(0, one.start) + one.value + out.slice(one.end);
    return out;
  };
  // a page's file: its markup with its sheets linked, its images and backgrounds downloaded, and the capture's mark
  const pageOf = async (read: PageRead, base: string): Promise<{ readonly path: string; html: string }> => {
    const path = pagePath(base);
    const sheetLinks: string[] = [];
    for (const tag of read.custom) customTags.add(tag);
    // a custom element is inline unless a rule says otherwise, as the browser draws one; the div it became is not
    if (read.custom.length > 0) {
      inline += 1;
      const at = `css/inline-${inline}.css`;
      files.push({ path: at, type: 'text/css', base64: Buffer.from(read.custom.map((tag) => `.ce-${tag}{display:inline}`).join('\n'), 'utf8').toString('base64') });
      sheetLinks.push(`<link rel="stylesheet" href="${fromPage(path, at)}">`);
    }
    for (const sheet of read.sheets) {
      let at: string | undefined;
      const media = sheet.media?.trim() ?? '';
      const conditioned = (css: string): string => media === '' || media.toLowerCase() === 'all' ? css : `@media ${media}{${css}}`;
      if (sheet.href !== null) {
        const key = `${sheet.href}\u0000${media}`;
        at = sheetPaths.get(key);
        if (at === undefined) {
          const got = await fetched(sheet.href);
          if (got === null || !got.ok) continue;
          at = `css/style-${sheetPaths.size + 1}.css`;
          sheetPaths.set(key, at);
          files.push({ path: at, type: 'text/css', base64: Buffer.from(conditioned(await localSheet(scopeCss(got.body.toString('utf8'), null, customTags), sheet.href)), 'utf8').toString('base64') });
        }
      } else if (sheet.text !== null) {
        inline += 1;
        at = `css/inline-${inline}.css`;
        files.push({ path: at, type: 'text/css', base64: Buffer.from(conditioned(await localSheet(scopeCss(sheet.text, sheet.scope, customTags), base)), 'utf8').toString('base64') });
      }
      if (at !== undefined) sheetLinks.push(`<link rel="stylesheet" href="${fromPage(path, at)}">`);
    }
    let html = read.html;
    for (const image of read.images) {
      const local = await fetchAsset(image.src, 'img');
      html = html.split(`__capture_image_${image.index}__`).join(local === null ? image.src : fromPage(path, local));
    }
    // an image that named no source keeps none
    html = html.replace(/__capture_image_\d+__/g, '');
    // inline style="background-image:url(…)" of the markup, downloaded too
    for (const match of html.matchAll(/url\(\s*(?:&quot;|['"])?([^'")&]+)(?:&quot;|['"])?\s*\)/g)) {
      const raw = match[1] ?? '';
      if (raw.startsWith('data:') || raw.startsWith('__capture')) continue;
      const local = await fetchAsset(new URL(raw, base).href, 'img');
      if (local !== null) html = html.split(match[0]).join(`url(${fromPage(path, local)})`);
    }
    // the mark of a captured page: the import keeps what the model does not hold of its sheets (spec capture-url)
    const mark = `<meta name="builder-capture" content="${base.replaceAll('"', '&quot;')}">`;
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${mark}\n${sheetLinks.join('\n')}`);
    return { path, html };
  };
  return { files, pageOf };
}

// the pages' files, a link to a page the crawl took written to that page's file and any other keeping its address
function pageFiles(captured: ReadonlyMap<string, { readonly path: string; html: string }>): CapturedFile[] {
  for (const [, one] of captured) {
    one.html = one.html.replace(/__capture_link__(.*?)__(#[^"]*?)?__/g, (_all, url: string, hash: string | undefined) => {
      const target = captured.get(url);
      return `${target === undefined ? url : between(one.path, target.path)}${hash ?? ''}`;
    });
  }
  return [...captured.values()].map((one): CapturedFile => ({ path: one.path, type: 'text/html', base64: Buffer.from(one.html, 'utf8').toString('base64') }));
}

// A recorded site (a HAR file with its contents embedded, Playwright's recordHar): the capture reads the page and every
// file it fetches from the record instead of the network, so a capture of the corpus is the same every run
// (tools/capture/corpus.capture.ts; Playwright, "Mock APIs: replaying from HAR").
interface Recorded {
  readonly status: number;
  readonly type: string;
  readonly body: Buffer;
}
function harEntries(file: string): Map<string, Recorded> {
  const har = JSON.parse(fs.readFileSync(file, 'utf8')) as { log: { entries: { request: { url: string }; response: { status: number; content: { mimeType?: string; text?: string; encoding?: string } } }[] } };
  const out = new Map<string, Recorded>();
  for (const { request, response } of har.log.entries) {
    const text = response.content.text ?? '';
    out.set(request.url, { status: response.status, type: response.content.mimeType ?? '', body: Buffer.from(text, response.content.encoding === 'base64' ? 'base64' : 'utf8') });
  }
  return out;
}

// An unfinished request in the record has no response to replay. Abort it as the original navigation saw it fail;
// leaving Playwright to serve that HAR entry can keep a parser-blocking stylesheet pending forever.
export async function replayHar(context: BrowserContext, file: string): Promise<void> {
  await context.routeFromHAR(file, { notFound: 'abort' });
  const failed = new Set([...harEntries(file)].filter(([, response]) => response.status < 0).map(([url]) => url));
  if (failed.size > 0) await context.route((url) => failed.has(url.href), (route) => route.abort());
}

interface InlineSnapshot { readonly id: string; readonly tag: string; readonly style: string; readonly src: string | null }

async function markRuntime(page: Page): Promise<void> {
  await page.evaluate(() => {
    const visit = (parent: Element, path: string): void => {
      [...parent.children].forEach((element, index) => {
        const next = path === '' ? String(index) : `${path}.${index}`;
        element.setAttribute('data-capture-runtime', next);
        visit(element, next);
      });
    };
    visit(document.body, '');
  });
}

// Keep the values a site's scripts write at the four reference widths. Each width opens afresh, since initialization
// can differ from a resize. The captured DOM stays one editable tree: only changing inline declarations move into a
// responsive source sheet, matched by stable body path when the same element survives across widths.
async function responsiveInline(page: Page, read: PageRead, url: string, timeout: number): Promise<PageRead> {
  const snapshots: InlineSnapshot[][] = [];
  const readSnapshot = () => page.evaluate(() => [...document.body.querySelectorAll<HTMLElement>('[data-capture-runtime]')].map((el) => ({
    id: el.getAttribute('data-capture-runtime') ?? '', tag: el.localName, style: el.getAttribute('style') ?? '',
    src: el instanceof HTMLImageElement ? el.currentSrc : null,
  })));
  snapshots.push(await readSnapshot());
  for (const width of [1180, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await settle(page);
    await markRuntime(page);
    snapshots.push(await readSnapshot());
  }
  const merged = await page.evaluate(({ html, snapshots, images }) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const byWidth = snapshots.map((rows) => new Map(rows.map((row) => [row.id, row])));
    const rules: string[][] = [[], [], [], []];
    const conditions = ['(min-width:1181px)', '(min-width:835px) and (max-width:1180px)', '(min-width:391px) and (max-width:834px)', '(max-width:390px)'];
    const imageAssets = [...images];
    const assetByUrl = new Map(imageAssets.map((one) => [one.src, one.index]));
    let nextImage = Math.max(-1, ...imageAssets.map((one) => one.index)) + 1;
    let changed = false;
    for (const element of doc.querySelectorAll<HTMLElement>('[data-capture-runtime]')) {
      const id = element.getAttribute('data-capture-runtime') ?? '';
      const rows = byWidth.map((one) => one.get(id));
      if (rows.some((one) => one === undefined || one.tag !== element.localName)) {
        element.removeAttribute('data-capture-runtime');
        continue;
      }
      if (element instanceof HTMLImageElement && element.parentElement?.localName === 'picture') {
        const picture = element.parentElement;
        for (const source of [...picture.children]) if (source.localName === 'source') source.remove();
        const selected = rows.map((one) => one?.src ?? '');
        if (selected.some((src) => src !== selected[0])) {
          for (const [at, src] of selected.entries()) {
            if (src === '') continue;
            let index = assetByUrl.get(src);
            if (index === undefined) {
              index = nextImage++;
              assetByUrl.set(src, index);
              imageAssets.push({ index, src });
            }
            const source = doc.createElement('source');
            source.setAttribute('media', conditions[at] ?? 'all');
            source.setAttribute('srcset', `__capture_image_${index}__`);
            picture.insertBefore(source, element);
          }
        }
        changed = true;
      }
      const styles = rows.map((one) => {
        const holder = document.createElement('span');
        holder.setAttribute('style', one?.style ?? '');
        return holder.style;
      });
      const properties = new Set(styles.flatMap((style) => [...style]));
      const different = [...properties].filter((property) => styles.some((style) => style.getPropertyValue(property) !== styles[0]?.getPropertyValue(property) || style.getPropertyPriority(property) !== styles[0]?.getPropertyPriority(property)));
      if (different.length === 0) {
        element.removeAttribute('data-capture-runtime');
        continue;
      }
      changed = true;
      for (const property of different) element.style.removeProperty(property);
      for (let at = 0; at < styles.length; at += 1) {
        const declarations = different.flatMap((property) => {
          const value = styles[at]?.getPropertyValue(property) ?? '';
          if (value === '') return [];
          const priority = styles[at]?.getPropertyPriority(property) === 'important' ? '!important' : '';
          return [`${property}:${value}${priority};`];
        });
        if (declarations.length > 0) rules[at]?.push(`[data-capture-runtime="${id}"]{${declarations.join('')}}`);
      }
    }
    if (!changed) return { html, css: '', images };
    const css = rules.map((parts, at) => parts.length === 0 ? '' : `@media ${conditions[at]}{${parts.join('')}}`).filter((one) => one !== '').join('\n');
    return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, css, images: imageAssets };
  }, { html: read.html, snapshots, images: read.images });
  return merged.html === read.html && merged.css === '' ? read : { ...read, html: merged.html, images: merged.images, sheets: merged.css === '' ? read.sheets : [...read.sheets, { href: null, text: merged.css, scope: null }] };
}

export async function capture(address: string, options: { readonly width?: number; readonly timeout?: number; readonly pages?: number; readonly har?: string } = {}): Promise<Capture> {
  const start = new URL(address);
  if (!isHttp(start.href)) throw new Error(`${address} is no http or https address`);
  const limit = Math.max(1, Math.min(options.pages ?? 1, MOST_PAGES));
  // (a page's Content Security Policy is bypassed: it would refuse the style that stops the animations, settle)
  const context = await (await browser()).newContext({ viewport: { width: options.width ?? 1440, height: 900 }, locale: 'en-US', bypassCSP: true });
  try {
    const recorded = options.har === undefined ? null : harEntries(options.har);
    if (options.har !== undefined) await replayHar(context, options.har);
    // a file of the site: from the record when the capture replays one, else from the network
    const fetched = async (url: string, timeout = 20_000): Promise<{ readonly ok: boolean; readonly type: string; readonly body: Buffer } | null> => {
      if (recorded !== null) {
        const one = recorded.get(url);
        return one === undefined ? null : { ok: one.status >= 200 && one.status < 300, type: one.type, body: one.body };
      }
      const response = await page.request.get(url, { timeout }).catch(() => null);
      return response === null ? null : { ok: response.ok(), type: response.headers()['content-type'] ?? '', body: await response.body() };
    };
    const page = await context.newPage();
    const site = siteBuilder(fetched);
    // the pages captured, by their address, their markup still holding the link marks until the crawl ends
    const captured = new Map<string, { readonly path: string; html: string }>();
    const queue: string[] = [pageKey(start.href)];
    const queued = new Set(queue);
    let title = '';
    while (queue.length > 0 && captured.size < limit) {
      const url = queue.shift() as string;
      let response;
      try {
        await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
        // the document read, then the network let rest (settle): a page whose load never ends is still captured
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeout ?? 45_000 });
      } catch (error) {
        // the first page must open; a later one that does not is passed over
        if (captured.size === 0) throw error;
        continue;
      }
      if (captured.size > 0 && response !== null && !(response.headers()['content-type'] ?? 'text/html').includes('html')) continue;
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await settle(page);
      const base = page.url();
      // a page that answered at an address the crawl already took (a redirect) is that page
      if (captured.has(pageKey(base))) continue;
      // what the page holds now (serializePage), built into its file and the site's files
      await markRuntime(page);
      const read = await responsiveInline(page, await page.evaluate(serializePage, start.origin), base, options.timeout ?? 45_000);
      if (title === '') title = read.title;
      captured.set(pageKey(base), await site.pageOf(read, base));
      for (const link of read.links) {
        if (queued.has(link)) continue;
        queued.add(link);
        queue.push(link);
      }
    }
    return { title, files: [...pageFiles(captured), ...site.files] };
  } finally {
    await context.close();
  }
}

// A capture the browser extension made in the person's own tab (companion/extension: a page behind a login): what the
// page held (serializePage) and the files the tab read with the person's credentials, by address. Built into files
// as the Companion's own capture builds them; a file the tab could not read is left out, as one a site refuses.
export interface Snapshot {
  readonly url: string;
  readonly read: PageRead;
  readonly resources: Readonly<Record<string, { readonly status: number; readonly type: string; readonly base64: string }>>;
}
export async function captureSnapshot(snapshot: Snapshot): Promise<Capture> {
  if (!isHttp(snapshot.url)) throw new Error(`${snapshot.url} is no http or https address`);
  const site = siteBuilder(async (url) => {
    const one = snapshot.resources[url];
    return one === undefined ? null : { ok: one.status >= 200 && one.status < 300, type: one.type, body: Buffer.from(one.base64, 'base64') };
  });
  const captured = new Map([[pageKey(snapshot.url), await site.pageOf(snapshot.read, snapshot.url)]]);
  return { title: snapshot.read.title, files: [...pageFiles(captured), ...site.files] };
}

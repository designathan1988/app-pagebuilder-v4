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
import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { chromium } from '@playwright/test';
import { parse as parseCss, type CssNode } from 'css-tree';
import { serializePage, type PageRead } from './serialize.ts';
import { completeOpaquePaint } from './paint.ts';
import { captureSnapshotPath, type CapturedElement, type CapturedResourceProblem, type CapturedSnapshotPackage } from '../../src/core/document/captured.ts';
import { mergeWidths } from '../../src/core/capture/merge.ts';
import { sequentialIds } from '../../src/core/ports/ids.ts';
import { capturedExportHtml } from '../../src/core/render/captured.ts';
import { attributeValues, element, mapTree, prependToHead } from './tree.ts';

export { serializePage, type PageRead } from './serialize.ts';

export interface CapturedFile {
  readonly path: string;
  readonly type: string;
  readonly base64: string;
}
export interface Capture {
  readonly title: string;
  readonly files: readonly CapturedFile[];
  readonly problems?: readonly CapturedResourceProblem[];
}

export class CaptureChallengeError extends Error {
  readonly address: string;
  constructor(address: string) {
    super(`A verification challenge blocked ${address}`);
    this.name = 'CaptureChallengeError';
    this.address = address;
  }
}

// Cloudflare documents this response header for every interstitial Challenge Page. A challenge is
// access control, not source HTML; never present its markup as the requested website.
export const isChallengeResponse = (response: Response | null): boolean => response?.headers()['cf-mitigated']?.toLowerCase() === 'challenge';

const TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', js: 'text/javascript', mjs: 'text/javascript', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' };
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

export interface SettleResult {
  readonly scrollTruncated: boolean;
  readonly quiescent: boolean;
  readonly pendingImages: number;
  readonly unseekableVideos: number;
  readonly networkIdle: boolean;
}

// Observe the page until its lazy DOM and image requests stop changing, within a bounded capture window.
// A complete image can still be broken, so resource availability is reported separately by siteBuilder.
export async function settle(page: Page): Promise<SettleResult> {
  const scrollTruncated = await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    let y = 0;
    let steps = 0;
    while (y < document.documentElement.scrollHeight && steps < 800) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 60));
      y += step;
      steps += 1;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    return steps >= 800 && y < document.documentElement.scrollHeight;
  });
  const quiet = await page.evaluate(async () => {
    let lastChange = performance.now();
    let lastHeight = document.documentElement.scrollHeight;
    const mayPaint = (image: HTMLImageElement): boolean => {
      if (!image.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      const rectangle = image.getBoundingClientRect();
      let left = rectangle.left, right = rectangle.right, top = rectangle.top, bottom = rectangle.bottom;
      for (let parent = image.parentElement; parent !== null; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          left = Math.max(left, bounds.left);
          right = Math.min(right, bounds.right);
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, bounds.top);
          bottom = Math.min(bottom, bounds.bottom);
        }
        if (right <= left || bottom <= top) return false;
      }
      return right > left && bottom > top;
    };
    const observer = new MutationObserver(() => {
      lastChange = performance.now();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'style', 'class', 'hidden'] });
    const start = performance.now();
    let pendingImages = 0;
    let quiescent = false;
    try {
      while (performance.now() - start < 12_000) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        pendingImages = [...document.images].filter((image) => (image.currentSrc || image.getAttribute('src') || image.getAttribute('srcset')) && !image.complete && mayPaint(image)).length;
        const height = document.documentElement.scrollHeight;
        if (height !== lastHeight) {
          lastHeight = height;
          lastChange = performance.now();
        }
        if (pendingImages === 0 && performance.now() - lastChange >= 1_000) {
          quiescent = true;
          break;
        }
      }
    } finally { observer.disconnect(); }
    return { quiescent, pendingImages };
  });
  // Video playback time is independent of a fixed JavaScript clock. Show the first seekable frame
  // consistently when the site's media allows seeking; inaccessible streams remain explicit evidence.
  const unseekableVideos = await page.evaluate(async () => {
    let unseekable = 0;
    for (const video of document.querySelectorAll('video')) {
      video.pause();
      if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.seekable.length === 0) {
        unseekable += 1;
        continue;
      }
      const first = video.seekable.start(0);
      if (Math.abs(video.currentTime - first) < 0.01) continue;
      await Promise.race([
        new Promise<void>((resolve) => {
          video.addEventListener('seeked', () => resolve(), { once: true });
          video.currentTime = first;
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
      ]);
    }
    return unseekable;
  });
  let networkIdle = true;
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  }
  catch { networkIdle = false; }
  await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}' });
  return { scrollTruncated, ...quiet, unseekableVideos, networkIdle };
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
// A style attribute with each url() replaced by `local(raw, custom)` (custom: inside a custom property's declaration);
// null keeps it. Declarations end at a semicolon outside parentheses and quotes.
function localStyle(style: string, local: (raw: string, custom: boolean) => string | null): string {
  let out = '';
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  const flush = (end: number): void => {
    const declaration = style.slice(start, end);
    const custom = /^\s*--/.test(declaration);
    out += declaration.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, _quote: string, raw: string) => {
      const made = local(raw, custom);
      return made === null ? all : `url(${made})`;
    });
  };
  for (let index = 0; index < style.length; index += 1) {
    const character = style[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (character === ';' && depth === 0) {
      flush(index + 1);
      start = index + 1;
    }
  }
  flush(style.length);
  return out;
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
  const problems = new Map<string, CapturedResourceProblem>();
  const missing = (url: string, reason: CapturedResourceProblem['reason']): void => {
    problems.set(url, { url, reason });
  };
  const assets = new Map<string, string>();
  const sheetPaths = new Map<string, string>();
  const inlineScripts = new Map<string, string>();
  const inlineSheets = new Map<string, string>();
  let inline = 0;
  // one asset of the site downloaded once, under its folder, by the order it was met
  const fetchAsset = async (url: string, folder: string): Promise<string | null> => {
    const known = assets.get(url);
    if (known !== undefined) return known;
    if (url.startsWith('data:')) {
      const parts = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
      if (parts === null) {
        missing(url.slice(0, 160), 'invalid-data');
        return null;
      }
      try {
        const type = parts[1] || 'text/plain';
        const body = parts[2] ? Buffer.from(parts[3] ?? '', 'base64') : Buffer.from(decodeURIComponent(parts[3] ?? ''), 'utf8');
        const extension = extensionOf(url, type);
        const at = `${folder}/${folder}-${assets.size + 1}.${extension}`;
        assets.set(url, at);
        files.push({ path: at, type, base64: body.toString('base64') });
        return at;
      } catch {
        missing(url.slice(0, 160), 'invalid-data');
        return null;
      }
    }
    let response: Fetched | null;
    try {
      response = await fetched(url);
    }
    catch {
      missing(url, 'unavailable');
      return null;
    }
    if (response === null || !response.ok) {
      missing(url, 'unavailable');
      return null;
    }
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
  // a page's tree with its sheets linked at their places, its images, backgrounds and other files downloaded, and the
  // capture's mark: every change made on attribute values and placeholder comments, never on markup text
  const pageOf = async (read: PageRead, base: string): Promise<{ readonly path: string; readonly root: CapturedElement }> => {
    const path = pagePath(base);
    for (const paint of read.opaque ?? []) missing(`${base}#${paint.kind}:${paint.path}`, 'blocked');
    const sheetLinks = new Map<number, string>();
    for (const [index, sheet] of read.sheets.entries()) {
      let at: string | undefined;
      const media = sheet.media?.trim() ?? '';
      const conditioned = (css: string): string => media === '' || media.toLowerCase() === 'all' ? css : `@media ${media}{${css}}`;
      if (sheet.href !== null) {
        const key = `${sheet.href}\u0000${media}`;
        at = sheetPaths.get(key);
        if (at === undefined) {
          const got = await fetched(sheet.href);
          if (got === null || !got.ok) {
            missing(sheet.href, 'unavailable');
            continue;
          }
          at = `css/style-${sheetPaths.size + 1}.css`;
          sheetPaths.set(key, at);
          files.push({ path: at, type: 'text/css', base64: Buffer.from(conditioned(await localSheet(got.body.toString('utf8'), sheet.href)), 'utf8').toString('base64') });
        }
      } else if (sheet.text !== null) {
        // the same rules at several widths (or pages) are one file, as a published script is
        const text = conditioned(await localSheet(sheet.text, base));
        const digest = createHash('sha256').update(text).digest('hex');
        at = inlineSheets.get(digest);
        if (at === undefined) {
          inline += 1;
          at = `css/inline-${inline}.css`;
          inlineSheets.set(digest, at);
          files.push({ path: at, type: 'text/css', base64: Buffer.from(text, 'utf8').toString('base64') });
        }
      }
      if (at !== undefined) sheetLinks.set(index, fromPage(path, at));
    }
    // Preserve the published JavaScript files as editable project assets. The editing canvas and
    // static snapshot export do not execute them a second time over an already observed DOM.
    for (const script of read.scripts ?? []) {
      if (script.src !== null) await fetchAsset(script.src, 'js');
      else if (script.text.trim() !== '') {
        const digest = createHash('sha256').update(script.type).update('\0').update(script.text).digest('hex');
        if (!inlineScripts.has(digest)) {
          const scriptPath = `js/inline-${inlineScripts.size + 1}.js`;
          inlineScripts.set(digest, scriptPath);
          files.push({ path: scriptPath, type: 'text/javascript', base64: Buffer.from(script.text, 'utf8').toString('base64') });
        }
      }
    }
    const localImages = new Map<number, string>();
    for (const image of read.images) {
      const local = await fetchAsset(image.src, image.folder ?? 'img');
      localImages.set(image.index, local === null ? image.src : fromPage(path, local));
    }
    const opaqueMarkers = (read.opaque ?? []).map((one) => one.marker);
    const resolved = (value: string): string => {
      let out = value.replace(/__capture_image_(\d+)__/g, (_all, index: string) => localImages.get(Number(index)) ?? '');
      for (const marker of opaqueMarkers) out = out.replaceAll(marker, '');
      return out;
    };
    let root = mapTree(read.root as CapturedElement, {
      attribute: resolved,
      comment: (node) => {
        const sheet = /^__capture_sheet_(\d+)__$/.exec(node.value);
        if (sheet === null) return node;
        const href = sheetLinks.get(Number(sheet[1]));
        return href === undefined ? null : element(node.id, 'link', { rel: 'stylesheet', href });
      },
    });
    // a style attribute's url()s (an inline background), downloaded too
    const styleUrls = new Map<string, string>();
    for (const value of attributeValues(root)) {
      for (const match of value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        const raw = match[2] ?? '';
        if (raw.startsWith('data:') || raw.startsWith('#') || styleUrls.has(raw) || !URL.canParse(raw, base)) continue;
        const local = await fetchAsset(new URL(raw, base).href, 'img');
        if (local !== null) styleUrls.set(raw, local);
      }
    }
    if (styleUrls.size > 0) {
      root = mapTree(root, {
        attribute: (value, name) => (name !== 'style' ? value : localStyle(value, (raw, custom) => {
          const local = styleUrls.get(raw);
          if (local === undefined) return null;
          // A url() in a custom property resolves where var() uses it, not where it is set (CSS Custom Properties,
          // https://drafts.csswg.org/css-variables-2/): the site's rules that use it live in css/, so it is written
          // from there (a page at the root reads ../img/a.png as img/a.png as well). Written from the page, bellroy's
          // section background --section-bg: url(img/…) was looked for in css/img/ and never drawn.
          return custom ? `../${local}` : fromPage(path, local);
        })),
      });
    }
    // the mark of a captured page: the import knows it by its mark and reads its tree from the package
    // (spec capture-url)
    root = prependToHead(root, [element(`${root.id}-capture-mark`, 'meta', { name: 'builder-capture', content: base })]);
    return { path, root };
  };
  return { files, pageOf, problems };
}

// the pages' trees with every link to a page the crawl took written to that page's file, any other keeping its
// address
function resolvedPageLinks(root: CapturedElement, path: string, captured: ReadonlyMap<string, { readonly path: string }>): CapturedElement {
  return mapTree(root, {
    attribute: (value, name) => (name !== 'href' ? value : value.replace(/__capture_link__(.*?)__(#[^"]*?)?__/g, (_all, url: string, hash: string | undefined) => {
      const target = captured.get(url);
      // The exported captured page keeps its source-relative link text. Its own inert-site bootstrap
      // delegates uncaptured paths to the original host when clicked; captured pages use local paths.
      return `${target === undefined ? new URL(url).pathname : between(path, target.path)}${hash ?? ''}`;
    })),
  });
}

// A captured page's two files: the page as a person opens it (the widest width as static HTML, the other widths
// applied by its width script) and its capture package (format 2: the one tree of every width), which an import reads.
interface CapturedPageFiles {
  readonly path: string;
  capture: { readonly widths: readonly number[]; root: CapturedElement };
}
function pageFiles(captured: ReadonlyMap<string, CapturedPageFiles>, problems: readonly CapturedResourceProblem[]): CapturedFile[] {
  for (const [, one] of captured) one.capture.root = resolvedPageLinks(one.capture.root, one.path, captured);
  return [...captured.values()].flatMap((one): CapturedFile[] => {
    const value: CapturedSnapshotPackage = { format: 2, widths: one.capture.widths, root: one.capture.root, ...(problems.length === 0 ? {} : { resourceProblems: problems }) };
    return [
      { path: one.path, type: 'text/html', base64: Buffer.from(capturedExportHtml(one.capture), 'utf8').toString('base64') },
      { path: captureSnapshotPath(one.path), type: 'application/json', base64: Buffer.from(JSON.stringify(value), 'utf8').toString('base64') },
    ];
  });
}

// the widths of one page, localized each, as one tree (src/core/capture/merge.ts)
async function mergedPage(site: ReturnType<typeof siteBuilder>, observations: readonly { readonly width: number; readonly read: PageRead }[], base: string): Promise<CapturedPageFiles> {
  const localized = [];
  for (const observation of observations) localized.push({ width: observation.width, ...(await site.pageOf(observation.read, base)) });
  const first = localized[0];
  if (first === undefined) throw new Error(`No captured document at ${base}`);
  return { path: first.path, capture: mergeWidths(localized.map((one) => ({ width: one.width, root: one.root })), sequentialIds('c')) };
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
    const next = { status: response.status, type: response.content.mimeType ?? '', body: Buffer.from(text, response.content.encoding === 'base64' ? 'base64' : 'utf8') };
    const previous = out.get(request.url);
    // A later aborted retry is not evidence that an earlier successful response ceased to exist, and neither is a later
    // success recorded without its body (a response served from the browser's cache: content.size -1, no text; the
    // HAR 1.2 content.text is left out when it is not available). Keep the latest successful body for Companion
    // assets and do not install an abort route over it for HAR replay. (bellroy: each font twice, the second one
    // empty, and the empty one won: every font of the page was 0 bytes.)
    const ok = (one: Recorded): boolean => one.status >= 200 && one.status < 300;
    if (previous === undefined || !ok(previous) || (ok(next) && (next.body.length > 0 || previous.body.length === 0))) out.set(request.url, next);
  }
  return out;
}

// An unfinished request with no successful response in the record is aborted as the original saw it fail.
// A failed retry of a URL that did succeed must not erase its recorded bytes or override routeFromHAR.
export async function replayHar(context: BrowserContext, file: string): Promise<void> {
  await context.routeFromHAR(file, { notFound: 'abort' });
  const failed = new Set([...harEntries(file)].filter(([, response]) => response.status < 0).map(([url]) => url));
  if (failed.size > 0) await context.route((url) => failed.has(url.href), (route) => route.abort());
}

export interface InlineSnapshot { readonly id: string; readonly tag: string; readonly style: string; readonly src: string | null }

export async function markRuntime(page: Page): Promise<void> {
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

export async function readRuntimeSnapshot(page: Page): Promise<InlineSnapshot[]> {
  return page.evaluate(() => [...document.body.querySelectorAll<HTMLElement>('[data-capture-runtime]')].map((el) => ({
    id: el.getAttribute('data-capture-runtime') ?? '', tag: el.localName, style: el.getAttribute('style') ?? '',
    src: el instanceof HTMLImageElement ? el.currentSrc : null,
  })));
}

// Each width is a fresh navigation. A full DOM variant preserves additions, removals, order and text;
// approximating them through a desktop tree loses content even when inline styles are copied.
async function responsiveDocuments(page: Page, read: PageRead, url: string, origin: string, timeout: number): Promise<{ readonly width: number; readonly read: PageRead }[]> {
  const observations = [{ width: read.viewportWidth ?? 1440, read: await completeOpaquePaint(page, read, await page.screenshot({ fullPage: true })) }];
  for (const width of [1180, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await settle(page);
    await markRuntime(page);
    const next = await page.evaluate(serializePage, origin);
    observations.push({ width, read: await completeOpaquePaint(page, next, await page.screenshot({ fullPage: true })) });
  }
  return observations;
}
export async function capture(address: string, options: { readonly width?: number; readonly timeout?: number; readonly pages?: number; readonly har?: string } = {}): Promise<Capture> {
  const start = new URL(address);
  if (!isHttp(start.href)) throw new Error(`${address} is no http or https address`);
  const limit = Math.max(1, Math.min(options.pages ?? 1, MOST_PAGES));
  // (a page's Content Security Policy is bypassed: it would refuse the style that stops the animations, settle)
  const context = await (await browser()).newContext({ viewport: { width: options.width ?? 1440, height: 900 }, locale: 'en-US', bypassCSP: true, serviceWorkers: options.har === undefined ? 'allow' : 'block' });
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
    const captured = new Map<string, CapturedPageFiles>();
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
        if (isChallengeResponse(response)) throw new CaptureChallengeError(url);
      } catch (error) {
        if (error instanceof CaptureChallengeError) throw error;
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
      const observations = await responsiveDocuments(page, await page.evaluate(serializePage, start.origin), base, start.origin, options.timeout ?? 45_000);
      const firstObservation = observations[0];
      if (firstObservation === undefined) throw new Error(`No captured document at ${base}`);
      if (title === '') title = firstObservation.read.title;
      captured.set(pageKey(base), await mergedPage(site, observations, base));
      for (const link of firstObservation.read.links) {
        if (queued.has(link)) continue;
        queued.add(link);
        queue.push(link);
      }
    }
    const problems = [...site.problems.values()];
    const pages = pageFiles(captured, problems);
    return { title, files: [...pages, ...site.files], problems };
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
  const captured = new Map([[pageKey(snapshot.url), await mergedPage(site, [{ width: snapshot.read.viewportWidth ?? 1440, read: snapshot.read }], snapshot.url)]]);
  const problems = [...site.problems.values()];
  return { title: snapshot.read.title, files: [...pageFiles(captured, problems), ...site.files], problems };
}

// Build the corpus copy from the DOM and runtime values read on the exact live page used for its reference PNGs.
// The HAR supplies only resource bytes; it never reruns the site's scripts to choose a different carousel/AB state.
export async function captureRecorded(url: string, observations: readonly { readonly width: number; readonly read: PageRead; readonly inline: readonly InlineSnapshot[] }[], har: string): Promise<Capture> {
  const firstObservation = observations[0];
  if (!isHttp(url) || firstObservation === undefined) throw new Error('a recorded capture needs an address and live observations');
  const recorded = harEntries(har);
  const site = siteBuilder(async (address) => {
    const one = recorded.get(address);
    return one === undefined ? null : { ok: one.status >= 200 && one.status < 300, type: one.type, body: one.body };
  });
  const captured = new Map([[pageKey(url), await mergedPage(site, observations, url)]]);
  const problems = [...site.problems.values()];
  return { title: firstObservation.read.title, files: [...pageFiles(captured, problems), ...site.files], problems };
}

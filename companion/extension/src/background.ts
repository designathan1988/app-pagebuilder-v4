// The Builder Capture extension (the plan's stage 12, STG-12.4: pages behind a login): a click on its button reads the
// page of the current tab as the person sees it, logged in — the same reading the Companion's capture runs in its own
// Chrome (tools/companion/serialize.ts), and every file the page's copy needs, fetched in the page with the person's
// credentials (SingleFile's approach) — and hands both to the Builder Companion on this computer (POST /snapshot, with
// the Companion's token, kept in the extension's options). File › Open a web address… with the tab's address then opens
// it in the editor. chrome.scripting.executeScript runs each function in the tab (activeTab: the tab clicked).
import { serializePage, type PageRead } from '../../../tools/companion/serialize.ts';

interface Resource {
  readonly status: number;
  readonly type: string;
  readonly base64: string;
}

// Run in the tab: every file the copy of the page needs (its sheets, the sheets they import, the fonts and images the
// sheets and the markup name, its images), read with the page's own credentials, by absolute address — the addresses
// the Companion's builder asks for (tools/companion/capture.ts siteBuilder). Self-contained: it reads only the page.
async function readResources(read: PageRead, base: string): Promise<Record<string, Resource>> {
  const out: Record<string, Resource> = {};
  const base64Of = (bytes: Uint8Array): string => {
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary);
  };
  const fetchOne = async (url: string): Promise<string | null> => {
    if (url in out || url.startsWith('data:')) return null;
    try {
      const response = await fetch(url, { credentials: 'include' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const type = response.headers.get('content-type') ?? '';
      out[url] = { status: response.status, type, base64: base64Of(bytes) };
      return type.includes('css') || /\.css(\?|#|$)/i.test(url) ? new TextDecoder().decode(bytes) : null;
    } catch {
      return null;
    }
  };
  // the url()s and @imports of a sheet, each read (an imported sheet's own as well)
  const sheetNames = async (text: string, sheetUrl: string): Promise<void> => {
    for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const raw = match[2] ?? '';
      if (raw.startsWith('data:') || raw.startsWith('#')) continue;
      await fetchOne(new URL(raw, sheetUrl).href);
    }
    for (const match of text.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?[^;]*;/g)) {
      const absolute = new URL(match[1] ?? '', sheetUrl).href;
      const inner = await fetchOne(absolute);
      if (inner !== null) await sheetNames(inner, absolute);
    }
  };
  for (const sheet of read.sheets) {
    if (sheet.href !== null) {
      const text = await fetchOne(sheet.href);
      if (text !== null) await sheetNames(text, sheet.href);
    } else if (sheet.text !== null) await sheetNames(sheet.text, base);
  }
  for (const image of read.images) if (!image.src.startsWith('data:')) await fetchOne(image.src);
  for (const script of read.scripts ?? []) if (script.src !== null) await fetchOne(script.src);
  for (const match of read.html.matchAll(/url\(\s*(?:&quot;|['"])?([^'")&]+)(?:&quot;|['"])?\s*\)/g)) {
    const raw = match[1] ?? '';
    if (!raw.startsWith('data:') && !raw.startsWith('__capture')) await fetchOne(new URL(raw, base).href);
  }
  return out;
}

// The capture of a tab, handed to the Companion: its answer, or why it failed.
export async function captureTab(tab: chrome.tabs.Tab): Promise<{ readonly ok: boolean; readonly said: string }> {
  if (tab.id === undefined || tab.url === undefined || !/^https?:/.test(tab.url)) return { ok: false, said: 'this tab shows no web page' };
  const url = tab.url;
  const origin = new URL(url).origin;
  const [read] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: serializePage, args: [origin] });
  if (read?.result === undefined) return { ok: false, said: 'the page could not be read' };
  const [resources] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readResources, args: [read.result, url] });
  const stored = await chrome.storage.local.get(['port', 'token']);
  const port = typeof stored.port === 'number' ? stored.port : 5410;
  const token = typeof stored.token === 'string' ? stored.token : '';
  try {
    const response = await fetch(`http://127.0.0.1:${port}/snapshot`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-builder-token': token }, body: JSON.stringify({ url, read: read.result, resources: resources?.result ?? {} }) });
    const answer = (await response.json()) as { ok?: boolean; error?: string; files?: number };
    return answer.ok === true ? { ok: true, said: `captured ${String(answer.files ?? 0)} files: open ${url} in the Builder` } : { ok: false, said: answer.error ?? 'the Companion refused the capture' };
  } catch {
    return { ok: false, said: 'the Builder Companion does not answer (npm run companion)' };
  }
}

chrome.action.onClicked.addListener((tab) => {
  void captureTab(tab).then(async ({ ok, said }) => {
    await chrome.action.setBadgeText({ text: ok ? 'OK' : '!', tabId: tab.id });
    await chrome.action.setTitle({ title: said, tabId: tab.id });
  });
});

// the service worker's own handle on the capture, for a test that cannot click the toolbar
(globalThis as unknown as { captureTab: typeof captureTab }).captureTab = captureTab;

// The Builder Companion (the plan's stage 12; `npm run companion`): a local HTTP server, on this machine only
// (127.0.0.1, COMPANION_PORT, 5410 by default), that the editor asks to capture a web address it cannot read itself.
//   GET  /health  → { ok: true }
//   POST /capture { url, pages? } → { title, files: [{ path, type, base64 }] }, or { error } with status 400 or 502
//   (pages: how many pages of the site to follow, from the address, 1 by default)
//   POST /snapshot { url, read, resources } → { ok: true, title, files }: a page the browser extension captured in the
//   person's own tab (companion/extension: a page behind a login, read with the person's credentials), accepted only
//   with the Companion's token in x-builder-token (the extension's options hold it). For ten minutes, a capture of that
//   address is answered from it (File › Open a web address… with the address of the tab), since the Companion's own
//   Chrome has no session there.
// Who may ask (a page of any site the person opens can send a simple cross-origin POST, which the server still runs;
// MDN CORS, Chrome's Local Network Access): a request whose Host is not this machine is refused (a rebound DNS name);
// a browser request is answered only from a loopback origin (the editor runs on this machine) or, for /snapshot, with
// the token; CORS names that origin, never `*`. Only http and https addresses are captured (no file:, chrome:…).
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CaptureChallengeError, capture, captureSnapshot, closeBrowser, type Capture, type Snapshot } from './capture.ts';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const loopback = (address: string | undefined): boolean => {
  if (address === undefined) return false;
  try {
    const at = new URL(address);
    return (at.protocol === 'http:' || at.protocol === 'https:') && LOOPBACK.has(at.hostname);
  } catch {
    return false;
  }
};
// the Host a request names: this machine's loopback name, at any port (a rebound public name is refused)
const hostOfThisMachine = (host: string | undefined): boolean => host !== undefined && loopback(`http://${host}`);
const json = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(origin === undefined ? {} : { 'access-control-allow-origin': origin, vary: 'Origin' }),
    'access-control-allow-headers': 'content-type, x-builder-token',
  });
  res.end(JSON.stringify(body));
};
const bodyOf = (req: IncomingMessage, most: number): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > most) reject(new Error('the request is too large'));
    });
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
// the largest request: an address; a snapshot carries the page's files
const MOST_REQUEST = 100_000;
const MOST_SNAPSHOT = 128 * 1024 * 1024;
// how long a capture of the extension answers for its address
const SNAPSHOT_LIFE = 10 * 60_000;
// an address as the snapshots are kept by: no fragment
const keyOf = (url: string): string => {
  const at = new URL(url);
  at.hash = '';
  return at.href;
};

export interface CompanionOptions {
  // the token the browser extension sends (COMPANION_TOKEN, else made at start and printed)
  readonly token?: string;
}

export function startCompanion(port = Number(process.env.COMPANION_PORT ?? '5410'), options: CompanionOptions = {}): Promise<Server & { readonly token: string }> {
  const token = options.token ?? process.env.COMPANION_TOKEN ?? randomBytes(24).toString('base64url');
  const snapshots = new Map<string, { readonly at: number; readonly capture: Capture }>();
  const server = createServer((req, res) => {
    void (async () => {
      if (!hostOfThisMachine(req.headers.host)) return json(res, 403, { error: 'the Companion answers this machine only' });
      const origin = req.headers.origin;
      // a request a browser sends names its origin; one without (a process of this machine) is answered as before
      const fromEditor = origin === undefined || loopback(origin);
      const allow = origin !== undefined && loopback(origin) ? origin : undefined;
      const tokened = req.headers['x-builder-token'] === token;
      if (req.method === 'OPTIONS') return json(res, 204, {}, origin !== undefined && (loopback(origin) || origin.startsWith('chrome-extension://')) ? origin : undefined);
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true }, allow);
      if (req.method === 'POST' && req.url === '/snapshot') {
        if (!tokened) return json(res, 401, { error: 'the extension holds no token of this Companion' });
        try {
          const snapshot = JSON.parse(await bodyOf(req, MOST_SNAPSHOT)) as Snapshot;
          const made = await captureSnapshot(snapshot);
          snapshots.set(keyOf(snapshot.url), { at: Date.now(), capture: made });
          return json(res, 200, { ok: true, title: made.title, files: made.files.length }, origin);
        } catch (error) {
          return json(res, 400, { error: (error as Error).message.split('\n')[0] }, origin);
        }
      }
      if (req.method !== 'POST' || req.url !== '/capture') return json(res, 404, { error: 'not found' });
      if (!fromEditor) return json(res, 403, { error: 'the Companion answers the editor on this machine only' });
      let url: string;
      let pages = 1;
      try {
        const parsed = JSON.parse(await bodyOf(req, MOST_REQUEST)) as { url?: unknown; pages?: unknown };
        if (typeof parsed.url !== 'string') throw new Error('no url');
        const address = new URL(parsed.url);
        if (address.protocol !== 'http:' && address.protocol !== 'https:') throw new Error('not a web address');
        url = address.href;
        if (typeof parsed.pages === 'number' && Number.isInteger(parsed.pages) && parsed.pages > 0) pages = parsed.pages;
      } catch {
        return json(res, 400, { error: 'the request names no web address' }, allow);
      }
      const kept = snapshots.get(keyOf(url));
      if (kept !== undefined && Date.now() - kept.at < SNAPSHOT_LIFE) return json(res, 200, kept.capture, allow);
      try {
        return json(res, 200, await capture(url, { pages }), allow);
      } catch (error) {
        if (error instanceof CaptureChallengeError) return json(res, 403, { errorCode: 'challenge', error: error.message }, allow);
        return json(res, 502, { error: (error as Error).message.split('\n')[0] }, allow);
      }
    })();
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(Object.assign(server, { token }))));
}

export async function stopCompanion(server: Server): Promise<void> {
  await new Promise((resolve) => server.close(resolve));
  await closeBrowser();
}

// run directly: npm run companion
if (process.argv[1]?.replaceAll('\\', '/').endsWith('tools/companion/server.ts')) {
  void startCompanion().then((server) => {
    const at = server.address();
    console.log(`Builder Companion on http://127.0.0.1:${typeof at === 'object' && at !== null ? at.port : '?'} — Ctrl+C stops it`);
    console.log(`The browser extension's token (its options): ${server.token}`);
  });
}

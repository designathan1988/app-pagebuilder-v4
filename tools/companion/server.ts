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
// The editor's page may call it from its own origin (CORS allows any origin: the server answers this machine only).
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CaptureChallengeError, capture, captureSnapshot, closeBrowser, type Capture, type Snapshot } from './capture.ts';

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-builder-token' });
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
      if (req.method === 'OPTIONS') return json(res, 204, {});
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
      if (req.method === 'POST' && req.url === '/snapshot') {
        if (req.headers['x-builder-token'] !== token) return json(res, 401, { error: 'the extension holds no token of this Companion' });
        try {
          const snapshot = JSON.parse(await bodyOf(req, MOST_SNAPSHOT)) as Snapshot;
          const made = await captureSnapshot(snapshot);
          snapshots.set(keyOf(snapshot.url), { at: Date.now(), capture: made });
          return json(res, 200, { ok: true, title: made.title, files: made.files.length });
        } catch (error) {
          return json(res, 400, { error: (error as Error).message.split('\n')[0] });
        }
      }
      if (req.method !== 'POST' || req.url !== '/capture') return json(res, 404, { error: 'not found' });
      let url: string;
      let pages = 1;
      try {
        const parsed = JSON.parse(await bodyOf(req, MOST_REQUEST)) as { url?: unknown; pages?: unknown };
        if (typeof parsed.url !== 'string') throw new Error('no url');
        url = new URL(parsed.url).href;
        if (typeof parsed.pages === 'number' && Number.isInteger(parsed.pages) && parsed.pages > 0) pages = parsed.pages;
      } catch {
        return json(res, 400, { error: 'the request names no address' });
      }
      const kept = snapshots.get(keyOf(url));
      if (kept !== undefined && Date.now() - kept.at < SNAPSHOT_LIFE) return json(res, 200, kept.capture);
      try {
        return json(res, 200, await capture(url, { pages }));
      } catch (error) {
        if (error instanceof CaptureChallengeError) return json(res, 403, { errorCode: 'challenge', error: error.message });
        return json(res, 502, { error: (error as Error).message.split('\n')[0] });
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

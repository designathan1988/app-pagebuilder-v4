// The Companion's snapshot route (STG-12.4): only the extension that holds its token hands it a page, and a capture of
// that address is then answered from what the extension read, not from the Companion's own Chrome.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request, type Server } from 'node:http';
import { startCompanion, stopCompanion } from './server.ts';

const PORT = 5431;
const TOKEN = 'a-test-token';
let server: Server;
beforeAll(async () => {
  server = await startCompanion(PORT, { token: TOKEN });
});
afterAll(async () => {
  await stopCompanion(server);
});

const snapshot = {
  url: 'https://intranet.example/account',
  read: { title: 'Account', html: '<!doctype html>\n<html><head></head><body><h1>Welcome back</h1><img src="__capture_image_0__"></body></html>', sheets: [{ href: 'https://intranet.example/site.css', text: null, scope: null }], images: [{ index: 0, src: 'https://intranet.example/me.png' }], links: [] },
  resources: {
    'https://intranet.example/site.css': { status: 200, type: 'text/css', base64: Buffer.from('h1{color:green}').toString('base64') },
    'https://intranet.example/me.png': { status: 200, type: 'image/png', base64: Buffer.from('png').toString('base64') },
  },
};
const post = (path: string, body: unknown, token?: string) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { 'x-builder-token': token }) }, body: JSON.stringify(body) });

describe('the snapshot route', () => {
  it('refuses a page without the Companion token', async () => {
    expect((await post('/snapshot', snapshot)).status).toBe(401);
    expect((await post('/snapshot', snapshot, 'another')).status).toBe(401);
  });

  it('builds the page with its token, and answers a capture of the address from it', async () => {
    const answer = await post('/snapshot', snapshot, TOKEN);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ ok: true, title: 'Account' });
    const captured = (await (await post('/capture', { url: 'https://intranet.example/account#top' })).json()) as { title: string; files: { path: string; base64: string }[] };
    expect(captured.title).toBe('Account');
    const page = captured.files.find((file) => file.path === 'account.html');
    expect(Buffer.from(page?.base64 ?? '', 'base64').toString('utf8')).toContain('<h1>Welcome back</h1>');
    // the page's DOM snapshot travels beside it (DEC-53), the observed width with the captured markup
    expect(captured.files.map((file) => file.path).sort()).toEqual(['account.html', 'account.html.capture.json', 'css/style-1.css', 'img/img-1.png']);
    const sidecar = JSON.parse(Buffer.from(captured.files.find((file) => file.path === 'account.html.capture.json')?.base64 ?? '', 'base64').toString('utf8')) as { format: number; viewports: { html: string }[] };
    expect(sidecar.format).toBe(1);
    expect(sidecar.viewports.some((viewport) => viewport.html.includes('Welcome back'))).toBe(true);
  });
});

// What a web page the person opens can ask of the Companion (OWASP CSRF; Chrome's Local Network Access): a page of
// another site sends a simple cross-origin POST the server still runs, and with `access-control-allow-origin: *` it
// would read the answer. Only the editor's pages (a loopback origin) and the extension's token are answered, a
// rebound host name is refused, and only http and https addresses are captured.
const raw = (path: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; allow: string | undefined; text: string }> =>
  new Promise((resolve, reject) => {
    const sent = request({ host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'content-type': 'text/plain', ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, allow: res.headers['access-control-allow-origin'] as string | undefined, text }));
    });
    sent.on('error', reject);
    sent.end(JSON.stringify(body));
  });

describe('who may ask the Companion', () => {
  it('refuses a capture asked by a page of another site, and never lets it read the answer', async () => {
    await post('/snapshot', snapshot, TOKEN);
    const asked = await raw('/capture', { origin: 'https://evil.example' }, { url: 'https://intranet.example/account' });
    expect(asked.status).toBe(403);
    expect(asked.allow).toBeUndefined();
    expect(asked.text).not.toContain('Welcome back');
  });

  it('refuses a request whose host is not this machine (a rebound name)', async () => {
    const asked = await raw('/capture', { host: `attacker.example:${PORT}`, origin: `http://attacker.example:${PORT}` }, { url: 'https://intranet.example/account' });
    expect(asked.status).toBe(403);
  });

  it('answers the editor on a loopback origin, naming that origin', async () => {
    await post('/snapshot', snapshot, TOKEN);
    const asked = await raw('/capture', { origin: 'http://127.0.0.1:5173' }, { url: 'https://intranet.example/account' });
    expect(asked.status).toBe(200);
    expect(asked.allow).toBe('http://127.0.0.1:5173');
  });

  it('captures only http and https addresses', async () => {
    for (const url of ['file:///C:/Windows/win.ini', 'chrome://settings', 'javascript:alert(1)']) {
      const asked = await raw('/capture', { origin: 'http://localhost:5173' }, { url });
      expect(asked.status, url).toBe(400);
    }
  });
});

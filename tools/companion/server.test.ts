// The Companion's snapshot route (STG-12.4): only the extension that holds its token hands it a page, and a capture of
// that address is then answered from what the extension read, not from the Companion's own Chrome.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
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

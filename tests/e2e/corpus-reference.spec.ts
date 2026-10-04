import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { expect, test } from '../support/test.ts';
import { comparePictures } from '../../tools/journey/fidelity.ts';
import { captureRecorded, replayHar, settle } from '../../tools/companion/capture.ts';
import { REFERENCE_TIME, readLayoutSnapshot, recordReference, readReference, readReferenceSnapshot, seedSiteScripts, startSiteClock } from '../../tools/capture/reference.ts';
import { diagnosePictures } from '../../tools/capture/diagnose.ts';

test('a recorded reference comes from a fresh navigation at each viewport and replays its selected resources', async ({ browser, page }) => {
  test.setTimeout(120_000);
  const served: string[] = [];
  let brandResponses = 0;
  const svg = (colour: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="${colour}"/></svg>`;
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    served.push(url);
    if (url === '/wide.svg' || url === '/narrow.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg(url === '/wide.svg' ? '#123456' : '#abcdef'));
      return;
    }
    if (url === '/brand.svg') {
      brandResponses += 1;
      response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' }).end(svg(brandResponses <= 2 ? '#445566' : '#ee3322'));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><html><body style="margin:0"><img id="hero" width="480" height="240"><img id="brand" src="/brand.svg" width="100" height="100"><p id="state"></p><div id="welcome" style="height:100px;background:#f80">New visitor</div><script>document.querySelector("#hero").src = matchMedia("(max-width:1200px)").matches ? "/narrow.svg" : "/wide.svg"; document.querySelector("#state").textContent = new Date().toISOString() + "/" + Math.random().toFixed(6); if(localStorage.getItem("seen"))document.querySelector("#welcome").remove();else localStorage.setItem("seen","1")</script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let replay: BrowserContext | null = null;
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('fixture server has no port');
    const url = `http://127.0.0.1:${address.port}/`;
    const directory = fs.mkdtempSync(path.join('.cache', 'logs', 'r6-reference-'));
    const har = path.join(directory, 'site.har');
    const reference = path.join(directory, 'reference');
    const manifest = await recordReference(browser, url, har, reference, [1440, 1180]);
    expect(manifest.widths.map((one) => one.width)).toEqual([1440, 1180]);
    expect(manifest.widths.map((one) => one.stabilityMatch)).toEqual([100, 100]);
    const firstWidth = manifest.widths[0];
    if (firstWidth === undefined) throw new Error('the reference has no recorded width');
    const repeatLayout = JSON.parse(fs.readFileSync(path.join(reference, firstWidth.repeatLayout), 'utf8')) as { id: string | null; bounds: { width: number } }[];
    expect(repeatLayout.find((box) => box.id === 'hero')?.bounds.width).toBe(480);
    const snapshots = [1440, 1180].map((width) => readReferenceSnapshot(url, har, reference, width));
    expect(snapshots[0]?.read.images.some((image) => image.src.endsWith('/wide.svg'))).toBe(true);
    expect(snapshots[1]?.read.images.some((image) => image.src.endsWith('/narrow.svg'))).toBe(true);
    expect(snapshots[0]?.layout.find((box) => box.id === 'hero')).toMatchObject({ tag: 'img', bounds: { width: 480, height: 240 } });
    expect(snapshots[1]?.layout.find((box) => box.id === 'hero')?.path).toBe(snapshots[0]?.layout.find((box) => box.id === 'hero')?.path);
    const state = await Promise.all(snapshots.map((one) => page.evaluate((html) => new DOMParser().parseFromString(html, 'text/html').querySelector('#state')?.textContent, one.read.html)));
    expect(state[0]).toBeDefined();
    expect(state[0]).toBe(state[1]);
    const captured = await captureRecorded(url, snapshots, har);
    const capturedHtml = Buffer.from(captured.files.find((file) => file.type === 'text/html')?.base64 ?? '', 'base64').toString('utf8');
    expect(capturedHtml).toContain(state[0]);
    expect(served).toContain('/wide.svg');
    expect(served).toContain('/narrow.svg');
    // A later aborted retry does not erase an earlier successful response for the same resource.
    const archive = JSON.parse(fs.readFileSync(har, 'utf8')) as { log: { entries: { request: { url: string }; response: { status: number; content: { text?: string } } }[] } };
    const successful = archive.log.entries.find((entry) => entry.request.url.endsWith('/wide.svg') && entry.response.status === 200);
    if (successful === undefined) throw new Error('the wide image was not recorded');
    archive.log.entries.push({ ...successful, response: { ...successful.response, status: -1, content: { ...successful.response.content, text: '' } } });
    const duplicated = path.join(directory, 'duplicate.har');
    fs.writeFileSync(duplicated, JSON.stringify(archive));
    replay = await browser.newContext({ locale: 'en-US', bypassCSP: true, serviceWorkers: 'block' });
    await seedSiteScripts(replay);
    await replayHar(replay, duplicated);
    const made = await replay.newPage();
    await startSiteClock(made);
    for (const [index, [width, image]] of ([[1440, 'wide.svg'], [1180, 'narrow.svg']] as const).entries()) {
      if (index > 0) await made.clock.resume();
      await made.clock.setFixedTime(new Date(REFERENCE_TIME));
      await made.setViewportSize({ width, height: 900 });
      await made.goto(url);
      await settle(made);
      await made.evaluate(async () => { await document.fonts.ready; });
      await made.clock.pauseAt(new Date(REFERENCE_TIME));
      await expect(made.locator('#hero')).toHaveAttribute('src', `/${image}`);
      await expect.poll(() => made.locator('#hero').evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(480);
      const screenshot = (await made.screenshot({ fullPage: true })).toString('base64');
      const actual = readReference(url, har, reference, width).toString('base64');
      expect((await comparePictures(page, screenshot, actual)).match).toBe(100);
    }
    await replay.close();
    replay = null;
  } finally {
    await replay?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('settling waits for visible lazy content scheduled after scrolling', async ({ page }) => {
  await page.setContent('<!doctype html><html><body style="margin:0"><div style="height:1600px">Above</div><img id="late" width="100" height="100"><script>const image=document.querySelector("#late");new IntersectionObserver((entries,observer)=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();setTimeout(()=>{image.src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect width=\'100\' height=\'100\' fill=\'red\'/%3E%3C/svg%3E"},900)} }).observe(image)</script></body></html>');
  await settle(page);
  expect(await page.locator('#late').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(100);
});

test('layout evidence names an unmarked element that extends beyond the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.setContent('<!doctype html><html><body style="margin:0"><div id="wide" style="width:1770px;height:100px">Wide</div></body></html>');
  const layout = await readLayoutSnapshot(page, true);
  expect(layout.find((box) => box.id === 'wide')).toMatchObject({ path: '0', bounds: { x: 0, y: 0, width: 1770, height: 100 } });
});

test('difference evidence marks pixels and identifies the first changed element and vertical band', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.setContent('<!doctype html><html><body style="margin:0"><div style="height:100px"></div><div id="changed" style="width:300px;height:100px;background:blue"></div></body></html>');
  const original = await page.screenshot({ fullPage: true });
  const originalLayout = await readLayoutSnapshot(page, true);
  await page.locator('#changed').evaluate((element) => { (element as HTMLElement).style.background = 'red'; });
  const exported = await page.screenshot({ fullPage: true });
  const exportLayout = await readLayoutSnapshot(page, true);
  const output = '.cache/logs/r6-difference-fixture';
  const diagnosis = await diagnosePictures(page, original, exported, originalLayout, exportLayout, output);
  expect(diagnosis.firstBand?.start).toBe(100);
  expect(diagnosis.exportElement?.id).toBe('changed');
  expect(fs.existsSync(`${output}.png`)).toBe(true);
  const changed = exportLayout.find((box) => box.id === 'changed');
  if (changed === undefined) throw new Error('changed element missing');
  const bogus = { ...changed, id: 'invisible-marker', capturePath: 'shared', bounds: { x: 0, y: 0, width: 0, height: 0 } };
  const taggedExport = exportLayout.map((box) => box.id === 'changed' ? { ...box, capturePath: 'shared' } : box);
  const diagnosisWithMarker = await diagnosePictures(page, original, exported, [...originalLayout, bogus], taggedExport, `${output}-marker`);
  expect(diagnosisWithMarker.originalElement?.id).toBe('changed');
});

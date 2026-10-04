// One corpus test per site. Live Chrome navigation at every requested width records the reference
// photograph and DOM from the same paused page; HAR contributes exact resource bytes and a separate
// replay diagnostic. The Builder imports those observations, exports a ZIP, and compares its whole-page
// photographs with the live references using the unchanged pixel comparator. CORPUS_RECORD=1 refreshes sources.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, type Page } from '@playwright/test';
import { captureRecorded, closeBrowser, replayHar, settle } from '../companion/capture.ts';
import { REFERENCE_TIME, readLayoutSnapshot, readReference, readReferenceManifest, readReferenceSnapshot, recordReference, seedSiteScripts, startSiteClock } from './reference.ts';
import { comparePictures, WIDTHS } from '../journey/fidelity.ts';
import { open } from '../journey/kit.ts';
import { fileMenu } from '../journey/ui.ts';
import { unzip } from '../runner/unzip.ts';
import { readDomObservation } from './audit-observation.ts';

interface Site {
  readonly id: string;
  readonly url: string;
  readonly kind: string;
}
export interface SiteRecord {
  readonly id: string;
  readonly url: string;
  readonly kind: string;
  readonly files: number;
  readonly elements: number | null;
  readonly widths: readonly { readonly width: number; readonly pixelMatchCommon: number; readonly pixelMatchAdjusted: number; readonly originalHeight: number; readonly exportHeight: number }[];
  readonly referenceReplay?: readonly { readonly width: number; readonly pixelMatchCommon: number; readonly originalHeight: number; readonly replayHeight: number }[];
  readonly referenceStability?: readonly { readonly width: number; readonly pixelMatchCommon: number }[];
  readonly referenceReadiness?: readonly { readonly width: number; readonly quiescent: boolean; readonly pendingImages: number; readonly scrollTruncated: boolean; readonly networkIdle: boolean; readonly unseekableVideos: number }[];
  readonly referenceManifestSha256?: string;
  readonly problem: string | null;
}
const SITES = (JSON.parse(fs.readFileSync('tools/capture/corpus.json', 'utf8')) as { sites: Site[] }).sites;
const ROOT = path.join('.cache', 'corpus');
export const RECORDS = path.join(ROOT, 'records');
// where the export is served from during the run (page.route answers it from the export's folder)
const EXPORT_ORIGIN = 'http://export.corpus.test';
const only = (process.env.CORPUS_SITES ?? '').split(',').filter((one) => one !== '');

// a whole-page picture of an address at a width, as PNG in base64, kept in `file`
async function picture(page: Page, address: string, width: number, file: string, fixedClock = false): Promise<string> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await settle(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  if (fixedClock) await page.clock.pauseAt(new Date(REFERENCE_TIME));
  else await page.waitForTimeout(300);
  await page.screenshot({ path: file, fullPage: true });
  return fs.readFileSync(file).toString('base64');
}

test.afterAll(async () => {
  await closeBrowser();
});

for (const site of SITES.filter((one) => only.length === 0 || only.includes(one.id))) {
  test(site.id, async ({ page, browser }) => {
    const har = path.join(ROOT, 'har', `${site.id}.har`);
    const reference = path.join(ROOT, 'references', site.id);
    const out = path.join(ROOT, site.id);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(RECORDS, { recursive: true });
    const write = (value: SiteRecord) => fs.writeFileSync(path.join(RECORDS, `${site.id}.json`), `${JSON.stringify(value, null, 2)}\n`);
    try {
      const manifestFile = path.join(reference, 'manifest.json');
      const currentReference = fs.existsSync(manifestFile) && [5, 6].includes((JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { format?: number }).format ?? 0);
      if (!fs.existsSync(har) || !currentReference || process.env.CORPUS_RECORD === '1') await recordReference(browser, site.url, har, reference, WIDTHS);
      const manifest = readReferenceManifest(site.url, har, reference);
      const referenceManifestSha256 = createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex');
      const observations = WIDTHS.map((width) => readReferenceSnapshot(site.url, har, reference, width));
      const referenceStability = manifest.widths.map((one) => ({ width: one.width, pixelMatchCommon: one.stabilityMatch }));
      const referenceReadiness = manifest.widths.map((one) => ({ width: one.width, ...one.settle }));
      // The Companion's copy comes from the saved DOM/runtime values of the photographed live pages. Only resource
      // bytes come from the HAR; no site's scripts run a second time to create a different source state.
      const captured = await captureRecorded(site.url, observations, har);
      const folder = path.join(out, 'capture');
      for (const file of captured.files) {
        fs.mkdirSync(path.join(folder, path.dirname(file.path)), { recursive: true });
        fs.writeFileSync(path.join(folder, file.path), Buffer.from(file.base64, 'base64'));
      }
      // The target is the live page photographed at each initial viewport while the HAR was recorded. A replay
      // with an absent request is diagnostic only; it must never silently become the original being scored.
      const originals = new Map<number, string>();
      for (const width of WIDTHS) {
        const bytes = readReference(site.url, har, reference, width);
        fs.writeFileSync(path.join(out, `original-${width}.png`), bytes);
        originals.set(width, bytes.toString('base64'));
      }
      const replay = await browser.newContext({ locale: 'en-US', bypassCSP: true, serviceWorkers: 'block' });
      const referenceReplay: NonNullable<SiteRecord['referenceReplay']>[number][] = [];
      try {
        await seedSiteScripts(replay);
        await replayHar(replay, har);
        const replayPage = await replay.newPage();
        await startSiteClock(replayPage);
        for (const [index, width] of WIDTHS.entries()) {
          if (index > 0) await replayPage.clock.resume();
          await replayPage.clock.setFixedTime(new Date(REFERENCE_TIME));
          const png = await picture(replayPage, site.url, width, path.join(out, `replay-${width}.png`), true);
          const compared = await comparePictures(page, png, originals.get(width) ?? '');
          referenceReplay.push({ width, pixelMatchCommon: compared.match, originalHeight: compared.targetHeight, replayHeight: compared.exportHeight });
        }
      } finally {
        await replay.close();
      }
      // the editor: the capture imported in place of the empty project, the canvas photographed, the project exported
      await open(page);
      await fileMenu(page, 'project.importHtml#menu-file-folder', folder);
      await page.locator('[data-door="project.importHtml#destination-replace"]').click();
      // replacing the project asks first
      await page.locator('[data-confirmation="confirm"]').click();
      await page.locator('[data-region="html-import"]').waitFor({ state: 'detached', timeout: 60_000 });
      await page.frameLocator('.frame__page').locator('body').waitFor();
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: path.join(out, 'canvas.png') });
      const importedDocument = await page.evaluate(() => (window as unknown as { __builderTestPort?: { document(): unknown } }).__builderTestPort?.document() ?? null);
      if (importedDocument === null) throw new Error('editor document port unavailable after capture import');
      fs.writeFileSync(path.join(out, 'document.json'), `${JSON.stringify(importedDocument)}\n`);
      const elements = await page.evaluate(() => {
        type Captured = { kind: string; tag?: string; children?: Captured[] };
        const port = (window as unknown as { __builderTestPort?: { document(): { pages: { tree: unknown; capture?: { viewports: { root: Captured }[] } }[] } } }).__builderTestPort;
        let count = 0;
        const visit = (node: { children?: unknown[] }) => {
          count += 1;
          for (const child of node.children ?? []) visit(child as { children?: unknown[] });
        };
        for (const one of port?.document().pages ?? []) {
          const root = one.capture?.viewports[0]?.root;
          if (root === undefined) {
            visit(one.tree as { children?: unknown[] });
            continue;
          }
          const body = root.children?.find((node) => node.kind === 'element' && node.tag === 'body');
          const captured = (node: Captured): number => node.kind === 'element' ? 1 + (node.children ?? []).reduce((total, child) => total + captured(child), 0) : 0;
          count += body === undefined ? 0 : Math.max(0, captured(body) - 1);
        }
        return port === undefined ? null : count;
      });
      const download = page.waitForEvent('download');
      await fileMenu(page, 'project.export#menu-file');
      const zip = await (await download).path();
      const exported = path.join(out, 'export');
      for (const [name, bytes] of unzip(fs.readFileSync(zip))) {
        fs.mkdirSync(path.join(exported, path.dirname(name)), { recursive: true });
        fs.writeFileSync(path.join(exported, name), bytes);
      }
      // the exported page: the one the capture made of the address
      const pagePath = captured.files.find((file) => file.type === 'text/html')?.path ?? 'index.html';
      const exportedPage = fs.existsSync(path.join(exported, pagePath)) ? pagePath : (fs.readdirSync(exported).find((name) => name.endsWith('.html')) ?? 'index.html');
      // the export served over HTTP as a site is (a mask or a font fetched from file:// is refused: CORS)
      await page.route(`${EXPORT_ORIGIN}/**`, async (route) => {
        const file = path.join(exported, decodeURIComponent(new URL(route.request().url()).pathname.slice(1)));
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, path: file });
      });
      const widths: SiteRecord['widths'][number][] = [];
      for (const width of WIDTHS) {
        const made = await picture(page, `${EXPORT_ORIGIN}/${exportedPage.split(path.sep).join('/')}`, width, path.join(out, `export-${width}.png`));
        fs.writeFileSync(path.join(out, `export-dom-${width}.json`), `${JSON.stringify(await readDomObservation(page))}\n`);
        fs.writeFileSync(path.join(out, `export-layout-${width}.json`), `${JSON.stringify(await readLayoutSnapshot(page, true))}\n`);
        const compared = await comparePictures(page, made, originals.get(width) ?? '');
        const longer = Math.max(compared.exportHeight, compared.targetHeight);
        const adjusted = Math.round(((compared.match * Math.min(compared.exportHeight, compared.targetHeight)) / longer) * 10) / 10;
        widths.push({ width, pixelMatchCommon: compared.match, pixelMatchAdjusted: adjusted, originalHeight: compared.targetHeight, exportHeight: compared.exportHeight });
      }
      const unstable = referenceStability.filter((one) => one.pixelMatchCommon < 99);
      const failures = [
        ...(unstable.length === 0 ? [] : [`Live page changes across fixed-time, fixed-seed loads at ${unstable.map((one) => `${one.width}px (${one.pixelMatchCommon.toFixed(1)}%)`).join(', ')}`]),
        ...(referenceReadiness.filter((one) => !one.quiescent || one.pendingImages > 0 || one.scrollTruncated).length === 0 ? [] : [`Live page did not settle at ${referenceReadiness.filter((one) => !one.quiescent || one.pendingImages > 0 || one.scrollTruncated).map((one) => `${one.width}px`).join(', ')}`]),
        ...((captured.problems?.length ?? 0) === 0 ? [] : [`${captured.problems?.length} captured resources unavailable or blocked; see capture snapshot package`]),
      ];
      const problem = failures.length === 0 ? null : failures.join('; ');
      write({ id: site.id, url: site.url, kind: site.kind, files: captured.files.length, elements, widths, referenceReplay, referenceStability, referenceReadiness, referenceManifestSha256, problem });
    } catch (error) {
      write({ id: site.id, url: site.url, kind: site.kind, files: 0, elements: null, widths: [], problem: String(error).split('\n')[0]?.slice(0, 300) ?? 'failed' });
      throw error;
    }
  });
}

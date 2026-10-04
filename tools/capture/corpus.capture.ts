// The capture corpus, one test per site (corpus.config.ts): the site recorded once into a HAR file (Playwright
// recordHar, its contents embedded; https://playwright.dev/docs/mock#mocking-with-har-files) and replayed from it, so
// every run sees the same site; captured by the Companion's capture from that record (tools/companion/capture.ts);
// imported into the editor with File › Import HTML, a photo of the canvas taken; exported with File › Export; and, at
// every breakpoint, the original and the export photographed whole and compared pixel by pixel (the fidelity study's
// method: tools/journey/fidelity.ts). CORPUS_RECORD=1 records the sites again.
import fs from 'node:fs';
import path from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import { capture, closeBrowser, replayHar, settle } from '../companion/capture.ts';
import { comparePictures, WIDTHS } from '../journey/fidelity.ts';
import { open } from '../journey/kit.ts';
import { fileMenu } from '../journey/ui.ts';
import { unzip } from '../runner/unzip.ts';

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
  readonly problem: string | null;
}
const SITES = (JSON.parse(fs.readFileSync('tools/capture/corpus.json', 'utf8')) as { sites: Site[] }).sites;
const ROOT = path.join('.cache', 'corpus');
export const RECORDS = path.join(ROOT, 'records');
// where the export is served from during the run (page.route answers it from the export's folder)
const EXPORT_ORIGIN = 'http://export.corpus.test';
const only = (process.env.CORPUS_SITES ?? '').split(',').filter((one) => one !== '');

// the site recorded at every width, so the sources a narrow window chooses are in the record too
async function record(browser: Browser, site: Site, har: string): Promise<void> {
  fs.mkdirSync(path.dirname(har), { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', bypassCSP: true, recordHar: { path: har, content: 'embed' } });
  const page = await context.newPage();
  await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
  }
  await context.close();
}

// a whole-page picture of an address at a width, as PNG in base64, kept in `file`
async function picture(page: Page, address: string, width: number, file: string): Promise<string> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await settle(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, fullPage: true });
  return fs.readFileSync(file).toString('base64');
}

test.afterAll(async () => {
  await closeBrowser();
});

for (const site of SITES.filter((one) => only.length === 0 || only.includes(one.id))) {
  test(site.id, async ({ page, browser }) => {
    const har = path.join(ROOT, 'har', `${site.id}.har`);
    const out = path.join(ROOT, site.id);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(RECORDS, { recursive: true });
    const write = (value: SiteRecord) => fs.writeFileSync(path.join(RECORDS, `${site.id}.json`), `${JSON.stringify(value, null, 2)}\n`);
    try {
      if (!fs.existsSync(har) || process.env.CORPUS_RECORD === '1') await record(browser, site, har);
      // the capture, from the record, written as the files File › Import HTML takes (a folder)
      const captured = await capture(site.url, { har, width: 1440 });
      const folder = path.join(out, 'capture');
      for (const file of captured.files) {
        fs.mkdirSync(path.join(folder, path.dirname(file.path)), { recursive: true });
        fs.writeFileSync(path.join(folder, file.path), Buffer.from(file.base64, 'base64'));
      }
      // the original at every width, from the record
      const original = await browser.newContext({ locale: 'en-US', bypassCSP: true });
      await replayHar(original, har);
      const originalPage = await original.newPage();
      const originals = new Map<number, string>();
      for (const width of WIDTHS) originals.set(width, await picture(originalPage, site.url, width, path.join(out, `original-${width}.png`)));
      await original.close();
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
      const elements = await page.evaluate(() => {
        const port = (window as unknown as { __builderTestPort?: { document(): { pages: { tree: unknown }[] } } }).__builderTestPort;
        let count = 0;
        const visit = (node: { children?: unknown[] }) => {
          count += 1;
          for (const child of node.children ?? []) visit(child as { children?: unknown[] });
        };
        for (const one of port?.document().pages ?? []) visit(one.tree as { children?: unknown[] });
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
        const compared = await comparePictures(page, made, originals.get(width) ?? '');
        const longer = Math.max(compared.exportHeight, compared.targetHeight);
        const adjusted = Math.round(((compared.match * Math.min(compared.exportHeight, compared.targetHeight)) / longer) * 10) / 10;
        widths.push({ width, pixelMatchCommon: compared.match, pixelMatchAdjusted: adjusted, originalHeight: compared.targetHeight, exportHeight: compared.exportHeight });
      }
      write({ id: site.id, url: site.url, kind: site.kind, files: captured.files.length, elements, widths, problem: null });
    } catch (error) {
      write({ id: site.id, url: site.url, kind: site.kind, files: 0, elements: null, widths: [], problem: String(error).split('\n')[0]?.slice(0, 300) ?? 'failed' });
      throw error;
    }
  });
}

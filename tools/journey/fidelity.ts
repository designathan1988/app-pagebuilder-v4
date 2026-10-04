// Fidelity (jornada03 H2, H3): how close an exported site is to the client's original, as the share of pixels the two
// pictures have alike — the study's method unchanged (jornada03/scripts/fidelity.mjs): both pages at each width
// (Desktop 1440, Laptop 1180, Tablet 834, Phone 390), a full-page picture of each, a pixel alike when each channel
// differs by 24 of 255 at most, over the height both pictures have ("common") and scaled by the shorter height over
// the longer ("adjusted": a page much longer or shorter than the original scores less).
//   npm run fidelity -- <site-folder> <target.html> [name]
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

export const TOLERANCE = 24;
export const WIDTHS = [1440, 1180, 834, 390] as const;
export interface WidthFidelity {
  readonly width: number;
  readonly pixelMatchCommon: number;
  readonly pixelMatchAdjusted: number;
  readonly exportHeight: number;
  readonly targetHeight: number;
}

const fileUrl = (file: string) => `file:///${path.resolve(file).split(path.sep).join('/')}`;

// the two pages' pictures compared at every width, the pictures kept in `out`
export async function measure(page: Page, site: string, target: string, out: string, name: string): Promise<WidthFidelity[]> {
  fs.mkdirSync(out, { recursive: true });
  const results: WidthFidelity[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const shots: Record<string, string> = {};
    for (const [kind, file] of [['export', path.join(site, 'index.html')], ['target', target]] as const) {
      await page.goto(fileUrl(file));
      await page.waitForTimeout(400);
      const png = path.join(out, `${name}-${kind}-${width}.png`);
      await page.screenshot({ path: png, fullPage: true });
      shots[kind] = fs.readFileSync(png).toString('base64');
    }
    const compared = await comparePictures(page, shots.export ?? '', shots.target ?? '');
    const longer = Math.max(compared.exportHeight, compared.targetHeight);
    const adjusted = Math.round(((compared.match * Math.min(compared.exportHeight, compared.targetHeight)) / longer) * 10) / 10;
    results.push({ width, pixelMatchCommon: compared.match, pixelMatchAdjusted: adjusted, exportHeight: compared.exportHeight, targetHeight: compared.targetHeight });
  }
  fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify({ name, site, target, tolerance: TOLERANCE, results }, null, 2)}\n`);
  return results;
}

// Two pictures (PNG, base64) compared in the page: the share of pixels alike over the height both have, and each
// picture's height (the study's method: a pixel alike when each channel differs by TOLERANCE of 255 at most).
export async function comparePictures(page: Page, made: string, original: string): Promise<{ readonly match: number; readonly exportHeight: number; readonly targetHeight: number }> {
  return page.evaluate(
    async ([a, b, tolerance]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.src = `data:image/png;base64,${src}`;
        });
      const [exported, original] = await Promise.all([load(a), load(b)]);
      const w = Math.min(exported.width, original.width);
      const h = Math.min(exported.height, original.height);
      const pixels = (image: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext('2d') as CanvasRenderingContext2D;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, w, h).data;
      };
      const da = pixels(exported);
      const db = pixels(original);
      let same = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs((da[i] ?? 0) - (db[i] ?? 0)) <= tolerance && Math.abs((da[i + 1] ?? 0) - (db[i + 1] ?? 0)) <= tolerance && Math.abs((da[i + 2] ?? 0) - (db[i + 2] ?? 0)) <= tolerance) same += 1;
      }
      return { match: Math.round((same / (w * h)) * 1000) / 10, exportHeight: exported.height, targetHeight: original.height };
    },
    [made, original, TOLERANCE] as const,
  );
}

// the command line: an extracted site folder against the original page
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [site, target, name = 'site'] = process.argv.slice(2);
  if (site === undefined || target === undefined) throw new Error('usage: npm run fidelity -- <site-folder> <target.html> [name]');
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const results = await measure(page, site, target, path.join('.cache', 'logs', 'journey', 'fidelity'), name);
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
}

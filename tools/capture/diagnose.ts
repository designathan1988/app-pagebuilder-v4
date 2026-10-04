// Read-only fidelity diagnosis. The corpus score remains owned by comparePictures; this produces a marked PNG,
// the earliest mismatching vertical band and source/export boxes to investigate from top to bottom.
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { TOLERANCE } from '../journey/fidelity.ts';
import type { CapturedBox } from './reference.ts';

export interface DifferenceDiagnosis {
  readonly sourceSize: { readonly width: number; readonly height: number };
  readonly exportSize: { readonly width: number; readonly height: number };
  readonly firstDifferentRow: number | null;
  readonly firstBand: { readonly start: number; readonly end: number; readonly x: number; readonly changedPixelsAtStart: number } | null;
  readonly originalElement: CapturedBox | null;
  readonly exportElement: CapturedBox | null;
  readonly horizontalOverflow: readonly { readonly element: CapturedBox; readonly excess: number }[];
}

const area = (box: CapturedBox): number => box.bounds.width * box.bounds.height;
const contains = (box: CapturedBox, x: number, y: number): boolean =>
  box.bounds.width > 0 && box.bounds.height > 0 && x >= box.bounds.x && x < box.bounds.x + box.bounds.width && y >= box.bounds.y && y < box.bounds.y + box.bounds.height;

export async function diagnosePictures(
  page: Page, original: Buffer, exported: Buffer,
  originalLayout: readonly CapturedBox[], exportLayout: readonly CapturedBox[], output: string,
  viewportWidth?: number,
): Promise<DifferenceDiagnosis> {
  const pixels = await page.evaluate(async ({ source, made, tolerance }) => {
    const load = (encoded: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('diagnostic PNG could not load'));
      image.src = `data:image/png;base64,${encoded}`;
    });
    const [a, b] = await Promise.all([load(source), load(made)]);
    const sample = (image: HTMLImageElement): Uint8ClampedArray => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('diagnostic canvas unavailable');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const sourcePixels = sample(a);
    const exportPixels = sample(b);
    const width = Math.max(a.width, b.width);
    const height = Math.max(a.height, b.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('diagnostic canvas unavailable');
    const image = context.createImageData(width, height);
    const rowCounts = new Array<number>(height).fill(0);
    const rowCenters = new Array<number>(height).fill(0);
    for (let y = 0; y < height; y += 1) {
      let runStart = -1;
      let bestStart = 0;
      let bestLength = 0;
      for (let x = 0; x < width; x += 1) {
        const inside = x < a.width && x < b.width && y < a.height && y < b.height;
        const ai = (y * a.width + x) * 4;
        const bi = (y * b.width + x) * 4;
        const oi = (y * width + x) * 4;
        const different = !inside || Math.abs((sourcePixels[ai] ?? 0) - (exportPixels[bi] ?? 0)) > tolerance
          || Math.abs((sourcePixels[ai + 1] ?? 0) - (exportPixels[bi + 1] ?? 0)) > tolerance
          || Math.abs((sourcePixels[ai + 2] ?? 0) - (exportPixels[bi + 2] ?? 0)) > tolerance;
        if (different) {
          rowCounts[y] = (rowCounts[y] ?? 0) + 1;
          if (runStart < 0) runStart = x;
          image.data[oi] = 255;
          image.data[oi + 1] = 30;
          image.data[oi + 2] = 95;
        } else {
          if (runStart >= 0 && x - runStart > bestLength) {
            bestStart = runStart;
            bestLength = x - runStart;
          }
          runStart = -1;
          const grey = Math.round(((exportPixels[bi] ?? 0) + (exportPixels[bi + 1] ?? 0) + (exportPixels[bi + 2] ?? 0)) / 3);
          image.data[oi] = grey;
          image.data[oi + 1] = grey;
          image.data[oi + 2] = grey;
        }
        image.data[oi + 3] = 255;
      }
      if (runStart >= 0 && width - runStart > bestLength) {
        bestStart = runStart;
        bestLength = width - runStart;
      }
      rowCenters[y] = bestLength > 0 ? Math.round(bestStart + (bestLength - 1) / 2) : 0;
    }
    context.putImageData(image, 0, 0);
    const firstDifferentRow = rowCounts.findIndex((count) => count > 0);
    // A second location ignores isolated antialiasing pixels; this is diagnostic only and never changes the score.
    const significant = Math.max(1, Math.ceil(Math.min(a.width, b.width) * 0.02));
    const firstSignificantRow = rowCounts.findIndex((count) => count >= significant);
    const start = firstSignificantRow >= 0 ? firstSignificantRow : firstDifferentRow;
    let end = start < 0 ? -1 : height;
    if (start >= 0) {
      let quiet = 0;
      for (let y = start; y < height; y += 1) {
        quiet = (rowCounts[y] ?? 0) >= significant ? 0 : quiet + 1;
        if (quiet >= 5) {
          end = y - quiet + 1;
          break;
        }
      }
    }
    const x = start < 0 ? 0 : rowCenters[start] ?? 0;
    return {
      sourceSize: { width: a.width, height: a.height }, exportSize: { width: b.width, height: b.height },
      firstDifferentRow: firstDifferentRow < 0 ? null : firstDifferentRow,
      firstBand: start < 0 ? null : { start, end, x, changedPixelsAtStart: rowCounts[start] ?? 0 },
      png: canvas.toDataURL('image/png').split(',')[1] ?? '',
    };
  }, { source: original.toString('base64'), made: exported.toString('base64'), tolerance: TOLERANCE });
  fs.writeFileSync(`${output}.png`, Buffer.from(pixels.png, 'base64'));
  const at = pixels.firstBand;
  const candidates = at === null ? [] : exportLayout.filter((box) => contains(box, at.x, at.start)).sort((a, b) => area(a) - area(b));
  const exportElement = candidates[0] ?? null;
  const matchedSource = exportElement?.capturePath ? originalLayout.find((box) => box.capturePath === exportElement.capturePath) : null;
  const sourceAtPixel = at === null ? null : originalLayout.filter((box) => contains(box, at.x, at.start)).sort((a, b) => area(a) - area(b))[0] ?? null;
  const originalElement = at !== null && matchedSource !== null && matchedSource !== undefined && contains(matchedSource, at.x, at.start) ? matchedSource : sourceAtPixel;
  const limit = viewportWidth ?? pixels.sourceSize.width;
  const horizontalOverflow = exportLayout.filter((box) => box.tag !== 'html' && box.tag !== 'body' && box.bounds.width > 0 && box.bounds.x + box.bounds.width > limit + 1)
    .map((element) => ({ element, excess: Math.round(element.bounds.x + element.bounds.width - limit) }))
    .sort((a, b) => b.excess - a.excess || area(a.element) - area(b.element)).slice(0, 10);
  const diagnosis: DifferenceDiagnosis = { sourceSize: pixels.sourceSize, exportSize: pixels.exportSize, firstDifferentRow: pixels.firstDifferentRow, firstBand: at, originalElement, exportElement, horizontalOverflow };
  fs.writeFileSync(`${output}.json`, `${JSON.stringify(diagnosis, null, 2)}\n`);
  return diagnosis;
}

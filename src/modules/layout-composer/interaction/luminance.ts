// The reference image's luminance, read where the editor can decode an image (spec, bet F): drawn on a canvas at most
// TRACE_WIDTH px wide, one value from 0 (black) to 1 (white) per pixel, rounded to the thousandth so the command's
// argument stays small and exact. The tracing itself is the engine's (adapters/reference.ts traceBlocks).
import { objectUrl } from '../../../editor/host.ts';
import type { ProjectFile } from '../../../editor/host.ts';
import type { Luminance } from '../adapters/reference.ts';

// the widest the image is read at: enough for the blocks a layout is made of, small enough for one command
const TRACE_WIDTH = 160;

export async function luminanceOf(file: ProjectFile): Promise<Luminance> {
  const image = new Image();
  image.src = objectUrl(file);
  await image.decode();
  const scale = Math.min(1, TRACE_WIDTH / image.naturalWidth);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const drawing = canvas.getContext('2d', { willReadFrequently: true });
  if (drawing === null) throw new Error('the browser gives no 2D canvas');
  drawing.drawImage(image, 0, 0, width, height);
  const { data } = drawing.getImageData(0, 0, width, height);
  const values: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const alpha = (data[i + 3] ?? 255) / 255;
    // a transparent pixel reads as the white page under it
    const lum = (0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)) / 255;
    values.push(Math.round((lum * alpha + (1 - alpha)) * 1000) / 1000);
  }
  return { width, height, values };
}

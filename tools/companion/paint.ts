import type { Page } from '@playwright/test';
import type { PageRead } from './serialize.ts';
import { mapTree } from './tree.ts';
import type { CapturedElement } from '../../src/core/document/captured.ts';

// Read opaque visible paint from the same full-page screenshot as the DOM observation. This does
// not scroll a frame or rerun a site's JavaScript after the reference photograph was taken.
export async function completeOpaquePaint(page: Page, read: PageRead, screenshot: Buffer): Promise<PageRead> {
  const opaque = read.opaque ?? [];
  if (opaque.length === 0) return read;
  let cropped: (string | null)[];
  try {
    cropped = await page.evaluate(async ({ encoded, items }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const elements = new Map([...document.querySelectorAll('[data-capture-runtime]')].map((element) => [element.getAttribute('data-capture-runtime'), element]));
      return items.map((item) => {
        const element = elements.get(item.path);
        if (element === undefined) return null;
        const rectangle = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const edge = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
        const left = edge('border-left-width') + edge('padding-left');
        const top = edge('border-top-width') + edge('padding-top');
        const horizontal = left + edge('border-right-width') + edge('padding-right');
        const vertical = top + edge('border-bottom-width') + edge('padding-bottom');
        const x = Math.max(0, Math.floor(rectangle.x + scrollX + left));
        const y = Math.max(0, Math.floor(rectangle.y + scrollY + top));
        const width = Math.min(Math.ceil(rectangle.width - horizontal), image.naturalWidth - x);
        const height = Math.min(Math.ceil(rectangle.height - vertical), image.naturalHeight - y);
        if (width < 1 || height < 1) return null;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (context === null) return null;
        context.drawImage(image, x, y, width, height, 0, 0, width, height);
        return canvas.toDataURL('image/png');
      });
    }, { encoded: screenshot.toString('base64'), items: opaque });
  }
  catch { cropped = opaque.map(() => null); }
  const images = [...read.images];
  const unresolved = [];
  const replacements = new Map<string, string>();
  for (const [index, item] of opaque.entries()) {
    const data = cropped[index];
    if (data === null || data === undefined) {
      unresolved.push(item);
      replacements.set(item.marker, '');
      continue;
    }
    const asset = images.length;
    images.push({ index: asset, src: data, folder: 'img' });
    replacements.set(item.marker, `__capture_image_${asset}__`);
  }
  const root = mapTree(read.root as CapturedElement, { attribute: (value) => [...replacements].reduce((out, [marker, by]) => out.replaceAll(marker, by), value) });
  return { ...read, root, images, opaque: unresolved };
}

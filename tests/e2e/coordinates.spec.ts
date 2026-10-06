// Coordinates under zoom (src/editor/canvas/coordinates.ts), in the installed Chrome at every zoom level of
// manifest/environment.json. No zoom door is built yet, so the module itself is loaded from the served build
// (/proofs.js, tests/support/proofs.ts) into the app's page, beside a same-origin frame built like the canvas's: a
// sandboxed iframe without scripts that takes no pointer event, scaled with the standard CSS zoom, under an overlay
// that receives the pointer. For page points on known elements (near the page's origin, in its middle and at its far
// corner, with the frame's page scrolled), the real mouse clicks the screen point pageToScreen gives, and the element
// elementAt finds at the point the overlay received must be the one the page lays out there. screenBox must match the
// box Chrome painted for the element.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';

type Coordinates = typeof import('../../src/editor/canvas/coordinates.ts');

interface Environment {
  readonly viewports: readonly { readonly width: number; readonly height: number }[];
  readonly zoomLevels: readonly number[];
}
const ENVIRONMENT = JSON.parse(fs.readFileSync('manifest/environment.json', 'utf8')) as Environment;
const VIEWPORT = ENVIRONMENT.viewports[0];

const MODULE = '/proofs.js';
// the frame's layout viewport (page CSS pixels) and the page it scrolls over
const FRAME = { width: 320, height: 180 };
const PAGE = { width: 1200, height: 2400 };
// how far inside or outside an element's edge a point sits: 2 screen pixels at 25 %
const INSET = 8;

interface Box {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  // painted in its own colour, so its box on the screen can be read from a screenshot
  readonly color: readonly [number, number, number];
}
// Positioned elements in page coordinates, each drawn above the ones before it. c1 is inside c; c covers a corner of
// b, and neither hides another's outer edges. Every probe point stays INSET away from every edge.
const ELEMENTS: readonly Box[] = [
  { id: 'a', left: 10, top: 10, width: 60, height: 40, color: [230, 25, 75] },
  { id: 'b', left: 150, top: 90, width: 80, height: 50, color: [60, 180, 75] },
  { id: 'c', left: 200, top: 120, width: 100, height: 60, color: [0, 130, 200] },
  { id: 'c1', left: 230, top: 142, width: 40, height: 20, color: [245, 130, 48] },
  { id: 'mid', left: 500, top: 1350, width: 90, height: 70, color: [145, 30, 180] },
  { id: 'far', left: 1120, top: 2330, width: 70, height: 60, color: [70, 240, 240] },
  { id: 'corner', left: 1170, top: 2370, width: 30, height: 30, color: [240, 50, 230] },
];
const PARENT: Readonly<Record<string, string>> = { c1: 'c' };

const byId = (id: string): Box => {
  const found = ELEMENTS.find((e) => e.id === id);
  if (!found) throw new Error(`no element ${id}`);
  return found;
};
const style = (e: Box) => {
  const parent = PARENT[e.id] ? byId(PARENT[e.id] as string) : { left: 0, top: 0 };
  return `left:${e.left - parent.left}px;top:${e.top - parent.top}px;width:${e.width}px;height:${e.height}px;background:rgb(${e.color.join(',')})`;
};
const tag = (e: Box): string =>
  `<div id="${e.id}" style="${style(e)}">${ELEMENTS.filter((child) => PARENT[child.id] === e.id).map(tag).join('')}</div>`;
const PAGE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'html{scrollbar-width:none}body{margin:0}' +
  `#ground{position:relative;width:${PAGE.width}px;height:${PAGE.height}px}#ground div{position:absolute}` +
  `</style></head><body><div id="ground">${ELEMENTS.filter((e) => !PARENT[e.id]).map(tag).join('')}</div></body></html>`;

// the element the page lays out at a page point: the last one drawn that contains it, else the ground
const expectedAt = (x: number, y: number) =>
  [...ELEMENTS].reverse().find((e) => x >= e.left && x < e.left + e.width && y >= e.top && y < e.top + e.height)?.id ?? 'ground';

interface Scene {
  readonly scroll: { readonly x: number; readonly y: number };
  readonly targets: readonly string[];
}
// Chrome snaps a zoomed frame's scroll to whole screen pixels, so every scroll here is a multiple of 4 page pixels:
// a whole screen pixel at 25 %, and the frame's page is scrolled exactly there at every level.
const SCENES: readonly Scene[] = [
  { scroll: { x: 0, y: 0 }, targets: ['a', 'b', 'c', 'c1'] },
  { scroll: { x: 436, y: 1292 }, targets: ['mid'] },
  { scroll: { x: PAGE.width - FRAME.width, y: PAGE.height - FRAME.height }, targets: ['far', 'corner'] },
];

interface Probe {
  readonly x: number;
  readonly y: number;
  readonly expected: string | null;
}
// For each target: its centre, its four corners just inside, a point just outside each side; every point the frame
// shows. And one point left of the frame's viewport, on the frame's padding, where no page element is.
const probes = (scene: Scene): Probe[] => {
  const visible = (x: number, y: number) =>
    x >= scene.scroll.x && y >= scene.scroll.y && x < scene.scroll.x + FRAME.width && y < scene.scroll.y + FRAME.height;
  const points: Probe[] = [];
  for (const id of scene.targets) {
    const e = byId(id);
    const [l, t, r, b] = [e.left, e.top, e.left + e.width, e.top + e.height];
    const [cx, cy] = [(l + r) / 2, (t + b) / 2];
    const inside = [[cx, cy], [l + INSET, t + INSET], [r - INSET, t + INSET], [r - INSET, b - INSET], [l + INSET, b - INSET]];
    const outside = [[l - INSET, cy], [r + INSET, cy], [cx, t - INSET], [cx, b + INSET]];
    for (const [x, y] of [...inside, ...outside] as [number, number][]) if (visible(x, y)) points.push({ x, y, expected: expectedAt(x, y) });
  }
  points.push({ x: scene.scroll.x - 6, y: scene.scroll.y + FRAME.height / 2, expected: null });
  return points;
};

interface Harness {
  readonly coordinates: Coordinates;
  readonly iframe: HTMLIFrameElement;
  readonly clicks: { x: number; y: number; hit: string | null }[];
}

// Builds the frame and its overlay in the app's page; the overlay records every pointer press and what elementAt
// finds at the point it received.
const mount = (page: Page) =>
  page.evaluate(
    async ({ url, html, frame }) => {
      const coordinates = (await import(/* @vite-ignore */ url)) as Coordinates;
      const host = document.createElement('div');
      // the test's own frame over the editor, no part of it: the screen guard leaves it out (tests/support/screen-guard.ts)
      host.dataset.testHarness = '';
      host.style.cssText = 'position:fixed;left:33px;top:47px;z-index:2147483647;line-height:0';
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-same-origin');
      iframe.id = 'coords-frame';
      // content-box: the layout viewport is the given size whatever the app's stylesheet sets; the border and padding
      // put the page's origin away from the iframe's box
      iframe.style.cssText = `display:block;box-sizing:content-box;width:${frame.width}px;height:${frame.height}px;border:3px solid;padding:6px;pointer-events:none;background:white`;
      iframe.srcdoc = html;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0';
      const clicks: Harness['clicks'] = [];
      overlay.addEventListener('pointerdown', (event) => {
        const hit = coordinates.elementAt(iframe, { x: event.clientX, y: event.clientY });
        clicks.push({ x: event.clientX, y: event.clientY, hit: hit ? hit.id : null });
      });
      const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
      host.append(iframe, overlay);
      document.body.append(host);
      await loaded;
      (window as unknown as { coordsTest: Harness }).coordsTest = { coordinates, iframe, clicks };
    },
    { url: MODULE, html: PAGE_HTML, frame: FRAME },
  );

// The screen box of each colour as Chrome painted it: a screenshot of the frame, read pixel by pixel in the page.
// Neither Playwright's boundingBox nor the DevTools protocol's content quads scale an iframe's content by its CSS
// zoom (Chrome 153), so the painted pixels are the reference.
const paintedBoxes = async (page: Page, colors: readonly (readonly [number, number, number])[]) => {
  const clip = await page.evaluate(() => {
    const r = (window as unknown as { coordsTest: Harness }).coordsTest.iframe.getBoundingClientRect();
    const [x, y] = [Math.floor(r.left), Math.floor(r.top)];
    return { x, y, width: Math.ceil(r.right) - x, height: Math.ceil(r.bottom) - y };
  });
  const png = (await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })).toString('base64');
  return page.evaluate(
    async ({ png, clip, colors }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [image.naturalWidth, image.naturalHeight];
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      // the screenshot is taken at one device pixel per CSS pixel of the viewport
      const scale = width / clip.width;
      return colors.map(([r, g, b]) => {
        let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (Math.abs((data[i] ?? 0) - r) > 2 || Math.abs((data[i + 1] ?? 0) - g) > 2 || Math.abs((data[i + 2] ?? 0) - b) > 2) continue;
            [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
          }
        if (minX === Infinity) return null;
        return { x: clip.x + minX / scale, y: clip.y + minY / scale, width: (maxX + 1 - minX) / scale, height: (maxY + 1 - minY) / scale };
      });
    },
    { png, clip, colors },
  );
};

test('a click on a page point hits the element laid out there, and screenBox is the element on screen, at every zoom level', async ({ page }) => {
  expect(ENVIRONMENT.zoomLevels.length).toBeGreaterThan(0);
  if (!VIEWPORT) throw new Error('environment.json declares no viewport');
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  await page.goto('/');
  await mount(page);

  for (const level of ENVIRONMENT.zoomLevels) {
    for (const scene of SCENES) {
      const points = probes(scene);
      // zoom the frame, scroll its page, and read where each page point is on the screen
      const screen = await page.evaluate(
        ({ zoom, scroll, points }) => {
          const { coordinates, iframe, clicks } = (window as unknown as { coordsTest: Harness }).coordsTest;
          iframe.style.zoom = String(zoom);
          iframe.contentWindow?.scrollTo(scroll.x, scroll.y);
          clicks.length = 0;
          const g = coordinates.geometryOf(iframe);
          if (!g) throw new Error('the frame has no geometry');
          return {
            scrolled: { x: g.scrollX, y: g.scrollY },
            points: points.map((p) => coordinates.pageToScreen(p, g)),
          };
        },
        { zoom: level / 100, scroll: scene.scroll, points },
      );
      expect(screen.scrolled, `the frame's page scrolls to the scene at ${level} %`).toEqual(scene.scroll);

      for (const p of screen.points) await page.mouse.click(p.x, p.y);

      const pressed = await page.evaluate(() => {
        const { coordinates, iframe, clicks } = (window as unknown as { coordsTest: Harness }).coordsTest;
        const g = coordinates.geometryOf(iframe);
        if (!g) throw new Error('the frame has no geometry');
        return clicks.map((c) => ({ hit: c.hit, page: coordinates.screenToPage(c, g) }));
      });
      const where = `at ${level} % scrolled to ${scene.scroll.x},${scene.scroll.y}`;
      expect(pressed.map((c) => c.hit), `the element under each click ${where}`).toEqual(points.map((p) => p.expected));
      // the point the overlay received, back in page coordinates, is the page point clicked (to a screen pixel)
      const drift = pressed.map((c, i) => Math.max(Math.abs(c.page.x - (points[i]?.x ?? NaN)), Math.abs(c.page.y - (points[i]?.y ?? NaN))) * (level / 100));
      expect(Math.max(...drift), `screen pixels between each click and its page point ${where}`).toBeLessThanOrEqual(1);

      // screenBox of each target against the pixels Chrome painted for it on the screen
      const computed = await page.evaluate((ids) => {
        const { coordinates, iframe } = (window as unknown as { coordsTest: Harness }).coordsTest;
        return ids.map((id) => {
          const element = iframe.contentDocument?.getElementById(id);
          return element ? coordinates.screenBox(iframe, element) : null;
        });
      }, scene.targets);
      const painted = await paintedBoxes(page, scene.targets.map((id) => byId(id).color));
      scene.targets.forEach((id, i) => {
        const box = computed[i];
        const real = painted[i];
        if (!box || !real) throw new Error(`#${id} has no box ${where}: screenBox ${JSON.stringify(box)}, painted ${JSON.stringify(real)}`);
        const off = Math.max(Math.abs(box.x - real.x), Math.abs(box.y - real.y), Math.abs(box.width - real.width), Math.abs(box.height - real.height));
        expect(off, `screen pixels between screenBox(#${id}) ${JSON.stringify(box)} and its painted box ${JSON.stringify(real)} ${where}`).toBeLessThanOrEqual(1);
      });
    }
  }
});

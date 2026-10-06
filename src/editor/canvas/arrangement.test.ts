// The arrangement of the canvas controls (arrangement.ts, DEC-75): the layers in the stylesheets' order, the rotation
// zones' places, and the invariants that replace one probe per collision — over thousands of selections of every size,
// at the canvas's edges, turned, beside a chip, a panel and the handles, no zone leaves another control without a
// press, and none takes a place a person cannot press.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CANVAS_LAYERS, placeMovable, placeRotationZones, rotationPlaces, takesPress, yieldingAt, type Point } from './arrangement.ts';
import type { Box } from './placement.ts';

const tokens = JSON.parse(fs.readFileSync('design/final/tokens.json', 'utf8')) as { z: Record<string, { $value: number }> };

// a small seeded generator: the same thousands of cases at every run
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('the layers of the canvas controls', () => {
  it('are the z-index tokens, in the same order, and the stylesheets stack the canvas by them alone', () => {
    const values = CANVAS_LAYERS.filter((layer) => layer !== 'band').map((layer) => {
      const token = tokens.z[`canvas-${layer}`];
      expect(token, `z.canvas-${layer}`).toBeDefined();
      return token?.$value ?? Number.NaN;
    });
    expect(values).toEqual([...values].sort((a, b) => a - b));
    for (const file of ['src/editor/shell/canvas.css', 'src/editor/shell/canvas-editing.css']) {
      const bare = [...fs.readFileSync(file, 'utf8').matchAll(/z-index:\s*([^;]+);/g)].map((m) => m[1]?.trim()).filter((value) => !/^var\(--z-[a-z-]+\)$/.test(value ?? ''));
      expect(bare, file).toEqual([]);
    }
  });
});

describe('the rotation zones', () => {
  const area = { width: 1000, height: 700 };
  it('first stand a fixed distance outside their corner, inside it where outside would leave the canvas', () => {
    const element = { x: 300, y: 200, width: 200, height: 100 };
    expect(rotationPlaces(element, area, 24, 16, 'ne', 0)[0]).toEqual({ x: 516, y: 160 });
    expect(rotationPlaces(element, area, 24, 16, 'sw', 0)[0]).toEqual({ x: 260, y: 316 });
    // at the canvas's top-left corner: inside the corner on both axes
    expect(rotationPlaces({ x: 0, y: 0, width: 200, height: 100 }, area, 24, 16, 'nw', 0)[0]).toEqual({ x: 16, y: 16 });
    // turned a half turn, the north-east place stands where the south-west one stood
    const turned = rotationPlaces(element, area, 24, 16, 'ne', 180)[0] as Point;
    expect(turned.x).toBeCloseTo(260);
    expect(turned.y).toBeCloseTo(316);
  });

  it("give way to the quick panel's chip beside a narrow element (AU6-20)", () => {
    // a text field about as wide as its label: the chip on the label's right stands over the north-east corner
    const element = { x: 400, y: 300, width: 205, height: 40 };
    const label = { x: 400, y: 280, width: 190, height: 20 };
    const chip = { x: 590, y: 276, width: 24, height: 24 };
    const zones = placeRotationZones(element, area, 24, 16, 0, [chip], [label]);
    const ne = zones[1];
    expect(ne).not.toBeNull();
    const box = { x: (ne as Point).x, y: (ne as Point).y, width: 24, height: 24 };
    expect(takesPress(chip, [box])).toBe(true);
    expect(takesPress(box, [chip])).toBe(true);
  });

  it("never lie over the page's text: a double click there edits it (a form group at the page's top-left)", () => {
    // a full-width element at the canvas's top-left: outside every corner leaves the canvas, so the first places are
    // inside the corners, where its first label's text lies
    const element = { x: 4, y: 0, width: 1000, height: 99 };
    const text = { x: 14, y: 12, width: 34, height: 16 };
    const zones = placeRotationZones(element, area, 24, 16, 0, [], [], [text]);
    for (const zone of zones) if (zone !== null) expect(zone.x < text.x + text.width && text.x < zone.x + 24 && zone.y < text.y + text.height && text.y < zone.y + 24).toBe(false);
    // the north-west zone, whose every place meets the text, is not drawn; the others still turn the element
    expect(zones.filter((zone) => zone !== null).length).toBeGreaterThan(0);
  });

  it('never leave a control without a press, and take a place whenever one leaves every control its press', () => {
    const next = random(20261006);
    const size = 24;
    const gap = 16;
    const broken: string[] = [];
    for (let run = 0; run < 4000; run += 1) {
      const canvas = { width: 600 + next() * 1200, height: 400 + next() * 600 };
      const width = 4 + next() * 500;
      const height = 4 + next() * 400;
      // at the canvas's edges a fifth of the time
      const x = next() < 0.2 ? -width / 2 + next() * 40 : next() * (canvas.width - width);
      const y = next() < 0.2 ? -height / 2 + next() * 40 : next() * (canvas.height - height);
      const element = { x, y, width, height };
      const rotation = next() < 0.3 ? Math.round(next() * 360) : 0;
      const label = { x, y: y - 20, width: 40 + next() * 260, height: 20 };
      const chip = { x: label.x + label.width, y: label.y - 4, width: 24, height: 24 };
      const panel = next() < 0.3 ? { x: label.x + label.width, y: label.y, width: 196, height: 120 + next() * 400 } : null;
      const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((side): Box => {
        const cx = side.includes('w') ? x - size / 2 : side.includes('e') ? x + width + size / 2 : x + width / 2;
        const cy = side.includes('n') ? y - size / 2 : side.includes('s') ? y + height + size / 2 : y + height / 2;
        return { x: cx - size / 2, y: cy - size / 2, width: size, height: size };
      });
      const keep = [panel ?? chip, ...handles];
      const zones = placeRotationZones(element, canvas, size, gap, rotation, keep, [label]);
      const drawn: Box[] = [];
      zones.forEach((zone, i) => {
        const places = rotationPlaces(element, canvas, size, gap, ['nw', 'ne', 'se', 'sw'][i] as string, rotation);
        const expected = placeMovable(places, size, [...keep, ...drawn], [label]);
        const where = `run ${run} zone ${i}`;
        // the first free place, or none only when none is free
        if (JSON.stringify(zone) !== JSON.stringify(expected)) broken.push(`${where}: ${JSON.stringify(zone)} where the rule gives ${JSON.stringify(expected)}`);
        if (zone === null) return;
        const box = { x: zone.x, y: zone.y, width: size, height: size };
        // inside the canvas
        if (box.x < -1e-9 || box.y < -1e-9 || box.x + size > canvas.width + 1e-9 || box.y + size > canvas.height + 1e-9) broken.push(`${where}: outside the canvas`);
        // it and every control it keeps, the zones before it among them, take a press
        for (const other of [...keep, ...drawn]) if (!takesPress(box, [other]) || !takesPress(other, [box])) broken.push(`${where}: over ${JSON.stringify(other)}`);
        drawn.push(box);
      });
    }
    // one assertion over every case: a broken one is named, with its run (thousands of expect calls ran past the test's
    // time on a loaded machine)
    expect(broken).toEqual([]);
  });
});

describe('the optional controls', () => {
  // a control as the browser draws it: its box, and whether a press at a point reaches it or one drawn over it
  interface Fake { readonly key: string | null; readonly box: Box; readonly control: boolean; readonly classList: { contains: () => boolean } }
  const fake = (key: string | null, box: Box, control = true): Fake => ({ key, box, control, classList: { contains: () => false } });
  const asElement = (one: Fake): Element =>
    ({
      getAttribute: () => one.key,
      getBoundingClientRect: () => ({ x: one.box.x, y: one.box.y, width: one.box.width, height: one.box.height, left: one.box.x, top: one.box.y, right: one.box.x + one.box.width, bottom: one.box.y + one.box.height }),
      contains: (other: unknown) => other === asElement.cache.get(one),
      closest: () => (one.control ? asElement.cache.get(one) : null),
      classList: one.classList,
      parentElement: null,
    }) as unknown as Element;
  asElement.cache = new Map<Fake, Element>();
  const element = (one: Fake) => {
    const made = asElement(one);
    asElement.cache.set(one, made);
    return made;
  };
  // the topmost of the drawn controls at a point, the last drawn first
  const reachesIn = (drawn: readonly Fake[]) => (x: number, y: number) => {
    const top = [...drawn].reverse().find((one) => x >= one.box.x && x <= one.box.x + one.box.width && y >= one.box.y && y <= one.box.y + one.box.height);
    return top === undefined ? null : (asElement.cache.get(top) ?? null);
  };

  it('give way where a press would reach another control of the canvas at most of their points, and only there', () => {
    // an element with no padding: its left band wholly under its edge grip; its top band long, a handle at its middle
    const leftBand = fake('left', { x: 100, y: 100, width: 6, height: 80 });
    const topBand = fake('top', { x: 100, y: 100, width: 300, height: 6 });
    const grip = fake('edge:w', { x: 97, y: 100, width: 12, height: 80 });
    const handle = fake('handle:n', { x: 238, y: 88, width: 24, height: 24 });
    const drawn = [leftBand, topBand, grip, handle];
    const els = drawn.map(element);
    expect([...yieldingAt(els, reachesIn(drawn), 'control')]).toEqual(['left']);
    // what lies over a band and is no control (the page, an outline) leaves it its press
    const outline = fake(null, { x: 90, y: 90, width: 400, height: 200 }, false);
    const under = [leftBand, outline];
    expect([...yieldingAt(under.map(element), reachesIn(under), 'control')]).toEqual([]);
  });
});

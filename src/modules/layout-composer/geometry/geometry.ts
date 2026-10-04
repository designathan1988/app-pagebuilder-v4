// The geometry of regions: bounds, intersections, containment, hit testing, subtraction and splitting of boxes. Every
// spatial operation of the composer goes through here (spec "Geometry Engine"), in the composed container's
// coordinates; converting from the screen is the canvas coordinates owner's job (src/editor/canvas/coordinates.ts) and
// snapping is the core snap owner's (src/core/geometry/snap.ts), so neither is repeated here.
import type { Axis, Box, Point, Region } from '../intent/model.ts';
import { lengthKey } from './keys.ts';

// Every committed coordinate is a multiple of this step, so a layout edited a hundred times never drifts by a
// floating-point residue (spec "Precision"); a preview between two moves keeps the pointer's own precision.
export const precision = 1 / 1024;
export const quantize = (n: number): number => Math.round(n / precision) * precision;

export const end = (b: Box, axis: Axis): number => (axis === 'x' ? b.x + b.width : b.y + b.height);
export const length = (b: Box, axis: Axis): number => b[lengthKey(axis)];
export const cross = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
export const centre = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
export const area = (b: Box): number => b.width * b.height;

export function bounds(boxes: readonly Box[]): Box {
  if (boxes.length === 0) throw new Error('Bounds need at least one box');
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => end(b, 'x'))) - x, height: Math.max(...boxes.map((b) => end(b, 'y'))) - y };
}

// the box two corners span, whichever way the pointer went
export function spanned(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function contains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x - precision && inner.y >= outer.y - precision && end(inner, 'x') <= end(outer, 'x') + precision && end(inner, 'y') <= end(outer, 'y') + precision;
}

export function intersection(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(end(a, 'x'), end(b, 'x')) - x;
  const height = Math.min(end(a, 'y'), end(b, 'y')) - y;
  return width > precision && height > precision ? { x, y, width, height } : null;
}

export const pointInside = (p: Point, b: Box): boolean => p.x >= b.x && p.y >= b.y && p.x <= end(b, 'x') && p.y <= end(b, 'y');

// The even-odd rule: whether a point lies inside a ring.
export function polygonContains(p: Point, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function regionContainsPoint(r: Region, p: Point): boolean {
  if (!pointInside(p, r.box)) return false;
  if (r.polygon !== undefined && !polygonContains(p, r.polygon)) return false;
  return !(r.holes ?? []).some((hole) => polygonContains(p, hole));
}

// The regions under a point, the smallest first: the deepest nested region is what a press means (spec "Hit
// testing": small, nested and overlapping regions stay reachable); ties go to the later region, the one drawn on top.
export function hitRegions(regions: readonly Region[], p: Point): Region[] {
  return regions.filter((r) => regionContainsPoint(r, p)).sort((a, b) => area(a.box) - area(b.box) || b.id.localeCompare(a.id));
}

// How far a point lies from a box's outline (0 on it, positive inside or outside alike).
export function distanceToEdge(p: Point, b: Box): number {
  const inside = pointInside(p, b);
  const dx = Math.max(b.x - p.x, 0, p.x - end(b, 'x'));
  const dy = Math.max(b.y - p.y, 0, p.y - end(b, 'y'));
  if (!inside) return Math.hypot(dx, dy);
  return Math.min(p.x - b.x, end(b, 'x') - p.x, p.y - b.y, end(b, 'y') - p.y);
}

// What is left of a box once another is taken out of it: up to four boxes, the full-width bands above and below the
// cut, then the bands left and right of it. A subtraction that leaves a hole in the middle compiles as a grid cell.
export function subtractBox(source: Box, cut: Box): Box[] {
  const i = intersection(source, cut);
  if (i === null) return [source];
  return [
    { x: source.x, y: source.y, width: source.width, height: i.y - source.y },
    { x: source.x, y: end(i, 'y'), width: source.width, height: end(source, 'y') - end(i, 'y') },
    { x: source.x, y: i.y, width: i.x - source.x, height: i.height },
    { x: end(i, 'x'), y: i.y, width: end(source, 'x') - end(i, 'x'), height: i.height },
  ].filter((b) => b.width > precision && b.height > precision);
}

// A box cut across an axis at these places (the ones inside it), in order along the axis.
export function splitBox(source: Box, axis: Axis, positions: readonly number[]): Box[] {
  const inside = positions.filter((p) => p > source[axis] + precision && p < end(source, axis) - precision).map(quantize);
  const stops = [source[axis], ...new Set(inside), end(source, axis)].sort((a, b) => a - b);
  const parts: Box[] = [];
  for (let i = 1; i < stops.length; i += 1) {
    const from = stops[i - 1] as number;
    const to = stops[i] as number;
    parts.push({ ...source, [axis]: from, [lengthKey(axis)]: to - from });
  }
  return parts;
}

export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  });
  return Math.abs(sum / 2);
}

export function canonicalBox(box: Box): Box {
  return { x: quantize(box.x), y: quantize(box.y), width: quantize(box.width), height: quantize(box.height) };
}

// Two numbers the same within the committed precision.
export const same = (a: number, b: number, tolerance = precision): boolean => Math.abs(a - b) <= tolerance;

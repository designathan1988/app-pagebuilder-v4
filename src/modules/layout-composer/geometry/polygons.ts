// Boolean operations on simple polygons with holes, for the shapes the person draws (spec "Shapes": irregular regions,
// cut-outs, composite areas). The method is a planar arrangement: every edge of both operands is split where any other
// edge crosses or touches it, each piece is kept when the result's inside lies on exactly one side of it, oriented so
// the inside is on its left, and the kept pieces are traced into rings (counter-clockwise outers, clockwise holes).
// Shapes stay authoring geometry: the compiler represents them with normal flow plus a percentage clip-path.
import type { Box, Point, Region } from '../intent/model.ts';
import { polygonContains } from './geometry.ts';

export interface PolygonShape {
  readonly outer: readonly Point[];
  readonly holes: readonly (readonly Point[])[];
}

export interface Segment {
  readonly a: Point;
  readonly b: Point;
}

const EPS = 1e-7;
const crossOf = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const along = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const snapped = (p: Point): Point => ({ x: Math.round(p.x / EPS) * EPS, y: Math.round(p.y / EPS) * EPS });
const keyOf = (p: Point): string => `${Math.round(p.x / EPS)}:${Math.round(p.y / EPS)}`;
const at = <T>(list: readonly T[], index: number): T => list[((index % list.length) + list.length) % list.length] as T;

function signedArea(ring: readonly Point[]): number {
  let sum = 0;
  ring.forEach((p, i) => {
    sum += crossOf(p, at(ring, i + 1));
  });
  return sum / 2;
}

export const shapeArea = (shape: PolygonShape): number => Math.abs(signedArea(shape.outer)) - shape.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
const shapeContains = (shape: PolygonShape, p: Point): boolean => polygonContains(p, shape.outer) && !shape.holes.some((h) => polygonContains(p, h));

export function boxShape(b: Box): PolygonShape {
  return {
    outer: [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
      { x: b.x, y: b.y + b.height },
    ],
    holes: [],
  };
}

export function regionShape(r: Region): PolygonShape {
  return { outer: r.polygon ?? boxShape(r.box).outer, holes: r.holes ?? [] };
}

export function shapeBounds(shape: PolygonShape): Box {
  const xs = shape.outer.map((p) => p.x);
  const ys = shape.outer.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function edgesOf(ring: readonly Point[]): Segment[] {
  return ring.map((a, i) => ({ a, b: at(ring, i + 1) }));
}

function segments(shapes: readonly PolygonShape[]): Segment[] {
  return shapes.flatMap((s) => [s.outer, ...s.holes].flatMap(edgesOf));
}

// The places along segment `a` (0 at its start, 1 at its end) where segment `b` crosses or touches it: a proper
// crossing, an end of one lying on the other (a T junction), or the ends of a collinear overlap.
export function segmentCuts(a: Segment, b: Segment): number[] {
  const u = minus(a.b, a.a);
  const v = minus(b.b, b.a);
  const w = minus(b.a, a.a);
  const den = crossOf(u, v);
  const norm = u.x * u.x + u.y * u.y;
  if (norm < EPS * EPS) return [];
  if (Math.abs(den) > EPS) {
    const t = crossOf(w, v) / den;
    const s = crossOf(w, u) / den;
    return t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS ? [Math.max(0, Math.min(1, t))] : [];
  }
  // parallel: only a collinear overlap cuts, at the other segment's ends
  if (Math.abs(crossOf(w, u)) > EPS) return [];
  return [b.a, b.b]
    .map((p) => {
      const d = minus(p, a.a);
      return (d.x * u.x + d.y * u.y) / norm;
    })
    .filter((t) => t >= -EPS && t <= 1 + EPS)
    .map((t) => Math.max(0, Math.min(1, t)));
}

// A ring without the points that lie on a straight line between their neighbours.
function simplify(ring: readonly Point[]): Point[] {
  let points = [...ring];
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    const kept = points.filter((p, i) => {
      const straight = Math.abs(crossOf(minus(p, at(points, i - 1)), minus(at(points, i + 1), p))) < EPS;
      if (straight) changed = true;
      return !straight;
    });
    points = kept;
  }
  return points;
}

export type BooleanOperation = 'union' | 'intersection' | 'difference';

export function polygonBoolean(a: readonly PolygonShape[], b: readonly PolygonShape[], operation: BooleanOperation): PolygonShape[] {
  const all = segments([...a, ...b]);
  const boundary = new Map<string, Segment>();
  const inside = (p: Point): boolean => {
    const inA = a.some((s) => shapeContains(s, p));
    const inB = b.some((s) => shapeContains(s, p));
    if (operation === 'union') return inA || inB;
    if (operation === 'intersection') return inA && inB;
    return inA && !inB;
  };
  for (const edge of all) {
    const cuts = [0, 1, ...all.flatMap((other) => segmentCuts(edge, other))].sort((x, y) => x - y);
    const stops = cuts.filter((t, i) => i === 0 || Math.abs(t - (cuts[i - 1] as number)) > EPS);
    for (let i = 1; i < stops.length; i += 1) {
      const p = snapped(along(edge.a, edge.b, stops[i - 1] as number));
      const q = snapped(along(edge.a, edge.b, stops[i] as number));
      const v = minus(q, p);
      const len = Math.hypot(v.x, v.y);
      if (len < EPS) continue;
      // which side of the piece is inside the result, probed a hair away from its middle
      const middle = along(p, q, 0.5);
      const offset = Math.min(len / 1000, 1e-4);
      const normal = { x: (-v.y / len) * offset, y: (v.x / len) * offset };
      const left = inside({ x: middle.x + normal.x, y: middle.y + normal.y });
      const right = inside({ x: middle.x - normal.x, y: middle.y - normal.y });
      if (left === right) continue;
      const piece = left ? { a: p, b: q } : { a: q, b: p };
      boundary.set(`${keyOf(piece.a)}>${keyOf(piece.b)}`, piece);
    }
  }
  const outgoing = new Map<string, Segment[]>();
  for (const edge of boundary.values()) outgoing.set(keyOf(edge.a), [...(outgoing.get(keyOf(edge.a)) ?? []), edge]);
  const unused = new Set(boundary.values());
  const rings: Point[][] = [];
  while (unused.size > 0) {
    const start = unused.values().next().value as Segment;
    let current = start;
    const ring: Point[] = [];
    for (let guard = 0; guard <= boundary.size; guard += 1) {
      ring.push(current.a);
      unused.delete(current);
      if (keyOf(current.b) === keyOf(start.a)) break;
      const choices = (outgoing.get(keyOf(current.b)) ?? []).filter((e) => unused.has(e));
      if (choices.length === 0) throw new Error('A polygon boundary did not close');
      // at a vertex several pieces leave from, the sharpest left turn keeps the traced ring simple
      const direction = minus(current.b, current.a);
      const turn = (e: Segment): number => {
        const v = minus(e.b, e.a);
        const r = Math.atan2(crossOf(direction, v), direction.x * v.x + direction.y * v.y);
        return r < 0 ? r + Math.PI * 2 : r;
      };
      current = [...choices].sort((x, y) => turn(x) - turn(y))[0] as Segment;
    }
    const simple = simplify(ring);
    if (simple.length >= 3 && Math.abs(signedArea(simple)) > EPS) rings.push(simple);
  }
  const outers = rings.filter((r) => signedArea(r) > 0).map((outer) => ({ outer, holes: [] as Point[][] }));
  for (const hole of rings.filter((r) => signedArea(r) < 0)) {
    const owner = outers.filter((s) => polygonContains(hole[0] as Point, s.outer)).sort((x, y) => Math.abs(signedArea(x.outer)) - Math.abs(signedArea(y.outer)))[0];
    if (owner === undefined) throw new Error('A polygon hole has no enclosing ring');
    owner.holes.push(hole);
  }
  // top to bottom, then left to right: the first part of a split is the one that keeps the original's content
  return outers.sort((x, y) => shapeBounds(x).y - shapeBounds(y).y || shapeBounds(x).x - shapeBounds(y).x);
}

// Whether a ring is a simple polygon: at least a triangle with an area, and no two edges that are not neighbours touch.
export function simpleRing(ring: readonly Point[]): boolean {
  if (ring.length < 3 || Math.abs(signedArea(ring)) <= EPS) return false;
  const edges = edgesOf(ring);
  for (let i = 0; i < edges.length; i += 1)
    for (let j = i + 1; j < edges.length; j += 1) {
      const neighbours = j === i + 1 || (i === 0 && j === edges.length - 1);
      if (!neighbours && segmentCuts(edges[i] as Segment, edges[j] as Segment).length > 0) return false;
    }
  return true;
}

// The area of one shape lying outside another (0 when the first fits inside the second).
export function outsideArea(inner: PolygonShape, outer: PolygonShape): number {
  return polygonBoolean([inner], [outer], 'difference').reduce((s, p) => s + shapeArea(p), 0);
}

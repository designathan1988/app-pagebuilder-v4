// The shape of a stroke (spec "Gestos compostos"): one press-to-release path may say several things at once — a line
// that turns and crosses again is several cuts, a path that comes back to its start encircles regions to group them.
// This reads a stroke's samples into the straight pieces and the closure the recognizer interprets.
import type { Point } from '../intent/model.ts';

// The distance from a point to the segment between two others.
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const norm = dx * dx + dy * dy;
  if (norm === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / norm));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// The corners of a stroke (Ramer–Douglas–Peucker): the fewest points whose straight pieces stay within the tolerance
// of every sample. A hand's wobble disappears; a deliberate turn stays a corner.
function corners(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  let farthest = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = distanceToSegment(points[i] as Point, first, last);
    if (d > farthest) {
      farthest = d;
      index = i;
    }
  }
  if (farthest <= tolerance) return [first, last];
  return [...corners(points.slice(0, index + 1), tolerance).slice(0, -1), ...corners(points.slice(index), tolerance)];
}

export interface Piece {
  readonly from: Point;
  readonly to: Point;
}

// The straight pieces of a stroke, in the order they were drawn.
export function pieces(points: readonly Point[], tolerance: number): Piece[] {
  const kept = corners(points, tolerance);
  return kept.slice(1).map((to, i) => ({ from: kept[i] as Point, to }));
}

// Whether a stroke comes back to where it started after going around something: a lasso.
export function closed(points: readonly Point[], tolerance: number): boolean {
  if (points.length < 4) return false;
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  const span = Math.max(...points.map((p) => Math.hypot(p.x - first.x, p.y - first.y)));
  return Math.hypot(last.x - first.x, last.y - first.y) <= Math.max(tolerance * 2, span * 0.15) && span > tolerance * 4;
}

// The axis a straight piece runs along mostly ('x' for a horizontal stroke).
export const runsAlong = (piece: Piece): 'x' | 'y' => (Math.abs(piece.to.x - piece.from.x) >= Math.abs(piece.to.y - piece.from.y) ? 'x' : 'y');

// How long a stroke is, sample to sample.
export function travelled(points: readonly Point[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - (points[i] as Point).x, p.y - (points[i] as Point).y), 0);
}

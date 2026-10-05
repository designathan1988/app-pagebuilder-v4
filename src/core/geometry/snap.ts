// Snapping (PRODUCT.md §5; spec snap-while-moving): while an element is moved or resized with snap on, the edges the
// gesture moves are pulled to the lines of the targets Snap settings enables, within the snap distance. Each axis snaps
// on its own, to one line: the line of the earliest tier of SNAP_PRIORITY within the distance of any moving edge, the
// nearest one in that tier (Problems in Pager 1: element edges and centres, guides, the parent and the page win over
// grid lines and ruler ticks, however near those are). Everything here is in page px; the lines come from the canvas
// (src/editor/canvas/snapping.ts), which also draws the line an axis snapped to.

export type SnapAxis = 'x' | 'y';
// what a line belongs to: a sibling element, a manual guide, the parent, the page, a grid line, a ruler tick
export type SnapSource = 'element' | 'guide' | 'parent' | 'page' | 'grid' | 'ruler';

// The priority table: an earlier tier within the snap distance wins over a later one; inside a tier, the nearest.
const SNAP_PRIORITY: readonly (readonly SnapSource[])[] = [
  ['element', 'guide', 'parent', 'page'],
  ['grid', 'ruler'],
];

export interface SnapLine {
  readonly axis: SnapAxis;
  // its place along the axis (x for a vertical line, y for a horizontal one)
  readonly at: number;
  readonly source: SnapSource;
  // the node or the guide it belongs to; null for a grid line and a ruler tick
  readonly target: string | null;
  // where the target spans along the other axis, so the drawn line reaches it; null for a line across the page
  readonly span: { readonly from: number; readonly to: number } | null;
}

export interface Snap {
  // what the moving edges shift by on the axis
  readonly offset: number;
  readonly line: SnapLine;
}

const tierOf = (source: SnapSource): number => SNAP_PRIORITY.findIndex((tier) => tier.includes(source));

// The snap of one axis: the moving edges' places on it (a move: its start, centre and end; a resize: the dragged edge)
// against the lines of that axis, within the distance; null when none is near enough.
export function snapAxis(edges: readonly number[], lines: readonly SnapLine[], distance: number): Snap | null {
  let best: { readonly tier: number; readonly gap: number; readonly snap: Snap } | null = null;
  for (const line of lines) {
    const tier = tierOf(line.source);
    for (const edge of edges) {
      const offset = line.at - edge;
      const gap = Math.abs(offset);
      if (gap > distance) continue;
      if (best === null || tier < best.tier || (tier === best.tier && gap < best.gap)) best = { tier, gap, snap: { offset, line } };
    }
  }
  return best?.snap ?? null;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// a box's places along an axis: its start, its centre, its end
export const placesOf = (box: Box, axis: SnapAxis): readonly [number, number, number] =>
  axis === 'x' ? [box.x, box.x + box.width / 2, box.x + box.width] : [box.y, box.y + box.height / 2, box.y + box.height];

// The ruler ticks near the moving edges: the multiples of the tick step around each edge, within the distance.
export function rulerLines(axis: SnapAxis, edges: readonly number[], step: number, distance: number): SnapLine[] {
  if (!(step > 0)) return [];
  const at = new Set<number>();
  for (const edge of edges) for (let tick = Math.ceil((edge - distance) / step) * step; tick <= edge + distance; tick += step) at.add(tick);
  return [...at].map((value) => ({ axis, at: value, source: 'ruler' as const, target: null, span: null }));
}

// Equal spacing (spec smart-guides): on an axis where no edge snapped, the moved box is pulled so its gap to a sibling
// repeats a gap between two siblings, within the equal-spacing radius. Two boxes form a gap on an axis when they lie
// apart on it and overlap on the other axis by at least `overlap` of the smaller one. What it gives: the offset, the
// gap repeated, and the two gaps to mark (their start and end on the axis, and where along the other axis to draw).
export interface EqualGap {
  readonly axis: SnapAxis;
  readonly offset: number;
  readonly gap: number;
  readonly marks: readonly { readonly from: number; readonly to: number; readonly across: number }[];
}

const along = (box: Box, axis: SnapAxis) => (axis === 'x' ? { start: box.x, end: box.x + box.width } : { start: box.y, end: box.y + box.height });
const acrossOf = (box: Box, axis: SnapAxis) => (axis === 'x' ? { start: box.y, end: box.y + box.height } : { start: box.x, end: box.x + box.width });

// whether two boxes overlap on the axis across `axis` by at least this share of the smaller one
function overlapping(a: Box, b: Box, axis: SnapAxis, overlap: number): boolean {
  const p = acrossOf(a, axis);
  const q = acrossOf(b, axis);
  const shared = Math.min(p.end, q.end) - Math.max(p.start, q.start);
  return shared > 0 && shared >= overlap * Math.min(p.end - p.start, q.end - q.start);
}

// the gap from a to b on an axis when b lies after a on it, else null
function gapBetween(a: Box, b: Box, axis: SnapAxis): number | null {
  const gap = along(b, axis).start - along(a, axis).end;
  return gap >= 0 ? gap : null;
}

export function equalGap(axis: SnapAxis, moved: Box, siblings: readonly Box[], radius: number, overlap: number): EqualGap | null {
  // the gaps between two siblings, each with where to mark it
  const gaps: { gap: number; from: number; to: number; across: number }[] = [];
  for (const a of siblings)
    for (const b of siblings) {
      const gap = a === b || !overlapping(a, b, axis, overlap) ? null : gapBetween(a, b, axis);
      if (gap === null) continue;
      const shared = { start: Math.max(acrossOf(a, axis).start, acrossOf(b, axis).start), end: Math.min(acrossOf(a, axis).end, acrossOf(b, axis).end) };
      gaps.push({ gap, from: along(a, axis).end, to: along(b, axis).start, across: (shared.start + shared.end) / 2 });
    }
  let best: EqualGap | null = null;
  for (const sibling of siblings) {
    if (!overlapping(sibling, moved, axis, overlap)) continue;
    const shared = { start: Math.max(acrossOf(sibling, axis).start, acrossOf(moved, axis).start), end: Math.min(acrossOf(sibling, axis).end, acrossOf(moved, axis).end) };
    const across = (shared.start + shared.end) / 2;
    for (const g of gaps) {
      // the moved box after the sibling, or before it
      const after = along(sibling, axis).end + g.gap - along(moved, axis).start;
      const before = along(sibling, axis).start - g.gap - along(moved, axis).end;
      for (const offset of [after, before]) {
        if (Math.abs(offset) > radius || (best !== null && Math.abs(offset) >= Math.abs(best.offset))) continue;
        const moving = offset === after ? { from: along(sibling, axis).end, to: along(sibling, axis).end + g.gap } : { from: along(sibling, axis).start - g.gap, to: along(sibling, axis).start };
        best = { axis, offset, gap: g.gap, marks: [{ from: g.from, to: g.to, across: g.across }, { ...moving, across }] };
      }
    }
  }
  return best;
}

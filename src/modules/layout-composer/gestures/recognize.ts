import { ORDER, STROKE, lengthKey } from '../geometry/keys.ts';
// One tool, many structural gestures (spec "Ferramenta única de construção"): a stroke is read by where it starts,
// what it crosses and where it ends, and becomes one operation of the gesture algebra. The same reading runs on every
// pointer move for the preview (the predictor says what it understood before anything is committed) and once more by
// the command's handler on the stroke the release hands it, so the committed change is exactly the one previewed.
//
// Reading a stroke with the Layout tool (one tool, no modes to choose):
//  - pressed on a handle: the handle's own edit (a boundary, a vertex, a gap, a repetition, a region's label: it moves
//    the region; dropped wholly inside another region it is nested there, dropped out of its parent it is detached);
//  - pressed on a shared boundary and dragged across it: the boundary moves, and every region along its line follows;
//    rubbed along it: the line is erased, and the two regions it parted are merged;
//  - pressed on a region's own edge (one no other region shares): that edge moves, the region is resized;
//  - pressed inside a selected region and dragged: the region goes wherever it is dropped (a region drawn is selected
//    at once, so it can be dragged straight away);
//  - pressed outside every region, over a box that holds whole regions: they are grouped in a new region drawn there;
//  - pressed outside the regions or on an edge, crossing a region from side to side in a nearly straight line: a cut
//    (a stroke that turns and crosses again is several cuts);
//  - any other drag, in empty space or inside a region: a new region over the dragged box (inside a region, its
//    child).
// A box drawn or moved snaps its edges to the lines near them (spec "Snap"): the container's edges, the other regions'
// edges and centres, and the spacing the layout already repeats; a cut snaps to them too. The lines it snapped to are
// the guides the canvas draws before the release.
// A tool or a key held asks for one reading (spec "Keyboard modifiers": Shift merges what the stroke sweeps, Alt
// subtracts the dragged box, Ctrl cuts); the select tool draws a marquee, the relate tool paints constraints, a closed
// stroke with the group tool encircles regions to group them.
import type { Axis, Box, LayoutIntent, Point, Region } from '../intent/model.ts';
import { childrenOf, descendants, findRegion, region as newRegion } from '../intent/model.ts';
import { nextRegionId } from '../intent/ids.ts';
import { problem, type LayoutProblem } from '../intent/problems.ts';
import { bounds, centre, contains, cross, end, hitRegions, intersection, length, polygonContains, precision, spanned } from '../geometry/geometry.ts';
import { sharedBoundaries, topology } from '../topology/topology.ts';
import { interpretations, patterns, predict, type Interpretation, type Prediction } from '../intent/analysis.ts';
import { execute, type Naming, type Operation, type Result } from './operations.ts';
import { changeRepeat, paintConstraint } from './structural.ts';
import { closed, pieces, runsAlong, travelled, type Piece } from './sequences.ts';
import { responsiveEdit } from '../responsive/continuum.ts';

export type StrokeMode = 'auto' | 'draw' | 'cut' | 'merge' | 'subtract' | 'move' | 'nest' | 'select' | 'relate' | 'group';

export type HandleKind = 'boundary' | 'vertex' | 'gap' | 'repeat' | 'edge' | 'move';
export const HANDLE_KINDS: readonly HandleKind[] = ['boundary', 'vertex', 'gap', 'repeat', 'edge', 'move'];

// A handle's id says what it stands for: "boundary:<boundary id>", "gap:<axis>:<a>:<b>", "repeat:<first region>",
// "move:<region>" (the region's label).
export interface HandleRef {
  readonly kind: HandleKind;
  readonly id: string;
}

export const handleOf = (text: string): HandleRef | null => {
  const at = text.indexOf(':');
  const kind = at < 0 ? '' : text.slice(0, at);
  return (HANDLE_KINDS as readonly string[]).includes(kind) ? { kind: kind as HandleKind, id: text.slice(at + 1) } : null;
};
export const handleText = (handle: HandleRef): string => `${handle.kind}:${handle.id}`;

// Editing at a width narrower than the drawing records responsive behaviour there (spec "Responsive editing"): the
// rule's width, and the regions as the canvas draws them at that width.
export interface ResponsiveContext {
  readonly maxWidth: number;
  readonly view: LayoutIntent;
}

export interface Stroke {
  readonly points: readonly Point[];
  readonly mode: StrokeMode;
  readonly handle: HandleRef | null;
  // how near an edge or a handle a press counts as on it, in the graph's px (the screen radius over the zoom)
  readonly radius: number;
  readonly responsive?: ResponsiveContext | null;
  // the regions selected now: a selected region dragged by its body goes wherever it is dropped
  readonly selected?: readonly string[];
}

export type Cursor = 'crosshair' | 'move' | 'col-resize' | 'row-resize' | 'cell' | 'copy' | 'alias' | 'default' | 'not-allowed';

export interface StrokeReading {
  // the reading the automatic tool chose, or the one asked for
  readonly mode: StrokeMode | 'boundary' | 'vertex' | 'gap' | 'repeat' | 'edge';
  readonly operation: Operation | null;
  // the regions a marquee selects
  readonly selection: readonly string[] | null;
  readonly result: Result | null;
  readonly problems: readonly LayoutProblem[];
  readonly measurements: { readonly width: number; readonly height: number; readonly dx: number; readonly dy: number };
  // what the preview highlights: the regions the stroke swept, the region it would land in, the lines it cuts along,
  // the area it draws, subtracts or selects
  readonly visited: readonly string[];
  readonly parent: string | null;
  readonly cuts: readonly Piece[];
  readonly area: Box | null;
  readonly prediction: Prediction | null;
  readonly candidates: readonly Interpretation[];
  readonly cursor: Cursor;
  // the lines the stroke snapped to, for the canvas to draw
  readonly guides: readonly Guide[];
}

// A line a box snapped to: x = at is a vertical line, y = at a horizontal one.
export interface Guide {
  readonly axis: Axis;
  readonly at: number;
}

// The lines an edge can snap to along an axis: the container's edges, every region's edges and centre (but the ones
// excluded: the region moved and what it holds), and the spacing the siblings already keep, laid again after and
// before every region.
function snapLines(graph: LayoutIntent, axis: Axis, excluded: ReadonlySet<string>): number[] {
  const across: Axis = axis === 'x' ? 'y' : 'x';
  const others = graph.regions.filter((r) => !excluded.has(r.id));
  const lines = [graph.viewport[axis], end(graph.viewport, axis)];
  for (const r of others) lines.push(r.box[axis], end(r.box, axis), centre(r.box)[axis]);
  const gaps = new Set<number>();
  for (const a of others)
    for (const b of others) {
      const gap = b.box[axis] - end(a.box, axis);
      const facing = a.parent === b.parent && Math.min(end(a.box, across), end(b.box, across)) - Math.max(a.box[across], b.box[across]) > 0;
      if (facing && gap > 0 && gap <= SPACING) gaps.add(Math.round(gap));
    }
  for (const r of others) for (const gap of gaps) lines.push(end(r.box, axis) + gap, r.box[axis] - gap);
  return lines;
}

// the widest spacing taken as a spacing the layout repeats
const SPACING = 160;

// The nearest line within the radius, or none.
function nearest(lines: readonly number[], at: number, radius: number): number | null {
  let best: number | null = null;
  for (const line of lines) if (Math.abs(line - at) <= radius && (best === null || Math.abs(line - at) < Math.abs(best - at))) best = line;
  return best;
}

// An edge that comes near the facing edge of a region beside it (the two overlap across the axis) touches it: within
// the radius, contact wins over every other line, so regions drawn or moved next to one another join, with no sliver
// left between them; a gap drawn wider than the radius (cards kept apart) stays. The edge a start edge meets is another
// region's end, and the reverse.
function contact(graph: LayoutIntent, axis: Axis, box: Box, start: boolean, radius: number, excluded: ReadonlySet<string>): number | null {
  const across: Axis = axis === 'x' ? 'y' : 'x';
  const at = start ? box[axis] : end(box, axis);
  let best: number | null = null;
  for (const r of graph.regions) {
    if (excluded.has(r.id)) continue;
    const overlap = Math.min(end(r.box, across), end(box, across)) - Math.max(r.box[across], box[across]);
    if (overlap <= 0) continue;
    const line = start ? end(r.box, axis) : r.box[axis];
    if (Math.abs(line - at) <= radius && (best === null || Math.abs(line - at) < Math.abs(best - at))) best = line;
  }
  return best;
}

// A box drawn: each edge snaps on its own.
export function snapDrawn(graph: LayoutIntent, box: Box, radius: number): { readonly box: Box; readonly guides: Guide[] } {
  const guides: Guide[] = [];
  const edges = (axis: Axis): [number, number] => {
    const lines = snapLines(graph, axis, new Set());
    const from = contact(graph, axis, box, true, radius, new Set()) ?? nearest(lines, box[axis], radius);
    const to = contact(graph, axis, box, false, radius, new Set()) ?? nearest(lines, end(box, axis), radius);
    if (from !== null) guides.push({ axis, at: from });
    if (to !== null && to !== from) guides.push({ axis, at: to });
    const a = from ?? box[axis];
    const b = to ?? end(box, axis);
    return b - a > radius ? [a, b] : [box[axis], end(box, axis)];
  };
  const [x1, x2] = edges('x');
  const [y1, y2] = edges('y');
  return { box: { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) }, guides };
}

// A box moved: it shifts by the smallest pull that puts one of its edges or its centre on a line.
export function snapMoved(graph: LayoutIntent, box: Box, radius: number, excluded: ReadonlySet<string>): { readonly dx: number; readonly dy: number; readonly guides: Guide[] } {
  const guides: Guide[] = [];
  const pull = (axis: Axis): number => {
    const lines = snapLines(graph, axis, excluded);
    let best: { shift: number; at: number } | null = null;
    // an edge meeting the facing edge of a region beside it touches it first
    for (const start of [true, false]) {
      const line = contact(graph, axis, box, start, radius, excluded);
      const at = start ? box[axis] : end(box, axis);
      if (line !== null && (best === null || Math.abs(line - at) < Math.abs(best.shift))) best = { shift: line - at, at: line };
    }
    if (best !== null) {
      guides.push({ axis, at: best.at });
      return best.shift;
    }
    for (const at of [box[axis], centre(box)[axis], end(box, axis)]) {
      const line = nearest(lines, at, radius);
      if (line !== null && (best === null || Math.abs(line - at) < Math.abs(best.shift))) best = { shift: line - at, at: line };
    }
    if (best === null) return 0;
    guides.push({ axis, at: best.at });
    return best.shift;
  };
  return { dx: pull('x'), dy: pull('y'), guides };
}

// A straight piece close enough to a vertical or a horizontal line to be read as a cut: a drag across regions at a
// slant is a box, not a cut.
const straight = (piece: Piece): boolean => {
  const dx = Math.abs(piece.to.x - piece.from.x);
  const dy = Math.abs(piece.to.y - piece.from.y);
  return Math.min(dx, dy) <= Math.max(dx, dy) * 0.25;
};

// A cut snaps along its line to the lines near it (another region's edge, the crossed region's centre).
function snapCut(graph: LayoutIntent, piece: Piece, radius: number): { readonly piece: Piece; readonly guide: Guide | null } {
  const axis: Axis = Math.abs(piece.to.x - piece.from.x) < Math.abs(piece.to.y - piece.from.y) ? 'x' : 'y';
  const at = (piece.from[axis] + piece.to[axis]) / 2;
  const line = nearest(snapLines(graph, axis, new Set()), at, radius);
  if (line === null) return { piece, guide: null };
  const moved = (p: Point): Point => ({ ...p, [axis]: line });
  return { piece: { ...piece, from: moved(piece.from), to: moved(piece.to) }, guide: { axis, at: line } };
}

const nothing = (mode: StrokeReading['mode'], points: readonly Point[], problems: readonly LayoutProblem[] = []): StrokeReading => ({
  mode,
  operation: null,
  selection: null,
  result: null,
  problems,
  measurements: measure(points),
  visited: [],
  parent: null,
  cuts: [],
  area: null,
  prediction: null,
  candidates: [],
  cursor: problems.length > 0 ? 'not-allowed' : 'default',
  guides: [],
});

function measure(points: readonly Point[]): StrokeReading['measurements'] {
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points[points.length - 1] ?? first;
  const box = spanned(first, last);
  return { width: box.width, height: box.height, dx: last.x - first.x, dy: last.y - first.y };
}

// The deepest region under each sample, in the order the stroke met them.
function swept(graph: LayoutIntent, points: readonly Point[]): string[] {
  const met: string[] = [];
  for (const p of points) {
    const hit = hitRegions(graph.regions, p)[0];
    if (hit !== undefined && !met.includes(hit.id)) met.push(hit.id);
  }
  return met;
}

// The regions a straight piece crosses from side to side: a cut there splits them.
function crossedBy(graph: LayoutIntent, piece: Piece): Region[] {
  const axis: Axis = Math.abs(piece.to.x - piece.from.x) < Math.abs(piece.to.y - piece.from.y) ? 'x' : 'y';
  const across: Axis = axis === 'x' ? 'y' : 'x';
  const at = (piece.from[axis] + piece.to[axis]) / 2;
  const lo = Math.min(piece.from[across], piece.to[across]);
  const hi = Math.max(piece.from[across], piece.to[across]);
  return graph.regions.filter((r) => r.kind !== 'content' && lo <= r.box[across] + precision && hi >= end(r.box, across) - precision && at > r.box[axis] + precision && at < end(r.box, axis) - precision);
}

// The deepest region holding a box, leaving out some regions (the one moved and what it holds).
function holder(graph: LayoutIntent, box: Box, excluded: ReadonlySet<string>): Region | null {
  return graph.regions.filter((r) => !excluded.has(r.id) && r.kind !== 'content' && contains(r.box, box)).sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0] ?? null;
}

// The group a reading's prediction and interpretations describe: the parent of what it touched.
function touchedParent(result: Result, fallback: string | null): string | null {
  if (!result.ok) return fallback;
  const touched = result.affected.map((id) => findRegion(result.graph, id)).find((r) => r !== undefined);
  return touched?.parent ?? fallback ?? null;
}

function read(graph: LayoutIntent, stroke: Stroke, mode: StrokeReading['mode'], operation: Operation, naming: Naming, extra: Partial<StrokeReading>, cursor: Cursor): StrokeReading {
  const result = execute(graph, operation, naming);
  const parent = touchedParent(result, extra.parent ?? null);
  return {
    mode,
    operation,
    selection: null,
    result,
    problems: result.ok ? [] : result.problems,
    measurements: measure(stroke.points),
    visited: [],
    parent: null,
    cuts: [],
    area: null,
    guides: [],
    ...extra,
    prediction: result.ok ? predict(result.graph, parent) : null,
    candidates: result.ok ? interpretations(result.graph, parent).slice(0, 3) : [],
    cursor: result.ok ? cursor : 'not-allowed',
  };
}

// A region dragged by the travel of the stroke: it snaps to the lines near it, and where it lands decides its parent
// (the deepest region holding the moved box, never itself or what it holds).
// A split line drawn inside a region (S held), short of its edges: it is carried across the deepest region it lies in,
// edge to edge, so a cut need not start outside the region. A line already across regions is kept as drawn.
function across(graph: LayoutIntent, piece: Piece): Piece {
  if (!straight(piece) || crossedBy(graph, piece).length > 0) return piece;
  const middle = { x: (piece.from.x + piece.to.x) / 2, y: (piece.from.y + piece.to.y) / 2 };
  const inside = hitRegions(graph.regions, middle)[0];
  if (inside === undefined) return piece;
  const vertical = Math.abs(piece.to.x - piece.from.x) < Math.abs(piece.to.y - piece.from.y);
  const b = inside.box;
  return vertical ? { from: { x: middle.x, y: b.y - 1 }, to: { x: middle.x, y: b.y + b.height + 1 } } : { from: { x: b.x - 1, y: middle.y }, to: { x: b.x + b.width + 1, y: middle.y } };
}

// Whether a region holds another, at any depth.
function holds(graph: LayoutIntent, outer: string, inner: string): boolean {
  return descendants(graph, [outer]).has(inner) && outer !== inner;
}

function readMove(graph: LayoutIntent, stroke: Stroke, target: Region, mode: 'move' | 'nest', naming: Naming, along: readonly string[] = []): StrokeReading {
  const points = stroke.points;
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  if (Math.hypot(last.x - first.x, last.y - first.y) < precision) return { ...nothing(mode, points), visited: [target.id] };
  // the regions that go: the one dragged and the other picked ones beside it (one inside another goes with it)
  const picked = [target.id, ...along.filter((id) => id !== target.id && findRegion(graph, id) !== undefined)];
  const ids = picked.filter((id) => !picked.some((other) => other !== id && descendants(graph, [other]).has(id)));
  const regions = ids.map((id) => findRegion(graph, id) as Region);
  const moving = descendants(graph, ids);
  const whole = bounds(regions.map((r) => r.box));
  const pulled = snapMoved(graph, { ...whole, x: whole.x + last.x - first.x, y: whole.y + last.y - first.y }, stroke.radius, moving);
  const dx = Math.round(last.x - first.x + pulled.dx);
  const dy = Math.round(last.y - first.y + pulled.dy);
  const movedBox = { ...whole, x: whole.x + dx, y: whole.y + dy };
  // one region lands in the region that holds it; several land together only where they all share a parent
  const landing = holder(graph, movedBox, moving);
  const parent = landing?.id ?? null;
  const from = target.parent;
  const reparent = parent !== from && regions.every((r) => r.parent === from);
  if (mode === 'nest' && (parent === null || parent === from)) return { ...nothing('nest', points, [problem('missing-parent', { region: target.name })]), visited: [target.id] };
  const operations: Operation[] = [{ kind: 'move', ids, dx, dy }];
  if (reparent) operations.push(parent === null ? { kind: 'extract', ids } : { kind: 'nest', ids, parent });
  const operation: Operation = operations.length === 1 ? (operations[0] as Operation) : { kind: 'compose', operations };
  return read(graph, stroke, reparent ? 'nest' : 'move', operation, naming, { visited: ids, parent: reparent ? parent : from, area: movedBox, guides: pulled.guides }, 'move');
}

// The edge of a region's own a press is on (one no other region shares), within the radius: its axis and whether it
// is the region's far edge along it. The deepest region's first, so a child's edge wins over its parent's.
interface OwnEdge {
  readonly region: Region;
  readonly axis: Axis;
  readonly far: boolean;
}
function ownEdge(graph: LayoutIntent, p: Point, radius: number): OwnEdge | null {
  const within = (axis: Axis, b: Box) => p[axis] >= b[axis] - radius && p[axis] <= end(b, axis) + radius;
  const sorted = [...graph.regions].sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);
  for (const region of sorted)
    for (const axis of ['x', 'y'] as const) {
      if (!within(cross(axis), region.box)) continue;
      if (Math.abs(p[axis] - region.box[axis]) <= radius) return { region, axis, far: false };
      if (Math.abs(p[axis] - end(region.box, axis)) <= radius) return { region, axis, far: true };
    }
  return null;
}

// A region's own edge dragged: the edge follows the pointer and snaps to the lines near it; the region never gets
// thinner than the radius twice over.
function readResize(graph: LayoutIntent, stroke: Stroke, edge: OwnEdge, naming: Naming): StrokeReading {
  const last = stroke.points[stroke.points.length - 1] as Point;
  const { region, axis, far } = edge;
  const line = nearest(snapLines(graph, axis, descendants(graph, [region.id])), last[axis], stroke.radius);
  const at = Math.round(line ?? last[axis]);
  const b = region.box;
  const size = lengthKey(axis);
  const least = stroke.radius * 2;
  const from = far ? b[axis] : Math.min(at, end(b, axis) - least);
  const to = far ? Math.max(b[axis] + least, at) : end(b, axis);
  const box: Box = { ...b, [axis]: from, [size]: to - from };
  return read(graph, stroke, 'edge', { kind: 'resize-region', id: region.id, box }, naming, { visited: [region.id], area: box, guides: line === null ? [] : [{ axis, at }] }, axis === 'x' ? 'col-resize' : 'row-resize');
}

// A region placed from outside the Layout tool (the Select tool's drag of its element, or of one of its resize handles:
// layout.place): moved by (dx, dy), or the edges named (n, s, e, w, and the corners) moved by them, snapped to the
// lines near them as a stroke is (the facing edge of a neighbour first). The same reading the Layout tool's own move
// and resize give, so the page keeps the region where it was put and the grid follows.
export type PlaceEdges = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export function readPlace(graph: LayoutIntent, id: string, edges: PlaceEdges, dx: number, dy: number, radius: number, naming: Naming): StrokeReading {
  const region = findRegion(graph, id);
  if (region === undefined) return nothing('move', [], [problem('unknown-region', { region: id })]);
  const centre_ = centre(region.box);
  const points = [centre_, { x: centre_.x + dx, y: centre_.y + dy }];
  const stroke: Stroke = { points, mode: 'move', handle: null, radius };
  if (edges === 'move') return readMove(graph, stroke, region, 'move', naming);
  const excluded = descendants(graph, [region.id]);
  const b = region.box;
  const least = radius * 2;
  let { x, y } = b;
  let right = end(b, 'x');
  let bottom = end(b, 'y');
  const guides: Guide[] = [];
  const snap = (axis: Axis, at: number, start: boolean): number => {
    const moved = start ? { ...b, [axis]: at } : { ...b, [lengthKey(axis)]: at - b[axis] };
    const line = contact(graph, axis, moved, start, radius, excluded) ?? nearest(snapLines(graph, axis, excluded), at, radius);
    if (line !== null) guides.push({ axis, at: line });
    return Math.round(line ?? at);
  };
  if (edges.includes('w')) x = Math.min(snap('x', b.x + dx, true), right - least);
  if (edges.includes('e')) right = Math.max(snap('x', right + dx, false), x + least);
  if (edges.includes('n')) y = Math.min(snap('y', b.y + dy, true), bottom - least);
  if (edges.includes('s')) bottom = Math.max(snap('y', bottom + dy, false), y + least);
  const box: Box = { x, y, width: right - x, height: bottom - y };
  // a neighbour the grown edge runs into gives way: its facing edge moves along, keeping the gap there was between
  // them, as the line two regions share does when it is dragged; one that would get thinner than the least size stops
  // it
  const pushed: Operation[] = [];
  for (const other of childrenOf(graph, region.parent)) {
    if (other.id === region.id || intersection(other.box, box) === null) continue;
    const o = other.box;
    const was = (axis: Axis, after: boolean) => (after ? o[axis] - end(b, axis) : b[axis] - end(o, axis));
    let next: Box | null = null;
    if (edges.includes('e') && o.x >= end(b, 'x')) next = { ...o, x: right + was('x', true), width: end(o, 'x') - (right + was('x', true)) };
    else if (edges.includes('w') && end(o, 'x') <= b.x) next = { ...o, width: x - was('x', false) - o.x };
    else if (edges.includes('s') && o.y >= end(b, 'y')) next = { ...o, y: bottom + was('y', true), height: end(o, 'y') - (bottom + was('y', true)) };
    else if (edges.includes('n') && end(o, 'y') <= b.y) next = { ...o, height: y - was('y', false) - o.y };
    if (next === null || next.width < least || next.height < least) return { ...nothing('edge', points, [problem('overlap')]), area: box, visited: [region.id, other.id] };
    pushed.push({ kind: 'resize-region', id: other.id, box: next });
  }
  const resize: Operation = { kind: 'resize-region', id: region.id, box };
  return read(graph, stroke, 'edge', pushed.length === 0 ? resize : { kind: 'compose', operations: [...pushed, resize] }, naming, { visited: [region.id], area: box, guides }, 'move');
}

// A handle's edit (spec "Structural Handles"): a boundary or polygon edge moves, a vertex moves, a gap changes for the
// whole group, a repetition grows or shrinks by whole items, a label moves its region.
function readHandle(graph: LayoutIntent, stroke: Stroke, handle: HandleRef, naming: Naming): StrokeReading {
  const first = stroke.points[0] as Point;
  const last = stroke.points[stroke.points.length - 1] as Point;
  if (handle.kind === 'move') {
    const target = findRegion(graph, handle.id);
    return target === undefined ? nothing('move', stroke.points, [problem('unknown-region', { region: handle.id })]) : readMove(graph, stroke, target, 'move', naming);
  }
  if (handle.kind === 'boundary') {
    const boundary = topology(graph).boundaries.find((b) => b.id === handle.id);
    if (boundary === undefined) return nothing('boundary', stroke.points, [problem('unknown-boundary')]);
    return read(graph, stroke, 'boundary', { kind: 'boundary', id: boundary.id, at: last[boundary.axis] }, naming, { visited: boundary.regions }, boundary.axis === 'x' ? 'col-resize' : 'row-resize');
  }
  if (handle.kind === 'vertex') return read(graph, stroke, 'vertex', { kind: 'vertex', id: handle.id, point: last }, naming, {}, 'move');
  if (handle.kind === 'edge') {
    const edge = topology(graph).edges.find((e) => e.id === handle.id);
    if (edge === undefined) return nothing('edge', stroke.points, [problem('unknown-edge')]);
    // the travel across the edge, along its normal
    const dx = edge.to.x - edge.from.x;
    const dy = edge.to.y - edge.from.y;
    const size = Math.hypot(dx, dy);
    const distance = ((last.x - first.x) * -dy + (last.y - first.y) * dx) / size;
    return read(graph, stroke, 'edge', { kind: 'edge', id: edge.id, distance }, naming, { visited: edge.regions }, 'move');
  }
  if (handle.kind === 'gap') {
    // gap:<axis>:<first region>:<second region>
    const [axisText, a, b] = handle.id.split(':');
    const axis: Axis = axisText === 'y' ? 'y' : 'x';
    const left = findRegion(graph, a ?? '');
    const right = findRegion(graph, b ?? '');
    if (left === undefined || right === undefined) return nothing('gap', stroke.points, [problem('unknown-region', { region: a ?? '' })]);
    // every sibling in the same line shares the gap: the drag sets one gap for the whole group
    const line = childrenOf(graph, left.parent).filter((r) => Math.min(end(r.box, axis === 'x' ? 'y' : 'x'), end(left.box, axis === 'x' ? 'y' : 'x')) - Math.max(r.box[axis === 'x' ? 'y' : 'x'], left.box[axis === 'x' ? 'y' : 'x']) > precision);
    const now = right.box[axis] - end(left.box, axis);
    const gap = Math.max(0, Math.round((now + (last[axis] - first[axis])) * 1024) / 1024);
    const held = graph.constraints.find((c) => c.kind === 'gap' && c.axis === axis && c.regions.length === line.length && line.every((r) => c.regions.includes(r.id)));
    const constraint = held !== undefined ? { ...held, value: gap } : (paintConstraint(graph, 'gap', line.map((r) => r.id), axis, gap) as Extract<Operation, { kind: 'constraint' }>).constraint;
    return read(graph, stroke, 'gap', { kind: 'constraint', constraint }, naming, { visited: line.map((r) => r.id) }, axis === 'x' ? 'col-resize' : 'row-resize');
  }
  // repeat:<first region>: the drag along the pattern adds or removes whole items
  const pattern = patterns(graph).find((p) => p.regions[0] === handle.id && (p.kind === 'repeated-row' || p.kind === 'repeated-column' || p.kind === 'grid'));
  const head = findRegion(graph, handle.id);
  if (pattern === undefined || head === undefined) return nothing('repeat', stroke.points, [problem('repeat-count')]);
  const axis: Axis = pattern.kind === 'repeated-column' ? 'y' : 'x';
  const stride = length(head.box, axis) + pattern.gap;
  const count = Math.max(1, pattern.count + Math.round((last[axis] - first[axis]) / stride));
  if (count === pattern.count) return { ...nothing('repeat', stroke.points), visited: pattern.regions, cursor: axis === 'x' ? 'col-resize' : 'row-resize' };
  return read(graph, stroke, 'repeat', changeRepeat(graph, pattern.regions, count, axis, pattern.gap), naming, { visited: pattern.regions }, axis === 'x' ? 'col-resize' : 'row-resize');
}

// A stroke at a narrower width records responsive behaviour (spec "Responsive editing"): a divider dragged sets the
// two regions' widths there, a region dragged among its siblings sets their order there; any other change of
// structure belongs to the drawing's own width.
function readResponsive(graph: LayoutIntent, stroke: Stroke, context: ResponsiveContext, naming: Naming): StrokeReading {
  const view = context.view;
  const first = stroke.points[0] as Point;
  const last = stroke.points[stroke.points.length - 1] as Point;
  const boundary = stroke.handle?.kind === 'boundary' ? topology(view).boundaries.find((b) => b.id === stroke.handle?.id) : sharedBoundaries(view).find((b) => Math.abs(first[b.axis] - b.at) <= stroke.radius && first[b.axis === 'x' ? 'y' : 'x'] >= b.from && first[b.axis === 'x' ? 'y' : 'x'] <= b.to);
  if (boundary !== undefined && boundary.axis === 'x' && boundary.regions.length === 2) {
    const [a, b] = boundary.regions.map((id) => findRegion(view, id) as Region).sort((p, q) => p.box.x - q.box.x) as [Region, Region];
    const widthA = Math.max(1, Math.round(last.x - a.box.x));
    const widthB = Math.max(1, Math.round(end(b.box, 'x') - last.x));
    const sizeA = responsiveEdit(graph, context.maxWidth, { kind: 'size', id: a.id, width: widthA });
    // the second size extends the rule the first one wrote, so both land in one rule
    const once = execute(graph, sizeA, naming);
    const both: Operation = once.ok ? { kind: 'compose', operations: [sizeA, responsiveEdit(once.graph, context.maxWidth, { kind: 'size', id: b.id, width: widthB })] } : sizeA;
    return read(graph, stroke, 'boundary', both, naming, { visited: [a.id, b.id] }, 'col-resize');
  }
  const target = hitRegions(view.regions, first)[0];
  if (target !== undefined && travelled(stroke.points) > stroke.radius) {
    // the siblings in the order they would stand with the dragged one dropped at the release
    const siblings = childrenOf(view, target.parent);
    const flowAxis: Axis = siblings.every((s) => Math.abs(s.box.x - (siblings[0] as Region).box.x) <= 2) ? 'y' : 'x';
    const placed = siblings.map((s) => ({ id: s.id, at: s.id === target.id ? last[flowAxis] : centre(s.box)[flowAxis] })).sort((p, q) => p.at - q.at);
    return read(graph, stroke, 'move', responsiveEdit(graph, context.maxWidth, { kind: ORDER, ids: placed.map((p) => p.id) }), naming, { visited: [target.id] }, 'move');
  }
  return nothing('auto', stroke.points, [problem(STROKE)]);
}

export function readStroke(graph: LayoutIntent, stroke: Stroke, naming: Naming): StrokeReading {
  const points = stroke.points;
  if (points.length === 0) return nothing('auto', points, [problem(STROKE)]);
  if (stroke.responsive !== undefined && stroke.responsive !== null) return readResponsive(graph, stroke, stroke.responsive, naming);
  if (stroke.handle !== null) return readHandle(graph, stroke, stroke.handle, naming);
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  const box = spanned(first, last);
  const tolerance = Math.max(stroke.radius, 2);
  let mode = stroke.mode;
  if (mode === 'auto') {
    // a press on the line two regions share drags it (both regions follow); on a region's own edge, resizes it
    const boundary = sharedBoundaries(graph).find((b) => Math.abs(first[b.axis] - b.at) <= stroke.radius && first[b.axis === 'x' ? 'y' : 'x'] >= b.from && first[b.axis === 'x' ? 'y' : 'x'] <= b.to);
    if (boundary !== undefined) return readHandle(graph, stroke, { kind: 'boundary', id: boundary.id }, naming);
    const edge = ownEdge(graph, first, stroke.radius);
    if (edge !== null) return readResize(graph, stroke, edge, naming);
    // anything else draws: in empty space a region, inside a region its child; a box drawn from empty space around
    // whole regions puts them in the new region
    const around = hitRegions(graph.regions, first)[0] === undefined && box.width > stroke.radius && box.height > stroke.radius && graph.regions.some((r) => contains(box, r.box));
    mode = around ? 'group' : 'draw';
  }
  // Ctrl held: a region dragged by its body goes wherever it is dropped (the picked region under the press with the
  // other picked ones, else the deepest region there); from empty space the drag is a selection box
  if (mode === 'move') {
    const picked = hitRegions(graph.regions, first).find((r) => stroke.selected?.includes(r.id) === true);
    if (picked !== undefined) return readMove(graph, stroke, picked, 'move', naming, stroke.selected ?? []);
    const under = hitRegions(graph.regions, first)[0];
    if (under !== undefined) return readMove(graph, stroke, under, 'move', naming);
    mode = 'select';
  }
  switch (mode) {
    case 'draw': {
      if (box.width < stroke.radius || box.height < stroke.radius) return nothing('draw', points);
      const snapped = snapDrawn(graph, box, stroke.radius);
      const parent = holder(graph, snapped.box, new Set());
      const id = nextRegionId(graph);
      const made = { ...newRegion(id, snapped.box, naming.named(null, Number(id.slice(1)))), parent: parent?.id ?? null };
      return read(graph, stroke, 'draw', { kind: 'draw', region: made }, naming, { area: snapped.box, parent: parent?.id ?? null, guides: snapped.guides }, 'crosshair');
    }
    case 'cut': {
      const snappedCuts = pieces(points, tolerance)
        .map((piece) => across(graph, piece))
        .filter((piece) => crossedBy(graph, piece).length > 0)
        .map((piece) => snapCut(graph, piece, stroke.radius))
        .filter((one) => crossedBy(graph, one.piece).length > 0);
      const cuts = snappedCuts.map((one) => one.piece);
      const guides = snappedCuts.flatMap((one) => (one.guide === null ? [] : [one.guide]));
      if (cuts.length === 0) return nothing('cut', points, travelled(points) > stroke.radius ? [problem('cut-nothing')] : []);
      const operation: Operation = cuts.length === 1 ? { kind: 'cut', from: (cuts[0] as Piece).from, to: (cuts[0] as Piece).to } : { kind: 'compose', operations: cuts.map((piece) => ({ kind: 'cut' as const, from: piece.from, to: piece.to })) };
      return read(graph, stroke, 'cut', operation, naming, { cuts, guides, visited: [...new Set(cuts.flatMap((piece) => crossedBy(graph, piece).map((r) => r.id)))] }, runsAlong(cuts[0] as Piece) === 'x' ? 'row-resize' : 'col-resize');
    }
    case 'merge': {
      const visited = swept(graph, points);
      if (visited.length < 2) return { ...nothing('merge', points), visited, cursor: 'cell' };
      // the regions swept become one over the box they span, apart as they may stand
      const ids = visited.filter((id) => !visited.some((other) => holds(graph, other, id)));
      return read(graph, stroke, 'merge', { kind: 'merge', ids, span: true }, naming, { visited: ids, area: bounds(ids.map((id) => (findRegion(graph, id) as Region).box)) }, 'cell');
    }
    case 'subtract': {
      if (box.width < stroke.radius || box.height < stroke.radius) return nothing('subtract', points);
      // the deepest regions the area overlaps: a subtraction cuts what is drawn, never through nested regions
      const overlapped = graph.regions.filter((r) => r.kind !== 'content' && intersection(r.box, box) !== null);
      const ids = overlapped.filter((r) => !overlapped.some((inner) => inner.parent === r.id)).map((r) => r.id);
      if (ids.length === 0) return { ...nothing('subtract', points), area: box };
      return read(graph, stroke, 'subtract', { kind: 'subtract', ids, box }, naming, { area: box, visited: ids }, 'crosshair');
    }
    case 'nest': {
      const target = hitRegions(graph.regions, first)[0];
      return target === undefined ? nothing(mode, points) : readMove(graph, stroke, target, mode, naming);
    }
    case 'select': {
      const inside = graph.regions.filter((r) => contains(box, r.box));
      const selection = inside.filter((r) => !inside.some((outer) => outer.id === r.parent)).map((r) => r.id);
      return { ...nothing('select', points), selection, area: box, visited: selection, cursor: 'default' };
    }
    case 'group': {
      // a box drawn around whole regions (the Layout tool), or a lasso closed around them (the group mode)
      const boxed = stroke.mode === 'auto';
      if (!boxed && !closed(points, tolerance)) return { ...nothing('group', points), area: box };
      const around = boxed ? graph.regions.filter((r) => contains(box, r.box)) : graph.regions.filter((r) => polygonContains(centre(r.box), points));
      const roots = around.filter((r) => !around.some((outer) => outer.id === r.parent));
      const parent = roots[0]?.parent ?? null;
      if (roots.length < (boxed ? 1 : 2) || roots.some((r) => r.parent !== parent)) return { ...nothing('group', points, [problem('group-siblings')]), area: box };
      // the new wrapper spans what it groups (a box drawn around them: the box, snapped); it is only checked once the
      // regions are inside it (execute validates the whole compound operation at its end)
      const outline = boxed ? snapDrawn(graph, box, stroke.radius).box : bounds(roots.map((r) => r.box));
      const id = nextRegionId(graph);
      const wrapper = { ...newRegion(id, outline, naming.named(null, Number(id.slice(1)))), parent };
      const operation: Operation = { kind: 'compose', operations: [{ kind: 'draw', region: wrapper }, { kind: 'nest', ids: roots.map((r) => r.id), parent: id }] };
      return read(graph, stroke, 'group', operation, naming, { visited: roots.map((r) => r.id), area: outline }, 'copy');
    }
    case 'relate':
      return readRelation(graph, stroke, naming);
    default:
      return nothing('auto', points);
  }
}

// Constraint painting (spec "Constraint Painting"): a stroke across three siblings or more equalizes them along its
// direction; between two siblings in one line it keeps their gap, between two elsewhere it aligns their nearest
// edges; out of one region into free space it makes the region fill what is left.
function readRelation(graph: LayoutIntent, stroke: Stroke, naming: Naming): StrokeReading {
  const points = stroke.points;
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  const axis: Axis = Math.abs(last.x - first.x) >= Math.abs(last.y - first.y) ? 'x' : 'y';
  const across: Axis = axis === 'x' ? 'y' : 'x';
  const visited = swept(graph, points);
  const held = visited.map((id) => findRegion(graph, id) as Region);
  const siblings = held.length > 0 && held.every((r) => r.parent === (held[0] as Region).parent);
  if (held.length >= 3 && siblings) return read(graph, stroke, 'relate', paintConstraint(graph, 'equal-size', visited, axis), naming, { visited }, 'alias');
  if (held.length === 2 && siblings) {
    const [a, b] = held as [Region, Region];
    const inLine = Math.min(end(a.box, across), end(b.box, across)) - Math.max(a.box[across], b.box[across]) > precision;
    if (inLine) return read(graph, stroke, 'relate', paintConstraint(graph, 'gap', visited, axis), naming, { visited }, 'alias');
    // the edges the stroke links: the pair of starts, of ends or of centres that lie closest
    const choices = [
      { kind: 'align-start' as const, distance: Math.abs(a.box[axis] - b.box[axis]) },
      { kind: 'align-end' as const, distance: Math.abs(end(a.box, axis) - end(b.box, axis)) },
      { kind: 'align-center' as const, distance: Math.abs(centre(a.box)[axis] - centre(b.box)[axis]) },
    ].sort((p, q) => p.distance - q.distance);
    return read(graph, stroke, 'relate', paintConstraint(graph, (choices[0] as (typeof choices)[number]).kind, visited, axis), naming, { visited }, 'alias');
  }
  if (held.length === 1 && hitRegions(graph.regions, last).every((r) => r.id !== (held[0] as Region).id)) return read(graph, stroke, 'relate', paintConstraint(graph, 'fill-available', visited, axis), naming, { visited }, 'alias');
  return { ...nothing('relate', points, held.length > 1 && !siblings ? [problem('gap-siblings')] : []), visited };
}

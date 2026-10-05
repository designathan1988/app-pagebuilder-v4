// The layout's topology, independent of any CSS (spec "Layout Topology", "Topological Editing"): the boundaries the
// regions of one parent share, cut at every place another boundary meets them, so a long edge beside two short ones is
// two shared boundaries and a T junction is a real vertex; the vertices where boundaries meet; and which regions touch.
// A boundary is a real entity of the layout: dragging it moves every region along it (gestures/operations.ts), removing
// it merges, duplicating it cuts. And the graph's validity (spec "Layout validity"): overlaps, orphans, impossible
// sizes, conflicting definitions, degenerate geometry and hierarchy cycles.
import type { Axis, LayoutIntent, Point } from '../intent/model.ts';
import { findRegion, preferenceKey } from '../intent/model.ts';
import { problem, type LayoutProblem } from '../intent/problems.ts';
import { contains, cross, end, intersection, polygonArea, precision } from '../geometry/geometry.ts';
import { outsideArea, polygonBoolean, regionShape, segmentCuts, shapeArea, shapeBounds, simpleRing } from '../geometry/polygons.ts';

export interface Boundary {
  readonly id: string;
  // the axis the boundary is a line across: 'x' for a vertical line at x = at
  readonly axis: Axis;
  readonly at: number;
  readonly from: number;
  readonly to: number;
  // the regions whose edge it is (two for a shared boundary, one on the outline)
  readonly regions: readonly string[];
  readonly parent: string | null;
}

interface Vertex extends Point {
  readonly id: string;
  readonly boundaries: readonly string[];
}

// An edge of the mesh: a boundary, or a piece of a polygon's outline (which need not run along an axis).
export interface MeshEdge {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
  readonly regions: readonly string[];
}

export interface Topology {
  readonly boundaries: readonly Boundary[];
  readonly edges: readonly MeshEdge[];
  readonly vertices: readonly Vertex[];
  readonly adjacency: Readonly<Record<string, readonly string[]>>;
}

// A graph is immutable: its topology is computed once and kept as long as the graph lives (a pointer move that
// previews against the same graph pays nothing).
const cache = new WeakMap<LayoutIntent, Topology>();

const pointKey = (p: Point): string => `${Math.round(p.x * 1e7) / 1e7}:${Math.round(p.y * 1e7) / 1e7}`;

function addAdjacent(adjacency: Record<string, string[]>, regions: readonly string[]): void {
  for (const id of regions) adjacency[id] = [...new Set([...(adjacency[id] ?? []), ...regions.filter((r) => r !== id)])];
}

// The outlines of polygon regions split at every crossing with an edge of the same parent.
function polygonEdges(graph: LayoutIntent): MeshEdge[] {
  const edges = graph.regions.flatMap((r) => {
    const shape = regionShape(r);
    return [shape.outer, ...shape.holes].flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] as Point, region: r.id, parent: r.parent })));
  });
  const result = new Map<string, MeshEdge>();
  for (const edge of edges) {
    const stops = [...new Set([0, 1, ...edges.filter((e) => e.parent === edge.parent).flatMap((e) => segmentCuts(edge, e))])].sort((a, b) => a - b);
    for (let i = 1; i < stops.length; i += 1) {
      const t0 = stops[i - 1] as number;
      const t1 = stops[i] as number;
      if (t1 - t0 < 1e-7) continue;
      const point = (t: number): Point => ({ x: edge.a.x + (edge.b.x - edge.a.x) * t, y: edge.a.y + (edge.b.y - edge.a.y) * t });
      const a = point(t0);
      const b = point(t1);
      const [from, to] = pointKey(a) < pointKey(b) ? [a, b] : [b, a];
      const id = `edge:${edge.parent ?? 'root'}:${pointKey(from)}:${pointKey(to)}`;
      result.set(id, { id, from, to, regions: [...new Set([...(result.get(id)?.regions ?? []), edge.region])] });
    }
  }
  return [...result.values()];
}

export function topology(graph: LayoutIntent): Topology {
  const cached = cache.get(graph);
  if (cached !== undefined) return cached;
  // every rectangle edge, grouped by parent, axis and place: the edges in one group are collinear
  const groups = new Map<string, { axis: Axis; at: number; parent: string | null; edges: { from: number; to: number; id: string }[] }>();
  for (const r of graph.regions.filter((one) => one.polygon === undefined))
    for (const axis of ['x', 'y'] as const)
      for (const at of [r.box[axis], end(r.box, axis)]) {
        const key = `${preferenceKey(r.parent)}:${axis}:${at}`;
        const group = groups.get(key) ?? { axis, at, parent: r.parent, edges: [] };
        group.edges.push({ from: r.box[cross(axis)], to: end(r.box, cross(axis)), id: r.id });
        groups.set(key, group);
      }
  const boundaries: Boundary[] = [];
  const adjacency: Record<string, string[]> = {};
  for (const [key, group] of groups) {
    // cut at every end of any collinear edge: each piece has one fixed set of regions along it
    const stops = [...new Set(group.edges.flatMap((e) => [e.from, e.to]))].sort((a, b) => a - b);
    for (let i = 1; i < stops.length; i += 1) {
      const from = stops[i - 1] as number;
      const to = stops[i] as number;
      const regions = group.edges.filter((e) => e.from <= from && e.to >= to).map((e) => e.id).sort();
      if (regions.length === 0) continue;
      boundaries.push({ id: `${key}:${from}:${to}`, axis: group.axis, at: group.at, from, to, regions, parent: group.parent });
      addAdjacent(adjacency, regions);
    }
  }
  const points = new Map<string, Vertex>();
  const addVertex = (p: Point, edge: string) => {
    const id = pointKey(p);
    const held = points.get(id);
    points.set(id, { id, x: p.x, y: p.y, boundaries: [...new Set([...(held?.boundaries ?? []), edge])] });
  };
  for (const b of boundaries)
    for (const at of [b.from, b.to]) addVertex(b.axis === 'x' ? { x: b.at, y: at } : { x: at, y: b.at }, b.id);
  const shaped = graph.regions.some((r) => r.polygon !== undefined);
  const edges: MeshEdge[] = shaped
    ? polygonEdges(graph)
    : boundaries.map((b) => ({ id: `edge:${b.id}`, from: b.axis === 'x' ? { x: b.at, y: b.from } : { x: b.from, y: b.at }, to: b.axis === 'x' ? { x: b.at, y: b.to } : { x: b.to, y: b.at }, regions: b.regions }));
  for (const e of edges) {
    addAdjacent(adjacency, e.regions);
    // the edges of rectangles are their boundaries again: their vertices are counted once, by the boundaries
    if (shaped) {
      addVertex(e.from, e.id);
      addVertex(e.to, e.id);
    }
  }
  const result: Topology = { boundaries, edges, vertices: [...points.values()], adjacency };
  cache.set(graph, result);
  return result;
}

// The boundaries two regions share (the ones a drag between them moves).
export const sharedBoundaries = (graph: LayoutIntent): Boundary[] => topology(graph).boundaries.filter((b) => b.regions.length === 2);

// Every reason the graph is not a valid layout; none for a valid one.
export function validateIntent(graph: LayoutIntent): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const ids = new Set<string>();
  if (graph.version !== 1) problems.push(problem('version'));
  if (![graph.viewport.x, graph.viewport.y, graph.viewport.width, graph.viewport.height].every(Number.isFinite) || graph.viewport.width <= 0 || graph.viewport.height <= 0) problems.push(problem('viewport'));
  if (!Number.isInteger(graph.revision) || graph.revision < 0) problems.push(problem('version'));
  for (const [name, value] of Object.entries(graph.variables)) if (!Number.isFinite(value) || value < 0) problems.push(problem('variable', { name }));
  if (graph.reference !== undefined && (!Number.isFinite(graph.reference.opacity) || graph.reference.opacity < 0 || graph.reference.opacity > 1 || graph.reference.file === '')) problems.push(problem('reference'));
  for (const r of graph.regions) {
    if (r.id === '' || ids.has(r.id)) problems.push(problem('duplicate-region', { region: r.id }));
    ids.add(r.id);
  }
  for (const morph of graph.morphs ?? []) {
    if (morph.region !== null && !ids.has(morph.region)) problems.push(problem('morph-region', { morph: morph.id }));
    const ordered = morph.points.every((p, i) => i === 0 || p.width > (morph.points[i - 1]?.width ?? Infinity));
    if (morph.points.length < 2 || !ordered || morph.points.some((p) => !Number.isFinite(p.width) || p.width <= 0 || !Number.isFinite(p.value) || p.value < 0)) problems.push(problem('morph', { morph: morph.id }));
  }
  for (const r of graph.regions) {
    const named = { region: r.name };
    const padding = r.layout?.padding;
    if (typeof padding === 'number' && (!Number.isFinite(padding) || padding < 0)) problems.push(problem('padding', named));
    if (typeof padding === 'string' && !(padding in graph.variables)) problems.push(problem('unknown-variable', { name: padding }));
    if (r.radius !== undefined && (!Number.isFinite(r.radius) || r.radius < 0)) problems.push(problem('radius', named));
    if (![r.box.x, r.box.y, r.box.width, r.box.height].every(Number.isFinite) || r.box.width <= precision || r.box.height <= precision) problems.push(problem('degenerate', named));
    for (const dim of [r.width, r.height]) {
      const badMin = dim.min !== undefined && (!Number.isFinite(dim.min) || dim.min < 0);
      const badMax = dim.max !== undefined && (!Number.isFinite(dim.max) || dim.max < 0);
      const crossed = (dim.min ?? 0) > (dim.max ?? Infinity);
      const badWeight = dim.weight !== undefined && (!Number.isFinite(dim.weight) || dim.weight <= 0);
      if (badMin || badMax || crossed || badWeight) problems.push(problem('sizing', named));
    }
    if (r.kind === 'content' && graph.regions.some((child) => child.parent === r.id)) problems.push(problem('content-children', named));
    if (r.kind === 'content' && (r.polygon !== undefined || r.holes !== undefined)) problems.push(problem('content-shape', named));
    if (r.polygon !== undefined) {
      if (r.polygon.length < 3 || r.polygon.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || polygonArea(r.polygon) <= precision) problems.push(problem('polygon', named));
      else if (!simpleRing(r.polygon)) problems.push(problem('self-intersecting', named));
      else {
        const box = shapeBounds(regionShape(r));
        if (Math.max(Math.abs(box.x - r.box.x), Math.abs(box.y - r.box.y), Math.abs(box.width - r.box.width), Math.abs(box.height - r.box.height)) > precision) problems.push(problem('polygon-bounds', named));
        if ((r.holes ?? []).some((h) => !simpleRing(h))) problems.push(problem('self-intersecting', named));
        else if ((r.holes ?? []).some((h) => outsideArea({ outer: h, holes: [] }, { outer: r.polygon ?? [], holes: [] }) > precision)) problems.push(problem('hole-outside', named));
      }
    } else if ((r.holes ?? []).length > 0) problems.push(problem('holes-without-outline', named));
    // the chain of parents: each one exists, holds the region, and never comes back to it
    const chain = new Set([r.id]);
    let parentId = r.parent;
    while (parentId !== null) {
      if (chain.has(parentId)) {
        problems.push(problem('cycle', named));
        break;
      }
      chain.add(parentId);
      const p = findRegion(graph, parentId);
      if (p === undefined) {
        problems.push(problem('missing-parent', named));
        break;
      }
      if (parentId === r.parent) {
        const outsideBox = !contains(p.box, r.box);
        const outsideShape = !outsideBox && p.polygon !== undefined && outsideArea(regionShape(r), regionShape(p)) > precision;
        if (outsideBox || outsideShape) problems.push(problem('outside-parent', { region: r.name, parent: p.name }));
      }
      parentId = p.parent;
    }
  }
  for (let i = 0; i < graph.regions.length; i += 1)
    for (let j = i + 1; j < graph.regions.length; j += 1) {
      const a = graph.regions[i];
      const b = graph.regions[j];
      if (a === undefined || b === undefined || a.parent !== b.parent || a.overlap === true || b.overlap === true || intersection(a.box, b.box) === null) continue;
      const shaped = a.polygon !== undefined || b.polygon !== undefined;
      if (!shaped || polygonBoolean([regionShape(a)], [regionShape(b)], 'intersection').some((s) => shapeArea(s) > precision)) problems.push(problem('overlap', { first: a.name, second: b.name }));
    }
  const constraintIds = new Set<string>();
  for (const c of graph.constraints) {
    if (constraintIds.has(c.id)) problems.push(problem('duplicate-constraint', { constraint: c.id }));
    constraintIds.add(c.id);
    if (c.regions.length === 0 || c.regions.some((id) => !ids.has(id))) problems.push(problem('orphan-constraint', { constraint: c.id }));
    const value = 'value' in c ? c.value : undefined;
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) problems.push(problem('constraint-value', { constraint: c.id }));
    if (typeof value === 'string' && !(value in graph.variables)) problems.push(problem('unknown-variable', { name: value }));
    if (c.kind === 'ratio' && !(c.value > 0)) problems.push(problem('constraint-value', { constraint: c.id }));
  }
  const ruleIds = new Set<string>();
  for (const rule of graph.responsive) {
    if (ruleIds.has(rule.id)) problems.push(problem('responsive-rule', { rule: rule.id }));
    ruleIds.add(rule.id);
    const badColumns = rule.columns !== undefined && (!Number.isInteger(rule.columns) || rule.columns < 1);
    const badGap = rule.gap !== undefined && (!Number.isFinite(rule.gap) || rule.gap < 0);
    const badGroups = Object.values(rule.groups ?? {}).some((g) => !Number.isInteger(g.columns) || g.columns < 1 || (g.gap !== undefined && (!Number.isFinite(g.gap) || g.gap < 0)));
    if (!Number.isFinite(rule.maxWidth) || rule.maxWidth <= 0 || badColumns || badGap || badGroups) problems.push(problem('responsive-rule', { rule: rule.id }));
    const named = [...rule.hidden, ...(rule.order ?? []), ...Object.keys(rule.sizes ?? {}), ...(rule.wide ?? []), ...Object.values(rule.groups ?? {}).flatMap((g) => g.wide ?? [])];
    const groupKeys = [...Object.keys(rule.groups ?? {}), ...(rule.kept ?? [])].map((key) => (key.startsWith('region:') ? key.slice('region:'.length) : null)).filter((id): id is string => id !== null);
    if ([...named, ...groupKeys].some((id) => !ids.has(id))) problems.push(problem('responsive-region', { rule: rule.id }));
    if (rule.order !== undefined && new Set(rule.order).size !== rule.order.length) problems.push(problem('responsive-order', { rule: rule.id }));
    if (Object.values(rule.sizes ?? {}).some((size) => size.width !== undefined && (!Number.isFinite(size.width) || size.width <= 0))) problems.push(problem('responsive-rule', { rule: rule.id }));
  }
  return problems;
}

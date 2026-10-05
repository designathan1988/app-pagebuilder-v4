// The Gesture Algebra (spec "Gesture Algebra"): every gesture of the composer becomes one declarative operation on the
// Layout Intent Graph — draw, split, cut, merge, subtract, move, resize, nest, detach, extract, duplicate, repeat,
// align, distribute, reshape, delete, restore, and the edits of constraints, variables, responsive behaviour, morphs,
// the reference image and the chosen interpretation — composable into one compound operation. execute() runs it,
// solves the constraints and validates the result: a refused operation produces no graph and says why (codes of
// intent/problems.ts). Each result carries its inverse (the graph before, restored by reverse()), the regions it
// touched, and where the content of every region that disappeared goes (merge: into the region that absorbed it;
// delete: nowhere), so the host keeps the page's content when it rebuilds the structure.
import type { Axis, Box, Constraint, LayoutIntent, LayoutStrategy, Morph, Point, Region, ReferenceImage, ResponsiveRule } from '../intent/model.ts';
import { descendants, findRegion, preferenceKey } from '../intent/model.ts';
import { nextRegionId, operationId } from '../intent/ids.ts';
import { LayoutRefusal, problem, refuse, type LayoutProblem } from '../intent/problems.ts';
import { bounds, canonicalBox, contains, end, length, precision, splitBox, subtractBox } from '../geometry/geometry.ts';
import { lengthKey } from '../geometry/keys.ts';
import { boxShape, outsideArea, polygonBoolean, regionShape, shapeArea, shapeBounds, type PolygonShape } from '../geometry/polygons.ts';
import { topology, validateIntent } from '../topology/topology.ts';
import { solve } from '../constraints/solve.ts';

export type RegionValues = Partial<Pick<Region, 'name' | 'semantic' | 'width' | 'height' | 'layout' | 'radius' | 'overlap' | 'chosen'>>;

export type Operation =
  | { readonly kind: 'configure'; readonly id: string; readonly values: RegionValues }
  | { readonly kind: 'draw'; readonly region: Region }
  | { readonly kind: 'split'; readonly ids: readonly string[]; readonly axis: Axis; readonly positions: readonly number[] }
  | { readonly kind: 'cut'; readonly from: Point; readonly to: Point }
  // span: the merged region is the box over them all, apart as they may stand (two boxes linked by a stroke)
  | { readonly kind: 'merge'; readonly ids: readonly string[]; readonly span?: boolean }
  | { readonly kind: 'subtract'; readonly ids: readonly string[]; readonly box: Box; readonly polygon?: readonly Point[] }
  | { readonly kind: 'move'; readonly ids: readonly string[]; readonly dx: number; readonly dy: number }
  | { readonly kind: 'resize-region'; readonly id: string; readonly box: Box }
  | { readonly kind: 'boundary'; readonly id: string; readonly at: number }
  | { readonly kind: 'vertex'; readonly id: string; readonly point: Point }
  | { readonly kind: 'edge'; readonly id: string; readonly distance: number }
  | { readonly kind: 'nest'; readonly ids: readonly string[]; readonly parent: string }
  | { readonly kind: 'detach' | 'extract'; readonly ids: readonly string[] }
  | { readonly kind: 'duplicate'; readonly ids: readonly string[]; readonly dx: number; readonly dy: number }
  | { readonly kind: 'repeat'; readonly id: string; readonly count: number; readonly axis: Axis; readonly gap: number }
  | { readonly kind: 'align'; readonly ids: readonly string[]; readonly axis: Axis; readonly edge: 'start' | 'center' | 'end' }
  | { readonly kind: 'distribute'; readonly ids: readonly string[]; readonly axis: Axis }
  | { readonly kind: 'reshape'; readonly id: string; readonly points: readonly Point[]; readonly radius?: number }
  | { readonly kind: 'delete'; readonly ids: readonly string[] }
  | { readonly kind: 'restore'; readonly regions: readonly Region[] }
  | { readonly kind: 'constraint'; readonly constraint: Constraint }
  | { readonly kind: 'remove-constraint'; readonly id: string }
  | { readonly kind: 'variable'; readonly name: string; readonly value: number }
  | { readonly kind: 'remove-variable'; readonly name: string }
  | { readonly kind: 'responsive'; readonly rule: ResponsiveRule }
  | { readonly kind: 'remove-responsive'; readonly id: string }
  | { readonly kind: 'morph'; readonly morph: Morph }
  | { readonly kind: 'remove-morph'; readonly id: string }
  | { readonly kind: 'reference'; readonly reference: ReferenceImage | null }
  | { readonly kind: 'interpret'; readonly parent: string | null; readonly strategy: LayoutStrategy }
  | { readonly kind: 'compose'; readonly operations: readonly Operation[] };

export type Result =
  | {
      readonly ok: true;
      readonly graph: LayoutIntent;
      // the graph the operation started from: reverse() hands it back
      readonly inverse: LayoutIntent;
      // the regions whose definition changed, appeared or disappeared
      readonly affected: readonly string[];
      // each region that disappeared: the region its content now belongs to, or null when its content goes with it
      readonly moves: Readonly<Record<string, string | null>>;
    }
  | { readonly ok: false; readonly problems: readonly LayoutProblem[] };

// How new regions are named: by the source's name and a number (a split's second part), or from scratch. The host
// gives the words of the person's language; tests and templates use the default.
export interface Naming {
  readonly named: (base: string | null, n: number) => string;
}

export const DEFAULT_NAMING: Naming = { named: (base, n) => `${base ?? 'region'} ${n}` };

interface Run {
  readonly op: string;
  readonly naming: Naming;
  readonly moves: Map<string, string | null>;
}

function update(graph: LayoutIntent, ids: ReadonlySet<string>, f: (r: Region) => Region): LayoutIntent {
  return { ...graph, regions: graph.regions.map((r) => (ids.has(r.id) ? f(r) : r)) };
}

function requireRegion(graph: LayoutIntent, id: string): Region {
  return findRegion(graph, id) ?? refuse('unknown-region', { region: id });
}

// A free name for a new part of a region: its name and the first number no region uses.
function partName(graph: LayoutIntent, base: string, naming: Naming): string {
  const taken = new Set(graph.regions.map((r) => r.name));
  for (let n = 2; ; n += 1) {
    const name = naming.named(base, n);
    if (!taken.has(name)) return name;
  }
}

function withoutRegionReferences(graph: LayoutIntent, gone: ReadonlySet<string>): LayoutIntent {
  const keepRegion = (id: string) => !gone.has(id);
  return {
    ...graph,
    regions: graph.regions.filter((r) => keepRegion(r.id)),
    constraints: graph.constraints.flatMap((c) => {
      // a rule between regions (one gap, equal sizes, an alignment) means nothing once one region is left of it
      const regions = c.regions.filter(keepRegion);
      return regions.length < (c.kind === 'size' || c.kind === 'ratio' ? 1 : 2) ? [] : [{ ...c, regions }];
    }),
    responsive: graph.responsive.map((rule) => ({
      ...rule,
      hidden: rule.hidden.filter(keepRegion),
      ...(rule.order === undefined ? {} : { order: rule.order.filter(keepRegion) }),
      ...(rule.sizes === undefined ? {} : { sizes: Object.fromEntries(Object.entries(rule.sizes).filter(([id]) => keepRegion(id))) }),
      ...(rule.groups === undefined ? {} : { groups: Object.fromEntries(Object.entries(rule.groups).filter(([key]) => ![...gone].some((id) => key === preferenceKey(id)))) }),
    })),
    ...(graph.morphs === undefined ? {} : { morphs: graph.morphs.filter((m) => m.region === null || keepRegion(m.region)) }),
    ...(graph.preferences === undefined ? {} : { preferences: Object.fromEntries(Object.entries(graph.preferences).filter(([key]) => ![...gone].some((id) => key === preferenceKey(id)))) }),
  };
}

// A region replaced by boxes (a split's or a rectangular subtraction's parts): the first part keeps its id, its
// content and its references; the others are new regions. Each child of the region goes to the part that holds it, or
// the operation is refused (a cut never crosses a nested region).
function replaceParts(graph: LayoutIntent, id: string, parts: readonly Box[], run: Run): LayoutIntent {
  const source = requireRegion(graph, id);
  if (source.kind === 'content') refuse('cut-content', { region: source.name });
  if (parts.length === 0) {
    run.moves.set(id, null);
    return withoutRegionReferences(graph, descendants(graph, [id]));
  }
  let working = graph;
  const next: Region[] = parts.map((box, i) => {
    if (i === 0) return { ...source, box: canonicalBox(box), provenance: [...source.provenance, run.op] };
    const made: Region = { ...source, id: nextRegionId(working), name: partName(working, source.name, run.naming), box: canonicalBox(box), provenance: [...source.provenance, run.op] };
    working = { ...working, regions: [...working.regions, made] };
    return made;
  });
  const parents = new Map<string, string>();
  for (const child of graph.regions.filter((r) => r.parent === id)) {
    const target = next.find((r) => contains(r.box, child.box));
    if (target === undefined) refuse('cut-nested', { region: child.name });
    parents.set(child.id, target.id);
  }
  return {
    ...graph,
    regions: graph.regions.flatMap((r) => (r.id === id ? next : parents.has(r.id) ? [{ ...r, parent: parents.get(r.id) as string }] : [r])),
  };
}

// The same for a shaped region: each part is an outline with its holes.
function replaceShapes(graph: LayoutIntent, id: string, shapes: readonly PolygonShape[], run: Run): LayoutIntent {
  const source = requireRegion(graph, id);
  if (source.kind === 'content') refuse('cut-content', { region: source.name });
  if (shapes.length === 0) {
    run.moves.set(id, null);
    return withoutRegionReferences(graph, descendants(graph, [id]));
  }
  const { polygon: _polygon, holes: _holes, ...base } = source;
  void _polygon;
  void _holes;
  let working = graph;
  const next: Region[] = shapes.map((shape, i) => {
    const box = shapeBounds(shape);
    const exact = Math.abs(shapeArea(shape) - box.width * box.height) <= precision;
    const outline = exact ? {} : { polygon: shape.outer, ...(shape.holes.length > 0 ? { holes: shape.holes } : {}) };
    if (i === 0) return { ...base, box, ...outline, provenance: [...source.provenance, run.op] };
    const made: Region = { ...base, id: nextRegionId(working), name: partName(working, source.name, run.naming), box, ...outline, provenance: [...source.provenance, run.op] };
    working = { ...working, regions: [...working.regions, made] };
    return made;
  });
  const parents = new Map<string, string>();
  for (const child of graph.regions.filter((r) => r.parent === id)) {
    const target = next.find((r) => outsideArea(regionShape(child), regionShape(r)) < precision);
    if (target === undefined) refuse('cut-nested', { region: child.name });
    parents.set(child.id, target.id);
  }
  return { ...graph, regions: graph.regions.flatMap((r) => (r.id === id ? next : [parents.has(r.id) ? { ...r, parent: parents.get(r.id) as string } : r])) };
}

const translate = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

function moved(r: Region, dx: number, dy: number): Region {
  return {
    ...r,
    box: canonicalBox({ ...r.box, x: r.box.x + dx, y: r.box.y + dy }),
    ...(r.polygon === undefined ? {} : { polygon: r.polygon.map((p) => translate(p, dx, dy)) }),
    ...(r.holes === undefined ? {} : { holes: r.holes.map((h) => h.map((p) => translate(p, dx, dy))) }),
  };
}

// Regions whose edge lies on a boundary line, followed along every collinear boundary of the same parent they share:
// dragging a divider moves the whole structural line, not one rectangle (spec "Topological Editing").
function linkedAlong(graph: LayoutIntent, boundary: { readonly axis: Axis; readonly at: number; readonly parent: string | null; readonly regions: readonly string[] }): Set<string> {
  const linked = new Set(boundary.regions);
  const collinear = topology(graph).boundaries.filter((b) => b.parent === boundary.parent && b.axis === boundary.axis && Math.abs(b.at - boundary.at) < precision);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of collinear)
      if (b.regions.some((id) => linked.has(id)))
        for (const id of b.regions)
          if (!linked.has(id)) {
            linked.add(id);
            grew = true;
          }
  }
  return linked;
}

// Every region along a line moves its edge on the line to a new place.
function moveLine(graph: LayoutIntent, ids: Iterable<string>, axis: Axis, from: number, to: number, run: Run): LayoutIntent {
  let next = graph;
  const delta = to - from;
  for (const id of ids) {
    const r = requireRegion(next, id);
    const starts = Math.abs(r.box[axis] - from) < precision;
    const box = { ...r.box, [axis]: r.box[axis] + (starts ? delta : 0), [lengthKey(axis)]: length(r.box, axis) + (starts ? -delta : delta) };
    next = raw(next, { kind: 'resize-region', id, box }, run);
  }
  return next;
}

function raw(graph: LayoutIntent, op: Operation, run: Run): LayoutIntent {
  switch (op.kind) {
    case 'configure': {
      requireRegion(graph, op.id);
      return update(graph, new Set([op.id]), (r) => ({ ...r, ...op.values }));
    }
    case 'draw':
      if (op.region.parent !== null) requireRegion(graph, op.region.parent);
      return { ...graph, regions: [...graph.regions, { ...op.region, box: canonicalBox(op.region.box), provenance: [...op.region.provenance, run.op] }] };
    case 'split':
      return op.ids.reduce((g, id) => {
        const r = requireRegion(g, id);
        const parts = splitBox(r.box, op.axis, op.positions);
        if (r.polygon === undefined) return replaceParts(g, id, parts, run);
        return replaceShapes(g, id, parts.flatMap((p) => polygonBoolean([regionShape(r)], [boxShape(p)], 'intersection')), run);
      }, graph);
    case 'cut': {
      // the line's axis is the one it runs across least: a mostly vertical stroke cuts at an x
      const axis: Axis = Math.abs(op.to.x - op.from.x) < Math.abs(op.to.y - op.from.y) ? 'x' : 'y';
      const across: Axis = axis === 'x' ? 'y' : 'x';
      const at = (op.from[axis] + op.to[axis]) / 2;
      const lo = Math.min(op.from[across], op.to[across]);
      const hi = Math.max(op.from[across], op.to[across]);
      // the deepest regions the line crosses from side to side (a region with children is cut through its children)
      const crossed = graph.regions.filter((r) => r.kind !== 'content' && lo <= r.box[across] + precision && hi >= end(r.box, across) - precision && at > r.box[axis] + precision && at < end(r.box, axis) - precision);
      const ids = crossed.filter((r) => !crossed.some((inner) => inner.parent === r.id)).map((r) => r.id);
      if (ids.length === 0) refuse('cut-nothing');
      return raw(graph, { kind: 'split', ids, axis, positions: [at] }, run);
    }
    case 'subtract':
      return op.ids.reduce((g, id) => {
        const r = requireRegion(g, id);
        if (r.polygon !== undefined || op.polygon !== undefined) {
          const cut: PolygonShape = op.polygon !== undefined ? { outer: op.polygon, holes: [] } : boxShape(op.box);
          return replaceShapes(g, id, polygonBoolean([regionShape(r)], [cut], 'difference'), run);
        }
        return replaceParts(g, id, subtractBox(r.box, op.box), run);
      }, graph);
    case 'merge': {
      const held = [...new Set(op.ids)].map((id) => requireRegion(graph, id));
      if (held.length < 2) refuse('merge-count');
      const first = held[0] as Region;
      if (held.some((r) => r.parent !== first.parent)) refuse('merge-siblings');
      if (held.some((r) => r.kind === 'content')) refuse('merge-content');
      const box = bounds(held.map((r) => r.box));
      const shapes = op.span === true ? [{ outer: [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }], holes: [] }] : polygonBoolean(held.map(regionShape), [], 'union');
      if (shapes.length !== 1) refuse('merge-disconnected');
      const shape = shapes[0] as PolygonShape;
      const { polygon: _polygon, holes: _holes, ...base } = first;
      void _polygon;
      void _holes;
      const exact = Math.abs(shapeArea(shape) - box.width * box.height) <= precision;
      const merged: Region = { ...base, box, ...(exact ? {} : { polygon: shape.outer, ...(shape.holes.length > 0 ? { holes: shape.holes } : {}) }), provenance: [...new Set(held.flatMap((r) => r.provenance)), run.op] };
      const absorbed = new Set(held.slice(1).map((r) => r.id));
      for (const id of absorbed) run.moves.set(id, first.id);
      return {
        ...graph,
        regions: graph.regions.flatMap((r) => (r.id === first.id ? [merged] : absorbed.has(r.id) ? [] : [r.parent !== null && absorbed.has(r.parent) ? { ...r, parent: first.id } : r])),
        constraints: graph.constraints.flatMap((c) => {
          const regions = [...new Set(c.regions.map((id) => (absorbed.has(id) ? first.id : id)))];
          // a relation between the merged regions themselves means nothing once they are one
          return regions.length < 2 && c.kind !== 'size' && c.kind !== 'ratio' ? [] : [{ ...c, regions }];
        }),
        responsive: graph.responsive.map((rule) => ({
          ...rule,
          hidden: rule.hidden.filter((id) => !absorbed.has(id)),
          ...(rule.order === undefined ? {} : { order: rule.order.filter((id) => !absorbed.has(id)) }),
          ...(rule.sizes === undefined ? {} : { sizes: Object.fromEntries(Object.entries(rule.sizes).filter(([id]) => !absorbed.has(id))) }),
        })),
        ...(graph.morphs === undefined ? {} : { morphs: graph.morphs.filter((m) => m.region === null || !absorbed.has(m.region)) }),
      };
    }
    case 'move':
      for (const id of op.ids) requireRegion(graph, id);
      return update(graph, descendants(graph, op.ids), (r) => moved(r, op.dx, op.dy));
    case 'resize-region': {
      const old = requireRegion(graph, op.id).box;
      if (!(op.box.width > precision) || !(op.box.height > precision)) refuse('degenerate', { region: requireRegion(graph, op.id).name });
      const sx = op.box.width / old.width;
      const sy = op.box.height / old.height;
      const scale = (p: Point): Point => ({ x: op.box.x + (p.x - old.x) * sx, y: op.box.y + (p.y - old.y) * sy });
      // the regions inside scale with it, so they stay inside
      return update(graph, descendants(graph, [op.id]), (r) => ({
        ...r,
        box: canonicalBox({ x: op.box.x + (r.box.x - old.x) * sx, y: op.box.y + (r.box.y - old.y) * sy, width: r.box.width * sx, height: r.box.height * sy }),
        ...(r.polygon === undefined ? {} : { polygon: r.polygon.map(scale) }),
        ...(r.holes === undefined ? {} : { holes: r.holes.map((h) => h.map(scale)) }),
      }));
    }
    case 'boundary': {
      const boundary = topology(graph).boundaries.find((b) => b.id === op.id) ?? refuse('unknown-boundary');
      return moveLine(graph, linkedAlong(graph, boundary), boundary.axis, boundary.at, op.at, run);
    }
    case 'vertex': {
      const mesh = topology(graph);
      const vertex = mesh.vertices.find((v) => v.id === op.id) ?? refuse('unknown-vertex');
      const touching = new Set(mesh.edges.filter((e) => vertex.boundaries.includes(e.id)).flatMap((e) => e.regions));
      if (graph.regions.some((r) => touching.has(r.id) && r.polygon !== undefined)) {
        // a shaped region's corner moves itself
        return update(graph, touching, (r) => {
          const shape = regionShape(r);
          const shift = (ring: readonly Point[]) => ring.map((p) => (Math.hypot(p.x - vertex.x, p.y - vertex.y) < precision ? op.point : p));
          const outer = shift(shape.outer);
          const holes = shape.holes.map(shift);
          return { ...r, polygon: outer, ...(holes.length > 0 ? { holes } : {}), box: shapeBounds({ outer, holes }) };
        });
      }
      // a rectangle vertex is where boundaries meet: each line through it moves to the point's place on its axis
      let next = graph;
      const lines = new Map<string, { axis: Axis; at: number; parent: string | null; regions: Set<string> }>();
      for (const b of mesh.boundaries.filter((one) => vertex.boundaries.includes(one.id))) {
        const key = `${b.axis}:${b.at}:${b.parent ?? ''}`;
        const line = lines.get(key) ?? { axis: b.axis, at: b.at, parent: b.parent, regions: new Set<string>() };
        for (const id of b.regions) line.regions.add(id);
        lines.set(key, line);
      }
      for (const line of lines.values()) next = moveLine(next, line.regions, line.axis, line.at, op.point[line.axis], run);
      return next;
    }
    case 'edge': {
      const edge = topology(graph).edges.find((e) => e.id === op.id) ?? refuse('unknown-edge');
      const dx = edge.to.x - edge.from.x;
      const dy = edge.to.y - edge.from.y;
      const size = Math.hypot(dx, dy);
      const shift = { x: (-dy / size) * op.distance, y: (dx / size) * op.distance };
      return update(graph, new Set(edge.regions), (r) => {
        const shape = regionShape(r);
        const onEdge = (p: Point) => Math.hypot(p.x - edge.from.x, p.y - edge.from.y) < precision || Math.hypot(p.x - edge.to.x, p.y - edge.to.y) < precision;
        const push = (ring: readonly Point[]) => ring.map((p) => (onEdge(p) ? translate(p, shift.x, shift.y) : p));
        const outer = push(shape.outer);
        const holes = shape.holes.map(push);
        return { ...r, polygon: outer, ...(holes.length > 0 ? { holes } : {}), box: shapeBounds({ outer, holes }) };
      });
    }
    case 'nest': {
      const parent = requireRegion(graph, op.parent);
      if (parent.kind === 'content') refuse('content-children', { region: parent.name });
      for (const id of op.ids) requireRegion(graph, id);
      return update(graph, new Set(op.ids), (r) => ({ ...r, parent: op.parent }));
    }
    case 'detach':
    case 'extract':
      for (const id of op.ids) requireRegion(graph, id);
      return update(graph, new Set(op.ids), (r) => ({ ...r, parent: op.kind === 'extract' || r.parent === null ? null : requireRegion(graph, r.parent).parent }));
    case 'duplicate': {
      const ids = descendants(graph, op.ids);
      const copies = graph.regions.filter((r) => ids.has(r.id));
      // a content region is an element of the page: copying it is the page's own duplicate, never the layout's
      if (copies.some((r) => r.kind === 'content')) refuse('duplicate-content');
      let working = graph;
      const map = new Map<string, string>();
      for (const r of copies) {
        const id = nextRegionId(working);
        map.set(r.id, id);
        working = { ...working, regions: [...working.regions, { ...r, id }] };
      }
      // each copy takes its name once the copies before it took theirs, so two copies never share one
      let named = graph;
      const made: Region[] = [];
      for (const r of copies) {
        const copy: Region = {
          ...moved(r, op.dx, op.dy),
          id: map.get(r.id) as string,
          name: partName(named, r.name, run.naming),
          parent: r.parent === null ? null : (map.get(r.parent) ?? r.parent),
          provenance: [...r.provenance, run.op],
        };
        made.push(copy);
        named = { ...named, regions: [...named.regions, copy] };
      }
      const copiedConstraints = graph.constraints.filter((c) => c.regions.every((id) => ids.has(id))).map((c) => ({ ...c, id: `${c.id}-${map.get(c.regions[0] as string) ?? run.op}`, regions: c.regions.map((id) => map.get(id) as string) }));
      return { ...graph, regions: [...graph.regions, ...made], constraints: [...graph.constraints, ...copiedConstraints] };
    }
    case 'repeat': {
      if (!Number.isInteger(op.count) || op.count < 1 || op.count > 1000 || !(op.gap >= 0)) refuse('repeat-count');
      const r = requireRegion(graph, op.id);
      const stride = length(r.box, op.axis) + op.gap;
      let next = graph;
      for (let i = 1; i < op.count; i += 1) next = raw(next, { kind: 'duplicate', ids: [r.id], dx: op.axis === 'x' ? stride * i : 0, dy: op.axis === 'y' ? stride * i : 0 }, run);
      return next;
    }
    case 'align':
    case 'distribute': {
      const held = op.ids.map((id) => requireRegion(graph, id)).sort((a, b) => a.box[op.axis] - b.box[op.axis] || a.id.localeCompare(b.id));
      if (op.kind === 'distribute' && held.length < 3) refuse('distribute-count');
      const group = bounds(held.map((r) => r.box));
      const gap = (length(group, op.axis) - held.reduce((s, r) => s + length(r.box, op.axis), 0)) / Math.max(1, held.length - 1);
      let next = graph;
      let at = group[op.axis];
      for (const r of held) {
        const target = op.kind === 'distribute' ? at : op.edge === 'start' ? group[op.axis] : op.edge === 'end' ? end(group, op.axis) - length(r.box, op.axis) : group[op.axis] + (length(group, op.axis) - length(r.box, op.axis)) / 2;
        next = raw(next, { kind: 'move', ids: [r.id], dx: op.axis === 'x' ? target - r.box.x : 0, dy: op.axis === 'y' ? target - r.box.y : 0 }, run);
        at += length(r.box, op.axis) + gap;
      }
      return next;
    }
    case 'reshape': {
      const r = requireRegion(graph, op.id);
      if (r.kind === 'content') refuse('content-shape', { region: r.name });
      const outline = bounds(op.points.map((p) => ({ ...p, width: 0, height: 0 })));
      return update(graph, new Set([op.id]), (one) => ({ ...one, polygon: op.points, box: outline, ...(op.radius === undefined ? {} : { radius: op.radius }) }));
    }
    case 'delete': {
      for (const id of op.ids) requireRegion(graph, id);
      const gone = descendants(graph, op.ids);
      for (const id of gone) run.moves.set(id, null);
      return withoutRegionReferences(graph, gone);
    }
    case 'restore':
      for (const r of op.regions) if (findRegion(graph, r.id) !== undefined) refuse('duplicate-region', { region: r.id });
      return { ...graph, regions: [...graph.regions, ...op.regions] };
    case 'constraint':
      for (const id of op.constraint.regions) requireRegion(graph, id);
      return { ...graph, constraints: [...graph.constraints.filter((c) => c.id !== op.constraint.id), op.constraint] };
    case 'remove-constraint':
      return { ...graph, constraints: graph.constraints.filter((c) => c.id !== op.id) };
    case 'variable':
      return { ...graph, variables: { ...graph.variables, [op.name]: op.value } };
    case 'remove-variable': {
      const { [op.name]: _gone, ...variables } = graph.variables;
      void _gone;
      return { ...graph, variables };
    }
    case 'responsive':
      return { ...graph, responsive: [...graph.responsive.filter((r) => r.id !== op.rule.id), op.rule].sort((a, b) => b.maxWidth - a.maxWidth) };
    case 'remove-responsive':
      return { ...graph, responsive: graph.responsive.filter((r) => r.id !== op.id) };
    case 'morph':
      return { ...graph, morphs: [...(graph.morphs ?? []).filter((m) => m.id !== op.morph.id), op.morph] };
    case 'remove-morph': {
      const morphs = (graph.morphs ?? []).filter((m) => m.id !== op.id);
      const { morphs: _morphs, ...rest } = graph;
      void _morphs;
      return morphs.length > 0 ? { ...rest, morphs } : rest;
    }
    case 'interpret': {
      if (op.parent !== null) requireRegion(graph, op.parent);
      const preferences = { ...graph.preferences, [preferenceKey(op.parent)]: op.strategy };
      // a chosen fixed or proportional interpretation is a sizing intent of every sibling too
      const sized = op.strategy === 'fixed' || op.strategy === 'proportional' ? op.strategy : null;
      return { ...graph, preferences, regions: graph.regions.map((r) => (r.parent === op.parent && sized !== null && r.kind !== 'content' ? { ...r, width: { ...r.width, mode: sized } } : r)) };
    }
    case 'reference': {
      const { reference: _old, ...rest } = graph;
      void _old;
      return op.reference === null ? rest : { ...rest, reference: op.reference };
    }
    case 'compose':
      return op.operations.reduce((g, inner) => raw(g, inner, run), graph);
  }
}

// A move that lands a region on nothing: the content of a region absorbed by a region that is itself absorbed later in
// the same compound operation follows it to where it finally belongs.
function settleMoves(moves: ReadonlyMap<string, string | null>): Record<string, string | null> {
  const settled: Record<string, string | null> = {};
  for (const [from, to] of moves) {
    let target = to;
    const seen = new Set([from]);
    while (target !== null && moves.has(target) && !seen.has(target)) {
      seen.add(target);
      target = moves.get(target) ?? null;
    }
    settled[from] = target;
  }
  return settled;
}

export function execute(graph: LayoutIntent, operation: Operation, naming: Naming = DEFAULT_NAMING): Result {
  const run: Run = { op: operationId(graph), naming, moves: new Map() };
  try {
    const changed = raw(graph, operation, run);
    const solved = solve(changed);
    const problems = [...solved.conflicts.map((id) => problem('conflict', { constraint: id })), ...validateIntent(solved.graph)];
    if (problems.length > 0) return { ok: false, problems };
    const next: LayoutIntent = { ...solved.graph, revision: graph.revision + 1 };
    const before = new Map(graph.regions.map((r) => [r.id, r]));
    const after = new Map(next.regions.map((r) => [r.id, r]));
    const affected = [...new Set([...before.keys(), ...after.keys()])].filter((id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)));
    return { ok: true, graph: next, inverse: graph, affected, moves: settleMoves(run.moves) };
  } catch (error) {
    if (error instanceof LayoutRefusal) return { ok: false, problems: [error.problem] };
    throw error;
  }
}

// The graph an operation started from: the gesture algebra's inverse. The store's own history undoes a committed
// operation; this is what a cancelled preview and the algebra's tests restore.
export function reverse(result: Extract<Result, { ok: true }>): LayoutIntent {
  return result.inverse;
}

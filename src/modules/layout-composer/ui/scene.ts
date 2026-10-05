// What the canvas overlay and the Intent Inspector show, as plain data (spec "Layout Lenses", "Structural Handles",
// "Intent Inspector", "Hierarquia visual"). Six lenses over the one graph: the spatial composition, the structure
// (containers, depth, every boundary and vertex), the constraints (the relations drawn between regions), the
// responsive behaviour (what changes at narrower widths), the flow (direction and distribution) and the semantics
// (header, nav, main…). The handles a selection shows follow what the layout is: track boundaries and gaps of a grid
// or a row, the repetition of a repeated group, the vertices where boundaries meet, the edges of a shape.
import type { Axis, Box, Constraint, LayoutIntent, Point, Region } from '../intent/model.ts';
import { childrenOf, depthOf, findRegion, preferenceKey } from '../intent/model.ts';
import { centre, end, precision } from '../geometry/geometry.ts';
import { topology, type Boundary, type MeshEdge } from '../topology/topology.ts';
import { interpretations, patterns, predict, ruleAt, suggestions, wholePattern, type Interpretation, type Pattern, type Prediction, type Suggestion } from '../intent/analysis.ts';
import { handleText, type HandleKind } from '../gestures/recognize.ts';

export type Lens = 'spatial' | 'structure' | 'constraints' | 'responsive' | 'flow' | 'semantic';
export const LENSES: readonly Lens[] = ['spatial', 'structure', 'constraints', 'responsive', 'flow', 'semantic'];

export interface Words {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

interface SceneRegion {
  readonly id: string;
  readonly box: Box;
  readonly polygon: readonly Point[] | null;
  readonly holes: readonly (readonly Point[])[];
  readonly radius: number;
  readonly selected: boolean;
  readonly hidden: boolean;
  readonly content: boolean;
  readonly depth: number;
  readonly label: Words;
}

interface SceneHandle {
  // the handle as the stroke command names it ("boundary:<id>", "gap:x:r1:r2")
  readonly id: string;
  readonly kind: HandleKind;
  readonly point: Point;
  readonly axis: Axis | null;
  readonly regions: readonly string[];
  // a gap handle's spacing (px), written on it
  readonly value?: number;
}

interface SceneRelation {
  readonly from: Point;
  readonly to: Point;
  readonly label: Words;
}

export interface Scene {
  readonly viewport: Box;
  readonly regions: readonly SceneRegion[];
  readonly boundaries: readonly Boundary[];
  readonly edges: readonly MeshEdge[];
  readonly handles: readonly SceneHandle[];
  readonly relations: readonly SceneRelation[];
  readonly reference: LayoutIntent['reference'] | null;
}

export interface SceneOptions {
  // the width the canvas shows the page at: the responsive lens says what holds there
  readonly width?: number;
}

function regionLabel(graph: LayoutIntent, r: Region, lens: Lens, width: number): Words {
  const name = r.name;
  switch (lens) {
    case 'semantic':
      return { key: 'layout.label.semantic', params: { name, semantic: r.semantic } };
    case 'flow': {
      const inner = predict(graph, r.id);
      return childrenOf(graph, r.id).length > 0 ? { key: 'layout.label.flow', params: { name, flow: inner.key.slice('layout.predict.'.length) } } : { key: 'layout.label.sizing', params: { name, sizing: r.width.mode } };
    }
    case 'responsive': {
      const rule = ruleAt(graph, width);
      const hidden = rule?.hidden.includes(r.id) === true;
      return { key: hidden ? 'layout.label.hidden' : 'layout.label.responsive', params: { name, width: Math.round(width), rules: graph.responsive.length } };
    }
    case 'constraints':
      return { key: 'layout.label.constraints', params: { name, count: graph.constraints.filter((c) => c.regions.includes(r.id)).length } };
    case 'structure':
      return { key: 'layout.label.structure', params: { name, depth: depthOf(graph, r.id), children: childrenOf(graph, r.id).length } };
    default:
      return { key: 'layout.label.size', params: { name, width: Math.round(r.box.width), height: Math.round(r.box.height) } };
  }
}

const midpoint = (b: Boundary): Point => (b.axis === 'x' ? { x: b.at, y: (b.from + b.to) / 2 } : { x: (b.from + b.to) / 2, y: b.at });

export function scene(graph: LayoutIntent, selection: readonly string[], lens: Lens, options: SceneOptions = {}): Scene {
  const width = options.width ?? graph.viewport.width;
  const mesh = topology(graph);
  const rule = ruleAt(graph, width);
  const regions: SceneRegion[] = graph.regions.map((r) => ({
    id: r.id,
    box: r.box,
    polygon: r.polygon ?? null,
    holes: r.holes ?? [],
    radius: r.radius ?? 0,
    selected: selection.includes(r.id),
    hidden: rule?.hidden.includes(r.id) === true,
    content: r.kind === 'content',
    depth: depthOf(graph, r.id),
    label: regionLabel(graph, r, lens, width),
  }));
  const touches = (ids: readonly string[]) => ids.some((id) => selection.includes(id));
  const handles: SceneHandle[] = [];
  // the boundaries the selection shares with its neighbours: dragging one moves the whole structural line
  for (const b of mesh.boundaries.filter((one) => one.regions.length === 2 && touches(one.regions))) handles.push({ id: handleText({ kind: 'boundary', id: b.id }), kind: 'boundary', point: midpoint(b), axis: b.axis, regions: b.regions });
  // the edges of a selected shape
  for (const e of mesh.edges.filter((one) => touches(one.regions) && one.regions.some((id) => findRegion(graph, id)?.polygon !== undefined))) handles.push({ id: handleText({ kind: 'edge', id: e.id }), kind: 'edge', point: { x: (e.from.x + e.to.x) / 2, y: (e.from.y + e.to.y) / 2 }, axis: null, regions: e.regions });
  // the gaps between a selected region and the sibling after it, in its row or its column
  for (const parent of new Set(graph.regions.map((r) => r.parent)))
    for (const axis of ['x', 'y'] as const) {
      const across: Axis = axis === 'x' ? 'y' : 'x';
      const siblings = childrenOf(graph, parent).sort((a, b) => a.box[axis] - b.box[axis]);
      for (let i = 1; i < siblings.length; i += 1) {
        const a = siblings[i - 1] as Region;
        const b = siblings[i] as Region;
        if (!touches([a.id, b.id])) continue;
        const from = end(a.box, axis);
        const to = b.box[axis];
        const lo = Math.max(a.box[across], b.box[across]);
        const hi = Math.min(end(a.box, across), end(b.box, across));
        if (to - from > precision && hi - lo > precision) handles.push({ id: handleText({ kind: 'gap', id: `${axis}:${a.id}:${b.id}` }), kind: 'gap', point: axis === 'x' ? { x: (from + to) / 2, y: (lo + hi) / 2 } : { x: (lo + hi) / 2, y: (from + to) / 2 }, axis, regions: [a.id, b.id], value: Math.round(to - from) });
      }
    }
  // the end of a selected repeated group: dragging it adds or removes whole items
  for (const p of patterns(graph).filter((one) => (one.kind === 'repeated-row' || one.kind === 'repeated-column' || one.kind === 'grid') && touches(one.regions))) {
    const last = findRegion(graph, p.regions[p.regions.length - 1] ?? '');
    if (last === undefined) continue;
    const axis: Axis = p.kind === 'repeated-column' ? 'y' : 'x';
    handles.push({ id: handleText({ kind: 'repeat', id: p.regions[0] as string }), kind: 'repeat', point: axis === 'x' ? { x: end(last.box, 'x'), y: centre(last.box).y } : { x: centre(last.box).x, y: end(last.box, 'y') }, axis, regions: p.regions });
  }
  // the vertices where three boundaries or more meet: in the structure lens, or beside the selection
  for (const v of mesh.vertices.filter((one) => one.boundaries.length > 2)) {
    const around = mesh.boundaries.filter((b) => v.boundaries.includes(b.id)).flatMap((b) => b.regions);
    if (lens === 'structure' || touches(around)) handles.push({ id: handleText({ kind: 'vertex', id: v.id }), kind: 'vertex', point: { x: v.x, y: v.y }, axis: null, regions: [...new Set(around)] });
  }
  const relations: SceneRelation[] = [];
  if (lens === 'constraints')
    for (const c of graph.constraints) {
      const held = c.regions.map((id) => findRegion(graph, id)).filter((r): r is Region => r !== undefined);
      for (let i = 1; i < held.length; i += 1) relations.push({ from: centre((held[i - 1] as Region).box), to: centre((held[i] as Region).box), label: describeConstraint(graph, c) });
    }
  if (lens === 'flow')
    for (const parent of new Set(graph.regions.map((r) => r.parent))) {
      const siblings = childrenOf(graph, parent);
      if (siblings.length < 2) continue;
      const prediction = predict(graph, parent);
      const ordered = [...siblings].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
      relations.push({ from: centre((ordered[0] as Region).box), to: centre((ordered[ordered.length - 1] as Region).box), label: { key: prediction.key, params: prediction.params } });
    }
  return {
    viewport: graph.viewport,
    regions,
    boundaries: lens === 'structure' ? mesh.boundaries : mesh.boundaries.filter((b) => b.regions.length === 2),
    edges: mesh.edges.filter((e) => e.regions.some((id) => findRegion(graph, id)?.polygon !== undefined)),
    handles,
    relations,
    reference: graph.reference ?? null,
  };
}

// A constraint in words ("Equal width", "Gap 24", "Fixed 280").
export function describeConstraint(graph: LayoutIntent, c: Constraint): Words {
  const names = c.regions.map((id) => findRegion(graph, id)?.name ?? id).join(', ');
  switch (c.kind) {
    case 'equal-size':
      return { key: `layout.constraint.equal.${c.axis}`, params: { regions: names } };
    case 'gap':
      return { key: 'layout.constraint.gap', params: { regions: names, value: typeof c.value === 'number' ? Math.round(c.value * 100) / 100 : c.value } };
    case 'ratio':
      return { key: 'layout.constraint.ratio', params: { regions: names, value: c.value } };
    case 'align':
      return { key: `layout.constraint.align.${c.edge}`, params: { regions: names } };
    case 'size':
      return { key: `layout.constraint.size.${c.dimension.mode}`, params: { regions: names, value: c.value === undefined ? '' : typeof c.value === 'number' ? Math.round(c.value) : c.value } };
  }
}

// The Intent Inspector (spec "Intent Inspector"): what the selection means, never the CSS it compiles to — its
// behaviour, its columns, its minimum item width, its gap, its sizing and what it does at narrow widths.
export interface InspectorModel {
  // the region inspected, or null for the composition's top level
  readonly region: Region | null;
  readonly behavior: Prediction;
  readonly columns: number | null;
  readonly minimum: number | null;
  readonly gap: number | string | null;
  readonly narrow: 'stack' | 'keep';
  readonly constraints: readonly { readonly id: string; readonly words: Words }[];
  readonly patterns: readonly Pattern[];
  readonly candidates: readonly Interpretation[];
  readonly suggestions: readonly Suggestion[];
  readonly variables: Readonly<Record<string, number>>;
  readonly provenance: readonly string[];
}

export function inspect(graph: LayoutIntent, id: string | null): InspectorModel | null {
  const r = id === null ? null : (findRegion(graph, id) ?? null);
  if (id !== null && r === null) return null;
  // what the inspected thing holds: the region's children, or the composition's top level
  const group = r === null ? null : r.id;
  const held = childrenOf(graph, group);
  const pattern = wholePattern(graph, group, held.length);
  const key = preferenceKey(group);
  const ids = new Set(held.map((h) => h.id));
  const gapConstraint = graph.constraints.find((c) => c.kind === 'gap' && c.regions.length === ids.size && c.regions.every((one) => ids.has(one)));
  const narrowest = [...graph.responsive].sort((a, b) => a.maxWidth - b.maxWidth)[0];
  const stacked = narrowest !== undefined && ((group === null && narrowest.columns === 1) || narrowest.groups?.[key]?.columns === 1);
  return {
    region: r,
    behavior: predict(graph, group),
    columns: pattern?.columns ?? null,
    minimum: held.length > 0 ? Math.round(Math.min(...held.map((h) => h.width.min ?? h.box.width))) : null,
    gap: gapConstraint !== undefined && 'value' in gapConstraint ? gapConstraint.value : pattern !== undefined ? Math.round(pattern.gap) : null,
    narrow: stacked ? 'stack' : 'keep',
    constraints: graph.constraints.filter((c) => (r === null ? c.regions.some((one) => ids.has(one)) : c.regions.includes(r.id) || c.regions.some((one) => ids.has(one)))).map((c) => ({ id: c.id, words: describeConstraint(graph, c) })),
    patterns: patterns(graph).filter((p) => p.parent === group || (r !== null && p.regions.includes(r.id))),
    candidates: interpretations(graph, group),
    suggestions: suggestions(graph).filter((s) => s.parent === group || (r !== null && s.regions.includes(r.id))),
    variables: graph.variables,
    provenance: r?.provenance ?? [],
  };
}

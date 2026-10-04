// Structural edits of the gesture algebra that the canvas and the panel both reach (spec "Constraint Painting",
// "Pattern Recognition" → Repeat, "Ambiguity Engine", "Structural Suggestions", "Topological Editing", "Seleção"): each
// returns one operation, so the store records it as one undo step.
import type { Axis, Constraint, LayoutIntent, Point, Region } from '../intent/model.ts';
import { findRegion, preferenceKey } from '../intent/model.ts';
import { nextConstraintId } from '../intent/ids.ts';
import { refuse } from '../intent/problems.ts';
import type { Operation } from './operations.ts';
import { end, hitRegions, length, precision } from '../geometry/geometry.ts';
import { lengthKey } from '../geometry/keys.ts';
import { regionShape } from '../geometry/polygons.ts';
import { suggestions, type Interpretation, type Suggestion } from '../intent/analysis.ts';
import { topology } from '../topology/topology.ts';

export type PaintedConstraint = 'equal-size' | 'gap' | 'ratio' | 'align-start' | 'align-center' | 'align-end' | 'fill-available' | 'fixed' | 'fluid' | 'hug' | 'min' | 'max';

function requireRegion(graph: LayoutIntent, id: string): Region {
  return findRegion(graph, id) ?? refuse('unknown-region', { region: id });
}

// A relation painted between regions (spec "Constraint Painting"): equal sizes, a shared gap, a kept ratio, aligned
// edges, or a sizing rule (fill what is left, fixed, fluid, hug, a minimum or a maximum). `value` is the length the
// gap, the ratio, the minimum or the maximum keeps; it defaults to what the drawing shows now.
export function paintConstraint(graph: LayoutIntent, kind: PaintedConstraint, ids: readonly string[], axis: Axis, value?: number | string): Operation {
  if (ids.length === 0) refuse('nothing-selected');
  const held = ids.map((id) => requireRegion(graph, id));
  const id = nextConstraintId(graph);
  const key = lengthKey(axis);
  const drawnGap = (): number => {
    const sorted = [...held].sort((a, b) => a.box[axis] - b.box[axis]);
    const gaps = sorted.slice(1).map((r, i) => r.box[axis] - end((sorted[i] as Region).box, axis));
    return gaps.length === 0 ? 0 : Math.round((gaps.reduce((s, g) => s + g, 0) / gaps.length) * 1024) / 1024;
  };
  let constraint: Constraint;
  switch (kind) {
    case 'equal-size':
      if (held.length < 2) refuse('distribute-count');
      constraint = { id, kind, axis, regions: ids };
      break;
    case 'gap':
      if (held.length < 2 || held.some((r) => r.parent !== (held[0] as Region).parent)) refuse('gap-siblings');
      constraint = { id, kind, axis, regions: ids, value: value ?? Math.max(0, drawnGap()) };
      break;
    case 'ratio': {
      const first = held[0] as Region;
      const ratio = typeof value === 'number' ? value : first.box.width / first.box.height;
      constraint = { id, kind, regions: ids, value: Math.round(ratio * 10000) / 10000 };
      break;
    }
    case 'align-start':
    case 'align-center':
    case 'align-end':
      constraint = { id, kind: 'align', axis, regions: ids, edge: kind === 'align-start' ? 'start' : kind === 'align-end' ? 'end' : 'center' };
      break;
    case 'min':
    case 'max': {
      const at = typeof value === 'number' ? value : length((held[0] as Region).box, axis);
      const ops: Operation[] = held.map((r) => ({ kind: 'configure', id: r.id, values: { [key]: { ...r[key], [kind]: at } } }));
      return { kind: 'compose', operations: ops };
    }
    default: {
      const mode = kind;
      const lengthNow = length((held[0] as Region).box, axis);
      constraint = { id, kind: 'size', axis, regions: ids, dimension: { mode, ...(mode === 'fixed' ? { min: 0 } : {}) }, ...(mode === 'fixed' ? { value: value ?? lengthNow } : {}) };
      // the regions' own sizing intent follows too, so the compiler writes the mode even once the constraint is removed
      const configure: Operation[] = held.map((r) => ({ kind: 'configure', id: r.id, values: { [key]: { ...r[key], mode } } }));
      return { kind: 'compose', operations: [...configure, { kind: 'constraint', constraint }] };
    }
  }
  return { kind: 'constraint', constraint };
}

// A repeated group changed to another count (spec "Pattern Recognition": "4 → 6"): extra items are removed from the
// end, missing ones are copies of the first at the same stride, and every item takes the first one's length.
export function changeRepeat(graph: LayoutIntent, ids: readonly string[], count: number, axis: Axis, gap: number): Operation {
  if (ids.length === 0 || !Number.isInteger(count) || count < 1 || count > 1000 || !(gap >= 0)) refuse('repeat-count');
  const regions = ids.map((id) => requireRegion(graph, id)).sort((a, b) => a.box[axis] - b.box[axis]);
  const first = regions[0] as Region;
  if (regions.some((r) => r.parent !== first.parent)) refuse('gap-siblings');
  const operations: Operation[] = [];
  const kept = regions.slice(0, count);
  const stride = length(first.box, axis) + gap;
  if (count < regions.length) operations.push({ kind: 'delete', ids: regions.slice(count).map((r) => r.id) });
  kept.forEach((r, i) => operations.push({ kind: 'resize-region', id: r.id, box: { ...r.box, [axis]: first.box[axis] + stride * i, [lengthKey(axis)]: length(first.box, axis) } }));
  for (let i = kept.length; i < count; i += 1) operations.push({ kind: 'duplicate', ids: [first.id], dx: axis === 'x' ? stride * i : 0, dy: axis === 'y' ? stride * i : 0 });
  return { kind: 'compose', operations };
}

// A grid's cells laid again in another number of columns (spec "Spatial Components": CardGrid(columns = …)): the same
// cells, cell size and gaps, in reading order, as many rows as they need.
export function relayoutGrid(graph: LayoutIntent, ids: readonly string[], columns: number): Operation {
  if (!Number.isInteger(columns) || columns < 1 || ids.length === 0) refuse('repeat-count');
  const cells = ids.map((id) => requireRegion(graph, id)).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const first = cells[0] as Region;
  const xs = [...new Set(cells.map((r) => r.box.x))].sort((a, b) => a - b);
  const ys = [...new Set(cells.map((r) => r.box.y))].sort((a, b) => a - b);
  const gapX = xs.length > 1 ? (xs[1] as number) - (xs[0] as number) - first.box.width : 0;
  const gapY = ys.length > 1 ? (ys[1] as number) - (ys[0] as number) - first.box.height : gapX;
  return {
    kind: 'compose',
    operations: cells.map((r, i) => ({ kind: 'resize-region', id: r.id, box: { x: first.box.x + (i % columns) * (first.box.width + gapX), y: first.box.y + Math.floor(i / columns) * (first.box.height + gapY), width: first.box.width, height: first.box.height } })),
  };
}

// The interpretation the person chose before confirming becomes the group's preference.
export function chooseInterpretation(graph: LayoutIntent, candidate: Interpretation): Operation {
  const regions = candidate.regions.map((id) => requireRegion(graph, id));
  if (regions.some((r) => r.parent !== candidate.parent)) refuse('interpretation-parents');
  const strategy = candidate.kind === 'repeat' ? 'grid' : candidate.kind;
  return { kind: 'interpret', parent: candidate.parent, strategy };
}

// A suggestion accepted (spec "Structural Suggestions"): a repeated group becomes a grid, nearly equal gaps one gap, a
// wrapper that no longer affects the layout goes.
export function acceptSuggestion(graph: LayoutIntent, suggestion: Suggestion): Operation {
  if (suggestion.kind === 'repeat') return { kind: 'interpret', parent: suggestion.parent, strategy: 'grid' };
  if (suggestion.kind === 'equal-gap') {
    const axis: Axis = suggestion.id.startsWith('equal-gap:x') ? 'x' : 'y';
    const average = Math.round((suggestion.evidence.reduce((s, g) => s + g, 0) / suggestion.evidence.length) * 1024) / 1024;
    return { kind: 'constraint', constraint: { id: nextConstraintId(graph), kind: 'gap', axis, regions: suggestion.regions, value: average } };
  }
  const [wrapper, child] = suggestion.regions;
  if (wrapper === undefined || child === undefined) refuse('unknown-region', { region: '' });
  const parent = requireRegion(graph, wrapper).parent;
  return { kind: 'compose', operations: [parent === null ? { kind: 'extract', ids: [child] } : { kind: 'nest', ids: [child], parent }, { kind: 'delete', ids: [wrapper] }] };
}

// Every inert wrapper removed at once (spec "Layout Canonicalization").
export function removeRedundantWrappers(graph: LayoutIntent): Operation {
  return { kind: 'compose', operations: suggestions(graph).filter((s) => s.kind === 'remove-wrapper').map((s) => acceptSuggestion(graph, s)) };
}

// Selection cycling in overlapping areas (spec "Seleção"): the next region under the point, deepest first, round.
export function cycleSelection(graph: LayoutIntent, point: Point, current: string | null): string | null {
  const candidates = hitRegions(graph.regions, point);
  if (candidates.length === 0) return null;
  const index = candidates.findIndex((r) => r.id === current);
  return (candidates[(index + 1) % candidates.length] as Region).id;
}

export type SelectionMode = 'replace' | 'add' | 'toggle' | 'cycle';

export function nextSelection(current: readonly string[], ids: readonly string[], mode: SelectionMode): string[] {
  if (mode === 'add') return [...new Set([...current, ...ids])];
  if (mode === 'toggle') return [...current.filter((id) => !ids.includes(id)), ...ids.filter((id) => !current.includes(id))];
  return [...ids];
}

// A shared boundary edited as an entity (spec "Topological Editing"): removing it merges the regions it separates,
// duplicating it cuts the regions it crosses at another place (a new track), bending it puts a vertex on it.
export type BoundaryEdit = { readonly kind: 'remove' } | { readonly kind: 'duplicate'; readonly at: number } | { readonly kind: 'bend'; readonly point: Point };

export function editBoundary(graph: LayoutIntent, id: string, edit: BoundaryEdit): Operation {
  const boundary = topology(graph).boundaries.find((b) => b.id === id) ?? refuse('unknown-boundary');
  if (edit.kind === 'remove') return { kind: 'merge', ids: boundary.regions };
  if (edit.kind === 'duplicate') {
    const crossing = boundary.regions.filter((rid) => {
      const r = requireRegion(graph, rid);
      return edit.at > r.box[boundary.axis] + precision && edit.at < end(r.box, boundary.axis) - precision;
    });
    if (crossing.length === 0) refuse('cut-nothing');
    return { kind: 'split', ids: crossing, axis: boundary.axis, positions: [edit.at] };
  }
  const across: Axis = boundary.axis === 'x' ? 'y' : 'x';
  if (edit.point[across] <= boundary.from || edit.point[across] >= boundary.to) refuse('bend-span');
  const operations: Operation[] = boundary.regions.map((rid) => {
    const shape = regionShape(requireRegion(graph, rid));
    const points: Point[] = [];
    let inserted = false;
    shape.outer.forEach((a, index) => {
      const b = shape.outer[(index + 1) % shape.outer.length] as Point;
      points.push(a);
      const onLine = Math.abs(a[boundary.axis] - boundary.at) < precision && Math.abs(b[boundary.axis] - boundary.at) < precision;
      if (!inserted && onLine && edit.point[across] > Math.min(a[across], b[across]) && edit.point[across] < Math.max(a[across], b[across])) {
        points.push(edit.point);
        inserted = true;
      }
    });
    if (!inserted) refuse('bend-shape');
    return { kind: 'reshape', id: rid, points };
  });
  return { kind: 'compose', operations };
}

// The key of the group a set of regions belongs to (their parent's).
export const groupOf = (graph: LayoutIntent, ids: readonly string[]): string => preferenceKey(findRegion(graph, ids[0] ?? '')?.parent ?? null);

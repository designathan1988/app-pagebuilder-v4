// What the composer understands from geometry (spec "Pattern Recognition", "Ambiguity Engine", "Layout Predictor",
// "Layout Diff", "Content Pressure", "Layout Stress Testing", "Structural Suggestions", "Canonicalization"). Everything
// here reads the graph and proposes; nothing changes it: a proposal the person accepts becomes an operation
// (gestures/structural.ts).
import type { Axis, LayoutIntent, Region, ResponsiveRule } from './model.ts';
import { childrenOf, findRegion, preferenceKey } from './model.ts';
import { end, length, precision } from '../geometry/geometry.ts';

type PatternKind = 'repeated-row' | 'repeated-column' | 'grid' | 'sidebar' | 'split' | 'masonry' | 'alternating-sections' | 'dashboard' | 'holy-grail' | 'master-detail';

export interface Pattern {
  readonly kind: PatternKind;
  readonly parent: string | null;
  readonly regions: readonly string[];
  readonly count: number;
  readonly columns: number;
  readonly gap: number;
  readonly confidence: number;
}

// Two lengths the same to the eye: what a hand drawing two equal columns produces (within 4 px, or 3% of the shorter:
// the last card of a row snapped to the container's edge is a few pixels wider than the others).
const near = (a: number, b: number, tolerance?: number): boolean => Math.abs(a - b) <= (tolerance ?? Math.max(4, Math.min(Math.abs(a), Math.abs(b)) * 0.03));

function siblingPatterns(held: readonly Region[], parent: string | null): Pattern[] {
  const result: Pattern[] = [];
  if (held.length < 2) return result;
  const first = held[0] as Region;
  for (const axis of ['x', 'y'] as const) {
    const other: Axis = axis === 'x' ? 'y' : 'x';
    // the lines of the group: regions that stand at the same place across the axis with the same length across it (a
    // row of cards among a header and a footer is a line of its own)
    const lines: Region[][] = [];
    for (const r of [...held].sort((a, b) => a.box[other] - b.box[other] || a.box[axis] - b.box[axis])) {
      const line = lines.find((l) => near((l[0] as Region).box[other], r.box[other]) && near(length((l[0] as Region).box, other), length(r.box, other)));
      if (line === undefined) lines.push([r]);
      else line.push(r);
    }
    for (const line of lines.filter((l) => l.length >= 2)) {
      const ordered = [...line].sort((a, b) => a.box[axis] - b.box[axis]);
      const head = ordered[0] as Region;
      const gaps = ordered.slice(1).map((r, i) => r.box[axis] - end((ordered[i] as Region).box, axis));
      const firstGap = gaps[0] ?? 0;
      const equalItems = ordered.every((r) => near(length(r.box, axis), length(head.box, axis)));
      if (!equalItems || !gaps.every((g) => g >= 0 && near(g, firstGap))) continue;
      const deviation = gaps.reduce((sum, g) => sum + Math.abs(g - firstGap), 0);
      // a line of only part of the group is less certain than the whole group in one line
      const whole = line.length === held.length ? 1 : 0.92;
      result.push({ kind: axis === 'x' ? 'repeated-row' : 'repeated-column', parent, regions: ordered.map((r) => r.id), count: line.length, columns: axis === 'x' ? line.length : 1, gap: firstGap, confidence: Math.max(0.7, 1 - deviation / Math.max(1, line.length * 2)) * whole });
    }
  }
  const xs = [...new Set(held.map((r) => r.box.x))].sort((a, b) => a - b);
  const ys = [...new Set(held.map((r) => r.box.y))].sort((a, b) => a - b);
  // masonry: columns of equal width whose items differ in height and simply stack
  const columns = xs.map((x) => held.filter((r) => near(r.box.x, x)).sort((a, b) => a.box.y - b.box.y)).filter((c) => c.length > 0);
  const masonry = columns.length > 1 && columns.length < held.length && columns.every((c) => c.every((r) => near(r.box.width, (c[0] as Region).box.width))) && held.some((r) => !near(r.box.height, first.box.height)) && columns.every((c) => c.slice(1).every((r, i) => r.box.y >= end((c[i] as Region).box, 'y')));
  if (masonry) {
    const gap = ((columns[1] as Region[])[0] as Region).box.x - end(((columns[0] as Region[])[0] as Region).box, 'x');
    result.push({ kind: 'masonry', parent, regions: columns.flat().map((r) => r.id), count: held.length, columns: columns.length, gap, confidence: 0.94 });
  }
  // alternating sections: rows of two whose wide side swaps from row to row
  const rows = ys.map((y) => held.filter((r) => near(r.box.y, y)).sort((a, b) => a.box.x - b.box.x));
  const swaps = rows.length >= 2 && rows.every((row) => row.length === 2) && rows.slice(1).every((row, i) => {
    const previous = rows[i] as Region[];
    return ((row[0] as Region).box.width - (row[1] as Region).box.width) * ((previous[0] as Region).box.width - (previous[1] as Region).box.width) < 0;
  });
  if (swaps) {
    const head = rows[0] as Region[];
    result.push({ kind: 'alternating-sections', parent, regions: rows.flat().map((r) => r.id), count: rows.length, columns: 2, gap: (head[1] as Region).box.x - end((head[0] as Region).box, 'x'), confidence: 0.95 });
  }
  if (held.length >= 6 && new Set(held.map((r) => `${r.box.width}:${r.box.height}`)).size > 1) result.push({ kind: 'dashboard', parent, regions: held.map((r) => r.id), count: held.length, columns: xs.length, gap: 0, confidence: 0.75 });
  if (['header', 'footer', 'main'].every((tag) => held.some((r) => r.semantic === tag)) && held.filter((r) => r.semantic === 'aside' || r.semantic === 'nav').length >= 2) result.push({ kind: 'holy-grail', parent, regions: held.map((r) => r.id), count: held.length, columns: 3, gap: 0, confidence: 0.99 });
  // a grid: every place of a lattice taken by an equal cell, with equal gaps
  if (xs.length > 1 && ys.length > 1 && xs.length * ys.length === held.length && held.every((r) => near(r.box.width, first.box.width) && near(r.box.height, first.box.height))) {
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] as number) - first.box.width);
    if (gaps.every((g) => g >= 0 && near(g, gaps[0] as number))) result.push({ kind: 'grid', parent, regions: held.map((r) => r.id), count: held.length, columns: xs.length, gap: gaps[0] as number, confidence: 0.98 });
  }
  if (held.length === 2 && near((held[0] as Region).box.y, (held[1] as Region).box.y)) {
    const [left, right] = [...held].sort((a, b) => a.box.x - b.box.x) as [Region, Region];
    const gap = right.box.x - end(left.box, 'x');
    if (left.box.width < right.box.width * 0.6) {
      result.push({ kind: 'sidebar', parent, regions: [left.id, right.id], count: 2, columns: 2, gap, confidence: left.semantic === 'aside' ? 0.99 : 0.8 });
      if (left.semantic === 'nav' && right.semantic === 'main') result.push({ kind: 'master-detail', parent, regions: [left.id, right.id], count: 2, columns: 2, gap, confidence: 0.98 });
    } else result.push({ kind: 'split', parent, regions: [left.id, right.id], count: 2, columns: 2, gap, confidence: 0.85 });
  }
  return result;
}

const PATTERNS = new WeakMap<LayoutIntent, readonly Pattern[]>();

// Every pattern of every sibling group, the most certain first.
export function patterns(graph: LayoutIntent): readonly Pattern[] {
  const known = PATTERNS.get(graph);
  if (known !== undefined) return known;
  const result = [...new Set(graph.regions.map((r) => r.parent))].flatMap((parent) => siblingPatterns(childrenOf(graph, parent), parent));
  const sorted = result.sort((a, b) => b.confidence - a.confidence || b.regions.length - a.regions.length || a.kind.localeCompare(b.kind));
  PATTERNS.set(graph, sorted);
  return sorted;
}

// The pattern a whole group forms (every sibling in it), the likeliest one the group's chosen structure allows: what
// the predictor and the inspector describe the group as. A line among other siblings is a pattern of part of it.
export function wholePattern(graph: LayoutIntent, parent: string | null, count: number, preference?: string): Pattern | undefined {
  const allowed = preference === undefined || preference === 'auto' || preference === 'grid' || preference === 'flex';
  return allowed ? patterns(graph).find((p) => p.parent === parent && p.regions.length === count) : undefined;
}

type InterpretationKind = 'repeat' | 'flex' | 'grid' | 'fixed' | 'proportional' | 'masonry';

// One way a group can be read (spec "Ambiguity Engine"): its structure, how certain the engine is, and the facts the
// predictor shows ("3 equal columns · gap 24 · fluid").
export interface Interpretation {
  readonly id: string;
  readonly kind: InterpretationKind;
  readonly parent: string | null;
  readonly confidence: number;
  readonly regions: readonly string[];
  readonly facts: Readonly<Record<string, string | number>>;
}

// The interpretations of the group under a parent (every group when the parent is undefined), the likeliest first.
export function interpretations(graph: LayoutIntent, parent?: string | null): Interpretation[] {
  const groups = parent === undefined ? [...new Set(graph.regions.map((r) => r.parent))] : [parent];
  const candidates: Interpretation[] = [];
  for (const group of groups) {
    const held = childrenOf(graph, group);
    if (held.length === 0) continue;
    const sizing = held.every((r) => r.width.mode === held[0]?.width.mode) ? (held[0] as Region).width.mode : 'mixed';
    for (const pattern of patterns(graph).filter((p) => p.parent === group)) {
      const kind: InterpretationKind = pattern.kind === 'grid' ? 'grid' : pattern.kind === 'masonry' ? 'masonry' : 'repeat';
      candidates.push({ id: `${kind}:${preferenceKey(group)}`, kind, parent: group, confidence: pattern.confidence, regions: pattern.regions, facts: { pattern: pattern.kind, columns: pattern.columns, count: pattern.count, gap: Math.round(pattern.gap), sizing } });
      candidates.push({ id: `flex:${preferenceKey(group)}`, kind: 'flex', parent: group, confidence: pattern.confidence * 0.85, regions: pattern.regions, facts: { columns: pattern.columns, count: pattern.count, gap: Math.round(pattern.gap), sizing } });
    }
    candidates.push({ id: `proportional:${preferenceKey(group)}`, kind: 'proportional', parent: group, confidence: 0.6, regions: held.map((r) => r.id), facts: { count: held.length, sizing: 'proportional' } });
    candidates.push({ id: `fixed:${preferenceKey(group)}`, kind: 'fixed', parent: group, confidence: held.every((r) => r.width.mode === 'fixed') ? 0.99 : 0.5, regions: held.map((r) => r.id), facts: { count: held.length, sizing: 'fixed' } });
  }
  // one candidate per kind and group: the most certain reading of each
  const unique = new Map<string, Interpretation>();
  for (const c of candidates.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))) if (!unique.has(c.id)) unique.set(c.id, c);
  return [...unique.values()];
}

// Whether the two likeliest readings of a group are close enough that the person should choose (spec: "Quando duas
// interpretações forem realmente plausíveis").
export function ambiguous(candidates: readonly Interpretation[]): boolean {
  const [first, second] = candidates;
  return first !== undefined && second !== undefined && first.confidence - second.confidence < 0.2;
}

// What the predictor says a group has become: the words key under layout.predict and its values.
export interface Prediction {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

const sizeWord = (r: Region): string => (r.width.mode === 'fixed' ? `${Math.round(r.box.width)}px` : r.width.mode);

export function predict(graph: LayoutIntent, parent: string | null): Prediction {
  const held = childrenOf(graph, parent);
  if (held.length === 0) return { key: 'layout.predict.empty', params: {} };
  if (held.length === 1) return { key: 'layout.predict.single', params: { sizing: sizeWord(held[0] as Region) } };
  const preference = graph.preferences?.[preferenceKey(parent)];
  const found = wholePattern(graph, parent, held.length, preference);
  if (found?.kind === 'repeated-row') return { key: 'layout.predict.columns', params: { count: found.count, gap: Math.round(found.gap), sizing: (held[0] as Region).width.mode } };
  if (found?.kind === 'repeated-column') return { key: 'layout.predict.rows', params: { count: found.count, gap: Math.round(found.gap) } };
  if (found?.kind === 'grid') return { key: 'layout.predict.grid', params: { columns: found.columns, rows: Math.round(found.count / found.columns), gap: Math.round(found.gap) } };
  if (found?.kind === 'sidebar' || found?.kind === 'split' || found?.kind === 'master-detail') {
    const [a, b] = found.regions.map((id) => findRegion(graph, id) as Region);
    return { key: 'layout.predict.pair', params: { first: sizeWord(a as Region), second: sizeWord(b as Region) } };
  }
  return { key: 'layout.predict.regions', params: { count: held.length } };
}

// A semantic change between two versions of a layout (spec "Layout Diff"): "Sidebar reduced 280 → 240", never "37 CSS
// properties changed".
export interface SemanticChange {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export function layoutDiff(before: LayoutIntent, after: LayoutIntent): SemanticChange[] {
  const changes: SemanticChange[] = [];
  const ids = [...new Set([...before.regions, ...after.regions].map((r) => r.id))];
  for (const id of ids) {
    const a = findRegion(before, id);
    const b = findRegion(after, id);
    if (a === undefined && b !== undefined) changes.push({ key: 'layout.diff.added', params: { name: b.name } });
    if (a !== undefined && b === undefined) changes.push({ key: 'layout.diff.removed', params: { name: a.name } });
    if (a === undefined || b === undefined) continue;
    if (!near(a.box.width, b.box.width, 0.5)) changes.push({ key: b.box.width < a.box.width ? 'layout.diff.narrower' : 'layout.diff.wider', params: { name: b.name, before: Math.round(a.box.width), after: Math.round(b.box.width) } });
    if (!near(a.box.height, b.box.height, 0.5)) changes.push({ key: b.box.height < a.box.height ? 'layout.diff.shorter' : 'layout.diff.taller', params: { name: b.name, before: Math.round(a.box.height), after: Math.round(b.box.height) } });
    if (a.width.mode !== b.width.mode) changes.push({ key: 'layout.diff.sizing', params: { name: b.name, before: a.width.mode, after: b.width.mode } });
    if (a.parent !== b.parent) changes.push({ key: 'layout.diff.parent', params: { name: b.name, parent: b.parent === null ? '' : (findRegion(after, b.parent)?.name ?? '') } });
    if (a.semantic !== b.semantic) changes.push({ key: 'layout.diff.semantic', params: { name: b.name, before: a.semantic, after: b.semantic } });
    if (a.name !== b.name) changes.push({ key: 'layout.diff.renamed', params: { before: a.name, after: b.name } });
  }
  // a repeated group whose count changed ("Card layout 3 → 4 columns")
  for (const p of patterns(after).filter((one) => one.kind === 'repeated-row' || one.kind === 'grid')) {
    const old = patterns(before).find((one) => one.parent === p.parent && (one.kind === 'repeated-row' || one.kind === 'grid'));
    if (old !== undefined && old.columns !== p.columns) changes.push({ key: 'layout.diff.columns', params: { name: p.parent === null ? '' : (findRegion(after, p.parent)?.name ?? ''), before: old.columns, after: p.columns } });
  }
  const rules = new Set([...before.responsive, ...after.responsive].map((r) => r.id));
  for (const id of rules) {
    const a = before.responsive.find((r) => r.id === id);
    const b = after.responsive.find((r) => r.id === id);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ key: 'layout.diff.responsive', params: { width: Math.round((b ?? a)?.maxWidth ?? 0) } });
  }
  if (before.constraints.length !== after.constraints.length) changes.push({ key: 'layout.diff.constraints', params: { before: before.constraints.length, after: after.constraints.length } });
  if (JSON.stringify(before.variables) !== JSON.stringify(after.variables)) changes.push({ key: 'layout.diff.variables', params: { count: Object.keys(after.variables).length } });
  return changes;
}

// The rule in force at a width: the narrowest one whose maximum holds it.
export function ruleAt(graph: LayoutIntent, width: number): ResponsiveRule | null {
  return [...graph.responsive].filter((r) => width <= r.maxWidth).sort((a, b) => a.maxWidth - b.maxWidth)[0] ?? null;
}

// A width the stress test measures the page at, with what the canvas measured there: each region's content minimum
// and, when the canvas draws it, the room the region actually has.
export interface StressCase {
  readonly width: number;
  // the zoom or text scale the case applies to every content minimum (1: as measured)
  readonly scale: number;
  readonly available?: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
  readonly content: Readonly<Record<string, { readonly minWidth: number; readonly minHeight: number }>>;
}

export interface StressIssue {
  readonly kind: 'content-pressure' | 'fixed-overflow' | 'height-pressure' | 'squeezed';
  readonly region: string;
  readonly viewport: number;
  readonly required: number;
  readonly available: number;
  readonly suggestion: 'stack' | 'fluid' | 'hug';
}

function hiddenAt(graph: LayoutIntent, rule: ResponsiveRule | null, r: Region): boolean {
  const seen = new Set<string>();
  for (let at: Region | undefined = r; at !== undefined && !seen.has(at.id); at = at.parent === null ? undefined : findRegion(graph, at.parent)) {
    seen.add(at.id);
    if (rule?.hidden.includes(at.id) === true) return true;
  }
  return false;
}

// The narrowest a region drawn wider than it may become before the page no longer reads (a column of text, a card):
// narrower than this at some width, the structure breaks there.
const READABLE_WIDTH = 160;

// The columns a group flows in at a width, as the page's media queries cascade: the narrowest rule that still holds
// the width and says it; none keeps the drawn arrangement.
function columnsAt(graph: LayoutIntent, parent: string | null, width: number): number | undefined {
  const key = preferenceKey(parent);
  for (const rule of [...graph.responsive].filter((r) => width <= r.maxWidth).sort((a, b) => a.maxWidth - b.maxWidth)) {
    const columns = parent === null ? rule.columns : rule.groups?.[key]?.columns;
    if (columns !== undefined) return columns;
    if (rule.kept?.includes(key) === true) return undefined;
  }
  return undefined;
}

// Where the structure breaks under real content (spec "Layout Stress Testing"): content wider than the room a region
// has, a fixed region wider than its parent, a region squeezed narrower than it reads, fixed heights shorter than their
// content. The graph is the one the page lays out (with its automatic reflow); the minima come from the canvas (the
// editor measures the page at each width); a case without measured room estimates it from the intent, as such: a
// group reflowed in columns shares its parent's width among them, else each region keeps its drawn share of it.
export function stress(graph: LayoutIntent, cases: readonly StressCase[]): StressIssue[] {
  const issues: StressIssue[] = [];
  for (const scenario of cases) {
    const rule = ruleAt(graph, scenario.width);
    const room = new Map<string, number>();
    const widthOf = (parent: string | null): number => {
      if (parent === null) return scenario.width;
      const known = room.get(parent);
      if (known !== undefined) return known;
      const region = findRegion(graph, parent);
      return region === undefined ? scenario.width : estimate(region);
    };
    const estimate = (r: Region): number => {
      const measured = scenario.available?.[r.id]?.width;
      if (measured !== undefined) return measured;
      const outer = widthOf(r.parent);
      const parentRegion = r.parent === null ? undefined : findRegion(graph, r.parent);
      const drawnOuter = parentRegion?.box.width ?? graph.viewport.width;
      const columns = columnsAt(graph, r.parent, scenario.width);
      const held = childrenOf(graph, r.parent).filter((one) => !hiddenAt(graph, rule, one)).length;
      const share = columns === undefined ? (r.box.width / Math.max(drawnOuter, precision)) * outer : outer / Math.max(1, Math.min(columns, held));
      const available = r.width.mode === 'fixed' && columns === undefined ? r.box.width : Math.min(share, outer);
      room.set(r.id, available);
      return available;
    };
    for (const r of graph.regions) {
      if (hiddenAt(graph, rule, r)) continue;
      const available = estimate(r);
      const outer = widthOf(r.parent);
      const pressure = scenario.content[r.id];
      if (pressure !== undefined && pressure.minWidth * scenario.scale > available + precision) issues.push({ kind: 'content-pressure', region: r.id, viewport: scenario.width, required: pressure.minWidth * scenario.scale, available, suggestion: 'stack' });
      if (r.width.mode === 'fixed' && r.box.width > outer + precision) issues.push({ kind: 'fixed-overflow', region: r.id, viewport: scenario.width, required: r.box.width, available: outer, suggestion: 'fluid' });
      else if (r.kind !== 'content' && r.box.width >= READABLE_WIDTH && available < READABLE_WIDTH - precision) issues.push({ kind: 'squeezed', region: r.id, viewport: scenario.width, required: READABLE_WIDTH, available, suggestion: 'stack' });
      const height = scenario.available?.[r.id]?.height ?? r.box.height;
      if (r.height.mode === 'fixed' && pressure !== undefined && pressure.minHeight * scenario.scale > height + precision) issues.push({ kind: 'height-pressure', region: r.id, viewport: scenario.width, required: pressure.minHeight * scenario.scale, available: height, suggestion: 'hug' });
    }
  }
  return issues;
}

// The widest width at which the structure breaks: "Layout becomes unstable at 684px." Null when every case holds.
export function unstableAt(issues: readonly StressIssue[]): number | null {
  return issues.length === 0 ? null : Math.max(...issues.map((i) => i.viewport));
}

// The widths a stress sweep measures: the authoring width down to the narrowest phone, every project breakpoint, and
// the steps between, widest first.
export function stressWidths(widest: number, breakpoints: readonly number[], narrowest = 320, steps = 8): number[] {
  const between = Array.from({ length: steps + 1 }, (_, i) => Math.round(widest - ((widest - narrowest) * i) / steps));
  return [...new Set([...between, ...breakpoints.filter((w) => w >= narrowest && w <= widest)])].sort((a, b) => b - a);
}

export interface Suggestion {
  readonly id: string;
  readonly kind: 'repeat' | 'equal-gap' | 'remove-wrapper';
  readonly parent: string | null;
  readonly regions: readonly string[];
  readonly evidence: readonly number[];
}

// Structural suggestions, only on strong geometric evidence (spec "Structural Suggestions"): a repeated group to
// convert, gaps that differ by less than 2px, a wrapper that no longer affects the layout.
export function suggestions(graph: LayoutIntent): Suggestion[] {
  // one repeat suggestion per group: the pattern that covers the most of it (a grid over its rows)
  const repeats = new Map<string, Suggestion>();
  for (const p of patterns(graph)) {
    if (p.confidence < 0.9 || p.count < 3 || graph.preferences?.[preferenceKey(p.parent)] !== undefined) continue;
    const id = `repeat:${preferenceKey(p.parent)}`;
    if ((repeats.get(id)?.regions.length ?? 0) < p.regions.length) repeats.set(id, { id, kind: 'repeat', parent: p.parent, regions: p.regions, evidence: [p.count, p.gap, p.confidence] });
  }
  const result: Suggestion[] = [...repeats.values()];
  for (const parent of new Set(graph.regions.map((r) => r.parent)))
    for (const axis of ['x', 'y'] as const) {
      const siblings = childrenOf(graph, parent).sort((a, b) => a.box[axis] - b.box[axis]);
      const gaps = siblings.slice(1).map((r, i) => r.box[axis] - end((siblings[i] as Region).box, axis));
      const spread = gaps.length >= 2 ? Math.max(...gaps) - Math.min(...gaps) : 0;
      const inLine = siblings.every((r) => Math.abs(r.box[axis === 'x' ? 'y' : 'x'] - (siblings[0] as Region).box[axis === 'x' ? 'y' : 'x']) <= 2);
      if (gaps.length >= 2 && inLine && Math.min(...gaps) >= 0 && spread > precision && spread <= 2) result.push({ id: `equal-gap:${axis}:${preferenceKey(parent)}`, kind: 'equal-gap', parent, regions: siblings.map((r) => r.id), evidence: gaps });
    }
  for (const r of graph.regions) {
    const children = childrenOf(graph, r.id);
    const only = children[0];
    const inert = children.length === 1 && only !== undefined && r.kind !== 'content' && r.layout === undefined && r.polygon === undefined && r.radius === undefined && r.semantic === 'div' && JSON.stringify(r.box) === JSON.stringify(only.box);
    const referenced =
      graph.constraints.some((c) => c.regions.includes(r.id)) ||
      (graph.morphs ?? []).some((m) => m.region === r.id) ||
      graph.responsive.some((rule) => rule.hidden.includes(r.id) || rule.order?.includes(r.id) === true || rule.sizes?.[r.id] !== undefined);
    if (inert && !referenced) result.push({ id: `remove-wrapper:${r.id}`, kind: 'remove-wrapper', parent: r.parent, regions: [r.id, only.id], evidence: [1] });
  }
  return result;
}

// A region whose content cannot shrink below a measured width never asks for less (spec "Content Pressure Engine": a
// drawn 300 px may mean "preferred 300, minimum 220"); a fixed region keeps its length.
export function contentPressure(region: Region, measured: { readonly minWidth: number; readonly preferredWidth: number }): Region {
  if (region.width.mode === 'fixed') return region;
  const min = Math.max(region.width.min ?? 0, Math.round(measured.minWidth));
  return { ...region, width: { ...region.width, min, ...(region.width.max !== undefined ? { max: Math.max(region.width.max, min) } : {}) } };
}

// One canonical form for intents that mean the same (spec "Layout Canonicalization"): duplicated constraints once,
// variables and rules in a fixed order, each provenance step once.
export function canonicalize(graph: LayoutIntent): LayoutIntent {
  const meaning = new Map<string, LayoutIntent['constraints'][number]>();
  for (const c of graph.constraints) {
    const { id: _id, ...rest } = c;
    void _id;
    const key = JSON.stringify({ ...rest, regions: [...rest.regions].sort() });
    if (!meaning.has(key)) meaning.set(key, c);
  }
  return {
    ...graph,
    constraints: [...meaning.values()],
    variables: Object.fromEntries(Object.entries(graph.variables).sort(([a], [b]) => a.localeCompare(b))),
    responsive: [...graph.responsive].sort((a, b) => b.maxWidth - a.maxWidth),
    regions: graph.regions.map((r) => ({ ...r, provenance: [...new Set(r.provenance)] })),
  };
}

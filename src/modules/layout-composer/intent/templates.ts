// Layout templates and spatial components (spec "Layout templates", "Conversão para template", "Spatial Components"):
// any valid composition, or the regions selected in one, saved as a reusable structure with the parameters it can be
// placed with — its layout variables (gap = 24) and the count of each repeated group (columns = 4). Placing one adds
// its regions to the composition at the place chosen, scaled to it, as one operation. The project keeps the saved
// ones (host/schema.ts); the built-in ones are made here, named in the person's language.
import type { Box, LayoutIntent, Region, Semantic } from './model.ts';
import { childrenOf, descendants, emptyIntent, preferenceKey, region } from './model.ts';
import { nextConstraintId, nextRegionId, nextRuleId } from './ids.ts';
import { refuse } from './problems.ts';
import { canonicalize, patterns } from './analysis.ts';
import { bounds, canonicalBox } from '../geometry/geometry.ts';
import { validateIntent } from '../topology/topology.ts';
import { solve } from '../constraints/solve.ts';
import { changeRepeat, relayoutGrid } from '../gestures/structural.ts';
import { execute, type Naming, type Operation } from '../gestures/operations.ts';

type TemplateParameter =
  | { readonly kind: 'variable'; readonly value: number }
  // the number of items of the repeated group whose first item is `first`
  | { readonly kind: 'count'; readonly value: number; readonly first: string; readonly axis: 'x' | 'y'; readonly gap: number }
  // the number of columns of the grid whose cells include `first`
  | { readonly kind: 'columns'; readonly value: number; readonly first: string };

export interface LayoutTemplate {
  readonly version: 1;
  readonly name: string;
  // the composition, moved to start at 0,0
  readonly graph: LayoutIntent;
  readonly parameters: Readonly<Record<string, TemplateParameter>>;
}

// The parameters a structure offers: each variable it names, and each repeated group's count.
function parametersOf(graph: LayoutIntent): Record<string, TemplateParameter> {
  const result: Record<string, TemplateParameter> = {};
  for (const [name, value] of Object.entries(graph.variables)) result[name] = { kind: 'variable', value };
  const found = patterns(graph);
  const grids = found.filter((p) => p.kind === 'grid');
  grids.forEach((p, i) => {
    const first = p.regions[0];
    if (first !== undefined) result[`columns${i + 1}`] = { kind: 'columns', value: p.columns, first };
  });
  // the lines of a grid are its rows, not repetitions of their own
  const inGrid = new Set(grids.flatMap((p) => p.regions));
  found
    .filter((p) => (p.kind === 'repeated-row' || p.kind === 'repeated-column') && !p.regions.some((id) => inGrid.has(id)))
    .forEach((p, i) => {
      const first = p.regions[0];
      if (first !== undefined) result[`count${i + 1}`] = { kind: 'count', value: p.count, first, axis: p.kind === 'repeated-row' ? 'x' : 'y', gap: p.gap };
    });
  return result;
}

// The regions chosen (with what they hold) taken out of a composition on their own, moved to start at 0,0.
function extract(graph: LayoutIntent, ids: readonly string[]): LayoutIntent {
  const kept = descendants(graph, ids);
  const regions = graph.regions.filter((r) => kept.has(r.id));
  if (regions.length === 0) refuse('nothing-selected');
  const outline = bounds(regions.filter((r) => r.parent === null || !kept.has(r.parent)).map((r) => r.box));
  const shift = (p: { x: number; y: number }) => ({ x: p.x - outline.x, y: p.y - outline.y });
  const moved: Region[] = regions.map((r) => {
    const { kind: _kind, ...rest } = r;
    void _kind;
    // a content region names an element of this page: in a template it is an empty region of the same place
    const structural = r.kind === 'content' ? rest : r;
    return {
      ...structural,
      parent: r.parent !== null && kept.has(r.parent) ? r.parent : null,
      box: canonicalBox({ ...r.box, ...shift(r.box) }),
      ...(r.polygon === undefined ? {} : { polygon: r.polygon.map(shift) }),
      ...(r.holes === undefined ? {} : { holes: r.holes.map((h) => h.map(shift)) }),
      provenance: [],
    };
  });
  const inside = (list: readonly string[]) => list.every((id) => kept.has(id));
  return {
    ...emptyIntent(outline.width, outline.height),
    regions: moved,
    constraints: graph.constraints.filter((c) => inside(c.regions)),
    responsive: graph.responsive.map((rule) => ({
      ...rule,
      hidden: rule.hidden.filter((id) => kept.has(id)),
      ...(rule.order === undefined ? {} : { order: rule.order.filter((id) => kept.has(id)) }),
      ...(rule.sizes === undefined ? {} : { sizes: Object.fromEntries(Object.entries(rule.sizes).filter(([id]) => kept.has(id))) })
    })),
    variables: graph.variables,
    ...(graph.preferences === undefined ? {} : { preferences: Object.fromEntries(Object.entries(graph.preferences).filter(([key]) => [...kept].some((id) => key === preferenceKey(id)))) }),
    ...(graph.morphs === undefined ? {} : { morphs: graph.morphs.filter((m) => m.region !== null && kept.has(m.region)) }),
  };
}

export function createTemplate(name: string, graph: LayoutIntent, selection: readonly string[] = []): LayoutTemplate {
  if (name.trim() === '') refuse('template-name');
  const roots = selection.length > 0 ? selection : childrenOf(graph, null).map((r) => r.id);
  const taken = extract(graph, roots);
  if (validateIntent(taken).length > 0) refuse('template', { name });
  const structure = canonicalize(taken);
  return { version: 1, name: name.trim(), graph: structure, parameters: parametersOf(structure) };
}

// The operation that places a template in a composition: inside a region (or at the top level) over a box, its regions
// scaled to that box with fresh ids, its constraints and rules renamed to match, its variables added, then each count
// parameter given its value.
export function placeTemplate(graph: LayoutIntent, template: LayoutTemplate, target: { readonly parent: string | null; readonly box: Box }, values: Readonly<Record<string, number>>, naming: Naming): Operation {
  if (template.version !== 1 || template.graph.regions.length === 0) refuse('template', { name: template.name });
  const source = template.graph;
  const sx = target.box.width / source.viewport.width;
  const sy = target.box.height / source.viewport.height;
  const at = (p: { x: number; y: number }) => ({ x: target.box.x + p.x * sx, y: target.box.y + p.y * sy });
  let working = graph;
  const ids = new Map<string, string>();
  for (const r of source.regions) {
    const id = nextRegionId(working);
    ids.set(r.id, id);
    working = { ...working, regions: [...working.regions, { ...r, id }] };
  }
  const regionOf = (id: string) => ids.get(id) as string;
  const placed: Region[] = source.regions.map((r) => ({
    ...r,
    id: regionOf(r.id),
    parent: r.parent === null ? target.parent : regionOf(r.parent),
    box: canonicalBox({ ...at(r.box), width: r.box.width * sx, height: r.box.height * sy }),
    ...(r.polygon === undefined ? {} : { polygon: r.polygon.map(at) }),
    ...(r.holes === undefined ? {} : { holes: r.holes.map((h) => h.map(at)) }),
    provenance: [`template:${template.name}`],
  }));
  const operations: Operation[] = placed.map((r) => ({ kind: 'draw', region: r }));
  let constraintGraph = working;
  for (const c of source.constraints) {
    const id = nextConstraintId(constraintGraph);
    const constraint = { ...c, id, regions: c.regions.map(regionOf) };
    operations.push({ kind: 'constraint', constraint });
    constraintGraph = { ...constraintGraph, constraints: [...constraintGraph.constraints, constraint] };
  }
  let ruleGraph = working;
  for (const rule of source.responsive) {
    const held = graph.responsive.find((r) => Math.abs(r.maxWidth - rule.maxWidth) < 0.5);
    const merged = held === undefined
      ? {
        ...rule,
        id: nextRuleId(ruleGraph),
        hidden: rule.hidden.map(regionOf),
        ...(rule.order === undefined ? {} : { order: rule.order.map(regionOf) }),
        ...(rule.sizes === undefined ? {} : { sizes: Object.fromEntries(Object.entries(rule.sizes).map(([id, size]) => [regionOf(id), size])) })
      }
      : { ...held, hidden: [...held.hidden, ...rule.hidden.map(regionOf)], ...(rule.sizes === undefined ? {} : { sizes: { ...held.sizes, ...Object.fromEntries(Object.entries(rule.sizes).map(([id, size]) => [regionOf(id), size])) } }) };
    operations.push({ kind: 'responsive', rule: merged });
    ruleGraph = { ...ruleGraph, responsive: [...ruleGraph.responsive.filter((r) => r.id !== merged.id), merged] };
  }
  for (const [name, parameter] of Object.entries(template.parameters))
    if (parameter.kind === 'variable') operations.push({ kind: 'variable', name, value: values[name] ?? parameter.value });
  for (const [key, strategy] of Object.entries(source.preferences ?? {})) if (key.startsWith('region:')) operations.push({ kind: 'interpret', parent: regionOf(key.slice('region:'.length)), strategy });
  const base: Operation = { kind: 'compose', operations };
  // the counts apply to the placed regions, so they are read from the graph the placement makes
  const counted = Object.entries(template.parameters).filter((entry): entry is [string, Exclude<TemplateParameter, { kind: 'variable' }>] => entry[1].kind !== 'variable' && values[entry[0]] !== undefined && values[entry[0]] !== entry[1].value);
  if (counted.length === 0) return base;
  const placedGraph = execute(graph, base, naming);
  if (!placedGraph.ok) return base;
  const counts: Operation[] = counted.map(([name, parameter]) => {
    if (parameter.kind === 'columns') {
      const grid = patterns(placedGraph.graph).find((p) => p.kind === 'grid' && p.regions.includes(regionOf(parameter.first)));
      return relayoutGrid(placedGraph.graph, grid?.regions ?? [regionOf(parameter.first)], values[name] as number);
    }
    const group = patterns(placedGraph.graph).find((p) => p.regions[0] === regionOf(parameter.first));
    return changeRepeat(placedGraph.graph, group?.regions ?? [regionOf(parameter.first)], values[name] as number, parameter.axis, parameter.gap * (parameter.axis === 'x' ? sx : sy));
  });
  return { kind: 'compose', operations: [base, ...counts] };
}

// The built-in structures (spec: Dashboard, Landing page, Sidebar layout, Article, Gallery), in the person's words.
export type BuiltInTemplate = 'dashboard' | 'landing' | 'sidebar' | 'article' | 'gallery';
export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = ['dashboard', 'landing', 'sidebar', 'article', 'gallery'];

interface Part {
  readonly name: string;
  readonly box: Box;
  readonly semantic: Semantic;
  readonly fixed?: boolean;
}

function fromParts(parts: readonly Part[], width: number, height: number): LayoutIntent {
  return solve({
    ...emptyIntent(width, height),
    // a template's regions are named and given their meaning: the layout never reads another one into them
    regions: parts.map((p, i) => ({ ...region(`r${i + 1}`, p.box, p.name), semantic: p.semantic, chosen: true as const, ...(p.fixed === true ? { width: { mode: 'fixed' as const } } : {}) })),
  }).graph;
}

export function builtInTemplate(kind: BuiltInTemplate, words: (key: string) => string): LayoutTemplate {
  const name = (key: string) => words(`layout.template.part.${key}`);
  let graph: LayoutIntent;
  switch (kind) {
    case 'dashboard': {
      const tiles: Part[] = [0, 1, 2].map((i) => ({ name: `${name('metric')} ${i + 1}`, box: { x: 280 + i * 320, y: 96, width: 296, height: 160 }, semantic: 'section' }));
      graph = fromParts([{ name: name('navigation'), box: { x: 0, y: 0, width: 256, height: 720 }, semantic: 'nav', fixed: true }, { name: name('header'), box: { x: 280, y: 0, width: 944, height: 72 }, semantic: 'header' }, ...tiles, { name: name('chart'), box: { x: 280, y: 280, width: 616, height: 440 }, semantic: 'section' }, { name: name('activity'), box: { x: 920, y: 280, width: 304, height: 440 }, semantic: 'aside' }], 1224, 720);
      break;
    }
    case 'landing':
      graph = fromParts([{ name: name('header'), box: { x: 0, y: 0, width: 1200, height: 80 }, semantic: 'header' }, { name: name('hero'), box: { x: 0, y: 80, width: 1200, height: 480 }, semantic: 'section' }, ...[0, 1, 2].map((i): Part => ({ name: `${name('feature')} ${i + 1}`, box: { x: i * 408, y: 600, width: 384, height: 240 }, semantic: 'article' })), { name: name('footer'), box: { x: 0, y: 880, width: 1200, height: 160 }, semantic: 'footer' }], 1200, 1040);
      break;
    case 'sidebar':
      graph = fromParts([{ name: name('sidebar'), box: { x: 0, y: 0, width: 280, height: 800 }, semantic: 'aside', fixed: true }, { name: name('content'), box: { x: 304, y: 0, width: 896, height: 800 }, semantic: 'main' }], 1200, 800);
      break;
    case 'article':
      graph = fromParts([{ name: name('header'), box: { x: 0, y: 0, width: 1200, height: 96 }, semantic: 'header' }, { name: name('content'), box: { x: 200, y: 128, width: 800, height: 900 }, semantic: 'article' }, { name: name('footer'), box: { x: 0, y: 1060, width: 1200, height: 140 }, semantic: 'footer' }], 1200, 1200);
      break;
    case 'gallery': {
      const cells: Part[] = [];
      for (let row = 0; row < 2; row += 1) for (let column = 0; column < 4; column += 1) cells.push({ name: `${name('item')} ${row * 4 + column + 1}`, box: { x: column * 306, y: row * 306, width: 282, height: 282 }, semantic: 'article' });
      graph = fromParts(cells, 1200, 588);
      break;
    }
  }
  return { version: 1, name: words(`layout.template.${kind}`), graph, parameters: parametersOf(graph) };
}

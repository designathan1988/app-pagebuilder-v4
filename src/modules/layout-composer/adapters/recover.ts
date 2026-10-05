// Structural import (spec "Importação estrutural", "Reedição"): the elements a container already holds — written by
// hand, imported from HTML, or compiled before and edited since — read back into a Layout Intent Graph. The canvas
// measures each element and the document gives its declared styles (the host does both; this module never parses
// HTML or measures a page). Where the styles say what was meant (a fixed width, a share of a row, a gap, a padding, a
// column count at a breakpoint) the intent is recovered; where they do not (absolute positioning, a size in units the
// layout has no word for, an element the canvas draws with no size) the region keeps its measured geometry and the
// ambiguity is reported, with the share of the evidence that held: "Recovered intent: 93%".
import type { Box, Constraint, Dimension, LayoutIntent, Region, RegionLayout, ResponsiveRule, Semantic } from '../intent/model.ts';
import { ALIGNMENTS, DISTRIBUTIONS, SEMANTICS, emptyIntent, preferenceKey } from '../intent/model.ts';
import { nextConstraintId, nextRuleId } from '../intent/ids.ts';
import { contains, end, intersection, precision } from '../geometry/geometry.ts';

// Declarations by role (camelCase of the manifest's property ids: flexGrow, gridTemplateColumns).
type Roles = Readonly<Record<string, string>>;

export interface MeasuredNode {
  // the region id the node becomes (the host keeps the mapping to the node)
  readonly id: string;
  readonly name: string;
  // the measured node that holds it, or null for a child of the composed container itself
  readonly parent: string | null;
  // its border box in the container's coordinates
  readonly box: Box;
  readonly tag: string;
  // whether it is a container (a region that can hold regions) or an element the layout only places
  readonly container: boolean;
  // its declarations at the base breakpoint and state, by role
  readonly styles: Roles;
  // its declarations at narrower breakpoints, by the breakpoint's width
  readonly responsive: Readonly<Record<number, Roles>>;
}

type AmbiguityReason = 'unknown-layout' | 'positioned' | 'sizing' | 'degenerate' | 'overflow' | 'overlap';

export interface Recovery {
  readonly graph: LayoutIntent;
  // the share of the evidence that held, 0 to 100
  readonly confidence: number;
  readonly ambiguities: readonly { readonly region: string; readonly reason: AmbiguityReason }[];
}

const PX = /^(-?\d+(?:\.\d+)?)px$/;
const pxOf = (text: string | undefined): number | null => {
  const found = text === undefined ? null : PX.exec(text.trim());
  return found === null ? null : Number(found[1]);
};
const UNDERSTOOD_SIZE = /^(auto|fit-content|min-content|max-content|0|\d+(\.\d+)?(px|%|fr))$/;
const LAYOUTS = new Set(['flex', 'grid', 'block', 'inline-flex', 'inline-grid', 'flow-root']);

// how a node takes its width inside its parent, from what its declarations and its parent's say
function widthOf(node: MeasuredNode, parent: MeasuredNode | undefined): { dimension: Dimension; understood: boolean } {
  const s = node.styles;
  const basis = pxOf(s.flexBasis);
  const grow = s.flexGrow === undefined ? null : Number(s.flexGrow);
  const declared = s.width;
  const min = pxOf(s.minWidth);
  const max = pxOf(s.maxWidth);
  const bounds = { ...(min !== null && min > 0 ? { min } : {}), ...(max !== null ? { max } : {}) };
  const inRow = parent?.styles.display?.includes('flex') === true && (parent.styles.flexDirection ?? 'row').startsWith('row');
  const understood = [declared, s.flexBasis, s.minWidth, s.maxWidth].every((v) => v === undefined || UNDERSTOOD_SIZE.test(v.trim()));
  if (pxOf(declared) !== null || (inRow && basis !== null && grow === 0)) return { dimension: { mode: 'fixed', ...bounds }, understood };
  if (declared === 'fit-content' || (inRow && grow === 0 && (s.flexBasis === undefined || s.flexBasis === 'auto'))) return { dimension: { mode: 'hug', ...bounds }, understood };
  if (inRow && grow !== null && grow > 0) return { dimension: { mode: 'fluid', weight: grow, ...bounds }, understood };
  if (declared === '100%') return { dimension: { mode: 'fill-available', ...bounds }, understood };
  return { dimension: { mode: 'fluid', ...bounds }, understood };
}

function heightOf(node: MeasuredNode): Dimension {
  const s = node.styles;
  if (pxOf(s.height) !== null) return { mode: 'fixed' };
  const min = pxOf(s.minHeight);
  return { mode: 'fluid', ...(min !== null && min > 0 ? { min } : {}) };
}

export function recoverIntent(nodes: readonly MeasuredNode[], viewport: Box): Recovery {
  const ambiguities: { region: string; reason: AmbiguityReason }[] = [];
  const known = new Map(nodes.map((n) => [n.id, n]));
  let evidence = 0;
  let held = 0;
  const weigh = (ok: boolean) => {
    evidence += 1;
    if (ok) held += 1;
  };
  const regions: Region[] = nodes.map((n) => {
    const parent = n.parent === null ? undefined : known.get(n.parent);
    const display = n.styles.display;
    const positioned = n.styles.position === 'absolute' || n.styles.position === 'fixed';
    const layoutKnown = display === undefined || LAYOUTS.has(display) || !n.container;
    weigh(layoutKnown);
    if (!layoutKnown) ambiguities.push({ region: n.id, reason: 'unknown-layout' });
    weigh(!positioned);
    if (positioned) ambiguities.push({ region: n.id, reason: 'positioned' });
    const width = widthOf(n, parent);
    weigh(width.understood);
    if (!width.understood) ambiguities.push({ region: n.id, reason: 'sizing' });
    // the canvas draws it with no size (an empty element): it keeps a sliver to stay a region, reported as such
    const degenerate = n.box.width <= precision || n.box.height <= precision;
    weigh(!degenerate);
    if (degenerate) ambiguities.push({ region: n.id, reason: 'degenerate' });
    let box: Box = { ...n.box, width: Math.max(n.box.width, 1), height: Math.max(n.box.height, 1) };
    // drawn outside its parent (an overflow, a negative margin): kept inside it, reported
    const outer = parent?.box ?? viewport;
    if (!contains(outer, box)) {
      ambiguities.push({ region: n.id, reason: 'overflow' });
      const x = Math.min(Math.max(box.x, outer.x), end(outer, 'x') - 1);
      const y = Math.min(Math.max(box.y, outer.y), end(outer, 'y') - 1);
      box = { x, y, width: Math.max(1, Math.min(end(box, 'x'), end(outer, 'x')) - x), height: Math.max(1, Math.min(end(box, 'y'), end(outer, 'y')) - y) };
    }
    const semantic: Semantic = (SEMANTICS as readonly string[]).includes(n.tag) ? (n.tag as Semantic) : 'div';
    const padding = pxOf(n.styles.paddingTop);
    const samePadding = padding !== null && [n.styles.paddingRight, n.styles.paddingBottom, n.styles.paddingLeft].every((p) => pxOf(p) === padding);
    const alignment = ALIGNMENTS.find((a) => a === n.styles.alignItems);
    const distribution = DISTRIBUTIONS.find((d) => d === n.styles.justifyContent);
    const layout: RegionLayout = {
      ...(samePadding && padding !== null && padding > 0 ? { padding } : {}),
      ...(alignment === undefined ? {} : { alignment }),
      ...(distribution === undefined ? {} : { distribution }),
    };
    return {
      id: n.id,
      parent: n.parent !== null && known.has(n.parent) ? n.parent : null,
      name: n.name,
      box,
      width: n.container ? width.dimension : { mode: 'hug' as const },
      height: n.container ? heightOf(n) : { mode: 'hug' as const },
      semantic,
      ...(n.container ? {} : { kind: 'content' as const }),
      ...(n.styles.borderTopLeftRadius !== undefined && pxOf(n.styles.borderTopLeftRadius) !== null ? { radius: pxOf(n.styles.borderTopLeftRadius) as number } : {}),
      provenance: ['import'],
      ...(Object.keys(layout).length > 0 ? { layout } : {}),
    };
  });
  // siblings the page draws on top of one another keep their overlap, as one the person asked for
  for (let i = 0; i < regions.length; i += 1)
    for (let j = i + 1; j < regions.length; j += 1) {
      const a = regions[i] as Region;
      const b = regions[j] as Region;
      if (a.parent === b.parent && intersection(a.box, b.box) !== null) {
        regions[i] = { ...a, overlap: true };
        regions[j] = { ...b, overlap: true };
        ambiguities.push({ region: b.id, reason: 'overlap' });
      }
    }
  let graph: LayoutIntent = { ...emptyIntent(viewport.width, viewport.height), viewport, regions };
  // the gap each container declares between its children becomes a gap relation over them
  const constraints: Constraint[] = [];
  for (const parentKey of [null, ...nodes.filter((n) => n.container).map((n) => n.id)]) {
    const children = regions.filter((r) => r.parent === parentKey);
    const declared = parentKey === null ? undefined : known.get(parentKey)?.styles;
    const gap = pxOf(declared?.columnGap) ?? pxOf(declared?.rowGap);
    if (children.length < 2 || gap === null || declared === undefined) continue;
    const axis = declared.display?.includes('flex') === true && (declared.flexDirection ?? 'row').startsWith('column') ? 'y' : 'x';
    const constraint: Constraint = { id: nextConstraintId({ ...graph, constraints }), kind: 'gap', axis, regions: children.map((r) => r.id), value: gap };
    constraints.push(constraint);
  }
  graph = { ...graph, constraints };
  // a container that reflows at a narrower breakpoint (one column, other tracks, hidden children, a new order)
  const rules: ResponsiveRule[] = [];
  const widths = [...new Set(nodes.flatMap((n) => Object.keys(n.responsive).map(Number)))].sort((a, b) => b - a);
  for (const width of widths) {
    let rule: ResponsiveRule = { id: nextRuleId({ ...graph, responsive: rules }), maxWidth: width, hidden: [] };
    // the regions whose order changes there, by the order value each declares (the others keep 0, CSS's default)
    const ordered = nodes.filter((n) => n.responsive[width]?.order !== undefined);
    if (ordered.length > 0) {
      const place = (n: MeasuredNode) => Number(n.responsive[width]?.order ?? '0');
      const group = nodes.filter((n) => ordered.some((o) => o.parent === n.parent));
      rule = { ...rule, order: [...group].sort((a, b) => place(a) - place(b) || nodes.indexOf(a) - nodes.indexOf(b)).map((n) => n.id) };
    }
    for (const n of nodes) {
      const at = n.responsive[width];
      if (at === undefined) continue;
      if (at.display === 'none') rule = { ...rule, hidden: [...rule.hidden, n.id] };
      const stacked = at.flexDirection?.startsWith('column') === true;
      const tracks = at.gridTemplateColumns === undefined ? null : at.gridTemplateColumns.split(/\s+(?![^(]*\))/).filter((t) => t !== '').length;
      const columns = stacked ? 1 : tracks;
      if (columns !== null && n.container) rule = { ...rule, groups: { ...rule.groups, [preferenceKey(n.id)]: { columns } } };
    }
    if (rule.hidden.length > 0 || rule.order !== undefined || rule.groups !== undefined) rules.push(rule);
  }
  graph = { ...graph, responsive: rules };
  return { graph, confidence: evidence === 0 ? 100 : Math.round((held / evidence) * 100), ambiguities };
}

import { ORDER } from '../geometry/keys.ts';
// The Responsive Continuum (spec "Responsive Continuum", "Responsive Morphing", "Responsive editing"): one structure
// with behaviour recorded where the person changed it. The person drags the canvas width (the editor's continuous
// viewport width, src/editor/view/breakpoints.ts) and edits the layout there; the edit is stored as an override of the
// rule for the project breakpoint that holds that width, never as another document. A value may also change
// continuously between widths (a morph), which the compiler writes as native clamp() curves.
import type { LayoutIntent, Morph, MorphProperty, Region, ResponsiveRule, Sizing } from '../intent/model.ts';
import { ROOT_KEY, childrenOf, findRegion, preferenceKey } from '../intent/model.ts';
import { patterns } from '../intent/analysis.ts';
import { nextMorphId, nextRuleId } from '../intent/ids.ts';
import { refuse } from '../intent/problems.ts';
import type { Operation } from '../gestures/operations.ts';

export interface MorphPoint {
  readonly width: number;
  readonly value: number;
}

// The value of a morph at a width: linear between its control points, held beyond its ends.
export function morphValue(points: readonly MorphPoint[], width: number): number {
  if (points.length === 0 || points.some((p) => !Number.isFinite(p.width) || !Number.isFinite(p.value))) refuse('morph', { morph: '' });
  const sorted = [...points].sort((a, b) => a.width - b.width);
  const first = sorted[0] as MorphPoint;
  if (width <= first.width) return first.value;
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1] as MorphPoint;
    const b = sorted[i] as MorphPoint;
    if (width <= b.width) return a.value + ((b.value - a.value) * (width - a.width)) / (b.width - a.width);
  }
  return (sorted[sorted.length - 1] as MorphPoint).value;
}

const decimals = (n: number): number => Number(n.toFixed(6));

// The native fluid CSS of one segment of a morph: the line through its two points in viewport units, clamped to them.
// The page needs no script for it.
export function morphCss(a: MorphPoint, b: MorphPoint): string {
  if (!(b.width > a.width)) refuse('morph', { morph: '' });
  const slope = (b.value - a.value) / (b.width - a.width);
  const intercept = a.value - slope * a.width;
  return `clamp(${Math.min(a.value, b.value)}px, calc(${decimals(intercept)}px + ${decimals(slope * 100)}vw), ${Math.max(a.value, b.value)}px)`;
}

// The rules that let a row of equal items reflow on its own (spec: "> 920: 3 columns · 640–920: 2 · < 640: 1"): one
// rule per column count, at the width below which that many no longer fit.
export function adaptiveRules(graph: LayoutIntent, minItemWidth: number, gap: number): ResponsiveRule[] {
  if (!(minItemWidth > 0) || !(gap >= 0)) refuse('responsive-rule', { rule: '' });
  const count = graph.regions.filter((r) => r.parent === null).length;
  let working = graph;
  const rules: ResponsiveRule[] = [];
  for (let columns = count - 1; columns >= 1; columns -= 1) {
    const rule: ResponsiveRule = { id: nextRuleId(working), maxWidth: Math.floor((columns + 1) * minItemWidth + columns * gap) - 1, columns, gap, hidden: [] };
    rules.push(rule);
    working = { ...working, responsive: [...working.responsive, rule] };
  }
  return rules;
}

// The project's breakpoints as the composer sees them (the editor's breakpoint owner gives them): the width each one
// applies at and below. A recorded behaviour belongs to the narrowest breakpoint that still holds its width; none
// holds the base width, where the structure itself is edited.
export interface ProjectBreakpoint {
  readonly id: string;
  readonly maxWidth: number;
  readonly base: boolean;
}

export function breakpointHolding(breakpoints: readonly ProjectBreakpoint[], width: number): ProjectBreakpoint | null {
  return [...breakpoints].filter((b) => !b.base && width <= b.maxWidth).sort((a, b) => a.maxWidth - b.maxWidth)[0] ?? null;
}

// Each responsive rule and each morph segment, mapped to the project breakpoint whose width it names; a threshold no
// breakpoint names is refused, never rounded to a neighbour silently.
export function mapBreakpoints(graph: LayoutIntent, breakpoints: readonly ProjectBreakpoint[]): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  const byWidth = (width: number): string => breakpoints.find((b) => !b.base && Math.abs(b.maxWidth - width) < 0.5)?.id ?? refuse('responsive-rule', { rule: String(width) });
  for (const rule of graph.responsive) map[rule.id] = byWidth(rule.maxWidth);
  for (const morph of graph.morphs ?? []) for (const point of morph.points.slice(1, -1)) map[morphSegmentId(morph, point.width)] = byWidth(point.width);
  return map;
}

// The id the compiler files a morph's segment under: the segment that ends at an inner control point applies at and
// below that point's width (the widest segment is the base declaration, with no media query).
export const morphSegmentId = (morph: Morph, width: number): string => `morph:${morph.id}:${width}`;

// A change of behaviour at a width (spec "Responsive editing"): what the person did there.
export type ResponsiveEdit =
  | { readonly kind: 'stack'; readonly parent: string | null }
  | { readonly kind: 'columns'; readonly parent: string | null; readonly columns: number }
  | { readonly kind: 'unstack'; readonly parent: string | null }
  | { readonly kind: 'gap'; readonly parent: string | null; readonly gap: number }
  | { readonly kind: 'hide'; readonly ids: readonly string[] }
  | { readonly kind: 'show'; readonly ids: readonly string[] }
  | { readonly kind: 'order'; readonly ids: readonly string[] }
  | { readonly kind: 'size'; readonly id: string; readonly width?: number; readonly mode?: Sizing };

// The rule an edit at this breakpoint's width extends (or a new one), with the edit in it.
export function responsiveEdit(graph: LayoutIntent, maxWidth: number, edit: ResponsiveEdit): Operation {
  const held = graph.responsive.find((r) => Math.abs(r.maxWidth - maxWidth) < 0.5) ?? { id: nextRuleId(graph), maxWidth, hidden: [] };
  const ids = 'ids' in edit ? edit.ids : 'id' in edit ? [edit.id] : 'parent' in edit && edit.parent !== null ? [edit.parent] : [];
  for (const id of ids) if (findRegion(graph, id) === undefined) refuse('unknown-region', { region: id });
  const group = (parent: string | null, change: { columns?: number; gap?: number } | null): ResponsiveRule => {
    if (parent === null) {
      const { columns: _columns, gap: _gap, ...rest } = held;
      void _columns;
      void _gap;
      if (change === null) return rest;
      const columns = change.columns ?? held.columns;
      const gap = change.gap ?? held.gap;
      return { ...rest, ...(columns === undefined ? {} : { columns }), ...(gap === undefined ? {} : { gap }) };
    }
    const key = preferenceKey(parent);
    const { [key]: before, ...others } = held.groups ?? {};
    const next = change === null ? null : { columns: change.columns ?? before?.columns ?? 1, ...((change.gap ?? before?.gap) === undefined ? {} : { gap: (change.gap ?? before?.gap) as number }) };
    const groups = next === null ? others : { ...others, [key]: next };
    const { groups: _groups, ...rest } = held;
    void _groups;
    return Object.keys(groups).length === 0 ? rest : { ...rest, groups };
  };
  // a group the person reflows here is no longer kept as drawn here, and the other way round
  const keeping = (rule: ResponsiveRule, parent: string | null, keep: boolean): ResponsiveRule => {
    const key = preferenceKey(parent);
    const kept = (rule.kept ?? []).filter((one) => one !== key);
    const { kept: _kept, ...rest } = rule;
    void _kept;
    const next = keep ? [...kept, key] : kept;
    return next.length === 0 ? rest : { ...rest, kept: next };
  };
  let rule: ResponsiveRule;
  switch (edit.kind) {
    case 'stack':
      rule = keeping(group(edit.parent, { columns: 1 }), edit.parent, false);
      break;
    case 'columns':
      if (!Number.isInteger(edit.columns) || edit.columns < 1) refuse('responsive-rule', { rule: held.id });
      rule = keeping(group(edit.parent, { columns: edit.columns }), edit.parent, false);
      break;
    case 'unstack':
      rule = keeping(group(edit.parent, null), edit.parent, true);
      break;
    case 'gap':
      if (!(edit.gap >= 0)) refuse('responsive-rule', { rule: held.id });
      rule = group(edit.parent, { gap: edit.gap });
      break;
    case 'hide':
      rule = { ...held, hidden: [...new Set([...held.hidden, ...edit.ids])] };
      break;
    case 'show':
      rule = { ...held, hidden: held.hidden.filter((id) => !edit.ids.includes(id)) };
      break;
    case ORDER:
      rule = { ...held, order: [...edit.ids] };
      break;
    case 'size': {
      const sizes = { ...held.sizes, [edit.id]: { ...(edit.width === undefined ? {} : { width: edit.width }), ...(edit.mode === undefined ? {} : { mode: edit.mode }) } };
      rule = { ...held, sizes };
      break;
    }
  }
  return { kind: 'responsive', rule };
}

// The behaviour a layout has on its own at narrower screens (spec "Responsive inference": [A][B][C] side by side on a
// desktop are [A] [B] [C] one under the other on a phone), wherever the person chose nothing else there. At the tablet
// breakpoint (the widest project breakpoint no wider than ADAPT_WIDEST) a group laid side by side stacks; a row or a
// grid of three alike items or more flows in two columns there instead (the group's other regions, a header over the
// cards, take a whole row), and stacks at the phone breakpoint (the narrowest). A group the person reflowed or kept as
// drawn at a width (or a wider one) keeps that choice there.
const ADAPT_WIDEST = 1024;

export interface Adaptation {
  readonly tablet: number | null;
  readonly phone: number | null;
}

export function adaptationFor(breakpoints: readonly ProjectBreakpoint[]): Adaptation {
  const narrower = breakpoints.filter((b) => !b.base).sort((a, b) => b.maxWidth - a.maxWidth);
  const tablet = narrower.find((b) => b.maxWidth <= ADAPT_WIDEST) ?? null;
  const phone = tablet === null ? null : (narrower.filter((b) => b.maxWidth < tablet.maxWidth).at(-1) ?? null);
  return { tablet: tablet?.maxWidth ?? null, phone: phone?.maxWidth ?? null };
}

// Whether a group's regions stand side by side somewhere (two of them share some height): a column of regions one
// under the other needs no reflow.
function sideBySide(held: readonly Region[]): boolean {
  return held.some((a, i) => held.some((b, j) => j > i && Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y) > 4));
}

// Three regions or more side by side on one row, as tall as one another (a quarter apart at most) whatever their
// widths: items a tablet flows in two columns like alike cards. The longest such row of the group.
function rowOfThree(held: readonly Region[]): { readonly regions: readonly string[] } | undefined {
  const rows = held.map((a) => held.filter((b) => Math.abs(b.box.y - a.box.y) <= 8 && Math.abs(b.box.height - a.box.height) <= Math.max(a.box.height, b.box.height) * 0.25));
  const longest = rows.filter((row) => row.length >= 3).sort((a, b) => b.length - a.length)[0];
  return longest === undefined ? undefined : { regions: longest.map((r) => r.id) };
}

const columnsOf = (rule: ResponsiveRule, key: string): number | undefined => (key === ROOT_KEY ? rule.columns : rule.groups?.[key]?.columns);

// The intent with the automatic behaviour added to its rules: what the compiler writes and the widths check measures.
// The intent the container keeps holds only what the person chose.
export function withAdaptation(graph: LayoutIntent, adaptation: Adaptation): LayoutIntent {
  if (adaptation.tablet === null) return graph;
  const found = patterns(graph);
  let rules = [...graph.responsive];
  const chosen = (key: string, width: number) => graph.responsive.some((r) => r.maxWidth >= width - 0.5 && (columnsOf(r, key) !== undefined || r.kept?.includes(key) === true));
  const add = (width: number, key: string, columns: number, wide: readonly string[] = []) => {
    const at = rules.findIndex((r) => Math.abs(r.maxWidth - width) < 0.5);
    const held: ResponsiveRule = at >= 0 ? (rules[at] as ResponsiveRule) : { id: `auto-${width}`, maxWidth: width, hidden: [] };
    const spans = wide.length === 0 ? {} : { wide: [...wide] };
    const rule: ResponsiveRule = key === ROOT_KEY ? (held.columns === undefined ? { ...held, columns, ...spans } : held) : held.groups?.[key] !== undefined ? held : { ...held, groups: { ...held.groups, [key]: { columns, ...spans } } };
    rules = at >= 0 ? rules.map((r, i) => (i === at ? rule : r)) : [...rules, rule];
  };
  const parents: (string | null)[] = [null, ...graph.regions.filter((r) => childrenOf(graph, r.id).length >= 2).map((r) => r.id)];
  for (const parent of parents) {
    const held = childrenOf(graph, parent);
    if (held.length < 2 || !sideBySide(held)) continue;
    const key = preferenceKey(parent);
    // the alike items among the group: all of it (cards alone), or a part of it (cards between a header and a footer)
    const alike = found.filter((p) => p.parent === parent && p.regions.length >= 3 && (p.kind === 'repeated-row' || p.kind === 'grid')).sort((a, b) => b.regions.length - a.regions.length)[0];
    const cards = alike ?? rowOfThree(held);
    const wide = cards === undefined ? [] : held.filter((r) => !cards.regions.includes(r.id)).map((r) => r.id);
    if (!chosen(key, adaptation.tablet)) add(adaptation.tablet, key, cards !== undefined ? 2 : 1, wide);
    if (cards !== undefined && adaptation.phone !== null && !chosen(key, adaptation.phone)) add(adaptation.phone, key, 1);
  }
  return rules.length === graph.responsive.length && rules.every((r, i) => r === graph.responsive[i]) ? graph : { ...graph, responsive: rules };
}

// A value that changes continuously with the width (spec "Responsive Morphing"): its value at the authoring width and
// its overrides at narrower breakpoints become control points, so the jumps between breakpoints become one fluid curve.
export function morphFrom(graph: LayoutIntent, region: string | null, property: MorphProperty, points: readonly MorphPoint[]): Operation {
  if (region !== null && findRegion(graph, region) === undefined) refuse('unknown-region', { region });
  const sorted = [...points].sort((a, b) => a.width - b.width);
  if (sorted.length < 2 || sorted.some((p, i) => i > 0 && p.width <= (sorted[i - 1] as MorphPoint).width)) refuse('morph', { morph: '' });
  const held = (graph.morphs ?? []).find((m) => m.region === region && m.property === property);
  return { kind: 'morph', morph: { id: held?.id ?? nextMorphId(graph), region, property, points: sorted } };
}

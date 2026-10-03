// Layout variables (spec "Layout Variables"): a length several places share by name (pageMargin, cardGap). Changing
// one place offers "change this" (that place keeps its own number) or "change all using cardGap" (the variable
// changes); a value can become a variable that other places then name.
import type { LayoutIntent, LayoutValue } from './model.ts';
import { findRegion } from './model.ts';
import { refuse } from './problems.ts';
import { resolveValue } from '../constraints/solve.ts';
import type { Operation } from '../gestures/operations.ts';
import { isIdentifier } from '../../../editor/host.ts';

// A place that holds a length: a constraint's value (a gap, a fixed size) or a region's padding.
export type ValueRef = { readonly kind: 'constraint'; readonly id: string } | { readonly kind: 'padding'; readonly region: string };

export const refText = (ref: ValueRef): string => (ref.kind === 'constraint' ? `constraint:${ref.id}` : `padding:${ref.region}`);
export function refOf(text: string): ValueRef | null {
  const [kind, id] = text.split(':');
  if (id === undefined || id === '') return null;
  return kind === 'constraint' ? { kind, id } : kind === 'padding' ? { kind, region: id } : null;
}

export function valueAt(graph: LayoutIntent, ref: ValueRef): LayoutValue | undefined {
  if (ref.kind === 'padding') return findRegion(graph, ref.region)?.layout?.padding;
  const c = graph.constraints.find((one) => one.id === ref.id);
  return c !== undefined && 'value' in c ? c.value : undefined;
}

// Every place that names a variable.
export function usages(graph: LayoutIntent, name: string): ValueRef[] {
  const refs: ValueRef[] = [];
  for (const c of graph.constraints) if ('value' in c && c.value === name) refs.push({ kind: 'constraint', id: c.id });
  for (const r of graph.regions) if (r.layout?.padding === name) refs.push({ kind: 'padding', region: r.id });
  return refs;
}

function writeAt(graph: LayoutIntent, ref: ValueRef, value: LayoutValue): Operation {
  if (ref.kind === 'padding') {
    const r = findRegion(graph, ref.region) ?? refuse('unknown-region', { region: ref.region });
    return { kind: 'configure', id: r.id, values: { layout: { ...r.layout, padding: value } } };
  }
  const c = graph.constraints.find((one) => one.id === ref.id) ?? refuse('orphan-constraint', { constraint: ref.id });
  if (!('value' in c) || c.kind === 'ratio') refuse('constraint-value', { constraint: c.id });
  return { kind: 'constraint', constraint: { ...c, value } };
}

// A length typed at one place: "all" changes the variable the place names (every place that names it follows), "this"
// gives the place its own number and leaves the variable alone.
export function editValue(graph: LayoutIntent, ref: ValueRef, value: number, scope: 'this' | 'all'): Operation {
  if (!Number.isFinite(value) || value < 0) refuse('constraint-value', { constraint: refText(ref) });
  const held = valueAt(graph, ref);
  if (scope === 'all' && typeof held === 'string') return { kind: 'variable', name: held, value };
  return writeAt(graph, ref, value);
}

// A place's length becomes a variable of that name, holding the length the place resolves to now.
export function bindVariable(graph: LayoutIntent, ref: ValueRef, name: string): Operation {
  // the variables' one naming rule is the design tokens' (a variable can be written as the token of its name)
  if (!isIdentifier(name)) refuse('variable', { name });
  const held = valueAt(graph, ref);
  if (held === undefined) refuse('constraint-value', { constraint: refText(ref) });
  const now = resolveValue(graph, held);
  const define: Operation[] = name in graph.variables ? [] : [{ kind: 'variable', name, value: now }];
  return { kind: 'compose', operations: [...define, writeAt(graph, ref, name)] };
}

// A variable removed: every place that names it keeps the length it holds now.
export function removeVariable(graph: LayoutIntent, name: string): Operation {
  const value = graph.variables[name];
  if (value === undefined) refuse('unknown-variable', { name });
  return { kind: 'compose', operations: [...usages(graph, name).map((ref) => writeAt(graph, ref, value)), { kind: 'remove-variable', name }] };
}

// The widths of a captured page reconciled into one tree (docs/CAPTURE-IMPORTER-ARCHITECTURE.md, Merge). Each width is
// a fresh navigation: what a person sees when they open the site at that width. Widest first, every next width's tree
// is matched against the tree so far, list by list: two siblings correspond when their kind, namespace, tag, id and
// classes agree (a longest common subsequence over the two child lists), then, inside the gaps that pass left, when
// kind, namespace, tag and id agree (classes and text may differ). A matched node records its values at that width; a
// node the width lacks is absent there; a node only that width has joins the tree after its matched predecessor and is
// absent at every other width. Projecting the result at any observed width gives back exactly that width's tree.
import type { CapturedAt, CapturedAttribute, CapturedElement, CapturedNode, CapturedState, CapturedWidth } from '../document/captured.ts';
import type { IdGenerator } from '../ports/ids.ts';

export interface Observation {
  readonly width: number;
  readonly root: CapturedElement;
}

interface Seen {
  readonly attributes: readonly CapturedAttribute[];
  readonly value: string;
  readonly state: CapturedState | undefined;
}

interface Draft {
  readonly kind: CapturedNode['kind'];
  readonly namespace: string;
  readonly tag: string;
  readonly seen: Map<number, Seen>;
  children: Draft[];
  shadow: { readonly mode: 'open' | 'closed'; children: Draft[] } | null;
  // the width whose values matching compares with: the narrowest width it was seen at so far
  last: number;
}

const valuesOf = (node: CapturedNode): Seen => node.kind === 'element'
  ? { attributes: node.attributes, value: '', state: node.state }
  : { attributes: [], value: node.value, state: undefined };

function draftOf(node: CapturedNode, width: number): Draft {
  const element = node.kind === 'element' ? node : null;
  return {
    kind: node.kind,
    namespace: element?.namespace ?? '',
    tag: element?.tag ?? '',
    seen: new Map([[width, valuesOf(node)]]),
    children: element === null ? [] : element.children.map((child) => draftOf(child, width)),
    shadow: element?.shadow === undefined ? null : { mode: element.shadow.mode, children: element.shadow.children.map((child) => draftOf(child, width)) },
    last: width,
  };
}

const attribute = (attributes: readonly CapturedAttribute[], name: string): string => attributes.find((one) => one.name === name && one.namespace === null)?.value ?? '';
const classes = (attributes: readonly CapturedAttribute[]): string => attribute(attributes, 'class').split(/\s+/).filter((one) => one !== '').sort().join(' ');

function keyOf(kind: CapturedNode['kind'], namespace: string, tag: string, seen: Seen, exact: boolean): string {
  if (kind === 'text') return exact ? `t|${seen.value}` : 't';
  if (kind === 'comment') return exact ? `c|${seen.value}` : 'c';
  const base = `e|${namespace}|${tag}|#${attribute(seen.attributes, 'id')}`;
  return exact ? `${base}|.${classes(seen.attributes)}` : base;
}
const draftKey = (draft: Draft, exact: boolean): string => keyOf(draft.kind, draft.namespace, draft.tag, draft.seen.get(draft.last) as Seen, exact);
const nodeKey = (node: CapturedNode, exact: boolean): string => node.kind === 'element'
  ? keyOf('element', node.namespace, node.tag, valuesOf(node), exact)
  : keyOf(node.kind, '', '', valuesOf(node), exact);

// The pairs [i, j] of a longest common subsequence of a[from..to) and b[from..to) by equal keys, in order. A common
// head and tail are paired first, so identical lists cost nothing.
function common(a: readonly string[], b: readonly string[], aFrom: number, aTo: number, bFrom: number, bTo: number): [number, number][] {
  const head: [number, number][] = [];
  while (aFrom < aTo && bFrom < bTo && a[aFrom] === b[bFrom]) head.push([aFrom++, bFrom++]);
  const tail: [number, number][] = [];
  while (aFrom < aTo && bFrom < bTo && a[aTo - 1] === b[bTo - 1]) tail.unshift([--aTo, --bTo]);
  const rows = aTo - aFrom;
  const columns = bTo - bFrom;
  if (rows === 0 || columns === 0) return [...head, ...tail];
  // A list of thousands of siblings at both widths would need a table of rows × columns: past a few million cells the
  // pairs are taken in order instead, each key matched with its next occurrence (linear, never fewer than none).
  if (rows * columns > 4_000_000) {
    const next = new Map<string, number[]>();
    for (let j = bTo - 1; j >= bFrom; j -= 1) {
      const key = b[j] as string;
      next.set(key, [...(next.get(key) ?? []), j]);
    }
    const greedy: [number, number][] = [];
    let after = bFrom;
    for (let i = aFrom; i < aTo; i += 1) {
      const positions = next.get(a[i] as string);
      while (positions !== undefined && positions.length > 0 && (positions.at(-1) as number) < after) positions.pop();
      const j = positions?.pop();
      if (j === undefined) continue;
      greedy.push([i, j]);
      after = j + 1;
    }
    return [...head, ...greedy, ...tail];
  }
  const lengths = new Uint32Array((rows + 1) * (columns + 1));
  const at = (i: number, j: number): number => lengths[i * (columns + 1) + j] ?? 0;
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * (columns + 1) + j] = a[aFrom + i] === b[bFrom + j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const middle: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (a[aFrom + i] === b[bFrom + j]) {
      middle.push([aFrom + i, bFrom + j]);
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) i += 1;
    else j += 1;
  }
  return [...head, ...middle, ...tail];
}

function mergeList(drafts: Draft[], nodes: readonly CapturedNode[], width: number): Draft[] {
  const exactPairs = common(drafts.map((one) => draftKey(one, true)), nodes.map((one) => nodeKey(one, true)), 0, drafts.length, 0, nodes.length);
  const looseDrafts = drafts.map((one) => draftKey(one, false));
  const looseNodes = nodes.map((one) => nodeKey(one, false));
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...exactPairs, [drafts.length, nodes.length] as [number, number]]) {
    pairs.push(...common(looseDrafts, looseNodes, i, pi, j, pj));
    if (pi < drafts.length) pairs.push([pi, pj]);
    i = pi + 1;
    j = pj + 1;
  }
  const merged: Draft[] = [];
  let di = 0;
  let nj = 0;
  for (const [pi, pj] of [...pairs, [drafts.length, nodes.length] as [number, number]]) {
    // the gap: what the tree had (now absent at this width), then what only this width has
    while (di < pi) merged.push(drafts[di++] as Draft);
    while (nj < pj) merged.push(draftOf(nodes[nj++] as CapturedNode, width));
    if (pi < drafts.length) {
      merged.push(reconcile(drafts[pi] as Draft, nodes[pj] as CapturedNode, width));
      di = pi + 1;
      nj = pj + 1;
    }
  }
  return merged;
}

function reconcile(draft: Draft, node: CapturedNode, width: number): Draft {
  draft.seen.set(width, valuesOf(node));
  draft.last = width;
  if (node.kind !== 'element') return draft;
  draft.children = mergeList(draft.children, node.children, width);
  if (node.shadow !== undefined) {
    if (draft.shadow === null) draft.shadow = { mode: node.shadow.mode, children: node.shadow.children.map((child) => draftOf(child, width)) };
    else draft.shadow.children = mergeList(draft.shadow.children, node.shadow.children, width);
  }
  return draft;
}

const sameAttributes = (a: readonly CapturedAttribute[], b: readonly CapturedAttribute[]): boolean =>
  a.length === b.length && a.every((one) => b.some((other) => other.name === one.name && other.namespace === one.namespace && other.value === one.value));
const sameState = (a: CapturedState | undefined, b: CapturedState | undefined): boolean => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

function finish(draft: Draft, widths: readonly number[], ids: IdGenerator): CapturedNode {
  const present = widths.filter((width) => draft.seen.has(width));
  const own = draft.seen.get(present[0] as number) as Seen;
  const at: Record<string, CapturedWidth> = {};
  for (const width of widths) {
    const there = draft.seen.get(width);
    if (there === undefined) {
      at[String(width)] = { absent: true };
      continue;
    }
    const variant: { -readonly [K in keyof CapturedWidth]: CapturedWidth[K] } = {};
    if (draft.kind === 'element' && !sameAttributes(there.attributes, own.attributes)) variant.attributes = there.attributes;
    if (draft.kind !== 'element' && there.value !== own.value) variant.value = there.value;
    if (draft.kind === 'element' && !sameState(there.state, own.state)) variant.state = there.state ?? {};
    if (Object.keys(variant).length > 0) at[String(width)] = variant;
  }
  const differences: CapturedAt | undefined = Object.keys(at).length === 0 ? undefined : at;
  const id = ids.next();
  if (draft.kind !== 'element') return { kind: draft.kind, id, value: own.value, ...(differences === undefined ? {} : { at: differences }) };
  return {
    kind: 'element', id, namespace: draft.namespace, tag: draft.tag, attributes: own.attributes,
    children: draft.children.map((child) => finish(child, widths, ids)),
    ...(draft.shadow === null ? {} : { shadow: { mode: draft.shadow.mode, children: draft.shadow.children.map((child) => finish(child, widths, ids)) } }),
    ...(own.state === undefined ? {} : { state: own.state }),
    ...(differences === undefined ? {} : { at: differences }),
  };
}

// One tree from the observations of a page, widest first in the result's `widths`.
export function mergeWidths(observations: readonly Observation[], ids: IdGenerator): { readonly widths: readonly number[]; readonly root: CapturedElement } {
  const ordered = [...observations].sort((a, b) => b.width - a.width);
  const first = ordered[0];
  if (first === undefined) throw new Error('a capture needs one observed width');
  if (new Set(ordered.map((one) => one.width)).size !== ordered.length) throw new Error('each observed width is captured once');
  const root = draftOf(first.root, first.width);
  for (const next of ordered.slice(1)) reconcile(root, next.root, next.width);
  const widths = ordered.map((one) => one.width);
  return { widths, root: finish(root, widths, ids) as CapturedElement };
}

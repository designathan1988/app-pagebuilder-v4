// What the Layout Composer keeps on the document (core/document/authoring.ts, namespace "layout-composer"):
//  - on the composed container, its record: the Layout Intent Graph the person built, so the container reopens as it
//    was drawn (spec "Reedição");
//  - on every element the composer placed or wrote, a marker: the key of the compiled node it stands for (a region id,
//    a wrapper's group key) and the declarations the compiler wrote on it, by breakpoint, so a later compilation takes
//    back exactly what it wrote and never touches the person's own styles (spec "Integração com estilos").
// No node id is stored: an element is found by its marker inside the container, so duplicating or copying the
// container copies a record that still holds together.
import type { DocNode, JsonValue } from '../../../editor/host.ts';
import type { LayoutIntent } from '../intent/model.ts';
import { validateIntent } from '../topology/topology.ts';

export const NAMESPACE = 'layout-composer';

// The declarations the compiler wrote on an element, property ids by breakpoint id (at the base state).
export type Owned = Readonly<Record<string, readonly string[]>>;

export interface ContainerRecord {
  readonly role: 'container';
  readonly version: 1;
  readonly intent: LayoutIntent;
  readonly owns: Owned;
}

export interface NodeMarker {
  readonly role: 'node';
  readonly key: string;
  readonly owns: Owned;
  // an element the composer made for a region or a wrapper; absent on an element of the page the layout places
  readonly kind?: 'structural';
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

const ownedProblem = (owns: unknown): string | null => {
  if (!isObject(owns)) return 'owns is an object of property lists by breakpoint';
  for (const list of Object.values(owns)) if (!Array.isArray(list) || !list.every((p) => typeof p === 'string')) return 'owns lists property ids';
  return null;
};

// The validator the document validator calls for this namespace (registered by registration.ts).
export function recordProblem(value: JsonValue): string | null {
  if (!isObject(value)) return 'the Layout Composer keeps an object';
  const owned = ownedProblem(value.owns);
  if (owned !== null) return owned;
  if (value.role === 'node') return typeof value.key === 'string' && value.key !== '' ? null : 'a marker names its compiled key';
  if (value.role !== 'container') return 'a Layout Composer record is a container record or a marker';
  if (value.version !== 1 || !isObject(value.intent)) return 'a container record holds a version-1 intent';
  try {
    const problems = validateIntent(value.intent as unknown as LayoutIntent);
    return problems.length === 0 ? null : `the saved layout is not valid (${problems.map((p) => p.code).join(', ')})`;
  } catch {
    return 'the saved layout is not a layout intent';
  }
}

export const recordOf = (node: DocNode): ContainerRecord | null => {
  const value = node.authoring?.[NAMESPACE];
  return isObject(value) && value.role === 'container' ? (value as unknown as ContainerRecord) : null;
};

export const markerOf = (node: DocNode): NodeMarker | null => {
  const value = node.authoring?.[NAMESPACE];
  return isObject(value) && value.role === 'node' ? (value as unknown as NodeMarker) : null;
};

// The node's authoring data with this namespace set to a value, or taken away (null).
export function withAuthoring(node: DocNode, value: ContainerRecord | NodeMarker | null): DocNode {
  const { [NAMESPACE]: _dropped, ...others } = node.authoring ?? {};
  void _dropped;
  const authoring = value === null ? others : { ...others, [NAMESPACE]: value as unknown as JsonValue };
  const { authoring: _old, ...rest } = node;
  void _old;
  return Object.keys(authoring).length === 0 ? rest : { ...rest, authoring };
}

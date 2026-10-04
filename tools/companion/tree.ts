// Changes over an observed or captured tree (tools/companion/serialize.ts, src/core/document/captured.ts): the
// capture localizes resources, links and stylesheets on attribute values and placeholder comments, never by replacing
// text in markup. A node's per-width attribute lists (`at`) are mapped as its own.
import type { CapturedAttribute, CapturedElement, CapturedNode } from '../../src/core/document/captured.ts';

const HTML = 'http://www.w3.org/1999/xhtml';

export interface TreeChanges {
  // an attribute's new value (the element's tag and the attribute's name given)
  readonly attribute?: (value: string, name: string, tag: string) => string;
  // a comment's replacement: itself, another node, or nothing
  readonly comment?: (node: Extract<CapturedNode, { readonly kind: 'comment' }>) => CapturedNode | null;
}

export function mapTree<T extends CapturedElement>(root: T, changes: TreeChanges): T {
  const attributes = (list: readonly CapturedAttribute[], tag: string): readonly CapturedAttribute[] =>
    changes.attribute === undefined ? list : list.map((one) => ({ ...one, value: changes.attribute?.(one.value, one.name, tag) ?? one.value }));
  const visit = (node: CapturedNode): CapturedNode | null => {
    if (node.kind === 'comment') return changes.comment === undefined ? node : changes.comment(node);
    if (node.kind === 'text') return node;
    const at = node.at === undefined ? undefined : Object.fromEntries(Object.entries(node.at).map(([width, variant]) => [width, variant.attributes === undefined ? variant : { ...variant, attributes: attributes(variant.attributes, node.tag) }]));
    return {
      ...node,
      attributes: attributes(node.attributes, node.tag),
      children: node.children.flatMap((child) => visit(child) ?? []),
      ...(node.shadow === undefined ? {} : { shadow: { ...node.shadow, children: node.shadow.children.flatMap((child) => visit(child) ?? []) } }),
      ...(at === undefined ? {} : { at }),
    };
  };
  return visit(root) as T;
}

// every value an attribute of the tree holds, per-width lists included
export function attributeValues(root: CapturedNode): string[] {
  if (root.kind !== 'element') return [];
  return [
    ...root.attributes.map((one) => one.value),
    ...Object.values(root.at ?? {}).flatMap((variant) => (variant.attributes ?? []).map((one) => one.value)),
    ...root.children.flatMap(attributeValues),
    ...(root.shadow?.children ?? []).flatMap(attributeValues),
  ];
}

// the root with nodes put first in its <head>
export function prependToHead<T extends CapturedElement>(root: T, nodes: readonly CapturedNode[]): T {
  return { ...root, children: root.children.map((child) => (child.kind === 'element' && child.tag === 'head' && child.namespace === HTML ? { ...child, children: [...nodes, ...child.children] } : child)) };
}

export const element = (id: string, tag: string, attributes: Readonly<Record<string, string>>): CapturedElement => ({
  kind: 'element', id, namespace: HTML, tag, attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: null, value })), children: [],
});

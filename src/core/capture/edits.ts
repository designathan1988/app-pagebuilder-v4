// Captured-page edits are JSON transactions over the one tree (every observed width) used by canvas and export.
// They never make a second authored-node projection of the captured document.
import { message, registerHandler } from '../commands/registry.ts';
import { captureTree, unsafeCapturedAttribute, type CapturedAt, type CapturedAttribute, type CapturedElement, type CapturedNode, type CapturedWidth } from '../document/captured.ts';
import type { DocumentJson } from '../document/model.ts';

export interface CapturedLocation {
  readonly page: number;
  readonly node: CapturedNode;
  readonly path: readonly number[];
}

// the children of an element, its shadow root's first (a node is found and changed wherever it is in the tree)
const inside = (node: CapturedElement): readonly CapturedNode[] => [...(node.shadow?.children ?? []), ...node.children];

export function findCaptured(document: DocumentJson, id: string): CapturedLocation | null {
  for (const [page, entry] of document.pages.entries()) {
    if (entry.capture === undefined) continue;
    const visit = (node: CapturedNode, path: readonly number[]): CapturedLocation | null => {
      if (node.id === id) return { page, node, path };
      if (node.kind !== 'element') return null;
      for (const [index, child] of inside(node).entries()) {
        const found = visit(child, [...path, index]);
        if (found !== null) return found;
      }
      return null;
    };
    const found = visit(entry.capture.root, []);
    if (found !== null) return found;
  }
  return null;
}

function mapChildren(node: CapturedElement, map: (children: readonly CapturedNode[]) => readonly CapturedNode[]): CapturedElement {
  const children = map(node.children);
  const shadowChildren = node.shadow === undefined ? undefined : map(node.shadow.children);
  const sameList = (a: readonly CapturedNode[], b: readonly CapturedNode[]): boolean => a.length === b.length && a.every((child, index) => child === b[index]);
  if (sameList(children, node.children) && (node.shadow === undefined || shadowChildren === undefined || sameList(shadowChildren, node.shadow.children))) return node;
  return { ...node, children, ...(node.shadow === undefined || shadowChildren === undefined ? {} : { shadow: { ...node.shadow, children: shadowChildren } }) };
}

function replaceNode(root: CapturedNode, id: string, update: (node: CapturedNode) => CapturedNode): CapturedNode {
  if (root.id === id) return update(root);
  if (root.kind !== 'element') return root;
  return mapChildren(root, (children) => children.map((child) => replaceNode(child, id, update)));
}

function removeNode(root: CapturedElement, id: string): CapturedElement {
  const remove = (node: CapturedNode): CapturedNode => (node.kind !== 'element' ? node : mapChildren(node, (children) => children.filter((child) => child.id !== id).map(remove)));
  return remove(root) as CapturedElement;
}

function contains(node: CapturedNode, id: string): boolean {
  return node.id === id || (node.kind === 'element' && inside(node).some((child) => contains(child, id)));
}

// An edit is the node's at every width: what it changes is changed in the node's own values and in every width's.
function withAttribute(attributes: readonly CapturedAttribute[], name: string, namespace: string | null, value: string): readonly CapturedAttribute[] {
  const at = attributes.findIndex((one) => one.name === name);
  return at < 0 ? [...attributes, { name, namespace, value }] : attributes.map((one, index) => (index === at ? { name, namespace, value } : one));
}
function everyWidth(at: CapturedAt | undefined, change: (variant: CapturedWidth) => CapturedWidth): CapturedAt | undefined {
  if (at === undefined) return undefined;
  return Object.fromEntries(Object.entries(at).map(([width, variant]) => [width, variant.absent === true ? variant : change(variant)]));
}
function withoutValue(variant: CapturedWidth): CapturedWidth {
  const kept: { -readonly [K in keyof CapturedWidth]: CapturedWidth[K] } = { ...variant };
  delete kept.value;
  return kept;
}

const NAME = /^[A-Za-z][A-Za-z0-9._:-]*$/;

export const editCaptureCommand = registerHandler('capture.edit', ({ state, ids }, { target, operation, name, value, parent, index }) => {
  const found = findCaptured(state.document, target);
  if (found === null) return { kind: 'refused', message: message('status.capture.nodeMissing') };
  const capture = state.document.pages[found.page]?.capture;
  if (capture === undefined) throw new Error('captured page disappeared during edit');
  let root: CapturedElement = capture.root;
  if (operation === 'text') {
    if (found.node.kind !== 'text' || typeof value !== 'string') return { kind: 'refused', message: message('status.capture.invalidEdit') };
    root = replaceNode(root, target, (node) => {
      if (node.kind === 'element') return node;
      const at = everyWidth(node.at, withoutValue);
      return { ...node, value, ...(at === undefined ? {} : { at }) };
    }) as CapturedElement;
  } else if (operation === 'attribute') {
    if (found.node.kind !== 'element' || typeof name !== 'string' || !NAME.test(name) || typeof value !== 'string') return { kind: 'refused', message: message('status.capture.invalidEdit') };
    if (unsafeCapturedAttribute(found.node.tag, { name, value })) return { kind: 'refused', message: message('status.capture.unsafeEdit') };
    const namespace = name.startsWith('xlink:') ? 'http://www.w3.org/1999/xlink' : null;
    root = replaceNode(root, target, (node) => {
      if (node.kind !== 'element') return node;
      const at = everyWidth(node.at, (variant) => (variant.attributes === undefined ? variant : { ...variant, attributes: withAttribute(variant.attributes, name, namespace, value) }));
      return { ...node, attributes: withAttribute(node.attributes, name, namespace, value), ...(at === undefined ? {} : { at }) };
    }) as CapturedElement;
  } else if (operation === 'remove') {
    if (found.path.length === 0) return { kind: 'refused', message: message('status.capture.invalidEdit') };
    root = removeNode(root, target);
  } else if (operation === 'insert' || operation === 'move') {
    if (typeof parent !== 'string' || typeof index !== 'number' || !Number.isInteger(index) || index < 0) return { kind: 'refused', message: message('status.capture.invalidEdit') };
    const destination = findCaptured(state.document, parent);
    if (destination === null || destination.page !== found.page || destination.node.kind !== 'element') return { kind: 'refused', message: message('status.capture.invalidEdit') };
    let inserted: readonly CapturedNode[];
    if (operation === 'move') {
      if (found.path.length === 0 || contains(found.node, parent)) return { kind: 'refused', message: message('status.capture.invalidEdit') };
      inserted = [found.node];
      root = removeNode(root, target);
    } else {
      if (typeof value !== 'string') return { kind: 'refused', message: message('status.capture.invalidEdit') };
      const parsed = captureTree('<!doctype html><html><head></head><body>' + value + '</body></html>', ids);
      const body = parsed.children.find((one): one is CapturedElement => one.kind === 'element' && one.tag === 'body');
      if (body === undefined || body.children.length === 0) return { kind: 'refused', message: message('status.capture.invalidEdit') };
      inserted = body.children;
    }
    root = replaceNode(root, parent, (node) => {
      if (node.kind !== 'element') return node;
      const children = [...node.children];
      children.splice(Math.min(index, children.length), 0, ...inserted);
      return { ...node, children };
    }) as CapturedElement;
  } else return { kind: 'refused', message: message('status.capture.invalidEdit') };
  if (root === capture.root) return { kind: 'change', message: message('status.capture.edited') };
  return { kind: 'change', patches: [{ op: 'replace', path: ['pages', found.page, 'capture', 'root'], value: root }], message: message('status.capture.edited') };
});

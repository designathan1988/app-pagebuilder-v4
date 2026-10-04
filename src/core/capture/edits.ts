// Captured-page edits are JSON transactions over the exact source tree used by canvas and export.
// They never make a second authored-node projection of the captured document.
import { message, registerHandler } from '../commands/registry.ts';
import { captureTree, unsafeCapturedAttribute, type CapturedElement, type CapturedNode } from '../document/captured.ts';
import type { DocumentJson } from '../document/model.ts';

export interface CapturedLocation {
  readonly page: number;
  readonly viewport: number;
  readonly node: CapturedNode;
  readonly path: readonly number[];
}

export function findCaptured(document: DocumentJson, id: string): CapturedLocation | null {
  for (const [page, entry] of document.pages.entries()) for (const [viewport, variant] of (entry.capture?.viewports ?? []).entries()) {
    const visit = (node: CapturedNode, path: readonly number[]): CapturedLocation | null => {
      if (node.id === id) return { page, viewport, node, path };
      if (node.kind !== 'element') return null;
      for (const [index, child] of node.children.entries()) {
        const found = visit(child, [...path, index]);
        if (found !== null) return found;
      }
      return null;
    };
    const found = visit(variant.root, []);
    if (found !== null) return found;
  }
  return null;
}

function replaceNode(root: CapturedNode, id: string, update: (node: CapturedNode) => CapturedNode): CapturedNode {
  if (root.id === id) return update(root);
  if (root.kind !== 'element') return root;
  const children = root.children.map((child) => replaceNode(child, id, update));
  return children.some((child, index) => child !== root.children[index]) ? { ...root, children } : root;
}

function removeNode(root: CapturedElement, id: string): CapturedElement {
  return replaceNode(root, root.id, (top) => {
    const remove = (node: CapturedNode): CapturedNode => {
      if (node.kind !== 'element') return node;
      const children = node.children.filter((child) => child.id !== id).map(remove);
      return children.length !== node.children.length || children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node;
    };
    return remove(top);
  }) as CapturedElement;
}

function contains(node: CapturedNode, id: string): boolean {
  return node.id === id || (node.kind === 'element' && node.children.some((child) => contains(child, id)));
}

const NAME = /^[A-Za-z][A-Za-z0-9._:-]*$/;

export const editCaptureCommand = registerHandler('capture.edit', ({ state, ids }, { target, operation, name, value, parent, index }) => {
  const found = findCaptured(state.document, target);
  if (found === null) return { kind: 'refused', message: message('status.capture.nodeMissing') };
  const variant = state.document.pages[found.page]?.capture?.viewports[found.viewport];
  if (variant === undefined) throw new Error('captured viewport disappeared during edit');
  let root: CapturedElement = variant.root;
  if (operation === 'text') {
    if (found.node.kind !== 'text' || typeof value !== 'string') return { kind: 'refused', message: message('status.capture.invalidEdit') };
    root = replaceNode(root, target, (node) => ({ ...node, value })) as CapturedElement;
  } else if (operation === 'attribute') {
    if (found.node.kind !== 'element' || typeof name !== 'string' || !NAME.test(name) || typeof value !== 'string') return { kind: 'refused', message: message('status.capture.invalidEdit') };
    if (unsafeCapturedAttribute(found.node.tag, { name, value })) return { kind: 'refused', message: message('status.capture.unsafeEdit') };
    root = replaceNode(root, target, (node) => {
      if (node.kind !== 'element') return node;
      const namespace = name.startsWith('xlink:') ? 'http://www.w3.org/1999/xlink' : null;
      const attributes = [...node.attributes];
      const at = attributes.findIndex((one) => one.name === name);
      if (at < 0) attributes.push({ name, namespace, value });
      else attributes[at] = { name, namespace, value };
      return { ...node, attributes };
    }) as CapturedElement;
  } else if (operation === 'remove') {
    if (found.path.length === 0) return { kind: 'refused', message: message('status.capture.invalidEdit') };
    root = removeNode(root, target);
  } else if (operation === 'insert' || operation === 'move') {
    if (typeof parent !== 'string' || typeof index !== 'number' || !Number.isInteger(index) || index < 0) return { kind: 'refused', message: message('status.capture.invalidEdit') };
    const destination = findCaptured(state.document, parent);
    if (destination === null || destination.page !== found.page || destination.viewport !== found.viewport || destination.node.kind !== 'element') return { kind: 'refused', message: message('status.capture.invalidEdit') };
    let inserted: readonly CapturedNode[];
    if (operation === 'move') {
      if (found.path.length === 0 || contains(found.node, parent)) return { kind: 'refused', message: message('status.capture.invalidEdit') };
      inserted = [found.node];
      root = removeNode(root, target);
    } else {
      if (typeof value !== 'string') return { kind: 'refused', message: message('status.capture.invalidEdit') };
      const parsed = captureTree(`<!doctype html><html><head></head><body>${value}</body></html>`, ids);
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
  if (root === variant.root) return { kind: 'change', message: message('status.capture.edited') };
  return { kind: 'change', patches: [{ op: 'replace', path: ['pages', found.page, 'capture', 'viewports', found.viewport, 'root'], value: root }], message: message('status.capture.edited') };
});

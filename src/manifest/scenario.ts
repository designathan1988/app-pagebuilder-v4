// The scenario data (PRODUCT.md §5): how a scenario names the nodes and fields of a document, and how its
// document diff applies. manifest:check proves every path of every scenario resolves; the runner
// (tools/runner/scenarios.ts) resolves the same paths in the document the test port reads and compares the result
// with matchDocument. Plain TypeScript, no DOM.
//
// Grammar. A node path is the node names from the fixture's root: "/Page/Section/Heading" names the child
// "Heading" of the child "Section" of the page root "Page"; each name names exactly one node. A document path may
// go on into a field of that node after "/@": "/Page/Section/@styles/desktop/base/padding-top". A node value (the
// value of a node path, of @children, or a child inside them) omits id, because ids are generated; its children
// array gives their order. A new node appears through the value of its parent or of its parent's @children.
import { createEmptyDocument, type DocumentJson } from '../core/document/model.ts';
import { sequentialIds } from '../core/ports/ids.ts';
import { motionStandIns } from '../core/motion/document.ts';
import type { ElementType } from '../generated/ids.ts';

export interface DocumentPath {
  readonly nodes: readonly string[];
  // the field of the node and the keys inside it, or null for the node itself
  readonly field: readonly string[] | null;
}

// the fields of a node a path may name; id is generated, so never named. locked, hidden (true, absent when off) and
// inline (the runs of inline marks) arrive with the lock, hide and inline formatting features of group 02.
export const NODE_FIELDS = ['type', 'name', 'tag', 'attributes', 'classes', 'styles', 'text', 'children', 'locked', 'hidden', 'inline', 'customAttributes', 'component', 'componentPart', 'guides', 'grid', 'layerColors', 'animations', 'interactions', 'motions', 'behaviours', 'authoring', 'bind', 'dataList', 'dataItem'] as const;
// the fields of the project itself a diff names with no node path ("/@swatches"): the saved colours and the design
// tokens, and the project's document and code languages (model.ts)
export const DOCUMENT_FIELDS = ['pages', 'swatches', 'tokens', 'classes', 'components', 'files', 'folders', 'motionTimelines', 'language', 'codeLanguage', 'collections', 'breakpoints'] as const;

// The id a fixture file names: manifest/features/fixtures/<id>.json. "empty" has no file.
export const EMPTY_FIXTURE = 'empty';
export const FIXTURE_FILE = /^features\/fixtures\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

export function parsePath(path: string): DocumentPath {
  const parts = path.replace(/^\//, '').split('/');
  const at = parts.findIndex((part) => part.startsWith('@'));
  if (at < 0) return { nodes: parts, field: null };
  return { nodes: parts.slice(0, at), field: [(parts[at] ?? '').slice(1), ...parts.slice(at + 1)] };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
// a node as a scenario sees it: an expected node may lack its id
export type LooseNode = JsonObject & { name?: Json; children?: Json };

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const childrenOf = (node: JsonObject): JsonObject[] => (Array.isArray(node.children) ? node.children.filter(isObject) : []);

export interface Resolved {
  readonly node: JsonObject;
  // null for a page's root
  readonly parent: JsonObject | null;
  readonly index: number;
  readonly page: number;
}

// The node a node path names, or why it names none or several.
export function resolveNode(document: unknown, nodes: readonly string[]): Resolved | string {
  const pages = isObject(document) && Array.isArray(document.pages) ? document.pages.filter(isObject) : [];
  const [rootName, ...rest] = nodes;
  const roots = pages.map((page, i) => ({ tree: page.tree, i })).filter((p): p is { tree: JsonObject; i: number } => isObject(p.tree) && p.tree.name === rootName);
  if (roots.length === 0) return `no page's root is named "${rootName ?? ''}"`;
  if (roots.length > 1) return `${roots.length} pages have a root named "${rootName ?? ''}": a node path names one node`;
  const root = roots[0] as { tree: JsonObject; i: number };
  let at: Resolved = { node: root.tree, parent: null, index: 0, page: root.i };
  let named = `/${rootName ?? ''}`;
  for (const name of rest) {
    const children = childrenOf(at.node);
    const matches = children.map((child, index) => ({ child, index })).filter((c) => c.child.name === name);
    if (matches.length === 0) return `${named} has no child named "${name}"`;
    if (matches.length > 1) return `${named} has ${matches.length} children named "${name}": a node path names one node`;
    const match = matches[0] as { child: JsonObject; index: number };
    at = { node: match.child, parent: at.node, index: match.index, page: at.page };
    named = `${named}/${name}`;
  }
  return at;
}

// A node value has no id, and neither has any node inside it.
function idInNodeValue(value: Json): string | null {
  if (!isObject(value)) return 'a node value is an object';
  if ('id' in value) return 'a node value omits id: ids are generated';
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) return 'children is a list of node values';
    for (const child of value.children) {
      const problem = idInNodeValue(child);
      if (problem !== null) return problem;
    }
  }
  return null;
}

export type DiffOp = { readonly op: 'set'; readonly path: string; readonly value: unknown } | { readonly op: 'remove'; readonly path: string };

export interface DiffResult {
  readonly document: unknown;
  // the first operation that does not apply, with why
  readonly error: { readonly index: number; readonly message: string } | null;
}

// Applies a scenario's document diff to a document, in order, without changing the input.
export function applyDiff(document: unknown, ops: readonly DiffOp[]): DiffResult {
  const doc = structuredClone(document) as JsonObject;
  for (const [index, op] of ops.entries()) {
    const message = applyOne(doc, op);
    if (message !== null) return { document: doc, error: { index, message } };
  }
  return { document: doc, error: null };
}

function applyOne(doc: JsonObject, op: DiffOp): string | null {
  const path = parsePath(op.path);
  // a field of the project itself: set whole, or removed
  if (path.nodes.length === 0 && path.field !== null) {
    const [field, ...keys] = path.field;
    if (!(DOCUMENT_FIELDS as readonly string[]).includes(field ?? '') || keys.length > 0) return `${op.path}: "@${field ?? ''}" is not a field of the project (${DOCUMENT_FIELDS.join(', ')}), set or removed whole`;
    if (op.op === 'remove') {
      if (!((field as string) in doc)) return `${op.path}: there is nothing at this path to remove`;
      Reflect.deleteProperty(doc, field as string);
    } else doc[field as string] = structuredClone(op.value) as Json;
    return null;
  }
  const found = resolveNode(doc, path.nodes);
  if (typeof found === 'string') return `${op.path}: ${found}`;
  const { node, parent, index, page } = found;
  const value = op.op === 'set' ? (structuredClone(op.value) as Json) : null;
  if (path.field === null) {
    if (op.op === 'remove') {
      if (parent === null) return `${op.path}: a page's root is never removed`;
      (parent.children as Json[]).splice(index, 1);
      return null;
    }
    const problem = idInNodeValue(value);
    if (problem !== null) return `${op.path}: ${problem}`;
    if (parent === null) ((doc.pages as JsonObject[])[page] as JsonObject).tree = value;
    else (parent.children as Json[])[index] = value;
    return null;
  }
  const [field, ...keys] = path.field;
  if (!(NODE_FIELDS as readonly string[]).includes(field ?? '')) return `${op.path}: "@${field ?? ''}" is not a field of a node (${NODE_FIELDS.join(', ')})`;
  if (field === 'children' && keys.length === 0 && op.op === 'set') {
    if (!Array.isArray(value)) return `${op.path}: @children is a list of node values`;
    for (const child of value) {
      const problem = idInNodeValue(child);
      if (problem !== null) return `${op.path}: ${problem}`;
    }
  }
  if (field === 'children' && keys.length > 0) return `${op.path}: a child is named by its node path, not by an index into @children`;
  if (op.op === 'remove') {
    if (keys.length === 0) return `${op.path}: a field of a node is set, never removed; remove a key inside it`;
    let container: Json | undefined = node[field as string];
    for (const key of keys.slice(0, -1)) container = isObject(container) ? container[key] : undefined;
    const last = keys[keys.length - 1] as string;
    if (!isObject(container) || !(last in container)) return `${op.path}: there is nothing at this path to remove`;
    Reflect.deleteProperty(container, last);
    return null;
  }
  if (keys.length === 0) {
    node[field as string] = value;
    return null;
  }
  let container = node[field as string];
  if (container === undefined || container === null) container = node[field as string] = {};
  if (!isObject(container)) return `${op.path}: @${field ?? ''} holds no keys`;
  for (const key of keys.slice(0, -1)) {
    const next: Json | undefined = container[key];
    if (next === undefined || next === null) container = container[key] = {};
    else if (isObject(next)) container = next;
    else return `${op.path}: "${key}" holds no keys`;
  }
  container[keys[keys.length - 1] as string] = value;
  return null;
}

// Gives every node without an id a stand-in, so an expected document can be validated as a document.
export function withStandInIds(document: unknown): unknown {
  const doc = structuredClone(document) as JsonObject;
  let next = 0;
  const visit = (node: Json): void => {
    if (!isObject(node)) return;
    if (!('id' in node)) node.id = `~new-${String(++next)}`;
    for (const child of childrenOf(node)) visit(child);
  };
  for (const page of Array.isArray(doc.pages) ? doc.pages : [])
    if (isObject(page)) {
      if (!('id' in page)) page.id = `~new-page-${String(++next)}`;
      visit(page.tree ?? null);
    }
  // a component's definition is a tree of nodes too (spec reusable-components)
  for (const component of Array.isArray(doc.components) ? doc.components : []) if (isObject(component)) visit(component.tree ?? null);
  // an item of a collection is identified by an id the store generates too (spec data-collections): an expected item
  // omits it, and takes a stand-in
  for (const collection of Array.isArray(doc.collections) ? doc.collections : []) {
    for (const item of isObject(collection) && Array.isArray(collection.items) ? collection.items : []) if (isObject(item) && !('id' in item)) item.id = `~new-item-${String(++next)}`;
  }
  // a value that names a node by its path ("@/Page/Label/Input": a reference is stored by the node id, the audit's
  // A3.4) becomes that node's id here, so the model can check the document the diff makes
  const cite = (node: Json): void => {
    if (!isObject(node)) return;
    const attributes = node.attributes;
    if (isObject(attributes)) {
      for (const [name, held] of Object.entries(attributes)) {
        const fragment = typeof held === 'string' && held.startsWith('#@/');
        if (typeof held !== 'string' || (!held.startsWith('@/') && !fragment)) continue;
        const found = resolveNode(doc, held.slice(fragment ? 3 : 2).split('/').filter((each) => each !== ''));
        // what the page would write: a reference resolves to the target's id attribute (a link's "#inicio", a
        // label's "inicio"), never to the node id the document keeps
        const target = typeof found === 'string' ? null : (found.node as JsonObject);
        // a link's anchor is stored as the fragment with the node id; a label's for as the resolved id attribute
        if (fragment) {
          attributes[name] = target === null ? held : `#${String((target as JsonObject).id)}`;
          continue;
        }
        const own = target === null ? undefined : (target.attributes as JsonObject | undefined)?.id;
        if (own === undefined || own === null) {
          attributes[name] = held;
          continue;
        }
        attributes[name] = name === 'href' ? `#${String(own)}` : String(own);
      }
    }
    // an interaction's target is stored by the node id too (the validator checks it names an element: the audit's EV2)
    for (const interaction of Array.isArray(node.interactions) ? node.interactions : []) {
      if (!isObject(interaction) || typeof interaction.target !== 'string' || !interaction.target.startsWith('@/')) continue;
      const found = resolveNode(doc, interaction.target.slice(2).split('/').filter((each) => each !== ''));
      if (typeof found !== 'string') interaction.target = String(found.node.id);
    }
    for (const child of childrenOf(node)) cite(child);
  };
  for (const page of Array.isArray(doc.pages) ? doc.pages : []) if (isObject(page)) cite(page.tree ?? null);
  // the motion data's own ids and picked elements (core/motion/document.ts): a scenario names neither
  motionStandIns(doc, () => `~new-${String(++next)}`, (path) => {
    const found = resolveNode(doc, path.split('/').filter((each) => each !== ''));
    return typeof found === 'string' ? null : String(found.node.id);
  });
  return doc;
}

// The empty project of a fresh profile, as the editor creates it for a locale (names from the catalogue).
export function emptyProject(names: { readonly page: string; readonly root: string }, root: { readonly type: ElementType; readonly tag: string }): DocumentJson {
  return createEmptyDocument(sequentialIds('empty'), names, root);
}

// Where an actual document differs from an expected one. A node the expectation writes without an id matches any
// id; everything else must be equal.
export function matchDocument(actual: unknown, expected: unknown, at = ''): string[] {
  if (isObject(expected)) {
    if (!isObject(actual)) return [`${at || '/'}: expected an object, found ${JSON.stringify(actual)}`];
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const out: string[] = [];
    for (const key of keys) {
      if (key === 'id' && !('id' in expected)) continue;
      if (!(key in expected)) out.push(`${at}/${key}: not expected, found ${JSON.stringify(actual[key])}`);
      else if (!(key in actual)) out.push(`${at}/${key}: expected ${JSON.stringify(expected[key])}, missing`);
      else out.push(...matchDocument(actual[key], expected[key], `${at}/${key}`));
    }
    return out;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${at || '/'}: expected a list, found ${JSON.stringify(actual)}`];
    if (actual.length !== expected.length) return [`${at}: expected ${expected.length} items, found ${actual.length}`];
    return expected.flatMap((item, i) => matchDocument(actual[i], item, `${at}/${i}`));
  }
  return Object.is(actual, expected) ? [] : [`${at || '/'}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`];
}

// When a scenario's refusal is checked (both scenario runners, tools/runner/scenarios.ts and headless.test.ts): right
// after its refused step, the action step when its command can refuse with that key (its manifest refusals or its
// availability's refusal key), else the last step after it whose command can (a Delete refused after the action locked
// the element); that step leaves the document as it was just before it, and the status bar shows the refusal right
// after it, whatever steps follow (a held drag released after a refused level key). When no step's command declares
// the key, once the steps are over, against the document before the action.
export interface RefusingCommand {
  readonly id: string;
  readonly refusals: readonly string[];
  readonly availability: { readonly refusalKey: string | null };
}
export function refusalCheck(steps: readonly { readonly door: string; readonly action: boolean }[], key: string, commands: readonly RefusingCommand[]): { readonly after: number; readonly unchangedFrom: number } {
  const refuses = (step: { readonly door: string } | undefined) => {
    const command = step === undefined ? undefined : commands.find((c) => c.id === step.door.split('#')[0]);
    return command !== undefined && (command.refusals.includes(key) || command.availability.refusalKey === key);
  };
  const action = steps.findIndex((step) => step.action);
  if (refuses(steps[action])) return { after: action, unchangedFrom: action };
  const last = steps.findLastIndex((step, index) => index > action && refuses(step));
  return last >= 0 ? { after: last, unchangedFrom: last } : { after: steps.length - 1, unchangedFrom: action };
}

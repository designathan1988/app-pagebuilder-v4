// The references between elements (INVENTORY.md, owners; spec elements-form-inputs-rules; the user's
// real-use audit, A3.4): a label's `for` and a link's anchor point at another element of the document. One owner: a
// reference is stored as the target's node id — the internal id, never the `id` attribute the person edits — so
// renaming or re-numbering the target leaves every reference working, and what the page writes is the id attribute the
// target carries at that moment (`resolvedReference`). One rule, read by the writers (the renderer and the export), the
// validator (`orphanReferences`, which the document validator refuses a project over) and the commands that make them.
import type { DocNode, DocumentJson, NodeId } from '../document/model.ts';
import { locate, walk } from '../document/model.ts';

// the attributes that hold a reference, by their HTML name: `for` (a label's control) and `href` when its value is a
// fragment naming an element of the page ("#<node id>")
const REFERENCE_HTM = ['for', 'href'];

function referenceTarget(document: DocumentJson, value: string): DocNode | null {
  const named = value.startsWith('#') ? value.slice(1) : value;
  if (named === '') return null;
  return locate(document, named as NodeId)?.node ?? null;
}

// What the page writes for a stored value: the target's id attribute for a reference ("#cta" for a link whose anchor
// is the element with id "cta"), the value itself for anything else, and null when a reference names a node without an
// id attribute (there is nothing to point at; the validator says so).
export function resolvedReference(document: DocumentJson, value: string): string | null {
  const target = referenceTarget(document, value);
  if (target === null) return value;
  const id = target.attributes.id;
  if (id === undefined || String(id) === '') return null;
  return value.startsWith('#') ? `#${String(id)}` : String(id);
}

// The attributes of every node that hold a reference, in document order: the node, the attribute's id and the stored
// value. Read by the validator (orphans) and by the commands that keep references alive.
export function referencesOf(document: DocumentJson): readonly { readonly node: DocNode; readonly attribute: string; readonly value: string }[] {
  const found: { readonly node: DocNode; readonly attribute: string; readonly value: string }[] = [];
  for (const page of document.pages) {
    for (const node of walk(page.tree)) {
      for (const [attribute, value] of Object.entries(node.attributes)) {
        if (typeof value !== 'string' || value === '') continue;
        const html = REFERENCE_ATTRIBUTES.get(attribute);
        if (html === undefined) continue;
        if (html === 'href' && !value.startsWith('#')) continue;
        found.push({ node, attribute, value });
      }
    }
  }
  return found;
}

// the attribute ids whose HTML name is a reference holder, mapped from the manifest's data (set once, read everywhere)
let REFERENCE_ATTRIBUTES = new Map<string, string>();

// The HTML name of a reference-holding attribute ('for' or 'href'), or undefined for any other: what a writer of nodes
// asks before it keeps a stored value (`isReferenceValue` below, the tree kernel's value-level release).
export function referenceHtmlOf(attribute: string): string | undefined {
  return REFERENCE_ATTRIBUTES.get(attribute);
}

// Whether a stored attribute value is a reference to a node that is leaving: the one test the writers share.
export function referenceNamesLeaving(attribute: string, value: unknown, leaving: ReadonlySet<string>): boolean {
  const html = referenceHtmlOf(attribute);
  if (html === undefined || typeof value !== 'string' || value === '') return false;
  if (html === 'href' && !value.startsWith('#')) return false;
  return leaving.has(value.startsWith('#') ? value.slice(1) : value);
}
export function setReferenceAttributes(entries: readonly { readonly id: string; readonly html: string | null }[]): void {
  REFERENCE_ATTRIBUTES = new Map(entries.filter((entry) => entry.html !== null && REFERENCE_HTM.includes(entry.html)).map((entry) => [entry.id, entry.html as string]));
}

// The references that name no node of the document: what the validator refuses a project over (a reference whose
// target is gone, or that a hand-edited file names wrongly).
//
// A value that names no node but IS some node's `id` attribute is left alone: that is HTML's own contract — a label's
// `for="user-name"` pointing at the element whose id is "user-name" — and it is what an imported form carries. The
// check reads the document, never the value's shape: a shape test (an id "looks like" a name) forgave a real orphan
// whose id happened to be a word (the audit's A3.4/F4) and reported a hand-typed id that starts with a digit.
export function orphanReferences(document: DocumentJson): readonly { readonly node: DocNode; readonly attribute: string; readonly value: string }[] {
  if (REFERENCE_ATTRIBUTES.size === 0) return [];
  const htmlIds = new Set<string>();
  for (const page of document.pages) {
    for (const node of walk(page.tree)) {
      const id = node.attributes.id;
      if (typeof id === 'string' && id !== '') htmlIds.add(id);
    }
  }
  return referencesOf(document).filter((reference) => {
    const named = reference.value.startsWith('#') ? reference.value.slice(1) : reference.value;
    return referenceTarget(document, reference.value) === null && !htmlIds.has(named);
  });
}

// How many references point at the node, or at anything inside it: what a delete says before it takes it away.
export function referencesTo(document: DocumentJson, id: NodeId): number {
  const target = locate(document, id);
  if (target === null) return 0;
  const inside = new Set([...walk(target.node)].map((node) => node.id));
  const attributes = referencesOf(document).filter((reference) => !inside.has(reference.node.id) && inside.has(reference.value.startsWith('#') ? reference.value.slice(1) : reference.value)).length;
  // an interaction of another element that acts on it is a reference too
  let interactions = 0;
  for (const page of document.pages) for (const node of walk(page.tree)) if (!inside.has(node.id)) interactions += (node.interactions ?? []).filter((one) => one.target !== undefined && inside.has(one.target)).length;
  return attributes + interactions;
}

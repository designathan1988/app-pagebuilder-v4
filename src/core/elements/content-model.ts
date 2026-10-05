// The HTML content model (PRODUCT.md §5): which element may sit inside which, read from the permitted content and
// the permitted descendants of manifest/generated/html-elements.json (keyed by tag). This slice holds:
//  - palette-click-insert: a parent whose permitted content is a closed list of elements (<ul> and <ol> take <li>,
//    <tr> takes <td> and <th>, <table> its rows and sections) accepts only those;
//  - elements-structure: interactive content (a link, a Link Block, a button, a form control) never sits inside an
//    element whose permitted descendants exclude it (<a>, so a Link Block, and <button>), nor inside an element inside
//    one (spec elements-structure, Problems in Pager 5); every command that places an element asks it
//    (interactiveInsideRefusal);
//  - semantic-tag-switch: the other excluded descendants, by tag or by category (no <header> or <footer> inside a
//    <header> or a <footer>, no <main> inside an <article>, an <aside>, a <nav>, a <header> or a <footer>, no heading
//    inside a <th>): an element takes none of them at any depth (`excludes`, status.refused.notInside). Interactive
//    content is the rule above alone, which knows when a conditional element is interactive. `retagRefusal` asks every
//    rule of this module for a node that would take another tag where it is (element.setTag);
//  - text-inline-formatting: whether a tag is phrasing content or metadata, by HTML's categories, for pasted markup;
//  - elements-svg-shapes: a foreign element (<svg>) accepts only the elements of its own namespace the editor makes
//    (elements.json: <rect>, <ellipse>, <line>), and those exist only inside it (spec elements-svg-shapes, Problems in
//    Pager 1).
// A parent whose content is given by categories (flow, phrasing), a child that requires a parent and the other rules
// arrive with nesting-grammar, which completes this module and has insert, move and paste ask `excludes` too.
import type { GeneratedHtml } from '../../manifest/schema.ts';
import { message, type Message } from '../commands/registry.ts';
import { lineage, locate, walk, type DocNode, type DocumentJson, type NodeId } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';

export interface ContentModel {
  // null when a <parent> accepts a <child>; otherwise the tags the parent only accepts, in the order HTML lists them
  refusal(parent: string, child: string): readonly string[] | null;
  // whether an <ancestor> excludes a <descendant> from everything inside it, at any depth, by a rule other than
  // interactive content (which isInteractive and excludesInteractive answer)
  excludes(ancestor: string, descendant: string): boolean;
  // whether a <tag> is phrasing content (text-level: it runs on in the line) and whether it is metadata (a script, a
  // style: never text of the page), as HTML's categories say, a conditional category counting as one; null for a tag
  // HTML does not define. Pasted markup reads as text by them (src/core/text/inline.ts).
  phrasing(tag: string): boolean | null;
  metadata(tag: string): boolean | null;
  // whether an element of <tag> with these HTML attributes is interactive content
  isInteractive(tag: string, attributes: ReadonlyMap<string, string | number | true>): boolean;
  // whether no descendant of an element of <tag> may be interactive content
  excludesInteractive(tag: string): boolean;
  // Whether the tag takes an attribute of this HTML name (the generated table): a tag switch drops the attributes the
  // new tag cannot hold, and the Settings shows only the fields the tag takes (the user's real-use audit, A3.7). A tag
  // HTML does not define takes none.
  takesAttribute(tag: string, name: string): boolean;
  // whether a <parent>'s permitted content names a <child> by its tag (a <select>'s options, a <picture>'s or a
  // <video>'s sources, a <video>'s tracks): the parts its editor adds (parts.add)
  names(parent: string, child: string): boolean;
  // where a <child> goes among a <parent>'s children, by HTML's permitted order: after the last child whose tag comes
  // no later than it in that order (a <picture>'s sources before its <img>, a <video>'s tracks after its sources); the
  // end when the parent gives no order
  slotIn(parent: string, childTags: readonly string[], child: string): number;
  // whether a <tag> is a void element (HTML: no content, no end tag: <img>, <input>, <br>…)
  isVoid(tag: string): boolean;
  // whether a <parent> holds at most one <child> (an optional one, "legend?", or its required content: a <details>'s
  // <summary>)
  unique(parent: string, child: string): boolean;
  // the parents a <child> only exists inside (an <li> inside <ul>, <ol>, <menu>; a <td> inside <tr>): the tags whose
  // permitted content names it, for a tag in no content category; null for a tag that may sit in any flow content
  parentsOf(child: string): readonly string[] | null;
}

// "@script" (script-supporting elements) is a category no user inserts; an entry ending in "?" is optional
const SCRIPT_SUPPORTING = '@script';
const INTERACTIVE = '@interactive';
const tagOf = (entry: string) => (entry.endsWith('?') ? entry.slice(0, -1) : entry);
const CATEGORY = '@';

type Categories = GeneratedHtml['elements'][string]['categories'];

// When an element that HTML makes interactive only under a condition is interactive (HTML, "interactive content"):
// <audio> and <video> with controls, <img> and <object> with usemap, <input> unless its type is hidden. The editor's
// <a> is always a link: a Link Block or a link without its address yet is still made to be one (spec
// elements-structure, Problems in Pager 5). A conditional element not listed here counts as interactive.
const CONDITIONS: Readonly<Record<string, (attributes: ReadonlyMap<string, string | number | true>) => boolean>> = {
  a: () => true,
  audio: (a) => a.has('controls'),
  video: (a) => a.has('controls'),
  img: (a) => a.has('usemap'),
  object: (a) => a.has('usemap'),
  input: (a) => String(a.get('type') ?? '').toLowerCase() !== 'hidden',
};

// `foreign`: the tag of a foreign element (HTML's <svg>) → the tags of the elements of its namespace (elements.json)
export function contentModelFrom(html: GeneratedHtml, foreign: ReadonlyMap<string, readonly string[]> = new Map()): ContentModel {
  // every attribute name the table lists anywhere: what it lists for no tag at all is one the generator leaves out,
  // which no tag is claimed not to take (the audit A3.7 and A3.39: an iframe keeps its allow, a canvas its width)
  const LISTED = new Set<string>();
  // tag → the elements it only accepts, for the parents whose permitted content lists elements and no category, and
  // for a foreign element
  const closed = new Map<string, readonly string[]>();
  // tag of an element of a foreign namespace → the foreign element it only exists inside
  const foreignParent = new Map<string, string>();
  for (const element of Object.values(html.elements)) for (const name of Object.keys(element.attributes ?? {})) LISTED.add(name);
  for (const [parent, children] of foreign) {
    if (html.elements[parent]?.foreign !== true || children.length === 0) continue;
    closed.set(parent, children);
    for (const child of children) foreignParent.set(child, parent);
  }
  // the tags whose permitted descendants exclude interactive content
  const noInteractive = new Set<string>();
  // tag → the other tags and categories it excludes from its descendants
  const excluded = new Map<string, readonly string[]>();
  for (const [tag, element] of Object.entries(html.elements)) {
    const exclusions = (element.permittedDescendants ?? []).flatMap((rule) => rule.exclude);
    if (exclusions.includes(INTERACTIVE)) noInteractive.add(tag);
    const others = exclusions.filter((entry) => entry !== INTERACTIVE);
    if (others.length > 0) excluded.set(tag, others);
    const permitted = element.permittedContent;
    if (permitted === null || permitted.length === 0) continue;
    const listed = permitted.filter((entry) => entry !== SCRIPT_SUPPORTING);
    if (listed.length === 0 || listed.some((entry) => entry.startsWith(CATEGORY))) continue;
    closed.set(tag, listed.map(tagOf));
  }
  // whether a tag is always in a category: the excluded descendants count only an element that is always excluded
  const inCategory = (tag: string, name: string): boolean => html.elements[tag]?.categories[name as keyof Categories] === true;
  // whether a tag is in a category, a conditional membership counting as one; null for a tag HTML does not define
  const category = (tag: string, name: 'phrasing' | 'metadata'): boolean | null => {
    if (!Object.hasOwn(html.elements, tag)) return null;
    const flag = html.elements[tag]?.categories[name];
    return flag === undefined ? null : flag !== false;
  };
  // the place of a tag in a parent's permitted order: the index of the first entry naming it, else of the first
  // category entry, else after them all
  const orderOf = (parent: string, tag: string): number => {
    const order = html.elements[parent]?.permittedOrder ?? null;
    if (order === null) return 0;
    const groups = order.map((entry) => entry.split(',').map((t) => tagOf(t.trim())));
    // the last group naming it: a <figcaption> comes first or last in a <figure>, and the flow content before it
    const named = groups.findLastIndex((group) => group.includes(tag));
    if (named >= 0) return named;
    const category = groups.findIndex((group) => group.some((t) => t.startsWith(CATEGORY)));
    return category >= 0 ? category : groups.length;
  };
  return {
    refusal(parent, child) {
      const only = closed.get(parent);
      return only === undefined || only.includes(child) ? null : only;
    },
    parentsOf(child) {
      const inside = foreignParent.get(child);
      if (inside !== undefined) return [inside];
      const element = html.elements[child];
      if (element === undefined || Object.values(element.categories).some((flag) => flag !== false)) return null;
      const parents = Object.entries(html.elements)
        .filter(([, e]) => (e.permittedContent ?? []).some((entry) => tagOf(entry) === child))
        .map(([tag]) => tag);
      return parents.length === 0 ? null : parents;
    },
    takesAttribute(tag, name) {
      // The rule is for the attributes a tag certainly does not take (an href on a button), never a guess: a tag the
      // generated table does not know, or one it lists no attributes for (a canvas), answers yes, and so does an
      // attribute the table lists for no tag at all (a global the generator leaves out, an iframe's allow).
      const attrs = html.elements[tag]?.attributes;
      if (attrs === undefined || Object.keys(attrs).length === 0) return true;
      if (!LISTED.has(name)) return true;
      return name in attrs;
    },
    isVoid(tag) {
      return html.elements[tag]?.void === true;
    },
    unique(parent, child) {
      const element = html.elements[parent];
      return (element?.permittedContent ?? []).includes(`${child}?`) || (element?.requiredContent ?? []).includes(child);
    },
    names(parent, child) {
      if (foreignParent.get(child) === parent) return true;
      return (html.elements[parent]?.permittedContent ?? []).some((entry) => tagOf(entry) === child);
    },
    slotIn(parent, childTags, child) {
      const own = orderOf(parent, child);
      let at = 0;
      childTags.forEach((tag, i) => {
        if (orderOf(parent, tag) <= own) at = i + 1;
      });
      return at;
    },
    excludes(ancestor, descendant) {
      return (excluded.get(ancestor) ?? []).some((entry) => (entry.startsWith(CATEGORY) ? inCategory(descendant, entry.slice(CATEGORY.length)) : entry === descendant));
    },
    phrasing: (tag) => category(tag, 'phrasing'),
    metadata: (tag) => category(tag, 'metadata'),
    isInteractive(tag, attributes) {
      const flag = html.elements[tag]?.categories.interactive;
      if (flag === true) return true;
      if (flag !== 'conditional') return false;
      return CONDITIONS[tag]?.(attributes) ?? true;
    },
    excludesInteractive(tag) {
      return noInteractive.has(tag);
    },
  };
}

// A node's HTML attributes, by their HTML names (elements.json gives each attribute's), without those set to false
// (an absent boolean attribute).
function htmlAttributes(node: DocNode, rules: ModelRules): ReadonlyMap<string, string | number | true> {
  const found = new Map<string, string | number | true>();
  for (const [id, value] of Object.entries(node.attributes)) {
    const name = rules.attributeValues.get(id)?.html;
    if (name === null || name === undefined || value === undefined || value === false) continue;
    found.set(name, value);
  }
  return found;
}

// whether any of these nodes, or anything inside them, is interactive content
function holdsInteractive(rules: ModelRules, nodes: readonly DocNode[]): boolean {
  return nodes.some((node) => [...walk(node)].some((inner) => inner.tag !== null && rules.contentModel.isInteractive(inner.tag, htmlAttributes(inner, rules))));
}

// Why the arriving elements (with everything inside them) may not go into the receiver: the element that refuses
// interactive content inside it, the receiver itself or the nearest of its ancestors that does, named by
// status.refused.interactiveInside; or null when nothing refuses them. Commands that place elements ask it after their
// other refusals (spec elements-structure, Problems in Pager 5: every door that inserts or drops one).
function interactiveInsideRefusal(document: DocumentJson, rules: ModelRules, receiver: NodeId, arriving: readonly DocNode[]): Message | null {
  let refusing: DocNode | null = null;
  for (let at = locate(document, receiver); at !== null; at = at.parent === null ? null : locate(document, at.parent.id)) {
    if (at.node.tag !== null && rules.contentModel.excludesInteractive(at.node.tag)) {
      refusing = at.node;
      break;
    }
  }
  if (refusing === null) return null;
  return holdsInteractive(rules, arriving) ? message('status.refused.interactiveInside', { parent: refusing.name }) : null;
}

const shown = (tag: string | null) => `<${tag ?? ''}>`;

// Why elements may not be the children of a new element of <tag> that is not in the document yet (a wrapper around
// them: element.wrapRow, element.wrapColumn), or null: its closed list, and each child that only exists inside other
// parents (an <li> wrapped in a <div>).
export function childrenRefusal(rules: ModelRules, tag: string, children: readonly DocNode[]): Message | null {
  const model = rules.contentModel;
  for (const child of children) {
    if (child.tag === null) continue;
    const only = model.refusal(tag, child.tag);
    if (only !== null) return message('status.refused.onlyAccepts', { parent: shown(tag), children: only.map(shown).join(', ') });
    const parents = model.parentsOf(child.tag);
    if (parents !== null && !parents.includes(tag)) return message('status.refused.requiresParent', { child: shown(child.tag), parents: parents.map(shown).join(', ') });
  }
  return null;
}

// The one rule of where elements may go (feature nesting-grammar, Problems in Pager 2; nesting-grammar-structure,
// Problems in Pager 3): why the nodes `arriving` (with their subtrees) may not become children of `receiver`, or null.
// Every command that places elements asks it: an insert (a tile's click, Enter, Space, its drag), a move (a drag on the
// canvas or in Layers, move up/down, nest, promote, the hand), a paste, a wrap and an unwrap. In order: a receiver that
// holds no elements (status.refused.noChildren); a receiver whose permitted content is a closed list
// (status.refused.onlyAccepts); an element that only exists inside certain parents (status.refused.requiresParent); a
// receiver that holds at most one of an element and has it already (status.refused.singleChild); interactive content
// inside interactive content (status.refused.interactiveInside); an ancestor, or the receiver, that excludes an
// arriving element or something inside it (status.refused.notInside). `staying` names nodes already among the
// receiver's children that the change keeps there (a move among siblings), which do not count as the one it holds.
export function placementRefusal(document: DocumentJson, rules: ModelRules, receiver: NodeId, arriving: readonly DocNode[], staying: ReadonlySet<NodeId> = new Set()): Message | null {
  const model = rules.contentModel;
  const chain = lineage(document, receiver);
  const host = chain.at(-1);
  if (host === undefined) throw new Error(`placementRefusal: the document has no node ${receiver}`);
  if (rules.elements.get(host.type)?.content !== 'children') return message('status.refused.noChildren', { parent: host.name });
  // a captured page keeps its content in its snapshots, its root holds no element (validate.ts): nothing goes there
  // (the audit's CA1: an insert with nothing selected on a captured page was refused as an invalid document)
  const page = chain.length === 1 ? document.pages[locate(document, receiver)?.page ?? -1] : undefined;
  if (page?.capture !== undefined) return message('status.capture.noElements', { page: page.name });
  const arrivingIds = new Set(arriving.map((node) => node.id));
  for (const node of arriving) {
    if (node.tag === null) continue;
    const only = host.tag === null ? null : model.refusal(host.tag, node.tag);
    if (only !== null) return message('status.refused.onlyAccepts', { parent: shown(host.tag), children: only.map(shown).join(', ') });
    const parents = model.parentsOf(node.tag);
    if (parents !== null && host.tag !== null && !parents.includes(host.tag)) return message('status.refused.requiresParent', { child: shown(node.tag), parents: parents.map(shown).join(', ') });
    if (host.tag !== null && model.unique(host.tag, node.tag)) {
      const held = host.children.filter((child) => child.tag === node.tag && !arrivingIds.has(child.id) && !staying.has(child.id)).length;
      const coming = arriving.filter((other) => other.tag === node.tag).length;
      if (held + coming > 1) return message('status.refused.singleChild', { parent: shown(host.tag), child: shown(node.tag) });
    }
  }
  // interactive content inside interactive content first: the more particular rule names the element that refuses
  const interactive = interactiveInsideRefusal(document, rules, receiver, arriving);
  if (interactive !== null) return interactive;
  for (const node of arriving) {
    for (const inner of walk(node)) {
      if (inner.tag === null) continue;
      const excluding = [...chain].reverse().find((a) => a.tag !== null && model.excludes(a.tag, inner.tag as string));
      if (excluding !== undefined) return message('status.refused.notInside', { child: shown(inner.tag), ancestor: shown(excluding.tag) });
    }
  }
  return null;
}

// Why a node of the document may not take another tag where it is (element.setTag, spec semantic-tag-switch, Problems
// in Pager 3), or null: its parent's closed list, then the tag's own closed list over its children
// (status.refused.onlyAccepts); the nearest ancestor that excludes the tag, then the first descendant in document order
// the tag excludes (status.refused.notInside, naming both tags); interactive content, the node with its new tag
// arriving where it is, or held inside it when the new tag excludes it (status.refused.interactiveInside).
export function retagRefusal(document: DocumentJson, rules: ModelRules, id: NodeId, tag: string): Message | null {
  const model = rules.contentModel;
  const chain = lineage(document, id);
  const node = chain.at(-1);
  if (node === undefined) throw new Error(`retagRefusal: the document has no node ${id}`);
  const ancestors = chain.slice(0, -1);
  const parent = ancestors.at(-1);
  const only = parent === undefined || parent.tag === null ? null : model.refusal(parent.tag, tag);
  if (only !== null && parent !== undefined) return message('status.refused.onlyAccepts', { parent: shown(parent.tag), children: only.map(shown).join(', ') });
  for (const child of node.children) {
    const childOnly = child.tag === null ? null : model.refusal(tag, child.tag);
    if (childOnly !== null) return message('status.refused.onlyAccepts', { parent: shown(tag), children: childOnly.map(shown).join(', ') });
  }
  const excluding = [...ancestors].reverse().find((a) => a.tag !== null && model.excludes(a.tag, tag));
  if (excluding !== undefined) return message('status.refused.notInside', { child: shown(tag), ancestor: shown(excluding.tag) });
  for (const inner of walk(node)) {
    if (inner !== node && inner.tag !== null && model.excludes(tag, inner.tag)) return message('status.refused.notInside', { child: shown(inner.tag), ancestor: shown(tag) });
  }
  const retagged: DocNode = { ...node, tag };
  const inside = parent === undefined ? null : interactiveInsideRefusal(document, rules, parent.id, [retagged]);
  if (inside !== null) return inside;
  if (model.excludesInteractive(tag) && holdsInteractive(rules, node.children)) return message('status.refused.interactiveInside', { parent: node.name });
  return null;
}

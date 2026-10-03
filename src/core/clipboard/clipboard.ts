// The clipboard (INVENTORY.md, owners; specs clipboard-copy-paste, clipboard-paste-external,
// clipboard-cut-system and copy-paste-styles): elements and their styles through the system clipboard, never a copy
// kept in memory (spec clipboard-copy-paste, Problems in Pager 2).
//  - Copy writes every selected root (a node no other selected node contains), in document order, with its subtree, in
//    the app's element format: a JSON text naming the format and holding the nodes (ids left out), and, beside it as
//    text/html, the exported markup of those roots with the CSS rules they use — what the site's own writer
//    (core/export/export.ts) writes for them, so no editor attribute, editor id or inline style reaches another
//    application (spec clipboard-cut-system, Problems in Pager 2). The document does not change and nothing is
//    recorded; the status bar says what was copied.
//  - Cut is that copy and then element.delete's own rule (core/structure/remove.ts, which owns what leaving is): one
//    outcome, one undo step, its message the cut's.
//  - Paste reads what the clipboard holds, in this order: text in the app's element format gives its nodes, placed like
//    an insert (a selected container takes them as its last children, a selected leaf is followed by them, nothing
//    selected puts them at the end of the page), each with new ids and a name no node has, one undo step, the pasted
//    nodes becoming the selection. A clipboard that holds HTML from outside the editor goes through the one owner of
//    reading HTML (core/import/import.ts nodesFromExternal): the same cleaning, the same repair and the same report,
//    with no page to keep a script with (a pasted script is dropped, and reported); plain text becomes one Paragraph
//    per line (spec clipboard-paste-external, Problems in Pager 1). Anything else is nothing to paste
//    (status.paste.empty); a clipboard the browser would not read says so (status.clipboard.denied). A parent that does
//    not accept them, a locked parent, or interactive content inside a Link Block refuses, as an insert does.
//  - Copy style writes the selected element's styles in a format of their own (STYLES_FORMAT); Paste style replaces
//    the target's styles with them, one undo step, through the same holders every style write uses (styleHolders of
//    core/style/set.ts), so the class that is the style target receives them and an instance's part writes into its
//    component. Text, children and attributes stay (spec copy-paste-styles).
import type { ClipboardContent, ClipboardNode, NodeId } from '../../generated/commands.ts';
import type { ElementType, MessageId } from '../../generated/ids.ts';
import { message, registerHandler, type HandlerContext, type Message, type Outcome } from '../commands/registry.ts';
import { allNodes, locate, type DocNode, type DocumentJson, type Location, type Styles } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { placementRefusal } from '../elements/content-model.ts';
import { referenceHtmlOf } from '../elements/references.ts';
import { pageCss, pageLines } from '../export/export.ts';
import { deepEqual, type Patch } from '../history/transaction.ts';
import { nodesFromExternal, reportNotes } from '../import/import.ts';
import { firstLockRefusal, lockRefusal } from '../nodes/flags.ts';
import { openedPage, pageShown } from '../project/pages.ts';
import { freshName, nodeMaker, type NodeMaker } from '../structure/node-maker.ts';
import type { IdGenerator } from '../ports/ids.ts';
import { styleHolders } from '../style/set.ts';
import { deleteCommand, selectionRoots } from '../structure/remove.ts';

// the name of the app's element format, the first field of its JSON text
export const ELEMENTS_FORMAT = 'builder/elements';

// A copied node: its fields without its id, and the id it had (`copiedFrom`), so a paste can point what the copy's
// elements pointed at among themselves (a label's for, an anchor link, an interaction's target) at their new ids.
type Copied = Omit<DocNode, 'id' | 'children'> & { readonly copiedFrom?: string; readonly children: readonly Copied[] };

const withoutIds = (node: DocNode): Copied => {
  const copy: Record<string, unknown> = { ...node, copiedFrom: node.id, children: node.children.map(withoutIds) };
  delete copy.id;
  return copy as Copied;
};

// the selected nodes no other selected node contains, in document order
function selectedRoots(document: DocumentJson, selection: readonly NodeId[]): DocNode[] {
  const chosen = new Set(selection);
  const inside = (id: NodeId) => {
    for (let at = locate(document, id)?.parent ?? null; at !== null; at = locate(document, at.id)?.parent ?? null) if (chosen.has(at.id)) return true;
    return false;
  };
  return [...allNodes(document)].filter((node) => chosen.has(node.id) && !inside(node.id));
}

// The copied roots as the exported markup and the CSS rules it uses (spec clipboard-cut-system, Problems in Pager 2):
// the page's own writer (core/export/export.ts) writes them as the children of the page root they came from — the BEM
// classes, the rules, the tags and the attributes the export gives — and the head, the lines of no node, are left
// out. Nothing of the editor is in it. Both empty when there is nothing to write.
function exportedFragment(document: DocumentJson, rules: ModelRules, roots: readonly DocNode[]): { readonly html: string; readonly css: string } {
  const index = openedPage({ document });
  const page = document.pages[index];
  if (page === undefined || roots.length === 0) return { html: '', css: '' };
  const asPage = { ...document, pages: document.pages.map((one, i) => (i === index ? { ...page, tree: { ...page.tree, children: roots } } : one)) };
  const code = pageLines(asPage, index, rules);
  const html = code.html.flatMap((line) => (line.node === null ? [] : [line.text.replace(/^ {2}/, '')])).join('\n');
  return { html, css: pageCss(code.css).trimEnd() };
}

// what a copy of these roots writes on the clipboard: the app's element format, and the exported markup beside it
// with the rules it uses
function copiedWrite(document: DocumentJson, rules: ModelRules, roots: readonly DocNode[]): { readonly text: string; readonly html?: string; readonly css?: string } {
  const text = JSON.stringify({ format: ELEMENTS_FORMAT, nodes: roots.map(withoutIds) });
  const { html, css } = exportedFragment(document, rules, roots);
  if (html === '') return { text };
  return css === '' ? { text, html } : { text, html, css };
}

export const copyCommand = registerHandler('clipboard.copy', ({ state, rules }): Outcome<never> => {
  const roots = selectedRoots(state.document, state.selection);
  const first = roots[0];
  if (first === undefined) return { kind: 'refused', message: message('refusal.nothingSelected') };
  // the page root is never copied: a paste would put a page inside a page
  if (roots.some((node) => locate(state.document, node.id)?.parent === null)) return { kind: 'refused', message: message('status.copy.root') };
  return {
    kind: 'change',
    clipboard: copiedWrite(state.document, rules, roots),
    message: roots.length === 1 ? message('status.copied', { name: first.name }) : message('status.copiedMany', { count: roots.length }),
  };
});

// clipboard.cut (spec clipboard-cut-system): the copy, and then the delete (element.delete's own rule, which owns
// what leaving the document means — the page root and a locked element refuse there), one outcome: one undo step.
export const cutCommand = registerHandler('clipboard.cut', (context): Outcome<never> => {
  const { state, rules } = context;
  const roots = selectedRoots(state.document, state.selection);
  const first = roots[0];
  if (first === undefined) return { kind: 'refused', message: message('refusal.nothingSelected') };
  const leaving = deleteCommand.run(context, {});
  if (leaving.kind !== 'change') return leaving;
  return {
    ...leaving,
    clipboard: copiedWrite(state.document, rules, roots),
    message: roots.length === 1 ? message('status.cut', { name: first.name }) : message('status.cutMany', { count: roots.length }),
  };
});

// the nodes a clipboard text in the app's element format holds, or null for any other text
function copiedNodes(text: string | null): Copied[] | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as { format?: unknown; nodes?: unknown };
    return parsed.format === ELEMENTS_FORMAT && Array.isArray(parsed.nodes) && parsed.nodes.length > 0 ? (parsed.nodes as Copied[]) : null;
  } catch {
    return null;
  }
}

// a copied subtree given new ids and names no node has (numbered from the copied name: "Title 2"); `renamed` learns
// which new id each copied id took
function fresh(copied: Copied, ids: IdGenerator, taken: Set<string>, renamed: Map<string, NodeId>): DocNode {
  let name = copied.name;
  if (taken.has(name)) {
    const base = name.replace(/ \d+$/, '');
    let n = 2;
    while (taken.has(`${base} ${n}`)) n += 1;
    name = `${base} ${n}`;
  }
  taken.add(name);
  const id = ids.next();
  const { copiedFrom, ...fields } = copied;
  if (copiedFrom !== undefined) renamed.set(copiedFrom, id);
  return { ...fields, id, name, children: copied.children.map((child) => fresh(child, ids, taken, renamed)) } as DocNode;
}

// Pasted nodes made whole for the document they land in (the rules duplicate follows, clone.ts): what they pointed at
// among themselves points at the copies; what they pointed at elsewhere stays when it is still in the document and
// goes when it is not (a cut element's label, a copy from another project); an HTML id the document already uses takes
// a "-copy" of its own; an instance of a component the project does not hold becomes plain elements.
function settled(document: DocumentJson, nodes: readonly DocNode[], renamed: ReadonlyMap<string, NodeId>): DocNode[] {
  const present = new Set<string>([...allNodes(document)].map((node) => node.id));
  const occupied = new Set([...allNodes(document)].map((node) => node.attributes.id).filter((id): id is string => typeof id === 'string' && id !== ''));
  const components = new Set((document.components ?? []).map((one) => one.name));
  const pointed = (value: string): string | null => {
    const fragment = value.startsWith('#');
    const named = fragment ? value.slice(1) : value;
    const now = renamed.get(named) ?? (present.has(named) ? named : null);
    return now === null ? null : fragment ? `#${now}` : now;
  };
  const repair = (node: DocNode, detached = false): DocNode => {
    const attributes: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(node.attributes)) {
      if (name === 'id' && typeof value === 'string' && occupied.has(value)) {
        let candidate = `${value}-copy`;
        for (let n = 2; occupied.has(candidate); n += 1) candidate = `${value}-copy-${n}`;
        occupied.add(candidate);
        attributes[name] = candidate;
        continue;
      }
      if (name === 'id' && typeof value === 'string') occupied.add(value);
      if (typeof value === 'string' && referenceHtmlOf(name) !== undefined && (referenceHtmlOf(name) !== 'href' || value.startsWith('#'))) {
        const now = pointed(value);
        if (now !== null) attributes[name] = now;
        continue;
      }
      attributes[name] = value;
    }
    const interactions = node.interactions
      ?.map((one) => (one.target === undefined ? one : { ...one, target: (renamed.get(one.target) ?? (present.has(one.target) ? one.target : undefined)) as NodeId | undefined }))
      .filter((one) => !('target' in one) || one.target !== undefined);
    const { component, componentPart, ...rest } = node;
    delete (rest as { interactions?: unknown }).interactions;
    // an instance root of a component the project does not hold is detached, and every part under it with it
    const detaching = detached || (component !== undefined && !components.has(component));
    const instance = detaching ? {} : { ...(component === undefined ? {} : { component }), ...(componentPart === undefined ? {} : { componentPart }) };
    return {
      ...rest,
      ...instance,
      attributes: attributes as DocNode['attributes'],
      ...(interactions === undefined || interactions.length === 0 ? {} : { interactions }),
      children: node.children.map((child) => repair(child, detaching)),
    } as DocNode;
  };
  return nodes.map((node) => repair(node));
}

// where pasted nodes go: into a selected container, after a selected leaf, else at the end of the root of the page
// the editor shows (openedPage, its one owner)
function target(state: { readonly document: DocumentJson; readonly ui?: unknown }, selection: readonly NodeId[], rules: ModelRules): { readonly parent: Location; readonly index: number; readonly after: DocNode | null } | null {
  const document = state.document;
  const root = pageShown(state)?.tree ?? null;
  const primary = selection[0] === undefined ? null : locate(document, selection[0]);
  if (primary !== null && rules.elements.get(primary.node.type)?.content === 'children') return { parent: primary, index: primary.node.children.length, after: null };
  if (primary?.parent) {
    const up = locate(document, primary.parent.id);
    if (up) return { parent: up, index: primary.index + 1, after: primary.node };
  }
  const at = root === null ? null : locate(document, root.id);
  return at === null ? null : { parent: at, index: at.node.children.length, after: null };
}

export const pasteCommand = registerHandler('clipboard.paste', (context, { clipboard }): Outcome<never> => {
  const { state, rules, ids, words } = context;
  // Asked before the clipboard is read (the context menu choosing its items, store.canRun): what a paste brings is
  // known only when it runs, which its door reads first, so it runs wherever a paste may land and a locked receiver
  // refuses; nothing changes.
  if (clipboard === undefined) {
    const at = target(state, state.selection, rules);
    const locked = at === null ? null : lockRefusal(state.document, at.parent.node.id, 'status.locked.insert');
    return locked === null ? { kind: 'change', message: message('status.paste.empty') } : { kind: 'refused', message: locked };
  }
  const content = clipboard as ClipboardContent;
  if (content.status === 'denied') return { kind: 'refused', message: message('status.clipboard.denied') };
  const at = target(state, state.selection, rules);
  if (at === null) throw new Error('clipboard.paste: the document has no page');
  const receiver = at.parent.node;
  const locked = lockRefusal(state.document, receiver.id, 'status.locked.insert');
  if (locked !== null) return { kind: 'refused', message: locked };
  // what the paste brings, and what the status bar says of it: the app's own format, the HTML an application copied,
  // or plain text (one Paragraph per line)
  const copied = copiedNodes(content.text);
  let nodes: readonly DocNode[] | null = null;
  let said: Message | null = null;
  if (copied !== null) {
    const taken = new Set([...allNodes(state.document)].map((n) => n.name));
    const renamed = new Map<string, NodeId>();
    nodes = settled(state.document, copied.map((node) => fresh(node, ids, taken, renamed)), renamed);
    const first = nodes[0] as DocNode;
    const count = receiver.children.length + nodes.length;
    said =
      at.after === null
        ? message('status.pasted.inside', { name: first.name, parent: receiver.name, position: at.index + 1, count })
        : message('status.pasted.after', { name: first.name, sibling: at.after.name, position: at.index + 1, count, parent: receiver.name });
  } else {
    const markup = content.markup ?? markupOf(content.html);
    if (markup !== null && markup.trim() !== '') {
      // the HTML importer's own rules, with no page to keep a script with (core/import/import.ts)
      const imported = nodesFromExternal(markup, nodeMaker(state.document, rules, ids, words), context as HandlerContext<never>);
      if (imported.nodes.length === 0) return { kind: 'refused', message: message('status.paste.empty') };
      nodes = imported.nodes;
      said = message('status.pasted.html', { count: imported.nodes.length, notes: reportNotes(imported.report, words) });
    } else if (content.text !== null && content.text.trim() !== '') {
      const lines = content.text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      if (lines.length === 0) return { kind: 'refused', message: message('status.paste.empty') };
      const make = nodeMaker(state.document, rules, ids, words);
      nodes = lines.map((line) => paragraphOf(line, make));
      said = message('status.pasted.text', { count: nodes.length });
    }
  }
  if (nodes === null || said === null) return { kind: 'refused', message: message('status.paste.empty') };
  // the one rule of where elements may go (content-model.ts placementRefusal), as for an insert
  const refused = placementRefusal(state.document, rules, receiver.id, nodes);
  if (refused !== null) return { kind: 'refused', message: refused };
  return {
    kind: 'change',
    patches: nodes.map((node, i) => ({ op: 'add' as const, path: [...at.parent.path, 'children', at.index + i], value: node })),
    selection: nodes.map((node) => node.id),
    message: said,
  };
});

// the markup a tree of clipboard nodes stands for, when the clipboard did not hold its text (a paste whose door read
// the tree alone): what the importer reads is markup, so the tree is written back as the markup it came from
function markupOf(html: readonly ClipboardNode[] | null): string | null {
  if (html === null) return null;
  const write = (nodes: readonly ClipboardNode[]): string =>
    nodes
      .map((node) => {
        if (typeof node === 'string') return node;
        const href = node.href === null ? '' : ` href="${node.href.replaceAll('"', '&quot;')}"`;
        return `<${node.tag}${href}>${write(node.children)}</${node.tag}>`;
      })
      .join('');
  return write(html);
}

// a line of pasted text as the Paragraph it becomes, named as any new element is
function paragraphOf(text: string, make: NodeMaker): DocNode {
  const element = make.rules.elements.get('paragraph' as ElementType);
  return {
    id: make.ids.next(),
    type: 'paragraph' as ElementType,
    name: freshName(make, make.words((element?.labelKey ?? 'element.paragraph.label') as MessageId)),
    tag: element?.tags[0] ?? 'p',
    attributes: {},
    classes: [],
    styles: {},
    text,
    children: [],
  };
}
// ---------------------------------------------------------------- styles (spec copy-paste-styles)
// the name of the app's style format, the first field of its JSON text: every style value of an element, by
// breakpoint and state, exactly as the document holds them
export const STYLES_FORMAT = 'builder/styles';

function copiedStyles(text: string | null): Styles | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as { format?: unknown; styles?: unknown };
    if (parsed.format !== STYLES_FORMAT || parsed.styles === null || typeof parsed.styles !== 'object') return null;
    return parsed.styles as Styles;
  } catch {
    return null;
  }
}

// Copy style: every style value of the selected element, in the app's style format, on the clipboard. Nothing in the
// document changes; the status bar names the element.
export const copyStyleCommand = registerHandler('clipboard.copyStyle', ({ state }): Outcome<never> => {
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null) return { kind: 'refused', message: message('refusal.nothingSelected') };
  return {
    kind: 'change',
    clipboard: { text: JSON.stringify({ format: STYLES_FORMAT, styles: primary.node.styles }) },
    message: message('status.style.copied', { name: primary.node.name }),
  };
});

// Paste style: the copied styles replace the target's, one undo step, through the same holders every style write uses
// (styleHolders: the class that is the style target, or the elements, an instance's part going to its component).
// Text, children and attributes stay; a locked element, or one inside a locked element, refuses and keeps its styles.
export const pasteStyleCommand = registerHandler('clipboard.pasteStyle', (context, { clipboard }): Outcome<never> => {
  const { state } = context;
  const content = clipboard as ClipboardContent | undefined;
  // a run with nothing read (the context menu asking whether the command could run) says the clipboard holds nothing
  if (content === undefined) return { kind: 'change', message: message('status.paste.empty') };
  if (content.status === 'denied') return { kind: 'refused', message: message('status.clipboard.denied') };
  const styles = copiedStyles(content.text);
  if (styles === null) return { kind: 'refused', message: message('status.paste.empty') };
  const roots = selectionRoots(state.document, state.selection);
  if (roots.length === 0) return { kind: 'refused', message: message('refusal.nothingSelected') };
  const locked = firstLockRefusal(state.document, roots.map((root) => root.node.id), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const holders = styleHolders(context, roots);
  const said = holders.length === 1 ? message('status.style.pasted', { name: holders[0]?.name ?? '' }) : message('status.style.pastedMany', { count: holders.length });
  // a holder that already holds these styles stays: a paste of what is there records nothing
  const patches: Patch[] = holders.flatMap((holder) => (deepEqual(holder.node.styles, styles) ? [] : [{ op: 'replace' as const, path: [...holder.path, 'styles'], value: styles }]));
  return patches.length === 0 ? { kind: 'change', message: said } : { kind: 'change', patches, message: said };
});

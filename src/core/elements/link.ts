// element.setLink (INVENTORY.md, owners; spec elements-structure): the link of a Link Block or a link, its
// attribute `href` (elements.json gives it those element types and this command). Its door is the Settings tab's Link
// address field, which hands the node it stands for and the text it holds (kept on Enter and when the field loses the
// focus, src/editor/shell/inspector.tsx); without a node, the one selected element.
//  - The text is taken without the spaces around it. An empty one removes the link: the element then has no `href`,
//    and nothing invents one (spec, Problems in Pager 4); status.link.removed names the element.
//  - The one rule of an address decides (core/elements/address.ts): a path, a #section, https:, mailto: and tel: are
//    taken, a bare domain is stored as https://…, and javascript: or data: is refused with status.url.unsafe — the
//    document keeps its link.
//  - A locked element, or one inside a locked element, keeps its link (spec lock-element): status.locked.edit, or
//    status.locked.byAncestor naming the lock.
//  - The same link records nothing (history.noChange "no-entry"); status.link.set names the element and its link.
//  - Opening in a new tab (elements-text) and the page and anchor of the link picker (link-picker) arrive with their
//    features: no door hands them yet.
import { message, registerHandler } from '../commands/registry.ts';
import type { NodeId } from '../document/model.ts';
import { locate, walk } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { freshId } from './inputs.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { readAddress } from './address.ts';
import { argumentRefused } from '../store/args.ts';

// the attribute that holds a link (elements.json: its command is element.setLink, its value an address)
const LINK = 'href';
// the attribute that opens the link in a new tab (elements.json newTab, a boolean)
const NEW_TAB = 'newTab';

export const setLinkCommand = registerHandler('element.setLink', ({ state, rules }, { target, href, newTab, page, anchor }) => {
  const id = target ?? (state.selection.length === 1 ? state.selection[0] : undefined);
  if (id === undefined) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const found = locate(state.document, id);
  if (!found) throw new Error(`element.setLink: the document has no node ${id}`);
  const appliesTo = rules.attributes.get(LINK);
  // an element that takes no link is refused naming it (the command bar can reach the command on any element)
  if (appliesTo === undefined || (appliesTo !== 'all' && !appliesTo.includes(found.node.type))) return { kind: 'refused', message: message('status.element.notApplicable', { command: { key: 'command.setLink' }, name: found.node.name }) };

  const locked = lockRefusal(state.document, found.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  // Open in a new tab (elements-text): the attribute newTab, true or absent; the renderer and the export write it as
  // target="_blank" with rel="noopener noreferrer"
  if (typeof newTab === 'boolean') {
    const tabPath = [...found.path, 'attributes', NEW_TAB];
    const on = found.node.attributes[NEW_TAB] === true;
    const said = message(newTab ? 'status.link.newTab' : 'status.link.sameTab', { name: found.node.name });
    if (on === newTab) return { kind: 'change', message: said };
    return { kind: 'change', patches: [newTab ? { op: 'add', path: tabPath, value: true } : { op: 'remove', path: tabPath }], message: said };
  }
  const path = [...found.path, 'attributes', LINK];
  const stored = found.node.attributes[LINK];
  // The link picker's two other kinds (feature link-picker, the item doors): a page of the project (its file's path, as
  // the export writes it) and an element of the page (a reference by node id — "#inicio" is what the page writes, and
  // the reference follows the target's id attribute, A3.4).
  if (page !== undefined || anchor !== undefined) {
    const patches: Patch[] = [];
    let written: string;
    // what the status names: the fragment the page will write, never the internal id the document keeps
    let shown: string;
    if (anchor !== undefined) {
      const held = locate(state.document, anchor as NodeId);
      if (held === null) throw new Error(`element.setLink: the document has no node ${String(anchor)}`);
      // the element is changed too when it takes an id: a locked one keeps what it holds (the audit's LK1)
      const lockedAnchor = held.node.attributes.id === undefined || String(held.node.attributes.id) === '' ? lockRefusal(state.document, held.node.id, 'status.locked.edit') : null;
      if (lockedAnchor !== null) return { kind: 'refused', message: lockedAnchor };
      const own = held.node.attributes.id === undefined || String(held.node.attributes.id) === '' ? freshId(state.document, held.node.name) : String(held.node.attributes.id);
      if (held.node.attributes.id === undefined || String(held.node.attributes.id) === '') patches.push({ op: 'add', path: [...held.path, 'attributes', 'id'], value: own });
      written = `#${held.node.id}`;
      shown = `#${own}`;
    } else {
      const chosen = state.document.pages.find((one) => one.file === page);
      if (chosen === undefined) throw new Error(`element.setLink: the project has no page ${String(page)}`);
      written = chosen.file;
      shown = chosen.file;
    }
    if (stored !== written) patches.push({ op: stored === undefined ? 'add' : 'replace', path, value: written });
    return { kind: 'change', patches, message: message('status.link.set', { name: found.node.name, href: shown }) };
  }
  // a door hands an address, a page, a section or the new-tab choice; a call with none is refused with words
  if (typeof href !== 'string') return { kind: 'refused', message: argumentRefused('href') };
  const typed = href.trim();
  if (typed === '') {
    const removed = message('status.link.removed', { name: found.node.name });
    return stored === undefined ? { kind: 'change', message: removed } : { kind: 'change', patches: [{ op: 'remove', path }], message: removed };
  }
  // the one rule of an address (core/elements/address.ts, the audit's A3.2): a relative path, a #section, a project
  // page, https:, mailto: and tel: are taken; a bare domain is stored as https://…; javascript: and data: are refused
  const read = readAddress(typed);
  if (!read.ok) return { kind: 'refused', message: read.refusal };
  // A fragment names an element of the page — by its id attribute, or by the node itself (the picker writes these, and
  // A3.4 makes the page follow the target's id attribute). One that names nothing is refused here, with its reason: the
  // document's own validator would drop the write without a word, since a reference to nothing is invalid.
  if (read.value.startsWith('#')) {
    const named = read.value.slice(1);
    const ids = new Set<string>();
    for (const page of state.document.pages) for (const node of walk(page.tree)) if (typeof node.attributes.id === 'string') ids.add(node.attributes.id);
    if (locate(state.document, named as NodeId) === null && !ids.has(named)) return { kind: 'refused', message: message('status.link.noSection', { name: named }) };
  }
  // what was typed and what is stored differ when the rule normalised it (a bare domain): the status says so
  const set = read.value === typed ? message('status.link.set', { name: found.node.name, href: read.value }) : message('status.url.normalized', { url: typed, value: read.value });
  if (stored === read.value) return { kind: 'change', message: set };
  return { kind: 'change', patches: [{ op: stored === undefined ? 'add' : 'replace', path, value: read.value }], message: set };
});

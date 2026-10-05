// The link picker's state (INVENTORY.md, owners; spec elements-structure; the user's real-use audit, item
// 7.4): the one place that chooses what a link points at. Its state is editor state (ui.linkPicker: the node whose
// link is being chosen, or null); nothing of it is document state. The view that draws it is shell/link-picker.tsx;
// this module owns the three commands that open it, switch the kind of link and close it.
import { message, registerHandler, type RegisteredHandler } from '../../core/commands/registry.ts';
import { locate, type DocumentJson, type NodeId } from '../../core/document/model.ts';
import type { EditorUi } from '../state.ts';

// The kind of link a stored href is (the picker's kinds): a page of the project (its file), an element of the page (a
// fragment, kept as "#" and the element's node id), an email address, a phone number, else a web address.
export function linkKindOf(document: DocumentJson, href: string): string {
  if (href.startsWith('#')) return 'anchor';
  if (href.startsWith('mailto:')) return 'email';
  if (href.startsWith('tel:')) return 'phone';
  if (href !== '' && document.pages.some((page) => page.file === href)) return 'page';
  return 'url';
}

// The picker opens on the kind its link holds (the user's review of 2026-10-05, LR2: a link to a page opened on "A web
// address"), a link with none on the web address.
export const openLinkPicker = registerHandler<'linkPicker.open', EditorUi>('linkPicker.open', ({ state }, { target }) => {
  const node = (target as NodeId | undefined) ?? state.selection[0];
  if (node === undefined) return { kind: 'refused', message: message('status.needsSingleSelection') };
  if (state.ui.linkPicker?.node === node) return { kind: 'change' };
  const href = locate(state.document, node)?.node.attributes.href;
  return { kind: 'change', ui: { ...state.ui, linkPicker: { node, kind: linkKindOf(state.document, href === undefined ? '' : String(href)) } } };
});

export const setLinkKind = registerHandler<'linkPicker.setKind', EditorUi>('linkPicker.setKind', ({ state }, { kind }) => {
  if (state.ui.linkPicker === null) return { kind: 'change' };
  if (state.ui.linkPicker.kind === kind) return { kind: 'change' };
  return { kind: 'change', ui: { ...state.ui, linkPicker: { ...state.ui.linkPicker, kind } } };
});

export const closeLinkPicker = registerHandler<'linkPicker.close', EditorUi>('linkPicker.close', ({ state }) =>
  state.ui.linkPicker === null ? { kind: 'change' } : { kind: 'change', ui: { ...state.ui, linkPicker: null } },
);

// A page or an element chosen in the picker ends the choice (spec elements-structure, the link picker; the journey
// "site": the picker stayed open after "Sobre" was chosen, the next click on the canvas only closed it, and the next
// choice went to the link still in the picker). element.setLink stays its owner's (core/elements/link.ts); once it
// has set the link from a picker item, the picker closes. A typed address keeps the picker open.
export function closingPicker(owner: RegisteredHandler<'element.setLink', EditorUi>): RegisteredHandler<'element.setLink', EditorUi> {
  return {
    ...owner,
    run(context, args) {
      const outcome = owner.run(context, args);
      const fromItem = args.page !== undefined || args.anchor !== undefined;
      if (outcome.kind !== 'change' || !fromItem || context.state.ui.linkPicker === null) return outcome;
      return { ...outcome, ui: { ...(outcome.ui ?? context.state.ui), linkPicker: null } };
    },
  };
}

// The link picker (spec elements-structure; the user's real-use audit, item 7.4): what a link points at, chosen in one
// place. Its state is the link picker's own (shell/link-picker.ts, ui.linkPicker); the view draws:
//  - the five kinds as a segmented group (the doors of linkPicker.setKind, region "link-picker"): a web address, a page
//    of the project, an element of this page (an anchor), an email address, a phone number;
//  - the body of the kind: an address field (the href door, typed with the kind's own input type — url, email, tel),
//    the pages of the project as items (element.setLink#link-picker-page-item, each standing for one page's file), or
//    the elements of the page that carry an id as items (element.setLink#link-picker-anchor-item, each standing for one
//    element) — the reference is kept by the element, so renaming its id follows (A3.4);
//  - the close button, a click on the shield and Escape (the picker's own key context in keymap.ts).
import { useEffect, useRef } from 'react';
import { locate, walk, type DocumentJson } from '../../core/document/model.ts';
import { openedPage } from '../../core/project/pages.ts';
import { canvasValue } from '../../core/files/values.ts';
import { DoorControl } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useEditorState, useStore } from '../store.ts';
import { useOutsideLayer } from './outside-layer.ts';
import { linkKindOf } from './link-picker.ts';
import { useT } from '../text.ts';

const PARTS = doorSlots('link-picker');
const KINDS = PARTS.filter((p) => p.door.kind === 'panel-control' && p.door.drawnAs === 'segment');
const PAGE_ITEM = PARTS.find((p) => p.door.kind === 'panel-control' && p.door.kind === 'panel-control' && p.door.control === 'page-item') ?? null;
const ANCHOR_ITEM = PARTS.find((p) => p.door.kind === 'panel-control' && p.door.kind === 'panel-control' && p.door.control === 'anchor-item') ?? null;
const CLOSE = PARTS.find((p) => p.door.kind === 'panel-control' && p.door.kind === 'panel-control' && p.door.control === 'close') ?? null;
// the field that writes the address: the Link address door (element.setLink#inspector-href), drawn in the picker too
const HREF = doorSlots('inspector-settings').find((p) => p.door.kind === 'inspector-field' && p.door.attribute === 'href');
const PICKER_CONTEXT = 'link-picker';
// the input type each kind types with (an address, an email, a phone number)
const INPUT_TYPES: Readonly<Record<string, string>> = { url: 'text', email: 'email', phone: 'tel' };

// The elements of the OPEN page that carry an id: what a link may point at as a fragment. An anchor is a fragment of
// one page — `#id` reaches nothing on another — so the list holds the open page's own elements (the interface audit,
// finding F31; the picker's own reader reads them the same way).
function idElements(document: DocumentJson, page: number): readonly { readonly id: string; readonly name: string; readonly value: string }[] {
  const tree = document.pages[page]?.tree;
  if (tree === undefined) return [];
  const found: { readonly id: string; readonly name: string; readonly value: string }[] = [];
  for (const node of walk(tree)) {
    if (node.attributes.id === undefined || String(node.attributes.id) === '') continue;
    found.push({ id: node.id, name: node.name, value: `#${String(node.attributes.id)}` });
  }
  return found;
}

export function LinkPicker() {
  const t = useT();
  const store = useStore();
  const open = useEditorState((s) => s.ui.linkPicker);
  const document = useEditorState((s) => s.document);
  // the page whose anchors are offered: the one the editor has open (finding F31)
  const page = useEditorState((s) => openedPage(s));
  const panel = useRef<HTMLDivElement>(null);
  useOutsideLayer(panel, open !== null, () => closeLinkPicker(store));
  useEffect(() => {
    if (open !== null) panel.current?.focus();
  }, [open]);
  if (open === null) return null;
  const node = locate(document, open.node);
  if (node === null) return null;
  // what the link holds now, as the picker's own reading (the same resolver the page's writers ask)
  const stored = node.node.attributes.href === undefined ? '' : String(node.node.attributes.href);
  const shown = canvasValue(document, 'href', stored) ?? '';
  const kind = open.kind;
  const kinds = KINDS.map((entry) => ({ entry, kind: String(entry.door.args.kind ?? '') }));
  const pickKind = kind === 'page' || kind === 'anchor';
  return (
    <div className="picker-shield">
      <div
        ref={panel}
        className="picker picker--link"
        role="dialog"
        aria-label={t('linkPicker.title')}
        data-region="link-picker"
        data-key-context={PICKER_CONTEXT}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {/* its title and its close button at its head, as every dialog's (LR2: the close stood at its foot) */}
        <div className="picker__head">
          <p className="picker__header">{t('linkPicker.title')}</p>
          {CLOSE === null ? null : <DoorControl entry={CLOSE} />}
        </div>
        {/* the kinds hug their words and wrap to a second line when the picker is narrower than them all (the audit's
            U-007: stretched to equal widths they overprinted each other) */}
        <span className="segmented segmented--hug" role="group" aria-label={t('command.linkPicker.setKind')}>
          {kinds.map(({ entry }) => (
            <DoorControl key={entry.ref} entry={entry} current={String(entry.door.args.kind ?? '') === kind} />
          ))}
        </span>
        {/* what the link points at now, said once: the field or the marked item of its own kind says it, so the line shows
            only while another kind is shown, or while the link holds nothing */}
        {stored === '' ? <p className="picker__value" data-link-current>{t('linkPicker.none')}</p> : linkKindOf(document, stored) === kind ? null : <p className="picker__value" data-link-current>{shown}</p>}
        {pickKind ? null : HREF === undefined ? null : (
          <form
            className="field-row"
            data-door={HREF.ref}
            onSubmit={(event) => {
              event.preventDefault();
              const field = event.currentTarget.querySelector<HTMLInputElement>('input, textarea');
              if (field === null) return;
              (store.dispatch as (id: string, args: unknown) => unknown)(HREF.command.id, { target: node.node.id, href: field.value });
              closeLinkPicker(store);
            }}
          >
            <span className="field-row__label">{t('linkPicker.address')}</span>
            <input className="input" type={INPUT_TYPES[kind] ?? 'text'} aria-label={t('linkPicker.address')} defaultValue={stored.startsWith('#') ? '' : stored} spellCheck={false} />
          </form>
        )}
        {kind === 'page' && PAGE_ITEM !== null
          ? document.pages.map((page) => <DoorControl key={page.id} entry={PAGE_ITEM} args={{ target: node.node.id, page: page.file }} label={`${page.name} · ${page.file}`} current={stored === page.file} />)
          : null}
        {kind === 'anchor' && ANCHOR_ITEM !== null
          ? idElements(document, page).map((element) => (
              <DoorControl key={element.id} entry={ANCHOR_ITEM} args={{ target: node.node.id, anchor: element.id }} label={`${element.name} · ${element.value}`} current={stored === `#${element.id}`} />
            ))
          : null}
        {kind === 'anchor' && idElements(document, page).length === 0 ? <p className="picker__warning" role="note">{t('linkPicker.noAnchors')}</p> : null}
      </div>
    </div>
  );
}

function closeLinkPicker(store: ReturnType<typeof useStore>): void {
  const close = doorSlots('link-picker').find((p) => p.door.kind === 'panel-control' && p.door.kind === 'panel-control' && p.door.control === 'close');
  if (close !== undefined) (store.dispatch as (id: string, args: unknown) => unknown)(close.command.id, {});
}

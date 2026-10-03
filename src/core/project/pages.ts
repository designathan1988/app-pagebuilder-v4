// The pages of the project (INVENTORY.md, owners; spec explorer-pages): how a project gains a page, keeps
// its name and its file straight, and loses one. The document holds them in their order (`document.pages`), the
// Explorer lists them, and every command that acts on "the page" reads the first one until pages.switch arrives.
//
// pages.add (the Explorer's Pages section header): a page named after the text its door hands (refused when another
// page holds it), or the next free default name ("Page", "Page 2"…; spec explorer-pages, Problems 3); its file is the
// name's slug ("About us" -> about-us.html), numbered when taken, and its root is the root element the manifest gives
// every page (validate.ts ModelRules.root). The new page opens (spec explorer-pages, "listing a page and opening it"):
// the editor shows what was just added, so the canvas, the Layers, the top bar's switcher and an insert all follow it.
// One undo step.
// pages.rename: the page's name, and its root's (spec explorer-pages, Problems 4); the file follows it while another
// page holds neither (so a file a link points at is never taken silently), and a name another page already holds is
// refused.
// pages.duplicate: a copy right after the page, every node with an id and a styles record of its own, "About 2" when
// "About" is taken; the copy opens and its name field takes the focus, as a page the + adds (jornada03 J20).
// pages.delete: the page goes; the home page (index.html, what the project opens on) cannot be deleted, and a project
// keeps at least one page.
import { message, registerHandler } from '../commands/registry.ts';
import type { DocNode, DocumentJson, Page } from '../document/model.ts';
import { refreshCopiedIdentities } from '../document/clone.ts';
import type { Patch } from '../history/transaction.ts';
import { walk, type NodeId } from '../document/model.ts';
import { releaseReferencesPatch } from '../document/tree.ts';
import { followPaths, movedPath } from '../files/references.ts';
import { slug } from '../text/fold.ts';
import { registerReferenceKind } from '../store/references.ts';
import { argumentRefused } from '../store/args.ts';

// A page's name as a file name: lower case, no accent, its words joined by one dash (spec explorer-pages).
export function pageFile(name: string): string {
  const words = slug(name);
  return `${words === '' ? 'page' : words}.html`;
}

// The home page: a page the project cannot lose, and the file a rename never hands to another page.
const HOME = 'index.html';

// The first free name and file for a base: "About", "About 2", "About 3"…
function fresh(names: readonly string[], files: readonly string[], base: string): { readonly name: string; readonly file: string } {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base} ${n}`;
    const file = pageFile(name);
    if (!names.includes(name) && !files.includes(file)) return { name, file };
  }
}

// Whether a page is the one a value names: its id, its root's, or its file (a link to a page names its file). The one
// reading of a page reference, for the commands and for the store's check of what an argument names (refers: page).
const pageNamed = (p: Page, value: unknown): boolean => p.id === value || p.tree.id === value || p.file === value;

// The page a command acts on, by the id its door hands (a door that hands none is a defect of the door).
function pageIndex(pages: readonly Page[], page: unknown): number {
  const at = pages.findIndex((p) => pageNamed(p, page));
  if (at < 0) throw new Error(`pages: the document has no page ${String(page)}`);
  return at;
}

// The page the editor shows: the one pages.switch opened (`ui.page`, an id), else the project's first. Every command
// that acts on "the page" — page.setSetting, the grid settings, an insert at the root, the canvas — reads it here, so
// one page is open everywhere at once. An unknown id (a page that was deleted) reads as the first, and the editor
// keeps working.
export function openedPage(state: { readonly document: { readonly pages: readonly Page[] }; readonly ui?: unknown }): number {
  const named = (state.ui as { readonly page?: unknown } | undefined)?.page;
  if (typeof named !== 'string') return 0;
  const at = state.document.pages.findIndex((p) => p.id === named || p.tree.id === named);
  return at < 0 ? 0 : at;
}

// The open page, for the readers that need the page itself (the canvas, the page's panel).
export const pageShown = (state: { readonly document: { readonly pages: readonly Page[] }; readonly ui?: unknown }): Page | null => state.document.pages[openedPage(state)] ?? null;

// A page name no other page's root holds: a node path names a page by its root's name (src/manifest/scenario.ts), so
// two pages never share one.
// A base already numbered ("Page 2") counts on from its stem ("Page 3"), never "Page 2 2".
function rootName(pages: readonly Page[], base: string): string {
  const taken = pages.map((p) => p.tree.name);
  if (!taken.includes(base)) return base;
  const stem = base.replace(/ \d+$/, '');
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? stem : `${stem} ${n}`;
    if (!taken.includes(name)) return name;
  }
}

export function addPageCommand<Ui extends WithPage>() {
  return registerHandler<'pages.add', Ui>('pages.add', ({ state, ids, rules, words }, { name }) => {
  const document = state.document;
  const given = typeof name === 'string' && name.trim() !== '';
  const typed = given ? name.trim() : words('pages.defaultName');
  // a name the person gave is theirs, refused when taken; the default name takes the next free one ("Page 2")
  if (given && document.pages.some((p) => p.name === typed)) return { kind: 'refused' as const, message: message('status.pages.nameTaken', { name: typed }) };
  const { name: chosen, file } = fresh(document.pages.map((p) => p.name), document.pages.map((p) => p.file), typed);
  const root: DocNode = { id: ids.next(), type: rules.root.type, name: rootName(document.pages, chosen), tag: rules.root.tag, attributes: {}, classes: [], styles: {}, text: null, children: [] };
  const made: Page = { id: ids.next(), name: chosen, file, tree: root };
  return { kind: 'change' as const, patches: [{ op: 'add', path: ['pages', document.pages.length], value: made }], ui: { ...state.ui, page: made.id }, selection: [], message: message('status.pages.added', { name: chosen, file }) };
  });
}

export const renamePageCommand = registerHandler('pages.rename', ({ state }, { page, name }) => {
  const document = state.document;
  const at = pageIndex(document.pages, page);
  const held = document.pages[at];
  const typed = typeof name === 'string' ? name.trim() : '';
  if (held === undefined) throw new Error(`pages.rename: the document has no page ${String(page)}`);
  if (typed === '') return { kind: 'refused' as const, message: argumentRefused('name') };
  if (held.name === typed) return { kind: 'change' as const, message: message('status.pages.renamed', { name: typed }) };
  if (document.pages.some((p, i) => i !== at && p.name === typed)) return { kind: 'refused' as const, message: message('status.pages.nameTaken', { name: typed }) };
  const wanted = pageFile(typed);
  // the home page keeps its file (index.html is what the project opens on); another page's file follows its new name
  // while nothing else holds it, so a file a link points at is never taken silently
  const free = held.file !== HOME && wanted !== HOME && !document.pages.some((p, i) => i !== at && p.file === wanted);
  const patches: Patch[] = [{ op: 'replace', path: ['pages', at, 'name'], value: typed }];
  // the page's root takes its new name too (the journey "site": the page Contato's root read "Page 3" in the Layers,
  // the breadcrumb and the status bar), unique among the pages' roots
  const root = rootName(document.pages.filter((_, i) => i !== at), typed);
  if (held.tree.name !== root) patches.push({ op: 'replace', path: ['pages', at, 'tree', 'name'], value: root });
  // the links to the page follow its file (references.ts): a link written "about.html" becomes "sobre.html"
  if (free && held.file !== wanted) patches.push({ op: 'replace', path: ['pages', at, 'file'], value: wanted }, ...followPaths(document, movedPath(held.file, wanted)));
  return { kind: 'change' as const, patches, message: message('status.pages.renamed', { name: typed }) };
});

// A copy of a page, as pages.duplicate and the pages made from a page make one (core/data/commands.ts): every node
// with an id and a styles record of its own, its HTML ids and references repaired, named from `base` ("About 2" when
// "About" is taken), its file and its root's name following its name. A copy is never the page made for an item: that
// mark stays with the page it was made on.
export function copyPage(document: DocumentJson, source: Page, base: string, next: () => NodeId): Page {
  // every node of the copy gets an id of its own and its own styles record; the rest of the node is data
  const copy = (node: DocNode): DocNode => ({ ...node, id: next(), classes: [...node.classes], styles: structuredClone(node.styles), children: node.children.map(copy) });
  const { name, file } = fresh(document.pages.map((p) => p.name), document.pages.map((p) => p.file), base);
  const plainCopy = copy(source.tree);
  const tree = refreshCopiedIdentities(document, [{ source: source.tree, copy: plainCopy }])[0];
  if (tree === undefined) throw new Error('pages: the copied tree is missing');
  const { dataItem: _item, ...root } = tree;
  void _item;
  return { id: next(), name, file, tree: { ...root, name: rootName(document.pages, name) } };
}

export function duplicatePageCommandFor<Ui extends WithPage>() {
  return registerHandler<'pages.duplicate', Ui>('pages.duplicate', ({ state, ids }, { page }) => {
    const document = state.document;
    const at = pageIndex(document.pages, page);
    const source = document.pages[at];
    if (source === undefined) throw new Error(`pages.duplicate: the document has no page ${String(page)}`);
    // a copy of "About 2" is "About 3", never "About 2 2": the number a copy took is not part of the name
    const base = source.name.replace(/ \d+$/, '');
    const made = copyPage(document, source, base, () => ids.next() as NodeId);
    // the copy goes after the source and the copies of it that follow it, so copies line up in the order they were made
    // (the audit's AUD-27: Home, Home 3, Home 2 after two copies)
    const copyOfBase = (name: string): boolean => name.startsWith(`${base} `) && /^\d+$/.test(name.slice(base.length + 1));
    let place = at + 1;
    while (place < document.pages.length && copyOfBase(document.pages[place]?.name ?? '')) place += 1;
    // the copy opens (the selection goes with the page left), and its name field takes the focus
    // (shell/sidebar/explorer.tsx)
    return { kind: 'change' as const, patches: [{ op: 'add', path: ['pages', place], value: made }], ui: { ...state.ui, page: made.id }, selection: [], message: message('status.pages.duplicated', { name: source.name, copy: made.name, file: made.file }) };
  });
}

// the command for a caller that holds no editor state (the core's tests)
export const duplicatePageCommand = duplicatePageCommandFor<never>();

export const deletePageCommand = registerHandler('pages.delete', ({ state, confirmed }, { page }) => {
  const document = state.document;
  const at = pageIndex(document.pages, page);
  const held = document.pages[at];
  if (held === undefined) throw new Error(`pages.delete: the document has no page ${String(page)}`);
  if (held.file === HOME) return { kind: 'refused' as const, message: message('status.pages.homeUndeletable') };
  // a whole page goes: the person is asked first (the manifest's dialog.deletePage), with the page's name
  if (confirmed !== true) return { kind: 'confirm' as const, params: { name: held.name } };
  // what other pages point at in it goes with it, in the same undo step: a link to one of its elements, an
  // interaction that acts on one (element delete's rule, tree.ts)
  const leaving = new Set([...walk(held.tree)].map((node) => node.id as NodeId));
  const released = releaseReferencesPatch(document, leaving);
  // the selection goes with the page: a node of a page that is not open is not on the canvas (the store reads the
  // open page through openedPage, which falls back to the first while ui.page names a page that is gone)
  return { kind: 'change' as const, patches: [...released, { op: 'remove', path: ['pages', at] }], selection: [], message: message('status.pages.deleted', { name: held.name }) };
});

// the editor state's part pages.switch owns: the page the editor shows (the editor's EditorUi is wider)
export interface WithPage {
  readonly page?: string | undefined;
}

// pages.switch: the page the editor shows (the Explorer's rows, the file tabs, the top bar's page switcher). It
// changes no document field — the open page belongs to the editor, not to the project — so it is an editor change
// (Outcome.ui), and the door of the page that is already open is current (the row is drawn marked). Bound to the
// editor state the app holds, as handCommands is.
export function switchPageCommand<Ui extends WithPage>() {
  return registerHandler<'pages.switch', Ui>(
    'pages.switch',
    ({ state }, { page }) => {
      const at = pageIndex(state.document.pages, page);
      const held = state.document.pages[at];
      if (held === undefined) throw new Error(`pages.switch: the document has no page ${String(page)}`);
      const said = message('status.pages.opened', { name: held.name });
      if (openedPage(state) === at) return { kind: 'change' as const, message: said };
      // the selection goes with the page: the panel and the handles would otherwise edit a node the canvas no
      // longer draws
      return { kind: 'change' as const, ui: { ...state.ui, page: held.id }, selection: [], message: said };
    },
    // a door of this command stands for the open page by the id its item carries: a page's own id or its root's
    // (pageIndex takes either), so a tab, a row or the switcher is marked while its page is the one on the canvas
    (state, { page }) => {
      const open = state.document.pages[openedPage(state)];
      return open !== undefined && (open.id === page || open.tree.id === page);
    },
  );
}

// a page an argument names (manifest refers: page), by its id, its root's or its file (a link to a page names its file)
registerReferenceKind('page', (document, value) => document.pages.some((page) => pageNamed(page, value)));

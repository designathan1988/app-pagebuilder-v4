// project.openFolder (INVENTORY.md, owners; the manifest's explorer-open-folder): a folder the person
// picked with the browser's directory picker read into a project. Every file lands at the same path in the project's
// tree, except one whose path belongs to a generated file (css/styles.css, js/interactions.js): that one is kept under
// a new name (css/styles-1.css, core/files/files.ts pathGenerated). A page's HTML goes through the one owner of
// reading markup (core/import/import.ts, the same rules the clipboard and the code pane's markup read by), so an
// imported page is an ordinary page of the document; the stylesheets its pages link are resolved from the folder and
// read into the document's styles by the one reader of a stylesheet (core/import/css.ts) — the document JSON is the
// source of truth, and the .css file stays in the tree as an ordinary file no page links any more. JS, images and
// fonts are kept as files. Each page becomes a page named after its file, at its path (about/index.html is the page
// index in the folder about), and the root index.html is the home page; a folder without one gets an empty home page
// index.html. What the import converted, kept, made or dropped is the report the status bar tells.
//
// The command replaces the project (outcome `load`): it asks first over work (outcome `confirm`, the manifest's
// confirmation) and the selection and the history start empty, as File › Open project does.
import { message, registerHandler, type HandlerContext, type Message, type MessageParam } from '../commands/registry.ts';
import { projectLanguages } from './import.ts';
import { DOCUMENT_VERSION, isEmptyProject, type DocNode, type DocumentJson, type Page, type ProjectFile } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { folderOf, nameOfPath, pathGenerated, resolveHref, typeOfFile, type UploadedFile } from '../files/files.ts';
import { nodeMaker } from '../structure/insert.ts';
import { placeSheet, readSheet } from './css.ts';
import { nodesFromMarkup } from './import.ts';
import { pageHead } from './markup.ts';

// A file of the folder the person picked: what the one reader of a file a door hands over gives (core/files/files.ts
// readUploadFile), with the path it holds inside the folder.
export interface FolderFile extends UploadedFile {
  readonly path: string;
}

export interface FolderImport {
  readonly name: string;
  readonly files: readonly FolderFile[];
}

export interface FolderReport {
  // the pages the folder's HTML became, in the project's order
  readonly pages: readonly { readonly path: string; readonly name: string }[];
  // the stylesheets that were read into the document's styles (their files stay in the tree)
  readonly stylesheets: readonly string[];
  // every file kept as it is
  readonly kept: readonly string[];
  // the files the folder did not hold and the import made (an empty home page)
  readonly created: readonly string[];
  // the files kept under another name, their path belonging to a generated file
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  // what could not come through: the pieces the markup reader dropped, and the stylesheet rules and declarations the
  // style reader could not place
  readonly droppedElements: number;
  readonly droppedAttributes: number;
  readonly droppedRules: number;
}

const isHtml = (path: string): boolean => /\.html?$/i.test(path);
// An imported element carries only what the source says: the defaults a palette insert gives an element of its type
// (a div's padding 0, an image's max-width, elements.json defaultStyles) are taken off, so a rule read from a linked
// stylesheet — a class's padding — is not overridden by a value the source never wrote.
function withoutDefaults(node: DocNode, rules: ModelRules): DocNode {
  const defaults = rules.elements.get(node.type)?.defaultStyles ?? {};
  const { breakpoint, state } = rules.baseLayer;
  const layers = node.styles as Record<string, Record<string, Record<string, unknown>>>;
  const declarations = layers[breakpoint]?.[state];
  let styles = node.styles;
  if (declarations !== undefined) {
    const kept = Object.fromEntries(Object.entries(declarations).filter(([property, value]) => defaults[property as keyof typeof defaults] !== value));
    if (Object.keys(kept).length !== Object.keys(declarations).length) {
      // the layer a declaration was taken from goes with it, so nothing the source never wrote stays behind
      const states = Object.entries(layers[breakpoint] as Record<string, Record<string, unknown>>)
        .filter(([name]) => name !== state)
        .map(([name, held]) => [name, held] as const);
      if (Object.keys(kept).length > 0) states.push([state, kept] as const);
      const rest = Object.entries(layers).filter(([name]) => name !== breakpoint);
      if (states.length > 0) rest.push([breakpoint, Object.fromEntries(states)] as [string, Record<string, Record<string, unknown>>]);
      styles = Object.fromEntries(rest) as DocNode['styles'];
    }
  }
  return { ...node, styles, children: node.children.map((child) => withoutDefaults(child, rules)) };
}
const textOf = (bytes: string): string => new TextDecoder().decode(Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0)));

// The name a page takes from its file ("index.html" of the root: the home page's name; "about/index.html" -> "About";
// "about-us.html" -> "About us"): the file's last part without its extension, or its folder's name for an index file,
// its dashes and underscores as spaces and its first letter in upper case.
function pageNameOf(path: string, home: string): string {
  const parts = path.split('/').filter((one) => one !== '');
  const file = parts.pop() ?? '';
  const stem = file.slice(0, file.lastIndexOf('.') < 0 ? file.length : file.lastIndexOf('.'));
  const chosen = stem.toLowerCase() === 'index' ? (parts.pop() ?? '') : stem;
  const words = chosen.replace(/[-_]+/g, ' ').trim();
  if (words === '') return home;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The first free name for a base: "About", "About 2", "About 3"…
function freshName(taken: Set<string>, base: string): string {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
}

// The first free path beside a taken one: "css/styles.css" -> "css/styles-1.css", then "-2", "-3"… (the generated
// paths the tree holds cannot be taken, so an imported file that claims one moves aside).
function freePath(path: string, taken: ReadonlySet<string>): string {
  const folder = folderOf(path);
  const name = nameOfPath(path);
  const at = name.lastIndexOf('.');
  const stem = at <= 0 ? name : name.slice(0, at);
  const extension = at <= 0 ? '' : name.slice(at);
  for (let n = 1; ; n += 1) {
    const made = `${folder === '' ? '' : `${folder}/`}${stem}-${n}${extension}`;
    if (!taken.has(made)) return made;
  }
}

// The folder's files read into a project document, with the report; or the refusal that names why it cannot be (no
// file at all, no HTML page, a page the markup reader refuses).
export function importFolder(folder: FolderImport, context: HandlerContext<unknown>): { readonly document: DocumentJson; readonly report: FolderReport } | { readonly refused: Message } {
  const { rules, ids, words } = context;
  const files = folder.files.filter((file) => file.path !== '');
  if (files.length === 0) return { refused: message('status.folder.unsupported') };
  if (!files.some((file) => isHtml(file.path))) return { refused: message('status.import.noPage') };
  // a file whose path belongs to a generated file keeps its content under another name (spec explorer-open-folder)
  const taken = new Set<string>(files.map((file) => file.path));
  const renamed: { from: string; to: string }[] = [];
  const kept: ProjectFile[] = [];
  // the path each file of the folder was kept at, by the path it arrived with (a link follows its file)
  const moved = new Map<string, string>();
  for (const file of files) {
    let path = file.path;
    if (pathGenerated(path)) {
      path = freePath(path, taken);
      taken.add(path);
      renamed.push({ from: file.path, to: path });
    }
    moved.set(file.path, path);
    if (isHtml(file.path)) continue;
    kept.push({ path, type: file.type === '' ? typeOfFile(file.path) : file.type, bytes: file.bytes, ...(file.width === undefined ? {} : { width: file.width }), ...(file.height === undefined ? {} : { height: file.height }) });
  }
  // a page per HTML file: the root index.html first (the home page), then the others by path
  const html = files.filter((file) => isHtml(file.path)).map((file) => file.path).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a < b ? -1 : 1));
  const home = words('pages.defaultHome');
  const pageNames = new Set<string>();
  const report: { pages: { path: string; name: string }[]; stylesheets: string[]; kept: string[]; created: string[]; renamed: { from: string; to: string }[]; droppedElements: number; droppedAttributes: number; droppedRules: number } = {
    pages: [],
    stylesheets: [],
    kept: kept.map((file) => file.path),
    created: [],
    renamed,
    droppedElements: 0,
    droppedAttributes: 0,
    droppedRules: 0,
  };
  let document: DocumentJson = { version: DOCUMENT_VERSION, pages: [] };
  const linked: { readonly page: string; readonly stylesheets: readonly string[] }[] = [];
  for (const path of html) {
    const file = files.find((one) => one.path === path);
    if (file === undefined) continue;
    const markup = textOf(file.bytes);
    const make = nodeMaker(document, rules, ids, words);
    const imported = nodesFromMarkup(markup, make, context as HandlerContext<never>);
    if ('line' in imported) {
      return { refused: message('status.folder.pageRefused', { path, reason: { key: imported.message.key, params: imported.message.params } }) };
    }
    report.droppedElements += imported.dropped.elements;
    report.droppedAttributes += imported.dropped.attributes;
    const head = pageHead(markup);
    const name = freshName(pageNames, path === 'index.html' ? home : pageNameOf(path, home));
    // the page's own settings, kept on its root as the page's panel keeps them (elements.json isPageSetting)
    const attributes: Record<string, unknown> = {};
    // the project's own language is no setting of the page (spec export-clean)
    if (head.lang !== null && head.lang !== (context.state.document.language ?? 'en')) attributes.pageLanguage = head.lang;
    if (head.dir === 'ltr' || head.dir === 'rtl') attributes.pageDirection = head.dir;
    if (head.title !== null) attributes.pageTitle = head.title;
    // the scripts the page runs, as the tree's paths (a script whose file the folder does not hold is dropped)
    const scripts = head.scripts.map((src) => resolveHref(path, src)).filter((one): one is string => one !== null && moved.has(one)).map((one) => moved.get(one) as string);
    if (scripts.length > 0) attributes.pageScripts = scripts.join(' ');
    const root: DocNode = {
      id: ids.next(),
      type: rules.root.type,
      name: freshName(new Set(make.taken), name),
      tag: rules.root.tag,
      attributes: attributes as DocNode['attributes'],
      classes: [],
      styles: {},
      text: null,
      children: imported.nodes.map((child) => withoutDefaults(child, rules)),
    };
    const made: Page = { id: ids.next(), name, file: path, tree: root };
    document = { ...document, pages: [...document.pages, made] };
    report.pages.push({ path, name });
    linked.push({ page: path, stylesheets: head.stylesheets });
  }
  // a folder without an index.html gets an empty home page, first (listed in the report as made)
  if (!document.pages.some((page) => page.file === 'index.html')) {
    const name = freshName(pageNames, home);
    const make = nodeMaker(document, rules, ids, words);
    const root: DocNode = { id: ids.next(), type: rules.root.type, name: freshName(make.taken, name), tag: rules.root.tag, attributes: {}, classes: [], styles: {}, text: null, children: [] };
    document = { ...document, pages: [{ id: ids.next(), name, file: 'index.html', tree: root }, ...document.pages] };
    report.pages.unshift({ path: 'index.html', name });
    report.created.push('index.html');
  }
  // the stylesheets the pages link, each read once: their rules land on the class registry and on the elements they
  // match (core/import/css.ts); the file itself stays in the tree
  const read = new Set<string>();
  for (const entry of linked) {
    for (const href of entry.stylesheets) {
      const original = resolveHref(entry.page, href);
      const path = original === null ? null : (moved.get(original) ?? null);
      const file = path === null ? undefined : files.find((one) => one.path === original);
      const record = path === null ? undefined : kept.find((one) => one.path === path);
      if (file === undefined || record === undefined || read.has(path as string)) continue;
      const sheet = readSheet(textOf(file.bytes));
      const placed = placeSheet(document, sheet, context);
      document = placed.document;
      report.droppedRules += placed.dropped;
      read.add(path as string);
      report.stylesheets.push(path as string);
    }
  }
  const documentFiles: DocumentJson = kept.length === 0 ? document : { ...document, files: kept };
  return { document: documentFiles, report };
}

// the words the import report is told in (status.folder.imported): the files by role, and what was dropped
const listOf = (entries: readonly string[]): MessageParam => (entries.length === 0 ? { key: 'status.folder.none' } : entries.join(', '));
export function reportMessage(folder: string, report: FolderReport): Message {
  return message('status.folder.imported', {
    folder: folder === '' ? { key: 'status.folder.unnamed' } : folder,
    pages: listOf(report.pages.map((page) => `${page.path} → ${page.name}`)),
    styles: listOf(report.stylesheets),
    kept: listOf(report.kept),
    created: listOf(report.created),
    renamed: listOf(report.renamed.map((one) => `${one.from} → ${one.to}`)),
    droppedElements: report.droppedElements,
    droppedAttributes: report.droppedAttributes,
    droppedRules: report.droppedRules,
  });
}

// File › Open folder: the folder the door read is imported and replaces the project (outcome `load`); a project that
// holds work is asked about first (the manifest's confirmation), and the empty one is replaced at once. A folder the
// import cannot read refuses with the reason and the project stays as it was.
export const openFolderCommand = registerHandler('project.openFolder', (context, { folder }) => {
  // the door hands over the folder it read (name and files), never the argument's declared text form
  const wanted = folder as unknown as FolderImport | undefined;
  const read = importFolder({ name: wanted?.name ?? '', files: wanted?.files ?? [] }, context);
  if ('refused' in read) return { kind: 'refused' as const, message: read.refused };
  if (context.confirmed !== true && !isEmptyProject(context.state.document)) return { kind: 'confirm' as const };
  // the opened folder becomes the project's content; its languages stay the project's (spec export-clean)
  return { kind: 'load' as const, document: { ...read.document, ...projectLanguages(context.state.document) }, message: reportMessage(wanted?.name ?? '', read.report) };
});

// project.openFolder (INVENTORY.md, owners; the manifest's explorer-open-folder): a folder the person
// picked with the browser's directory picker read into a project. Every file lands at the same path in the project's
// tree, except one whose path belongs to a generated file (css/styles.css, js/interactions.js): that one is kept under
// a new name (css/styles-1.css, core/files/files.ts pathGenerated) and what names it follows. The pages go through the
// HTML importer (core/import/import.ts importedSite, the one reader of a site's HTML: its cascade, media queries,
// states, style attributes, style blocks, scripts and the report with their lines); the audit's FO1 found a reader of
// the folder's own here (the code pane's strict reader and a second stylesheet reader, which dropped all of that). Each
// page is named after its file (about/index.html is the page index in the folder about, "About"), the root index.html
// is the home page, and a folder without one gets an empty home page. The original .css files stay as files no page
// links any more; scripts, images and fonts are kept as files.
//
// The command replaces the project (outcome `load`): it asks first over work (outcome `confirm`, the manifest's
// confirmation) and the selection and the history start empty, as File › Open project does.
import type { PickedFile } from '../../generated/commands.ts';
import { message, registerHandler, type HandlerContext, type Message, type MessageParam } from '../commands/registry.ts';
import type { MessageId } from '../../generated/ids.ts';
import { importedSite, pickedRefusal, projectLanguages, reportNotes } from './import.ts';
import { isEmptyProject, type DocNode, type DocumentJson, type Page, type ProjectFile } from '../document/model.ts';
import { folderOf, nameOfPath, pathGenerated, resolveHref, typeOfFile, type UploadedFile } from '../files/files.ts';
import { addressAttributes, followPaths } from '../files/references.ts';
import { applyPatches } from '../history/transaction.ts';
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
  // the stylesheets the pages link, read into the document's styles (their files stay in the tree)
  readonly stylesheets: readonly string[];
  // every file kept as it is
  readonly kept: readonly string[];
  // the files the folder did not hold and the import made (an empty home page)
  readonly created: readonly string[];
  // the files kept under another name, their path belonging to a generated file
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  // what the HTML importer reports of the pages and their sheets, in the person's words, with the source lines
  readonly notes: string;
}

const isHtml = (path: string): boolean => /\.html?$/i.test(path);
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
// file at all, no HTML page, an archive the reader refused).
export function importFolder<Ui>(folder: FolderImport, context: HandlerContext<Ui>): { readonly document: DocumentJson; readonly report: FolderReport } | { readonly refused: Message } {
  const { rules, ids, words } = context;
  const files = folder.files.filter((file) => file.path !== '');
  if (files.length === 0) return { refused: message('status.folder.unsupported') };
  // every file of the folder as the HTML importer reads picked files: by the path it holds in the folder, so the
  // pages' addresses find them
  const picked: PickedFile[] = files.map((file) => ({ name: file.path, type: file.type === '' ? typeOfFile(file.path) : file.type, bytes: file.bytes, ...(file.width === undefined ? {} : { width: file.width }), ...(file.height === undefined ? {} : { height: file.height }) }));
  const refused = pickedRefusal(picked);
  if (refused !== null) return { refused };
  const site = importedSite(context, picked, true);
  // The files: every file of the folder that is no page, in the folder's order (the importer's record where it kept
  // one), then the files the import made (an inline script's code).
  const made = new Map((site.document.files ?? []).map((file) => [file.path, file] as const));
  const kept: ProjectFile[] = [];
  for (const file of picked) {
    if (isHtml(file.name)) continue;
    kept.push(made.get(file.name) ?? { path: file.name, type: file.type, bytes: file.bytes, ...(file.width === undefined ? {} : { width: file.width }), ...(file.height === undefined ? {} : { height: file.height }) });
    made.delete(file.name);
  }
  kept.push(...made.values());
  // a file whose path belongs to a generated file moves aside, and what names it follows
  const taken = new Set<string>(kept.map((file) => file.path));
  const renamed: { from: string; to: string }[] = [];
  const moved = new Map<string, string>();
  for (const file of kept) {
    if (!pathGenerated(file.path)) continue;
    const to = freePath(file.path, taken);
    taken.add(to);
    moved.set(file.path, to);
    renamed.push({ from: file.path, to });
  }
  const files_ = kept.map((file) => (moved.has(file.path) ? { ...file, path: moved.get(file.path) as string } : file));
  let document: DocumentJson = { ...site.document, ...(files_.length === 0 ? {} : { files: files_ }) };
  if (files_.length === 0) {
    const { files: _dropped, ...rest } = document;
    void _dropped;
    document = rest;
  }
  if (moved.size > 0) document = applyPatches(document, followPaths(document, (path) => moved.get(path) ?? path, undefined, addressAttributes(rules))).document;
  // Each page named after its file, its root too, its head's title kept as its title; the root index.html first, then
  // the others by path. A folder without an index.html gets an empty home page, first.
  const home = words('pages.defaultHome' as MessageId);
  const pageNames = new Set<string>();
  const ordered = [...document.pages].sort((a, b) => (a.file === 'index.html' ? -1 : b.file === 'index.html' ? 1 : a.file < b.file ? -1 : 1));
  const created: string[] = [];
  const pages: Page[] = ordered.map((page) => {
    const name = freshName(pageNames, page.file === 'index.html' ? home : pageNameOf(page.file, home));
    const source = picked.find((file) => file.name === page.file);
    const title = source === undefined ? null : pageHead(textOf(source.bytes)).title;
    const attributes = title === null || title.trim() === '' ? page.tree.attributes : { ...page.tree.attributes, pageTitle: title.trim() };
    return { ...page, name, tree: { ...page.tree, name, attributes: attributes as DocNode['attributes'] } };
  });
  if (!pages.some((page) => page.file === 'index.html')) {
    const name = freshName(pageNames, home);
    const root: DocNode = { id: ids.next(), type: rules.root.type, name, tag: rules.root.tag, attributes: {}, classes: [], styles: {}, text: null, children: [] };
    pages.unshift({ id: ids.next(), name, file: 'index.html', tree: root });
    created.push('index.html');
  }
  document = { ...document, pages };
  // the stylesheets the pages link that the folder holds, each once, in the pages' order
  const stylesheets: string[] = [];
  for (const file of picked.filter((one) => isHtml(one.name))) {
    for (const href of pageHead(textOf(file.bytes)).stylesheets) {
      const path = resolveHref(file.name, href);
      if (path === null || !picked.some((one) => one.name === path)) continue;
      const at = moved.get(path) ?? path;
      if (!stylesheets.includes(at)) stylesheets.push(at);
    }
  }
  const report: FolderReport = {
    pages: pages.map((page) => ({ path: page.file, name: page.name })),
    stylesheets,
    kept: files_.map((file) => file.path),
    created,
    renamed,
    notes: reportNotes(site.report, (key, params) => words(key, params)),
  };
  return { document, report };
}

// the words the import report is told in (status.folder.imported): the files by role, and what the importer reports
const listOf = (entries: readonly string[]): MessageParam => (entries.length === 0 ? { key: 'status.folder.none' } : entries.join(', '));
export function reportMessage(folder: string, report: FolderReport): Message {
  return message('status.folder.imported', {
    folder: folder === '' ? { key: 'status.folder.unnamed' } : folder,
    pages: listOf(report.pages.map((page) => `${page.path} → ${page.name}`)),
    styles: listOf(report.stylesheets),
    kept: listOf(report.kept),
    created: listOf(report.created),
    renamed: listOf(report.renamed.map((one) => `${one.from} → ${one.to}`)),
    notes: report.notes,
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

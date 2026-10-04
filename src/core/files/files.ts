// The project's files (INVENTORY.md, owners; specs explorer-assets and explorer-assets-use): the uploaded
// images and other files of the document (`files`), at their path in the project, with their bytes (base64) and, for
// an image, the intrinsic size read when it was uploaded. One owner: the tree's shape, the path a new upload takes
// (`uploadPath`), the lookup by path, the object URL the canvas draws a project image with (`objectUrl`), the reader a
// door hands a file to (`readUploadFile`), and the upload command. Storing an image file and placing it is
// src/core/files/assets.ts.
//
// files.upload: the files a chooser handed over, stored at their paths, in the folder the door names or the one their
// type belongs to (img/ for an image, fonts/ for a font, files/ otherwise). A name already taken gets a numeric
// suffix, so nothing is overwritten; a file that is neither an image, a font nor a data file (CSV, TSV, JSON, XLSX,
// which go to files/: spec content-data) is refused
// (status.files.unsupportedType). One undo step, the status naming the files.
import { message, registerHandler } from '../commands/registry.ts';
import type { DocumentJson, Page, ProjectFile } from '../document/model.ts';
import type { Message } from '../commands/registry.ts';
import type { MessageId } from '../../generated/ids.ts';
import type { Patch } from '../history/transaction.ts';
import type { ModelRules } from '../document/validate.ts';
import { filesOf } from '../document/model.ts';
import { familyOf, fontFiles } from './fonts.ts';
import { addressAttributes, followCssUrls, followPaths, movedPath } from './references.ts';
import { capturedPageStylePath } from '../import/capture-styles.ts';
import { argumentRefused } from '../store/args.ts';
import { GENERATED_PATHS } from '../export/paths.ts';
import { browserPorts } from '../ports/browser.ts';
import { projectPathProblem } from './path-rule.ts';

export type { ProjectFile };

// the folders an upload lands in when its door names none: by what the file is
const FOLDERS: readonly { readonly folder: string; readonly types: readonly string[] }[] = [
  { folder: 'img/', types: ['image/'] },
  { folder: 'fonts/', types: ['font/', 'application/font', 'application/vnd.ms-fontobject', 'application/x-font'] },
];
export const FILE_FOLDER = 'files/';

export function fileAt(document: DocumentJson, path: string): ProjectFile | null {
  return filesOf(document).find((f) => f.path === path) ?? null;
}
// whether an address names a file of the project (spec explorer-assets-use: the canvas draws it, the export writes it
// at its path)
export function isProjectPath(document: DocumentJson, path: string | null | undefined): boolean {
  return path !== null && path !== undefined && path !== '' && fileAt(document, path) !== null;
}
// the project's image files, in the order they were uploaded: what a picker offers
export function imageFiles(document: DocumentJson): readonly ProjectFile[] {
  return filesOf(document).filter((f) => f.type.toLowerCase().startsWith('image/'));
}
// whether the project takes a file of this type at all
export function supportedType(type: string): boolean {
  const lowered = type.toLowerCase();
  return lowered.startsWith('image/') || FOLDERS.slice(1).some((f) => f.types.some((t) => lowered.startsWith(t)));
}

// The folder a file's type belongs to when the door names none.
export function folderFor(type: string): string {
  const found = FOLDERS.find((f) => f.types.some((t) => type.toLowerCase().startsWith(t)));
  return found === undefined ? FILE_FOLDER : found.folder;
}
// The path a file takes in a folder: its name with the characters a path cannot hold taken out, and "-2", "-3"…
// while the name is taken, so nothing is overwritten.
export function uploadPath(document: DocumentJson, folder: string, name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || 'file';
  const taken = new Set(filesOf(document).map((f) => f.path));
  let path = `${folder}${clean}`;
  for (let n = 2; taken.has(path) || pathGenerated(path); n++) {
    const dot = clean.lastIndexOf('.');
    path = `${folder}${dot <= 0 ? `${clean}-${n}` : `${clean.slice(0, dot)}-${n}${clean.slice(dot)}`}`;
  }
  return path;
}

// a file's size as the shortest of B, KB and MB with one decimal at most (data, not prose: no i18n)
// the bytes a base64 text holds: three for every four characters, less the padding (the audit's SZ1)
export const byteCount = (base64: string): number => Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
export function sizeLabel(file: ProjectFile): string {
  const bytes = byteCount(file.bytes);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The bytes a file holds, decoded: what the export writes at its path.
export function fileBytes(file: ProjectFile): Uint8Array {
  const binary = atob(file.bytes);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The object URL the canvas draws a project file with (an <img> cannot fetch a path the editor holds only in the
// document). One URL per path and content: the bytes are decoded once and kept until they change.
const urls = new Map<string, { readonly bytes: string; readonly url: string }>();
export function objectUrl(file: ProjectFile): string {
  const held = urls.get(file.path);
  if (held !== undefined && held.bytes === file.bytes) return held.url;
  if (held !== undefined) URL.revokeObjectURL(held.url);
  const url = URL.createObjectURL(new Blob([fileBytes(file).slice().buffer], { type: file.type }));
  urls.set(file.path, { bytes: file.bytes, url });
  return url;
}
// The data URL the preview draws a project file with: its frame has an opaque origin, where a blob: URL of the editor's
// origin does not load (spec code-panel-edit-js; the console says "Not allowed to load local resource"). The bytes are
// already base64, so the URL is the file itself and loads anywhere.
export function dataUrl(file: ProjectFile): string {
  return `data:${file.type};base64,${file.bytes}`;
}
// The address an element's attribute writes: the object URL of a project file, the address itself for anything else.
export function resolvedSource(document: DocumentJson, source: unknown): string | null {
  if (typeof source !== 'string' || source === '') return null;
  const file = fileAt(document, source);
  return file === null ? source : objectUrl(file);
}

// The file facts a door hands over: the upload reads the bytes and, for an image, the intrinsic size in the browser.
export interface UploadedFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: string;
  readonly width?: number;
  readonly height?: number;
}

export function unsupported(files: readonly UploadedFile[]): UploadedFile | undefined {
  return files.find((f) => !supportedType(f.type));
}
// the records the files become, named in the document's own order (nothing is overwritten)
export function recordsFor(document: DocumentJson, files: readonly UploadedFile[], folder: string | undefined): ProjectFile[] {
  const records: ProjectFile[] = [];
  let held = document;
  for (const file of files) {
    const path = uploadPath(held, folder === undefined || folder === '' ? folderFor(file.type) : folder, file.name);
    const record: ProjectFile = {
      path,
      type: file.type,
      bytes: file.bytes,
      ...(file.width === undefined ? {} : { width: file.width }),
      ...(file.height === undefined ? {} : { height: file.height }),
    };
    records.push(record);
    held = { ...held, files: [...filesOf(held), record] };
  }
  return records;
}
// the patches that add the records to the document's files, in order: the field itself while absent, then one entry
// per record
export function addRecords(document: DocumentJson, records: readonly ProjectFile[]): { op: 'add'; path: (string | number)[]; value: unknown }[] {
  if (records.length === 0) return [];
  if (document.files === undefined) return [{ op: 'add', path: ['files'], value: [...records] }];
  const held = filesOf(document).length;
  return records.map((record, i) => ({ op: 'add' as const, path: ['files', held + i], value: record }));
}

export const fileList = (files: unknown): readonly UploadedFile[] => (Array.isArray(files) ? (files as readonly UploadedFile[]) : [files as UploadedFile]);

// The one reader of a file the person handed over — the Explorer's Upload, the folder drop, an image dropped on the
// canvas and File › Open folder alike: its bytes as base64 and, for an image, the intrinsic size (the file's own size,
// whatever the element's is set to). Only an image is read for a size, so a font or a script comes through whole; an
// image whose bytes the browser cannot decode is still the person's file, kept without a size.
export async function readUploadFile(file: File): Promise<UploadedFile> {
  const buffer = await file.arrayBuffer();
  const view = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  const bytes = btoa(binary);
  const named = file.type !== '' ? file.type : typeOfFile(file.name);
  if (!named.startsWith('image/')) return { name: file.name, type: named, bytes };
  const size = await browserPorts().imageSize(bytes, named);
  return size === null ? { name: file.name, type: named, bytes } : { name: file.name, type: named, bytes, width: size.width, height: size.height };
}

// The MIME type of a file from its name: the one rule for a file the browser did not name (an upload, a folder the
// person picked) and for one the person names in the tree (files.createFile, files.rename). An extension no row names
// takes the given fallback.
const FILE_TYPES: readonly { readonly type: string; readonly extensions: readonly string[] }[] = [
  { type: 'image/png', extensions: ['png'] },
  { type: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  { type: 'image/gif', extensions: ['gif'] },
  { type: 'image/webp', extensions: ['webp'] },
  { type: 'image/avif', extensions: ['avif'] },
  { type: 'image/svg+xml', extensions: ['svg'] },
  { type: 'image/bmp', extensions: ['bmp'] },
  { type: 'image/x-icon', extensions: ['ico'] },
  { type: 'font/woff', extensions: ['woff'] },
  { type: 'font/woff2', extensions: ['woff2'] },
  { type: 'font/ttf', extensions: ['ttf'] },
  { type: 'font/otf', extensions: ['otf'] },
  { type: 'text/javascript', extensions: ['js', 'mjs'] },
  { type: 'text/css', extensions: ['css'] },
  { type: 'text/html', extensions: ['html', 'htm'] },
  { type: 'application/json', extensions: ['json'] },
  { type: 'text/csv', extensions: ['csv'] },
  { type: 'text/tab-separated-values', extensions: ['tsv'] },
  { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['xlsx'] },
];
export function typeOfFile(name: string, fallback = 'application/octet-stream'): string {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return FILE_TYPES.find((row) => row.extensions.includes(extension))?.type ?? fallback;
}

// A data file a collection imports (spec content-data): by its name, whatever type the browser gave it (a CSV often
// comes as application/vnd.ms-excel or with no type at all), or by its type.
const DATA_UPLOAD = /\.(csv|tsv|json|xlsx)$/i;
const DATA_TYPES = ['text/csv', 'text/tab-separated-values', 'application/json', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
export const isDataUpload = (file: Pick<UploadedFile, 'name' | 'type'>): boolean => DATA_UPLOAD.test(file.name) || DATA_TYPES.includes(file.type.toLowerCase());

export const uploadCommand = registerHandler('files.upload', ({ state }, { files, folder }) => {
  const list = fileList(files).filter((f) => f !== null && typeof f === 'object');
  if (list.length === 0) throw new Error('files.upload: no file');
  // the Explorer's upload keeps data files too (jornada03 J13); an image dropped on the canvas still takes images only
  const wrong = list.find((f) => !supportedType(f.type) && !isDataUpload(f));
  if (wrong !== undefined) return { kind: 'refused' as const, message: message('status.files.unsupportedType', { name: wrong.name }) };
  const records = recordsFor(state.document, list, folder as string | undefined);
  return {
    kind: 'change' as const,
    patches: addRecords(state.document, records),
    message: message('status.files.uploaded', { names: records.map((r) => r.path).join(', ') }),
  };
});

// ---------------------------------------------------------------- the project's file tree

// The paths the document generates, whatever the tree holds: the stylesheet every page links and the scripts the export
// writes (spec explorer-file-system, Problems 2), the export's own list (core/export/paths.ts). They are fixed: nothing
// else may take their path (an upload or an imported file takes a free name beside it), and no command renames, moves
// or deletes them; a folder that holds one of them is as fixed as the file it holds.
export { GENERATED_PATHS };

// whether a path IS one of the generated files: its path is taken, and no file may be made there
export function pathGenerated(path: string): boolean {
  return GENERATED_PATHS.includes(path);
}

// whether a path is a folder that HOLDS (or stands over) a generated file: it cannot be renamed, moved or deleted,
// because that would take the generated file with it (spec explorer-file-system, Problems 2)
export function holdsGenerated(path: string): boolean {
  return GENERATED_PATHS.some((one) => one.startsWith(`${path}/`));
}

// a path's folders, the root apart; with `withSelf`, the path itself is one too (a stored folder)
function ancestorsOf(path: string, withSelf: boolean): string[] {
  const parts = path.split('/').filter((one) => one !== '');
  const cut = withSelf ? parts.length : parts.length - 1;
  return parts.slice(0, cut).map((_, i) => parts.slice(0, i + 1).join('/'));
}

// The folders of the tree: the ones the project stores (an empty folder exists) and the ones its files and pages
// stand under, parents before children, each once.
export function folderPaths(document: DocumentJson): readonly string[] {
  const all = new Set<string>();
  for (const folder of document.folders ?? []) for (const one of ancestorsOf(folder, true)) all.add(one);
  for (const file of filesOf(document)) for (const one of ancestorsOf(file.path, false)) all.add(one);
  for (const page of document.pages) for (const one of ancestorsOf(page.file, false)) all.add(one);
  for (const path of GENERATED_PATHS) for (const one of ancestorsOf(path, false)) all.add(one);
  return [...all].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
}

// where a path sits: its folder ('' in the root) and its own name
export function folderOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}
export const nameOfPath = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

// Keep the source extension and folder when an imported page or asset needs a free path.
export function uniqueFilePath(document: DocumentJson, path: string, reserved: ReadonlySet<string> = new Set()): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const split = dot > slash + 1 ? dot : path.length;
  let candidate = path;
  for (let n = 2; pathTaken(document, candidate) || pathGenerated(candidate) || reserved.has(candidate); n += 1) candidate = `${path.slice(0, split)}-${n}${path.slice(split)}`;
  return candidate;
}

export const pickedFilePath = (file: File): string => file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;

// A path as a browser resolves it from the file that holds it (spec export-multi-page, export-file-tree): the pages
// live at their paths in the archive, so a link from company/about-us.html to the stylesheet is "../css/styles.css"
// and to another page of its own folder the name alone. The one rule of a relative path, which the export's value
// writer asks (core/files/values.ts).
export function relativePath(fromFile: string, toPath: string): string {
  const from = folderOf(fromFile).split('/').filter((one) => one !== '');
  const to = toPath.split('/').filter((one) => one !== '');
  const name = to.pop() ?? '';
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  return `${'../'.repeat(from.length - shared)}${[...to.slice(shared), name].join('/')}`;
}
const pathIn = (folder: string, name: string): string => (folder === '' ? name : `${folder}/${name}`);

// The path an address inside a file of the project names, as a browser resolves it (spec explorer-open-folder): an
// address relative to the file that holds it ("./x", "../css/site.css", "site.css") or from the tree's root ("/x");
// null for an address that names no path of the tree (an absolute one: https:, data:, //). The inverse of
// relativePath, and its one reader.
export function resolveHref(fromFile: string, href: string): string | null {
  const address = href.trim();
  if (address === '' || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(address) || address.startsWith('//')) return null;
  const parts = address.startsWith('/') ? [] : folderOf(fromFile).split('/').filter((one) => one !== '');
  for (const piece of address.split('/')) {
    if (piece === '' || piece === '.') continue;
    if (piece === '..') parts.pop();
    else parts.push(piece);
  }
  return parts.length === 0 ? null : parts.join('/');
}

// whether the tree already holds a file, a folder or a page's file at this path: a folder the generated files stand
// in is not held by anything (it may be made; it exists as a folder either way)
export function pathTaken(document: DocumentJson, path: string): boolean {
  const stored = (document.folders ?? []).includes(path);
  const implied = [...filesOf(document).map((file) => file.path), ...document.pages.map((page) => page.file)].some((one) => one.startsWith(`${path}/`));
  if (stored || implied) return true;
  if (document.pages.some((page) => page.file === path)) return true;
  return fileAt(document, path) !== null;
}

// the page whose file is this path, if one is
export const pageAtPath = (document: DocumentJson, path: string): Page | null => document.pages.find((page) => page.file === path) ?? null;

// the pages that link a file (or, for a folder, a file under it) among their linked scripts: deleting it would leave
// them pointing at nothing
export function linkedBy(document: DocumentJson, path: string): readonly Page[] {
  return document.pages.filter((page) => {
    const held = (page.tree.attributes as Readonly<Record<string, unknown>>).pageScripts;
    return typeof held === 'string' && held.split(/\s+/).some((one) => one === path || one.startsWith(`${path}/`));
  });
}

// The paths a rename or a move gives every file, folder and page of the tree under `from`: a page's file IS its path,
// so both halves of the tree move together.
function movedPaths(document: DocumentJson, from: string, to: string): { readonly files: readonly ProjectFile[]; readonly folders: readonly string[]; readonly pages: readonly { readonly index: number; readonly file: string }[] } {
  const rewritten = (path: string): string => (path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path);
  // a captured page's residual stylesheet stands beside its file, named after it (capture-styles.ts): it moves with the
  // page, its own addresses written again from where it now stands (the audit's RF1: the page lost its styles)
  const sheets = new Map<string, string>();
  for (const page of document.pages) {
    const moved = rewritten(page.file);
    if (page.capture !== undefined && moved !== page.file) sheets.set(capturedPageStylePath({ file: page.file }), capturedPageStylePath({ file: moved }));
  }
  return {
    files: filesOf(document).map((file) => {
      const sheet = sheets.get(file.path);
      if (sheet !== undefined) return capturedSheetMoved(file, sheet, rewritten);
      const path = rewritten(file.path);
      return path === file.path ? file : { ...file, path, type: file.type === '' ? typeOfName(path) : file.type };
    }),
    folders: (document.folders ?? []).map(rewritten),
    pages: document.pages.map((page, index) => ({ index, file: rewritten(page.file) })).filter((one) => one.file !== document.pages[one.index]?.file),
  };
}

// A captured page's residual stylesheet at its new place: every relative url() of it resolved from where it stood, that
// path moved as the tree's paths move, and written again relative to where it stands now.
export function capturedSheetMoved(file: ProjectFile, to: string, rewritten: (path: string) => string): ProjectFile {
  const text = new TextDecoder().decode(fileBytes(file));
  const moved = followCssUrls(text, (address) => {
    // an address from the site's root ("/img/a.png") names the same place wherever the sheet stands
    const path = address.startsWith('/') ? null : resolveHref(file.path, address);
    return path === null ? address : relativePath(to, rewritten(path));
  });
  return { ...file, path: to, bytes: base64Of(moved) };
}

// The residual stylesheet a copy of a captured page takes (pages.duplicate, pages made from a page): the source's,
// at the copy's own path beside its file, its addresses written from there; none for a page that is no capture.
export function copiedCaptureSheet(document: DocumentJson, source: Page, copy: Page): ProjectFile | null {
  if (source.capture === undefined) return null;
  const sheet = fileAt(document, capturedPageStylePath(source));
  return sheet === null ? null : capturedSheetMoved(sheet, capturedPageStylePath(copy), (path) => path);
}

// whether moving or renaming `from` to `to` is allowed: every path it gives must be free, nothing generated may be
// involved, and the home page keeps its index.html in the root
function renameRefusal(document: DocumentJson, from: string, to: string): Message | null {
  if (to === from) return null;
  if (projectPathProblem(to) !== null) return message('status.files.badName', { name: nameOfPath(to) });
  const fixed = (path: string): boolean => pathGenerated(path) || holdsGenerated(path);
  if (fixed(from) || fixed(to)) return message('status.files.generatedPath', { path: pathGenerated(from) || holdsGenerated(from) ? from : to });
  // the destination itself: another file, folder or page file already there (the checks below look at what moves
  // with it, which leaves the destination out)
  if (!to.startsWith(`${from}/`) && pathTaken(document, to)) return message('status.files.nameTaken', { path: to, name: nameOfPath(to) });
  const moves = movedPaths(document, from, to);
  const before = new Set([...folderPaths(document), ...filesOf(document).map((file) => file.path), ...document.pages.map((page) => page.file)]);
  const clashes = (path: string): boolean => !before.has(path) && pathTaken(document, path);
  for (const folder of moves.folders) if (folder !== to && clashes(folder)) return message('status.files.nameTaken', { path: folder, name: nameOfPath(folder) });
  for (const file of moves.files) if (file.path !== to && clashes(file.path)) return message('status.files.nameTaken', { path: file.path, name: nameOfPath(file.path) });
  for (const page of moves.pages) if (page.file !== to && clashes(page.file)) return message('status.files.nameTaken', { path: page.file, name: nameOfPath(page.file) });
  // a page's file stays an HTML file: the page is what the export writes there
  for (const page of moves.pages) if (!/\.html?$/i.test(page.file)) return message('status.files.pageNeedsHtml', { name: nameOfPath(page.file) });
  const home = document.pages.findIndex((page) => page.file === 'index.html');
  if (home >= 0 && moves.pages.some((one) => one.index === home && one.file !== 'index.html')) return message('status.pages.homeUndeletable');
  return null;
}

// the patches that take every user of a moved path with it (references.ts): attributes, url()s, linked scripts, and the
// family of a font whose file name changed
function followMove(document: DocumentJson, rules: ModelRules, from: string, to: string): Patch[] {
  const rewrite = movedPath(from, to);
  const names = new Map<string, string>();
  for (const file of fontFiles(document)) {
    const was = familyOf(file);
    const now = familyOf({ ...file, path: rewrite(file.path) });
    if (was !== now) names.set(was, now);
  }
  const properties = new Set([...rules.propertyFacts].filter(([, facts]) => facts.codec === FAMILY_LIST_CODEC).map(([property]) => property));
  return followPaths(document, rewrite, { names, properties }, addressAttributes(rules));
}

// The patches that move a path of the tree (a file, a folder, a page's file) to another and take every user of it with
// it: one owner for files.rename, files.move and a page renamed (pages.rename).
export function pathMovePatches(document: DocumentJson, rules: ModelRules, from: string, to: string): Patch[] {
  return [...patchesForMoves(document, movedPaths(document, from, to)), ...followMove(document, rules, from, to)];
}

// the codec of a property whose value lists font families (properties.json)
const FAMILY_LIST_CODEC = 'font-family-list';

// the patches that write the moved paths back, one per part of the document that changed
function patchesForMoves(document: DocumentJson, moves: ReturnType<typeof movedPaths>): Patch[] {
  const patches: Patch[] = [];
  if (moves.files.some((file, i) => file !== filesOf(document)[i])) patches.push({ op: 'replace', path: ['files'], value: moves.files });
  if (moves.folders.some((folder, i) => folder !== (document.folders ?? [])[i])) patches.push({ op: 'replace', path: ['folders'], value: moves.folders });
  for (const page of moves.pages) patches.push({ op: 'replace', path: ['pages', page.index, 'file'], value: page.file });
  return patches;
}

// whether a path may be made: its folder exists, and nothing holds its place
function makingRefusal(document: DocumentJson, path: string): Message | null {
  if (projectPathProblem(path) !== null) return message('status.files.badName', { name: path });
  if (pathGenerated(path)) return message('status.files.generatedPath', { path });
  if (pathTaken(document, path)) return message('status.files.nameTaken', { path, name: nameOfPath(path) });
  const above = folderOf(path);
  if (above !== '' && !folderPaths(document).includes(above)) return message('status.files.nameTaken', { path, name: nameOfPath(path) });
  return null;
}

// the MIME type a file of this name takes, from its extension (one rule with the reader's: typeOfFile)
function typeOfName(path: string): string {
  return typeOfFile(path, 'text/plain');
}

// files.createFolder: a folder at a path under an existing folder. One undo step.
export const createFolderCommand = registerHandler('files.createFolder', ({ state }, { path }) => {
  const wanted = String(path ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (wanted === '') throw new Error('files.createFolder: a door hands the path of the folder it makes');
  const refusal = makingRefusal(state.document, wanted);
  if (refusal !== null) return { kind: 'refused' as const, message: refusal };
  return { kind: 'change' as const, patches: [{ op: 'add', path: ['folders'], value: [...(state.document.folders ?? []), wanted] }], message: message('status.files.folderCreated', { name: nameOfPath(wanted) }) };
});

// files.createFile: an empty project file at a path. One undo step.
export const createFileCommand = registerHandler('files.createFile', ({ state }, { path }) => {
  const wanted = String(path ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (wanted === '') throw new Error('files.createFile: a door hands the path of the file it makes');
  const refusal = makingRefusal(state.document, wanted);
  if (refusal !== null) return { kind: 'refused' as const, message: refusal };
  const record: ProjectFile = { path: wanted, type: typeOfName(wanted), bytes: '' };
  return { kind: 'change' as const, patches: [{ op: 'add', path: ['files'], value: [...filesOf(state.document), record] }], message: message('status.files.fileCreated', { name: nameOfPath(wanted) }) };
});

// files.rename: the file, folder or page file at `path` takes `name` in its own folder. One undo step.
export const renameFileCommand = registerHandler('files.rename', ({ state, rules }, { path, name }) => {
  const from = String(path ?? '');
  const typed = String(name ?? '').trim();
  if (from === '' || typed === '') return { kind: 'refused' as const, message: argumentRefused(from === '' ? 'path' : 'name') };
  const to = pathIn(folderOf(from), typed);
  const refusal = renameRefusal(state.document, from, to);
  if (refusal !== null) return { kind: 'refused' as const, message: refusal };
  return { kind: 'change' as const, patches: pathMovePatches(state.document, rules, from, to), message: message('status.files.renamed', { name: typed }) };
});

// files.move: the file, folder or page file at `path` moves under `to` (a folder), keeping its name. One undo step.
export const moveFileCommand = registerHandler('files.move', ({ state, rules }, { path, to }) => {
  const from = String(path ?? '');
  const folder = String(to ?? '').replace(/^\/+|\/+$/g, '');
  if (from === '') throw new Error('files.move: a door hands the path it moves');
  if (folder !== '' && !folderPaths(state.document).includes(folder)) return { kind: 'refused' as const, message: message('status.files.nameTaken', { path: folder, name: nameOfPath(folder) }) };
  const wanted = pathIn(folder, nameOfPath(from));
  const refusal = renameRefusal(state.document, from, wanted);
  if (refusal !== null) return { kind: 'refused' as const, message: refusal };
  const patches = pathMovePatches(state.document, rules, from, wanted);
  // a move that changes nothing (the row is already in that folder, which is what opening the folder list does)
  // says nothing
  if (patches.length === 0) return { kind: 'change' as const };
  return { kind: 'change' as const, patches, message: message('status.files.moved', { name: nameOfPath(from), folder: folder === '' ? '/' : folder }) };
});

// files.delete: the file or folder at `path` goes, with everything a folder holds (the door confirms first:
// dialog.deleteFiles). A page's file is deleted by deleting its page, so a folder that holds one refuses; so does a
// folder that holds a generated path, and a file a page links. One undo step.
export const deleteFileCommand = registerHandler('files.delete', ({ state, confirmed }, { path }) => {
  const wanted = String(path ?? '');
  if (wanted === '') throw new Error('files.delete: a door hands the path it deletes');
  if (pathGenerated(wanted) || holdsGenerated(wanted)) return { kind: 'refused' as const, message: message('status.files.generatedPath', { path: wanted }) };
  const isFolder = folderPaths(state.document).includes(wanted);
  if (!isFolder && fileAt(state.document, wanted) === null) return { kind: 'refused' as const, message: message('status.files.missing', { path: wanted }) };
  // the path itself, and for a folder everything under it
  const inside = (one: string): boolean => one === wanted || (isFolder && one.startsWith(`${wanted}/`));
  if (isFolder && state.document.pages.some((page) => inside(page.file))) return { kind: 'refused' as const, message: message('status.files.holdsPage') };
  const linked = linkedBy(state.document, wanted);
  if (linked.length > 0) return { kind: 'refused' as const, message: message('status.files.linkedBy', { path: wanted, pages: linked.map((page) => page.name).join(', ') }) };
  // a folder that holds something asks first (spec explorer-file-system, Problems 3): what it holds goes with it
  const holds = isFolder && filesOf(state.document).some((file) => inside(file.path));
  if (holds && confirmed !== true) return { kind: 'confirm' as const };
  const files = filesOf(state.document).filter((file) => !inside(file.path));
  const folders = (state.document.folders ?? []).filter((folder) => !inside(folder));
  const patches: Patch[] = [{ op: 'replace', path: ['files'], value: files }];
  if ((state.document.folders ?? []).length !== folders.length) patches.push({ op: 'replace', path: ['folders'], value: folders });
  return { kind: 'change' as const, patches, message: message('status.files.deleted', { name: nameOfPath(wanted) }) };
});

// files.saveContent: what a code file holds, written back (the code pane's Save). One undo step.
export const saveFileContentCommand = registerHandler('files.saveContent', ({ state, rules }, { path, content }) => {
  const wanted = String(path ?? '');
  const file = fileAt(state.document, wanted);
  if (pathGenerated(wanted) && file === null) return { kind: 'refused' as const, message: message('status.files.generatedPath', { path: wanted }) };
  if (file === null) return { kind: 'refused' as const, message: message('status.files.missing', { path: wanted }) };
  const text = String(content ?? '');
  const bad = wanted.endsWith('.js') || wanted.endsWith('.mjs') ? javascriptProblem(text) : null;
  if (bad !== null) return { kind: 'refused' as const, message: message('status.js.invalidAt', { line: bad.line, reason: { key: bad.key } }) };
  const bytes = base64Of(text);
  if (bytes === file.bytes) return { kind: 'change' as const, message: message('status.files.saved', { path: wanted }) };
  void rules;
  const index = filesOf(state.document).indexOf(file);
  return { kind: 'change' as const, patches: [{ op: 'replace', path: ['files', index, 'bytes'], value: bytes }], message: message('status.files.saved', { path: wanted }) };
});

// a text's bytes as the base64 the document stores
function base64Of(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// What a JavaScript text is wrong about, or null: the browser's own parser reads it (the app's runtime is the truth,
// as the CSS support check takes Chrome's word for CSS). A module's import and export statements are read as the plain
// statements they introduce (their lines kept, so the numbering holds), since a function body cannot hold them.
export function javascriptProblem(text: string): { readonly line: number; readonly key: MessageId } | null {
  const body = asScript(text);
  if (parses(body)) return null;
  // V8 names no line for a function body: the line is the first one whose prefix fails for another reason than
  // ending too early ("Unexpected end of input" while a brace or a call is still open)
  const lines = body.split('\n');
  for (let n = 1; n <= lines.length; n += 1) {
    const error = parseError(lines.slice(0, n).join('\n'));
    if (error !== null && !/end of input|unterminated/i.test(error)) return { line: n, key: 'status.js.syntaxError' };
  }
  return { line: lines.length, key: 'status.js.syntaxError' };
}

// a module's text as a script with the same lines: `import … from '…';` and `export { … };` become nothing,
// `export default x` becomes the expression `void x` (a function, a class, an object or a value alike), `export const`
// becomes `const`
function asScript(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)import\s+(?:[^'";]+\s+from\s+)?(['"])[^'"]*\2\s*;?/, '$1')
        .replace(/^(\s*)export\s+\{[^}]*\}(?:\s+from\s+(['"])[^'"]*\2)?\s*;?/, '$1')
        .replace(/^(\s*)export\s+default\s+/, '$1void ')
        .replace(/^(\s*)export\s+/, '$1'),
    )
    .join('\n');
}

function parseError(text: string): string | null {
  try {
    new Function(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const parses = (text: string): boolean => parseError(text) === null;

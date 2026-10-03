// The Explorer's files (INVENTORY.md, owners; the manifest's explorer-file-system and code-panel-view):
// the rows the Files section lists — what the document generates (one .html per page, the stylesheet
// css/styles.css, and each script the export writes for what the project holds: js/interactions.js once it has
// interactions, js/forms.js, js/motion.js, js/lottie.min.js) and the files the project holds
// (document.files) — and the door that opens one in the code pane. One owner: the row list, the row's kind, and
// files.open. Folders, renaming, moving and deleting are explorer-file-system's own work (not built yet).
import { message, registerHandler } from '../../core/commands/registry.ts';
import type { DocumentJson, Page, ProjectFile } from '../../core/document/model.ts';
import { fileAt, folderOf, folderPaths } from '../../core/files/files.ts';
import { filesOf } from '../../core/document/model.ts';
import { FORMS_SCRIPT, INTERACTIONS_SCRIPT, LOTTIE_SCRIPT, MOTION_SCRIPT, STYLESHEET, siteFiles, siteScriptsWritten } from '../../core/export/export.ts';
import { siteScripts } from '../forms/script.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import type { EditorUi } from '../state.ts';
import { editorView } from '../view/editor-view.ts';
import { isFileShown, openedFile } from './file-tabs.ts';

// what a row is, by its path: the badge a row shows and the syntax the pane colours it with
export type FileKind = 'html' | 'css' | 'js' | 'image' | 'font' | 'other';

export interface FileRow {
  readonly path: string;
  readonly kind: FileKind;
  // generated from the document (a page's html, the stylesheet, the interactions): its text is never stored, and its
  // path is fixed — the export writes it there
  readonly generated: boolean;
  // the file's size in bytes, or null for a generated one (its size is what it renders to now)
  readonly size: number | null;
}

const EXTENSIONS: Readonly<Record<string, FileKind>> = {
  html: 'html', htm: 'html', css: 'css', js: 'js', mjs: 'js',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image', ico: 'image',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', eot: 'font',
};

export function kindOf(path: string, type = ''): FileKind {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('font/') || /font/.test(type)) return 'font';
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return EXTENSIONS[ext] ?? 'other';
}

// The scripts the export writes beside the pages and the stylesheet, by what the project holds now: the export's own
// answer (siteFiles, the one writer of the site), each with the text it writes, so the Explorer lists the file, the
// code pane shows that text and the archive holds it, never one without the others.
const SCRIPTS = [
  [INTERACTIONS_SCRIPT, 'interactions'],
  [FORMS_SCRIPT, 'forms'],
  [MOTION_SCRIPT, 'motion'],
  [LOTTIE_SCRIPT, 'lottie'],
] as const;
// the paths the export may write a script at
export const SCRIPT_PATHS: readonly string[] = SCRIPTS.map(([path]) => path);

// Whether the path is one the document generates (a page's file, the stylesheet, a script the export writes and no
// stored file holds): its text is rendered now, and its path is fixed — the export writes it there (archive/DESIGN.md,
// "Files, tabs and code").
export function isGenerated(path: string, document: DocumentJson): boolean {
  return document.pages.some((page) => page.file === path) || path === STYLESHEET || (SCRIPT_PATHS.includes(path) && fileAt(document, path) === null);
}
// the paths of the scripts the export writes now, read without writing the site (export.ts siteScriptsWritten): what
// the rows list at every change of the document, the text being written only when the code pane shows one
export function generatedScriptPaths(document: DocumentJson, rules: ModelRules): readonly string[] {
  const written = siteScriptsWritten(document, rules);
  return SCRIPTS.flatMap(([path, part]) => (written.has(part) ? [path] : []));
}
export function generatedScripts(document: DocumentJson, rules: ModelRules): readonly { readonly path: string; readonly text: string }[] {
  const site = siteFiles(document, rules, true, siteScripts);
  return SCRIPTS.flatMap(([path, part]) => {
    const text = site[part];
    return text === null ? [] : [{ path, text }];
  });
}

// The Files section's rows, in the order it lists them: what the document generates (each page's file in the pages'
// order, the stylesheet, the interactions script) and then the project's own files, each as it was uploaded.
export function fileRows(document: DocumentJson, rules: ModelRules): readonly FileRow[] {
  const generated: FileRow[] = [
    ...document.pages.map((page) => ({ path: page.file, kind: 'html' as const, generated: true, size: null })),
    { path: STYLESHEET, kind: 'css' as const, generated: true, size: null },
    ...generatedScriptPaths(document, rules).map((path) => ({ path, kind: 'js' as const, generated: true, size: null })),
  ];
  const owned: FileRow[] = filesOf(document).map((file: ProjectFile) => ({ path: file.path, kind: kindOf(file.path, file.type), generated: false, size: Math.floor((file.bytes.length * 3) / 4) }));
  return [...generated, ...owned];
}

// The Explorer's tree, in the order it lists it: every folder at its path (a stored empty one too), and under it the
// files, the pages' files and the generated stylesheet and scripts that stand in it, one level deeper (spec
// explorer-file-system: css/styles.css and js/interactions.js are listed; the stylesheet's folder showed empty). A
// page's file is a row like any other (clicking it opens the page's markup in the code pane), and it says which page
// it is.
export interface TreeRow {
  readonly path: string;
  // the folder's own row, or a file's
  readonly folder: boolean;
  readonly depth: number;
  readonly kind: FileKind;
  readonly generated: boolean;
  readonly page: string | null;
  readonly size: number | null;
}

export function treeRows(document: DocumentJson, rules: ModelRules): readonly TreeRow[] {
  const rows: TreeRow[] = [];
  const folders = folderPaths(document);
  const under = (folder: string): readonly string[] => folders.filter((one) => folderOf(one) === folder).sort();
  // the generated stylesheet and scripts: rows of no stored file and no page
  const made = [STYLESHEET, ...generatedScriptPaths(document, rules)].map((path) => ({ path, file: null as ProjectFile | null, page: null as Page | null }));
  const filesIn = (folder: string): readonly { readonly path: string; readonly file: ProjectFile | null; readonly page: Page | null }[] =>
    [...filesOf(document).map((file) => ({ path: file.path, file, page: null as Page | null })), ...document.pages.map((page) => ({ path: page.file, file: null as ProjectFile | null, page })), ...made]
      .filter((one) => folderOf(one.path) === folder)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fileRow = (one: ReturnType<typeof filesIn>[number], depth: number): void => {
    rows.push({
      path: one.path,
      folder: false,
      depth,
      kind: kindOf(one.path, one.file?.type ?? ''),
      generated: one.page !== null || (one.file === null && one.page === null) || isGenerated(one.path, document),
      page: one.page?.id ?? null,
      size: one.file === null ? null : Math.floor((one.file.bytes.length * 3) / 4),
    });
  };
  // in each folder the site's pages first, in the project's order (design/final's Explorer: index.html, planos.html,
  // sobre.html above css/, img/, js/), then its folders, then its other files
  const walk = (folder: string, depth: number): void => {
    const files = filesIn(folder);
    for (const page of document.pages) {
      const one = files.find((candidate) => candidate.page === page);
      if (one !== undefined) fileRow(one, depth);
    }
    for (const child of under(folder)) {
      rows.push({ path: child, folder: true, depth, kind: 'other', generated: false, page: null, size: null });
      walk(child, depth + 1);
    }
    for (const one of files) if (one.page === null) fileRow(one, depth);
  };
  walk('', 0);
  return rows;
}

// files.open (the Explorer's file rows and the code files' tabs): the file shows in the code pane, and the centre
// column shows it — the canvas when the column shows both (split), the code pane otherwise (PRODUCT.md §5.3: a code
// file tab shows the file in the Code view).
export const openFile = registerHandler<'files.open', EditorUi>(
  'files.open',
  ({ state, rules }, { path }) => {
    if (typeof path !== 'string' || path === '') throw new Error('files.open: a door hands the path of the file it opens');
    if (fileRows(state.document, rules).every((row) => row.path !== path)) return { kind: 'refused', message: message('status.files.missing', { path }) };
    const ui = openedFile(state.ui, path);
    return { kind: 'change', ui: editorView(state.ui) === 'split' ? ui : { ...ui, editorView: 'code' }, message: message('status.files.opened', { path }) };
  },
  (state, { path }) => typeof path === 'string' && isFileShown(state.ui, path),
);

// files.startRename (the Explorer's row, a double-click on its name — the Layers row's own pattern): which row is
// renamed, in the editor's state, never in the document. The field that takes the name is files.rename's
// (shell/sidebar.tsx draws it in the name's place while this names the row).
export const startRenameFile = registerHandler<'files.startRename', EditorUi>(
  'files.startRename',
  ({ state }, { path }) => {
    if (typeof path !== 'string') throw new Error('files.startRename: a door hands the path of the row it renames');
    // an empty path is the end of a rename (the field kept its name): no row is renamed any more
    return { kind: 'change', ui: { ...state.ui, renamingFile: path === '' ? undefined : path } };
  },
  (state, { path }) => state.ui.renamingFile === path,
);

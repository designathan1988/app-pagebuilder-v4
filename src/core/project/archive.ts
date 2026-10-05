// The project file (PRODUCT.md §5): what File › Save project writes and File › Open reads: project.zip, or a bare
// project.json, the format of the scenario fixtures (manifest/features/fixtures/): the document JSON of model.ts,
// with its format version. A file that is not a document the model accepts, or whose version this app cannot read, is
// refused with the reason, and the current document stays as it was. `readProject` is the one reader of a project
// document: File › Open and the autosaved work restored at start (src/editor/persistence/autosave.ts) both load
// through it.
import { message, registerHandler, type Message } from '../commands/registry.ts';
import { isEmptyProject, type DocumentJson } from '../document/model.ts';
import { migrateDocument } from '../document/migrations.ts';
import { validateDocument, type ModelRules } from '../document/validate.ts';
import { ArchiveError, archiveReason, isZip, unzip, zip } from './zip.ts';

const invalid = (reason: string | Message): { readonly refused: Message } => ({ refused: message('status.open.invalidArchive', { reason }) });

// A project document read from its parsed JSON: the document when the model accepts it at this app's format
// version, else the refusal naming why (a newer version, or what is wrong with it). A file of an older version is
// carried forward first (document/migrations.ts, the one owner of the format's versions).
export function readProject(parsed: unknown, rules: ModelRules): { readonly document: DocumentJson } | { readonly refused: Message } {
  const migrated = migrateDocument(parsed);
  if (!migrated.ok) {
    if (migrated.reason === 'newer') return { refused: message('status.open.newerVersion', { version: migrated.version ?? 0 }) };
    if (migrated.reason === 'no-step') return invalid(`it is a version ${migrated.version} document and this app has no way to carry it forward`);
    return invalid('it is not a project document');
  }
  const document = migrated.document as DocumentJson;
  if (!Array.isArray(document.pages)) return invalid('it is not a project document');
  const first = validateDocument(document, [], rules)[0];
  if (first !== undefined) return invalid(`${first.path}: ${first.message}`);
  return { document };
}

// File › Save project (spec project-save-json): one archive, project.zip, holding project.json, the document alone
// as the editor holds it (its format version, its pages and the files the project stores, which the document carries
// itself with their bytes; pretty-printed). The save time is only the entries' modification time,
// from the clock port, so the same document saved twice gives the same project.json. Nothing in the document or the
// history changes.
const PROJECT_ARCHIVE = 'project.zip';
const PROJECT_DOCUMENT = 'project.json';

export const saveProject = registerHandler('project.save', ({ state, clock }) => {
  const document = new TextEncoder().encode(`${JSON.stringify(state.document, null, 2)}\n`);
  const bytes = zip([{ path: PROJECT_DOCUMENT, bytes: document }], clock.now());
  return { kind: 'change' as const, message: message('status.project.saved', { file: PROJECT_ARCHIVE }), download: { name: PROJECT_ARCHIVE, type: 'application/zip', bytes } };
});

// The text of project.json in a chosen file (spec project-open-json, Problems in Pager 2): the archive's
// project.json, or the file's own text for a bare project.json. An archive that cannot be read, or holds no
// project.json, gives a text the project reader refuses, naming why (one of the archive reader's reasons).
export async function projectFileText(bytes: Uint8Array): Promise<string> {
  if (!isZip(bytes)) return new TextDecoder().decode(bytes);
  try {
    const document = (await unzip(bytes)).get(PROJECT_DOCUMENT);
    return document === undefined ? JSON.stringify({ archive: message('archive.noDocument', { file: PROJECT_DOCUMENT }) }) : new TextDecoder().decode(document);
  } catch (error) {
    return JSON.stringify({ archive: error instanceof ArchiveError ? error.reason : message('archive.broken') });
  }
}

// File › Open project (spec project-open-json): the chosen file's project.json is read and checked first, so a file
// the model refuses, or of a newer format, never asks anything; a valid project replaces a document that holds work
// only once the person confirms (outcome `confirm`, the manifest's confirmation), and the empty project at once. The
// selection and the history start empty (outcome `load`), and autosave writes the opened project.
export const openProject = registerHandler('project.open', ({ rules, state, confirmed }, args) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.file);
  } catch (error) {
    return { kind: 'refused' as const, message: invalid((error as Error).message).refused };
  }
  // an archive the reader refused (projectFileText): its reason, read back only when it is one of the reader's
  const unread = parsed !== null && typeof parsed === 'object' && 'archive' in parsed ? archiveReason((parsed as { archive: unknown }).archive) : null;
  if (unread !== null) return { kind: 'refused' as const, message: invalid(unread).refused };
  const read = readProject(parsed, rules);
  if ('refused' in read) return { kind: 'refused' as const, message: read.refused };
  if (confirmed !== true && !isEmptyProject(state.document)) return { kind: 'confirm' as const };
  return { kind: 'load' as const, document: read.document, message: message('status.open.opened') };
});

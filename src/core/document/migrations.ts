// The document's format versions (the plan's T4): what a file written by an older version becomes when this app reads
// it, and what happens to one this app cannot read.
//
// Every reader of a project document goes through `migrateDocument` before it validates (File › Open and the restored
// autosave both read through src/core/project/archive.ts readProject): a document of the current version is taken as it
// is, an older one is carried forward step by step by the chain, and one of a version newer than this app is refused —
// never guessed at. A version the chain has no step for is refused too, so a hole in the chain is a refusal with a
// reason instead of a document half-read.
//
// Version 2 gives captured pages an HTML-root class setting. Version 3 gives captured pages a distinct ordered
// source DOM; old authored pages keep their existing tree and gain no capture data in either migration step.
// Version 4 holds a captured page as one tree for every observed width (DEC-61): a version-3 page kept one snapshot per
// width with no node identity between them, so it keeps its widest snapshot.
import { DOCUMENT_VERSION, type DocumentJson } from './model.ts';

export interface Migration {
  // the version the document is at, and the one this step brings it to
  readonly from: number;
  readonly to: number;
  // the document as this step leaves it: the same object, changed where the format changed
  readonly migrate: (document: Record<string, unknown>) => Record<string, unknown>;
}

// The steps this app knows, in order.
const MIGRATIONS: readonly Migration[] = [
  { from: 1, to: 2, migrate: (document) => ({ ...document, version: 2 }) },
  { from: 2, to: 3, migrate: (document) => ({ ...document, version: 3 }) },
  { from: 3, to: 4, migrate: (document) => ({ ...document, version: 4, pages: Array.isArray(document.pages) ? document.pages.map(widestCapture) : document.pages }) },
];

function widestCapture(page: unknown): unknown {
  if (page === null || typeof page !== 'object' || !('capture' in page)) return page;
  const capture = (page as { capture: unknown }).capture as { viewports?: unknown; resourceProblems?: unknown } | null;
  if (capture === null || typeof capture !== 'object' || !Array.isArray(capture.viewports)) return page;
  const widest = [...(capture.viewports as { width: number; root: unknown }[])].sort((a, b) => b.width - a.width)[0];
  if (widest === undefined) return page;
  return { ...page, capture: { widths: [widest.width], root: widest.root, ...(capture.resourceProblems === undefined ? {} : { resourceProblems: capture.resourceProblems }) } };
}

export type MigrationResult =
  | { readonly ok: true; readonly document: unknown }
  | { readonly ok: false; readonly reason: 'not-a-document' | 'newer'; readonly version?: number }
  | { readonly ok: false; readonly reason: 'no-step'; readonly version: number };

// The document a parsed file holds, carried to this app's version, or why it cannot be.
export function migrateDocument(parsed: unknown, chain: readonly Migration[] = MIGRATIONS, current: number = DOCUMENT_VERSION): MigrationResult {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'not-a-document' };
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, reason: 'not-a-document' };
  if (version > current) return { ok: false, reason: 'newer', version };
  let document = parsed as Record<string, unknown>;
  let at = version;
  while (at < current) {
    const step = chain.find((one) => one.from === at);
    if (step === undefined) return { ok: false, reason: 'no-step', version: at };
    document = step.migrate(document);
    at = step.to;
  }
  return { ok: true, document: document as unknown as DocumentJson };
}

// Autosave (PRODUCT.md §5; spec autosave-restore): the work kept between sessions. After every committed change of
// the document or the selection, one record holding the project's format version, the document and the selection
// is written as soon as the browser is idle (at most autosave.idleWait later, the plan's stage 4: the whole document
// was serialised inside every input, a selection's too): first to a journal in localStorage — written at once, before
// the page can unload, when the tab hides or closes —, then to IndexedDB, in one transaction; the journal is dropped
// once IndexedDB holds that revision. A journal localStorage refuses (its 5 MiB quota: a project with images inline)
// moves to IndexedDB, written at every change of the document, and the status bar says so once. A change of the
// selection alone never writes the document again to the journal (what a crash keeps is the work; the selection travels
// with the next record). At start the newest of the record and a journal is read (`readSavedWork`; a journal's is a
// crash's work, restored with a notice: spec autosave-crash-recovery), restored through the project reader every open
// uses (`restoredWork`, which src/editor/store.ts asks while it creates the store: the history starts empty), and kept
// as it was when the model refuses it (nothing overwrites it in that session). The status bar's save state comes from
// here: Not saved (no record yet, or a write IndexedDB refused, with its reason), Saving… (a change not in IndexedDB
// yet), Saved, or Recovery required (the saved work the project reader refused at start: it is kept untouched, and
// nothing is written until another project replaces the document, a restored version or File › Open or New blank page;
// spec autosave-corruption-recovery). A refused write is written again after autosave.retryDelay, and
// with the next change. While a change is not in IndexedDB, or a write was refused, leaving or reloading the tab asks
// the browser's leave-page confirmation (spec unsaved-work-guard).
import { flushDraftCaret, hasPendingDraft, subscribePendingDraft } from './drafts.ts';
import { readProject } from '../../core/project/archive.ts';
import type { DocumentJson, Selection } from '../../core/document/model.ts';
import { validateDocument, type ModelRules } from '../../core/document/validate.ts';
import type { Store } from '../../core/store/store.ts';
import { message } from '../../core/commands/registry.ts';
import { numberConstant } from '../../manifest/runtime.ts';
import { systemClock } from '../../core/ports/clock.ts';
import type { MessageId } from '../../generated/ids.ts';

let savedRevision = 0;
export const currentWorkRevision = (): number => savedRevision;

const RETRY_DELAY = numberConstant('autosave.retryDelay');
// the longest a change waits for the browser to be idle before it is written
const IDLE_WAIT = numberConstant('autosave.idleWait');

// What a record holds, in IndexedDB and in the journal alike. `format` is the format version of the saved project,
// the one project.json carries (the document's own version).
export interface SavedWork {
  readonly revision: number;
  readonly format: number;
  readonly document: unknown;
  readonly selection: unknown;
  // read from the journal of a session that ended before IndexedDB held it (a crash); never written
  readonly recovered?: boolean;
}

// A version: a write IndexedDB held, with the time it was saved (spec autosave-crash-recovery); the last
// autosave.versions are kept, the oldest dropped first.
export interface SavedVersion extends SavedWork {
  readonly time: number;
}

const DATABASE = 'work';
const STORE = 'projects';
const RECORD = 'current';
const VERSIONS = 'versions';
const KEPT_VERSIONS = numberConstant('autosave.versions');
const JOURNAL = 'work-journal';

export type SaveState = 'notSaved' | 'saving' | 'saved' | 'recoveryRequired';
let state: SaveState = 'notSaved';
// why the last write was refused (the browser's words), while it was; null otherwise
// why the last write was refused: the browser's own words, or the editor's own reason as a message of the catalogue
// (the audit's AUD-24: "IndexedDB is not available" stood in English inside the translated "Not saved: {reason}")
export type SaveRefusal = string | { readonly key: MessageId };
const NO_DATABASE: SaveRefusal = { key: 'status.save.noDatabase' };
let refusal: SaveRefusal | null = null;
const listeners = new Set<() => void>();
// The save state, for the status bar. Autosave state, not editor state: no command changes it.
export const saveState = {
  get: (): SaveState => state,
  // why IndexedDB refused the last write, while the work is not saved because of it
  reason: (): SaveRefusal | null => refusal,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
function setState(next: SaveState, reason: SaveRefusal | null = null) {
  if (next === state && reason === refusal) return;
  state = next;
  refusal = reason;
  for (const listener of [...listeners]) listener();
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains(VERSIONS)) request.result.createObjectStore(VERSIONS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}
let database: Promise<IDBDatabase | null> | null = null;
const db = () => (database ??= openDatabase());

function readRecord(): Promise<SavedWork | null> {
  return db().then(
    (opened) =>
      new Promise((resolve) => {
        if (opened === null) return resolve(null);
        const request = opened.transaction(STORE).objectStore(STORE).get(RECORD);
        request.onsuccess = () => resolve((request.result as SavedWork | undefined) ?? null);
        request.onerror = () => resolve(null);
      }),
  );
}

// writes a record: null once IndexedDB holds it, else why it did not (the browser's words)
function writeRecord(work: SavedWork): Promise<SaveRefusal | null> {
  const why = (error: unknown) => (error instanceof DOMException || error instanceof Error ? error.message || error.name : String(error));
  return db().then(
    (opened) =>
      new Promise((resolve) => {
        if (opened === null) return resolve(NO_DATABASE);
        try {
          const transaction = opened.transaction([STORE, VERSIONS], 'readwrite');
          transaction.objectStore(STORE).put(work, RECORD);
          // the version of this write, and only the last KEPT_VERSIONS of them
          const versions = transaction.objectStore(VERSIONS);
          versions.put({ ...work, time: systemClock.now() } satisfies SavedVersion, work.revision);
          const keys = versions.getAllKeys();
          keys.onsuccess = () => {
            const all = (keys.result as number[]).sort((a, b) => a - b);
            for (const old of all.slice(0, Math.max(0, all.length - KEPT_VERSIONS))) versions.delete(old);
          };
          transaction.oncomplete = () => resolve(null);
          transaction.onerror = () => resolve(why(transaction.error));
          transaction.onabort = () => resolve(why(transaction.error ?? 'the write was aborted'));
        } catch (error) {
          resolve(why(error));
        }
      }),
  );
}

function readJournal(): SavedWork | null {
  try {
    const text = window.localStorage.getItem(JOURNAL);
    return text === null ? null : (JSON.parse(text) as SavedWork);
  } catch {
    return null;
  }
}

// The journal of a project too large for localStorage (the audit's AUD-38: its quota is 5 MiB, and a project with its
// images inline outgrew it, so a crash kept only the last idle write): kept in IndexedDB beside the record, under its
// own key, written at every change of the document.
const DATABASE_JOURNAL = 'journal';
function readDatabaseJournal(): Promise<SavedWork | null> {
  return db().then(
    (opened) =>
      new Promise((resolve) => {
        if (opened === null) return resolve(null);
        try {
          const request = opened.transaction(STORE).objectStore(STORE).get(DATABASE_JOURNAL);
          request.onsuccess = () => resolve((request.result as SavedWork | undefined) ?? null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}
// writes (a work) or drops (null) the journal kept in IndexedDB; true once it is done
function writeDatabaseJournal(work: SavedWork | null): Promise<boolean> {
  return db().then(
    (opened) =>
      new Promise((resolve) => {
        if (opened === null) return resolve(false);
        try {
          const transaction = opened.transaction(STORE, 'readwrite');
          if (work === null) transaction.objectStore(STORE).delete(DATABASE_JOURNAL);
          else transaction.objectStore(STORE).put(work, DATABASE_JOURNAL);
          transaction.oncomplete = () => resolve(true);
          transaction.onerror = () => resolve(false);
          transaction.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
  );
}

// The saved work, the newest of IndexedDB's record and the journal a write left (in localStorage, or in IndexedDB for
// a project too large for it); null on a fresh profile.
export async function readSavedWork(): Promise<SavedWork | null> {
  const record = await readRecord();
  const journals = [readJournal(), await readDatabaseJournal()].filter((one): one is SavedWork => one !== null);
  const journal = journals.sort((a, b) => b.revision - a.revision)[0] ?? null;
  // a journal newer than the record: the session ended before IndexedDB held its last change
  if (journal !== null && (record === null || journal.revision > record.revision)) return record === null ? journal : { ...journal, recovered: true };
  return record;
}

// The versions IndexedDB keeps, the newest first; none when it cannot be read.
export function readVersions(): Promise<readonly SavedVersion[]> {
  return db().then(
    (opened) =>
      new Promise((resolve) => {
        if (opened === null) return resolve([]);
        const request = opened.transaction(VERSIONS).objectStore(VERSIONS).getAll();
        request.onsuccess = () => resolve(((request.result as SavedVersion[] | undefined) ?? []).sort((a, b) => b.revision - a.revision));
        request.onerror = () => resolve([]);
      }),
  );
}

// The document and the selection the saved work restores, read through the project reader every open uses; the
// selection only when it names nodes of that document. Null when there is none, or when the model refuses it.
export function restoredWork(saved: SavedWork | null | undefined, rules: ModelRules): { readonly document: DocumentJson; readonly selection: Selection; readonly recovered: boolean } | null {
  if (saved === null || saved === undefined) return null;
  const read = readProject(saved.document, rules);
  if ('refused' in read) return null;
  const selection = Array.isArray(saved.selection) ? (saved.selection as Selection) : [];
  return { document: read.document, selection: validateDocument(read.document, selection, rules).length === 0 ? selection : [], recovered: saved.recovered === true };
}

// Writes the store's document and selection after every change that commits one of them, from `saved` (the work the
// store was restored from, or null). A refused saved work is never overwritten in this session.
// `canWrite`: whether this tab may write (the tab that edits, spec multi-tab-guard); a read-only tab writes nothing
export function startAutosave<Ui>(store: Store<Ui>, saved: SavedWork | null | undefined, restored: boolean, canWrite: () => boolean = () => true): () => void {
  // a saved work the reader refused: nothing is written until another project replaces the document
  let blocked = saved !== null && saved !== undefined && !restored;
  // work made while recovery is required is never written (the saved record stays untouched): leaving the tab then
  // asks first, or it is lost without a word (the audit's AS1)
  let unwritten = false;
  let revision = typeof saved?.revision === 'number' ? saved.revision : 0;
  savedRevision = revision;
  let last = store.getState();
  setState(blocked ? 'recoveryRequired' : saved !== null && saved !== undefined ? 'saved' : 'notSaved');
  let writing = false;
  let pending: SavedWork | null = null;
  let retry = 0;
  // the revision whose document the journal holds: a change of the selection alone does not write it again
  let journalled = -1;
  let idle = 0;
  // whether the journal is kept in IndexedDB: localStorage refused it once (its 5 MiB quota, a private window), so from
  // then on it goes to IndexedDB, at every change of the document (AUD-38)
  let journalInDatabase = false;
  // the journal of the pending work, written now (when its document is not in the journal yet)
  const journalNow = (withSelection = false) => {
    const work = pending;
    if (work === null || (!withSelection && !documentRevisions.has(work.revision)) || journalled >= work.revision) return;
    const kept = () => {
      journalled = Math.max(journalled, work.revision);
      for (const older of documentRevisions) if (older < work.revision) documentRevisions.delete(older);
    };
    if (!journalInDatabase) {
      try {
        window.localStorage.setItem(JOURNAL, JSON.stringify(work));
        kept();
        return;
      } catch {
        // the journal does not fit localStorage: it moves to IndexedDB, and the status bar says so once; the older
        // journal there is dropped, so no restore takes it for the newer work
        journalInDatabase = true;
        try {
          window.localStorage.removeItem(JOURNAL);
        } catch {
          // storage refused even that: the journal in IndexedDB is newer, and the next start reads the newest
        }
        store.notice(message('status.save.journalInDatabase'));
      }
    }
    void writeDatabaseJournal(work).then((done) => {
      if (done) kept();
    });
  };
  // A draft already in session storage must not depend on a later unload event to keep the selection revision it
  // names. A selection-only revision is journalled once when the first draft is written, not on every keystroke.
  const stopDraft = subscribePendingDraft(() => journalNow(true));
  // the revisions that changed the document (a selection alone makes none of them)
  const documentRevisions = new Set<number>();
  // the pending work, written when the browser is idle: its journal, then IndexedDB
  const writeWhenIdle = () => {
    if (idle !== 0) return;
    const run = () => {
      idle = 0;
      journalNow();
      if (!writing && pending !== null) void flush();
    };
    idle = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(run, { timeout: IDLE_WAIT }) : window.setTimeout(run, 0);
  };
  const writeNow = (withSelection = false) => {
    if (idle !== 0) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      idle = 0;
    }
    journalNow(withSelection);
    if (!writing && pending !== null) void flush();
  };
  const flush = async () => {
    // a tab that has lost the editing lock to another writes nothing: its older work would overwrite the newer one
    // (the retry and the hidden-tab write come here too)
    if (!canWrite()) {
      pending = null;
      return;
    }
    writing = true;
    let failed: SaveRefusal | null = null;
    while (pending !== null) {
      const work = pending;
      pending = null;
      failed = await writeRecord(work);
      // refused: the work waits for the next change or the retry, kept in memory and in the journal
      if (failed !== null) {
        pending ??= work;
        break;
      }
      if (pending === null) {
        // IndexedDB holds the newest revision: the journal of that revision is no longer needed
        try {
          // (the revision the journal holds is known: its text is never read back to learn it)
          if (journalled === work.revision) window.localStorage.removeItem(JOURNAL);
        } catch {
          // storage refused: the journal stays, and the next start reads the same revision from either
        }
        if (journalInDatabase && journalled === work.revision) void writeDatabaseJournal(null);
      }
    }
    writing = false;
    if (failed === null) {
      setState('saved');
      return;
    }
    setState('notSaved', failed);
    window.clearTimeout(retry);
    retry = window.setTimeout(() => {
      if (!writing && pending !== null) void flush();
    }, RETRY_DELAY);
  };
  // leaving or reloading the tab while the work is not all in IndexedDB asks the browser's confirmation
  const guard = (event: BeforeUnloadEvent) => {
    flushDraftCaret();
    const draft = hasPendingDraft();
    // the work not written yet goes to the journal now, which a write finishes before the page can unload (an
    // IndexedDB write started now could be cut short: the next start reads the journal). A selection-only revision
    // is written too while it binds an unconfirmed draft, so that draft finds the same revision on the next start.
    journalNow(draft);
    if (state !== 'saving' && refusal === null && !draft && !unwritten) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', guard);
  // a hidden tab writes what is pending at once (its journal too), rather than when idle or after the retry delay
  const hidden = () => {
    if (document.visibilityState === 'hidden' && pending !== null) writeNow(hasPendingDraft());
  };
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', hidden);
  // the work a crash left in the journal alone goes to IndexedDB at once
  if (saved?.recovered === true && canWrite()) {
    const { recovered: _journal, ...work } = saved;
    void _journal;
    pending = work;
    setState('saving');
    void flush();
  }
  const unsubscribe = store.subscribe(() => {
    // a gesture's changes are kept once it commits (a drag, the colour picker's session); a cancelled one leaves the
    // document as it was, and nothing is written
    if (store.gestureOpen() || store.sequenceOpen() || store.commandGroupOpen()) return;
    const now = store.getState();
    if (now.document === last.document && now.selection === last.selection) return;
    if (!canWrite()) {
      last = now;
      return;
    }
    // while recovery is required, only a replaced document (a load: its history starts empty) is written, and
    // from then on everything is
    const replaced = now.document !== last.document && now.history.past.length === 0 && now.history.future.length === 0;
    const changedDocument = now.document !== last.document;
    last = now;
    if (blocked && !replaced) {
      unwritten = true;
      return;
    }
    blocked = false;
    unwritten = false;
    revision += 1;
    savedRevision = revision;
    const work: SavedWork = { revision, format: now.document.version, document: now.document, selection: now.selection };
    if (changedDocument) documentRevisions.add(revision);
    // a pending change of the document stays one to journal when the selection changes after it
    else if (pending !== null && documentRevisions.has(pending.revision)) documentRevisions.add(revision);
    pending = work;
    setState('saving');
    writeWhenIdle();
    // a journal kept in IndexedDB is written at once, so a crash before the idle write keeps this change
    if (journalInDatabase) journalNow();
  });
  return () => {
    stopDraft();
    unsubscribe();
    if (idle !== 0) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    }
    window.clearTimeout(retry);
    window.removeEventListener('beforeunload', guard);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', hidden);
  };
}

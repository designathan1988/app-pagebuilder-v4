// The format versions' one owner (the plan's T4): a document of the current version passes through untouched, an
// older one is carried forward step by step, a newer one is refused, and a hole in the chain is a refusal with a
// reason — never a document half-read. The chain that ships is empty (the format has not changed since version 1), so
// the steps here are the test's own: they prove the mechanism a future format change will lean on.
import { describe, expect, it } from 'vitest';
import { readProject } from '../project/archive.ts';
import { manifest } from '../../manifest/runtime.ts';
import { rulesFromManifest } from './validate.ts';
import { DOCUMENT_VERSION, createEmptyDocument } from './model.ts';
import { migrateDocument, type Migration } from './migrations.ts';
import { sequentialIds } from '../ports/ids.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const at = (version: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ version, pages: [], ...extra });

describe('the document format versions', () => {
  it('takes a document of the current version as it is', () => {
    const document = at(DOCUMENT_VERSION, { marker: 'kept' });
    const result = migrateDocument(document, [], DOCUMENT_VERSION);
    expect(result).toEqual({ ok: true, document });
  });

  it('carries an older document forward, step by step', () => {
    const steps: Migration[] = [
      { from: 1, to: 2, migrate: (d) => ({ ...d, version: 2, renamed: d.old }) },
      { from: 2, to: 3, migrate: (d) => ({ ...d, version: 3, renamed: `${String(d.renamed)}-again` }) },
    ];
    const result = migrateDocument(at(1, { old: 'value' }), steps, 3);
    expect(result).toEqual({ ok: true, document: { version: 3, pages: [], old: 'value', renamed: 'value-again' } });
  });

  it('refuses a document of a newer version, naming it', () => {
    expect(migrateDocument(at(9), [], 3)).toEqual({ ok: false, reason: 'newer', version: 9 });
  });

  it('refuses a document whose version the chain has no step for, naming it', () => {
    const steps: Migration[] = [{ from: 2, to: 3, migrate: (d) => ({ ...d, version: 3 }) }];
    expect(migrateDocument(at(1), steps, 3)).toEqual({ ok: false, reason: 'no-step', version: 1 });
  });

  it('refuses what is no document at all', () => {
    for (const notADocument of [null, 42, 'text', [], { pages: [] }, { version: 0, pages: [] }, { version: 1.5, pages: [] }]) {
      expect(migrateDocument(notADocument, [], DOCUMENT_VERSION), JSON.stringify(notADocument)).toEqual({ ok: false, reason: 'not-a-document' });
    }
  });

  it('is what the project reader uses: a newer version is refused with its reason', () => {
    const refused = readProject(at(DOCUMENT_VERSION + 1), RULES);
    expect('refused' in refused).toBe(true);
    expect('refused' in refused ? refused.refused.key : '').toBe('status.open.newerVersion');
    // and a document of this version goes through, to be validated (an empty project is one the model accepts)
    const document = createEmptyDocument(sequentialIds('n'), { page: 'Home', root: 'Page' }, RULES.root);
    const read = readProject(document, RULES);
    expect('document' in read).toBe(true);
  });

  it('opens a saved version-one project with its pages and styles intact in version three', () => {
    const old = createEmptyDocument(sequentialIds('legacy'), { page: 'Home', root: 'Page' }, RULES.root);
    const result = readProject({ ...old, version: 1 }, RULES);
    if (!('document' in result)) throw new Error(JSON.stringify(result));
    expect(result.document.version).toBe(3);
    expect(result.document.pages).toEqual(old.pages);
  });
});

// Family FP1 of the code audit (2026-10-04, second reading): a file, a folder or a page file of the project could take
// "." or ".." as a part of its path (files.rename "../a.png" made "img/../a.png"), and the validator never read the
// project's files at all. The export writes each path as an entry of the ZIP, so an archive entry climbed out of the
// folder it is unpacked into (the app's own archive reader refuses such an entry as unsafe).
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler, RULES } from '../testing/handlers.ts';
import { validateDocument } from '../document/validate.ts';
import { createFileCommand, createFolderCommand, renameFileCommand } from './files.ts';

const doc = (files: unknown, folders?: readonly string[]) =>
  documentOf({ pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('root', 'page', 'body') }], files: files as never, ...(folders === undefined ? {} : { folders }) });

describe('a project path never climbs out of the project (FP1)', () => {
  it('refuses a name that is "." or ".." or holds a separator, in rename and create', () => {
    const held = doc([{ path: 'img/a.png', type: 'image/png', bytes: '' }]);
    expect(runHandler(renameFileCommand, held, { path: 'img/a.png', name: '../a.png' }).outcome.kind).toBe('refused');
    expect(runHandler(renameFileCommand, held, { path: 'img/a.png', name: '..' }).outcome.kind).toBe('refused');
    expect(runHandler(createFolderCommand, held, { path: 'img/../up' }).outcome.kind).toBe('refused');
    expect(runHandler(createFileCommand, held, { path: './x.txt' }).outcome.kind).toBe('refused');
    expect(runHandler(renameFileCommand, held, { path: 'img/a.png', name: 'b.png' }).outcome.kind).toBe('change');
  });
  it('refuses a document whose files, folders or page files hold such a path (an opened project file)', () => {
    const paths = (document: ReturnType<typeof doc>) => validateDocument(document, [], RULES).map((p) => p.path);
    expect(paths(doc([{ path: '../../evil.js', type: 'text/javascript', bytes: '' }]))).toContain('/files/0/path');
    expect(paths(doc([{ path: 'a.png', type: 'image/png', bytes: 7 }]))).toContain('/files/0/bytes');
    expect(paths(doc([], ['img/..']))).toContain('/folders');
    expect(paths(doc([{ path: 'img/a.png', type: 'image/png', bytes: '' }]))).toEqual([]);
  });
});

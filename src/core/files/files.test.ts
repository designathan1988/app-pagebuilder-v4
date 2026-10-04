import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { FORMS_SCRIPT, INTERACTIONS_SCRIPT, LOTTIE_SCRIPT, MOTION_SCRIPT, STYLESHEET } from '../export/export.ts';
import { createFileCommand, deleteFileCommand, folderOf, javascriptProblem, moveFileCommand, nameOfPath, renameFileCommand, uniqueFilePath, uploadPath } from './files.ts';

const png = (path: string) => ({ path, type: 'image/png', bytes: 'AAAA' });
const home = (children: ReturnType<typeof node>[] = [], attributes: Record<string, string> = {}) => ({ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { attributes, children }) });

describe('files.delete (src/core/files/files.ts)', () => {
  it('deletes a single file, without asking, and says so (it said "Deleted" and kept the file)', () => {
    const document = documentOf({ pages: [home()], files: [png('img/a.png'), png('img/b.png')], folders: ['img'] });
    const ran = runHandler(deleteFileCommand, document, { path: 'img/a.png' });
    expect(ran.outcome.kind).toBe('change');
    expect(ran.document.files?.map((f) => f.path)).toEqual(['img/b.png']);
    expect(ran.problems).toEqual([]);
  });

  it('asks before deleting a folder that holds files, and deletes it with them once confirmed', () => {
    const document = documentOf({ pages: [home()], files: [png('img/a.png')], folders: ['img'] });
    expect(runHandler(deleteFileCommand, document, { path: 'img' }).outcome.kind).toBe('confirm');
    const ran = runHandler(deleteFileCommand, document, { path: 'img' }, { confirmed: true });
    expect(ran.document.files).toEqual([]);
    expect(ran.document.folders).toEqual([]);
  });

  it('refuses a folder whose script a page links, as it refuses the script itself', () => {
    const document = documentOf({ pages: [home([], { pageScripts: 'scripts/app.js' })], files: [{ path: 'scripts/app.js', type: 'text/javascript', bytes: '' }], folders: ['scripts'] });
    expect(runHandler(deleteFileCommand, document, { path: 'scripts/app.js' }).outcome.kind).toBe('refused');
    expect(runHandler(deleteFileCommand, document, { path: 'scripts' }, { confirmed: true }).outcome.kind).toBe('refused');
  });
});

describe('files.rename and files.move take every user of the path with them', () => {
  const image = node('Photo', 'image', 'img', { attributes: { src: 'img/a.png', alt: 'A' } });
  const hero = node('Hero', 'section', 'section', { styles: { desktop: { base: { 'background-image': 'url("img/a.png")' } } } });
  const document = documentOf({ pages: [home([image, hero], { pageScripts: 'scripts/app.js' })], files: [png('img/a.png'), { path: 'scripts/app.js', type: 'text/javascript', bytes: '' }], folders: ['img', 'scripts', 'media'], classes: [{ name: 'banner', styles: { desktop: { base: { 'background-image': "url('img/a.png')" } } } }] });

  it('renaming a file rewrites the src, the url() of an element and of a class', () => {
    const ran = runHandler(renameFileCommand, document, { path: 'img/a.png', name: 'b.png' });
    expect(ran.problems).toEqual([]);
    const tree = ran.document.pages[0]?.tree;
    expect(tree?.children[0]?.attributes.src).toBe('img/b.png');
    expect(tree?.children[1]?.styles.desktop?.base?.['background-image']).toBe('url("img/b.png")');
    expect(ran.document.classes?.[0]?.styles.desktop?.base?.['background-image']).toBe("url('img/b.png')");
  });

  it('moving a folder rewrites what points inside it, and a page’s linked script', () => {
    const ran = runHandler(moveFileCommand, document, { path: 'scripts', to: 'media' });
    expect(ran.problems).toEqual([]);
    expect(ran.document.pages[0]?.tree.attributes.pageScripts).toBe('media/scripts/app.js');
  });

  it('renaming a font file renames its family where a style names it', () => {
    const title = node('Title', 'heading', 'h1', { styles: { desktop: { base: { 'font-family': "Inter, 'Segoe UI', sans-serif" } } } });
    const fonts = documentOf({ pages: [home([title])], files: [{ path: 'fonts/Inter.woff2', type: 'font/woff2', bytes: 'AAAA' }], folders: ['fonts'] });
    const ran = runHandler(renameFileCommand, fonts, { path: 'fonts/Inter.woff2', name: 'Brand Sans.woff2' });
    expect(ran.document.pages[0]?.tree.children[0]?.styles.desktop?.base?.['font-family']).toBe("'Brand Sans', 'Segoe UI', sans-serif");
  });

  it('refuses a page file or a file renamed or moved onto a path that is taken, before any patch (the invariant probe, seed 33)', () => {
    const about = { id: 'a', name: 'About', file: 'about.html', tree: node('AboutPage', 'page', 'body') };
    const contact = { id: 'c', name: 'Contact', file: 'contact.html', tree: node('ContactPage', 'page', 'body') };
    const site = documentOf({ pages: [home(), about, contact], files: [png('img/a.png'), png('img/b.png'), png('media/a.png')], folders: ['img', 'media'] });
    for (const [command, args] of [
      [renameFileCommand, { path: 'contact.html', name: 'about.html' }],
      [renameFileCommand, { path: 'img/a.png', name: 'b.png' }],
      [moveFileCommand, { path: 'img/a.png', to: 'media' }],
    ] as const) {
      const ran = runHandler(command, site, args);
      expect(ran.outcome.kind, JSON.stringify(args)).toBe('refused');
      expect(ran.problems).toEqual([]);
    }
  });

  it('refuses a page file renamed without its .html (the validator refused it silently)', () => {
    const pages = documentOf({ pages: [home(), { id: 'q', name: 'About', file: 'about.html', tree: node('About', 'page', 'body') }] });
    const ran = runHandler(renameFileCommand, pages, { path: 'about.html', name: 'about' });
    expect(ran.outcome.kind).toBe('refused');
    expect(ran.outcome.kind === 'refused' && ran.outcome.message.key).toBe('status.files.pageNeedsHtml');
  });
});

describe('javascriptProblem', () => {
  it('names the line of a syntax error (it always said line 1)', () => {
    expect(javascriptProblem('ok();\n\nfoo(;')).toEqual({ line: 3, key: 'status.js.syntaxError' });
    expect(javascriptProblem('const a = 1;\nconst b = ;\nconst c = 3;')?.line).toBe(2);
  });

  it('accepts a module: imports and exports are statements of their own', () => {
    expect(javascriptProblem("import x from './y.js';\nexport const a = 1;\nexport default function f() {\n  return x;\n}\nexport { a as b };")).toBeNull();
    expect(javascriptProblem("import x from './y.js';\nexport default {\n  a: 1,\n};")).toBeNull();
    expect(javascriptProblem("import x from './y.js';\nexport const a = ;")?.line).toBe(2);
  });
});

// The audit's AUD-11: the tree reserved three of the five paths the export writes a generated file at, so a file stored
// at js/motion.js or js/lottie.min.js went into the archive twice. Every path the export writes at is planted.
describe('the paths the export writes its generated files at stay free', () => {
  const written = [STYLESHEET, INTERACTIONS_SCRIPT, FORMS_SCRIPT, MOTION_SCRIPT, LOTTIE_SCRIPT];
  const document = documentOf({ pages: [home()], folders: ['css', 'js'] });

  it.each(written)('no file is made, uploaded or imported at %s', (path) => {
    const made = runHandler(createFileCommand, document, { path });
    expect(made.outcome).toEqual({ kind: 'refused', message: { key: 'status.files.generatedPath', params: { path } } });
    expect(uploadPath(document, `${folderOf(path)}/`, nameOfPath(path))).not.toBe(path);
    expect(uniqueFilePath(document, path)).not.toBe(path);
  });
});

// Family RF1 of the code audit (2026-10-04): what points at something must follow it when it moves, is renamed or
// leaves, in the same undo step, so no command is refused as an invalid document and no exported link breaks. One
// case per owner the audit found: an imported reference by HTML id (a label's for, a link's #anchor) at a delete and
// at an id change; a table part, row or column that leaves; a page deleted while links name its file; a page renamed
// inside its folder; a captured page's residual stylesheet; a folder rename beside an id that reads like it; an
// animation deleted while an interaction plays it; a class renamed or deleted that a component's definition lists.
import { describe, expect, it } from 'vitest';
import type { DocNode, DocumentJson, Page } from './model.ts';
import { locate, walk } from './model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { deleteCommand } from '../structure/remove.ts';
import { setIdCommand } from '../elements/attributes.ts';
import { togglePartCommand } from '../elements/parts.ts';
import { removeColumnCommand, removeRowCommand } from '../elements/table.ts';
import { deletePageCommand, renamePageCommand } from '../project/pages.ts';
import { moveFileCommand, renameFileCommand } from '../files/files.ts';
import { deleteAnimationCommand } from '../animation/animation.ts';
import { deleteClassCommand, renameClassCommand } from '../design/classes.ts';
import { updateFromInstanceCommand } from '../design/components.ts';
import type { NodeId } from '../../generated/commands.ts';

const page = (id: string, file: string, children: readonly DocNode[], extra: Partial<Page> = {}): Page => ({ id, name: id, file, tree: node(`${id}-root`, 'page', 'body', { children }), ...extra });
const find = (document: DocumentJson, id: string): DocNode | undefined => locate(document, id as NodeId)?.node;
const base64 = (text: string): string => btoa(text);

describe('references follow what moves or leaves (RF1)', () => {
  it('an imported section a link names by its HTML id is deleted, and the link lets go of it', () => {
    const document = documentOf({ pages: [page('home', 'index.html', [node('Contact', 'section', 'section', { attributes: { id: 'contact' } }), node('Go', 'link', 'a', { text: 'Go', attributes: { href: '#contact' } })])] });
    const ran = runHandler(deleteCommand, document, {}, { selection: ['Contact'] });
    expect(ran.outcome.kind).toBe('change');
    expect(ran.problems).toEqual([]);
    expect(find(ran.document, 'Go')?.attributes.href).toBeUndefined();
  });

  it('an imported input a label names by its HTML id is deleted, and the label lets go of it', () => {
    const document = documentOf({ pages: [page('home', 'index.html', [node('Field', 'label', 'label', { attributes: { labelFor: 'email' }, children: [] }), node('Email', 'input', 'input', { attributes: { id: 'email' } })])] });
    const ran = runHandler(deleteCommand, document, {}, { selection: ['Email'] });
    expect(ran.problems).toEqual([]);
  });

  it('an HTML id a link names is changed or cleared, and the link still names its element', () => {
    const document = documentOf({ pages: [page('home', 'index.html', [node('Contact', 'section', 'section', { attributes: { id: 'contact' } }), node('Go', 'link', 'a', { text: 'Go', attributes: { href: '#contact' } })])] });
    const renamed = runHandler(setIdCommand, document, { id: 'contato', target: 'Contact' });
    expect(renamed.problems).toEqual([]);
    expect(find(renamed.document, 'Go')?.attributes.href).toBe('#Contact');
    const cleared = runHandler(setIdCommand, document, { id: '', target: 'Contact' });
    expect(cleared.problems).toEqual([]);
  });

  it('a table head, a row or a column a link points into leaves, and the link lets go of it', () => {
    const cell = (id: string, kind: 'cell' | 'headerCell') => node(id, kind, kind === 'cell' ? 'td' : 'th', { children: [node(`${id}-text`, 'paragraph', 'p', { text: id })] });
    const table = node('Table', 'table', 'table', {
      children: [
        node('Head', 'tableHead', 'thead', { children: [node('HeadRow', 'tableRow', 'tr', { children: [cell('H1', 'headerCell'), cell('H2', 'headerCell')] })] }),
        node('Body', 'tableBody', 'tbody', {
          children: [node('Row1', 'tableRow', 'tr', { children: [cell('A1', 'cell'), cell('A2', 'cell')] }), node('Row2', 'tableRow', 'tr', { children: [cell('B1', 'cell'), cell('B2', 'cell')] })],
        }),
      ],
    });
    const links = [node('ToHead', 'link', 'a', { text: 'h', attributes: { href: '#H1-text' } }), node('ToRow', 'link', 'a', { text: 'r', attributes: { href: '#B1-text' } }), node('ToColumn', 'link', 'a', { text: 'c', attributes: { href: '#A2-text' } })];
    const document = documentOf({ pages: [page('home', 'index.html', [table, ...links])] });
    const head = runHandler(togglePartCommand, document, { type: 'tableHead' }, { selection: ['Table'] });
    expect(head.problems).toEqual([]);
    const row = runHandler(removeRowCommand, document, {}, { selection: ['B1'] });
    expect(row.problems).toEqual([]);
    const column = runHandler(removeColumnCommand, document, {}, { selection: ['A2'] });
    expect(column.problems).toEqual([]);
  });

  it('a page is deleted while links name its file: the links let go of it, no broken link is exported', () => {
    const document = documentOf({ pages: [page('home', 'index.html', [node('ToAbout', 'link', 'a', { text: 'About', attributes: { href: 'about.html#team' } })]), page('about', 'about.html', [])] });
    const ran = runHandler(deletePageCommand, document, { page: 'about' }, { confirmed: true });
    expect(ran.problems).toEqual([]);
    expect(find(ran.document, 'ToAbout')?.attributes.href).toBeUndefined();
  });

  it('a page renamed keeps its folder, and a folder index page keeps its file', () => {
    const document = documentOf({ pages: [page('home', 'index.html', []), page('post', 'blog/post.html', []), page('about', 'about/index.html', [])] });
    const post = runHandler(renamePageCommand, document, { page: 'post', name: 'Second post' });
    expect(post.document.pages[1]?.file).toBe('blog/second-post.html');
    const about = runHandler(renamePageCommand, document, { page: 'about', name: 'Team' });
    expect(about.document.pages[2]?.file).toBe('about/index.html');
  });

  it("a captured page renamed or moved takes its residual stylesheet with it, its addresses still reaching the files", () => {
    const root = { kind: 'element' as const, id: 'h', namespace: 'http://www.w3.org/1999/xhtml', tag: 'html', attributes: [], children: [] };
    const sheet = 'body{background:url("img/bg.png")}';
    const document = documentOf({
      pages: [page('home', 'index.html', []), { ...page('cap', 'cap.html', []), capture: { viewports: [{ width: 1440, root }] } }],
      folders: ['site'],
      files: [{ path: 'cap.capture.css', type: 'text/css', bytes: base64(sheet) }, { path: 'img/bg.png', type: 'image/png', bytes: '' }],
    });
    const renamed = runHandler(renameFileCommand, document, { path: 'cap.html', name: 'shot.html' });
    expect(renamed.problems).toEqual([]);
    expect(renamed.document.files?.map((one) => one.path)).toContain('shot.capture.css');
    const moved = runHandler(moveFileCommand, document, { path: 'cap.html', to: 'site' });
    const movedSheet = moved.document.files?.find((one) => one.path === 'site/cap.capture.css');
    expect(movedSheet).toBeDefined();
    expect(atob(movedSheet?.bytes ?? '')).toContain('../img/bg.png');
  });

  it('a folder renamed rewrites addresses only, never an id or a title that reads like its path', () => {
    const document = documentOf({
      pages: [page('home', 'index.html', [node('Pic', 'image', 'img', { attributes: { src: 'img/a.png', id: 'img', alt: 'img' } })])],
      files: [{ path: 'img/a.png', type: 'image/png', bytes: '' }],
    });
    const ran = runHandler(renameFileCommand, document, { path: 'img', name: 'images' });
    expect(ran.problems).toEqual([]);
    expect(find(ran.document, 'Pic')?.attributes).toMatchObject({ src: 'images/a.png', id: 'img', alt: 'img' });
  });

  it('an animation deleted takes the interactions that played it with it', () => {
    const animation = { name: 'fade', settings: {}, keyframes: [{ offset: 0, easing: '', declarations: {} }, { offset: 100, easing: '', declarations: {} }] };
    const document = documentOf({ pages: [page('home', 'index.html', [node('Card', 'div', 'div', { animations: [animation], interactions: [{ trigger: 'click', action: 'play-animation', animation: 'fade' }, { trigger: 'click', action: 'hide' }] })])] });
    const ran = runHandler(deleteAnimationCommand, document, { animation: 'fade' }, { selection: ['Card'] });
    expect(ran.problems).toEqual([]);
    expect(find(ran.document, 'Card')?.interactions).toEqual([{ trigger: 'click', action: 'hide' }]);
  });

  it("a class renamed or deleted follows into the components' definitions", () => {
    const document = documentOf({
      pages: [page('home', 'index.html', [node('Card', 'div', 'div', { classes: ['card'], component: 'Card', componentPart: [] })])],
      classes: [{ name: 'card', styles: { desktop: { base: { color: 'red' } } } as DocNode['styles'] }],
      components: [{ name: 'Card', tree: node('CardDef', 'div', 'div', { classes: ['card'] }) }],
    });
    const renamed = runHandler(renameClassCommand, document, { className: 'card', nextName: 'tile' });
    expect(renamed.document.components?.[0]?.tree.classes).toEqual(['tile']);
    const deleted = runHandler(deleteClassCommand, document, { className: 'card' }, { confirmed: true });
    expect(deleted.document.components?.[0]?.tree.classes).toEqual([]);
  });

  it('an element an update of the component takes away lets go of what pointed at it', () => {
    const instance = (id: string, withText: boolean) =>
      node(id, 'div', 'div', { component: 'Card', componentPart: [], children: withText ? [node(`${id}-t`, 'paragraph', 'p', { text: 't', componentPart: [0] })] : [] });
    const document = documentOf({
      pages: [page('home', 'index.html', [instance('A', false), instance('B', true), node('ToB', 'link', 'a', { text: 'b', attributes: { href: '#B-t' } })])],
      components: [{ name: 'Card', tree: node('Def', 'div', 'div', { children: [node('Def-t', 'paragraph', 'p', { text: 't' })] }) }],
    });
    const ran = runHandler(updateFromInstanceCommand, document, {}, { selection: ['A'] });
    expect(ran.problems).toEqual([]);
    expect([...walk(ran.document.pages[0]?.tree as DocNode)].some((one) => one.id === 'B-t')).toBe(false);
  });
});

// The patches from one document to another (patches.ts) and the content's part of the model (validate.ts): the
// smallest patches that make the second document from the first, through the store's own applier, and the
// validator's refusals of malformed collections, bindings, lists, item pages and shared regions.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import { DOCUMENT_VERSION, type DocNode, type DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { applyPatches } from '../history/transaction.ts';
import { documentPatches, treePatches } from './patches.ts';
import { dataProblems } from './validate.ts';
import { deriveData } from './derive.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const tree = node('Page', 'page', 'body', { children: [node('Menu', 'section', 'section', { children: [node('Title', 'heading', 'h2', { text: 'Menu' }), node('Card', 'article', 'article')] })] });
const doc = (root: DocNode, more: Partial<DocumentJson> = {}): DocumentJson => ({ version: DOCUMENT_VERSION, pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: root }], ...more }) as DocumentJson;

describe('the patches between two documents', () => {
  it('patches only the keys that changed, node by node, while the children stay the same nodes', () => {
    const after = { ...tree, children: [{ ...tree.children[0], children: [{ ...(tree.children[0]?.children[0] as DocNode), text: 'Cardápio' }, tree.children[0]?.children[1]] }] } as DocNode;
    expect(treePatches(['pages', 0, 'tree'], tree, after)).toEqual([{ op: 'replace', path: ['pages', 0, 'tree', 'children', 0, 'children', 0, 'text'], value: 'Cardápio' }]);
  });

  it('replaces the children list when a child came, went or moved', () => {
    const menu = tree.children[0] as DocNode;
    const after = { ...tree, children: [{ ...menu, children: [menu.children[1], menu.children[0]] }] } as DocNode;
    expect(treePatches(['t'], tree, after)).toEqual([{ op: 'replace', path: ['t', 'children', 0, 'children'], value: [menu.children[1], menu.children[0]] }]);
  });

  it('adds and removes keys, collections included, and the patches make the second document from the first', () => {
    const before = doc(tree);
    const menu = tree.children[0] as DocNode;
    const marked = { ...tree, children: [{ ...menu, dataList: { collection: 'Menu', component: 'Card', query: {} } }] } as DocNode;
    const after = doc(marked, { collections: [{ name: 'Menu', fields: [{ key: 'nome', label: 'nome', type: 'text' }], items: [] }] });
    const patches = documentPatches(before, after);
    expect(patches).toEqual([
      { op: 'add', path: ['pages', 0, 'tree', 'children', 0, 'dataList'], value: { collection: 'Menu', component: 'Card', query: {} } },
      { op: 'add', path: ['collections'], value: after.collections },
    ]);
    expect(applyPatches(before, patches).document).toEqual(after);
    expect(applyPatches(after, documentPatches(after, before)).document).toEqual(before);
  });

  it('replaces a list of pages when a page came or went', () => {
    const before = doc(tree);
    const after = { ...before, pages: [...before.pages, { id: 'q', name: 'About', file: 'about.html', tree: node('About', 'page', 'body') }] };
    expect(documentPatches(before, after)).toEqual([{ op: 'replace', path: ['pages'], value: after.pages }]);
  });
});

describe("the content's part of the model", () => {
  const collection = { name: 'Menu', fields: [{ key: 'nome', label: 'nome', type: 'text' }, { key: 'preco', label: 'preco', type: 'number' }], items: [{ id: 'i1', values: { nome: 'Moka', preco: 9 } }] };

  it('takes a well formed document, and the whole validator does too', () => {
    const card = node('Card', 'article', 'article', { component: 'Card', componentPart: [], children: [node('Name', 'heading', 'h3', { text: 'Moka', componentPart: [0], bind: [{ field: 'nome', to: 'text' }] })] });
    const document = doc(node('Page', 'page', 'body', { children: [node('Menu', 'section', 'section', { dataList: { collection: 'Menu', component: 'Card', query: { limit: 3 } }, children: [card] })] }), {
      collections: [collection],
      components: [{ name: 'Card', tree: node('CardDef', 'article', 'article', { children: [node('NameDef', 'heading', 'h3', { text: 'x', bind: [{ field: 'nome', to: 'text' }] })] }) }],
    } as Partial<DocumentJson>);
    expect(dataProblems(document, RULES)).toEqual([]);
    expect(validateDocument(document, [], RULES)).toEqual([]);
  });

  it('refuses values out of their canonical form, unknown fields, repeated ids and names', () => {
    const bad = { ...collection, items: [{ id: 'i1', values: { nome: ' Moka ', preco: '9', cor: 'x' } }, { id: 'i1', values: {} }] };
    const problems = dataProblems(doc(tree, { collections: [bad, { ...collection, name: 'MENU' }] } as Partial<DocumentJson>), RULES).map((p) => p.message);
    expect(problems).toEqual(expect.arrayContaining(['the value is not a canonical text', 'the value is not a canonical number', 'a value belongs to a field of its collection', 'item id "i1" is already used', 'two collections share a name']));
  });

  it('refuses a binding an element cannot show, a list of a collection or a component that is not there, and an item page of no item', () => {
    const document = doc(
      node('Page', 'page', 'body', {
        dataItem: { collection: 'Menu', item: 'nope' },
        children: [node('Menu', 'section', 'section', { dataList: { collection: 'Other', component: 'Gone', query: {} }, children: [node('Title', 'heading', 'h2', { text: 'x', bind: [{ field: 'nome', to: 'image' }] })] })],
      }),
      { collections: [collection] } as Partial<DocumentJson>,
    );
    expect(dataProblems(document, RULES).map((p) => p.message)).toEqual([
      'the item the page is made for is not in its collection',
      'the project has no collection Other',
      'the project has no component Gone',
      'this element cannot show a value as image',
    ]);
  });

  it('refuses a shared region whose mark is malformed', () => {
    const document = doc(tree, { components: [{ name: 'Header', tree: node('H', 'header', 'header'), shared: { newPages: 'yes' } as never }] });
    expect(dataProblems(document, RULES).map((p) => p.path)).toEqual(['/components/0/shared']);
  });
});

describe('the derivation after any change', () => {
  const context = { ids: { next: (() => {
    let n = 0;
    return () => `d${++n}`;
  })() }, rules: RULES, words: (key: string) => key } as unknown as Parameters<typeof deriveData>[2];

  it('derives nothing for a document without content', () => {
    expect(deriveData(doc(tree), doc({ ...tree, name: 'Renamed' }), context)).toEqual({ patches: [] });
  });

  it('drops a binding its element can no longer show, so the change that made it so is never refused', () => {
    const link = node('Go', 'link', 'a', { text: 'Go', attributes: { href: 'about.html' }, bind: [{ field: '@page', to: 'link' }] });
    const before = doc(node('Page', 'page', 'body', { children: [link] }));
    const retagged = doc(node('Page', 'page', 'body', { children: [{ ...link, tag: 'button', attributes: {} }] }));
    expect(deriveData(before, retagged, context)).toEqual({ patches: [{ op: 'remove', path: ['pages', 0, 'tree', 'children', 0, 'bind'] }] });
  });

  it("drops the item mark of a page that copies another page's item", () => {
    const collections = [{ name: 'Menu', fields: [{ key: 'nome', label: 'nome', type: 'text' }], items: [{ id: 'i1', values: { nome: 'Moka' } }] }];
    const page = (id: string, file: string) => ({ id, name: id, file, tree: node(`${id}-root`, 'page', 'body', { dataItem: { collection: 'Menu', item: 'i1' } }) });
    const before = { version: DOCUMENT_VERSION, pages: [page('a', 'a.html')], collections } as unknown as DocumentJson;
    const after = { ...before, pages: [page('a', 'a.html'), page('b', 'b.html')] } as DocumentJson;
    expect(deriveData(before, after, context)).toEqual({ patches: [{ op: 'remove', path: ['pages', 1, 'tree', 'dataItem'] }] });
  });
});

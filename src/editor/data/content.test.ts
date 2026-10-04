// @vitest-environment happy-dom
// The content commands on the editor's own store (spec data-import, data-binding, data-pages, shared-regions): every
// command through the real command table, the derivation the store runs after each change, the validator on every
// commit, and one undo step for each whole change. jornada03 C4 runs here with Carla's original CSV as the door reads
// it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommandId } from '../../generated/ids.ts';
import { manualClock } from '../../core/ports/clock.ts';
import { sequentialIds } from '../../core/ports/ids.ts';
import { walk, type DocNode, type DocumentJson } from '../../core/document/model.ts';
import { readDataFileSafely } from '../../core/data/readers.ts';
import { createEditorStore, type EditorStore } from '../store.ts';
import { textOf } from '../text.ts';
import { domXml } from './read-file.ts';

type Dispatch = (id: CommandId, args: unknown) => { readonly status: string };
const memory = (): { read(): string | null; write(text: string): void } => {
  let held: string | null = null;
  return { read: () => held, write: (text) => void (held = text) };
};

function storeOf(fixture: string): EditorStore {
  const document = JSON.parse(readFileSync(`manifest/features/fixtures/${fixture}.json`, 'utf8')) as DocumentJson;
  return createEditorStore({ storage: memory(), workspace: memory(), clock: manualClock(1_000_000), ids: sequentialIds('t'), restored: { document, selection: [] }, ports: { readOnly: () => false }, freeze: true });
}
const run = (store: EditorStore, id: string, args: unknown = {}) => (store.dispatch as unknown as Dispatch)(id as CommandId, args);
const said = (store: EditorStore): string => {
  const message = store.getState().message;
  return message === null ? '' : textOf('en', message.key, message.params);
};
const nodes = (document: DocumentJson): DocNode[] => document.pages.flatMap((page) => [...walk(page.tree)]);
const named = (store: EditorStore, name: string): DocNode => {
  const found = nodes(store.getState().document).find((node) => node.name === name);
  if (found === undefined) throw new Error(`no node named ${name}`);
  return found;
};
const cards = (store: EditorStore): DocNode[] => named(store, 'Menu').children.filter((child) => child.component === 'Card');
const shown = (card: DocNode) => ({ photo: card.children[0]?.attributes.src, title: card.children[1]?.text, price: card.children[2]?.text });
const undoAll = (store: EditorStore) => {
  while (store.getState().history.past.length > 0) run(store, 'history.undo');
};

describe("jornada03 C4: Carla's cardapio.csv fills her card", () => {
  it('imports the original file, connects the card and fills twelve cards, photos found by file name, in one undo step each', async () => {
    const store = storeOf('content-menu');
    const before = store.getState().document;
    // the door reads the file as it reads any file the person picks (door.tsx, fileReading "data")
    const handed = await readDataFileSafely('cardapio.csv', new Uint8Array(readFileSync('manifest/features/fixtures/import/cardapio.csv')), domXml);
    expect(run(store, 'data.preview', { file: JSON.stringify(handed) }).status).toBe('done');
    expect(store.getState().ui.data?.preview?.types).toEqual({ nome: 'text', preco: 'text', foto: 'image' });
    run(store, 'data.importNew', { name: 'Carla' });
    expect(said(store)).toBe('Imported 12 items into Carla.');
    expect(store.getState().ui.data?.collection).toBe('Carla');
    expect(store.getState().document.collections?.find((c) => c.name === 'Carla')?.items).toHaveLength(12);
    // the parts of the card, each connected to a column
    run(store, 'data.bindElement', { node: named(store, 'Photo').id, field: 'foto', to: 'image' });
    run(store, 'data.bindElement', { node: named(store, 'Title').id, field: 'nome', to: 'text' });
    run(store, 'data.bindElement', { node: named(store, 'Price').id, field: 'preco', to: 'text' });
    run(store, 'data.bindElement', { node: named(store, 'Photo').id, field: 'nome', to: 'alt' });
    expect(run(store, 'data.fill', { node: named(store, 'Card').id, collection: 'Carla', query: {} }).status).toBe('done');
    expect(said(store)).toBe('Card repeats 12 items of Carla.');
    const filled = cards(store);
    expect(filled).toHaveLength(12);
    expect(shown(filled[0] as DocNode)).toEqual({ photo: 'img/graos.png', title: 'Espresso Grão Norte', price: 'R$ 42' });
    expect(shown(filled[11] as DocNode)).toEqual({ photo: 'img/loja.png', title: 'Assinatura presente', price: 'R$ 199' });
    expect(filled[1]?.children[0]?.attributes.alt).toBe('Filtrado Sul de Minas');
    expect(filled.map((card) => card.name).slice(0, 3)).toEqual(['Card', 'Card 2', 'Card 3']);
    // the section's own heading stays where it was
    expect(named(store, 'Menu').children[0]?.name).toBe('Our menu');
    expect(named(store, 'Menu').dataList).toEqual({ collection: 'Carla', component: 'Card', query: {} });
    // one undo takes the fill back whole, and redo brings it again
    run(store, 'history.undo');
    expect(cards(store)).toHaveLength(0);
    run(store, 'history.redo');
    expect(cards(store)).toHaveLength(12);
    undoAll(store);
    expect(store.getState().document).toEqual(before);
  });

  it('refuses a photo no project file answers to, naming the row, the column and the cell, and changes nothing', () => {
    const store = storeOf('content-menu-bound');
    run(store, 'data.setCell', { collection: 'Cardapio', item: 'item-2', field: 'foto', value: 'falta.png' });
    const before = store.getState().document;
    expect(run(store, 'data.fill', { node: named(store, 'Card').id, collection: 'Cardapio', query: {} }).status).toBe('refused');
    expect(said(store)).toBe('Row 2 of the data: “falta.png” in the column foto names no image of the project (by its path or file name) nor a web address. Nothing was filled.');
    expect(store.getState().document).toBe(before);
  });

  it('refuses a card with no connected part and a field the collection does not have', () => {
    const store = storeOf('content-menu');
    expect(run(store, 'data.fill', { node: named(store, 'Card').id, collection: 'Cardapio', query: {} }).status).toBe('refused');
    expect(said(store)).toBe('Card shows no field yet: connect at least one of its parts to a field first.');
    run(store, 'data.bindElement', { node: named(store, 'Title').id, field: 'sabor', to: 'text' });
    expect(run(store, 'data.fill', { node: named(store, 'Card').id, collection: 'Cardapio', query: {} }).status).toBe('refused');
    expect(said(store)).toBe('Cardapio has no field sabor.');
  });

  it('refuses a part that cannot show the target', () => {
    const store = storeOf('content-menu');
    expect(run(store, 'data.bindElement', { node: named(store, 'Title').id, field: 'foto', to: 'image' }).status).toBe('refused');
    expect(said(store)).toBe('Title cannot show a value as image.');
  });
});

describe('a bound list follows its collection', () => {
  it('shows an edited cell, in the same undo step as the edit', () => {
    const store = storeOf('content-menu-list');
    run(store, 'data.setCell', { collection: 'Cardapio', item: 'item-2', field: 'preco', value: 'R$ 50' });
    expect(shown(cards(store)[1] as DocNode).price).toBe('R$ 50');
    expect(store.getState().history.past).toHaveLength(1);
    run(store, 'history.undo');
    expect(shown(cards(store)[1] as DocNode).price).toBe('R$ 46');
  });

  it('adds a card for a new item, removes the card of a deleted one, and reorders with the items', () => {
    const store = storeOf('content-menu-list');
    const ids = cards(store).map((card) => card.id);
    run(store, 'data.addItem', { collection: 'Cardapio' });
    run(store, 'data.setCell', { collection: 'Cardapio', item: 't1', field: 'nome', value: 'Moka' });
    expect(cards(store)).toHaveLength(4);
    expect(shown(cards(store)[3] as DocNode).title).toBe('Moka');
    // the new item shows no photo of its own yet: the card keeps the template's
    expect(shown(cards(store)[3] as DocNode).photo).toBe('img/graos.png');
    run(store, 'data.moveItem', { collection: 'Cardapio', item: 'item-3', to: 0 });
    expect(cards(store).map((card) => shown(card).title)).toEqual(['Descafeinado', 'Espresso Grão Norte', 'Filtrado Sul de Minas', 'Moka']);
    // the repeated items keep their nodes: the n-th card shows the n-th item
    expect(cards(store).slice(0, 3).map((card) => card.id)).toEqual(ids);
    run(store, 'data.deleteItems', { collection: 'Cardapio', items: ['item-1'] });
    expect(cards(store)).toHaveLength(3);
    expect(named(store, 'Menu').children[0]?.name).toBe('Our menu');
  });

  it('shows what the query chooses: filtered, sorted and limited', () => {
    const store = storeOf('content-menu-list');
    const list = named(store, 'Menu');
    run(store, 'data.fill', { node: cards(store)[0]?.id, collection: 'Cardapio', query: { order: [{ field: 'nome', direction: 'asc' }], limit: 2 } });
    expect(cards(store).map((card) => shown(card).title)).toEqual(['Descafeinado', 'Espresso Grão Norte']);
    expect(named(store, 'Menu').id).toBe(list.id);
  });

  it('chooses, orders and limits what the panel shows, saying how many', () => {
    const store = storeOf('content-menu-list');
    run(store, 'data.setQuery', { part: 'sortFirst', value: 'nome:desc' });
    run(store, 'data.setQuery', { part: 'limit', value: '2' });
    expect(store.getState().ui.data?.query).toEqual({ order: [{ field: 'nome', direction: 'desc' }], limit: 2 });
    expect(said(store)).toBe('Cardapio shows 2 items of 3.');
    run(store, 'data.setQuery', { part: 'filterField', value: 'nome' });
    run(store, 'data.setQuery', { part: 'filterValue', value: 'esp' });
    expect(said(store)).toBe('Cardapio shows 1 item of 3.');
    expect(run(store, 'data.setQuery', { part: 'offset', value: '-1' }).status).toBe('refused');
    run(store, 'data.setQuery', { part: 'clear' });
    expect(store.getState().ui.data?.query).toEqual({});
  });

  it('writes a bound text typed on the canvas back to its item, and refuses one its field cannot hold', () => {
    const store = storeOf('content-menu-list');
    const title = cards(store)[2]?.children[1] as DocNode;
    expect(run(store, 'text.set', { target: title.id, content: 'Descafeinado especial' }).status).toBe('done');
    expect(store.getState().document.collections?.[0]?.items[2]?.values.nome).toBe('Descafeinado especial');
    run(store, 'data.addField', { label: 'estoque', type: 'number' });
    run(store, 'data.bindElement', { node: named(store, 'Price').id, field: 'estoque', to: 'text' });
    run(store, 'data.setCell', { collection: 'Cardapio', item: 'item-1', field: 'estoque', value: '3' });
    expect(run(store, 'text.set', { target: named(store, 'Price').id, content: 'many' }).status).toBe('refused');
    expect(said(store)).toBe('Row 1 of Cardapio: “many” in estoque is not a Number. Nothing was changed.');
  });

  it('refuses a card duplicated or deleted by hand, saying where its cards come from', () => {
    const store = storeOf('content-menu-list');
    run(store, 'selection.select', { target: cards(store)[1]?.id });
    expect(run(store, 'element.duplicate').status).toBe('refused');
    expect(said(store)).toBe('Menu repeats the items of Cardapio: add, delete or move rows in the Data panel to change its cards.');
    expect(run(store, 'element.delete').status).toBe('refused');
    expect(cards(store)).toHaveLength(3);
  });

  it('lets go of a selected card whose item is deleted', () => {
    const store = storeOf('content-menu-list');
    run(store, 'selection.select', { target: cards(store)[2]?.id });
    expect(run(store, 'data.deleteItems', { collection: 'Cardapio', items: ['item-3'] }).status).toBe('done');
    expect(store.getState().selection).toEqual([]);
  });

  it('never makes a component of an element that holds an instance', () => {
    const store = storeOf('content-menu-list');
    run(store, 'selection.select', { target: named(store, 'Menu').id });
    expect(run(store, 'components.create', {}).status).toBe('refused');
    expect(said(store)).toBe('Menu holds an instance of a component: detach it first, since an instance never lies inside another.');
  });

  it('stops following its collection on unbind, its cards staying as they are', () => {
    const store = storeOf('content-menu-list');
    run(store, 'data.unbind', { node: cards(store)[0]?.id });
    expect(named(store, 'Menu').dataList).toBeUndefined();
    run(store, 'data.setCell', { collection: 'Cardapio', item: 'item-1', field: 'nome', value: 'Outro' });
    expect(shown(cards(store)[0] as DocNode).title).toBe('Espresso Grão Norte');
  });

  it('refuses removing a field a binding uses, and releases the lists of a deleted collection', () => {
    const store = storeOf('content-menu-list');
    expect(run(store, 'data.removeField', { collection: 'Cardapio', field: 'nome' }).status).toBe('refused');
    expect(said(store)).toBe('nome of Cardapio has 1 use (binding, filter or sort). Remove it first.');
    expect(run(store, 'data.deleteCollection', { collection: 'Cardapio' }).status).toBe('confirm');
    store.answer(true);
    expect(store.getState().document.collections).toBeUndefined();
    expect(named(store, 'Menu').dataList).toBeUndefined();
    expect(cards(store)).toHaveLength(3);
  });

  it('follows a renamed collection', () => {
    const store = storeOf('content-menu-list');
    run(store, 'data.renameCollection', { collection: 'Cardapio', name: 'Menu do dia' });
    expect(named(store, 'Menu').dataList?.collection).toBe('Menu do dia');
    expect(run(store, 'data.renameCollection', { collection: 'Menu do dia', name: '' }).status).toBe('refused');
  });
});

describe('pages from a page', () => {
  it('makes a page per name, copies of the open page, and opens the first', () => {
    const store = storeOf('content-site');
    run(store, 'pages.fromNames', { names: 'Unidade Centro\n\nUnidade Norte\n' });
    const pages = store.getState().document.pages;
    expect(pages.map((page) => [page.name, page.file])).toEqual([
      ['Home', 'index.html'],
      ['Unidade Centro', 'unidade-centro.html'],
      ['Unidade Norte', 'unidade-norte.html'],
      ['About', 'about.html'],
      ['Contact', 'contact.html'],
    ]);
    expect(store.getState().ui.page).toBe(pages[1]?.id);
    expect(said(store)).toBe('Made 2 pages from Home.');
    expect(store.getState().history.past).toHaveLength(1);
    expect(run(store, 'pages.fromNames', { names: ' \n ' }).status).toBe('refused');
  });

  it('makes a page per item, its bindings showing the item, and keeps its file when the item changes', () => {
    const store = storeOf('content-menu-list');
    run(store, 'pages.switch', { page: 'product' });
    run(store, 'pages.fromCollection', { collection: 'Cardapio', nameField: 'nome' });
    const made = store.getState().document.pages.filter((page) => page.tree.dataItem !== undefined);
    expect(made.map((page) => [page.name, page.file, page.tree.dataItem?.item])).toEqual([
      ['Espresso Grão Norte', 'espresso-grao-norte.html', 'item-1'],
      ['Filtrado Sul de Minas', 'filtrado-sul-de-minas.html', 'item-2'],
      ['Descafeinado', 'descafeinado.html', 'item-3'],
    ]);
    const second = made[1] as (typeof made)[number];
    expect(second.tree.children[0]?.text).toBe('Filtrado Sul de Minas');
    expect(second.tree.children[1]?.attributes).toEqual({ src: 'img/xicara.png', alt: 'Filtrado Sul de Minas' });
    run(store, 'data.setCell', { collection: 'Cardapio', item: 'item-2', field: 'nome', value: 'Filtrado' });
    const after = store.getState().document.pages.find((page) => page.id === second.id);
    expect(after?.file).toBe('filtrado-sul-de-minas.html');
    expect(after?.tree.children[0]?.text).toBe('Filtrado');
    // run again: every item has its page, and nothing is made twice
    run(store, 'pages.switch', { page: 'product' });
    run(store, 'pages.fromCollection', { collection: 'Cardapio', nameField: 'nome' });
    expect(said(store)).toBe('Every item of Cardapio has its page already; they show its items now.');
    expect(store.getState().document.pages).toHaveLength(5);
  });

  it("links a list's cards to their items' pages", () => {
    const store = storeOf('content-menu-list');
    run(store, 'pages.switch', { page: 'product' });
    run(store, 'pages.fromCollection', { collection: 'Cardapio', nameField: 'nome' });
    run(store, 'pages.switch', { page: 'home' });
    // each card's More link goes to its item's page; before the pages existed it went nowhere
    expect(cards(store).map((card) => card.children[3]?.attributes.href)).toEqual(['espresso-grao-norte.html', 'filtrado-sul-de-minas.html', 'descafeinado.html']);
    // a link bound to its item's page keeps its address: typing another is refused
    run(store, 'selection.select', { target: cards(store)[0]?.id });
    expect(run(store, 'data.bindElement', { node: cards(store)[0]?.children[1]?.id, field: '@page', to: 'link' }).status).toBe('refused');
    expect(said(store)).toBe('Title cannot show a value as link.');
  });

  it('opens a duplicated page, whose name field then takes the focus', () => {
    const store = storeOf('content-site');
    run(store, 'pages.duplicate', { page: 'about' });
    const copy = store.getState().document.pages[2];
    expect(copy?.name).toBe('About 2');
    expect(store.getState().ui.page).toBe(copy?.id);
    expect(store.getState().message).toEqual({ key: 'status.pages.duplicated', params: { name: 'About', copy: 'About 2', file: 'about-2.html' } });
  });
});

describe('shared regions', () => {
  it('shares the header with the chosen pages and the pages made later', () => {
    const store = storeOf('content-site');
    run(store, 'selection.select', { target: named(store, 'Header').id });
    run(store, 'regions.share', { pages: ['about.html', 'contact.html', 'new'] });
    expect(said(store)).toBe('Header is shared with 2 pages.');
    const document = store.getState().document;
    expect(document.components?.[0]?.shared).toEqual({ newPages: true, at: 'start' });
    expect(document.pages.map((page) => page.tree.children[0]?.component)).toEqual(['Header', 'Header', 'Header']);
    expect(document.pages[1]?.tree.children[0]?.name).toBe('Header 2');
    expect(store.getState().history.past).toHaveLength(1);
    // a page added later receives it, in the same undo step as the add
    run(store, 'pages.add', { name: 'Blog' });
    const blog = store.getState().document.pages.at(-1);
    expect(blog?.tree.children[0]?.component).toBe('Header');
    run(store, 'history.undo');
    expect(store.getState().document.pages).toHaveLength(3);
  });

  it('refuses an element that is not directly inside its page, and no page chosen', () => {
    const store = storeOf('content-site');
    run(store, 'selection.select', { target: named(store, 'Nav').id });
    expect(run(store, 'regions.share', { pages: ['about.html'] }).status).toBe('refused');
    expect(said(store)).toBe('Nav is not directly inside its page: select the header, footer or menu itself.');
    run(store, 'selection.select', { target: named(store, 'Footer').id });
    expect(run(store, 'regions.share', { pages: [] }).status).toBe('refused');
    expect(said(store)).toBe('Choose at least one page to share Footer with.');
  });

  it('carries an edit of the menu on one page to every page, once, in one undo step', () => {
    const store = storeOf('content-site-shared');
    expect(run(store, 'text.set', { target: named(store, 'About link 3').id, content: 'Sobre' }).status).toBe('done');
    const links = store.getState().document.pages.map((page) => page.tree.children[0]?.children[1]?.children[1]?.text);
    expect(links).toEqual(['Sobre', 'Sobre', 'Sobre']);
    expect(store.getState().document.components?.[0]?.tree.children[1]?.children[1]?.text).toBe('Sobre');
    // each copy keeps its own nodes
    expect(named(store, 'About link 2').text).toBe('Sobre');
    expect(store.getState().history.past).toHaveLength(1);
    run(store, 'history.undo');
    expect(named(store, 'About link').text).toBe('About');
  });

  it('carries an element added to one copy to the others', () => {
    const store = storeOf('content-site-shared');
    run(store, 'element.insert', { entry: 'paragraph', parent: named(store, 'Header 2').id, index: 2 });
    const counts = store.getState().document.pages.map((page) => page.tree.children[0]?.children.length);
    expect(counts).toEqual([3, 3, 3]);
  });

  it('leaves a detached page out of the next edits, and refuses a locked copy that would have to follow', () => {
    const store = storeOf('content-site-shared');
    run(store, 'regions.detach', { node: named(store, 'Header 3').id });
    expect(named(store, 'Header 3').component).toBeUndefined();
    run(store, 'text.set', { target: named(store, 'Brand').id, content: 'Grão Norte Café' });
    expect([named(store, 'Brand').text, named(store, 'Brand 2').text, named(store, 'Brand 3').text]).toEqual(['Grão Norte Café', 'Grão Norte Café', 'Grão Norte']);
    run(store, 'element.toggleLock', { target: named(store, 'Header 2').id });
    expect(run(store, 'text.set', { target: named(store, 'Brand').id, content: 'Outro' }).status).toBe('refused');
    expect(said(store)).toBe('Header is locked on About, so it cannot follow the change. Unlock it there first.');
    expect(named(store, 'Brand').text).toBe('Grão Norte Café');
  });

  it('stops sharing: the copies stay, each its own from then on', () => {
    const store = storeOf('content-site-shared');
    run(store, 'regions.stopSharing', { component: 'Header' });
    run(store, 'text.set', { target: named(store, 'Brand').id, content: 'Só aqui' });
    expect([named(store, 'Brand').text, named(store, 'Brand 2').text]).toEqual(['Só aqui', 'Grão Norte']);
  });
});

// Two refusals a person never meets through the panel, which offers neither choice (Connect fields lists only the
// parts an element can show; Share appears only for an element directly inside a page's root): the commands still
// refuse them, with words, and change nothing (moved here from scenarios no door could run).
describe('content refusals the panel never offers', () => {
  it('refuses a part that has no place for what is asked (a paragraph shows no image)', () => {
    const store = storeOf('content-menu');
    const before = store.getState().document;
    const price = named(store, 'Price');
    expect(run(store, 'data.bindElement', { node: price.id, field: 'foto', to: 'image' }).status).toBe('refused');
    expect(store.getState().message?.key).toBe('status.data.cannotShow');
    expect(store.getState().document).toBe(before);
  });

  it('refuses to share an element that is not directly inside its page (a menu inside the header)', () => {
    const store = storeOf('content-site');
    const nav = named(store, 'Nav');
    run(store, 'selection.select', { target: nav.id });
    const before = store.getState().document;
    expect(run(store, 'regions.share', { pages: ['about.html'] }).status).toBe('refused');
    expect(store.getState().message).toEqual({ key: 'status.regions.notTopLevel', params: { name: 'Nav' } });
    expect(store.getState().document).toBe(before);
  });
});

// Fill from data with the sheet a person brings (jornada03 J1/C4): Carla's cardapio.csv names its columns nome, preco,
// foto, in an order other than the card's fields (image, name, price), and names photos by their file names. The fill
// matches columns by name, then by kind, finds the photos by name, and refuses a photo it cannot find, naming the row,
// the column and the cell, before any patch: never a state the model refuses.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson, ProjectFile } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { anyCss } from '../ports/css.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { fillFromDataCommand, imageSource } from './components.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const base64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const file = (path: string, type: string, text = 'x'): ProjectFile => ({ path, type, bytes: base64(text) });

const CARD_TREE = node('Item', 'div', 'div', { children: [node('Foto', 'image', 'img', { attributes: { src: 'img/graos.png', alt: '' } }), node('Nome', 'heading', 'h3', { text: 'Nome' }), node('Preço', 'paragraph', 'p', { text: 'R$ 0' })] });
const instance = (id: string): DocNode => ({
  ...CARD_TREE,
  id: id as NodeId,
  component: 'Item',
  componentPart: [],
  children: CARD_TREE.children.map((child, index) => ({ ...child, id: `${id}-${String(index)}` as NodeId, componentPart: [index] })),
});

const doc = (csv: string): DocumentJson =>
  ({
    version: 2,
    components: [{ name: 'Item', tree: CARD_TREE }],
    files: [file('img/graos.png', 'image/png'), file('img/xicara.png', 'image/png'), file('img/loja.png', 'image/png'), file('data/cardapio.csv', 'text/csv', csv)],
    pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Grid', 'div', 'div', { children: [instance('Card')] })] }) }],
  }) as DocumentJson;

const context = (document: DocumentJson): HandlerContext<never> =>
  ({
    state: { document, selection: ['Card' as NodeId], history: EMPTY_HISTORY, message: null, ui: undefined as never },
    clock: manualClock(),
    ids: sequentialIds('n'),
    rules: RULES,
    words: (key: string) => key,
    layout: noLayout,
    css: anyCss,
  }) as HandlerContext<never>;

const CARLA = 'nome,preco,foto\nEspresso Grão Norte,R$ 42,graos.png\nFiltrado Sul de Minas,R$ 46,xicara.png\nDescafeinado,R$ 44,loja\n';

describe('Fill from data', () => {
  it("fills Carla's sheet as it is: names, prices and photos found by their file names", () => {
    const document = doc(CARLA);
    const outcome = fillFromDataCommand.run(context(document), { path: 'data/cardapio.csv' });
    expect(outcome.kind).toBe('change');
    const applied = applyPatches(document, outcome.kind === 'change' ? (outcome.patches ?? []) : []).document;
    expect(validateDocument(applied, ['Card' as NodeId], RULES)).toEqual([]);
    const items = applied.pages[0]?.tree.children[0]?.children ?? [];
    expect(items.map((item) => [item.children[0]?.attributes.src, item.children[1]?.text, item.children[2]?.text])).toEqual([
      ['img/graos.png', 'Espresso Grão Norte', 'R$ 42'],
      ['img/xicara.png', 'Filtrado Sul de Minas', 'R$ 46'],
      ['img/loja.png', 'Descafeinado', 'R$ 44'],
    ]);
  });

  it('takes a column named like a field first, whatever its place', () => {
    const document = doc('Preço,Nome,Foto\nR$ 9,Moka,img/loja.png\n');
    const outcome = fillFromDataCommand.run(context(document), { path: 'data/cardapio.csv' });
    const applied = applyPatches(document, outcome.kind === 'change' ? (outcome.patches ?? []) : []).document;
    const item = applied.pages[0]?.tree.children[0]?.children[0];
    expect([item?.children[0]?.attributes.src, item?.children[1]?.text, item?.children[2]?.text]).toEqual(['img/loja.png', 'Moka', 'R$ 9']);
  });

  it('refuses a photo the project does not hold, naming the row, the column and the cell, before any patch', () => {
    const outcome = fillFromDataCommand.run(context(doc('nome,preco,foto\nMoka,R$ 9,graos.png\nCoado,R$ 7,falta.png\n')), { path: 'data/cardapio.csv' });
    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' ? outcome.message : null).toEqual({ key: 'status.data.imageNotFound', params: { row: 2, column: 'foto', value: 'falta.png' } });
  });

  it('reads an image cell as a project path, a file name with or without its extension, or a web address', () => {
    const document = doc(CARLA);
    expect(imageSource(document, 'img/graos.png')).toBe('img/graos.png');
    expect(imageSource(document, 'GRAOS.PNG')).toBe('img/graos.png');
    expect(imageSource(document, 'xicara')).toBe('img/xicara.png');
    expect(imageSource(document, 'https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(imageSource(document, 'Espresso')).toBeNull();
  });
});

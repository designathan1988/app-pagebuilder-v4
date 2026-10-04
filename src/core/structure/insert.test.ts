import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { contentModelFrom } from '../elements/content-model.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { anyCss } from '../ports/css.ts';
import { noLayout } from '../ports/layout.ts';
import { insertCommand, uniqueName } from './insert.ts';
import { deepFreeze } from '../store/store.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const DOC: DocumentJson = {
  version: 2,
  pages: [
    {
      id: 'p',
      name: 'Home',
      file: 'index.html',
      tree: node('Page', 'page', 'body', {
        children: [
          node('Hero', 'section', 'section', { children: [node('Title', 'heading', 'h1', { text: 'Hi' }), node('Actions', 'div', 'div')] }),
          node('Perks', 'list', 'ul', { children: [node('One', 'listItem', 'li')] }),
        ],
      }),
    },
  ],
};

function run(selection: string[], args: { entry: string; parent?: string; index?: number }, locale: 'en' | 'pt-BR' = 'en') {
  const context = {
    state: { document: DOC, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
    clock: manualClock(),
    ids: sequentialIds('new'),
    rules: RULES,
    words: (key: MessageId) => translate(locale, key),
    // inserting measures nothing on the canvas
    layout: noLayout,
    css: anyCss,
  } satisfies HandlerContext<never>;
  return insertCommand.run(context, args as never);
}
const childrenOf = (doc: DocumentJson, id: string): string[] => {
  const find = (n: DocNode): DocNode | undefined => (n.id === id ? n : n.children.map(find).find((x) => x !== undefined));
  return find(doc.pages[0]?.tree as DocNode)?.children.map((c) => c.name) ?? [];
};
const applied = (outcome: ReturnType<typeof run>) => {
  if (outcome.kind !== 'change') throw new Error(`not a change: ${JSON.stringify(outcome)}`);
  return applyPatches(DOC, outcome.patches ?? []).document;
};

// every handler runs on a frozen document, as the store commits it: a change in place throws
deepFreeze(DOC);

describe('element.insert (src/core/structure/insert.ts)', () => {
  it('with nothing selected, appends to the page root and selects the new element, with its default styles', () => {
    const outcome = run([], { entry: 'section' });
    const doc = applied(outcome);
    expect(childrenOf(doc, 'Page')).toEqual(['Hero', 'Perks', 'Section']);
    expect(outcome.kind === 'change' && outcome.selection).toEqual(['new1']);
    const section = doc.pages[0]?.tree.children[2];
    expect(section?.styles).toEqual({ desktop: { base: { 'padding-top': '56px', 'padding-right': '40px', 'padding-bottom': '56px', 'padding-left': '40px' } } });
    expect(outcome.kind === 'change' && outcome.message).toEqual({ key: 'status.placed', params: { element: 'Section', parent: 'Page', position: 3, count: 3 } });
  });

  it('appends into a selected container and puts a new element after a selected leaf, with its default text', () => {
    expect(childrenOf(applied(run(['Actions'], { entry: 'heading' })), 'Actions')).toEqual(['Heading']);
    const doc = applied(run(['Title'], { entry: 'paragraph' }));
    expect(childrenOf(doc, 'Hero')).toEqual(['Title', 'Paragraph', 'Actions']);
    expect(doc.pages[0]?.tree.children[0]?.children[1]?.text).toBe('A freshly created paragraph.');
  });

  it('names the element in the person’s language, numbered when the name is taken', () => {
    expect(childrenOf(applied(run([], { entry: 'heading' }, 'pt-BR')), 'Page')).toEqual(['Hero', 'Perks', 'Título']);
    expect(uniqueName(DOC, 'Title')).toBe('Title 2');
    expect(uniqueName(applyPatches(DOC, [{ op: 'add', path: ['pages', 0, 'tree', 'children', 0], value: node('Title 2', 'div', 'div') }]).document, 'Title')).toBe('Title 3');
  });

  it('places at a given parent and index', () => {
    expect(childrenOf(applied(run([], { entry: 'container', parent: 'Hero', index: 0 })), 'Hero')).toEqual(['Container', 'Title', 'Actions']);
  });

  it('refuses where the parent does not accept the element, and an element that holds no children as the parent', () => {
    expect(run(['Perks'], { entry: 'section' })).toEqual({ kind: 'refused', message: { key: 'status.refused.onlyAccepts', params: { parent: '<ul>', children: '<li>' } } });
    expect(run([], { entry: 'section', parent: 'Title' })).toEqual({ kind: 'refused', message: { key: 'status.refused.noChildren', params: { parent: 'Title' } } });
  });
});

describe('the content model (src/core/elements/content-model.ts)', () => {
  const model = contentModelFrom(manifest.html);
  it('a parent that lists its elements accepts only those; a parent given by categories is not refused here', () => {
    expect(model.refusal('ul', 'li')).toBeNull();
    expect(model.refusal('ul', 'section')).toEqual(['li']);
    expect(model.refusal('tr', 'div')).toEqual(['td', 'th']);
    expect(model.refusal('section', 'div')).toBeNull();
  });

  it('interactive content: links, buttons and form controls, the conditional ones by their attributes', () => {
    const none = new Map<string, string | number | true>();
    for (const tag of ['a', 'button', 'input', 'select', 'textarea', 'label', 'details', 'iframe']) expect(model.isInteractive(tag, none), tag).toBe(true);
    for (const tag of ['div', 'section', 'p', 'img', 'video', 'audio', 'span']) expect(model.isInteractive(tag, none), tag).toBe(false);
    expect(model.isInteractive('input', new Map([['type', 'hidden']]))).toBe(false);
    expect(model.isInteractive('video', new Map<string, string | number | true>([['controls', true]]))).toBe(true);
    expect(model.isInteractive('img', new Map([['usemap', '#m']]))).toBe(true);
    expect(['a', 'button', 'div', 'section', 'label'].filter((tag) => model.excludesInteractive(tag))).toEqual(['a', 'button']);
  });
});

describe('element.insert into a Link Block (spec elements-structure, Problems in Pager 5)', () => {
  // a Link Block holding a container, and a section beside it
  const LINKED: DocumentJson = {
    version: 2,
    pages: [
      {
        id: 'p',
        name: 'Home',
        file: 'index.html',
        tree: node('Page', 'page', 'body', { children: [node('Card', 'linkBlock', 'a', { children: [node('Inside', 'div', 'div')] }), node('Band', 'section', 'section')] }),
      },
    ],
  };
  const insert = (selection: string[], args: { entry: string; parent?: string; index?: number }) =>
    insertCommand.run(
      { state: { document: LINKED, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never }, clock: manualClock(), ids: sequentialIds('new'), rules: RULES, words: (key: MessageId) => translate('en', key), layout: noLayout, css: anyCss },
      args as never,
    );
  const refused = { kind: 'refused', message: { key: 'status.refused.interactiveInside', params: { parent: 'Card' } } };

  it('refuses a Link Block into a Link Block, and into an element inside one, naming the Link Block', () => {
    expect(insert(['Card'], { entry: 'link-block' })).toEqual(refused);
    expect(insert(['Inside'], { entry: 'link-block' })).toEqual(refused);
    expect(insert([], { entry: 'link-block', parent: 'Inside', index: 0 })).toEqual(refused);
  });

  it('takes an element that is not interactive, and a Link Block elsewhere', () => {
    expect(insert(['Card'], { entry: 'container' }).kind).toBe('change');
    expect(insert(['Inside'], { entry: 'paragraph' }).kind).toBe('change');
    expect(insert(['Band'], { entry: 'link-block' }).kind).toBe('change');
  });
});

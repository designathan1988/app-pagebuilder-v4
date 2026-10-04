import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import { allNodes, type DocNode, type DocumentJson } from '../document/model.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { anyCss } from '../ports/css.ts';
import { noLayout } from '../ports/layout.ts';
import { copyName, duplicateCommand } from './duplicate.ts';
import { deepFreeze } from '../store/store.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const DOC: DocumentJson = {
  version: 3,
  pages: [
    {
      id: 'p',
      name: 'Home',
      file: 'index.html',
      tree: node('Page', 'page', 'body', {
        children: [
          node('Hero', 'section', 'section', {
            styles: { desktop: { base: { 'padding-top': '56px' } } },
            children: [node('Title', 'heading', 'h1', { text: 'Hi', classes: ['title'] }), node('Intro', 'paragraph', 'p', { text: 'x' }), node('Intro 2', 'paragraph', 'p', { text: 'y' })],
          }),
          node('Perks', 'list', 'ul', { children: [node('One', 'listItem', 'li')] }),
        ],
      }),
    },
  ],
};

function run(selection: string[], document = DOC) {
  const context = {
    state: { document, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
    clock: manualClock(),
    ids: sequentialIds('new'),
    rules: RULES,
    words: (key: MessageId) => translate('en', key),
    // duplicating measures nothing on the canvas
    layout: noLayout,
    css: anyCss,
  } satisfies HandlerContext<never>;
  return duplicateCommand.run(context, {} as never);
}
const outline = (n: DocNode): string => (n.children.length === 0 ? n.name : `${n.name}(${n.children.map(outline).join(' ')})`);
const after = (selection: string[], document = DOC) => {
  const outcome = run(selection, document);
  if (outcome.kind !== 'change') throw new Error(`not a change: ${JSON.stringify(outcome)}`);
  const applied = applyPatches(document, outcome.patches ?? []);
  return { document: applied.document, tree: outline(applied.document.pages[0]?.tree as DocNode), selection: outcome.selection, message: outcome.message, restored: applyPatches(applied.document, applied.inverses).document };
};

// every handler runs on a frozen document, as the store commits it: a change in place throws
deepFreeze(DOC);

describe('copyName', () => {
  it('adds the first free number from 2, or counts on from a number the name ends in', () => {
    expect(copyName('CardA', new Set(['CardA']))).toBe('CardA 2');
    expect(copyName('CardA', new Set(['CardA', 'CardA 2', 'CardA 3']))).toBe('CardA 4');
    expect(copyName('Intro 2', new Set(['Intro', 'Intro 2']))).toBe('Intro 3');
    expect(copyName('Step 9', new Set(['Step 9', 'Step 10']))).toBe('Step 11');
    expect(copyName('Big Title', new Set(['Big Title']))).toBe('Big Title 2');
  });
});

describe('element.duplicate (src/core/structure/duplicate.ts)', () => {
  it('copies the subtree right after its original, every node with a fresh id and a new unique name, and selects the copy', () => {
    const result = after(['Hero']);
    expect(result.tree).toBe('Page(Hero(Title Intro Intro 2) Hero 2(Title 2 Intro 3 Intro 4) Perks(One))');
    expect(result.selection).toEqual(['new1']);
    expect(result.message).toEqual({ key: 'status.duplicated', params: { name: 'Hero', copy: 'Hero 2' } });
    const copy = result.document.pages[0]?.tree.children[1] as DocNode;
    // texts, classes and styles copied exactly
    expect(copy.styles).toEqual({ desktop: { base: { 'padding-top': '56px' } } });
    expect(copy.children[0]).toMatchObject({ id: 'new2', text: 'Hi', classes: ['title'], tag: 'h1', type: 'heading' });
    const ids = [...allNodes(result.document)].map((n) => n.id);
    const names = [...allNodes(result.document)].map((n) => n.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(result.restored).toEqual(DOC);
  });

  it('copies every root of the selection, each after its original, the primary copy selected first', () => {
    // Perks is the primary; Intro inside Hero is a second root; One sits inside Perks, so it goes with Perks
    const result = after(['Perks', 'Intro', 'One']);
    expect(result.tree).toBe('Page(Hero(Title Intro Intro 3 Intro 2) Perks(One) Perks 2(One 2))');
    expect(result.message).toEqual({ key: 'status.duplicatedMany', params: { count: 2 } });
    const hero = result.document.pages[0]?.tree.children[0] as DocNode;
    const perksCopy = result.document.pages[0]?.tree.children[2] as DocNode;
    expect(result.selection).toEqual([perksCopy.id, hero.children[2]?.id]);
    expect(result.restored).toEqual(DOC);
  });

  it('regenerates HTML ids and redirects internal references and interaction targets', () => {
    const group = node('Group', 'container', 'div', { attributes: { id: 'group' }, children: [
      node('Control', 'input', 'input', { attributes: { id: 'control' } }),
      node('Label', 'label', 'label', { attributes: { labelFor: 'Control' } }),
      node('Anchor', 'link', 'a', { attributes: { href: '#Control' } }),
      node('Raw anchor', 'link', 'a', { attributes: { href: '#control' } }),
      node('Trigger', 'button', 'button', { interactions: [{ trigger: 'click', action: 'show', target: 'Control' as NodeId }] }),
    ] });
    const document: DocumentJson = { version: 3, pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [group] }) }] };
    const result = after(['Group'], document);
    const copy = result.document.pages[0]?.tree.children[1];
    expect(copy?.attributes.id).toBe('group-copy');
    expect(copy?.children[0]?.attributes.id).toBe('control-copy');
    expect(copy?.children[1]?.attributes.labelFor).toBe(copy?.children[0]?.id);
    expect(copy?.children[2]?.attributes.href).toBe(`#${copy?.children[0]?.id}`);
    expect(copy?.children[3]?.attributes.href).toBe('#control-copy');
    expect(copy?.children[4]?.interactions?.[0]?.target).toBe(copy?.children[0]?.id);
    const htmlIds = [...allNodes(result.document)].map((n) => n.attributes.id).filter((id) => id !== undefined);
    expect(new Set(htmlIds).size).toBe(htmlIds.length);
    expect(result.restored).toEqual(document);
  });

  it('refuses the page root and changes nothing', () => {
    expect(run(['Page'])).toEqual({ kind: 'refused', message: { key: 'status.duplicate.root', params: {} } });
    expect(run(['Page', 'Intro'])).toEqual({ kind: 'refused', message: { key: 'status.duplicate.root', params: {} } });
  });
});

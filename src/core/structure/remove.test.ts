import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext, Message } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { EMPTY_HISTORY, type HistoryState } from '../history/history.ts';
import { applyPatches, type Transaction } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { anyCss } from '../ports/css.ts';
import { noLayout } from '../ports/layout.ts';
import { deleteCommand, followsDelete } from './remove.ts';
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
          node('Hero', 'section', 'section', { children: [node('Title', 'heading', 'h1', { text: 'Hi' }), node('Intro', 'paragraph', 'p', { text: 'x' }), node('Actions', 'div', 'div')] }),
          node('Perks', 'list', 'ul', { children: [node('One', 'listItem', 'li')] }),
        ],
      }),
    },
  ],
};

function run(selection: string[]) {
  const context = {
    state: { document: DOC, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
    clock: manualClock(),
    ids: sequentialIds('new'),
    rules: RULES,
    words: (key: MessageId) => translate('en', key),
    // deleting measures nothing on the canvas
    layout: noLayout,
    css: anyCss,
  } satisfies HandlerContext<never>;
  return deleteCommand.run(context, {} as never);
}
const outline = (n: DocNode): string => (n.children.length === 0 ? n.name : `${n.name}(${n.children.map(outline).join(' ')})`);
const after = (selection: string[]) => {
  const outcome = run(selection);
  if (outcome.kind !== 'change') throw new Error(`not a change: ${JSON.stringify(outcome)}`);
  const applied = applyPatches(DOC, outcome.patches ?? []);
  return { tree: outline(applied.document.pages[0]?.tree as DocNode), selection: outcome.selection, message: outcome.message, restored: applyPatches(applied.document, applied.inverses).document };
};

// every handler runs on a frozen document, as the store commits it: a change in place throws
deepFreeze(DOC);

describe('element.delete (src/core/structure/remove.ts)', () => {
  it('removes the node with its subtree and selects the next sibling, else the previous one, else the parent', () => {
    expect(after(['Intro'])).toMatchObject({ tree: 'Page(Hero(Title Actions) Perks(One))', selection: ['Actions'], message: { key: 'status.deleted', params: { name: 'Intro' } } });
    expect(after(['Actions'])).toMatchObject({ tree: 'Page(Hero(Title Intro) Perks(One))', selection: ['Intro'] });
    expect(after(['One'])).toMatchObject({ tree: 'Page(Hero(Title Intro Actions) Perks)', selection: ['Perks'] });
    expect(after(['Hero'])).toMatchObject({ tree: 'Page(Perks(One))', selection: ['Perks'] });
  });

  it('removes every root of a multi-selection in one outcome, skipping the nodes inside another selected node, and its inverses restore the ids and indexes', () => {
    const result = after(['Title', 'One', 'Perks', 'Actions']);
    expect(result).toMatchObject({ tree: 'Page(Hero(Intro))', selection: ['Intro'], message: { key: 'status.deletedMany', params: { count: 3 } } });
    expect(result.restored).toEqual(DOC);
    // the primary inside another selected node: the selection moves from that root
    expect(after(['One', 'Perks'])).toMatchObject({ tree: 'Page(Hero(Title Intro Actions))', selection: ['Hero'], message: { key: 'status.deleted', params: { name: 'Perks' } } });
  });

  it('refuses the page root, alone or in a selection, and changes nothing', () => {
    expect(run(['Page'])).toEqual({ kind: 'refused', message: { key: 'status.delete.root', params: {} } });
    expect(run(['Intro', 'Page'])).toEqual({ kind: 'refused', message: { key: 'status.delete.root', params: {} } });
  });

  it('follows a delete while the last undo step is a delete and the last message is its own', () => {
    const tx = (command: Transaction['command']): Transaction => ({ command, patches: [], inverses: [], selectionBefore: [], selectionAfter: [], at: 0, coalesceKey: null, message: null });
    const state = (history: HistoryState, message: Message | null) => ({ document: DOC, selection: [], history, message, ui: null });
    const deleted: Message = { key: 'status.deleted', params: { name: 'Intro' } };
    expect(followsDelete(state({ past: [tx('element.delete')], future: [] }, deleted))).toBe(true);
    expect(followsDelete(state({ past: [tx('element.delete')], future: [] }, { key: 'status.deletedMany', params: { count: 2 } }))).toBe(true);
    expect(followsDelete(state({ past: [tx('element.delete')], future: [] }, { key: 'status.selected', params: { name: 'Title' } }))).toBe(false);
    expect(followsDelete(state({ past: [tx('element.delete'), tx('element.insert')], future: [] }, deleted))).toBe(false);
    expect(followsDelete(state(EMPTY_HISTORY, deleted))).toBe(false);
  });
});

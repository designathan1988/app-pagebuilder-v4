import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches, deepEqual } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { anyCss } from '../ports/css.ts';
import { noLayout } from '../ports/layout.ts';
import { moveDownCommand, moveToCommand, moveUpCommand } from './move.ts';
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
          node('Hero', 'section', 'section', { children: [node('Title', 'heading', 'h1', { text: 'Hi' }), node('Intro', 'paragraph', 'p', { text: 'x' }), node('Actions', 'div', 'div'), node('Note', 'paragraph', 'p', { text: 'y' })] }),
          node('Perks', 'list', 'ul', { children: [node('One', 'listItem', 'li')] }),
        ],
      }),
    },
  ],
};

const contextOf = (selection: string[]) =>
  ({
    state: { document: DOC, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
    clock: manualClock(),
    ids: sequentialIds('new'),
    rules: RULES,
    words: (key: MessageId) => translate('en', key),
    // moving measures nothing on the canvas
    layout: noLayout,
    css: anyCss,
  }) satisfies HandlerContext<never>;

function run(direction: 'up' | 'down', selection: string[]) {
  const context = contextOf(selection);
  return direction === 'up' ? moveUpCommand.run(context, {} as never) : moveDownCommand.run(context, {} as never);
}
function moveTo(selection: string[], parent: string, index: number) {
  return moveToCommand.run(contextOf(selection), { parent: parent as NodeId, index });
}
const childrenOf = (doc: DocumentJson, id: string): string[] => {
  const find = (n: DocNode): DocNode | undefined => (n.id === id ? n : n.children.map(find).find((x) => x !== undefined));
  // ids, not names: a move keeps the moved node itself, never a copy with a new id (here each id is the node's name)
  return find(doc.pages[0]?.tree as DocNode)?.children.map((c) => c.id) ?? [];
};
const applied = (outcome: ReturnType<typeof moveTo>) => {
  if (outcome.kind !== 'change') throw new Error(`not a change: ${JSON.stringify(outcome)}`);
  return applyPatches(DOC, outcome.patches ?? []).document;
};

// every handler runs on a frozen document, as the store commits it: a change in place throws
deepFreeze(DOC);

describe('element.moveTo (src/core/structure/move.ts)', () => {
  it('moves the selected node before a sibling, the index counting the siblings without it, and keeps it selected', () => {
    const outcome = moveTo(['Intro'], 'Hero', 0);
    expect(childrenOf(applied(outcome), 'Hero')).toEqual(['Intro', 'Title', 'Actions', 'Note']);
    expect(outcome.kind === 'change' && outcome.selection).toEqual(['Intro']);
    expect(outcome.kind === 'change' && outcome.message).toEqual({ key: 'status.moved', params: { name: 'Intro', position: 1, count: 4, parent: 'Hero' } });
  });

  it('changes nothing and says nothing when every node lands where it already stands (a drop on its own place)', () => {
    // Intro stands second in Hero: moved to index 1 of the siblings without it, it is where it was
    const outcome = moveTo(['Intro'], 'Hero', 1);
    expect(outcome).toEqual({ kind: 'change', selection: ['Intro'] });
  });

  it('moves after the last sibling', () => {
    const outcome = moveTo(['Title'], 'Hero', 3);
    expect(childrenOf(applied(outcome), 'Hero')).toEqual(['Intro', 'Actions', 'Note', 'Title']);
    expect(outcome.kind === 'change' && outcome.message).toEqual({ key: 'status.moved', params: { name: 'Title', position: 4, count: 4, parent: 'Hero' } });
  });

  it('moves into another parent, and several roots in document order', () => {
    const into = moveTo(['Title'], 'Actions', 0);
    expect(childrenOf(applied(into), 'Actions')).toEqual(['Title']);
    expect(into.kind === 'change' && into.message).toEqual({ key: 'status.movedInto', params: { name: 'Title', receiver: 'Actions', position: 1, count: 1 } });
    const doc = applied(moveTo(['Actions', 'Title'], 'Page', 1));
    expect(childrenOf(doc, 'Page')).toEqual(['Hero', 'Title', 'Actions', 'Perks']);
    expect(childrenOf(doc, 'Hero')).toEqual(['Intro', 'Note']);
  });

  it('a move out to an ancestor is a move to a position there, not into it (the hand climbs, a drag goes a level out)', () => {
    const out = moveTo(['Title'], 'Page', 1);
    expect(childrenOf(applied(out), 'Page')).toEqual(['Hero', 'Title', 'Perks']);
    expect(out.kind === 'change' && out.message).toEqual({ key: 'status.moved', params: { name: 'Title', position: 2, count: 3, parent: 'Page' } });
  });

  it('a move to where the node already is changes nothing', () => {
    expect(deepEqual(applied(moveTo(['Intro'], 'Hero', 1)), DOC)).toBe(true);
  });

  it('refuses a leaf parent, a parent inside the moved node and one the content model refuses', () => {
    expect(moveTo(['Intro'], 'Title', 0)).toEqual({ kind: 'refused', message: { key: 'status.refused.noChildren', params: { parent: 'Title' } } });
    expect(moveTo(['Hero'], 'Actions', 0)).toEqual({ kind: 'refused', message: { key: 'status.refused.intoItself', params: {} } });
    // a leaf into itself is refused as into itself, not as a leaf
    expect(moveTo(['Intro'], 'Intro', 0)).toEqual({ kind: 'refused', message: { key: 'status.refused.intoItself', params: {} } });
    expect(moveTo(['Intro'], 'Perks', 0)).toMatchObject({ kind: 'refused', message: { key: 'status.refused.onlyAccepts' } });
  });
});

// by ids (here each id is the node's name): a move keeps the nodes themselves
const outline = (n: DocNode): string => (n.children.length === 0 ? n.id : `${n.id}(${n.children.map(outline).join(' ')})`);
const after = (direction: 'up' | 'down', selection: string[]) => {
  const outcome = run(direction, selection);
  if (outcome.kind !== 'change') throw new Error(`not a change: ${JSON.stringify(outcome)}`);
  const applied = applyPatches(DOC, outcome.patches ?? []);
  return { tree: outline(applied.document.pages[0]?.tree as DocNode), selection: outcome.selection, message: outcome.message, restored: applyPatches(applied.document, applied.inverses).document };
};

describe('element.moveUp and element.moveDown (src/core/structure/move.ts)', () => {
  it('swaps one node with its previous or next sibling, keeps the selection and names its new position', () => {
    expect(after('up', ['Actions'])).toMatchObject({ tree: 'Page(Hero(Title Actions Intro Note) Perks(One))', selection: undefined, message: { key: 'status.moved', params: { name: 'Actions', position: 2, count: 4, parent: 'Hero' } } });
    expect(after('down', ['Title'])).toMatchObject({ tree: 'Page(Hero(Intro Title Actions Note) Perks(One))', message: { key: 'status.moved', params: { name: 'Title', position: 2, count: 4, parent: 'Hero' } } });
    expect(after('down', ['Hero'])).toMatchObject({ tree: 'Page(Perks(One) Hero(Title Intro Actions Note))', message: { key: 'status.moved', params: { name: 'Hero', position: 2, count: 2, parent: 'Page' } } });
    expect(after('up', ['Actions']).restored).toEqual(DOC);
  });

  it('moves several roots of one parent together, keeping their order, and a block at the edge stays', () => {
    // Intro and Actions pass Title together
    expect(after('up', ['Actions', 'Intro'])).toMatchObject({ tree: 'Page(Hero(Intro Actions Title Note) Perks(One))', message: { key: 'status.movedMany', params: { count: 2, parent: 'Hero' } } });
    // Title stays at the start, Actions passes Intro
    expect(after('up', ['Title', 'Actions'])).toMatchObject({ tree: 'Page(Hero(Title Actions Intro Note) Perks(One))', message: { key: 'status.movedMany', params: { count: 2, parent: 'Hero' } } });
    // Note stays at the end, Intro passes Actions
    const down = after('down', ['Intro', 'Note']);
    expect(down).toMatchObject({ tree: 'Page(Hero(Title Actions Intro Note) Perks(One))' });
    expect(down.restored).toEqual(DOC);
    // a node inside another selected node goes with it
    expect(after('up', ['Perks', 'One'])).toMatchObject({ tree: 'Page(Perks(One) Hero(Title Intro Actions Note))', message: { key: 'status.moved', params: { name: 'Perks' } } });
  });

  it('refuses a press that moves nothing, at either edge and for the page root, naming the parent', () => {
    expect(run('up', ['Title'])).toEqual({ kind: 'refused', message: { key: 'status.move.alreadyFirst', params: { parent: 'Hero' } } });
    expect(run('down', ['Note'])).toEqual({ kind: 'refused', message: { key: 'status.move.alreadyLast', params: { parent: 'Hero' } } });
    expect(run('up', ['Title', 'Intro'])).toEqual({ kind: 'refused', message: { key: 'status.move.alreadyFirst', params: { parent: 'Hero' } } });
    expect(run('down', ['One'])).toEqual({ kind: 'refused', message: { key: 'status.move.alreadyLast', params: { parent: 'Perks' } } });
    expect(run('up', ['Page'])).toEqual({ kind: 'refused', message: { key: 'status.move.alreadyFirst', params: { parent: 'Home' } } });
  });

  it('refuses roots that do not share one parent', () => {
    expect(run('up', ['Intro', 'One'])).toEqual({ kind: 'refused', message: { key: 'status.wrap.needsSameParent', params: {} } });
    expect(run('down', ['Perks', 'Title'])).toEqual({ kind: 'refused', message: { key: 'status.wrap.needsSameParent', params: {} } });
  });
});

describe('element.moveTo into a Link Block (spec elements-structure, Problems in Pager 5)', () => {
  // a Link Block holding a container; beside it another Link Block, and a section holding a Link Block
  const LINKED: DocumentJson = {
    version: 2,
    pages: [
      {
        id: 'p',
        name: 'Home',
        file: 'index.html',
        tree: node('Page', 'page', 'body', {
          children: [
            node('Card', 'linkBlock', 'a', { children: [node('Inside', 'div', 'div')] }),
            node('Other', 'linkBlock', 'a'),
            node('Band', 'section', 'section', { children: [node('Nested', 'linkBlock', 'a')] }),
            node('Plain', 'div', 'div'),
          ],
        }),
      },
    ],
  };
  const move = (selection: string[], parent: string, index: number) =>
    moveToCommand.run({ ...contextOf(selection), state: { ...contextOf(selection).state, document: LINKED } }, { parent: parent as NodeId, index });
  const refused = { kind: 'refused', message: { key: 'status.refused.interactiveInside', params: { parent: 'Card' } } };

  it('refuses a Link Block moved into a Link Block or into an element inside one, and a node holding one', () => {
    expect(move(['Other'], 'Card', 0)).toEqual(refused);
    expect(move(['Other'], 'Inside', 0)).toEqual(refused);
    expect(move(['Band'], 'Card', 1)).toEqual(refused);
  });

  it('moves an element that holds nothing interactive into it', () => {
    expect(move(['Plain'], 'Card', 1).kind).toBe('change');
    expect(move(['Other'], 'Band', 0).kind).toBe('change');
  });
});

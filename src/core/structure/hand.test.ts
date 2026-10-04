import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext, Outcome } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { anyCss } from '../ports/css.ts';
import { noLayout } from '../ports/layout.ts';
import type { StoreState } from '../store/store.ts';
import { aimArgs, handCommands, heldHand, slotsFor, type WithHand } from './hand.ts';
import { deepFreeze } from '../store/store.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
// Page > [Hero > [Title, Intro, Actions], Perks (ul) > [One (li)]]
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

const HAND = handCommands<WithHand>();
type State = StoreState<WithHand>;
const initial = (selection: string[]): State => ({ document: DOC, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: { hand: null } });
// every state a handler reads is frozen, as the store commits it: a change in place throws
const contextOf = (state: State) =>
  ({ state: deepFreeze(state), clock: manualClock(), ids: sequentialIds('new'), rules: RULES, words: (key: MessageId) => translate('en', key), layout: noLayout, css: anyCss }) satisfies HandlerContext<WithHand>;

// the state after an outcome: its editor state and message
function after(state: State, outcome: Outcome<WithHand>): State {
  if (outcome.kind !== 'change') throw new Error(`not a change: ${JSON.stringify(outcome)}`);
  return { ...state, ui: outcome.ui ?? state.ui, message: outcome.message ?? state.message };
}
const said = (state: State) => (state.message === null ? null : translate('en', state.message.key, state.message.params as Record<string, string | number>));
type Key = 'aimNext' | 'aimPrevious' | 'climb' | 'descend' | 'drop';
function press(state: State, ...keys: Key[]): State {
  return keys.reduce((s, key) => after(s, HAND[key].run(contextOf(s), {} as never)), state);
}
const taken = (id: string) => after(initial([id]), HAND.take.run(contextOf(initial([id])), {} as never));
// the document with one node hidden (element.toggleHidden's flag)
const hide = (n: DocNode, id: string): DocNode => (n.id === id ? { ...n, hidden: true } : { ...n, children: n.children.map((c) => hide(c, id)) });
const hiddenIn = (id: string): DocumentJson => ({ ...DOC, pages: DOC.pages.map((p) => ({ ...p, tree: hide(p.tree, id) })) });

// every handler runs on a frozen document, as the store commits it: a change in place throws
deepFreeze(DOC);

describe('the hand (spec hand-keyboard-move)', () => {
  it('lists the slots in reading order, without the held element and its subtree', () => {
    expect(slotsFor(DOC, RULES, 'Title' as NodeId)).toEqual([
      { parent: 'Page', index: 0 },
      { parent: 'Hero', index: 0 },
      { parent: 'Hero', index: 1 },
      { parent: 'Actions', index: 0 },
      { parent: 'Hero', index: 2 },
      { parent: 'Page', index: 1 },
      { parent: 'Perks', index: 0 },
      { parent: 'One', index: 0 },
      { parent: 'Perks', index: 1 },
      { parent: 'Page', index: 2 },
    ]);
    expect(slotsFor(DOC, RULES, 'Hero' as NodeId).some((s) => ['Hero', 'Actions'].includes(s.parent))).toBe(false);
  });

  it('M takes the one selected element, aimed at its own place; the page root is refused', () => {
    const s = taken('Intro');
    expect(heldHand(s)).toMatchObject({ held: 'Intro', aim: { parent: 'Hero', index: 1 }, below: [], refusal: null });
    expect(said(s)).toBe('Holding Intro. Arrows aim, Enter places, Esc drops.');
    const root = HAND.take.run(contextOf(initial(['Page'])), {} as never);
    expect(root).toEqual({ kind: 'refused', message: { key: 'status.hand.root', params: {} } });
  });

  it('a hidden element is refused and named; nothing is held', () => {
    const state: State = { ...initial(['Intro']), document: hiddenIn('Intro') };
    expect(HAND.take.run(contextOf(state), {} as never)).toEqual({ kind: 'refused', message: { key: 'status.hand.hidden', params: { name: 'Intro' } } });
  });

  it("Enter's arguments are the aim: element.moveTo's parent and index; a key whose command takes neither gets none", () => {
    const hand = heldHand(press(taken('Title'), 'aimNext'));
    if (hand === null) throw new Error('nothing is held');
    expect(aimArgs(hand, ['parent', 'index'])).toEqual({ parent: 'Hero', index: 1 });
    expect(aimArgs(hand, [])).toEqual({});
  });

  it('aims at the next and the previous slot, stopping at the ends, and says where', () => {
    const s = press(taken('Title'), 'aimNext');
    expect(heldHand(s)?.aim).toEqual({ parent: 'Hero', index: 1 });
    expect(said(s)).toBe('Hero will receive. Position 2 of 3. Level 1 of 2.');
    expect(heldHand(press(s, 'aimPrevious', 'aimPrevious', 'aimPrevious', 'aimPrevious'))?.aim).toEqual({ parent: 'Page', index: 0 });
    expect(heldHand(press(s, ...Array<Key>(12).fill('aimNext')))?.aim).toEqual({ parent: 'Page', index: 2 });
  });

  it('climbs to right after the receiver in its parent and descends the same ladder back', () => {
    const climbed = press(taken('Title'), 'aimNext', 'climb');
    expect(heldHand(climbed)?.aim).toEqual({ parent: 'Page', index: 1 });
    expect(said(climbed)).toBe('Page will receive. Position 2 of 3. Level 2 of 2.');
    // the page root has no level above it
    expect(heldHand(press(climbed, 'climb'))?.aim).toEqual({ parent: 'Page', index: 1 });
    const back = press(climbed, 'descend');
    expect(heldHand(back)?.aim).toEqual({ parent: 'Hero', index: 1 });
    expect(said(back)).toBe('Hero will receive. Position 2 of 3. Level 1 of 2.');
    // with no climb left there is no level below
    expect(heldHand(press(back, 'descend'))?.aim).toEqual({ parent: 'Hero', index: 1 });
  });

  it('announces a slot element.moveTo refuses, and keeps it as the aim', () => {
    // Title (h1) inside Perks (ul): the list accepts only its items
    const s = press(taken('Title'), ...Array<Key>(5).fill('aimNext'));
    expect(heldHand(s)?.aim).toEqual({ parent: 'Perks', index: 0 });
    expect(heldHand(s)?.refusal?.key).toBe('status.refused.onlyAccepts');
    expect(said(s)).toBe('Refused. <ul> only accepts <li>.');
  });

  it('Escape drops the hand; a new document or selection ends it', () => {
    const s = press(taken('Title'), 'aimNext');
    const dropped = press(s, 'drop');
    expect(heldHand(dropped)).toBeNull();
    expect(said(dropped)).toBe('Dropped. Nothing changed.');
    expect(heldHand({ ...s, document: { ...DOC } })).toBeNull();
    expect(heldHand({ ...s, selection: ['Intro' as NodeId] })).toBeNull();
    // an aim key with nothing held changes nothing
    expect(HAND.aimNext.run(contextOf(initial(['Title'])), {} as never)).toEqual({ kind: 'change' });
  });
});

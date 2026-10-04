// Family IN1 of the code audit (2026-10-04, second reading): element.wrapBeside moved the dragged elements into a new
// wrapper beside the target without asking whether a part of an instance left its instance, which element.moveTo asks
// (instanceMoveRefusal): the side drop of a part beside an element outside the instance made a document the validator
// refused after the patches.
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { wrapBesideCommand } from './wrap.ts';

const doc = () =>
  documentOf({
    components: [{ name: 'Card', tree: node('Def', 'div', 'div', { children: [node('DefTitle', 'heading', 'h2', { text: 'Card' })] }) }] as never,
    pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [
      node('Card1', 'div', 'div', { component: 'Card', componentPart: [], children: [node('Title', 'heading', 'h2', { text: 'Card', componentPart: [0] })] } as never),
      node('Outside', 'paragraph', 'p', { text: 'Out' }),
    ] }) }],
  });

describe('a side drop keeps a part in its instance (IN1)', () => {
  it('refuses to wrap a part of an instance beside an element outside it, before any patch', () => {
    const ran = runHandler(wrapBesideCommand, doc(), { target: 'Outside', side: 'after', wrapper: 'row' }, { selection: ['Title'] });
    expect(ran.outcome.kind).toBe('refused');
  });
});

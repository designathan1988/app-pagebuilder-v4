// Family EV1 of the code audit (2026-10-04, second reading): the interactions script bound every interaction to the
// element that holds it and never read its "Applies to" (scope: every element with that class); the instances of a
// component, which share one generated class, each pushed the same binding, so a click ran the action once per
// instance; and an action on the element itself looked up the first element with the class, never the one clicked.
import { describe, expect, it } from 'vitest';
import type { DocNode, DocumentJson, NodeId } from '../document/model.ts';
import { interactionsJs } from './script.ts';

const node = (id: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: 'button' as DocNode['type'], name: id, tag: 'button', attributes: {}, classes: [], styles: {}, text: 'Go', children: [], ...fields });
const doc = (children: DocNode[]): DocumentJson => ({ version: 4, pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: { ...node('root'), type: 'page' as DocNode['type'], tag: 'body', children } }] });

describe('the interactions script binds what the interaction says, once (EV1)', () => {
  it('binds an interaction that applies to a class to every element with that class', () => {
    const script = interactionsJs(doc([node('b', { classes: ['btn'], interactions: [{ trigger: 'click', action: 'toggle-class', className: 'on', scope: 'btn' }] })]), () => '.own') ?? '';
    expect(script).toContain("each('.btn'");
  });
  it('binds instances that share a class once, each acting on the element clicked', () => {
    const toggle = { interactions: [{ trigger: 'click', action: 'toggle-class', className: 'open' }] } as Partial<DocNode>;
    const script = interactionsJs(doc([node('a', toggle), node('b', toggle)]), () => '.card__button') ?? '';
    expect(script.match(/each\('\.card__button'/g)).toHaveLength(1);
    expect(script).toContain('var target = el;');
  });
});

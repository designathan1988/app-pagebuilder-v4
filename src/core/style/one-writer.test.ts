// Family OW1 of the code audit (2026-10-04, second reading): the code pane's CSS rule (style.applyCssRule), the custom
// declarations (style.setCustomDeclarations) and Position back in the flow (position.setMode) wrote an element's styles
// with patches of their own, beside the one writer of declarations (set.ts writeDeclarations through styleHolders): an
// emptied rule left an empty layer, and an element of an instance was written alone, its component and the other
// instances left as they were.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { locate } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { applyCssRuleCommand } from './css-rule.ts';
import { setCustomDeclarationsCommand } from './custom.ts';

const red = { desktop: { base: { color: '#ff0000' } } } as never;
const doc = () => documentOf({ pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Box', 'div', 'div', { styles: red })] }) }] });
const twoInstances = () =>
  documentOf({
    components: [{ name: 'Card', tree: node('Def', 'div', 'div', { children: [node('DefTitle', 'heading', 'h2', { text: 'Card', styles: red })] }) }] as never,
    pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [
      node('Card1', 'div', 'div', { component: 'Card', componentPart: [], children: [node('T1', 'heading', 'h2', { text: 'Card', styles: red, componentPart: [0] })] } as never),
      node('Card2', 'div', 'div', { component: 'Card', componentPart: [], children: [node('T2', 'heading', 'h2', { text: 'Card', styles: red, componentPart: [0] })] } as never),
    ] }) }],
  });

describe('every style write goes through the one writer of declarations (OW1)', () => {
  it('an emptied rule leaves no empty layer', () => {
    expect(locate(runHandler(applyCssRuleCommand, doc(), { css: '' }, { selection: ['Box'] }).document, 'Box' as NodeId)?.node.styles).toEqual({});
    expect(locate(runHandler(setCustomDeclarationsCommand, doc(), { declarations: '' }, { selection: ['Box'] }).document, 'Box' as NodeId)?.node.styles).toEqual({});
  });
  it('a rule written on an element of an instance reaches the other instance', () => {
    const ran = runHandler(applyCssRuleCommand, twoInstances(), { css: 'color: #0000ff;' }, { selection: ['T1'] });
    expect(ran.problems).toEqual([]);
    expect(locate(ran.document, 'T2' as NodeId)?.node.styles.desktop?.base?.color).toBe('#0000ff');
  });
});

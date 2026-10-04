// Family LU1 of the code audit (2026-10-04, second reading): a write to several elements computed every element's
// patches from the document before the write. With a parent and its child both selected, Position absolute made the
// child's static parent relative (the coupling absolute-makes-static-parent-relative), and that patch replaced the
// parent's styles from the document before, so the parent's own absolute was lost.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { locate } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { setStyleCommand } from './set.ts';

const staticStyle = { desktop: { base: { position: 'static' } } } as never;
const doc = () =>
  documentOf({
    pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { styles: staticStyle, children: [node('Outer', 'div', 'div', { styles: staticStyle, children: [node('Inner', 'div', 'div', { styles: staticStyle })] })] }) }],
  });

describe('one write to several elements keeps every element\'s own value (LU1)', () => {
  it('a parent and its child both made absolute stay absolute', () => {
    const ran = runHandler(setStyleCommand, doc(), { property: 'position', value: 'absolute' }, { selection: ['Outer', 'Inner'] });
    expect(ran.problems).toEqual([]);
    expect(locate(ran.document, 'Outer' as NodeId)?.node.styles.desktop?.base?.position).toBe('absolute');
    expect(locate(ran.document, 'Inner' as NodeId)?.node.styles.desktop?.base?.position).toBe('absolute');
  });
});

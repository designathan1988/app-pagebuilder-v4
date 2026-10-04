// Family RF2 of the code audit (2026-10-04, second reading): a removal that does not let go of what pointed at what
// left. Inserting into a grid replaced its first untouched cell (a remove and an add at its place) without releasing
// the references to the cell: a link to it (or a motion action picking it) named nothing, and the validator refused the
// change after its patches. Shared regions dropped places of other instances the same way (data/regions.ts conform).
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { locate } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { insertCommand } from './insert.ts';

const grid = { desktop: { base: { display: 'grid', 'grid-template-columns': '1fr 1fr' } } } as never;
const doc = () =>
  documentOf({
    pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [
      node('Grid', 'div', 'div', { styles: grid, children: [node('Cell', 'div', 'div'), node('Other', 'div', 'div', { classes: ['kept'] })] }),
      node('Go', 'link', 'a', { text: 'Go', attributes: { href: '#Cell' } as never }),
    ] }) }],
  });

describe('a cell an insert takes lets go of what pointed at it (RF2)', () => {
  it('releases the link to the replaced cell in the same change', () => {
    const ran = runHandler(insertCommand, doc(), { entry: 'paragraph' }, { selection: ['Grid'] });
    expect(ran.outcome.kind).toBe('change');
    expect(ran.problems).toEqual([]);
    expect(locate(ran.document, 'Go' as NodeId)?.node.attributes.href).toBeUndefined();
  });
});

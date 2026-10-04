// Family FD1 of the code audit (2026-10-04): what was typed in a field is kept for the elements it was typed for, even
// when the press that left the field selected another element. style.set took the field's targets; the commands of the
// border, the radius, an image, a shadow, a filter and a transform did not, and the field dropped the typing.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { locate } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { setBorderCommand, setRadiusCommand } from './border.ts';

const two = () => documentOf({ pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Typed', 'div', 'div'), node('Pressed', 'div', 'div')] }) }] });
const stylesOf = (document: ReturnType<typeof two>, id: string) => locate(document, id as NodeId)?.node.styles;

describe('a field keeps its typing for the elements it was typed for (FD1)', () => {
  it('a border and a radius go to their targets, never to what the press selected', () => {
    const border = runHandler(setBorderCommand, two(), { sides: 'all', width: '2px', style: 'solid', color: 'red', targets: ['Typed'] }, { selection: ['Pressed'] });
    expect(stylesOf(border.document, 'Pressed')).toEqual({});
    expect(stylesOf(border.document, 'Typed')).not.toEqual({});
    const radius = runHandler(setRadiusCommand, two(), { corners: 'all', value: '8px', targets: ['Typed'] }, { selection: ['Pressed'] });
    expect(stylesOf(radius.document, 'Pressed')).toEqual({});
  });
});

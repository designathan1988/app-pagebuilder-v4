// Family L10N1 of the code audit (2026-10-04): a number field takes the decimal separator its person types. In pt-BR
// (which ships) the numpad's decimal key of an ABNT2 keyboard types a comma, and "1,5" was refused as no value.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { locate } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { setStyleCommand } from './set.ts';

describe('a decimal comma is a decimal point (L10N1)', () => {
  it('"1,5px" is kept as 1.5px', () => {
    const document = documentOf({ pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Box', 'div', 'div')] }) }] });
    const ran = runHandler(setStyleCommand, document, { property: 'width', value: '1,5px' }, { selection: ['Box'] });
    expect(ran.outcome.kind).toBe('change');
    expect(JSON.stringify(locate(ran.document, 'Box' as NodeId)?.node.styles)).toContain('"width":"1.5px"');
  });
});

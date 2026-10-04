// Family AD2 of the code audit (2026-10-04, second reading): a link inside a text kept its address as typed once the
// address rule allowed it, though the rule reads a bare domain as https:// (core/elements/address.ts) and every other
// address field stores what the rule reads: Ctrl+K "example.com" was exported as <a href="example.com">, a path inside
// the site.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { locate } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { pastedRuns } from './inline.ts';
import { setTextCommand } from './text.ts';
import { RULES } from '../testing/handlers.ts';

const doc = () => documentOf({ pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Intro', 'paragraph', 'p', { text: 'Visit' })] }) }] });

describe('a link in a text keeps the address the rule reads (AD2)', () => {
  it('stores a bare domain as https:// from text.set', () => {
    const ran = runHandler(setTextCommand, doc(), { target: 'Intro', content: [{ tag: 'a', href: 'example.com', children: ['Visit'] }] });
    expect(ran.problems).toEqual([]);
    expect(JSON.stringify(locate(ran.document, 'Intro' as NodeId)?.node.inline)).toContain('"href":"https://example.com"');
  });
  it('reads a pasted link the same way', () => {
    const runs = pastedRuns({ status: 'read', text: 'Visit', html: [{ tag: 'a', href: 'example.com', children: ['Visit'] }] } as never, RULES.contentModel);
    expect(JSON.stringify(runs)).toContain('"href":"https://example.com"');
  });
});

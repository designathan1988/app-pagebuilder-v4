// Family EV2 of the code audit (2026-10-04, second reading): an element's event interactions were never read by the
// document validator, and interactions.add took the options it was handed as they were. An opened project file, or the
// assistant calling the command with options, stored an open-link whose address was javascript:, and the exported
// script ran it with window.location.assign on a click.
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler, RULES } from '../testing/handlers.ts';
import { validateDocument } from '../document/validate.ts';
import type { Interaction } from '../document/model.ts';
import { addInteractionCommand } from './interactions.ts';

const page = (interactions?: readonly Interaction[]) => documentOf({ pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('root', 'page', 'body', { children: [node('b', 'button', 'button', { text: 'Go', ...(interactions === undefined ? {} : { interactions }) })] }) }] });

describe('event interactions pass the trust boundary (EV2)', () => {
  it('refuses a document whose interaction opens an address that runs code, or names what is not there', () => {
    const paths = (interactions: readonly Interaction[]) => validateDocument(page(interactions), [], RULES).map((p) => p.path);
    expect(paths([{ trigger: 'click', action: 'open-link', address: 'javascript:alert(1)' }])).toContain('/pages/0/tree/children/0/interactions/0/address');
    expect(paths([{ trigger: 'click', action: 'teleport' }])).toContain('/pages/0/tree/children/0/interactions/0/action');
    expect(paths([{ trigger: 'click', action: 'show', target: 'nobody' as never }])).toContain('/pages/0/tree/children/0/interactions/0/target');
    expect(paths([{ trigger: 'click', action: 'toggle-class', className: "a'); alert(1); ('" }])).toContain('/pages/0/tree/children/0/interactions/0/className');
    expect(paths([{ trigger: 'click', action: 'open-link', address: 'https://example.com' }])).toEqual([]);
  });
  it('refuses options handed to interactions.add before any patch', () => {
    const run = (options: Record<string, unknown>) => runHandler(addInteractionCommand, page(), { trigger: 'click', action: 'open-link', options }, { selection: ['b'] });
    expect(run({ address: 'javascript:alert(1)' }).outcome.kind).toBe('refused');
    const kept = run({ address: 'example.com' });
    expect(kept.outcome.kind).toBe('change');
    expect(kept.problems).toEqual([]);
  });
});

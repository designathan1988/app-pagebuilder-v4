// Family XA1 of the code audit (2026-10-04, second reading): a custom attribute was checked by its name alone, so a
// button's formaction (an address no field owns) could hold javascript:, from a typed attribute, an imported page or an
// opened file, and the exported button ran it when its form was submitted (OWASP's XSS filter evasion cheat sheet).
import { describe, expect, it } from 'vitest';
import { documentOf, node, runHandler, RULES } from '../testing/handlers.ts';
import { validateDocument } from '../document/validate.ts';
import { setCustomAttributeCommand } from './attributes.ts';

const page = (button: ReturnType<typeof node>) => documentOf({ pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('root', 'page', 'body', { children: [button] }) }] });

describe('an address a custom attribute holds passes the address rule (XA1)', () => {
  it('refuses formaction="javascript:…" typed as an attribute, and keeps a plain one', () => {
    const doc = page(node('b', 'button', 'button', { text: 'Go' }));
    const refused = runHandler(setCustomAttributeCommand, doc, { name: 'formaction', value: ' JavaScript:alert(1)' }, { selection: ['b'] });
    expect(refused.outcome.kind).toBe('refused');
    const kept = runHandler(setCustomAttributeCommand, doc, { name: 'formaction', value: '/send' }, { selection: ['b'] });
    expect(kept.outcome.kind).toBe('change');
  });
  it('refuses a document whose custom attribute holds such an address (an opened project file)', () => {
    const doc = page(node('b', 'button', 'button', { text: 'Go', customAttributes: { formaction: 'javascript:alert(1)' } }));
    expect(validateDocument(doc, [], RULES).map((p) => p.path)).toContain('/pages/0/tree/children/0/customAttributes/formaction');
  });
});

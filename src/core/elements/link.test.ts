import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { anyCss } from '../ports/css.ts';
import { setLinkCommand } from './link.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
// a page with a Link Block (its link given), a locked section holding another, and a paragraph
const docWith = (href: string | undefined, locked = false): DocumentJson => ({
  version: 4,
  pages: [
    {
      id: 'p',
      name: 'Home',
      file: 'index.html',
      tree: node('Page', 'page', 'body', {
        children: [
          node('Card', 'linkBlock', 'a', { attributes: (href === undefined ? {} : { href }) as DocNode['attributes'], ...(locked ? { locked: true as const } : {}) }),
          node('Box', 'section', 'section', { locked: true, children: [node('Inner', 'linkBlock', 'a')] }),
          node('Intro', 'paragraph', 'p', { text: 'Hi' }),
        ],
      }),
    },
  ],
});
const contextOf = (document: DocumentJson, selection: string[]): HandlerContext<never> => ({
  state: { document, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
  clock: manualClock(),
  ids: sequentialIds('x'),
  rules: RULES,
  words: (key) => key,
  layout: noLayout,
  css: anyCss,
});
// the Link Block's attributes after the command, the patches and what the status bar says
function run(document: DocumentJson, args: Record<string, unknown>, selection: string[] = []) {
  const outcome = setLinkCommand.run(contextOf(document, selection), args as never);
  if (outcome.kind === 'refused') return { refused: outcome.message };
  if (outcome.kind !== 'change') throw new Error(outcome.kind);
  const after = applyPatches(document, outcome.patches ?? []).document;
  expect(validateDocument(after, [], RULES)).toEqual([]);
  return { attributes: after.pages[0]?.tree.children[0]?.attributes, patches: outcome.patches ?? [], message: outcome.message };
}

describe('element.setLink (src/core/elements/link.ts)', () => {
  it('sets the link of the node it is given, trimmed, one patch, and names the element and the link', () => {
    const done = run(docWith(undefined), { target: 'Card', href: '  https://example.com  ' });
    expect(done.attributes).toEqual({ href: 'https://example.com' });
    expect(done.patches).toHaveLength(1);
    expect(done.message).toEqual({ key: 'status.link.set', params: { name: 'Card', href: 'https://example.com' } });
  });

  it('without a node, acts on the one selected element', () => {
    expect(run(docWith(undefined), { href: 'mailto:a@b.co' }, ['Card']).attributes).toEqual({ href: 'mailto:a@b.co' });
    // two elements and no node named: refused with words, never thrown (the audit's AUD-09)
    expect(run(docWith(undefined), { href: 'https://x.co' }, ['Card', 'Intro']).refused?.key).toBe('status.needsSingleSelection');
  });

  it('refuses with words, never throws, when no address, page, section or tab choice is given (the invariant probe, seed 55)', () => {
    expect(run(docWith(undefined), { target: 'Card' }).refused).toEqual({ key: 'status.args.invalid', params: { argument: 'href' } });
  });

  it('replaces a link, and records nothing for the link it already has', () => {
    expect(run(docWith('https://a.co'), { target: 'Card', href: 'tel:+5511999999999' }).attributes).toEqual({ href: 'tel:+5511999999999' });
    const same = run(docWith('https://a.co'), { target: 'Card', href: 'https://a.co' });
    expect(same.patches).toEqual([]);
    expect(same.message).toEqual({ key: 'status.link.set', params: { name: 'Card', href: 'https://a.co' } });
  });

  it('an empty text removes the link: no href at all, never one invented', () => {
    const done = run(docWith('https://a.co'), { target: 'Card', href: '   ' });
    expect(done.attributes).toEqual({});
    expect(done.message).toEqual({ key: 'status.link.removed', params: { name: 'Card' } });
    const none = run(docWith(undefined), { target: 'Card', href: '' });
    expect(none.patches).toEqual([]);
  });

  it('takes what the one rule of an address takes, refuses the rest naming it, and the document keeps its link', () => {
    // a relative path and a fragment are addresses a link may have (the audit's A3.2); a bare domain is stored as https://…
    expect(run(docWith('https://a.co'), { target: 'Card', href: '/about' }).attributes).toEqual({ href: '/about' });
    expect(run(docWith(undefined), { target: 'Card', href: 'example.com/about' }).attributes).toEqual({ href: 'https://example.com/about' });
    expect(run(docWith('https://a.co'), { target: 'Card', href: ' javascript:alert(1) ' })).toEqual({ refused: { key: 'status.url.unsafe', params: { url: 'javascript:alert(1)' } } });
    expect(run(docWith(undefined), { target: 'Card', href: 'data:text/html,x' })).toEqual({ refused: { key: 'status.url.unsafe', params: { url: 'data:text/html,x' } } });
    expect(run(docWith(undefined), { target: 'Card', href: 'nope' })).toEqual({ refused: { key: 'status.url.malformed', params: { url: 'nope' } } });
    // refused means refused: the link the Card had is still there, and no patch was recorded
    expect(run(docWith('https://a.co'), { target: 'Card', href: 'javascript:alert(1)' })).toEqual({ refused: { key: 'status.url.unsafe', params: { url: 'javascript:alert(1)' } } });
  });

  it('refuses a locked element and one inside a locked element', () => {
    expect(run(docWith(undefined, true), { target: 'Card', href: 'https://a.co' })).toEqual({ refused: { key: 'status.locked.edit', params: { name: 'Card' } } });
    expect(run(docWith(undefined), { target: 'Inner', href: 'https://a.co' })).toEqual({ refused: { key: 'status.locked.byAncestor', params: { name: 'Inner', ancestor: 'Box' } } });
  });

  // changed on purpose (jornada03 J1): the command bar reaches the command on any element, so an element that takes
  // no link is refused naming it instead of throwing
  it('refuses a node that takes no link, naming it', () => {
    expect(run(docWith(undefined), { target: 'Intro', href: 'https://a.co' })).toEqual({ refused: { key: 'status.element.notApplicable', params: { command: { key: 'command.setLink' }, name: 'Intro' } } });
  });
});

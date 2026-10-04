import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { anyCss } from '../ports/css.ts';
import { noLayout } from '../ports/layout.ts';
import { setTextCommand } from './text.ts';
import { deepFreeze } from '../store/store.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const DOC: DocumentJson = {
  version: 4,
  pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Hero', 'section', 'section', { children: [node('Intro', 'paragraph', 'p', { text: 'Old' })] })] }) }],
};
const context: HandlerContext<never> = {
  state: { document: DOC, selection: [], history: EMPTY_HISTORY, message: null, ui: undefined as never },
  clock: manualClock(),
  ids: sequentialIds('x'),
  rules: RULES,
  words: (key) => key,
  layout: noLayout,
  css: anyCss,
};

// every handler runs on a frozen document, as the store commits it: a change in place throws
deepFreeze(DOC);

describe('text.set', () => {
  it("writes a text element's text, a line break as \\n, and says the text is kept", () => {
    const outcome = setTextCommand.run(context, { target: 'Intro', content: 'New\nline' });
    if (outcome.kind !== 'change') throw new Error(outcome.kind);
    const after = applyPatches(DOC, outcome.patches ?? []).document;
    expect(after.pages[0]?.tree.children[0]?.children[0]?.text).toBe('New\nline');
    expect(outcome.message).toEqual({ key: 'status.textEdit.committed', params: { name: 'Intro' } });
  });

  it('changes nothing for the text the element already has', () => {
    expect(setTextCommand.run(context, { target: 'Intro', content: 'Old' })).toEqual({ kind: 'change', message: { key: 'status.textEdit.cancelled', params: { name: 'Intro' } } });
  });

  it('keeps a tree of runs (spec text-inline-formatting): the plain text in text, the canonical tree in inline', () => {
    const outcome = setTextCommand.run(context, { target: 'Intro', content: [{ tag: 'strong', children: ['O'] }, 'ld'] });
    if (outcome.kind !== 'change') throw new Error(outcome.kind);
    expect(outcome.patches).toEqual([{ op: 'add', path: ['pages', 0, 'tree', 'children', 0, 'children', 0, 'inline'], value: [{ tag: 'strong', children: ['O'] }, 'ld'] }]);
    const after = applyPatches(DOC, outcome.patches ?? []).document;
    const marked = { ...context, state: { ...context.state, document: after } };
    // the same tree records nothing; a plain text over it keeps the marks of what it keeps; a tree with no mark removes
    // them
    expect(setTextCommand.run(marked, { target: 'Intro', content: [{ tag: 'strong', children: ['O'] }, 'ld'] })).toEqual({ kind: 'change', message: { key: 'status.textEdit.cancelled', params: { name: 'Intro' } } });
    expect(setTextCommand.run(marked, { target: 'Intro', content: 'Old' })).toEqual({ kind: 'change', message: { key: 'status.textEdit.cancelled', params: { name: 'Intro' } } });
    const typed = setTextCommand.run(marked, { target: 'Intro', content: 'Older' });
    if (typed.kind !== 'change') throw new Error(typed.kind);
    expect(applyPatches(after, typed.patches ?? []).document.pages[0]?.tree.children[0]?.children[0]).toMatchObject({ text: 'Older', inline: [{ tag: 'strong', children: ['O'] }, 'lder'] });
    const unmarked = setTextCommand.run(marked, { target: 'Intro', content: ['Old'] });
    if (unmarked.kind !== 'change') throw new Error(unmarked.kind);
    expect(unmarked.patches).toEqual([{ op: 'remove', path: ['pages', 0, 'tree', 'children', 0, 'children', 0, 'inline'] }]);
  });

  it('refuses a link whose address is not allowed, and writes nothing', () => {
    expect(setTextCommand.run(context, { target: 'Intro', content: [{ tag: 'a', href: 'javascript:alert(1)', children: ['Old'] }] })).toEqual({ kind: 'refused', message: { key: 'status.link.unsafe', params: {} } });
  });

  // a missing node is the store's to refuse before the handler runs (core/store/args.ts); an element without text and a
  // content that is no string are refused with words, never thrown (the audit's AUD-09)
  it('refuses what no door hands it: a missing node, an element without text, a content that is no string', () => {
    expect(() => setTextCommand.run(context, { target: 'Gone', content: 'x' })).toThrow(/no node/);
    const noText = setTextCommand.run(context, { target: 'Hero', content: 'x' });
    expect(noText.kind === 'refused' ? noText.message.key : noText.kind).toBe('status.element.notApplicable');
    const noString = setTextCommand.run(context, { target: 'Intro', content: 3 });
    expect(noString.kind === 'refused' ? [noString.message.key, noString.message.params.argument] : noString.kind).toEqual(['status.args.invalid', 'content']);
  });
});

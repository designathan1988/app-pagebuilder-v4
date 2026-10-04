// @vitest-environment happy-dom
// The kernel's reference rule at the code pane's HTML apply (the plan's T1/T6, the audit's A3.4): markup that drops a
// child the document held takes that child's references away with it, in the same undo step, or the document would
// hold a pointer at nothing and the model would refuse the result the command produced.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import { orphanReferences } from '../elements/references.ts';
import { validateDocument, rulesFromManifest } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import type { HandlerContext } from '../commands/registry.ts';
import { anyCss } from '../ports/css.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { deepFreeze } from '../store/store.ts';
import { locate, type DocNode, type DocumentJson } from '../document/model.ts';
import { applyHtmlCommand } from './apply-html.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({
  id: id as NodeId,
  type: type as DocNode['type'],
  name: id,
  tag,
  attributes: {},
  classes: [],
  styles: {},
  text: null,
  children: [],
  ...fields,
});

// a page holding a box: a label pointing at the heading beside it
const DOC: DocumentJson = {
  version: 3,
  pages: [
    {
      id: 'p',
      name: 'Home',
      file: 'index.html',
      tree: node('Page', 'page', 'body', {
        children: [
          node('Box', 'div', 'div', {
            children: [node('Field', 'label', 'label', { attributes: { labelFor: 'Title' } }), node('Title', 'heading', 'h2', { text: 'Hi' })],
          }),
        ],
      }),
    },
  ],
};
deepFreeze(DOC);

function apply(html: string, selection: readonly string[]) {
  const context = {
    state: { document: DOC, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
    clock: manualClock(),
    ids: sequentialIds('new'),
    rules: RULES,
    words: (key: MessageId) => translate('en', key),
    layout: noLayout,
    css: anyCss,
  } satisfies HandlerContext<never>;
  return applyHtmlCommand.run(context, { html } as never);
}

describe('element.applyHtml and the references of what the markup drops', () => {
  it('releases the references of a child the markup leaves out, and the result is a valid document', () => {
    expect(validateDocument(DOC, ['Box' as NodeId], RULES)).toEqual([]);
    // the markup keeps the box and its label — still pointing at the heading — and leaves the heading out: what the
    // label points at is gone, so the pointer must go with it
    const outcome = apply('<div><label for="Title">Hi</label></div>', ['Box' as NodeId]);
    expect(outcome.kind).toBe('change');
    const patches = outcome.kind === 'change' ? (outcome.patches ?? []) : [];
    const after = applyPatches(DOC, patches).document;
    expect(orphanReferences(after)).toEqual([]);
    expect(validateDocument(after, [], RULES)).toEqual([]);
    // the heading left and the label stayed, without its pointer
    const box = locate(after, 'Box' as NodeId);
    expect([...(box?.node.children ?? [])].map((child) => child.id)).toEqual(['Field']);
    expect(locate(after, 'Title' as NodeId)).toBeNull();
    expect(box?.node.children[0]?.attributes.labelFor).toBeUndefined();
  });
});

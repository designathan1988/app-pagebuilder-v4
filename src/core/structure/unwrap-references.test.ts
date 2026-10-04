// The kernel's reference rule at the unwrap command (the plan's T1/T6, the audit's A3.4): a wrapper something points
// at leaves and its children take its place — so the reference must be released in the same undo step, or the document
// holds a pointer at nothing, the validator refuses it and the command would have thrown instead of running.
//
// One document: a page holding a box whose label points at the box itself (the `for` stores the target's node id).
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { translate } from '../../i18n/index.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import { locate, type DocNode, type DocumentJson } from '../document/model.ts';
import { orphanReferences } from '../elements/references.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { anyCss } from '../ports/css.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { deepFreeze } from '../store/store.ts';
import { unwrapCommand } from './wrap.ts';

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

const DOC: DocumentJson = {
  version: 4,
  pages: [
    {
      id: 'p',
      name: 'Home',
      file: 'index.html',
      tree: node('Page', 'page', 'body', {
        children: [
          node('Box', 'div', 'div', {
            children: [node('Field', 'label', 'label', { attributes: { labelFor: 'Box' } }), node('Entry', 'input', 'input')],
          }),
        ],
      }),
    },
  ],
};
deepFreeze(DOC);

function unwrap(selection: readonly string[]) {
  const context = {
    state: { document: DOC, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
    clock: manualClock(),
    ids: sequentialIds('new'),
    rules: RULES,
    words: (key: MessageId) => translate('en', key),
    layout: noLayout,
    css: anyCss,
  } satisfies HandlerContext<never>;
  return unwrapCommand.run(context, {} as never);
}

describe('element.unwrap and the references pointing at the wrapper', () => {
  it('runs on a wrapper a label points at, releasing the reference in the same step', () => {
    // the document is valid to begin with: the label points at the box, which is there
    expect(validateDocument(DOC, ['Box' as NodeId], RULES)).toEqual([]);
    const outcome = unwrap(['Box' as NodeId]);
    expect(outcome.kind).toBe('change');
    const patches = outcome.kind === 'change' ? (outcome.patches ?? []) : [];
    // the reference is released (the label's `for` goes) and the wrapper leaves with its children taking its place
    expect(patches.some((p) => p.op === 'remove' && p.path.join('/').endsWith('attributes/labelFor'))).toBe(true);
    const after = applyPatches(DOC, patches).document;
    // the result is a document the model accepts: no reference points at nothing
    expect(orphanReferences(after)).toEqual([]);
    expect(validateDocument(after, [], RULES)).toEqual([]);
    // the children took the wrapper's place, with their own ids
    const page = after.pages[0]?.tree;
    expect(page?.children.map((child) => child.id)).toEqual(['Field', 'Entry']);
    expect(locate(after, 'Field' as NodeId)?.parent?.id).toBe('Page');
  });
});

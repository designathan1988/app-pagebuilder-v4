// A handler run for the core's unit tests, as the store runs it: on a frozen document (a change in place throws), with
// the manifest's model rules and ports that measure nothing, and the result applied and validated — the same
// document the store would publish, or the validator's words when it would refuse it.
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext, Outcome } from '../commands/registry.ts';
import { DOCUMENT_VERSION, type DocNode, type DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { anyCss } from '../ports/css.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout, type Layout } from '../ports/layout.ts';
import { deepFreeze } from '../store/store.ts';

export const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);

export const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({
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

// a one-page (or more) document, frozen as the store keeps it
export function documentOf(fields: Partial<DocumentJson> & { readonly pages: DocumentJson['pages'] }): DocumentJson {
  return deepFreeze({ version: DOCUMENT_VERSION, ...fields } as DocumentJson);
}

interface Handler {
  run(context: HandlerContext<never>, args: never): Outcome<never>;
}

export interface Ran {
  readonly outcome: Outcome<never>;
  // the document after the outcome's patches (the same document when it changes nothing)
  readonly document: DocumentJson;
  // what the validator says of that document: [] when the store would publish it
  readonly problems: readonly unknown[];
}

export function runHandler(
  handler: Handler,
  document: DocumentJson,
  args: Record<string, unknown> = {},
  options: { readonly selection?: readonly string[]; readonly confirmed?: boolean; readonly ui?: unknown; readonly layout?: Layout } = {},
): Ran {
  const context = {
    state: { document, selection: (options.selection ?? []) as NodeId[], history: EMPTY_HISTORY, message: null, ui: options.ui as never },
    ids: sequentialIds('new'),
    clock: manualClock(),
    rules: RULES,
    words: (key: string) => key,
    layout: options.layout ?? noLayout,
    css: anyCss,
    confirmed: options.confirmed ?? false,
  } as HandlerContext<never>;
  const outcome = handler.run(context, args as never);
  const next = outcome.kind === 'change' ? applyPatches(document, outcome.patches ?? []).document : document;
  return { outcome, document: next, problems: validateDocument(next, [], RULES) };
}

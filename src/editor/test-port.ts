// The read-only test port (PRODUCT.md §5): what the end-to-end tests read of the editor, the document, the
// selection, the history, the export and the messages shown, each as a copy taken now. It has no other member: it
// never writes, loads, creates or selects anything, so a test can change the editor only through its doors. It is
// installed, frozen on window, in the dev server and in the e2e build (the suite tests the packaged app,
// playwright.config.ts; npm run ui drives the dev server or `npm run build:e2e`), never in the build a person uses
// (the audit's AUD-10: src/main.tsx, vite.config.ts).
import type { CommandArgs } from '../generated/commands.ts';
import type { CommandId } from '../generated/ids.ts';
import { aboutNode, saidOf, whyNotAccepted, type Explanation } from '../core/explain.ts';
import { incidents, type Incident } from '../core/incidents.ts';
import type { NodeId } from '../core/document/model.ts';
import { MODEL_RULES, type EditorStore } from './store.ts';
import { manifest } from '../manifest/runtime.ts';
import { listenToKeys } from '../i18n/index.ts';

// The engineering answers (the plan's T5), read-only: why a command would not run now, why these nodes cannot go into
// that parent, and what the document says about one node. Each is another owner's answer (store.refusal, the content
// model and the flags, the checks), gathered in one place so a check or a tool asks once.
export interface Explanations {
  readonly command: (id: CommandId, args: CommandArgs[CommandId]) => string;
  readonly into: (parent: NodeId, nodes: readonly NodeId[]) => string;
  readonly node: (id: NodeId) => Explanation;
}

export interface TestPort {
  readonly document: () => unknown;
  readonly selection: () => readonly string[];
  // how many steps Undo and Redo can take now
  readonly history: () => { readonly undoSteps: number; readonly redoSteps: number };
  // the exported files; null until the export is built (project-export)
  readonly export: () => null;
  // what the incident feed holds (the plan's T2): an invariant a command broke, an error the page threw. A check that
  // reads this after its steps fails when the app did something it should not have, without anyone watching a console.
  readonly incidents: () => readonly Incident[];
  readonly explain: Explanations;
  // the message keys translated since the page loaded (the browser tests' coverage of the catalogues:
  // tests/support/coverage.ts)
  readonly keys: () => readonly string[];
}

export const TEST_PORT_KEY = '__builderTestPort';

export function createTestPort(store: EditorStore, shown: ReadonlySet<string> = new Set()): TestPort {
  const copy = <T>(value: T): T => structuredClone(value);
  const document = () => store.getState().document;
  return Object.freeze({
    document: () => copy(document()),
    selection: () => copy(store.getState().selection),
    history: () => ({ undoSteps: store.getState().history.past.length, redoSteps: store.getState().history.future.length }),
    export: () => null,
    incidents: () => copy(incidents()),
    keys: () => [...shown].sort(),
    explain: Object.freeze({
      command: (id: CommandId, args: CommandArgs[CommandId]) => saidOf(store.refusal(id, args)),
      into: (parent: NodeId, nodes: readonly NodeId[]) => {
        const asked = whyNotAccepted(document(), MODEL_RULES, parent, nodes);
        return `${asked.asked}: ${saidOf(asked.refusal)}`;
      },
      node: (id: NodeId) => aboutNode(document(), MODEL_RULES, id, manifest.interactions.checks),
    }),
  });
}

export function installTestPort(store: EditorStore): void {
  const shown = new Set<string>();
  listenToKeys((key) => shown.add(key));
  Object.defineProperty(window, TEST_PORT_KEY, { value: createTestPort(store, shown), writable: false, configurable: false, enumerable: false });
}

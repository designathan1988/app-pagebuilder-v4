// What the editor receives from the wiring (plan I.9; the audit's "the editor imports the wiring 39 times"): the
// command table and the predicates the store runs, and what the installed modules add to the editor (their sidebar
// views, their canvas layers, their canvas tools). The app composes it (src/app/wiring.ts) and installs it before the
// editor starts (src/main.tsx); the unit tests install the same (tools/test/setup-wiring.ts). Which features are built
// is read from the core's registry, where the feature table installs itself (core/commands/registry.ts). The editor
// imports nothing of src/app: a lint rule refuses it (eslint.config.js). A reader asked for before the wiring is
// installed is a defect of the wiring; a value read from it while modules load waits for its first use (onFirstUse).
import type { ComponentType } from 'react';
import type { CommandTable, PredicateTable } from '../core/commands/registry.ts';
import type { BodyTable } from './shell/bodies.ts';
import type { EditorUi } from './state.ts';

export interface EditorWiring {
  readonly commands: CommandTable<EditorUi>;
  readonly predicates: PredicateTable<EditorUi>;
  // the installed modules' sidebar views, their layers over the canvas, and their canvas tools joining the pointer
  // owner (the function returned takes them away)
  readonly sidebarViews: BodyTable;
  readonly canvasLayers: readonly ComponentType[];
  readonly installTools: () => () => void;
}

let installed: EditorWiring | null = null;

export function installWiring(wiring: EditorWiring): void {
  installed = wiring;
}

export function wiring(): EditorWiring {
  if (installed === null) throw new Error('the editor wiring is not installed (src/app/wiring.ts)');
  return installed;
}

// A value read from the wiring once, the first time it is asked for (a module's constant that depends on what is
// built: read at its first use, never while the module loads).
export function onFirstUse<T>(read: () => T): () => T {
  let value: { readonly v: T } | null = null;
  return () => (value ??= { v: read() }).v;
}

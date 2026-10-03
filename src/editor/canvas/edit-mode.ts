// Edit on canvas (INVENTORY.md, owners; spec spacing-handles, radius-border-gap-handles, shadow-handles): the
// mode in which the canvas draws the handles of one kind of value of the selection (padding or margin bands, the
// radius corner, border edges, gap bands, the shadow's handles). canvas.setEditMode chooses it from the quick panel's
// Edit on canvas menu; Escape in the canvas while a mode is on (the canvas-edit-mode key context) leaves it. A mode is
// editor state: nothing in the document changes and nothing is recorded; it stays while the selection changes.
//
// Which modes the menu offers usable: none, and a mode whose handles are built (the canvas-handle doors whose handle
// starts with the mode's name, their feature registered as built), so a mode never draws nothing (archive/DESIGN.md
// "Build order"); a mode whose handles edit a structured value (a shadow's layers) applies to an element that holds one
// (modeApplies: spec shadow-handles, Problems in Pager 2), and is disabled with its reason on any other.
import { toolKeyContext } from '../input/pointer-tools.ts';
import { isFeatureBuilt, registerHandler } from '../../core/commands/registry.ts';
import type { CommandArgs } from '../../generated/commands.ts';
import type { FeatureId, KeyContextId } from '../../generated/ids.ts';
import { commandOf, manifest } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';
import type { DocNode } from '../../core/document/model.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import { appliesToOf, contextPredicate, elementPredicate, type ElementContext } from '../../core/style/applies.ts';
import { storedLayers } from '../../core/style/stored.ts';
import { GRID_EDIT_CONTEXT, gridEditOf } from './grid-edit.ts';

export type EditMode = CommandArgs['canvas.setEditMode']['mode'];
// no mode: canvas.setEditMode's first value, the one that clears the mode
export const NO_MODE: EditMode = 'none';

export const editMode = (ui: EditorUi): EditMode => ui.editMode ?? NO_MODE;

export const setEditMode = registerHandler<'canvas.setEditMode', EditorUi>(
  'canvas.setEditMode',
  ({ state }, { mode }) => {
    if (editMode(state.ui) === mode) return { kind: 'change' };
    const { editMode: _dropped, ...rest } = state.ui;
    void _dropped;
    // a mode hands the canvas to its handles: the quick panel folds to its chip, so no handle is ever under it (spec
    // quick-panel, Problems in Pager 10); the chip opens it again, the mode still on
    const { quickPanelOpen: _folded, ...clear } = rest;
    void _folded;
    return { kind: 'change', ui: mode === NO_MODE ? rest : { ...clear, editMode: mode } };
  },
  (state, args) => editMode(state.ui) === args.mode,
);

// the modes of canvas.setEditMode, in the manifest's order
export const EDIT_MODES: readonly EditMode[] = (commandOf(setEditMode.command).args.mode?.values ?? []) as EditMode[];

// the canvas-handle doors of a mode: those whose handle is the mode or names it first (shadow-blur; padding-top-band
// for padding)
export const handlesOf = (mode: EditMode) => manifest.doors.filter((d) => d.door.kind === 'canvas-handle' && (d.door.handle === mode || d.door.handle.startsWith(`${mode}-`)));

// whether a mode draws handles that run: none always
export const modeBuilt = (mode: EditMode): boolean => mode === NO_MODE || handlesOf(mode).some((d) => isFeatureBuilt(d.door.feature as FeatureId));

// Why a mode's handles have nothing to edit on a node, or null when they have: the structured values they write hold
// no layers there (a shadow mode on an element with no shadow, spec shadow-handles Problems in Pager 2), or none of
// the values they write applies to it (the gap bands: a flex or grid container only, A3.15).
//
// A mode's handles may write more than one property and edit whichever the element holds (a shadow handle writes
// box-shadow and text-shadow): one of them holding layers, and one of them applying, is enough for the mode to have
// something to edit — the gap takes both, since row-gap and column-gap hold the same predicate, so an element that
// takes one takes the other.
export type ModeRefusal = 'canvas.editMode.nothingToEdit' | 'canvas.editMode.notApplicable';
export function modeRefusal(mode: EditMode, node: DocNode, rules: ModelRules, context: ElementContext | null = null): ModeRefusal | null {
  const writes = [...new Set(handlesOf(mode).flatMap((d) => d.door.adapter.writes))];
  const structured = writes.filter((p) => rules.structures.has(p));
  if (structured.length > 0 && !structured.some((p) => storedLayers(node, p, rules).length > 0)) return 'canvas.editMode.nothingToEdit';
  const applies = writes.some((property) => {
    const predicate = appliesToOf(property, rules);
    if (predicate === null) return true;
    // the computed layout decides where the element predicate cannot (a gap container is flex or grid)
    return contextPredicate(predicate, context) !== false && elementPredicate(predicate, node, rules) !== false;
  });
  return applies ? null : 'canvas.editMode.notApplicable';
}

// whether a mode's handles have something to edit on a node
export const modeApplies = (mode: EditMode, node: DocNode, rules: ModelRules, context: ElementContext | null = null): boolean => modeRefusal(mode, node, rules, context) === null;

// The key context of the canvas while a mode is on: its own, whose Escape leaves the mode (interactions.json
// canvas-edit-mode inherits the canvas's keys).
const EDIT_CONTEXT: KeyContextId = 'canvas-edit-mode';
const CANVAS_CONTEXT: KeyContextId = 'canvas';
const GLOBAL_CONTEXT: KeyContextId = 'global';
// The grid editor's own context comes first: while it is on, the canvas's keys are the grid's (Escape leaves it)
// A canvas tool of a module (the Layout Composer) comes before both: while it is on, the keys of the canvas and of any
// control outside a field (its own panel's buttons, the toolbar) are its own, so Escape leaves it from anywhere.
export const keyContextIn = (ui: EditorUi, context: KeyContextId): KeyContextId =>
  (context === CANVAS_CONTEXT || context === GLOBAL_CONTEXT) && toolKeyContext(ui) !== null
    ? (toolKeyContext(ui) as KeyContextId)
    : context === CANVAS_CONTEXT && gridEditOf(ui) !== null ? GRID_EDIT_CONTEXT : context === CANVAS_CONTEXT && editMode(ui) !== NO_MODE ? EDIT_CONTEXT : context;

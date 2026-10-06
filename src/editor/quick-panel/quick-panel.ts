// The quick panel (INVENTORY.md, owners; spec quick-panel, Quick panel): a small panel
// near the primary selected element, collapsed to a chip by default, whose fields are the doors the manifest places in
// the quick-panel region (each runs the same command as the matching inspector field; canvas/quick-panel.tsx draws
// them).
//
// quickPanel.setOpen opens, closes or turns the panel over: the chip's press, the shortcut that reaches it from
// anywhere, and Escape while the focus is in the panel (its key context absorbs the fields inside it: keymap.ts).
// It is window chrome: nothing in the document changes and nothing is recorded in the history.
//
// quickPanel.setOffset remembers where the person dragged the panel by its grip, for that element: the offset of the
// panel's top-left corner from the element's, in screen pixels, kept in the preferences (spec, Problems in Pager 1),
// so it survives a reload. It is window chrome: nothing in the document changes and nothing is recorded in the
// history. Its distance, the pointer's horizontal travel, is already in the offset the drag gives.
//
// Where the chip and the open panel go (placeQuickPanel; the user's rule of 2026-10-05, DEC-70): always on the right of
// the selection's label, touching it, on its line — the chip resting on the frame as the label does (their bottoms
// level), the open panel with its top level with the label's — never moved aside for what lies there or for the
// stage's edge. A panel the person dragged by its grip stays where it was left (its remembered offset), held inside the
// stage, which keeps an inset free all round.
//
// Which fields it shows (appliesTo): a field shows only when its property applies to the selected element, by the
// element predicates of core/style/applies.ts: the text properties on an element that holds text, the SVG fill on an
// SVG shape, the box properties on an HTML element, a kind's properties on an element of that kind; a property that
// applies always, or by a rule that reads more than the element (a container's, a flex item's), shows.
import { registerHandler } from '../../core/commands/registry.ts';
import type { DocNode } from '../../core/document/model.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import { appliesToOf, elementPredicate } from '../../core/style/applies.ts';
import type { EditorUi } from '../state.ts';

export interface Offset {
  readonly x: number;
  readonly y: number;
}
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const NO_OFFSETS: Readonly<Record<string, Offset>> = {};

// the offsets remembered, per element
export const quickPanelOffsets = (ui: EditorUi): Readonly<Record<string, Offset>> => ui.preferences.quickPanelOffsets ?? NO_OFFSETS;

// whether the panel is open (its chip, the shortcut, Escape in the panel)
export const quickPanelOpen = (ui: EditorUi): boolean => ui.quickPanelOpen === true;

export const setOpen = registerHandler<'quickPanel.setOpen', EditorUi>('quickPanel.setOpen', ({ state }, { open }) => {
  const now = quickPanelOpen(state.ui);
  const next = open === 'toggle' ? !now : open === 'open';
  if (next === now) return { kind: 'change' };
  return { kind: 'change', ui: { ...state.ui, quickPanelOpen: next ? true : undefined } };
});

export const setOffset = registerHandler<'quickPanel.setOffset', EditorUi>('quickPanel.setOffset', ({ state }, { target, offset }) => {
  const x = Math.round(offset.x);
  const y = Math.round(offset.y);
  const held = quickPanelOffsets(state.ui)[target];
  if (held !== undefined && held.x === x && held.y === y) return { kind: 'change' };
  return { kind: 'change', ui: { ...state.ui, preferences: { ...state.ui.preferences, quickPanelOffsets: { ...quickPanelOffsets(state.ui), [target]: { x, y } } } } };
});

// A stored offset list: each entry a node id with whole x and y; anything else is left out (preferences.ts).
export function readOffsets(stored: unknown): Readonly<Record<string, Offset>> | undefined {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
  const kept = Object.entries(stored as Record<string, unknown>).flatMap(([id, value]): [string, Offset][] => {
    if (value === null || typeof value !== 'object') return [];
    const { x, y } = value as Record<string, unknown>;
    return typeof x === 'number' && typeof y === 'number' && Number.isInteger(x) && Number.isInteger(y) ? [[id, { x, y }]] : [];
  });
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

// Where the chip (`open` false) or the open panel of `size` goes, in the stage's pixels: `label` is the selection's
// label's box; `offset` the person's own drag of the open panel, from the element's top-left corner, held inside the
// stage less its `inset`.
export function placeQuickPanel(label: Box, element: Box, size: { readonly width: number; readonly height: number }, open: boolean, stage: Box, inset: number, offset: Offset | null): Box {
  if (open && offset !== null) {
    // The person's own drag wins: the panel is where it was left, held inside the stage. A remembered offset is never
    // refused for covering the element — the panel is taller than most elements, and refusing the drag would leave a
    // panel that jumps back under the pointer (spec quick-panel, scenario the-grip-drags-the-panel-…).
    const right = stage.x + stage.width - inset;
    const bottom = stage.y + stage.height - inset;
    return { x: clamp(element.x + offset.x, stage.x + inset, right - size.width), y: clamp(element.y + offset.y, stage.y + inset, bottom - size.height), ...size };
  }
  return { x: label.x + label.width, y: open ? label.y : label.y + label.height - size.height, ...size };
}

// the offset of a placed panel from its element, what quickPanel.setOffset keeps
export const offsetOf = (panel: Box, element: Box): Offset => ({ x: Math.round(panel.x - element.x), y: Math.round(panel.y - element.y) });

// ------------------------------------------------------------------ which fields apply

// whether a field writing these properties shows for this node: every property it writes applies to it
export function appliesTo(properties: readonly string[], node: DocNode, rules: ModelRules): boolean {
  return properties.every((property) => {
    const predicate = appliesToOf(property, rules);
    return predicate === null || elementPredicate(predicate, node, rules) !== false;
  });
}

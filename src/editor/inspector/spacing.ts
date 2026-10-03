// inspector.toggleSpacingLink (INVENTORY.md, owners; spec props-spacing, Problems in Pager 1 and 2): whether
// a box of the box model editor (padding or margin) is edited as one value for its four sides. It changes only how the
// box is edited and writes nothing to the document (no undo step). The link belongs to the element (J27 of the
// jornada03 study: one global switch carried the link of the footer to every button): a box whose four sides hold the
// same value is linked, any other is not, until the person turns its link on or off for that element
// (ui.spacingLinks, by element; editor state, not kept after a reload). The status bar says the box is linked or
// unlinked; the link button stands for its box being linked.
import { message, registerHandler } from '../../core/commands/registry.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import type { StoreState } from '../../core/store/store.ts';
import { storedValue } from '../../core/style/stored.ts';
import type { EditorUi } from '../state.ts';
import { styleSource } from './style-target.ts';

export type SpacingBox = 'padding' | 'margin';
export const SPACING_BOXES: readonly SpacingBox[] = ['padding', 'margin'];

// Whether a box is linked for the element the Style tab edits: the person's own choice for that element, else whether
// its four sides hold one value there.
export function isLinked(state: StoreState<EditorUi>, box: string, rules: ModelRules): boolean {
  const node = styleSource(state);
  if (node === null) return false;
  const chosen = state.ui.spacingLinks?.[node.id]?.[box];
  if (chosen !== undefined) return chosen;
  const sides = rules.compositeFacts.get(box)?.longhands ?? [];
  const values = sides.map((side) => storedValue(node, side, rules));
  return values.length > 0 && values[0] !== undefined && values.every((value) => value === values[0]);
}

export const toggleSpacingLink = registerHandler<'inspector.toggleSpacingLink', EditorUi>(
  'inspector.toggleSpacingLink',
  (context, { box }) => {
    const { state, rules } = context;
    const node = styleSource(state);
    const linked = isLinked(state, box, rules);
    const label = rules.compositeFacts.get(box)?.labelKey;
    const named = label === undefined ? box : { key: label };
    const links = state.ui.spacingLinks ?? {};
    const ui: EditorUi = node === null ? state.ui : { ...state.ui, spacingLinks: { ...links, [node.id]: { ...(links[node.id] ?? {}), [box]: !linked } } };
    return {
      kind: 'change',
      ui,
      message: message(linked ? 'status.spacing.unlinked' : 'status.spacing.linked', { box: named }),
    };
  },
  (state, args, rules) => rules !== undefined && isLinked(state as StoreState<EditorUi>, String(args.box), rules),
);

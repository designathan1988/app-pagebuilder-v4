// The style state the editor edits (INVENTORY.md, owners; spec state-styles): one of properties.json's
// `states`, Base while none is chosen. The State menu chooses it (view.setStyleState); style writes go to its layer at
// the active breakpoint (the store's `layer`), and the canvas draws the selected elements with that state applied.
// Editor state, not a preference: a reload goes back to Base. Choosing it records nothing.
import { message, registerHandler } from '../../core/commands/registry.ts';
import { locate, type DocNode } from '../../core/document/model.ts';
import type { Followed, StoreState } from '../../core/store/store.ts';
import type { MessageId } from '../../generated/ids.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';
import { activeBreakpoint, type Shown } from './breakpoints.ts';

export const STATES = manifest.properties.states;
const BASE = STATES[0];
if (BASE === undefined) throw new Error('properties.json declares no state');
export const BASE_STATE = BASE;

// the state the editor edits now
export const activeState = (ui: EditorUi): (typeof STATES)[number] => STATES.find((s) => s.id === ui.styleState) ?? BASE;

// the layer style writes go to and the fields read: the active breakpoint and the active state
export const activeLayer = (shown: Shown): { readonly breakpoint: string; readonly state: string } => ({ breakpoint: activeBreakpoint(shown).id, state: activeState(shown.ui).id });

// Whether a state stands on an element of this type (elements.json ids; null for every element): the State menu
// hides the ones it does not, and no field edit or export writes a rule a browser would ignore (A3.36).
export function stateAppliesTo(state: (typeof STATES)[number], type: string): boolean {
  return state.elements === null || state.elements.includes(type);
}

// The state a door stands for (its arguments), or null for a door that is no state

export const stateOf = (args: Readonly<Record<string, unknown>>): (typeof STATES)[number] | null => (typeof args.state === 'string' ? (STATES.find((s) => s.id === args.state) ?? null) : null);

// The states the menu offers for an element of this type

// The first selected element a state does not stand on, or null (the state stands on all of them)
function standsApart(state: Pick<StoreState<EditorUi>, 'document' | 'selection'>, chosen: (typeof STATES)[number]): DocNode | null {
  for (const id of state.selection) {
    const node = locate(state.document, id)?.node;
    if (node !== undefined && !stateAppliesTo(chosen, node.type)) return node;
  }
  return null;
}

const apart = (chosen: (typeof STATES)[number], node: DocNode, key: 'status.styleState.reset' | 'status.styleState.notApplicable') =>
  message(key, { state: { key: chosen.labelKey as MessageId }, element: { key: ELEMENT_LABELS.get(node.type) ?? ('styleState.base' as MessageId) } });

const ELEMENT_LABELS = new Map(manifest.elements.elements.map((e) => [e.id, e.labelKey as MessageId] as const));

// The style state follows the selection (the audit's AUD-03; the user's decision of 2026-10-02): a selection that holds
// an element the state does not stand on (Visited, then a heading) brings the editor back to Base and says so, so no
// write can go to a state the element does not take. Read after every new selection and every command (a tag switch
// changes what an element is).
export function styleStateFollows(state: StoreState<EditorUi>): Followed<EditorUi> {
  const chosen = activeState(state.ui);
  if (chosen.id === BASE_STATE.id) return { ui: state.ui };
  const node = standsApart(state, chosen);
  if (node === null) return { ui: state.ui };
  const { styleState: _was, ...rest } = state.ui;
  void _was;
  return { ui: rest, message: apart(chosen, node, 'status.styleState.reset') };
}

export const setStyleState = registerHandler<'view.setStyleState', EditorUi>(
  'view.setStyleState',
  ({ state }, args) => {
    const chosen = STATES.find((s) => s.id === args.state);
    if (chosen === undefined) throw new Error(`view.setStyleState: no state ${args.state}`);
    // a state the selection does not stand on is not chosen (the State menu offers only the ones it does)
    const node = standsApart(state, chosen);
    if (node !== null) return { kind: 'refused', message: apart(chosen, node, 'status.styleState.notApplicable') };
    const { styleState: _was, ...rest } = state.ui;
    void _was;
    const ui: EditorUi = chosen.id === BASE.id ? rest : { ...rest, styleState: chosen.id };
    return { kind: 'change', ui, message: message('status.styleStateActive', { state: { key: chosen.labelKey as MessageId } }) };
  },
  // a menu item stands for its state being the one edited
  (state, args) => activeState(state.ui).id === args.state,
);

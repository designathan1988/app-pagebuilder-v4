// Which elements a style state stands on (properties.json states[].elements): read by the validator, the style
// writers' refusals and the editor's style state, without importing one another (plan I.8: no cycle).
import type { ModelRules } from '../document/validate.ts';

// Whether a style state stands on an element of this type (properties.json states[].elements; null for every one): the
// one owner of the rule, read by the validator, by the style writers' refusals (nodes/flags.ts) and by the editor's
// style state, which goes back to Base when the selection holds an element it does not stand on (the audit's AUD-03)
export function stateStandsOn(state: string, type: string, rules: Pick<ModelRules, 'stateElements'>): boolean {
  const elements = rules.stateElements.get(state);
  return elements === undefined || elements === null || elements.includes(type);
}

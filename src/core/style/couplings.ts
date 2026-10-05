// Couplings (PRODUCT.md §5; properties.json couplings): a style write that triggers a coupling changes what it writes
// in the same command and undo step. A coupling names its trigger (a property about to be written, optionally only some
// of its values, optionally only when a composite writes it: `via`), its condition (a closed list of predicates over
// the value the element, or its parent, holds for a property) and its effect (a closed list of actions on the
// declarations about to be written). They run in the manifest's order, each on what the ones before it left.
// The conditions and actions registered here are those the built features use; a coupling whose condition or action is
// not registered yet does not run. absolute-free-drag's: parentValueIn (the value the parent shows), setParentValue
// (the parent's declarations the same write makes) and keepVisualPlace (a property written from where the element lies
// now, measured by the layout port: from its parent's padding edge, from the viewport for a fixed element).
import { registerAction, registerCondition, type CouplingScene, type RegisteredAction, type RegisteredCondition } from '../commands/registry.ts';
import type { DocNode, StyleClass } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { INITIAL_VALUES } from '../../generated/value-lists.ts';
import { storedStyleValue, storedValue } from './stored.ts';

const valueIn = registerCondition('valueIn', (own, _parent, values) => own !== undefined && values.includes(own));
const alwaysHolds = registerCondition('always', () => true);
const parentValueIn = registerCondition('parentValueIn', (_own, parent, values) => parent !== undefined && values.includes(parent));

// a value the write itself names for the property wins: the coupling only fills in one it leaves out (a width typed
// with its style keeps that style)
const setValue = registerAction('setValue', (values, _trigger, effect) => {
  if (effect.value !== null && !(effect.property in values)) values[effect.property] = effect.value;
});
const swapWith = registerAction('swapWith', (values, trigger, effect) => {
  const meant = values[trigger];
  const other = values[effect.property];
  if (meant === undefined || other === undefined) return;
  values[trigger] = other;
  values[effect.property] = meant;
});
// the keywords of an axis's two ends, each the other's mirror
const MIRRORED: Readonly<Record<string, string>> = { 'flex-start': 'flex-end', 'flex-end': 'flex-start', start: 'end', end: 'start', 'self-start': 'self-end', 'self-end': 'self-start' };
const mirror = registerAction('mirror', (values, _trigger, effect) => {
  const value = values[effect.property];
  if (value !== undefined) values[effect.property] = MIRRORED[value] ?? value;
});
const setParentValue = registerAction('setParentValue', (_values, _trigger, effect, scene) => {
  if (effect.value !== null && !(effect.property in scene.parent)) scene.parent[effect.property] = effect.value;
});
// the value that keeps the element where it is drawn: a value the write names wins; a fixed element is measured from
// the viewport, any other from its parent's padding edge (its containing block, which setParentValue made relative),
// in whole px
const FIXED = 'fixed';
const keepVisualPlace = registerAction('keepVisualPlace', (values, trigger, effect, scene) => {
  if (effect.property in values) return;
  const at = scene.place(values[trigger] === FIXED ? 'viewport' : 'parent') as Readonly<Record<string, number>> | null;
  const value = at?.[effect.property];
  if (value !== undefined) values[effect.property] = `${Math.round(value)}px`;
});

const CONDITIONS: ReadonlyMap<string, RegisteredCondition> = new Map([valueIn, alwaysHolds, parentValueIn].map((c) => [c.id, c]));
const ACTIONS: ReadonlyMap<string, RegisteredAction> = new Map([setValue, swapWith, mirror, setParentValue, keepVisualPlace].map((a) => [a.id, a]));

// Whether an availability predicate that reads one value (properties.json valuePredicates) holds for a node: the value
// it holds for the predicate's property is one of the predicate's values — its own, else the one its classes give it,
// the last of the project's classes that sets it winning, as in the exported stylesheet (AL1: a card made a flex
// container by its class was refused the alignment matrix, and a grid made by a class the grid editor).
export function valuePredicateHolds(node: DocNode, id: string, rules: ModelRules, classes: readonly StyleClass[] = []): boolean {
  const predicate = rules.valuePredicates.get(id);
  if (predicate === undefined) throw new Error(`properties.json names no value predicate ${id}`);
  const own = storedValue(node, predicate.property, rules);
  const fromClasses = classes.filter((one) => node.classes.includes(one.name)).map((one) => storedStyleValue(one.styles, predicate.property, rules)).filter((value) => value !== undefined).at(-1);
  return valueIn.holds(own ?? fromClasses, undefined, predicate.values);
}

// What a write of one element makes of the declarations it is about to write (property → CSS text), `via` the
// composite that writes them (null for a property's own field), once every coupling it triggers has run.
export function coupled(node: DocNode, parent: DocNode | null, values: Readonly<Record<string, string>>, via: string | null, rules: ModelRules): Record<string, string> {
  return coupledScene(node, parent, values, via, rules, UNMEASURED).own;
}
const UNMEASURED = () => null;

// The same, with where the element lies now (the layout port's measure, for keepVisualPlace): the element's
// declarations and those the write makes of its parent (setParentValue).
export function coupledScene(
  node: DocNode,
  parent: DocNode | null,
  values: Readonly<Record<string, string>>,
  via: string | null,
  rules: ModelRules,
  place: CouplingScene['place'],
): { readonly own: Record<string, string>; readonly parent: Record<string, string> } {
  const out = { ...values };
  const scene: CouplingScene = { parent: {}, place };
  for (const c of rules.couplings) {
    const written = out[c.trigger.property];
    if (written === undefined || (c.trigger.values !== null && !c.trigger.values.includes(written)) || (c.trigger.via !== null && c.trigger.via !== via)) continue;
    const condition = CONDITIONS.get(c.condition.predicate);
    const action = ACTIONS.get(c.effect.action);
    if (condition === undefined || action === undefined) continue;
    const property = c.condition.property;
    // the value the element holds: its own, else the property's initial value (a coupling reads what the page shows)
    const own = property === null ? undefined : (storedValue(node, property, rules) ?? INITIAL_VALUES[property]);
    const inherited = property === null || parent === null ? undefined : (storedValue(parent, property, rules) ?? INITIAL_VALUES[property]);
    if (!condition.holds(own, inherited, c.condition.values)) continue;
    action.apply(out, c.trigger.property, c.effect, scene);
  }
  return { own: out, parent: scene.parent };
}

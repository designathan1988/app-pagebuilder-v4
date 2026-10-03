// What an element or a class holds for a property at the base breakpoint and state (spec breakpoint-overrides): the
// readers every style module asks before it writes (style/set.ts, couplings, recipes, tracks, structure/duplicate).
// They read the document only, so the writers and the rules they consult can all import them (plan I.8: no cycle).
import type { DocNode, StoredValue, Styles, StructuredLayer } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';

// The value a node holds for a property at the base breakpoint and state, or undefined when it sets none there.
export function storedValue(node: DocNode, property: string, rules: ModelRules): string | undefined {
  const value = heldAt(node, property, rules);
  return typeof value === 'string' ? value : undefined;
}

// The layers of a structured value the node holds for a property at the base breakpoint and state (a shadow's), in
// order; none while it holds none.
export function storedLayers(node: DocNode, property: string, rules: ModelRules): readonly StructuredLayer[] {
  const value = heldAt(node, property, rules);
  return Array.isArray(value) ? value : NO_LAYERS;
}
// the same list every time a node holds no layers (a reader that compares what it read sees no change)
const NO_LAYERS: readonly StructuredLayer[] = Object.freeze([]);

// the value a set of styles (a class's) holds for a property at the base breakpoint and state, if it is one value
export function storedStyleValue(styles: Styles, property: string, rules: ModelRules): string | undefined {
  const value = heldIn(styles, property, rules);
  return typeof value === 'string' ? value : undefined;
}

export function heldAt(node: DocNode, property: string, rules: ModelRules): StoredValue | undefined {
  return heldIn(node.styles, property, rules);
}

function heldIn(styles: Styles, property: string, rules: ModelRules): StoredValue | undefined {
  const byState = styles[rules.base.breakpoint as keyof Styles];
  const declarations = byState?.[rules.base.state as keyof NonNullable<typeof byState>] as Readonly<Record<string, StoredValue>> | undefined;
  return declarations?.[property];
}

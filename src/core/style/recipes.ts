// Recipes (PRODUCT.md §5; properties.json recipes): a compatibility recipe is stored by its own id (line-clamp: 3)
// and written out as its declarations by the output (src/core/render/output.ts); style.set checks each of them
// (src/core/style/set.ts). What the recipe shares with the properties it declares is here: a write of one of those
// properties clears a recipe that says so (shared.otherWrite: clears-recipe; line-clamp's display and overflow),
// since the page would otherwise draw the recipe's value over it.
import type { DocNode } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { storedValue } from './stored.ts';

// The declarations a write of one element makes (property → CSS text, or null to take a property away), once the
// recipes it overrides are taken away.
export function clearedRecipes(node: DocNode, values: Readonly<Record<string, string | null>>, rules: ModelRules): Record<string, string | null> {
  const out: Record<string, string | null> = { ...values };
  for (const [id, recipe] of rules.recipeFacts) {
    if (id in values || recipe.shared?.otherWrite !== 'clears-recipe' || storedValue(node, id, rules) === undefined) continue;
    if (recipe.declarations.some((d) => d.property in values)) out[id] = null;
  }
  return out;
}

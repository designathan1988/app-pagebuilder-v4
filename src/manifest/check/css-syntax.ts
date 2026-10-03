// Every value a door offers or writes matches the official syntax; the browser syntax stands in only for its allowlist.
import { type CssAnalysis } from '../css.ts';
import { type Composite } from '../schema.ts';
import type { CheckContext } from './context.ts';
import type { valuesRules } from './values.ts';
import { supportedUnits } from './base.ts';

export function cssSyntaxRules(ctx: CheckContext, values: Pick<ReturnType<typeof valuesRules>, 'cssNameOf' | 'offeredGenerated'>) {
  const { p, report, css, doors, propertyById, compositeById, recipeById, generated, offeredKeywords, fallbackEntry } = ctx;
  const { cssNameOf, offeredGenerated } = values;
  // ---- css-syntax: every value a door offers or writes matches the official syntax (CSSTree's lexer)
  // ---- syntax-fallback: the browser syntax stands in only for the values of the allowlist
  const fallbackUsed = new Set<number>();
  const implementedOnly = new Set<string>();
  const recipeBrowserSyntax = new Set<string>();
  const syntax = (file: string, path: string, property: string, value: string, recipe: string | null = null): CssAnalysis | null => {
    const result = css.analyse(property, value);
    if (!result.ok) {
      report('css-syntax', file, path, `"${value}" is not a valid value of ${property}: ${result.reason}`);
      return null;
    }
    if (result.by === 'implemented') {
      const entry = fallbackEntry(property, value, recipe);
      if (entry >= 0) {
        fallbackUsed.add(entry);
        (recipe === null ? implementedOnly : recipeBrowserSyntax).add(`${property}: ${value}`);
      } else {
        report('syntax-fallback', file, path, `"${value}" of ${property} matches only the syntax browsers implement (CSSTree's MDN data): the official syntax ${css.match(property, value) === null ? 'reaches it only through a definition webref does not have' : 'rejects it'}; the fallback applies only to the values of the allowlist (syntaxFallbacks)`);
      }
    }
    return result;
  };
  for (const [name, where] of offeredGenerated) {
    const g = generated[name];
    if (!g) continue;
    const [file = '', ...rest] = where.split(' ');
    for (const keyword of offeredKeywords(name)) syntax(file, `${rest.join(' ')} (generated keywords of ${name})`, name, keyword);
    for (const unit of supportedUnits(p.css, p.compat, name)) syntax(file, `${rest.join(' ')} (generated units of ${name})`, name, `1${unit}`);
  }
  // every value the manifest writes or offers, with the CSS property it is a value of
  const written: { file: string; path: string; property: string; value: string; composite: Composite | null }[] = [];
  p.properties.properties.forEach((prop, i) => prop.subsets.forEach((s, si) => (s.values ?? []).forEach((value, vi) => written.push({ file: 'properties.json', path: `properties[${i}].subsets[${si}].values[${vi}]`, property: prop.id, value, composite: null }))));
  p.properties.composites.forEach((c, i) => {
    c.subsets.forEach((s, si) => {
      if (c.shorthand === null) report('value-set', 'properties.json', `composites[${i}].subsets[${si}]`, 'a composite that stands for no CSS property cannot declare a subset of its values');
      else (s.values ?? []).forEach((value, vi) => written.push({ file: 'properties.json', path: `composites[${i}].subsets[${si}].values[${vi}]`, property: c.shorthand ?? '', value, composite: c }));
    });
  });
  for (const { file, path, door } of doors) {
    const property = door.args.property;
    const value = door.args.value;
    if (typeof property === 'string' && typeof value === 'string') {
      const name = cssNameOf(property);
      if (name !== null) written.push({ file, path: `${path}.args.value`, property: name, value, composite: compositeById.get(property) ?? null });
    }
  }
  for (const [i, e] of p.elements.elements.entries()) {
    for (const [name, value] of Object.entries(e.defaultStyles)) if (generated[name]) written.push({ file: 'elements.json', path: `elements[${i}].defaultStyles.${name}`, property: name, value, composite: null });
  }
  for (const [i, w] of p.elements.wrappers.entries()) {
    for (const [name, value] of Object.entries(w.styles)) if (generated[name]) written.push({ file: 'elements.json', path: `wrappers[${i}].styles.${name}`, property: name, value, composite: null });
  }
  for (const [i, c] of p.properties.couplings.entries()) {
    if (c.effect.value !== null && generated[c.effect.property]) written.push({ file: 'properties.json', path: `couplings[${i}].effect.value`, property: c.effect.property, value: c.effect.value, composite: null });
  }
  const analysed = new Map<string, CssAnalysis>();
  for (const w of written) {
    const result = syntax(w.file, w.path, w.property, w.value);
    if (result) analysed.set(`${w.file} ${w.path}`, result);
  }
  for (const [i, c] of p.properties.couplings.entries()) {
    const path = `couplings[${i}]`;
    if (generated[c.trigger.property]) (c.trigger.values ?? []).forEach((v, vi) => syntax('properties.json', `${path}.trigger.values[${vi}]`, c.trigger.property, v));
    if (c.condition.property !== null && generated[c.condition.property]) c.condition.values.forEach((v, vi) => syntax('properties.json', `${path}.condition.values[${vi}]`, c.condition.property ?? '', v));
  }
  for (const [ri, r] of p.properties.recipes.entries()) {
    for (const [di, d] of r.declarations.entries()) {
      if (d.value === null || !generated[d.property]) continue;
      const result = syntax('properties.json', `recipes[${ri}].declarations[${di}].value`, d.property, d.value, r.id);
      if (result) analysed.set(`recipe ${r.id} ${di}`, result);
    }
  }
  for (const [i, f] of p.properties.syntaxFallbacks.entries()) {
    const path = `syntaxFallbacks[${i}]`;
    const bad = (message: string) => report('syntax-fallback', 'properties.json', path, message);
    if (f.recipe === null) {
      if (!propertyById.has(f.property)) bad(`${f.property} is not an edited property`);
    } else {
      const r = recipeById.get(f.recipe);
      if (!r) bad(`unknown recipe "${f.recipe}"`);
      else if (f.values === null) bad(`an entry for recipe ${r.id} names its values`);
      else for (const v of f.values) if (!r.declarations.some((d) => d.property === f.property && d.value === v)) bad(`recipe ${r.id} declares no ${f.property}: ${v}`);
    }
    if (!fallbackUsed.has(i)) bad(`no value of ${f.property} needs the browser syntax${f.values !== null ? ` (${f.values.join(', ')})` : ''}: remove it from the allowlist`);
  }
  return { analysed, written, implementedOnly, recipeBrowserSyntax };
}

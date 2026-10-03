// The values a door offers: the generated list of its property, and every value the browser data allows in All
// properties.
import { type Subset } from '../schema.ts';
import type { CheckContext } from './context.ts';
import type { OfferData } from './base.ts';
import { excludedUnitsOf, LIST_CONTROLS, generatedOffer, supportedUnits, generatedUnits } from './base.ts';

export function valuesRules(ctx: CheckContext) {
  const { p, report, doors, propertyById, compositeById, recipeById, generated, offeredKeywords } = ctx;
  // ---- value-set: a door offers the generated list of its property, composite or recipe, or a declared subset of it
  const cssNameOf = (target: string): string | null => {
    if (propertyById.has(target)) return target;
    return compositeById.get(target)?.shorthand ?? null;
  };
  const subsetsOf = (target: string): Subset[] => propertyById.get(target)?.subsets ?? compositeById.get(target)?.subsets ?? [];
  const controlOf = (target: string): string | undefined => propertyById.get(target)?.control ?? compositeById.get(target)?.control ?? recipeById.get(target)?.control;
  const KEYWORD_CONTROLS = new Set(['keyword-menu', 'keyword-buttons', 'font-menu']);
  const offerData: OfferData = { properties: p.properties, css: p.css, compat: p.compat, excludedUnits: excludedUnitsOf(p.exclusions) };
  const offeredGenerated = new Map<string, string>(); // css name → first door that offers its generated list
  let keywordsLeftOut = 0;
  let unitsLeftOut = 0;
  for (const { file, path, command, door, ref: doorRef } of doors) {
    const offers = door.adapter.offers;
    // a button that writes one fixed value (args.value) offers no list
    if (door.kind === 'inspector-field' && (door.property !== null || door.composite !== null || door.recipe !== null) && typeof door.args.value !== 'string') {
      const target = door.property ?? door.composite ?? door.recipe ?? '';
      const control = controlOf(target);
      if (control !== undefined && LIST_CONTROLS.has(control) && (offers === null || offers.property !== target)) {
        report('value-set', file, `${path}.adapter.offers`, `${doorRef} edits ${target}, a ${control}, but declares no list of values for it`);
      }
    }
    if (!offers) continue;
    const recipe = recipeById.get(offers.property);
    if (!recipe && !propertyById.has(offers.property) && !compositeById.has(offers.property)) continue;
    const control = controlOf(offers.property);
    if (offers.list === 'generated') {
      const list = generatedOffer(offerData, offers.property) ?? [];
      if (list.length === 0 && control !== undefined && KEYWORD_CONTROLS.has(control)) {
        report('value-set', file, `${path}.adapter.offers.list`, `${doorRef} is a ${control} but none of the generated keywords of ${offers.property} is supported by Chrome, Firefox and Safari: declare a subset`);
      }
      if (recipe) continue;
      const name = cssNameOf(offers.property);
      if (name === null) {
        report('value-set', file, `${path}.adapter.offers.list`, `${command.id}#${door.id} offers the generated list of ${offers.property}, which stands for no CSS property`);
        continue;
      }
      if (!offeredGenerated.has(name)) {
        offeredGenerated.set(name, `${file} ${path}`);
        keywordsLeftOut += (generated[name]?.keywords.length ?? 0) - offeredKeywords(name).length;
        unitsLeftOut += (generated[name]?.units.length ?? 0) - supportedUnits(p.css, p.compat, name).length;
      }
    } else if (recipe) {
      report('value-set', file, `${path}.adapter.offers.list`, `${doorRef} offers "${offers.list}", but a recipe declares no subsets: it offers its generated list`);
    } else if (!subsetsOf(offers.property).some((s) => s.id === offers.list)) {
      report('value-set', file, `${path}.adapter.offers.list`, `${doorRef} offers "${offers.list}", which is neither "generated" nor a subset declared on ${offers.property}`);
    }
  }

  // ---- all-properties: in All properties an inspector field offers every value the browser data allows (the
  // generated list: all four flex directions, every text-align value, space-between, space-around and
  // space-evenly) plus its declared presets (font stacks, named weights). Essentials only may offer fewer
  // values, never one All properties lacks. A declared subset stands alone only in the quick panel.
  const declaredList = (target: string, id: string) => subsetsOf(target).find((s) => s.id === id);
  for (const { file, path, door, ref: doorRef } of doors) {
    const offers = door.adapter.offers;
    if (!offers) continue;
    const inspector = door.kind === 'inspector-field';
    if (offers.list !== 'generated' && door.kind !== 'quick-panel') {
      report('all-properties', file, `${path}.adapter.offers.list`, inspector
        ? `${doorRef} offers the subset "${offers.list}" in All properties, which offers every value the browser data allows: offer "generated", name the presets in offers.presets and the shorter list in offers.essentials`
        : `${doorRef} is a ${door.kind} door and offers the subset "${offers.list}": a declared subset stands alone only in the quick panel`);
    }
    for (const [field, id] of [['presets', offers.presets], ['essentials', offers.essentials]] as const) {
      if (id === null) continue;
      if (!inspector) report('all-properties', file, `${path}.adapter.offers.${field}`, `${doorRef} is a ${door.kind} door: only an inspector field has ${field === 'presets' ? 'All properties presets' : 'an Essentials only list'}`);
      else if (!declaredList(offers.property, id)) report('all-properties', file, `${path}.adapter.offers.${field}`, `${doorRef} names "${id}" as its ${field}, which is not a list declared on ${offers.property}`);
    }
    if (!inspector || offers.list !== 'generated' || offers.essentials === null) continue;
    const essentials = declaredList(offers.property, offers.essentials);
    if (!essentials) continue;
    const presets = offers.presets === null ? undefined : declaredList(offers.property, offers.presets);
    const lower = (xs: readonly string[]) => new Set(xs.map((x) => x.toLowerCase()));
    const allValues = lower([...(generatedOffer(offerData, offers.property) ?? []), ...(presets?.values ?? [])]);
    const allUnits = lower([...(generatedUnits(offerData, offers.property) ?? []), ...(presets?.units ?? [])]);
    const missing = [...(essentials.values ?? []).filter((v) => !allValues.has(v.toLowerCase())), ...(essentials.units ?? []).filter((u) => !allUnits.has(u.toLowerCase())).map((u) => `the unit ${u}`)];
    if (missing.length > 0) {
      report('all-properties', file, `${path}.adapter.offers.essentials`, `${doorRef} offers ${missing.map((v) => `"${v}"`).join(', ')} in Essentials only, which All properties lacks (the generated list of ${offers.property}${presets ? ` and the presets "${presets.id}"` : ', no presets'}): Essentials only is a subset of All properties`);
    }
  }
  return { cssNameOf, offeredGenerated, offerData, subsetsOf, keywordsLeftOut, unitsLeftOut };
}

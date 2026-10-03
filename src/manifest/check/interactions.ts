// One binding per chord and one meaning per modifier, the zoom a scenario starts at, the exclusions' evidence.
import { normaliseChord } from '../chord.ts';
import { BROWSERS } from '../schema.ts';
import type { CheckContext } from './context.ts';
import type { valuesRules } from './values.ts';

export function interactionsRules(ctx: CheckContext, values: Pick<ReturnType<typeof valuesRules>, 'offerData'>) {
  const { p, report, features, doors, propertyById, compositeById, compat, excludedKeyword, input } = ctx;
  const { offerData } = values;
  // ---- chord-conflict: one chord, one binding, per context
  const bound = new Map<string, string>();
  for (const { file, path, command, door } of doors) {
    if (door.kind !== 'shortcut') continue;
    const chord = normaliseChord(door.chord);
    if (chord === null) {
      report('schema', file, `${path}.chord`, `"${door.chord}" is not a chord (modifiers Ctrl, Alt, Shift, Meta, then one key)`);
      continue;
    }
    const slot = `${door.context}|${chord}`;
    const first = bound.get(slot);
    if (first !== undefined) report('chord-conflict', file, `${path}.chord`, `chord ${chord} is bound twice in context "${door.context}": ${first} and ${command.id}#${door.id}`);
    else bound.set(slot, `${command.id}#${door.id}`);
  }

  // ---- modifier-conflict: one meaning per modifier in each gesture
  for (const [gi, g] of p.interactions.gestures.entries()) {
    const meanings = new Map<string, string>();
    for (const [mi, m] of g.modifiers.entries()) {
      const first = meanings.get(m.key);
      if (first !== undefined && first !== m.meaning) {
        report('modifier-conflict', 'interactions.json', `gestures[${gi}].modifiers[${mi}]`, `${m.key} means both "${first}" and "${m.meaning}" in gesture "${g.id}"`);
      } else meanings.set(m.key, m.meaning);
    }
  }

  // ---- zoom: a scenario starts at a canvas zoom level only once the zoom doors exist (zoom-keyboard-buttons built:
  // every command of it registered); before that it starts with the canvas as it opens ("fit").
  const zoomFeature = features.find((f) => f.feature.id === 'zoom-keyboard-buttons');
  const registeredHandlers = new Set(input.registered.handler);
  const zoomBuilt = zoomFeature !== undefined && zoomFeature.feature.commands.every((c) => registeredHandlers.has(c));
  for (const f of features) {
    f.feature.scenarios.forEach((s, si) => {
      if (s.setup.zoom === 'fit' || zoomBuilt) return;
      report('zoom', f.file, `${f.path}.scenarios[${si}].setup.zoom`, `scenario ${s.id} starts at zoom ${s.setup.zoom}, but zoom-keyboard-buttons is not built: start with the canvas as it opens ("fit")`);
    });
  }

  // ---- exclusion: every excluded keyword names its evidence, is a keyword of its property, is marked unsupported
  // by npm run gen, and no declared list (a subset: presets, Essentials only, a quick panel list) offers it
  p.exclusions.exclusions.forEach((x, i) => {
    const at = `exclusions[${i}]`;
    const what = x.keyword ?? `the unit ${x.unit ?? ''}`;
    if (x.evidence.source.trim() === '' || x.evidence.note.trim() === '') report('exclusion', 'css-exclusions.json', `${at}.evidence`, `${x.property}: ${what} is excluded without evidence: name its source and what it shows`);
    if ((x.keyword === null) === (x.unit === null)) {
      report('exclusion', 'css-exclusions.json', at, `${x.property}: an exclusion names a keyword or a unit, not both and not neither`);
      return;
    }
    if (x.unit !== null) {
      const unit = x.unit.toLowerCase();
      const syntaxOf = propertyById.has(x.property) ? x.property : (compositeById.get(x.property)?.shorthand ?? x.property);
      if (!(p.css.properties[syntaxOf]?.units ?? []).some((u) => u.toLowerCase() === unit)) report('exclusion', 'css-exclusions.json', `${at}.unit`, `${x.unit} is not a unit of ${x.property} in css-properties.json`);
      return;
    }
    const keyword = (x.keyword ?? '').toLowerCase();
    const entry = compat[x.property]?.keywords[keyword];
    if (!(p.css.properties[x.property]?.keywords ?? []).some((k) => k.toLowerCase() === keyword)) {
      report('exclusion', 'css-exclusions.json', `${at}.keyword`, `${x.keyword ?? ''} is not a keyword of ${x.property} in css-properties.json`);
    } else if (entry === undefined || BROWSERS.some((b) => entry[b] !== false)) {
      report('exclusion', 'css-exclusions.json', at, `${x.property}: ${x.keyword ?? ''} is excluded but css-compat.json still gives it support: run npm run gen`);
    }
  });
  const declaredLists = [
    ...p.properties.properties.map((prop, i) => ({ id: prop.id, subsets: prop.subsets, path: `properties[${i}]` })),
    ...p.properties.composites.map((c, i) => ({ id: c.id, subsets: c.subsets, path: `composites[${i}]` })),
  ];
  for (const owner of declaredLists) {
    owner.subsets.forEach((subset, si) => {
      for (const value of subset.values ?? []) {
        for (const word of value.toLowerCase().split(/\s+/)) {
          if (excludedKeyword.has(`${owner.id}:${word}`)) report('exclusion', 'properties.json', `${owner.path}.subsets[${si}]`, `the list "${subset.id}" of ${owner.id} offers ${word}, which css-exclusions.json excludes: the browsers do not act on it`);
        }
      }
      for (const unit of subset.units ?? []) {
        if (offerData.excludedUnits.has(`${owner.id}:${unit.toLowerCase()}`)) report('exclusion', 'properties.json', `${owner.path}.subsets[${si}]`, `the list "${subset.id}" of ${owner.id} offers the unit ${unit}, which css-exclusions.json excludes: the browsers do not act on it`);
      }
    });
  }
}

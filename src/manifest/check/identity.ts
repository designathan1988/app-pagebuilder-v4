// Every id unique within its kind, and every reference naming something that exists.
import type { CheckContext } from './context.ts';

export function identityRules(ctx: CheckContext) {
  const {
    p,
    report,
    unique,
    features,
    featureIndex,
    commands,
    commandById,
    doorByRef,
    elementById,
    attributeById,
    propertyById,
    compositeById,
    generated,
    isShorthand,
  } = ctx;
  // ---- duplicate-id
  unique('feature', 'features/', features.map((f) => ({ id: f.feature.id, path: `${f.file} ${f.path}` })));
  unique('feature group', 'features/', p.featureFiles.map((f) => ({ id: f.data.group, path: f.file })));
  unique('command', 'commands/', commands.map((c) => ({ id: c.command.id, path: `${c.file} ${c.path}` })));
  for (const c of commands) {
    unique(`door of ${c.command.id}`, c.file, c.command.entryPoints.map((d, i) => ({ id: d.id, path: `${c.path}.entryPoints[${i}]` })));
  }
  unique('scenario', 'features/', features.flatMap((f) => f.feature.scenarios.map((s, i) => ({ id: s.id, path: `${f.file} ${f.path}.scenarios[${i}]` }))));
  unique('element', 'elements.json', p.elements.elements.map((e, i) => ({ id: e.id, path: `elements[${i}]` })));
  unique('attribute', 'elements.json', p.elements.attributes.map((a, i) => ({ id: a.id, path: `attributes[${i}]` })));
  unique('settings section', 'elements.json', p.elements.settingsSections.map((s, i) => ({ id: s.id, path: `settingsSections[${i}]` })));
  unique('palette group', 'elements.json', p.elements.palette.map((g, i) => ({ id: g.id, path: `palette[${i}]` })));
  unique('palette entry', 'elements.json', p.elements.palette.flatMap((g, gi) => g.entries.map((e, i) => ({ id: e.id, path: `palette[${gi}].entries[${i}]` }))));
  unique('property', 'properties.json', p.properties.properties.map((prop, i) => ({ id: prop.id, path: `properties[${i}]` })));
  unique('composite', 'properties.json', p.properties.composites.map((c, i) => ({ id: c.id, path: `composites[${i}]` })));
  unique('recipe', 'properties.json', p.properties.recipes.map((r, i) => ({ id: r.id, path: `recipes[${i}]` })));
  unique('structure', 'properties.json', p.properties.structures.map((s, i) => ({ id: s.id, path: `structures[${i}]` })));
  // a door's property argument names a property, a composite or a recipe: one namespace
  for (const [i, r] of p.properties.recipes.entries()) {
    if (propertyById.has(r.id) || compositeById.has(r.id)) report('duplicate-id', 'properties.json', `recipes[${i}].id`, `recipe id "${r.id}" is also the id of a property or composite`);
  }
  for (const [i, c] of p.properties.composites.entries()) {
    if (propertyById.has(c.id)) report('duplicate-id', 'properties.json', `composites[${i}].id`, `composite id "${c.id}" is also the id of a property`);
  }
  unique('coupling', 'properties.json', p.properties.couplings.map((c, i) => ({ id: c.id, path: `couplings[${i}]` })));
  for (const [i, prop] of p.properties.properties.entries()) unique(`subset of ${prop.id}`, 'properties.json', prop.subsets.map((s, si) => ({ id: s.id, path: `properties[${i}].subsets[${si}]` })));
  for (const [i, c] of p.properties.composites.entries()) unique(`subset of ${c.id}`, 'properties.json', c.subsets.map((s, si) => ({ id: s.id, path: `composites[${i}].subsets[${si}]` })));
  // a legacy alias and the property it names are one property
  for (const [i, prop] of p.properties.properties.entries()) {
    const alias = generated[prop.id]?.legacyAliasOf;
    if (alias && propertyById.has(alias)) report('duplicate-id', 'properties.json', `properties[${i}].id`, `${prop.id} is a legacy alias of ${alias}, which is also edited`);
  }
  unique('section', 'properties.json', p.properties.sections.map((s, i) => ({ id: s.id, path: `sections[${i}]` })));
  for (const [si, s] of p.properties.sections.entries()) {
    unique(`group of section ${s.id}`, 'properties.json', s.groups.map((g, i) => ({ id: g.id, path: `sections[${si}].groups[${i}]` })));
  }
  unique('breakpoint', 'properties.json', p.properties.breakpoints.map((b, i) => ({ id: b.id, path: `breakpoints[${i}]` })));
  if (p.properties.breakpoints.filter((b) => b.base).length !== 1 || p.properties.breakpoints[0]?.base !== true) {
    report('schema', 'properties.json', 'breakpoints', 'the breakpoints are listed in cascade order: exactly one is the base, and it is the first');
  }
  unique('check category', 'checks.json', p.checks.categories.map((k, i) => ({ id: k.id, path: `categories[${i}]` })));
  unique('state', 'properties.json', p.properties.states.map((s, i) => ({ id: s.id, path: `states[${i}]` })));
  unique('key context', 'interactions.json', p.interactions.keyContexts.map((k, i) => ({ id: k.id, path: `keyContexts[${i}]` })));
  unique('constant', 'interactions.json', p.interactions.constants.map((c, i) => ({ id: c.id, path: `constants[${i}]` })));
  unique('gesture', 'interactions.json', p.interactions.gestures.map((g, i) => ({ id: g.id, path: `gestures[${i}]` })));
  unique('viewport', 'environment.json', p.environment.viewports.map((v, i) => ({ id: v.id, path: `viewports[${i}]` })));
  unique('reference', 'references.json', p.references.references.map((r, i) => ({ id: `${r.kind}:${r.id}`, path: `references[${i}]` })));
  unique('consumer field', 'consumers.json', p.consumers.consumers.map((c, i) => ({ id: c.field, path: `consumers[${i}]` })));

  // ---- unknown-reference
  const ref = (ok: boolean, file: string, path: string, message: string) => {
    if (!ok) report('unknown-reference', file, path, message);
  };
  const themes = commandById.get('preferences.setTheme')?.args.theme?.values ?? [];
  ref(themes.includes(p.environment.theme.default), 'environment.json', 'theme.default', `default theme "${p.environment.theme.default}" is not a theme of preferences.setTheme (${themes.join(', ')})`);
  if (!p.environment.locales.available.includes(p.environment.locales.default)) {
    report('unknown-reference', 'environment.json', 'locales.default', `default locale "${p.environment.locales.default}" is not an available locale`);
  }
  for (const [i, e] of p.elements.elements.entries()) {
    for (const child of [e.naturalChild ?? []].flat()) ref(elementById.has(child), 'elements.json', `elements[${i}].naturalChild`, `unknown element type "${child}"`);
    if (e.tag === null && e.content !== 'markup') report('schema', 'elements.json', `elements[${i}].tag`, 'only an element whose content is "markup" may have no tag');
    for (const name of Object.keys(e.defaultStyles)) {
      if (!isShorthand(name)) ref(propertyById.has(name), 'elements.json', `elements[${i}].defaultStyles.${name}`, `"${name}" is not an edited property of properties.json`);
    }
  }
  for (const [i, a] of p.elements.attributes.entries()) {
    if (a.elements !== 'all') for (const id of a.elements) ref(elementById.has(id), 'elements.json', `attributes[${i}].elements`, `unknown element type "${id}"`);
    ref(commandById.has(a.command), 'elements.json', `attributes[${i}].command`, `unknown command "${a.command}"`);
  }
  for (const [i, s] of p.elements.settingsSections.entries()) {
    if (s.elements !== 'all') for (const id of s.elements) ref(elementById.has(id), 'elements.json', `settingsSections[${i}].elements`, `unknown element type "${id}"`);
    for (const id of s.attributes) ref(attributeById.has(id), 'elements.json', `settingsSections[${i}].attributes`, `unknown attribute "${id}"`);
  }
  for (const [gi, g] of p.elements.palette.entries()) {
    for (const [i, e] of g.entries.entries()) {
      ref(elementById.has(e.element), 'elements.json', `palette[${gi}].entries[${i}].element`, `unknown element type "${e.element}"`);
      ref(featureIndex.has(e.feature), 'elements.json', `palette[${gi}].entries[${i}].feature`, `unknown feature "${e.feature}"`);
    }
  }
  // a wrapper is an element that holds children, and its styles are edited properties
  for (const [i, w] of p.elements.wrappers.entries()) {
    const element = elementById.get(w.element);
    ref(element !== undefined, 'elements.json', `wrappers[${i}].element`, `unknown element type "${w.element}"`);
    if (element !== undefined && element.content !== 'children') report('schema', 'elements.json', `wrappers[${i}].element`, `a wrapper holds children, and "${w.element}" holds none`);
    for (const name of Object.keys(w.styles)) {
      if (!isShorthand(name)) ref(propertyById.has(name), 'elements.json', `wrappers[${i}].styles.${name}`, `"${name}" is not an edited property of properties.json`);
    }
  }
  unique('wrapper', 'elements.json', p.elements.wrappers.map((w, i) => ({ id: w.id, path: `wrappers[${i}]` })));
  const checkPlace = (file: string, path: string, item: { section: string; group: string }) => {
    const section = p.properties.sections.find((s) => s.id === item.section);
    ref(section !== undefined, file, `${path}.section`, `unknown section "${item.section}"`);
    if (section) ref(section.groups.some((g) => g.id === item.group), file, `${path}.group`, `section "${item.section}" has no group "${item.group}"`);
  };
  for (const [i, prop] of p.properties.properties.entries()) {
    checkPlace('properties.json', `properties[${i}]`, prop);
    ref(generated[prop.id] !== undefined, 'properties.json', `properties[${i}].id`, `"${prop.id}" is not a CSS property of the generated web data`);
    for (const [di, d] of prop.doors.entries()) ref(doorByRef.has(d), 'properties.json', `properties[${i}].doors[${di}]`, `unknown door "${d}"`);
  }
  // A pair row draws two properties or composites side by side in one section : each
  // field names an entry of that section, no entry stands in two rows, and the row says its id once.
  const rowEntries = new Map<string, { section: string }>([...p.properties.properties, ...p.properties.composites].map((e) => [e.id, e]));
  const inRow = new Map<string, string>();
  for (const [i, row] of p.properties.rows.entries()) {
    const where = `properties.json rows[${i}]`;
    ref(p.properties.sections.some((s) => s.id === row.section), 'properties.json', `${where}.section`, `unknown section "${row.section}"`);
    for (const [fi, field] of row.fields.entries()) {
      const at = `${where}.fields[${fi}]`;
      const entry = rowEntries.get(field.target);
      ref(entry !== undefined, 'properties.json', at, `"${field.target}" is no property or composite`);
      if (entry !== undefined) ref(entry.section === row.section, 'properties.json', at, `"${field.target}" is in the section "${entry.section}", not in "${row.section}"`);
      const stands = inRow.get(field.target);
      ref(stands === undefined, 'properties.json', at, `"${field.target}" already stands in ${stands ?? ''}`);
      inRow.set(field.target, at);
    }
  }
  unique('pair row', 'properties.json', p.properties.rows.map((r, i) => ({ id: r.id, path: `rows[${i}]` })));

  return { ref, checkPlace };
}

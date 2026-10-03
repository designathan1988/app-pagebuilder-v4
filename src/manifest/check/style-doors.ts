// The Style tab's doors: each has its section, a quick panel field its group, a concept row items of its own section.
import { styleSections, type StyleDoor } from '../style-places.ts';
import type { CheckContext } from './context.ts';
import type { identityRules } from './identity.ts';

export function styleDoorsRules(ctx: CheckContext, identity: Pick<ReturnType<typeof identityRules>, 'checkPlace' | 'ref'>) {
  const {
    p,
    report,
    unique,
    features,
    featureIndex,
    commands,
    commandById,
    doors,
    doorByRef,
    attributeById,
    paletteEntryIds,
    propertyById,
    compositeById,
    recipeById,
    isRecipeDoor,
    breakpointIds,
    stateIds,
    contextIds,
    gestureById,
    viewportIds,
    regionIds,
    isShorthand,
  } = ctx;
  const { checkPlace, ref } = identity;
  // ---- style-door-section: every door the Style tab draws has its section (src/manifest/style-places.ts): the one of
  // what its field edits, of the entry that lists it, or the one `controls` gives a control that edits no property —
  // never "the section of the field before it" by an accident of the placement order (the audit's S-013, S-023). A
  // control `controls` places is a Style door that has no other place, in a section that exists.
  const places = { properties: p.properties.properties, composites: p.properties.composites, recipes: p.properties.recipes, controls: [] };
  const derived = styleSections(places);
  const placed = styleSections({ ...places, controls: p.properties.controls });
  const sectionIds = new Set(p.properties.sections.map((s) => s.id));
  for (const { file, path, door, ref: doorRef } of doors) {
    if (typeof door.placement !== 'object' || door.placement.region !== 'inspector-style') continue;
    if (placed(doorRef, door as StyleDoor) === undefined) report('style-door-section', file, `${path}.placement`, `${doorRef} is drawn in the Style tab in no section: its field edits no property, composite or recipe, no entry of properties.json lists it, and properties.json controls does not place it`);
  }
  for (const [i, c] of p.properties.controls.entries()) {
    const at = `controls[${i}]`;
    const entry = doorByRef.get(c.door);
    if (entry === undefined) {
      report('style-door-section', 'properties.json', `${at}.door`, `unknown door "${c.door}"`);
      continue;
    }
    if (typeof entry.door.placement !== 'object' || entry.door.placement.region !== 'inspector-style') report('style-door-section', 'properties.json', `${at}.door`, `${c.door} is not drawn in the Style tab (inspector-style)`);
    if (c.section !== null && !sectionIds.has(c.section)) report('style-door-section', 'properties.json', `${at}.section`, `unknown section "${c.section}"`);
    const own = derived(c.door, entry.door as StyleDoor);
    if (own === c.section) report('style-door-section', 'properties.json', at, `${c.door} is placed in "${own ?? ''}" by what it edits or the entry that lists it: it needs no control entry`);
  }
  // ---- quick-panel-group: a quick panel field names a group of layout.json's quickPanelGroups, the panel's head none
  // (the audit's U-044: the groups were ranges of placement orders in the code); each group holds a field
  const quickGroups = new Set(p.layout.quickPanelGroups.map((g) => g.id));
  const quickHeld = new Set<string>();
  for (const { file, data } of p.commandFiles) {
    data.commands.forEach((c, ci) =>
      c.entryPoints.forEach((d, di) => {
        if (d.kind !== 'quick-panel' || d.group === null) return;
        if (!quickGroups.has(d.group)) report('quick-panel-group', file, `commands[${ci}].entryPoints[${di}].group`, `${c.id}#${d.id} names the quick panel group "${d.group}", which layout.json's quickPanelGroups does not list`);
        quickHeld.add(d.group);
      }),
    );
  }
  p.layout.quickPanelGroups.forEach((g, i) => {
    if (!quickHeld.has(g.id)) report('quick-panel-group', 'layout.json', `quickPanelGroups[${i}]`, `the quick panel group "${g.id}" holds no field`);
  });

  // ---- concept-row: a concept row (plan item 2.D) names items of its own section — a Style door or a pair row — each
  // standing in one row only; a row without a head is a summary row, which says what it is (its labelKey)
  const pairSections = new Map(p.properties.rows.map((r) => [r.id, r.section] as const));
  const standsIn = new Map<string, string>();
  for (const [i, row] of p.properties.conceptRows.entries()) {
    const where = `conceptRows[${i}]`;
    if (!sectionIds.has(row.section)) report('concept-row', 'properties.json', `${where}.section`, `unknown section "${row.section}"`);
    if (row.head.length === 0 && row.labelKey === null) report('concept-row', 'properties.json', `${where}.labelKey`, `the row ${row.id} has no head: it names itself with a labelKey`);
    for (const [part, items] of [['head', row.head], ['details', row.details]] as const) {
      for (const [j, item] of items.entries()) {
        const at = `${where}.${part}[${j}]`;
        let section: string | null | undefined;
        if (item.startsWith('pair:')) section = pairSections.get(item.slice('pair:'.length));
        else {
          const entry = doorByRef.get(item);
          section = entry === undefined || typeof entry.door.placement !== 'object' || entry.door.placement.region !== 'inspector-style' ? undefined : placed(item, entry.door as StyleDoor);
        }
        if (section === undefined) report('concept-row', 'properties.json', at, `"${item}" is no Style door and no pair row`);
        else if (section !== row.section) report('concept-row', 'properties.json', at, `"${item}" is drawn in "${section ?? 'no section'}", not in the row's section "${row.section}"`);
        const first = standsIn.get(item);
        if (first !== undefined) report('concept-row', 'properties.json', at, `"${item}" already stands in ${first}`);
        else standsIn.set(item, at);
      }
    }
  }
  unique('concept row', 'properties.json', p.properties.conceptRows.map((r, i) => ({ id: r.id, path: `conceptRows[${i}]` })));

  for (const [i, c] of p.properties.composites.entries()) {
    checkPlace('properties.json', `composites[${i}]`, c);
    for (const [di, d] of c.doors.entries()) ref(doorByRef.has(d), 'properties.json', `composites[${i}].doors[${di}]`, `unknown door "${d}"`);
  }
  for (const [i, r] of p.properties.recipes.entries()) {
    checkPlace('properties.json', `recipes[${i}]`, r);
    for (const [di, d] of r.doors.entries()) ref(doorByRef.has(d), 'properties.json', `recipes[${i}].doors[${di}]`, `unknown door "${d}"`);
  }
  for (const [i, k] of p.checks.categories.entries()) ref(featureIndex.has(k.feature), 'checks.json', `categories[${i}].feature`, `unknown feature "${k.feature}"`);
  for (const [i, fix] of p.checks.fixes.entries()) {
    ref(doorByRef.has(fix.door), 'checks.json', `fixes[${i}].door`, `unknown door "${fix.door}"`);
    if (fix.kind === 'insert') ref(paletteEntryIds.has(fix.entry), 'checks.json', `fixes[${i}].entry`, `unknown palette entry "${fix.entry}"`);
    if (fix.kind === 'reveal') ref(attributeById.has(fix.attribute), 'checks.json', `fixes[${i}].attribute`, `unknown attribute "${fix.attribute}"`);
  }
  for (const [i, k] of p.interactions.keyContexts.entries()) {
    if (k.inherits !== null) ref(contextIds.has(k.inherits), 'interactions.json', `keyContexts[${i}].inherits`, `unknown key context "${k.inherits}"`);
  }
  for (const c of commands) {
    ref(featureIndex.has(c.command.introducedBy), c.file, `${c.path}.introducedBy`, `unknown feature "${c.command.introducedBy}"`);
  }
  for (const { file, path, command, door } of doors) {
    ref(featureIndex.has(door.feature), file, `${path}.feature`, `unknown feature "${door.feature}"`);
    for (const [name, value] of Object.entries(door.args)) {
      const arg = command.args[name];
      if (!arg) {
        report('unknown-reference', file, `${path}.args.${name}`, `${command.id} has no argument "${name}"`);
        continue;
      }
      const text = typeof value === 'string' ? value : null;
      if (arg.type === 'enum') ref(text !== null && arg.values.includes(text), file, `${path}.args.${name}`, `"${String(value)}" is not one of ${arg.values.join(', ')}`);
      if (arg.type === 'palette-entry') ref(text !== null && paletteEntryIds.has(text), file, `${path}.args.${name}`, `unknown palette entry "${String(value)}"`);
      if (arg.type === 'property') ref(text !== null && (propertyById.has(text) || compositeById.has(text) || recipeById.has(text)), file, `${path}.args.${name}`, `unknown property, composite or recipe "${String(value)}"`);
      if (arg.type === 'attribute') ref(text !== null && attributeById.has(text), file, `${path}.args.${name}`, `unknown attribute "${String(value)}"`);
      if (arg.type === 'breakpoint') ref(text !== null && breakpointIds.has(text), file, `${path}.args.${name}`, `unknown breakpoint "${String(value)}"`);
      if (arg.type === 'state') ref(text !== null && stateIds.has(text), file, `${path}.args.${name}`, `unknown state "${String(value)}"`);
    }
    const gesture = 'gesture' in door && door.gesture !== null ? door.gesture : null;
    if (gesture !== null) ref(gestureById.has(gesture), file, `${path}.gesture`, `unknown gesture "${gesture}"`);
    const modifier = 'modifier' in door ? door.modifier : null;
    if (modifier !== null) {
      const declared = gesture !== null ? gestureById.get(gesture)?.modifiers.some((m) => m.key === modifier) : false;
      ref(declared === true, file, `${path}.modifier`, `modifier ${modifier} has no meaning declared in gesture "${gesture ?? 'none'}"`);
    }
    if (door.kind === 'shortcut') ref(contextIds.has(door.context), file, `${path}.context`, `unknown key context "${door.context}"`);
    if (door.kind === 'inspector-field') {
      const named = [door.property, door.composite, door.recipe, door.attribute].filter((x) => x !== null).length;
      if (named !== 1) report('schema', file, path, 'an inspector field names exactly one property, one composite, one recipe or one attribute');
      if (door.property !== null) ref(propertyById.has(door.property), file, `${path}.property`, `unknown property "${door.property}"`);
      if (door.composite !== null) ref(compositeById.has(door.composite), file, `${path}.composite`, `unknown composite "${door.composite}"`);
      if (door.recipe !== null) ref(recipeById.has(door.recipe), file, `${path}.recipe`, `unknown recipe "${door.recipe}"`);
      if (door.attribute !== null) {
        const attr = attributeById.get(door.attribute);
        ref(attr !== undefined, file, `${path}.attribute`, `unknown attribute "${door.attribute}"`);
        if (attr) ref(attr.command === command.id, file, `${path}.attribute`, `attribute "${attr.id}" is written by ${attr.command}, not by ${command.id}`);
      }
    }
    // a recipe door writes the recipe's declarations (rule recipe); a shorthand is reported by shorthand-write
    if (!isRecipeDoor({ file, path, command, door, ref: `${command.id}#${door.id}` })) {
      for (const name of door.adapter.writes) {
        if (!isShorthand(name)) ref(propertyById.has(name), file, `${path}.adapter.writes`, `"${name}" is not an edited property of properties.json`);
      }
    }
    const offers = door.adapter.offers;
    if (offers) ref(propertyById.has(offers.property) || compositeById.has(offers.property) || recipeById.has(offers.property), file, `${path}.adapter.offers.property`, `unknown property, composite or recipe "${offers.property}"`);
  }
  for (const f of features) {
    for (const [i, id] of f.feature.commands.entries()) ref(commandById.has(id), f.file, `${f.path}.commands[${i}]`, `unknown command "${id}"`);
    for (const [i, id] of f.feature.dependsOn.entries()) ref(featureIndex.has(id), f.file, `${f.path}.dependsOn[${i}]`, `unknown feature "${id}"`);
    for (const [si, s] of f.feature.scenarios.entries()) {
      const path = `${f.path}.scenarios[${si}].setup`;
      ref(contextIds.has(s.setup.context), f.file, `${path}.context`, `unknown key context "${s.setup.context}"`);
      ref(breakpointIds.has(s.setup.breakpoint), f.file, `${path}.breakpoint`, `unknown breakpoint "${s.setup.breakpoint}"`);
      ref(stateIds.has(s.setup.state), f.file, `${path}.state`, `unknown state "${s.setup.state}"`);
      ref(viewportIds.has(s.setup.viewport), f.file, `${path}.viewport`, `unknown viewport "${s.setup.viewport}"`);
      if (s.setup.zoom !== 'fit') ref(p.environment.zoomLevels.includes(s.setup.zoom), f.file, `${path}.zoom`, `zoom ${s.setup.zoom} is not one of the environment's zoom levels`);
      ref(p.environment.locales.available.includes(s.setup.locale), f.file, `${path}.locale`, `locale "${s.setup.locale}" is not available`);
      const editor = s.expect.editor;
      const at = `${f.path}.scenarios[${si}].expect.editor`;
      editor?.regions.forEach((g, gi) => {
        ref(regionIds.has(g.region), f.file, `${at}.regions[${gi}].region`, `unknown region "${g.region}" of layout.json`);
        if (g.reference !== null) ref(regionIds.has(g.reference), f.file, `${at}.regions[${gi}].reference`, `unknown region "${g.reference}" of layout.json`);
      });
      editor?.computed.forEach((c, ci) => ref(regionIds.has(c.region), f.file, `${at}.computed[${ci}].region`, `unknown region "${c.region}" of layout.json`));
      s.expect.hover?.shows.forEach((show, hi) => ref(regionIds.has(show.region), f.file, `${f.path}.scenarios[${si}].expect.hover.shows[${hi}].region`, `unknown region "${show.region}" of layout.json`));
    }
  }
}

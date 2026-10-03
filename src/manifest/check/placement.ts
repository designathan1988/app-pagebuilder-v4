// Where doors are drawn: regions, states, labels and terms, owners, icons, toggles and panels.
import { PAGE_REGIONS, glossarySchema, menuIdSchema, type Command, type DoorKind, type Glossary } from '../schema.ts';
import type { CheckContext } from './context.ts';
import type { cataloguesRules } from './catalogues.ts';
import type { valuesRules } from './values.ts';
import { schemaProblems, generatedOffer } from './base.ts';

export function placementRules(ctx: CheckContext, fromCatalogues: Pick<ReturnType<typeof cataloguesRules>, 'catalogues'>, values: Pick<ReturnType<typeof valuesRules>, 'offerData' | 'subsetsOf'>) {
  const { p, report, unique, commandById, doors, doorByRef, compositeById, structureOf, input, problems } = ctx;
  const { catalogues } = fromCatalogues;
  const { offerData, subsetsOf } = values;
  // ---- placement: every door with a control of its own is drawn in a region of PRODUCT.md §5.3 (layout.json)
  const regionById = new Map(p.layout.regions.map((r) => [r.id, r]));
  unique('region', 'layout.json', p.layout.regions.map((r, i) => ({ id: r.id, path: `regions[${i}]` })));
  unique('menu', 'layout.json', p.layout.menus.map((m, i) => ({ id: m.id, path: `menus[${i}]` })));
  const menuAnchors = new Map(p.layout.menus.map((m) => [m.id, m.anchors]));
  for (const menu of menuIdSchema.options) {
    if (!menuAnchors.has(menu)) report('placement', 'layout.json', 'menus', `menu "${menu}" has no anchor: name the region whose button opens it`);
    if (!regionById.has(`menu:${menu}`)) report('placement', 'layout.json', 'regions', `menu "${menu}" has no region "menu:${menu}" for its items`);
  }
  for (const [mi, m] of p.layout.menus.entries()) {
    for (const [ai, a] of m.anchors.entries()) {
      if (!regionById.has(a.region)) report('placement', 'layout.json', `menus[${mi}].anchors[${ai}].region`, `unknown region "${a.region}"`);
    }
  }
  // doors that are a key or a pointer gesture have no control to place
  const CONTROLLESS: readonly DoorKind[] = ['shortcut', 'canvas-drag', 'canvas-click', 'canvas-wheel', 'canvas-handle', 'layers-drag', 'panel-drag'];
  const doorsByRegion: Record<string, number> = {};
  for (const { file, path, door, ref: doorRef } of doors) {
    const placement = door.placement;
    if (CONTROLLESS.includes(door.kind)) {
      if (placement !== 'none') report('placement', file, `${path}.placement`, `${doorRef} is a ${door.kind} door: it has no control, so its placement is "none"`);
      continue;
    }
    if (placement === 'unplaced' || placement === 'none') {
      report('placement', file, `${path}.placement`, `${doorRef} is ${placement === 'none' ? 'placed "none"' : 'still unplaced'}: the interface contract (docs/PRODUCT.md §5.3) gives every ${door.kind} door a region and an order`);
      continue;
    }
    doorsByRegion[placement.region] = (doorsByRegion[placement.region] ?? 0) + 1;
    if (!regionById.has(placement.region)) {
      report('placement', file, `${path}.placement.region`, `${doorRef} is placed in the unknown region "${placement.region}" (manifest/layout.json lists the regions)`);
      continue;
    }
    const expected =
      door.kind === 'menu' ? `menu:${door.menu}` : door.kind === 'context-menu' ? 'context-menu' : door.kind === 'command-bar' ? 'command-palette' : door.kind === 'quick-panel' ? 'quick-panel' : null;
    if (expected !== null && placement.region !== expected) report('placement', file, `${path}.placement.region`, `${doorRef} is a ${door.kind} door, drawn in "${expected}", not in "${placement.region}"`);
    if (door.kind === 'inspector-field' && !placement.region.startsWith('inspector-')) report('placement', file, `${path}.placement.region`, `${doorRef} is an inspector field, drawn in an inspector region, not in "${placement.region}"`);
  }
  // one control per position: two doors, or a door and a menu button, never share a region's order
  const slots = new Map<string, string>();
  const claim = (region: string, order: number, who: string, file: string, path: string) => {
    const slot = `${region}@${order}`;
    const first = slots.get(slot);
    if (first !== undefined) report('placement', file, path, `${who} takes order ${order} of region "${region}", already taken by ${first}`);
    else slots.set(slot, who);
  };
  for (const { file, path, door, ref: doorRef } of doors) {
    if (typeof door.placement === 'object') claim(door.placement.region, door.placement.order, doorRef, file, `${path}.placement.order`);
  }
  for (const [mi, m] of p.layout.menus.entries()) {
    for (const [ai, a] of m.anchors.entries()) claim(a.region, a.order, `the button of menu "${m.id}"`, 'layout.json', `menus[${mi}].anchors[${ai}].order`);
  }
  // one name per item of a menu: two items of one menu (or of the context menu) never read the same (the audit's zoom
  // menu drew "100%" three times)
  const menuLabels = new Map<string, string>();
  for (const { file, path, door, ref: doorRef } of doors) {
    if ((door.kind !== 'menu' && door.kind !== 'context-menu') || typeof door.placement !== 'object') continue;
    const label = `${door.placement.region}|${door.labelKey}`;
    const first = menuLabels.get(label);
    if (first !== undefined) report('placement', file, `${path}.labelKey`, `${doorRef} reads "${door.labelKey}" in region "${door.placement.region}", as ${first} does: each item of a menu has its own name`);
    else menuLabels.set(label, doorRef);
  }

  // ---- state-placement: a state belongs to the element's class selector, never to the page, so no
  // control that chooses a state is drawn on the canvas frame or the canvas toolbar
  const pageRegions: readonly string[] = PAGE_REGIONS;
  const choosesState = (command: Command) => Object.values(command.args).some((a) => a.type === 'state');
  const stateMenus = new Set<string>();
  for (const { file, path, command, door, ref: doorRef } of doors) {
    if (!choosesState(command)) continue;
    if (door.kind === 'menu') stateMenus.add(door.menu);
    const placement = door.placement;
    if (typeof placement === 'object' && pageRegions.includes(placement.region)) {
      report('state-placement', file, `${path}.placement.region`, `${doorRef} chooses a style state but is drawn in "${placement.region}": a state belongs to the element's class, so it is chosen only in the inspector's selector bar`);
    }
  }
  for (const [mi, m] of p.layout.menus.entries()) {
    if (!stateMenus.has(m.id)) continue;
    for (const [ai, a] of m.anchors.entries()) {
      if (pageRegions.includes(a.region)) report('state-placement', 'layout.json', `menus[${mi}].anchors[${ai}].region`, `menu "${m.id}" chooses a style state but opens from "${a.region}": a state is chosen only in the inspector's selector bar`);
    }
  }

  // ---- label-term: one label names one CSS property in each language, and each glossary term is the
  // label of its property. A label names a property when it labels an edited property, a composite (its
  // shorthand) or a recipe, or a field that edits one of them as a whole under a label of its own (not
  // a control of a structured value, which adds, removes or edits its layers and fields, not a button that
  // writes one fixed value, not a field that shows its property's label and carries only its command's label).
  const glossaryParse = glossarySchema.safeParse(input.glossary);
  const glossary: Glossary | null = glossaryParse.success ? glossaryParse.data : null;
  if (!glossaryParse.success) problems.push(...schemaProblems('i18n/glossary', glossaryParse.error));
  const namedBy: { key: string; property: string; where: string }[] = [];
  p.properties.properties.forEach((prop, i) => namedBy.push({ key: prop.labelKey, property: prop.id, where: `properties.json properties[${i}]` }));
  p.properties.composites.forEach((c, i) => {
    if (c.shorthand !== null) namedBy.push({ key: c.labelKey, property: c.shorthand, where: `properties.json composites[${i}]` });
  });
  p.properties.recipes.forEach((r, i) => namedBy.push({ key: r.labelKey, property: r.id, where: `properties.json recipes[${i}]` }));
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  for (const { file, path, command, door } of doors) {
    if (door.kind !== 'inspector-field' && door.kind !== 'quick-panel') continue;
    if (door.adapter.fields.length > 0 || 'value' in door.args || door.labelKey === command.labelKey) continue;
    if (door.kind === 'inspector-field' && door.property !== null && structureOf(door.property) !== undefined) continue;
    let named: string[] = [];
    if (door.kind === 'inspector-field') {
      if (door.property !== null) named = [door.property];
      else if (door.composite !== null) named = [compositeById.get(door.composite)?.shorthand ?? ''].filter((x) => x !== '');
      else if (door.recipe !== null) named = [door.recipe];
    } else {
      const writes = door.adapter.writes;
      const composite = p.properties.composites.find((c) => c.shorthand !== null && sameSet(c.longhands, writes));
      const recipe = p.properties.recipes.find((r) => sameSet(r.declarations.map((d) => d.property), writes));
      named = writes.length === 1 ? [...writes] : composite?.shorthand ? [composite.shorthand] : recipe ? [recipe.id] : [...writes];
    }
    for (const property of named) namedBy.push({ key: door.labelKey, property, where: `${file} ${path}` });
  }
  for (const [locale, catalogue] of catalogues) {
    const byLabel = new Map<string, Map<string, string>>();
    for (const n of namedBy) {
      const text = catalogue[n.key];
      if (typeof text !== 'string' || text.trim() === '') continue;
      const label = text.trim().toLowerCase();
      const properties = byLabel.get(label) ?? new Map<string, string>();
      if (!properties.has(n.property)) properties.set(n.property, `${n.key} (${n.where})`);
      byLabel.set(label, properties);
    }
    for (const [label, properties] of byLabel) {
      if (properties.size < 2) continue;
      const list = [...properties].map(([property, from]) => `${property} by ${from}`).join('; ');
      report('label-term', `i18n/${locale}`, label, `the label "${label}" names ${properties.size} CSS properties: ${list}. One term per concept: give each property its own label`);
    }
  }
  if (glossary !== null) {
    unique('glossary concept', 'i18n/glossary', glossary.concepts.map((c, i) => ({ id: c.id, path: `concepts[${i}]` })));
    for (const [i, concept] of glossary.concepts.entries()) {
      const labels = [...new Set(namedBy.filter((n) => n.property === concept.property).map((n) => n.key))];
      if (labels.length === 0) {
        report('label-term', 'i18n/glossary', `concepts[${i}].property`, `concept "${concept.id}" names ${concept.property}, which no field labels`);
        continue;
      }
      for (const [locale, catalogue] of catalogues) {
        const term = concept.terms[locale as keyof typeof concept.terms];
        for (const key of labels) {
          const text = catalogue[key];
          if (typeof text === 'string' && text.trim() !== term) report('label-term', `i18n/${locale}`, key, `${key} labels ${concept.property} "${text}", but the glossary term of "${concept.id}" in ${locale} is "${term}"`);
        }
      }
    }
  }

  // ---- owner: the module a command names is the module that registers it (tools/inventory/check.ts, which reads the
  // source: a table written by hand could not be trusted to stay true, and the inventory derives the answer instead)

  // ---- icon-name: every icon the manifest names is an icon of the editor's one library (Lucide,
  // manifest/generated/icons.json): door icons, menu buttons, the layout's glyphs, element icons, keyword icons
  const library = new Set(p.icons.icons);
  const iconName = (icon: string | null, file: string, path: string, what: string) => {
    if (icon !== null && !library.has(icon)) report('icon-name', file, path, `${what} names the icon "${icon}", which the icon library (Lucide ${p.icons.$generated.from['lucide-static'] ?? ''}) does not have`);
  };
  for (const { file, path, door, ref: doorRef } of doors) iconName(door.icon, file, `${path}.icon`, doorRef);
  p.layout.menus.forEach((m, mi) => m.anchors.forEach((a, ai) => iconName(a.icon, 'layout.json', `menus[${mi}].anchors[${ai}].icon`, `the button of menu "${m.id}" in ${a.region}`)));
  for (const [glyph, icon] of Object.entries(p.layout.glyphs)) iconName(icon, 'layout.json', `glyphs.${glyph}`, `the ${glyph} glyph`);
  for (const [panel, data] of Object.entries(p.layout.panels)) iconName(data.icon, 'layout.json', `panels.${panel}.icon`, `the ${panel} panel`);
  p.elements.elements.forEach((e, i) => iconName(e.icon, 'elements.json', `elements[${i}].icon`, `element ${e.id}`));
  p.properties.properties.forEach((prop, i) => {
    for (const [keyword, icon] of Object.entries(prop.icons)) iconName(icon, 'properties.json', `properties[${i}].icons.${keyword}`, `${prop.id}: ${keyword}`);
  });

  // ---- icon-required: a toolbar door, an icon button and a menu button drawn as an icon button name their icon,
  // so the shell never picks one; a disclosure's icon is the layout's glyph and a key or a pointer gesture has no
  // control, so neither names one; every panel has its icon; a keyword-buttons control drawn with icons has one for
  // every keyword its doors offer
  for (const { file, path, door, ref: doorRef } of doors) {
    const drawnAs = door.kind === 'toolbar' || door.kind === 'panel-control' ? door.drawnAs : null;
    if (CONTROLLESS.includes(door.kind) || drawnAs === 'disclosure') {
      if (door.icon !== null) report('icon-required', file, `${path}.icon`, drawnAs === 'disclosure' ? `${doorRef} is a disclosure: its icon is the layout's expanded or collapsed glyph, so it names none` : `${doorRef} is a ${door.kind} door: it has no control, so no icon`);
      continue;
    }
    if (door.icon !== null) continue;
    if (door.kind === 'toolbar') report('icon-required', file, `${path}.icon`, `${doorRef} is a toolbar door without an icon: every toolbar door names its icon`);
    else if (drawnAs === 'icon-button') report('icon-required', file, `${path}.icon`, `${doorRef} is drawn as an icon button but names no icon`);
  }

  // ---- pressed: an on/off switch (drawn as a toggle) always says whether it is on; only a toggle, an icon button or a
  // button can say it (a segment and a tab say their state by being drawn so, a field or an item never does); and the
  // doors of one command with the same arguments that can say it agree, since they stand for the same state
  const PRESSABLE: readonly string[] = ['toggle', 'icon-button', 'button'];
  const pressedBy = new Map<string, { pressed: boolean; ref: string }>();
  for (const { file, path, door, ref: doorRef, command } of doors) {
    if (door.kind !== 'toolbar' && door.kind !== 'panel-control') continue;
    if (door.drawnAs === 'toggle' && !door.pressed) report('pressed', file, `${path}.pressed`, `${doorRef} is an on/off switch (drawn as a toggle): it says whether it is on, so pressed is true`);
    if (door.pressed && !PRESSABLE.includes(door.drawnAs)) report('pressed', file, `${path}.pressed`, `${doorRef} is drawn as a ${door.drawnAs}: only a toggle, an icon button or a button says pressed`);
    if (!PRESSABLE.includes(door.drawnAs)) continue;
    const key = `${command.id} ${JSON.stringify(door.args)}`;
    const other = pressedBy.get(key);
    if (other === undefined) pressedBy.set(key, { pressed: door.pressed, ref: doorRef });
    else if (other.pressed !== door.pressed) report('pressed', file, `${path}.pressed`, `${doorRef} says pressed ${door.pressed} and ${other.ref} says ${other.pressed}: doors of one command with the same arguments stand for the same state`);
  }

  // ---- panel: layout.json declares every panel of workspace.setPanelOpen and nothing else, with its place; the
  // sidebar shows exactly one view at the first start; a section names the sidebar view it belongs to, and only a
  // section does
  const panelArg = commandById.get('workspace.setPanelOpen')?.args.panel?.values ?? [];
  const panels = p.layout.panels;
  for (const panel of panelArg) if (!(panel in panels)) report('panel', 'layout.json', 'panels', `the ${panel} panel of workspace.setPanelOpen is not declared: give it its icon, name, place and first state`);
  for (const [panel, data] of Object.entries(panels)) {
    if (!panelArg.includes(panel)) report('panel', 'layout.json', `panels.${panel}`, `"${panel}" is not a panel of workspace.setPanelOpen`);
    if (data.place === 'section') {
      // a section belongs to one sidebar view, or to none: null is the stack under every sidebar view (panel-resize)
      if (data.in !== null && panels[data.in]?.place !== 'sidebar') report('panel', 'layout.json', `panels.${panel}.in`, `${panel} is a section: "in" names the sidebar view it belongs to, or is null for the stack under every view`);
    } else if (data.in !== null) report('panel', 'layout.json', `panels.${panel}.in`, `${panel} is not a section, so it belongs to no sidebar view ("in" is null)`);
  }
  const firstViews = Object.entries(panels).filter(([, data]) => data.place === 'sidebar' && data.open).map(([panel]) => panel);
  if (firstViews.length !== 1) report('panel', 'layout.json', 'panels', `the sidebar shows one view at the first start, but ${firstViews.length === 0 ? 'no sidebar panel is' : `${firstViews.join(', ')} are`} open`);
  p.layout.menus.forEach((m, mi) =>
    m.anchors.forEach((a, ai) => {
      if (a.drawnAs === 'icon-button' && a.icon === null) report('icon-required', 'layout.json', `menus[${mi}].anchors[${ai}].icon`, `the button of menu "${m.id}" in ${a.region} is drawn as an icon button but names no icon`);
    }),
  );
  p.properties.properties.forEach((prop, i) => {
    const icons = Object.keys(prop.icons);
    if (icons.length === 0) return;
    if (prop.control !== 'keyword-buttons') report('icon-required', 'properties.json', `properties[${i}].icons`, `${prop.id} is a ${prop.control}: only keyword buttons show an icon for each keyword`);
    const offered = new Set<string>();
    for (const d of prop.doors) {
      const offers = doorByRef.get(d)?.door.adapter.offers;
      if (!offers || offers.property !== prop.id) continue;
      (offers.list === 'generated' ? (generatedOffer(offerData, prop.id) ?? []) : (subsetsOf(prop.id).find((s) => s.id === offers.list)?.values ?? [])).forEach((v) => offered.add(v));
      for (const id of [offers.presets, offers.essentials]) if (id !== null) (subsetsOf(prop.id).find((s) => s.id === id)?.values ?? []).forEach((v) => offered.add(v));
    }
    const missing = [...offered].filter((v) => !icons.includes(v));
    if (missing.length > 0) report('icon-required', 'properties.json', `properties[${i}].icons`, `${prop.id} shows its keywords as icons but has none for ${missing.join(', ')}`);
  });

  const doorsByKind: Record<string, number> = {};
  for (const { door } of doors) doorsByKind[door.kind] = (doorsByKind[door.kind] ?? 0) + 1;
  const referencesByKind: Record<string, number> = {};
  for (const r of p.references.references) referencesByKind[r.kind] = (referencesByKind[r.kind] ?? 0) + 1;
  return { doorsByKind, doorsByRegion, glossary, referencesByKind };
}

// The words: every key in every locale, every command a handler and a name without placeholders.
import type { CheckContext } from './context.ts';
import { placeholders } from './base.ts';

export function cataloguesRules(ctx: CheckContext) {
  const { p, report, features, commands, doors, input } = ctx;
  // ---- i18n-missing
  const keyUses = new Map<string, string>();
  const noteKey = (key: string | null, where: string) => {
    if (key !== null && !keyUses.has(key)) keyUses.set(key, where);
  };
  for (const c of commands) {
    noteKey(c.command.labelKey, `${c.file} ${c.path}.labelKey`);
    noteKey(c.command.nameKey ?? null, `${c.file} ${c.path}.nameKey`);
    noteKey(c.command.availability.refusalKey, `${c.file} ${c.path}.availability`);
    c.command.refusals.forEach((k, i) => noteKey(k, `${c.file} ${c.path}.refusals[${i}]`));
    if (c.command.confirmation) {
      noteKey(c.command.confirmation.messageKey, `${c.file} ${c.path}.confirmation`);
      noteKey(c.command.confirmation.confirmKey, `${c.file} ${c.path}.confirmation`);
      noteKey(c.command.confirmation.cancelKey, `${c.file} ${c.path}.confirmation`);
    }
  }
  for (const { file, path, door } of doors) {
    noteKey(door.labelKey, `${file} ${path}.labelKey`);
    if (door.faceLabelKey !== null) noteKey(door.faceLabelKey, `${file} ${path}.faceLabelKey`);
    noteKey(door.disabledReasonKey, `${file} ${path}.disabledReasonKey`);
  }
  for (const { file, data } of p.featureFiles) {
    noteKey(data.titleKey, `${file} titleKey`);
  }
  for (const f of features) {
    noteKey(f.feature.titleKey, `${f.file} ${f.path}.titleKey`);
    for (const [si, s] of f.feature.scenarios.entries()) {
      s.refusals.forEach((r, i) => noteKey(r.key, `${f.file} ${f.path}.scenarios[${si}].refusals[${i}]`));
      s.expect.render?.feedback.forEach((fb, i) => noteKey(fb.key, `${f.file} ${f.path}.scenarios[${si}].expect.render.feedback[${i}]`));
      s.expect.hover?.shows.forEach((show, i) => noteKey(show.key, `${f.file} ${f.path}.scenarios[${si}].expect.hover.shows[${i}]`));
    }
  }
  p.elements.elements.forEach((e, i) => {
    noteKey(e.labelKey, `elements.json elements[${i}].labelKey`);
    noteKey(e.defaultTextKey, `elements.json elements[${i}].defaultTextKey`);
  });
  p.elements.attributes.forEach((a, i) => noteKey(a.labelKey, `elements.json attributes[${i}].labelKey`));
  p.elements.settingsSections.forEach((s, i) => {
    noteKey(s.labelKey, `elements.json settingsSections[${i}].labelKey`);
    noteKey(s.descriptionKey, `elements.json settingsSections[${i}].descriptionKey`);
  });
  p.elements.palette.forEach((g, gi) => {
    noteKey(g.labelKey, `elements.json palette[${gi}].labelKey`);
    g.entries.forEach((e, i) => noteKey(e.labelKey, `elements.json palette[${gi}].entries[${i}].labelKey`));
  });
  p.elements.wrappers.forEach((w, i) => noteKey(w.nameKey, `elements.json wrappers[${i}].nameKey`));
  p.properties.sections.forEach((s, si) => {
    noteKey(s.labelKey, `properties.json sections[${si}].labelKey`);
    s.groups.forEach((g, i) => noteKey(g.labelKey, `properties.json sections[${si}].groups[${i}].labelKey`));
  });
  p.properties.breakpoints.forEach((b, i) => noteKey(b.labelKey, `properties.json breakpoints[${i}].labelKey`));
  p.properties.states.forEach((s, i) => noteKey(s.labelKey, `properties.json states[${i}].labelKey`));
  p.properties.properties.forEach((prop, i) => noteKey(prop.labelKey, `properties.json properties[${i}].labelKey`));
  p.properties.properties.forEach((prop, i) => (prop.presets ?? []).forEach((preset, pi) => noteKey(preset.labelKey, `properties.json properties[${i}].presets[${pi}].labelKey`)));
  p.properties.composites.forEach((c, i) => (c.presets ?? []).forEach((preset, pi) => noteKey(preset.labelKey, `properties.json composites[${i}].presets[${pi}].labelKey`)));
  p.properties.rows.forEach((row, i) => row.fields.forEach((f, fi) => {
    if (f.prefixKey !== null) noteKey(f.prefixKey, `properties.json rows[${i}].fields[${fi}].prefixKey`);
  }));
  p.properties.conceptRows.forEach((row, i) => {
    if (row.labelKey !== null) noteKey(row.labelKey, `properties.json conceptRows[${i}].labelKey`);
  });
  p.properties.composites.forEach((c, i) => noteKey(c.labelKey, `properties.json composites[${i}].labelKey`));
  p.properties.recipes.forEach((r, i) => noteKey(r.labelKey, `properties.json recipes[${i}].labelKey`));
  p.interactions.keyContexts.forEach((k, i) => noteKey(k.labelKey, `interactions.json keyContexts[${i}].labelKey`));
  p.layout.menus.forEach((m, i) => noteKey(m.labelKey, `layout.json menus[${i}].labelKey`));
  for (const [panel, data] of Object.entries(p.layout.panels)) noteKey(data.labelKey, `layout.json panels.${panel}.labelKey`);
  p.checks.categories.forEach((k, i) => noteKey(k.labelKey, `checks.json categories[${i}].labelKey`));
  p.checks.fixes.forEach((fix, i) => noteKey(fix.rule, `checks.json fixes[${i}].rule`));

  const catalogues = new Map<string, Record<string, unknown>>();
  for (const locale of p.environment.locales.available) {
    const catalogue = input.catalogues[locale];
    if (catalogue === null || typeof catalogue !== 'object') {
      report('i18n-missing', `i18n/${locale}`, '', `no ${locale} catalogue`);
    } else {
      catalogues.set(locale, catalogue as Record<string, unknown>);
    }
  }
  for (const [key, where] of keyUses) {
    for (const [locale, catalogue] of catalogues) {
      const text = catalogue[key];
      if (typeof text !== 'string' || text.trim() === '') report('i18n-missing', `i18n/${locale}`, key, `key "${key}" (used by ${where}) is missing in ${locale}`);
    }
  }
  const [firstLocale, ...otherLocales] = [...catalogues.keys()];
  if (firstLocale !== undefined) {
    const base = catalogues.get(firstLocale) ?? {};
    for (const locale of otherLocales) {
      const other = catalogues.get(locale) ?? {};
      for (const key of Object.keys(base)) if (!(key in other)) report('i18n-missing', `i18n/${locale}`, key, `key "${key}" exists in ${firstLocale} but is missing in ${locale}`);
      for (const key of Object.keys(other)) if (!(key in base)) report('i18n-missing', `i18n/${firstLocale}`, key, `key "${key}" exists in ${locale} but is missing in ${firstLocale}`);
      for (const key of Object.keys(base)) {
        const a = base[key];
        const b = other[key];
        if (typeof a === 'string' && typeof b === 'string' && placeholders(a).join(',') !== placeholders(b).join(',')) {
          report('i18n-missing', `i18n/${locale}`, key, `key "${key}" has placeholders {${placeholders(a).join('}, {')}} in ${firstLocale} but {${placeholders(b).join('}, {')}} in ${locale}`);
        }
      }
    }
  }

  // ---- handler-reference: every command has its handler in references.json, as registered or planned: the browser
  // runner reads its built commands there, so a command left out drops its feature's scenarios without a word (phase E5
  // met it: checks.applyFix ran in no test)
  const handlers = new Set(p.references.references.filter((r) => r.kind === 'handler').map((r) => r.id));
  for (const c of commands) if (!handlers.has(c.command.id)) report('handler-reference', 'references.json', 'references', `${c.command.id} has no handler reference: add { kind: "handler", id: "${c.command.id}", status } `);

  // ---- command-name: a command whose label has placeholders names itself without them too, for the texts that name
  // it with none of its arguments at hand (a refused or failed change, store.ts; the audit's AUD-01: "Set {property}
  // to {value}" with no values blanked the editor)
  for (const c of commands) {
    const label = catalogues.get(firstLocale ?? '')?.[c.command.labelKey];
    const named = c.command.nameKey;
    if (typeof label === 'string' && placeholders(label).length > 0 && named === undefined) {
      report('command-name', c.file, `${c.path}.nameKey`, `${c.command.id}: its label "${label}" has placeholders, so it needs a nameKey without them`);
    }
    if (named === undefined) continue;
    for (const [locale, catalogue] of catalogues) {
      const text = catalogue[named];
      if (typeof text === 'string' && placeholders(text).length > 0) report('command-name', `i18n/${locale}`, named, `${c.command.id}: its name "${text}" has placeholders`);
    }
  }
  return { catalogues, keyUses };
}

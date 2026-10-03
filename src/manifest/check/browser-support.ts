// The editor edits, offers and writes only what Chrome, Firefox and Safari all support; vendor prefixes only in a
// recipe.
import { valueShape, type CssAnalysis } from '../css.ts';
import { type Browser, type Subset } from '../schema.ts';
import type { CheckContext, Support } from './context.ts';
import type { cssSyntaxRules } from './css-syntax.ts';
import { prefixProblems } from './base.ts';

export function browserSupportRules(ctx: CheckContext, cssSyntax: Pick<ReturnType<typeof cssSyntaxRules>, 'analysed' | 'written'>) {
  const { p, report, doors, isRecipeDoor, generated, compat, excludedKeyword, lacking, describeLack, keywordCompat, supportedByAll, input, problems } = ctx;
  const { analysed, written } = cssSyntax;
  // ---- browser-support: the editor edits, offers and writes only what Chrome, Firefox and Safari all support
  // (css-compat.json)
  for (const [i, prop] of p.properties.properties.entries()) {
    const c = compat[prop.id];
    if (!c) report('browser-support', 'properties.json', `properties[${i}].id`, `${prop.id} has no entry in css-compat.json`);
    else if (lacking(c).length > 0) report('browser-support', 'properties.json', `properties[${i}].id`, `${prop.id}${c.via !== null ? ` (${c.via})` : ''} is not supported by ${describeLack(c)}: edit the property browsers implement, or declare a recipe`);
    // a legacy alias (font-stretch for font-width) is edited only while its standard name lacks a browser
    const alias = generated[prop.id]?.legacyAliasOf;
    if (alias && supportedByAll(alias)) report('browser-support', 'properties.json', `properties[${i}].id`, `${prop.id} is a legacy alias of ${alias}, which Chrome, Firefox and Safari all support: edit ${alias}`);
  }
  // Why a written value is not supported by every browser, or null: each of its keywords and functions
  // must be one css-compat.json lists and all three support; a custom identifier (a font family) is checked
  // when BCD tracks it; a syntax form BCD tracks (two-value syntax, several layers, negative values) must
  // be supported when the value has that shape.
  const unsupportedParts = (property: string, value: string, result: CssAnalysis & { ok: true }, browser: Browser | null): string[] => {
    const entry = compat[property];
    if (!entry) return [];
    const out: string[] = [];
    const lacks = (s: Support) => (browser === null ? lacking(s).length > 0 : s[browser] === false);
    const why = (s: Support) => (browser === null ? describeLack(s) : (s.why[browser] ?? 'not supported'));
    result.keywords.forEach((k, i) => {
      if (excludedKeyword.has(`${property}:${k.toLowerCase()}`)) return;
      const listed = entry.keywords[k];
      // a keyword inside a function has that function's support for it (from in rgb(from …))
      const fn = result.keywordFunctions[i] ?? null;
      const c = fn !== null ? (listed?.inFunctions[fn] ?? listed) : listed;
      if (!c) out.push(`"${k}" is not a keyword css-compat.json lists for ${property}`);
      else if (lacks(c)) out.push(`"${k}"${fn !== null ? ` in ${fn}()` : ''} is not supported by ${why(c)}`);
    });
    for (const id of result.identifiers) {
      const c = entry.keywords[id];
      if (c && lacks(c)) out.push(`"${id}" is not supported by ${why(c)}`);
    }
    const shape = valueShape(value);
    for (const unit of shape.units) {
      const c = p.compat.units[unit];
      if (!c) out.push(`the unit ${unit} is not one css-compat.json lists`);
      else if (lacks(c)) out.push(`the unit ${unit} is not supported by ${why(c)}`);
    }
    for (const fn of shape.functions) {
      const c = entry.functions[fn] ?? p.compat.valueFunctions[fn];
      if (!c) out.push(`${fn}() is not a function css-compat.json lists for ${property}`);
      else if (lacks(c)) out.push(`${fn}() is not supported by ${why(c)}`);
    }
    for (const [key, form] of Object.entries(entry.forms)) {
      const has =
        (form.shape === 'components-2' && shape.components >= 2) ||
        (form.shape === 'components-3' && shape.components >= 3) ||
        (form.shape === 'components-4' && shape.components >= 4) ||
        (form.shape === 'keywords-2' && result.keywords.length >= 2) ||
        (form.shape === 'layers-2' && shape.layers >= 2) ||
        (form.shape === 'negative' && shape.negative);
      if (has && lacks(form)) out.push(`its form ${key} is not supported by ${why(form)}`);
    }
    return out;
  };
  const writtenSupport = (file: string, path: string, property: string, value: string, result: CssAnalysis & { ok: true }) => {
    for (const problem of unsupportedParts(property, value, result, null)) report('browser-support', file, path, `${property}: ${value}: ${problem}`);
  };
  for (const w of written) {
    const result = analysed.get(`${w.file} ${w.path}`);
    if (result?.ok) writtenSupport(w.file, w.path, w.property, w.value, result);
  }
  // the units a subset offers
  const unitSupport = (file: string, path: string, name: string, s: Subset) =>
    (s.units ?? []).forEach((unit, ui) => {
      const c = p.compat.units[unit.toLowerCase()];
      if (!c) report('browser-support', file, `${path}.units[${ui}]`, `the unit ${unit} is not one css-compat.json lists`);
      else if (lacking(c).length > 0) report('browser-support', file, `${path}.units[${ui}]`, `the unit ${unit} (${name}) is not supported by ${describeLack(c)}`);
    });
  p.properties.properties.forEach((prop, i) => prop.subsets.forEach((s, si) => unitSupport('properties.json', `properties[${i}].subsets[${si}]`, prop.id, s)));
  p.properties.composites.forEach((c, i) => c.subsets.forEach((s, si) => unitSupport('properties.json', `composites[${i}].subsets[${si}]`, c.shorthand ?? c.id, s)));
  // a keyword a structured value writes (inset) is checked for every property that stores the structure
  for (const [si, s] of p.properties.structures.entries()) {
    for (const [fi, f] of s.fields.entries()) {
      if (f.keyword === null) continue;
      for (const prop of p.properties.properties.filter((x) => x.valueType === s.id)) {
        const c = keywordCompat(prop.id, f.keyword);
        if (!c) report('browser-support', 'properties.json', `structures[${si}].fields[${fi}].keyword`, `"${f.keyword}" is not a keyword css-compat.json lists for ${prop.id}`);
        else if (lacking(c).length > 0) report('browser-support', 'properties.json', `structures[${si}].fields[${fi}].keyword`, `"${f.keyword}" (${prop.id}) is not supported by ${describeLack(c)}`);
      }
    }
  }

  // ---- vendor-prefix: prefixed properties and values appear only in a compatibility recipe, the writes of its doors
  // and its allowlist entries
  const recipeWrites = new Set(doors.filter(isRecipeDoor).map((d) => `${d.file}|${d.path}.adapter.writes`));
  const recipeFallbacks = new Set(p.properties.syntaxFallbacks.flatMap((f, i) => (f.recipe !== null ? [`syntaxFallbacks[${i}]`] : [])));
  problems.push(
    ...prefixProblems(input.files, (file, path) => {
      if (file === 'properties.json' && (/^recipes(\[|$)/.test(path) || recipeFallbacks.has(path.replace(/^(syntaxFallbacks\[\d+\]).*$/, '$1')))) return true;
      return recipeWrites.has(`${file}|${path.replace(/\[\d+\]$/, '')}`) || recipeWrites.has(`${file}|${path}`);
    }),
  );
  return { unsupportedParts };
}

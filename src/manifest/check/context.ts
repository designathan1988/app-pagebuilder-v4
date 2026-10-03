// What every rule family of the manifest checker reads (plan I.12): the parsed manifest, the report, and the indexes
// built once from it (the features, commands and doors, the elements and properties by id, browser support).
import { BROWSERS, type Browser, type Command, type Feature, type Recipe, type Structure } from '../schema.ts';
import type { ManifestInput, Parsed, Problem, RuleId, DoorEntry } from './base.ts';
import { cssMatcher, supportedKeywords, PREFIX } from './base.ts';

export type Support = { chrome: string | false; firefox: string | false; safari: string | false; why: Partial<Record<Browser, string>> };

export function collectContext(input: ManifestInput, parsed: Parsed, problems: Problem[]) {
  const p = parsed;
  const report = (rule: RuleId, file: string, path: string, message: string) => problems.push({ rule, file, path, message });
  const css = cssMatcher(p.css);

  // Every id is unique within its kind.
  const unique = (kind: string, file: string, entries: { id: string; path: string }[]) => {
    const seen = new Map<string, string>();
    for (const { id, path } of entries) {
      const first = seen.get(id);
      if (first !== undefined) report('duplicate-id', file, path, `${kind} id "${id}" is already used at ${first}`);
      else seen.set(id, path);
    }
  };

  // ---- collect
  const features: { file: string; path: string; feature: Feature; index: number }[] = [];
  for (const { file, data } of p.featureFiles) {
    data.features.forEach((feature, i) => features.push({ file, path: `features[${i}]`, feature, index: features.length }));
  }
  const featureIndex = new Map<string, number>();
  for (const f of features) if (!featureIndex.has(f.feature.id)) featureIndex.set(f.feature.id, f.index);

  const commands: { file: string; path: string; command: Command }[] = [];
  for (const { file, data } of p.commandFiles) {
    data.commands.forEach((command, i) => commands.push({ file, path: `commands[${i}]`, command }));
  }
  const commandById = new Map<string, Command>();
  for (const c of commands) if (!commandById.has(c.command.id)) commandById.set(c.command.id, c.command);

  const doors: DoorEntry[] = [];
  for (const c of commands) {
    c.command.entryPoints.forEach((door, i) => doors.push({ file: c.file, path: `${c.path}.entryPoints[${i}]`, command: c.command, door, ref: `${c.command.id}#${door.id}` }));
  }
  const doorByRef = new Map(doors.map((d) => [d.ref, d]));

  const elementById = new Map(p.elements.elements.map((e) => [e.id, e]));
  const attributeById = new Map(p.elements.attributes.map((a) => [a.id, a]));
  const paletteEntryIds = new Set(p.elements.palette.flatMap((g) => g.entries.map((e) => e.id)));
  const propertyById = new Map(p.properties.properties.map((prop) => [prop.id, prop]));
  const compositeById = new Map(p.properties.composites.map((c) => [c.id, c]));
  const recipeById = new Map<string, Recipe>(p.properties.recipes.map((r) => [r.id, r]));
  const structureById = new Map<string, Structure>(p.properties.structures.map((s) => [s.id, s]));
  const recipeDoorRefs = new Set(p.properties.recipes.flatMap((r) => r.doors));
  const isRecipeDoor = (entry: DoorEntry) => recipeDoorRefs.has(entry.ref) || (entry.door.kind === 'inspector-field' && entry.door.recipe !== null);
  const breakpointIds = new Set(p.properties.breakpoints.map((b) => b.id));
  const stateIds = new Set(p.properties.states.map((s) => s.id));
  const contextIds = new Set(p.interactions.keyContexts.map((k) => k.id));
  const gestureById = new Map(p.interactions.gestures.map((g) => [g.id, g]));
  const constantById = new Map(p.interactions.constants.map((c) => [c.id, c]));
  const viewportIds = new Set(p.environment.viewports.map((v) => v.id));
  const regionIds = new Set(p.layout.regions.map((r) => r.id));
  const generated = p.css.properties;
  const isShorthand = (name: string) => (generated[name]?.longhands.length ?? 0) > 0;

  // Browser support (css-compat.json). Keyword keys are lower-case.
  const compat = p.compat.properties;
  // the keywords css-exclusions.json excludes: rule exclusion, not browser-support, reports a list that offers one
  const excludedKeyword = new Set(p.exclusions.exclusions.flatMap((x) => (x.keyword === null ? [] : [`${x.property}:${x.keyword.toLowerCase()}`])));
  const lacking = (s: Support): Browser[] => BROWSERS.filter((b) => s[b] === false);
  const describeLack = (s: Support) => lacking(s).map((b) => `${b} (${s.why[b] ?? 'not supported'})`).join(', ');
  const keywordCompat = (name: string, keyword: string) => compat[name]?.keywords[keyword.toLowerCase()];
  // every browser implements the property
  const supportedByAll = (name: string) => {
    const c = compat[name];
    return c !== undefined && lacking(c).length === 0;
  };
  // the generated keywords of a property that all three browsers support: what "generated" offers
  const offeredKeywords = (name: string): string[] => supportedKeywords(p.css, p.compat, name);
  const vendorPrefixed = (name: string) => PREFIX.test(name);
  const structureOf = (name: string) => structureById.get(propertyById.get(name)?.valueType ?? '');
  // The lexer fallback allowlist: the entry that lets `value` of `property` through, written by `recipe`
  // (null outside a recipe). A recipe-scoped entry holds only for that recipe.
  const fallbackEntry = (
    property: string,
    value: string,
    recipe: string | null
  ): number => p.properties.syntaxFallbacks.findIndex((f) => f.property === property && (f.values === null || f.values.includes(value)) && (f.recipe === null || f.recipe === recipe));
  // a recipe's allowlist entry that names the value vouches for it where BCD does not track it
  const vouched = (property: string, value: string, recipe: string | null) => recipe !== null && p.properties.syntaxFallbacks.some((f) => f.property === property && f.values !== null && f.values.includes(value) && f.recipe === recipe);
  return {
    input,
    problems,
    p,
    report,
    css,
    unique,
    features,
    featureIndex,
    commands,
    commandById,
    doors,
    doorByRef,
    elementById,
    attributeById,
    paletteEntryIds,
    propertyById,
    compositeById,
    recipeById,
    structureById,
    recipeDoorRefs,
    isRecipeDoor,
    breakpointIds,
    stateIds,
    contextIds,
    gestureById,
    constantById,
    viewportIds,
    regionIds,
    generated,
    isShorthand,
    compat,
    excludedKeyword,
    lacking,
    describeLack,
    keywordCompat,
    supportedByAll,
    offeredKeywords,
    vendorPrefixed,
    structureOf,
    fallbackEntry,
    vouched,
  };
}

export type CheckContext = ReturnType<typeof collectContext>;

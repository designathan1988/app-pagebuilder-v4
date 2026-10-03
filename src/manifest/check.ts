// Validates the manifest: first that no hand-written field holds logic, then every file against its
// schema, then the rules that tie the files together and to the generated web data. Pure: the
// caller supplies the parsed files, the i18n catalogues, a way to ask whether a repository path
// exists and the ids code has registered.
import { logicProblems, parseFiles, type CheckResult, type ManifestInput, type ManifestSummary } from './check/base.ts';
import { collectContext } from './check/context.ts';
import { identityRules } from './check/identity.ts';
import { styleDoorsRules } from './check/style-doors.ts';
import { commandLinksRules } from './check/command-links.ts';
import { cataloguesRules } from './check/catalogues.ts';
import { valuesRules } from './check/values.ts';
import { cssSyntaxRules } from './check/css-syntax.ts';
import { browserSupportRules } from './check/browser-support.ts';
import { valueShapesRules } from './check/value-shapes.ts';
import { dataRulesRules } from './check/data-rules.ts';
import { interactionsRules } from './check/interactions.ts';
import { scenarioTerminalsRules } from './check/scenario-terminals.ts';
import { scenariosRules } from './check/scenarios.ts';
import { placementRules } from './check/placement.ts';

// the public names of the checker, whose ground is check/base.ts
export { RULES, excludedUnitsOf, generatedOffer, generatedUnits, htmlRefusal, supportedKeywords, supportedUnits } from './check/base.ts';
export type { CheckResult, ManifestInput, ManifestSummary, OfferData, Problem, ReferenceKind, RuleId } from './check/base.ts';

// The rule families, in the order they report (plan I.12): each reads the context and what an earlier family found.
export function checkManifest(input: ManifestInput): CheckResult {
  const logic = logicProblems(input.files);
  if (logic.length > 0) return { problems: logic, summary: null };
  const { parsed, problems } = parseFiles(input);
  if (!parsed) return { problems, summary: null };
  const ctx = collectContext(input, parsed, problems);
  const identity = identityRules(ctx);
  styleDoorsRules(ctx, identity);
  commandLinksRules(ctx);
  const catalogues = cataloguesRules(ctx);
  const values = valuesRules(ctx);
  const cssSyntax = cssSyntaxRules(ctx, values);
  const browserSupport = browserSupportRules(ctx, cssSyntax);
  valueShapesRules(ctx, cssSyntax, browserSupport);
  const dataRules = dataRulesRules(ctx);
  interactionsRules(ctx, values);
  scenarioTerminalsRules(ctx);
  scenariosRules(ctx);
  const placement = placementRules(ctx, catalogues, values);
  const { p, features, commands, doors, paletteEntryIds, generated } = ctx;
  const { keyUses } = catalogues;
  const { keywordsLeftOut, unitsLeftOut } = values;
  const { implementedOnly, recipeBrowserSyntax } = cssSyntax;
  const { html } = dataRules;
  const { doorsByKind, doorsByRegion, glossary, referencesByKind } = placement;
  const summary: ManifestSummary = {
    features: features.length,
    featureGroups: p.featureFiles.length,
    commands: commands.length,
    undoableCommands: commands.filter((c) => c.command.history.undoable).length,
    doors: doors.length,
    doorsByKind: Object.fromEntries(Object.entries(doorsByKind).sort(([a], [b]) => a.localeCompare(b))),
    doorsByRegion: Object.fromEntries(p.layout.regions.map((r) => [r.id, doorsByRegion[r.id] ?? 0])),
    regions: p.layout.regions.length,
    menuAnchors: p.layout.menus.reduce((n, m) => n + m.anchors.length, 0),
    glossaryConcepts: glossary?.concepts.length ?? 0,
    elements: p.elements.elements.length,
    paletteEntries: paletteEntryIds.size,
    attributes: p.elements.attributes.length,
    generatedProperties: Object.keys(generated).length,
    generatedShorthands: Object.values(generated).filter((g) => g.longhands.length > 0).length,
    generatedElements: Object.keys(html).length,
    properties: p.properties.properties.length,
    composites: p.properties.composites.length,
    recipes: p.properties.recipes.length,
    structures: p.properties.structures.length,
    couplings: p.properties.couplings.length,
    browsers: p.compat.browsers,
    compatSource: Object.entries(p.compat.$generated.from).map(([pkg, v]) => `${pkg} ${v}`).join(', '),
    keywordsLeftOut,
    unitsLeftOut,
    recipeBrowserSyntax: [...recipeBrowserSyntax].sort(),
    recipeSources: p.properties.recipes.map((r) => `${r.id} (${r.source.spec}; BCD ${r.source.bcd})`),
    storedWhole: p.properties.storedWhole.map((w) => `${w.property}: ${w.reason}`),
    iconLibrary: `Lucide ${p.icons.$generated.from['lucide-static'] ?? ''} (${p.icons.icons.length} icons)`,
    iconsNamed: new Set([
      ...doors.map((d) => d.door.icon),
      ...p.elements.elements.map((e) => e.icon),
      ...p.layout.menus.flatMap((m) => m.anchors.map((a) => a.icon)),
      ...Object.values(p.layout.glyphs),
      ...Object.values(p.layout.panels).map((panel) => panel.icon),
      ...p.properties.properties.flatMap((prop) => Object.values(prop.icons))
    ].filter((i) => i !== null)).size,
    doorsWithIcon: doors.filter((d) => d.door.icon !== null).length,
    plannedReferences: p.references.references.filter((r) => r.status === 'planned').length,
    registeredReferences: p.references.references.filter((r) => r.status === 'registered').length,
    referencesByKind: Object.fromEntries(Object.entries(referencesByKind).sort(([a], [b]) => a.localeCompare(b))),
    consumers: p.consumers.consumers.length,
    implementedOnly: [...implementedOnly].sort(),
    fallbackAllowlist: p.properties.syntaxFallbacks.map((f) => `${f.property}${f.values === null ? '' : `: ${f.values.join(', ')}`}${f.recipe === null ? '' : ` (recipe ${f.recipe})`}: ${f.reason}`),
    constants: p.interactions.constants.length,
    gestures: p.interactions.gestures.length,
    keyContexts: p.interactions.keyContexts.length,
    scenarios: features.reduce((n, f) => n + f.feature.scenarios.length, 0),
    fixtures: p.fixtures.size,
    exclusions: p.exclusions.exclusions.map((x) => `${x.property}: ${x.keyword ?? `the unit ${x.unit ?? ''}`}`),
    i18nKeys: keyUses.size,
  };
  return { problems, summary };
}

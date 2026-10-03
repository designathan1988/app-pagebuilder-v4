import { describe, expect, it } from 'vitest';
import { RULES, checkManifest, generatedOffer, generatedUnits, htmlRefusal, supportedKeywords, type RuleId } from '../../src/manifest/check.ts';
import { normaliseChord } from '../../src/manifest/chord.ts';
import { createCssMatcher } from '../../src/manifest/css.ts';
import { generatedCompatSchema, generatedCssSchema, generatedHtmlSchema, propertiesFileSchema } from '../../src/manifest/schema.ts';
import { loadManifest, registrationsIn } from './load.ts';
import { SHARDS } from './plant-shard.ts';
import { PLANTS, ownGenerated, plantDeleteScenarios, plantRenderScenario, planted, unbuildZoom, type Plant } from './plants.ts';

const loaded = loadManifest();

describe('manifest:check', () => {
  it('passes on the real manifest', () => {
    expect(loaded.problems).toEqual([]);
    const result = checkManifest(loaded.input);
    expect(result.problems).toEqual([]);
    // every feature the groups declare is counted (derived, so a new feature edits no test: the audit's AUD-34)
    const declared = Object.entries(loaded.input.files)
      .filter(([file]) => file.startsWith('features/'))
      .reduce((count, [, json]) => count + ((json as { features?: readonly unknown[] }).features?.length ?? 0), 0);
    expect(declared).toBeGreaterThan(0);
    expect(result.summary?.features).toBe(declared);
  });

  it('has a planted fixture for every rule', () => {
    const planted = new Set(PLANTS.map((p) => p.rule));
    expect(RULES.filter((rule) => !planted.has(rule))).toEqual([]);
  });

  it('proves every planted fixture in exactly one shard (check-plants-<n>.test.ts)', () => {
    const shards = Array.from({ length: SHARDS }, (_s, shard) => PLANTS.filter((_p, index) => index % SHARDS === shard).length);
    expect(shards.reduce((a, b) => a + b, 0)).toBe(PLANTS.length);
  });

  it('has the planted fixtures of the property model, each on its own rule', () => {
    const rules = new Map(PLANTS.map((p) => [p.id, p.rule]));
    expect({
      'keyword-rejected-by-syntax': rules.get('keyword-rejected-by-syntax'),
      'door-writes-shorthand': rules.get('door-writes-shorthand'),
      'handle-writes-transform': rules.get('handle-writes-transform'),
      'coupling-unknown-predicate': rules.get('coupling-unknown-predicate'),
      'field-without-consumer': rules.get('field-without-consumer'),
      'field-holds-expression': rules.get('field-holds-expression'),
      'reference-not-planned': rules.get('reference-not-planned'),
    }).toEqual({
      'keyword-rejected-by-syntax': 'css-syntax',
      'door-writes-shorthand': 'shorthand-write',
      'handle-writes-transform': 'individual-transform',
      'coupling-unknown-predicate': 'coupling',
      'field-without-consumer': 'consumer',
      'field-holds-expression': 'no-logic',
      'reference-not-planned': 'reference',
    });
  });

  it('has the planted fixtures of the browser-support model, each on its own rule', () => {
    const rules = new Map(PLANTS.map((p) => [p.id, p.rule]));
    expect({
      'edited-property-unsupported': rules.get('edited-property-unsupported'),
      'offered-keyword-unsupported': rules.get('offered-keyword-unsupported'),
      'prefix-outside-recipe': rules.get('prefix-outside-recipe'),
      'fallback-outside-allowlist': rules.get('fallback-outside-allowlist'),
      'recipe-misses-browsers': rules.get('recipe-misses-browsers'),
      'handle-edits-unknown-field': rules.get('handle-edits-unknown-field'),
      'shorthand-whose-longhands-browsers-implement': rules.get('shorthand-whose-longhands-browsers-implement'),
      'stored-shorthand-and-its-longhand': rules.get('stored-shorthand-and-its-longhand'),
      'offered-type-keyword-unsupported': rules.get('offered-type-keyword-unsupported'),
      'recipe-source-not-its-value': rules.get('recipe-source-not-its-value'),
      'structured-default-as-css-text': rules.get('structured-default-as-css-text'),
      'composite-subset-sets-omitted-longhand': rules.get('composite-subset-sets-omitted-longhand'),
      'buttons-with-no-supported-keyword': rules.get('buttons-with-no-supported-keyword'),
      'global-allowlist-cannot-vouch': rules.get('global-allowlist-cannot-vouch'),
      'written-function-unsupported': rules.get('written-function-unsupported'),
      'written-form-unsupported': rules.get('written-form-unsupported'),
      'recipe-writes-shorthand-of-edited-longhands': rules.get('recipe-writes-shorthand-of-edited-longhands'),
      'written-untracked-function': rules.get('written-untracked-function'),
      'offered-unit-unsupported': rules.get('offered-unit-unsupported'),
    }).toEqual({
      'edited-property-unsupported': 'browser-support',
      'offered-keyword-unsupported': 'browser-support',
      'prefix-outside-recipe': 'vendor-prefix',
      'fallback-outside-allowlist': 'syntax-fallback',
      'recipe-misses-browsers': 'recipe',
      'handle-edits-unknown-field': 'structured-value',
      'shorthand-whose-longhands-browsers-implement': 'shorthand-write',
      'stored-shorthand-and-its-longhand': 'shorthand-write',
      'offered-type-keyword-unsupported': 'browser-support',
      'recipe-source-not-its-value': 'recipe',
      'structured-default-as-css-text': 'structured-value',
      'composite-subset-sets-omitted-longhand': 'composite',
      'buttons-with-no-supported-keyword': 'value-set',
      'global-allowlist-cannot-vouch': 'browser-support',
      'written-function-unsupported': 'browser-support',
      'written-form-unsupported': 'browser-support',
      'recipe-writes-shorthand-of-edited-longhands': 'recipe',
      'written-untracked-function': 'browser-support',
      'offered-unit-unsupported': 'browser-support',
    });
  });

  // Mutations the review tried that break more than one rule: each must at least fail on the rules named.
  const mutated = (apply: Plant['apply']): Set<RuleId> => new Set(checkManifest(planted(loaded.input, { id: 'mutation', rule: 'schema', description: '', apply })).problems.map((p) => p.rule));
  type Json = Record<string, unknown>;
  const recipeOf = (m: Parameters<Plant['apply']>[0], id: string) => ((m.files['properties.json'] as Json).recipes as Json[]).find((r) => r.id === id) as Json;
  const setDeclaration = (m: Parameters<Plant['apply']>[0], property: string, value: string) => {
    const declaration = (recipeOf(m, 'line-clamp').declarations as Json[]).find((d) => d.property === property);
    if (!declaration) throw new Error(`no declaration ${property}`);
    declaration.value = value;
  };

  it('has the planted fixtures of the placement rules (docs/PRODUCT.md §5.3), each on its own rule', () => {
    const rules = new Map(PLANTS.map((p) => [p.id, p.rule]));
    expect({
      'door-unplaced': rules.get('door-unplaced'),
      'state-door-on-canvas-toolbar': rules.get('state-door-on-canvas-toolbar'),
      'label-names-two-properties': rules.get('label-names-two-properties'),
      'inspector-subset-in-all-properties': rules.get('inspector-subset-in-all-properties'),
      'essentials-value-missing-from-all-properties': rules.get('essentials-value-missing-from-all-properties'),
      'icon-not-in-library': rules.get('icon-not-in-library'),
      'toolbar-door-without-icon': rules.get('toolbar-door-without-icon'),
      'panel-button-without-icon': rules.get('panel-button-without-icon'),
    }).toEqual({
      'door-unplaced': 'placement',
      'state-door-on-canvas-toolbar': 'state-placement',
      'label-names-two-properties': 'label-term',
      'inspector-subset-in-all-properties': 'all-properties',
      'essentials-value-missing-from-all-properties': 'all-properties',
      'icon-not-in-library': 'icon-name',
      'toolbar-door-without-icon': 'icon-required',
      'panel-button-without-icon': 'icon-required',
    });
  });

  it('places every door with a control, and only in a region manifest/layout.json names', { timeout: 30_000 }, () => {
    const summary = checkManifest(loaded.input).summary;
    const placed = Object.values(summary?.doorsByRegion ?? {}).reduce((n, x) => n + x, 0);
    expect(placed + (summary?.doorsByKind.shortcut ?? 0)).toBeLessThanOrEqual(summary?.doors ?? 0);
    expect(placed).toBeGreaterThan(0);
    const unknownRegion = mutated((m) => {
      const commands = (m.files['commands/history.json'] as Json).commands as Json[];
      const undo = ((commands.find((c) => c.id === 'history.undo') as Json).entryPoints as Json[]).find((d) => d.id === 'toolbar-top-bar') as Json;
      undo.placement = { region: 'floating-toolbar', order: 1 };
    });
    expect([...unknownRegion]).toEqual(['placement']);
    const keyWithPlace = mutated((m) => {
      const commands = (m.files['commands/history.json'] as Json).commands as Json[];
      const undo = ((commands.find((c) => c.id === 'history.undo') as Json).entryPoints as Json[]).find((d) => d.kind === 'shortcut') as Json;
      undo.placement = { region: 'top-bar', order: 1 };
    });
    expect([...keyWithPlace]).toEqual(['placement']);
  });

  it('refuses two controls in one position of a region', { timeout: 30_000 }, () => {
    const twoDoors = mutated((m) => {
      const commands = (m.files['commands/history.json'] as Json).commands as Json[];
      const redo = ((commands.find((c) => c.id === 'history.redo') as Json).entryPoints as Json[]).find((d) => d.id === 'toolbar-top-bar') as Json;
      redo.placement = { region: 'top-bar', order: 8 };
    });
    expect([...twoDoors]).toEqual(['placement']);
    const doorAndMenu = mutated((m) => {
      const menus = (m.files['layout.json'] as Json).menus as Json[];
      (menus.find((x) => x.id === 'element-actions') as Json).anchors = [{ region: 'inspector-header', order: 2, drawnAs: 'icon-button', icon: 'ellipsis' }];
    });
    expect([...doorAndMenu]).toEqual(['placement']);
  });

  it('refuses a cascade whose first breakpoint is not the only base', { timeout: 30_000 }, () => {
    const rules = mutated((m) => {
      const breakpoints = (m.files['properties.json'] as Json).breakpoints as Json[];
      (breakpoints[0] as Json).base = false;
      (breakpoints[3] as Json).base = true;
    });
    expect([...rules]).toEqual(['schema']);
  });

  it('refuses a state menu that opens from the canvas frame', { timeout: 30_000 }, () => {
    const rules = mutated((m) => {
      const menus = (m.files['layout.json'] as Json).menus as Json[];
      (menus.find((x) => x.id === 'style-state') as Json).anchors = [{ region: 'canvas-breakpoints', order: 9, drawnAs: 'button', icon: null }];
    });
    expect([...rules]).toEqual(['state-placement']);
  });

  it('refuses one English label for two CSS properties, and a label that is not its glossary term', { timeout: 30_000 }, () => {
    const twoProperties = mutated((m) => {
      ((m.catalogues as Json).en as Json)['property.direction'] = 'Direction';
    });
    expect([...twoProperties]).toEqual(['label-term']);
    const notTheTerm = mutated((m) => {
      ((m.catalogues as Json)['pt-BR'] as Json)['property.padding'] = 'Espaçamento interno';
    });
    expect([...notTheTerm]).toEqual(['label-term']);
  });

  it('rejects a recipe value outside the allowlist, even when the property has no prefix', { timeout: 30_000 }, () => {
    expect(mutated((m) => setDeclaration(m, 'overflow-x', 'overlay')).has('syntax-fallback')).toBe(true);
  });

  it('rejects a prefixed recipe value BCD does not track and the allowlist does not vouch for', { timeout: 30_000 }, () => {
    const rules = mutated((m) => setDeclaration(m, 'display', '-moz-box'));
    expect(rules.has('syntax-fallback')).toBe(true);
    expect(rules.has('recipe')).toBe(true);
  });

  it('finds a vendor prefix whatever its case', { timeout: 30_000 }, () => {
    const rules = mutated((m) => {
      const display = ((m.files['properties.json'] as Json).properties as Json[]).find((p) => p.id === 'display') as Json;
      ((display.subsets as Json[])[0]?.values as string[]).push('-WEBKIT-box');
    });
    expect(rules.has('vendor-prefix')).toBe(true);
  });

  it('rejects a recipe declaration that is the shorthand of edited longhands, whatever the recipe', { timeout: 30_000 }, () => {
    const rules = mutated((m) => {
      (recipeOf(m, 'user-select').declarations as Json[]).push({ property: 'padding', value: '0px' });
      const commands = (m.files['commands/style.json'] as Json).commands as Json[];
      const door = ((commands.find((c) => c.id === 'style.set') as Json).entryPoints as Json[]).find((d) => d.id === 'inspector-user-select') as Json;
      ((door.adapter as Json).writes as string[]).push('padding');
    });
    expect(rules.has('recipe')).toBe(true);
  });

  const withValues = (entries: [string, string][]) =>
    mutated((m) => {
      const div = ((m.files['elements.json'] as Json).elements as Json[]).find((e) => e.id === 'div') as Json;
      for (const [property, value] of entries) (div.defaultStyles as Json)[property] = value;
    });

  // (four whole manifest checks: the file's convention for such tests)
  it('accepts the math functions every browser supports, and the functions BCD tracks', { timeout: 30_000 }, () => {
    expect(withValues([['width', 'calc(100% - 10px)'], ['padding-top', 'max(0px, 1rem)'], ['height', 'clamp(10px, 50%, 200px)'], ['color', 'color-mix(in srgb, red, blue)'], ['background-color', 'rgb(from red 255 0 0)']])).toEqual(new Set());
    // colours inside gradients are colours: a keyword of a type used as an argument is decided by that type
    expect(withValues([['background-image', 'linear-gradient(red, blue)'], ['mask-image', 'linear-gradient(black, transparent)'], ['list-style-image', 'radial-gradient(circle at center, red, blue)']])).toEqual(new Set());
    // url() is matched by the official syntax (CSSTree's own <url> definition, which its parser needs)
    expect(withValues([['background-image', 'url("a.png")'], ['list-style-image', 'url("a.png")']])).toEqual(new Set());
    // functions webref defines only in scoped versions resolve by the scope that reaches them
    expect(withValues([['clip-path', 'rect(0 10px 10px 0)'], ['background-image', 'image-set("a.png" type("image/png"))']])).toEqual(new Set());
  });

  it('checks a keyword inside a function with its support in that function', { timeout: 30_000 }, () => {
    // BCD records shape() but none of its keywords, and MDN's syntax does not know shape(): no data says they work
    expect(withValues([['clip-path', 'shape(from 0 0, line to 10px 10px)']]).has('browser-support')).toBe(true);
    // contrast-color()'s draft placeholders and color()'s HDR spaces: BCD tracks the function, not these values
    expect(withValues([['color', 'contrast-color(red tbd-fg)']]).has('browser-support')).toBe(true);
    expect(withValues([['color', 'color(rec2100-pq 0.5 0.5 0.5)']]).has('browser-support')).toBe(true);
    // only MDN's syntax names context-fill, and BCD does not track it
    expect(withValues([['fill', 'context-fill']]).has('browser-support')).toBe(true);
  });

  it('refuses a unit a browser lacks', { timeout: 30_000 }, () => {
    const rules = mutated((m) => {
      const rcap = ownGenerated(m, 'generated/css-compat.json', 'units', 'rcap');
      rcap.safari = false;
      rcap.why = { ...(rcap.why as Json), safari: 'planted' };
      const div = ((m.files['elements.json'] as Json).elements as Json[]).find((e) => e.id === 'div') as Json;
      (div.defaultStyles as Json).width = '10rcap';
    });
    expect(rules.has('browser-support')).toBe(true);
  });

  it('refuses a function BCD does not track', { timeout: 30_000 }, () => {
    expect(withValues([['background-image', 'image(red)']]).has('browser-support')).toBe(true);
  });

  it('rejects a structured value written as CSS text by a coupling', { timeout: 30_000 }, () => {
    const rules = mutated((m) => {
      ((m.files['properties.json'] as Json).couplings as Json[]).push({ id: 'planted-shadow', trigger: { property: 'opacity', values: null, via: null }, condition: { predicate: 'always', property: null, values: [] }, effect: { action: 'setValue', property: 'box-shadow', value: '0 1px 2px red' }, feature: 'props-effects-basic' });
    });
    expect(rules.has('structured-value')).toBe(true);
  });

  it('reads the generated files once: every fixture shares them, frozen, and a plant copies only what it changes', () => {
    const generated = Object.keys(loaded.input.files).filter((file) => file.startsWith('generated/'));
    expect(generated).toEqual(['generated/css-compat.json', 'generated/css-properties.json', 'generated/html-elements.json', 'generated/icons.json']);
    for (const file of generated) expect(Object.isFrozen(loaded.input.files[file])).toBe(true);
    const plant = PLANTS.find((p) => p.id === 'door-unplaced');
    if (!plant) throw new Error('no plant door-unplaced');
    const fixture = planted(loaded.input, plant);
    for (const file of generated) expect(fixture.files[file]).toBe(loaded.input.files[file]);
    const unit = PLANTS.find((p) => p.id === 'offered-unit-unsupported');
    if (!unit) throw new Error('no plant offered-unit-unsupported');
    const compat = planted(loaded.input, unit).files['generated/css-compat.json'] as Json;
    const shared = loaded.input.files['generated/css-compat.json'] as Json;
    expect(compat).not.toBe(shared);
    expect(compat.properties).toBe(shared.properties);
  });


  it('reads a registration with or without type arguments, and nothing that only names the function', () => {
    const code = [
      "export const undo = registerHandler('history.undo', () => ({ kind: 'undo' }));",
      "export const open = registerHandler<'workspace.setPanelOpen', EditorUi>('workspace.setPanelOpen', ({ state }) => state);",
      'export const can = registerPredicate<EditorUi>(\n  "canUndo", (s) => true);',
      'const f = registerHandler;',
      'const g = registerHandler(id, run);',
    ].join('\n');
    expect(registrationsIn(code)).toEqual([
      { kind: 'handler', id: 'history.undo' },
      { kind: 'handler', id: 'workspace.setPanelOpen' },
      { kind: 'predicate', id: 'canUndo' },
    ]);
  });

  // A plant that must leave the manifest valid: the scenario contract accepts what it describes.
  const valid = (apply: Plant['apply']) => checkManifest(planted(loaded.input, { id: 'valid', rule: 'fixture', description: '', apply })).problems;

  it('counts a measure of the editor and a kept preference as end terminals', () => {
    expect(
      valid((m) => {
        const [remove] = plantDeleteScenarios(m);
        Object.assign(remove.expect as object, { render: null, editor: { regions: [{ region: 'top-bar', measure: 'height', relation: 'equals', value: 40, reference: null }], computed: [{ region: 'status-bar', property: 'background-color', value: 'rgb(0, 0, 0)' }] } });
      }),
    ).toEqual([]);
    expect(
      valid((m) => {
        const [remove] = plantDeleteScenarios(m);
        Object.assign(remove.expect as object, { render: null, persistence: { reload: 'immediate', document: null, preferences: 'same' } });
      }),
    ).toEqual([]);
  });

  it('resolves a scenario of the empty project with the names of its locale', () => {
    const empty = (locale: string, root: string) =>
      valid((m) => {
        const f = plantRenderScenario(m);
        f.toothProof = 'src/editor/canvas/render/render.ts';
        const s = (f.scenarios as Record<string, Record<string, unknown>>[])[0] as Record<string, Record<string, unknown>>;
        Object.assign(s.setup as object, { fixture: 'empty', locale, selection: [root] });
        Object.assign(s.expect as object, { selection: [root], render: { computed: [{ node: root, property: 'display', value: 'block' }], geometry: [], feedback: [] } });
      });
    expect(empty('pt-BR', '/Página')).toEqual([]);
    expect(empty('en', '/Page')).toEqual([]);
    expect(empty('en', '/Página').map((p) => p.rule)).toEqual(['document-path', 'document-path', 'document-path']);
  });

  it('checks the arguments of a step against its command: a palette entry, a node path', () => {
    const insert = (entry: string) =>
      checkManifest(
        planted(loaded.input, {
          id: 'insert',
          rule: 'step',
          description: '',
          apply: (m) => {
            const [remove] = plantDeleteScenarios(m);
            (remove.steps as unknown[]).unshift({ door: 'element.insert#elements-tile', args: { entry, parent: '/Page/Section' }, target: null, drop: null, action: false });
          },
        }),
      ).problems.map((p) => `${p.rule}: ${p.message}`);
    expect(insert('heading')).toEqual([]);
    expect(insert('banner')).toEqual(['step: "banner": the argument "entry" of element.insert is a palette entry of elements.json']);
  });

  it('accepts a held drag that a later step releases on its door or drag.cancel ends, and typed characters', () => {
    const drag = 'element.moveTo#canvas-drag-canvas-element-before-after';
    const held = { door: drag, args: { parent: '/Page/Section', index: 1 }, target: '/Page/Section/Heading', drop: { placement: 'after', reference: '/Page/Section/Paragraph' }, action: false, hold: true, type: null };
    for (const end of [
      { door: drag, args: {}, target: null, drop: null, action: false, hold: false },
      { door: 'drag.cancel#key-escape-in-drag', args: {}, target: null, drop: null, action: false },
    ]) {
      expect(
        valid((m) => {
          const [remove] = plantDeleteScenarios(m);
          (remove.steps as unknown[]).unshift(held, end);
          ((remove.steps as Record<string, unknown>[]).at(-1) as Record<string, unknown>).type = 'x\n';
        }),
      ).toEqual([]);
    }
  });

  it('refuses a tooth-proof module that does not exist', () => {
    const input = planted(loaded.input, {
      id: 'tooth-module-missing',
      rule: 'tooth-proof',
      description: '',
      apply: (m) => {
        plantRenderScenario(m).toothProof = 'src/core/render/nothing.ts';
      },
    });
    expect([...new Set(checkManifest(input).problems.map((p) => p.rule))]).toEqual(['tooth-proof']);
  });

  // every case runs the whole manifest check: four runs of ~1 s each, over the default 5 s when the suite runs beside
  // the browser checks (a larger manifest and a busy machine both push it over)
  it('lets a scenario start at a zoom level once zoom-keyboard-buttons is built, and at "fit" before', { timeout: 30_000 }, () => {
    // built as the real manifest now is; before it, its commands made unbuilt (unbuildZoom)
    const at = (zoom: unknown, built: boolean) =>
      valid((m) => {
        if (!built) unbuildZoom(m);
        const [remove] = plantDeleteScenarios(m);
        (remove.setup as Record<string, unknown>).zoom = zoom;
      }).map((p) => p.rule);
    expect(at('fit', false)).toEqual([]);
    expect(at(50, false)).toEqual(['zoom']);
    // no level is let through before the zoom doors exist, 100 included
    expect(at(100, false)).toEqual(['zoom']);
    expect(at(50, true)).toEqual([]);
    expect(at(75, true)).toEqual(['unknown-reference']);
  });

  // every plant runs the whole check: the list is long enough to pass the default 5 s on a busy machine
  it('never changes the real manifest when planting', { timeout: 30_000 }, () => {
    for (const plant of PLANTS) planted(loaded.input, plant);
    expect(checkManifest(loaded.input).problems).toEqual([]);
  });
});

describe('normaliseChord', () => {
  it('treats modifier order and letter case as the same chord', () => {
    expect(normaliseChord('Shift+Ctrl+z')).toBe('Ctrl+Shift+Z');
    expect(normaliseChord('Ctrl+Shift+Z')).toBe('Ctrl+Shift+Z');
    expect(normaliseChord('Alt+Shift+ArrowRight')).toBe('Alt+Shift+ArrowRight');
  });

  it('reads a plus key and punctuation keys', () => {
    expect(normaliseChord('Ctrl++')).toBe('Ctrl++');
    expect(normaliseChord('Ctrl+=')).toBe('Ctrl+=');
    expect(normaliseChord("Ctrl+'")).toBe("Ctrl+'");
    expect(normaliseChord('Ctrl+\\')).toBe('Ctrl+\\');
  });

  it('refuses what is not a chord', () => {
    expect(normaliseChord('Ctrl+')).toBeNull();
    expect(normaliseChord('Hyper+A')).toBeNull();
    expect(normaliseChord('Ctrl+Ctrl+A')).toBeNull();
    expect(normaliseChord('Arrowup')).toBeNull();
  });
});

describe('generated web data', () => {
  const css = generatedCssSchema.parse(loaded.input.files['generated/css-properties.json']);
  const html = generatedHtmlSchema.parse(loaded.input.files['generated/html-elements.json']);
  const matcher = createCssMatcher({
    properties: Object.fromEntries(Object.entries(css.properties).map(([name, p]) => [name, p.syntax])),
    types: css.types,
  });

  it('matches values against the official syntax with CSSTree', () => {
    expect(matcher.matchEither('display', 'flex')).toEqual({ ok: true, by: 'official' });
    expect(matcher.matchEither('rotate', '45deg')).toEqual({ ok: true, by: 'official' });
    expect(matcher.matchEither('color', 'oklch(70% 0.15 260)')).toEqual({ ok: true, by: 'official' });
    expect(matcher.matchEither('display', 'flexbox').ok).toBe(false);
    expect(matcher.matchEither('width', '10 px').ok).toBe(false);
  });

  it('falls back to the syntax browsers implement only where the official grammar is incomplete', () => {
    expect(matcher.match('fill', '#dbe7ff')).not.toBeNull();
    expect(matcher.matchEither('fill', '#dbe7ff')).toEqual({ ok: true, by: 'implemented' });
    // the only properties allowed to use that fallback, and the legacy value only a recipe may use
    const properties = propertiesFileSchema.parse(loaded.input.files['properties.json']);
    expect(properties.syntaxFallbacks.map((f) => [f.property, f.values, f.recipe])).toEqual([
      ['fill', null, null],
      ['stroke', null, null],
      ['display', ['-webkit-box'], 'line-clamp'],
      ['-webkit-box-orient', ['vertical'], 'line-clamp'],
    ]);
    // a match that goes through a definition webref does not have is a browser-syntax match
    expect(matcher.matchEither('-webkit-box-orient', 'vertical')).toEqual({ ok: true, by: 'implemented' });
    expect(matcher.matchEither('background-image', 'url("a.png")')).toEqual({ ok: true, by: 'official' });
    expect(matcher.matchEither('clip-path', 'rect(0 10px 10px 0)')).toEqual({ ok: true, by: 'official' });
    expect(matcher.matchEither('display', '-webkit-box')).toEqual({ ok: true, by: 'implemented' });
  });

  it('records shorthands with their expanded longhands', () => {
    expect(css.properties.gap?.longhands).toEqual(['row-gap', 'column-gap']);
    expect(css.properties.border?.longhands).toHaveLength(12);
    expect(css.properties['row-gap']?.longhands).toEqual([]);
  });

  it('records browser support from BCD for the current stable Chrome, Firefox and Safari', () => {
    const compat = generatedCompatSchema.parse(loaded.input.files['generated/css-compat.json']);
    const all = (s: { chrome: string | false; firefox: string | false; safari: string | false }) => [s.chrome !== false, s.firefox !== false, s.safari !== false];
    const at = (name: string) => {
      const entry = compat.properties[name];
      if (!entry) throw new Error(`no compat entry for ${name}`);
      return entry;
    };
    const keyword = (name: string, k: string) => {
      const entry = at(name).keywords[k];
      if (!entry) throw new Error(`no compat entry for ${name}: ${k}`);
      return entry;
    };
    // longhands no browser implements, and the coarser properties browsers do implement
    for (const name of ['box-shadow-color', 'box-shadow-offset', 'text-align-all', 'max-lines', 'block-ellipsis', 'continue']) expect(all(at(name))).toEqual([false, false, false]);
    for (const name of ['box-shadow', 'text-align', 'vertical-align', 'font-stretch', 'columns']) expect(all(at(name))).toEqual([true, true, true]);
    expect(all(at('font-width'))).toEqual([false, true, true]);
    expect(all(at('baseline-source'))).toEqual([true, true, false]);
    expect(all(at('column-height'))).toEqual([true, false, false]);
    // a partial implementation is not support
    expect(at('overscroll-behavior-x').safari).toBe(false);
    expect(at('overscroll-behavior-x').why.safari).toMatch(/partial implementation/);
    // a prefixed name is the prefixed form of its BCD entry
    expect(at('-webkit-line-clamp')).toMatchObject({ bcd: 'css.properties.line-clamp', via: 'the -webkit- prefix of line-clamp' });
    expect(all(at('-webkit-line-clamp'))).toEqual([true, true, true]);
    expect(all(at('-webkit-user-select'))).toEqual([true, true, true]);
    expect(all(at('user-select'))).toEqual([true, true, false]);
    expect(at('user-select').why.safari).toMatch(/-webkit- prefix/);
    // keywords: their own BCD entry, or their property's when BCD does not track them and browsers' syntax has them
    expect(all(keyword('flex-wrap', 'balance'))).toEqual([true, false, false]);
    expect(keyword('justify-content', 'center').bcd).toBe('css.properties.justify-content');
    expect(all(keyword('row-gap', 'hairline'))).toEqual([false, false, false]);
    // a keyword that comes from a value type is looked up under css.types
    expect(keyword('color', 'mark')).toMatchObject({ bcd: 'css.types.color.system-color.mark', safari: false });
    // every keyword the syntax names is recorded, not only those valid alone
    expect(keyword('box-shadow', 'inset').bcd).toBe('css.properties.box-shadow.inset');
    // a prefixed value BCD does not track has no support, and a prefixed property's keywords follow the prefixed
    // property
    expect(all(keyword('display', '-moz-box'))).toEqual([false, false, false]);
    expect(all(keyword('-webkit-line-clamp', 'none'))).toEqual([true, true, true]);
    // a type's entry stands for its values only when the browser syntax names them
    expect(all(keyword('object-position', 'block-start'))).toEqual([false, false, false]);
    // type entries are found by their place in css.types, not by any node of the same name
    expect(keyword('color', 'srgb').inFunctions.color ?? keyword('color', 'srgb')).toMatchObject({ bcd: 'css.types.color.color', safari: '15' });
    expect(keyword('box-shadow', 'currentcolor')).toMatchObject({ bcd: 'css.types.color.currentcolor', chrome: '1' });
    // a description is a value's own entry only when it is nothing but the value's name
    expect(all(keyword('font-style', 'oblique'))).toEqual([true, true, true]);
    expect(keyword('color', 'accentcolortext').bcd).toBe('css.types.color.system-color.accentcolor_accentcolortext');
    // functions and syntax forms BCD tracks
    const at2 = (name: string) => {
      const entry = compat.properties[name];
      if (!entry) throw new Error(`no compat entry for ${name}`);
      return entry;
    };
    expect(at2('width').functions['fit-content']).toMatchObject({ bcd: 'css.properties.width.fit-content_function', chrome: false });
    expect(at2('background-image').functions.element?.firefox).toBe(false);
    const colorMix = at2('color').functions['color-mix'];
    if (!colorMix) throw new Error('no compat entry for color-mix()');
    expect(all(colorMix)).toEqual([true, true, true]);
    // a keyword's support inside a function, read as the checker reads it: the function's entry, else the keyword's own
    const inFn = (e: { inFunctions: Record<string, unknown> } | undefined, fn: string) => e?.inFunctions[fn] ?? e;
    expect(inFn(at2('clip-path').keywords.line, 'shape')).toMatchObject({ bcd: null, chrome: false });
    // per function: from is the relative color syntax of each color function
    expect(inFn(at2('color').keywords.from, 'rgb')).toMatchObject({ bcd: 'css.types.color.rgb.relative_syntax', chrome: '122', firefox: '128', safari: '18' });
    expect(inFn(at2('color').keywords['tbd-fg'], 'contrast-color')).toMatchObject({ chrome: false });
    expect(inFn(at2('color').keywords['rec2100-pq'], 'color')).toMatchObject({ chrome: false });
    expect(inFn(at2('color').keywords['display-p3-linear'], 'color')).toMatchObject({ chrome: '144', firefox: '146', safari: '26.2' });
    expect(at2('fill').keywords['context-fill']?.chrome).toBe(false);
    // legacy aliases take their function's entry, found by comparing the renamed grammars
    expect(at2('color').functions.rgba).toMatchObject({ bcd: 'css.types.color.rgb', chrome: '1' });
    expect(at2('transform').functions.rotatex).toMatchObject({ bcd: 'css.types.transform-function.rotateX' });
    expect(at2('transition-timing-function').functions.linear).toMatchObject({ bcd: 'css.types.easing-function.linear-function' });
    // units come from css.types (the type's entry for units it does not list separately)
    expect(compat.units.px).toMatchObject({ bcd: 'css.types.length', chrome: '1' });
    expect(compat.units.dvh).toMatchObject({ bcd: 'css.types.length.viewport_percentage_units_dynamic' });
    expect(compat.units.hz?.chrome).toBe(false);
    expect(at2('clip-path').functions.rect).toMatchObject({ bcd: 'css.types.basic-shape.rect', chrome: '119' });
    expect(at2('background-image').functions.type).toMatchObject({ bcd: 'css.types.image.image-set', firefox: '89', safari: '17' });
    expect(at2('background-image').functions.image).toMatchObject({ bcd: null, chrome: false });
    expect(at2('transition-timing-function').keywords['jump-start']).toMatchObject({ chrome: '77' });
    expect(compat.valueFunctions.calc).toMatchObject({ bcd: 'css.types.calc', chrome: '26' });
    expect(at2('text-overflow').forms.two_value_syntax).toMatchObject({ shape: 'components-2', chrome: false, firefox: '9', safari: false });
  });

  it('offers as "generated" only the keywords all three browsers support', () => {
    const compat = generatedCompatSchema.parse(loaded.input.files['generated/css-compat.json']);
    expect(supportedKeywords(css, compat, 'text-align')).toEqual(['start', 'end', 'left', 'right', 'center', 'justify']);
    expect(supportedKeywords(css, compat, 'flex-wrap')).toEqual(['nowrap', 'wrap', 'wrap-reverse']);
    expect(supportedKeywords(css, compat, 'width')).toEqual(['auto', 'min-content', 'max-content', 'fit-content']);
    expect(supportedKeywords(css, compat, 'column-rule-width')).toEqual(['thin', 'medium', 'thick']);
    expect(supportedKeywords(css, compat, 'color')).not.toContain('Mark');
    expect(supportedKeywords(css, compat, 'object-position')).toEqual(['left', 'center', 'right', 'top', 'bottom']);
    // one definition of "generated" for properties, composites and recipes
    const properties = propertiesFileSchema.parse(loaded.input.files['properties.json']);
    const none = new Set<string>();
    expect(generatedOffer({ properties, css, compat, excludedUnits: none }, 'user-select')).toEqual(['auto', 'text', 'none', 'all']);
    expect(generatedOffer({ properties, css, compat, excludedUnits: none }, 'overflow')).toEqual(supportedKeywords(css, compat, 'overflow'));
    expect(generatedOffer({ properties, css, compat, excludedUnits: none }, 'not-an-id')).toBeNull();
    expect(generatedUnits({ properties, css, compat, excludedUnits: none }, 'width')).toEqual(css.properties.width?.units);
    expect(generatedUnits({ properties, css, compat, excludedUnits: none }, 'line-clamp')).toEqual([]);
    // an excluded unit leaves the list of the property, composite or recipe it is excluded from
    expect(generatedUnits({ properties, css, compat, excludedUnits: none }, 'columns')).toContain('%');
    expect(generatedUnits({ properties, css, compat, excludedUnits: new Set(['columns:%']) }, 'columns')).not.toContain('%');
  });

  it('refuses an HTML placement the content model does not permit', () => {
    expect(htmlRefusal(html, 'ul', 'li')).toBeNull();
    expect(htmlRefusal(html, 'table', 'caption')).toBeNull();
    expect(htmlRefusal(html, 'summary', 'p')).not.toBeNull();
    expect(htmlRefusal(html, 'div', 'li')).not.toBeNull();
    expect(htmlRefusal(html, 'img', 'span')).not.toBeNull();
    expect(htmlRefusal(html, 'form', 'form')).not.toBeNull();
    expect(htmlRefusal(html, 'button', 'a')).not.toBeNull();
  });
});

// Planted fixtures: each one copies the real manifest and plants exactly one defect.
// The unit test proves that every rule of manifest:check fails on its plant, and only on that rule;
// `npm run manifest:check -- --plant <id>` shows the raw failure.
import type { ManifestInput, RuleId } from '../../src/manifest/check.ts';
import { DOCUMENT_VERSION } from '../../src/core/document/model.ts';

type Json = Record<string, unknown>;
interface MutableInput {
  files: Record<string, unknown>;
  catalogues: Record<string, unknown>;
  glossary: unknown;
  fileExists: ManifestInput['fileExists'];
  registered: ManifestInput['registered'];
  documents: ManifestInput['documents'];
}

export interface Plant {
  id: string;
  rule: RuleId;
  description: string;
  apply(input: MutableInput): void;
  // The rules this plant's mutation makes fire as a consequence of its own (a scenario that names a door of a command
  // the plant empties is a door with no command, honestly reported as such): the test allows these beside `rule`, and
  // still fails on any other.
  implies?: readonly RuleId[];
}

const obj = (value: unknown): Json => value as Json;
const list = (value: unknown): Json[] => value as Json[];
const strings = (value: unknown): string[] => value as string[];

function command(input: MutableInput, id: string): Json {
  for (const [file, data] of Object.entries(input.files)) {
    if (!file.startsWith('commands/')) continue;
    const found = list(obj(data).commands).find((c) => c.id === id);
    if (found) return found;
  }
  throw new Error(`plant: no command ${id}`);
}

function feature(input: MutableInput, id: string): Json {
  for (const [file, data] of Object.entries(input.files)) {
    if (!/^features\/\d{2}-/.test(file)) continue;
    const found = list(obj(data).features).find((f) => f.id === id);
    if (found) return found;
  }
  throw new Error(`plant: no feature ${id}`);
}

function door(input: MutableInput, commandId: string, doorId: string): Json {
  const found = list(command(input, commandId).entryPoints).find((d) => d.id === doorId);
  if (!found) throw new Error(`plant: no door ${commandId}#${doorId}`);
  return found;
}

function properties(input: MutableInput): Json {
  return obj(input.files['properties.json']);
}

function property(input: MutableInput, id: string): Json {
  const found = list(properties(input).properties).find((p) => p.id === id);
  if (!found) throw new Error(`plant: no property ${id}`);
  return found;
}

function composite(input: MutableInput, id: string): Json {
  const found = list(properties(input).composites).find((c) => c.id === id);
  if (!found) throw new Error(`plant: no composite ${id}`);
  return found;
}

function recipe(input: MutableInput, id: string): Json {
  const found = list(properties(input).recipes).find((r) => r.id === id);
  if (!found) throw new Error(`plant: no recipe ${id}`);
  return found;
}

// a label of its own, in every catalogue, for a planted property or door, so that it names no other property
function plantedLabel(m: MutableInput, key: string, text: string): string {
  for (const catalogue of Object.values(m.catalogues)) obj(catalogue)[key] = text;
  return key;
}

// an edited property with no door, for plants that only need the property itself
function editedProperty(m: MutableInput, id: string, fields: Json): Json {
  const labelKey = plantedLabel(m, `plant.${id.replace(/^-/, '').replace(/-([a-z])/g, (_x, c: string) => c.toUpperCase())}`, `Planted ${id}`);
  return { id, labelKey, section: 'size', group: 'size', control: 'length-field', icons: {}, valueType: 'length', codec: 'length', appliesTo: 'hasBox', essential: false, doors: [], subsets: [], ...fields };
}

// The generated files are shared by every fixture, read once and frozen (load.ts). A plant that changes one
// copies only the objects on the way to what it changes, and the fixture holds that copy.
export function ownGenerated(input: { files: Record<string, unknown> }, file: string, ...keys: string[]): Json {
  const root = { ...obj(input.files[file]) };
  input.files[file] = root;
  let at = root;
  for (const key of keys) {
    const next = { ...obj(at[key]) };
    at[key] = next;
    at = next;
  }
  return at;
}

function element(input: MutableInput, id: string): Json {
  const found = list(obj(input.files['elements.json']).elements).find((e) => e.id === id);
  if (!found) throw new Error(`plant: no element ${id}`);
  return found;
}

// The planted fixture: a page whose section holds a heading and a paragraph.
const PLANTED_FIXTURE = 'planted-section';
const fixtureFile = `features/fixtures/${PLANTED_FIXTURE}.json`;
const leaf = (id: string, type: string, name: string, tag: string, text: string | null, children: Json[] = []): Json => ({ id, type, name, tag, attributes: {}, classes: [], styles: {}, text, children });

function plantFixture(m: MutableInput): Json {
  const tree = leaf('n1', 'page', 'Page', 'body', null, [leaf('n2', 'section', 'Section', 'section', null, [leaf('n3', 'heading', 'Heading', 'h2', 'Title'), leaf('n4', 'paragraph', 'Paragraph', 'p', 'Body')])]);
  const fixture = { version: DOCUMENT_VERSION, pages: [{ id: 'p1', name: 'Home', file: 'index.html', tree }] };
  m.files[fixtureFile] = fixture;
  return fixture;
}

const step = (door: string, action: boolean, fields: Json = {}): Json => ({ door, args: {}, target: null, drop: null, action, ...fields });

function scenario(id: string, steps: Json[], doors: string[], expect: Json): Json {
  return {
    id,
    setup: {
      fixture: PLANTED_FIXTURE,
      selection: ['/Page/Section/Paragraph'],
      context: 'canvas',
      breakpoint: 'desktop',
      state: 'base',
      locale: 'pt-BR',
      viewport: 'desktop-1440',
      zoom: 'fit',
    },
    steps,
    doors,
    expect: {
      document: [],
      selection: ['/Page/Section/Paragraph'],
      history: { undoSteps: 1, undoRestores: true, redoRestores: true },
      render: null,
      editor: null,
      persistence: null,
      export: null,
      ...expect,
    },
    refusals: [],
  };
}

const RENDERED = { render: { computed: [{ node: '/Page/Section', property: 'display', value: 'block' }], geometry: [], feedback: [] } };

// Two scenarios of delete-element that together run all three of its doors: Delete (or Backspace) removes the
// paragraph; the toast's Undo brings it back. Each plant breaks one thing in them. Returns [delete, undo].
export function plantDeleteScenarios(m: MutableInput): [Json, Json] {
  plantFixture(m);
  const remove = scenario(
    'planted-delete',
    [step('element.delete#key-delete-in-canvas', true)],
    ['element.delete#key-delete-in-canvas', 'element.delete#key-backspace-in-canvas'],
    { document: [{ op: 'remove', path: '/Page/Section/Paragraph' }], selection: ['/Page/Section'], ...RENDERED },
  );
  const undo = scenario('planted-toast-undo', [step('element.delete#key-delete-in-canvas', false), step('history.undo#toast-undo', true)], ['history.undo#toast-undo'], RENDERED);
  feature(m, 'delete-element').scenarios = [remove, undo];
  return [remove, undo];
}

// A scenario of canvas-page-iframe, a feature without commands: the page renders the fixture.
export function plantRenderScenario(m: MutableInput): Json {
  plantFixture(m);
  const render = scenario('planted-render', [step('workspace.toggleLeftDock#key-ctrl-b-in-global', true)], ['workspace.toggleLeftDock#key-ctrl-b-in-global'], RENDERED);
  const f = feature(m, 'canvas-page-iframe');
  f.scenarios = [render];
  return f;
}

export const PLANTS: Plant[] = [
  {
    id: 'feature-without-spec',
    rule: 'schema',
    description: 'undo-redo points at no behaviour section (the audit\'s AUD-18: a feature must have one)',
    apply: (m) => {
      feature(m, 'undo-redo').spec = null;
    },
  },
  {
    id: 'unknown-field',
    rule: 'schema',
    description: 'a feature carries a hand-set "passes" field',
    apply: (m) => {
      feature(m, 'undo-redo').passes = false;
    },
  },
  {
    id: 'missing-field',
    rule: 'schema',
    description: 'the command history.undo has no owner',
    apply: (m) => {
      delete command(m, 'history.undo').owner;
    },
  },
  {
    id: 'duplicate-id',
    rule: 'duplicate-id',
    description: 'a second feature with the id shortcuts-e2e-sweep',
    apply: (m) => {
      const file = obj(m.files['features/20-shortcut-sweep.json']);
      const features = list(file.features);
      features.push(structuredClone(features[0]) as Json);
    },
  },
  {
    id: 'door-unknown-command',
    rule: 'door-unknown-command',
    description: 'a scenario of delete-element runs through a door of the unknown command element.remove',
    apply: (m) => {
      const [remove, undo] = plantDeleteScenarios(m);
      const unknown = structuredClone(remove);
      unknown.id = 'planted-unknown-door';
      unknown.doors = ['element.remove#key-delete-in-canvas'];
      list(unknown.steps)[0] = step('element.remove#key-delete-in-canvas', true);
      feature(m, 'delete-element').scenarios = [remove, undo, unknown];
    },
  },
  {
    id: 'command-without-door',
    rule: 'command-without-door',
    description: 'codePanel.downloadPane has no door',
    implies: ['door-unknown-command'],
    apply: (m) => {
      command(m, 'codePanel.downloadPane').entryPoints = [];
    },
  },
  {
    id: 'i18n-missing-pt-br',
    rule: 'i18n-missing',
    description: 'the key command.undo is missing from the pt-BR catalogue',
    apply: (m) => {
      delete obj(m.catalogues['pt-BR'])['command.undo'];
    },
  },
  {
    id: 'i18n-missing-en',
    rule: 'i18n-missing',
    description: 'the key command.delete is missing from the en catalogue',
    apply: (m) => {
      delete obj(m.catalogues.en)['command.delete'];
    },
  },
  {
    id: 'handler-reference-missing',
    rule: 'handler-reference',
    description: 'inspector.reveal has no handler reference',
    apply: (m) => {
      const file = m.files['references.json'] as { references: { kind: string; id: string }[] };
      file.references = file.references.filter((r) => !(r.kind === 'handler' && r.id === 'inspector.reveal'));
    },
  },
  {
    id: 'command-name-missing',
    rule: 'command-name',
    description: 'style.set, labelled "Set {property} to {value}", has no name without placeholders',
    apply: (m) => {
      delete command(m, 'style.set').nameKey;
    },
  },
  {
    id: 'command-name-with-placeholder',
    rule: 'command-name',
    description: 'the pt-BR name of style.set has a placeholder',
    apply: (m) => {
      obj(m.catalogues['pt-BR'])['command.setProperty.name'] = 'Definir {property}';
    },
    // the placeholders then differ between the two catalogues for that key
    implies: ['i18n-missing'],
  },
  {
    id: 'value-set-unknown-subset',
    rule: 'value-set',
    description: 'the quick panel Weight field offers the list "palette", which font-weight does not declare',
    apply: (m) => {
      obj(obj(door(m, 'style.set', 'quick-panel-font-weight').adapter).offers).list = 'palette';
    },
  },
  {
    id: 'value-set-menu-without-list',
    rule: 'value-set',
    description: 'the Display menu declares no list of values',
    apply: (m) => {
      obj(door(m, 'style.set', 'inspector-display').adapter).offers = null;
    },
  },
  {
    id: 'keyword-rejected-by-syntax',
    rule: 'css-syntax',
    description: 'the background-size presets (All properties and Essentials only) offer "stretch-to-fit", which the official background-size syntax rejects',
    apply: (m) => {
      strings(list(property(m, 'background-size').subsets)[0]?.values).push('stretch-to-fit');
    },
  },
  {
    id: 'door-writes-shorthand',
    rule: 'shorthand-write',
    description: 'a quick panel control writes the gap shorthand instead of row-gap and column-gap',
    // the door runs in one of the quick panel's scenarios (the gap one, of the same command), as every door of a
    // feature with scenarios does, so the plant breaks the shorthand rule alone
    apply: (m) => {
      const gap = list(command(m, 'style.set').entryPoints).find((d) => obj(d).id === 'quick-panel-gap');
      if (gap === undefined) throw new Error('plant: no quick panel gap door');
      obj(obj(gap).adapter).writes = ['gap'];
      // the longhands it wrote are no longer its: the manifest stays consistent with itself
      for (const id of ['row-gap', 'column-gap']) {
        const longhand = list(obj(m.files['properties.json']).properties).find((x) => obj(x).id === id);
        if (longhand !== undefined) obj(longhand).doors = list(obj(longhand).doors).filter((door) => String(door) !== 'style.set#quick-panel-gap');
      }
    },
  },
  {
    id: 'edited-property-unsupported',
    rule: 'browser-support',
    description: 'column-height is edited as a property; only Chrome implements it (Firefox and Safari lack it in css-compat.json)',
    apply: (m) => {
      list(properties(m).properties).push(editedProperty(m, 'column-height', { section: 'layout', group: 'columns', appliesTo: 'container' }));
    },
  },
  {
    id: 'offered-keyword-unsupported',
    rule: 'browser-support',
    description: 'the flex-wrap menu offers, as presets and in Essentials only, a list with balance, which only Chrome supports',
    apply: (m) => {
      property(m, 'flex-wrap').subsets = [{ id: 'menu', values: ['nowrap', 'wrap', 'wrap-reverse', 'balance'], units: null, reason: 'planted' }];
      const offers = obj(obj(door(m, 'style.set', 'inspector-flex-wrap').adapter).offers);
      offers.presets = 'menu';
      offers.essentials = 'menu';
    },
  },
  {
    id: 'prefix-outside-recipe',
    rule: 'vendor-prefix',
    description: '-webkit-text-stroke-width, which all three browsers support, is edited as a plain property instead of inside a recipe',
    apply: (m) => {
      list(properties(m).properties).push(editedProperty(m, '-webkit-text-stroke-width', { section: 'text', group: 'typography', appliesTo: 'text' }));
    },
  },
  {
    id: 'fallback-outside-allowlist',
    rule: 'syntax-fallback',
    description: 'stroke leaves the fallback allowlist, so its default #2b5fe3 (valid only by the browser syntax) is a fallback outside the list',
    apply: (m) => {
      const file = properties(m);
      file.syntaxFallbacks = list(file.syntaxFallbacks).filter((f) => f.property !== 'stroke');
    },
  },
  {
    id: 'recipe-misses-browsers',
    rule: 'recipe',
    description: 'the line clamp recipe writes the unprefixed line-clamp, which no browser ships, instead of -webkit-line-clamp',
    apply: (m) => {
      const unprefix = (name: unknown) => (name === '-webkit-line-clamp' ? 'line-clamp' : name);
      for (const d of list(recipe(m, 'line-clamp').declarations)) d.property = unprefix(d.property);
      const adapter = obj(door(m, 'style.set', 'inspector-line-clamp').adapter);
      adapter.writes = strings(adapter.writes).map((w) => unprefix(w) as string);
    },
  },
  {
    id: 'handle-edits-unknown-field',
    rule: 'structured-value',
    description: 'the shadow blur handle edits the field spread, which a text shadow layer does not have',
    apply: (m) => {
      obj(door(m, 'style.setShadows', 'handle-shadow-blur').adapter).fields = ['spread'];
    },
  },
  {
    id: 'offered-type-keyword-unsupported',
    rule: 'browser-support',
    description: 'the accent-color field offers, as presets and in Essentials only, a list with Mark, a system colour Safari lacks (BCD css.types.color.system-color.mark)',
    apply: (m) => {
      property(m, 'accent-color').subsets = [{ id: 'swatches', values: ['canvastext', 'mark'], units: null, reason: 'planted' }];
      obj(door(m, 'style.set', 'inspector-accent-color').adapter).offers = { property: 'accent-color', list: 'generated', presets: 'swatches', essentials: 'swatches' };
    },
  },
  {
    id: 'recipe-source-not-its-value',
    rule: 'recipe',
    description: 'the line clamp recipe cites css.properties.display, the BCD entry of a fixed declaration, instead of the one carrying the clamp',
    apply: (m) => {
      obj(recipe(m, 'line-clamp').source).bcd = 'css.properties.display';
    },
  },
  {
    id: 'structured-default-as-css-text',
    rule: 'structured-value',
    description: 'the div gets box-shadow "0 1px 2px red" as a CSS-text default, although box-shadow stores typed layers',
    apply: (m) => {
      obj(element(m, 'div').defaultStyles)['box-shadow'] = '0 1px 2px red';
    },
  },
  {
    id: 'wrapper-holds-no-children',
    rule: 'schema',
    description: 'the Row wrapper is a paragraph, an element whose content is text, so it could not hold what it wraps',
    apply: (m) => {
      const wrapper = list(obj(m.files['elements.json']).wrappers).find((w) => w.id === 'row');
      if (!wrapper) throw new Error('plant: no row wrapper');
      wrapper.element = 'paragraph';
    },
  },
  {
    id: 'composite-subset-sets-omitted-longhand',
    rule: 'composite',
    description: 'a columns subset offers "2 auto / 10em", which sets column-height, a longhand the composite omits',
    apply: (m) => {
      composite(m, 'columns').subsets = [{ id: 'presets', values: ['2 auto', '2 auto / 10em'], units: null, reason: 'planted' }];
    },
  },
  {
    id: 'buttons-with-no-supported-keyword',
    rule: 'value-set',
    description: 'Safari loses every text-align keyword in css-compat.json, so the Text align buttons would be empty',
    apply: (m) => {
      const keywords = ownGenerated(m, 'generated/css-compat.json', 'properties', 'text-align', 'keywords');
      for (const [name, k] of Object.entries(keywords)) keywords[name] = { ...obj(k), safari: false, why: { ...obj(obj(k).why), safari: 'planted' } };
      // the door's own Essentials subset would be reported too (browser-support, all-properties): the plant is about
      // the; generated list the buttons draw in All properties
      const align = list(obj(obj(m.files['properties.json']).properties)).find((p) => obj(p).id === 'text-align');
      if (align === undefined) throw new Error('plant: no text-align property');
      obj(align).subsets = [];
      for (const command of list(obj(m.files['commands/style.json']).commands)) {
        for (const door of list(obj(command).entryPoints)) {
          if (obj(door).id === 'inspector-text-align') obj(door).adapter = { ...obj(obj(door).adapter), offers: { ...obj(obj(obj(door).adapter).offers), essentials: null } };
        }
      }
    },
  },
  {
    id: 'global-allowlist-cannot-vouch',
    rule: 'browser-support',
    description: 'an allowlist entry for overflow-x: overlay outside any recipe lets the syntax through, but cannot make a value no browser supports acceptable',
    apply: (m) => {
      list(properties(m).syntaxFallbacks).push({ property: 'overflow-x', values: ['overlay'], recipe: null, reason: 'planted' });
      obj(element(m, 'div').defaultStyles)['overflow-x'] = 'overlay';
    },
  },
  {
    id: 'written-function-unsupported',
    rule: 'browser-support',
    description: 'a width subset offers fit-content(10px); BCD css.properties.width.fit-content_function has no browser',
    apply: (m) => {
      property(m, 'width').subsets = [{ id: 'presets', values: ['auto', 'fit-content(10px)'], units: null, reason: 'planted' }];
    },
  },
  {
    id: 'written-untracked-function',
    rule: 'browser-support',
    description: 'a color subset offers device-cmyk(0 0 0 1); BCD tracks no device-cmyk() and no browser implements it',
    apply: (m) => {
      property(m, 'color').subsets = [{ id: 'swatches', values: ['red', 'device-cmyk(0 0 0 1)'], units: null, reason: 'planted' }];
    },
  },
  {
    id: 'offered-unit-unsupported',
    rule: 'browser-support',
    description: 'Safari loses the rcap unit in css-compat.json, and a width subset offers it',
    apply: (m) => {
      const rcap = ownGenerated(m, 'generated/css-compat.json', 'units', 'rcap');
      rcap.safari = false;
      rcap.why = { ...obj(rcap.why), safari: 'planted' };
      property(m, 'width').subsets = [{ id: 'units', values: null, units: ['px', 'rcap'], reason: 'planted' }];
    },
  },
  {
    id: 'written-form-unsupported',
    rule: 'browser-support',
    description: 'a text-overflow subset offers "clip ellipsis"; the two-value syntax (BCD two_value_syntax) is Firefox only',
    apply: (m) => {
      property(m, 'text-overflow').subsets = [{ id: 'presets', values: ['ellipsis', 'clip ellipsis'], units: null, reason: 'planted' }];
    },
  },
  {
    id: 'recipe-writes-shorthand-of-edited-longhands',
    rule: 'recipe',
    description: 'the line clamp recipe also declares overflow: hidden, a second writer of its own overflow-x and overflow-y',
    apply: (m) => {
      list(recipe(m, 'line-clamp').declarations).push({ property: 'overflow', value: 'hidden' });
      strings(obj(door(m, 'style.set', 'inspector-line-clamp').adapter).writes).push('overflow');
    },
  },
  {
    id: 'shorthand-whose-longhands-browsers-implement',
    rule: 'shorthand-write',
    description: 'inset-block is edited whole although Chrome, Firefox and Safari implement both its longhands',
    apply: (m) => {
      list(properties(m).properties).push(editedProperty(m, 'inset-block', { section: 'position', group: 'position', appliesTo: 'positioned' }));
    },
  },
  {
    id: 'stored-shorthand-and-its-longhand',
    rule: 'shorthand-write',
    description: 'text-align is stored whole, and its longhand text-align-last is edited as well',
    apply: (m) => {
      list(properties(m).properties).push(editedProperty(m, 'text-align-last', { section: 'text', group: 'typography', appliesTo: 'text', control: 'keyword-menu', valueType: 'keyword', codec: 'keyword' }));
    },
  },
  {
    id: 'handle-writes-transform',
    rule: 'individual-transform',
    description: 'the rotation handle writes transform instead of rotate',
    apply: (m) => {
      obj(door(m, 'style.set', 'handle-rotate').adapter).writes = ['transform'];
      const rotate = property(m, 'rotate');
      rotate.doors = strings(rotate.doors).filter((d) => d !== 'style.set#handle-rotate');
      strings(property(m, 'transform').doors).push('style.set#handle-rotate');
    },
  },
  {
    id: 'coupling-unknown-predicate',
    rule: 'coupling',
    description: 'the border width coupling asks the predicate "styleIsNone", which is not in the closed list',
    apply: (m) => {
      obj(list(properties(m).couplings)[0]?.condition).predicate = 'styleIsNone';
    },
  },
  {
    id: 'field-without-consumer',
    rule: 'consumer',
    description: 'no module reads the coalescing rule of a command',
    apply: (m) => {
      const file = obj(m.files['consumers.json']);
      file.consumers = list(file.consumers).filter((c) => c.field !== 'commands:commands[].history.coalesce');
    },
  },
  {
    id: 'quick-panel-unknown-group',
    rule: 'quick-panel-group',
    description: 'the quick panel Width field names a group the layout does not list',
    apply: (m) => {
      const door = list(command(m, 'style.set').entryPoints).find((d) => obj(d).id === 'quick-panel-width');
      obj(door).group = 'dimensions';
    },
  },
  {
    id: 'field-holds-expression',
    rule: 'no-logic',
    description: 'the availability of Undo is written as the expression "canUndo && !editingText"',
    apply: (m) => {
      obj(command(m, 'history.undo').availability).predicate = 'canUndo && !editingText';
    },
  },
  {
    id: 'reference-not-planned',
    rule: 'reference',
    description: 'row-gap names the codec "length-percentage-v2", which is neither planned nor registered',
    apply: (m) => {
      property(m, 'row-gap').codec = 'length-percentage-v2';
    },
  },
  {
    id: 'composite-leaves-out-longhand',
    rule: 'composite',
    description: 'the padding composite leaves out padding-left, which the padding shorthand sets',
    apply: (m) => {
      const padding = composite(m, 'padding');
      padding.longhands = strings(padding.longhands).filter((l) => l !== 'padding-left');
      // the doors that wrote it follow the composite, and the property's own list too: the manifest stays consistent
      // with itself, so the plant trips its one rule
      for (const entry of list(command(m, 'style.set').entryPoints)) {
        const adapter = obj(entry).adapter;
        if (adapter === undefined) continue;
        obj(adapter).writes = list(obj(adapter).writes).filter((w) => String(w) !== 'padding-left');
      }
      const left = list(obj(m.files['properties.json']).properties).find((x) => obj(x).id === 'padding-left');
      if (left !== undefined) obj(left).doors = list(obj(left).doors).filter((door) => String(door) !== 'style.set#quick-panel-padding');
    },
  },
  {
    id: 'property-misses-a-door',
    rule: 'door-writes',
    description: 'width does not list the quick panel W field, which writes it',
    apply: (m) => {
      const width = property(m, 'width');
      width.doors = strings(width.doors).filter((d) => d !== 'style.set#quick-panel-width');
    },
  },
  {
    id: 'gesture-without-transaction',
    rule: 'history',
    description: 'resizing records one transaction per pointer event instead of one per gesture',
    apply: (m) => {
      obj(command(m, 'geometry.resize').history).transaction = 'per-dispatch';
    },
  },
  {
    id: 'natural-child-refused-by-html',
    rule: 'html-model',
    description: 'a Summary creates a Paragraph as its natural child; HTML permits only phrasing and headings in <summary>',
    apply: (m) => {
      element(m, 'summary').naturalChild = 'paragraph';
    },
  },
  {
    id: 'chord-conflict',
    rule: 'chord-conflict',
    description: 'Preview also binds Shift+Ctrl+z anywhere, the chord of Redo',
    // Preview's own global shortcut rebound to the chord (the door preview-mode's scenarios run: rebinding it adds no
    // door they leave out)
    apply: (m) => {
      const preview = command(m, 'view.enterPreview');
      const doors = list(preview.entryPoints);
      const shortcut = doors.find((d) => d.kind === 'shortcut' && d.context === 'global') as { chord?: string } | undefined;
      if (shortcut === undefined) throw new Error('chord-conflict: Preview has no global shortcut');
      shortcut.chord = 'Shift+Ctrl+z';
    },
  },
  {
    id: 'modifier-conflict',
    rule: 'modifier-conflict',
    description: 'while resizing, Alt also suspends snapping (report PG-14)',
    apply: (m) => {
      const gestures = list(obj(m.files['interactions.json']).gestures);
      const resize = gestures.find((g) => g.id === 'resize');
      if (!resize) throw new Error('plant: no resize gesture');
      list(resize.modifiers).push({ key: 'Alt', meaning: 'suspend-snapping' });
    },
  },
  {
    id: 'feature-needs-later-command',
    rule: 'order',
    description: 'undo-redo needs clipboard.cut, introduced much later by clipboard-cut-system',
    apply: (m) => {
      strings(feature(m, 'undo-redo').commands).push('clipboard.cut');
    },
  },
  {
    id: 'feature-needs-later-feature',
    rule: 'order',
    description: 'select-click depends on hide-element, which comes later',
    apply: (m) => {
      strings(feature(m, 'select-click').dependsOn).push('hide-element');
    },
  },
  {
    id: 'spec-missing',
    rule: 'spec-missing',
    description: 'delete-element points to spec/BEHAVIOUR.md#delete-elements, which does not exist',
    apply: (m) => {
      feature(m, 'delete-element').spec = 'spec/BEHAVIOUR.md#delete-elements';
    },
  },
  {
    id: 'scenario-without-terminal',
    rule: 'scenario-terminal',
    description: 'a scenario of delete-element expects no render, no editor measure, no persistence and no export',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(remove.expect).render = null;
    },
  },
  {
    id: 'editor-terminal-without-measure',
    rule: 'scenario-terminal',
    description: 'a scenario of delete-element ends only on an editor terminal that measures nothing',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      Object.assign(obj(remove.expect), { render: null, editor: { regions: [], computed: [] } });
    },
  },
  {
    id: 'persistence-of-nothing',
    rule: 'scenario-terminal',
    description: 'a scenario of delete-element ends only on a reload that keeps neither the document nor the preferences',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      Object.assign(obj(remove.expect), { render: null, persistence: { reload: 'immediate', document: null, preferences: null } });
    },
  },
  {
    id: 'editor-region-unknown',
    rule: 'unknown-reference',
    description: 'a scenario measures the width of "side-bar", which is no region of layout.json',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(remove.expect).editor = { regions: [{ region: 'side-bar', measure: 'width', relation: 'equals', value: 224, reference: null }], computed: [] };
    },
  },
  {
    id: 'fixture-file-missing',
    rule: 'fixture',
    description: 'a scenario of delete-element starts from the fixture "no-such-fixture", which has no file',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(remove.setup).fixture = 'no-such-fixture';
    },
  },
  {
    id: 'fixture-breaks-model',
    rule: 'fixture',
    description: 'the planted fixture holds a node of the element type "banner", which elements.json does not have',
    apply: (m) => {
      plantDeleteScenarios(m);
      const tree = obj(list(obj(m.files[fixtureFile]).pages)[0]).tree;
      obj(list(obj(list(obj(tree).children)[0]).children)[0]).type = 'banner';
    },
  },
  {
    id: 'setup-path-not-in-fixture',
    rule: 'document-path',
    description: 'a scenario selects /Page/Section/Caption, which the fixture does not have',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(remove.setup).selection = ['/Page/Section/Caption'];
    },
  },
  {
    id: 'expect-path-removed-by-diff',
    rule: 'document-path',
    description: 'a scenario expects /Page/Section/Paragraph selected after its own diff removed it',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(remove.expect).selection = ['/Page/Section/Paragraph'];
    },
  },
  {
    id: 'diff-path-unresolved',
    rule: 'document-path',
    description: 'a scenario removes /Page/Aside, which the fixture does not have',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(remove.expect).document = [{ op: 'remove', path: '/Page/Aside' }];
    },
  },
  {
    id: 'diff-node-value-with-id',
    rule: 'document-path',
    description: 'a scenario sets /Page/Section/Heading to a node value that names its id, although ids are generated',
    apply: (m) => {
      const [, undo] = plantDeleteScenarios(m);
      obj(undo.expect).document = [{ op: 'set', path: '/Page/Section/Heading', value: leaf('n3', 'heading', 'Heading', 'h2', 'New title') }];
    },
  },
  {
    id: 'step-target-unresolved',
    rule: 'document-path',
    description: 'a step of a scenario acts on /Page/Footer, which neither the fixture nor the result has',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(list(remove.steps)[0]).target = '/Page/Footer';
    },
  },
  {
    id: 'step-argument-unknown',
    rule: 'step',
    description: 'the action step of a scenario gives element.delete the argument "force", which the command does not have',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(list(remove.steps)[0]).args = { force: true };
    },
  },
  {
    id: 'hold-never-released',
    rule: 'step',
    description: 'a scenario holds a canvas drag of the heading and never releases or cancels it',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      (remove.steps as Json[]).unshift(step('element.moveTo#canvas-drag-canvas-element-before-after', false, { args: { parent: '/Page/Section', index: 1 }, target: '/Page/Section/Heading', drop: { placement: 'after', reference: '/Page/Section/Paragraph' }, hold: true }));
    },
  },
  {
    id: 'release-without-hold',
    rule: 'step',
    description: 'a scenario releases a canvas drag that no earlier step holds',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      (remove.steps as Json[]).unshift(step('element.moveTo#canvas-drag-canvas-element-before-after', false));
    },
  },
  {
    id: 'hold-on-a-key',
    rule: 'step',
    description: 'a scenario holds the Delete key as if it were a drag',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(list(remove.steps)[0]).hold = true;
    },
  },
  {
    id: 'typed-text-not-text',
    rule: 'schema',
    description: 'a step types the number 42 instead of characters',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      obj(list(remove.steps)[0]).type = 42;
    },
  },
  {
    id: 'required-argument-missing',
    rule: 'step',
    description: 'a step clicks the heading on the canvas without the target node selection.select needs',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      (remove.steps as Json[]).unshift(step('selection.select#canvas-click-element-or-page', false, { target: '/Page/Section/Heading' }));
    },
  },
  {
    id: 'gesture-argument-given',
    rule: 'step',
    description: 'a marquee step writes the band rectangle, which the gesture produces',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      (remove.steps as Json[]).unshift(step('selection.marquee#canvas-drag-empty-area-page-or-container', false, { args: { mode: 'replace', rect: { x: 0, y: 0, width: 10, height: 10 } }, target: '/Page/Section' }));
    },
  },
  {
    id: 'two-action-steps',
    rule: 'step',
    description: 'a scenario marks both of its steps as the action step',
    apply: (m) => {
      const [, undo] = plantDeleteScenarios(m);
      obj(list(undo.steps)[0]).action = true;
    },
  },
  {
    id: 'door-in-no-scenario',
    rule: 'door-coverage',
    description: 'the scenarios of delete-element leave out its Backspace door',
    apply: (m) => {
      const [remove] = plantDeleteScenarios(m);
      remove.doors = ['element.delete#key-delete-in-canvas'];
    },
  },
  {
    id: 'tooth-proof-without-module',
    rule: 'tooth-proof',
    description: 'canvas-page-iframe has a scenario and no commands, and names no module for its tooth proof',
    apply: (m) => {
      delete plantRenderScenario(m).toothProof;
    },
  },
  {
    id: 'tooth-proof-module-unknown',
    rule: 'tooth-proof',
    description: 'canvas-page-iframe names src/core/render/renderer.ts for its tooth proof, a file the project does not hold',
    apply: (m) => {
      plantRenderScenario(m).toothProof = 'src/core/render/renderer.ts';
    },
  },
  {
    id: 'unknown-reference',
    rule: 'unknown-reference',
    description: 'an inspector field edits the unknown property display-mode',
    apply: (m) => {
      door(m, 'style.set', 'inspector-display').property = 'display-mode';
    },
  },
  {
    id: 'feature-command-link',
    rule: 'feature-command-link',
    description: 'layers-expand-collapse-all introduces layers.expandAll but does not list it',
    apply: (m) => {
      const expand = feature(m, 'layers-expand-collapse-all');
      expand.commands = strings(expand.commands).filter((c) => c !== 'layers.expandAll');
    },
  },
];

// The placement rules of PRODUCT.md §5.3: every door has a region, a state is never chosen on the canvas frame or
// the canvas toolbar, and no label names two CSS properties.
PLANTS.push(
  {
    id: 'door-unplaced',
    rule: 'placement',
    description: 'the top bar Undo button is still unplaced',
    apply: (m) => {
      door(m, 'history.undo', 'toolbar-top-bar').placement = 'unplaced';
    },
  },
  {
    id: 'concept-row-twice',
    rule: 'concept-row',
    description: 'the outline offset stands in two concept rows',
    apply: (m) => {
      const props = obj(m.files['properties.json']);
      const rows = list(props.conceptRows);
      const radius = rows.find((r) => r.id === 'radius');
      if (radius === undefined) throw new Error('plant concept-row-twice: no radius row');
      radius.details = [...strings(radius.details), 'style.set#inspector-outline-offset'];
    },
  },
  {
    id: 'style-control-unplaced',
    rule: 'style-door-section',
    description: 'the custom declarations lose their place in properties.json controls',
    apply: (m) => {
      const props = obj(m.files['properties.json']);
      props.controls = list(props.controls).filter((c) => c.door !== 'style.setCustomDeclarations#inspector-custom-declarations');
    },
  },
  {
    id: 'menu-label-twice',
    rule: 'placement',
    description: 'two items of the zoom menu read the same',
    apply: (m) => {
      const items = list(command(m, 'view.zoomTo').entryPoints).filter((d) => d.kind === 'menu');
      const [first, second] = items;
      if (first === undefined || second === undefined) throw new Error('plant menu-label-twice: the zoom menu has fewer than two items');
      second.labelKey = first.labelKey;
    },
  },
  {
    id: 'state-door-on-canvas-toolbar',
    rule: 'state-placement',
    description: 'a Hover state button is drawn on the canvas toolbar (a state belongs to the class, not the page)',
    // the Hover item of the State menu moved onto the canvas toolbar, as a toolbar button (the door the state-styles
    // scenarios run: moving it adds no door they leave out)
    apply: (m) => {
      const doors = list(command(m, 'view.setStyleState').entryPoints);
      const at = doors.findIndex((d) => (d as { id?: string }).id === 'menu-style-state-hover');
      if (at < 0) throw new Error('state-door-on-canvas-toolbar: no Hover item in the State menu');
      doors[at] = {
        id: 'menu-style-state-hover',
        kind: 'toolbar',
        feature: 'state-styles',
        drawnAs: 'button',
        pressed: false,
        labelKey: 'styleState.hover',
        faceLabelKey: null,
        icon: 'mouse-pointer-2',
        disabledReasonKey: 'common.notAvailableYet',
        placement: { region: 'canvas-toolbar', order: 16 },
        adapter: { selection: 'none', offers: null, writes: [], fields: [] },
        args: { state: 'hover' },
      };
    },
  },
  {
    id: 'inspector-subset-in-all-properties',
    rule: 'all-properties',
    description: 'the inspector Direction field offers only row and column in All properties (All properties offers every value of the catalogue)',
    apply: (m) => {
      property(m, 'flex-direction').subsets = [{ id: 'row-column', values: ['row', 'column'], units: null, reason: 'planted' }];
      obj(door(m, 'style.set', 'inspector-flex-direction').adapter).offers = { property: 'flex-direction', list: 'row-column', presets: null, essentials: null };
    },
  },
  {
    id: 'essentials-value-missing-from-all-properties',
    rule: 'all-properties',
    description: 'the inspector Font field offers the font stacks in Essentials only but not in All properties (it lost its presets)',
    apply: (m) => {
      obj(obj(door(m, 'style.set', 'inspector-font-family').adapter).offers).presets = null;
    },
  },
  {
    id: 'icon-not-in-library',
    rule: 'icon-name',
    description: 'the top bar Undo button names the icon "undo-3", which Lucide does not have',
    apply: (m) => {
      door(m, 'history.undo', 'toolbar-top-bar').icon = 'undo-3';
    },
  },
  {
    id: 'toolbar-door-without-icon',
    rule: 'icon-required',
    description: 'the top bar Undo button names no icon, so the shell would have to pick one',
    apply: (m) => {
      door(m, 'history.undo', 'toolbar-top-bar').icon = null;
    },
  },
  {
    id: 'panel-button-without-icon',
    rule: 'icon-required',
    description: 'the Add a page icon button of the Explorer names no icon',
    apply: (m) => {
      door(m, 'pages.add', 'explorer-add-page').icon = null;
    },
  },
  {
    id: 'panel-missing-from-layout',
    rule: 'panel',
    description: 'layout.json leaves out the Document panel, so the shell would have to name and place it in code',
    apply: (m) => {
      delete obj(obj(m.files['layout.json']).panels).document;
    },
  },
  {
    id: 'two-sidebar-views-open',
    rule: 'panel',
    description: 'both Insert and the Explorer are open at the first start, and the sidebar shows one view',
    apply: (m) => {
      obj(obj(obj(m.files['layout.json']).panels).explorer).open = true;
    },
  },
  {
    id: 'default-theme-unknown',
    rule: 'unknown-reference',
    description: 'environment.json gives a fresh profile the theme "sepia", which preferences.setTheme does not offer',
    apply: (m) => {
      obj(obj(m.files['environment.json']).theme).default = 'sepia';
    },
  },
  {
    id: 'exclusion-without-evidence',
    rule: 'exclusion',
    description: 'css-exclusions.json excludes text-decoration-line: blink without saying what shows it does nothing',
    apply: (m) => {
      const entry = list(obj(m.files['css-exclusions.json']).exclusions).find((x) => x.property === 'text-decoration-line');
      obj(obj(entry).evidence).note = '';
    },
  },
  {
    id: 'excluded-value-offered',
    rule: 'exclusion',
    description: 'the break-before field offers region among its presets, which no browser implements',
    apply: (m) => {
      list(property(m, 'break-before').subsets).push({ id: 'planted-presets', values: ['region'], units: null, reason: 'planted' });
      obj(obj(door(m, 'style.set', 'inspector-break-before').adapter).offers).presets = 'planted-presets';
    },
  },
  {
    id: 'excluded-unit-offered',
    rule: 'exclusion',
    description: 'the columns field offers the unit % among its presets, which Chrome refuses',
    apply: (m) => {
      list(composite(m, 'columns').subsets).push({ id: 'planted-presets', values: null, units: ['%'], reason: 'planted' });
      obj(obj(door(m, 'style.set', 'inspector-columns').adapter).offers).presets = 'planted-presets';
    },
  },
  {
    id: 'switch-not-pressed',
    rule: 'pressed',
    description: 'the Rulers switch of Guides & Grids (drawn as a toggle) does not say whether it is on',
    apply: (m) => {
      door(m, 'view.toggleRulers', 'guides-grids-rulers').pressed = false;
    },
  },
  {
    id: 'pressed-on-a-tab',
    rule: 'pressed',
    description: 'the Desktop breakpoint tab says pressed, though a tab says its state by being a tab',
    apply: (m) => {
      door(m, 'view.setBreakpoint', 'toolbar-breakpoint-tabs-desktop').pressed = true;
    },
  },
  {
    id: 'pressed-disagrees',
    rule: 'pressed',
    description: 'the column grid button of the canvas tools says it is no toggle, while its Guides & Grids switch says it is',
    apply: (m) => {
      door(m, 'grid.toggleColumns', 'canvas-tools-column-grid').pressed = false;
    },
  },
  {
    id: 'inspector-field-drawn-as-tab',
    rule: 'schema',
    description: 'the Spread button of the inspector is drawn as a tab, which the inspector does not draw',
    apply: (m) => {
      door(m, 'style.set', 'inspector-justify-content-spread-button').drawnAs = 'tab';
    },
  },
  {
    id: 'zoom-before-zoom-doors',
    rule: 'zoom',
    description: 'a scenario of delete-element starts at a canvas zoom of 50 % although zoom-keyboard-buttons is not built',
    apply: (m) => {
      unbuildZoom(m);
      const [remove] = plantDeleteScenarios(m);
      obj(remove.setup).zoom = 50;
    },
  },
  {
    id: 'label-names-two-properties',
    rule: 'label-term',
    description: 'pt-BR labels gap "Preenchimento", the term of the SVG fill (the mockups used it for padding and fill)',
    apply: (m) => {
      obj(m.catalogues['pt-BR'])['property.gap'] = 'Preenchimento';
    },
  },
);

// The zoom doors' commands made unbuilt, as before zoom-keyboard-buttons: no handler registered, each reference
// planned, and every scenario starting at Fit, as they all did then.
export const ZOOM_COMMANDS = ['view.zoomIn', 'view.zoomOut', 'view.zoomReset', 'view.zoomTo', 'view.zoomFit'];
export function unbuildZoom(m: MutableInput): void {
  m.registered = { ...m.registered, handler: m.registered.handler.filter((id) => !ZOOM_COMMANDS.includes(id)) };
  for (const r of (m.files['references.json'] as { references: { kind: string; id: string; status: string }[] }).references) {
    if (r.kind === 'handler' && ZOOM_COMMANDS.includes(r.id)) r.status = 'planned';
  }
  for (const [file, json] of Object.entries(m.files)) {
    if (!file.startsWith('features/') || file.startsWith('features/fixtures/')) continue;
    for (const feature of list(obj(json).features)) for (const s of list(obj(feature).scenarios)) obj(obj(s).setup).zoom = 'fit';
  }
}

// A fixture copies the hand-written files and shares the generated ones (ownGenerated copies what a plant changes).
export function planted(input: ManifestInput, plant: Plant): ManifestInput {
  const copy: MutableInput = {
    files: Object.fromEntries(Object.entries(input.files).map(([file, json]) => [file, file.startsWith('generated/') ? json : structuredClone(json)])),
    catalogues: structuredClone(input.catalogues) as Record<string, unknown>,
    glossary: structuredClone(input.glossary),
    fileExists: input.fileExists,
    registered: input.registered,
    documents: { ...input.documents },
  };
  plant.apply(copy);
  return copy;
}

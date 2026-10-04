// Every scenario can be run as written: its fixture, document paths, steps, door coverage and tooth proof.
import { rulesFromManifest, validateDocument } from '../../core/document/validate.ts';
import { migrateDocument } from '../../core/document/migrations.ts';
import type { DocumentJson } from '../../core/document/model.ts';
import { EMPTY_FIXTURE, applyDiff, emptyProject, parsePath, resolveNode, withStandInIds } from '../scenario.ts';
import { GESTURE_DOOR_KINDS, type Command, type Scenario } from '../schema.ts';
import type { CheckContext } from './context.ts';
import { isNumbers } from './base.ts';

// ---- fixture, document-path, step, door-coverage, tooth-proof: every scenario can be run as written
export function scenariosRules(ctx: CheckContext) {
  const {
    p,
    report,
    features,
    commandById,
    doors,
    doorByRef,
    attributeById,
    paletteEntryIds,
    propertyById,
    compositeById,
    recipeById,
    breakpointIds,
    stateIds,
    input,
  } = ctx;
  const modelRules = rulesFromManifest(p.elements, p.properties, p.html);
  const rootLabel = p.elements.elements.find((e) => e.id === modelRules.root.type)?.labelKey ?? '';
  // fixture: every fixture file is a project document the model accepts
  const fixtureDocs = new Map<string, unknown>();
  for (const [id, json] of p.fixtures) {
    const file = `features/fixtures/${id}.json`;
    if (json === null || typeof json !== 'object' || Array.isArray(json) || !Array.isArray((json as { pages?: unknown }).pages)) {
      report('fixture', file, '', 'a fixture is a project document: { "version", "pages" } in the model of src/core/document/model.ts');
      continue;
    }
    // a fixture is read as File › Open reads a saved project: carried to the current format first (migrations.ts)
    const migrated = migrateDocument(json);
    if (!migrated.ok) {
      report('fixture', file, '/version', `a fixture the app cannot read (${migrated.reason})`);
      continue;
    }
    const invalid = validateDocument(migrated.document as DocumentJson, [], modelRules);
    for (const problem of invalid) report('fixture', file, problem.path, problem.message);
    if (invalid.length === 0) fixtureDocs.set(id, migrated.document);
  }
  const textOf = (locale: string, key: string): string => {
    const catalogue = input.catalogues[locale];
    const text = catalogue !== null && typeof catalogue === 'object' ? (catalogue as Record<string, unknown>)[key] : undefined;
    return typeof text === 'string' ? text : key;
  };
  // the fixture a scenario starts from: a file, or the empty project a fresh profile gets in its locale
  const fixtureOf = (f: (typeof features)[number], si: number, s: Scenario): unknown => {
    const id = s.setup.fixture;
    // the saved record made unreadable (setup.storage): the editor starts again on the empty project, the recovery
    // dialog over it, and that is the document the steps start from (tools/runner/scenarios.ts setUp)
    if (id === EMPTY_FIXTURE || s.setup.storage === 'corrupt-current-record') return emptyProject({ page: textOf(s.setup.locale, 'pages.defaultHome'), root: textOf(s.setup.locale, rootLabel) }, modelRules.root);
    if (!p.fixtures.has(id)) {
      report('fixture', f.file, `${f.path}.scenarios[${si}].setup.fixture`, `no fixture file manifest/features/fixtures/${id}.json (only "${EMPTY_FIXTURE}" needs none)`);
      return null;
    }
    return fixtureDocs.get(id) ?? null;
  };
  const unresolved = (doc: unknown, nodePath: string): string | null => {
    const found = resolveNode(doc, parsePath(nodePath).nodes);
    return typeof found === 'string' ? found : null;
  };
  const armCheck = (doc: unknown, file: string, path: string, nodePath: string, when: string) => {
    const why = unresolved(doc, nodePath);
    if (why !== null) report('document-path', file, path, `${nodePath} does not resolve ${when}: ${why}`);
  };
  // a step acts on the fixture or on the result of the diff, so its node paths resolve in one of them
  const eitherCheck = (before: unknown, after: unknown, file: string, path: string, nodePath: string) => {
    const why = unresolved(before, nodePath);
    if (why !== null && unresolved(after, nodePath) !== null) report('document-path', file, path, `${nodePath} resolves neither in the fixture nor after the diff: ${why}`);
  };
  const nodeValue = (value: unknown): value is string => typeof value === 'string' && /^(\/[^/@][^/]*)+$/.test(value);
  // what the runner hands the file chooser (schema.ts stepSchema): a fixture, the last download, JSON text, an image
  // file the runner has on hand ("png:<name>", the 4x3 PNG its chooser serves; spec explorer-assets), or a file of
  // manifest/features/fixtures/import/ the import fixtures read ("import:<name>"; the manifest's html-import group)
  const fileValueProblem = (value: unknown): string | null => {
    const text = typeof value === 'string' ? value : null;
    const fixture = text === null ? null : /^fixture:([a-z0-9-]+)$/.exec(text);
    if (fixture) return p.fixtures.has(fixture[1] ?? '') ? null : `names no fixture of manifest/features/fixtures/`;
    const imported = text === null ? null : /^import:([^/\\]+)$/.exec(text);
    if (imported) return input.fileExists(`manifest/features/fixtures/import/${imported[1] ?? ''}`) ? null : `names no file of manifest/features/fixtures/import/`;
    const folder = text === null ? null : /^folder:([a-z0-9-]+)$/.exec(text);
    if (folder) return input.fileExists(`tests/support/folders/${folder[1] ?? ''}`) ? null : `names no folder under tests/support/folders/`;
    return text === 'download' || (text !== null && text.startsWith('json:') && text.length > 5) || (text !== null && /^png:[^/\\]+\.png$/.test(text)) || (text !== null && /^woff2:[^/\\]+\.woff2$/.test(text))
      ? null
      : 'is "fixture:<id>", "download", "json:<text>", "png:<name>.png", "woff2:<name>.woff2", "folder:<id>" or "import:<name>"';
  };
  const argProblem = (arg: Command['args'][string], value: unknown): string | null => {
    const text = typeof value === 'string' ? value : null;
    const num = typeof value === 'number' ? value : null;
    switch (arg.type) {
      case 'node':
        return nodeValue(value) ? null : 'is a node path';
      case 'nodes':
        return Array.isArray(value) && value.every(nodeValue) ? null : 'is a list of node paths';
      case 'string':
      case 'color':
      case 'path':
        return text !== null ? null : 'is a string';
      // what the runner hands the file chooser (schema.ts stepSchema): a fixture, the last download, JSON text, an
      // image or a font the runner has on hand ("png:<name>", the 4x3 PNG its chooser serves; "woff2:<name>", its
      // test font; spec explorer-assets, custom-fonts), a whole folder of tests/support/folders (spec
      // explorer-open-folder) or a file of the import fixtures
      case 'file':
        return fileValueProblem(value);
      // several files at once (File › Import HTML): each value is one the chooser resolves, as for a single file
      case 'files': {
        if (!Array.isArray(value) || value.length === 0) return 'is a list of file values';
        for (const one of value) {
          const problem = fileValueProblem(one);
          if (problem !== null) return problem;
        }
        return null;
      }
      case 'number':
        return num !== null ? null : 'is a number';
      case 'integer':
        return num !== null && Number.isInteger(num) ? null : 'is an integer';
      case 'boolean':
        return typeof value === 'boolean' ? null : 'is true or false';
      case 'enum':
        return text !== null && arg.values.includes(text) ? null : `is one of ${arg.values.join(', ')}`;
      case 'palette-entry':
        return text !== null && paletteEntryIds.has(text) ? null : 'is a palette entry of elements.json';
      case 'property':
        return text !== null && (propertyById.has(text) || compositeById.has(text) || recipeById.has(text)) ? null : 'is a property, composite or recipe of properties.json';
      case 'attribute':
        return text !== null && attributeById.has(text) ? null : 'is an attribute of elements.json';
      // a project makes breakpoints of its own (spec project-breakpoints): a step may name one by its id
      case 'breakpoint':
        return text !== null && (breakpointIds.has(text) || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(text)) ? null : 'is a breakpoint id: one of properties.json or one the project makes';
      case 'state':
        return text !== null && stateIds.has(text) ? null : 'is a state of properties.json';
      case 'point':
        return isNumbers(value, ['x', 'y']) ? null : 'is { "x", "y" }';
      case 'rect':
        return isNumbers(value, ['x', 'y', 'width', 'height']) ? null : 'is { "x", "y", "width", "height" }';
      default:
        return null;
    }
  };

  for (const f of features) {
    const scenarios = f.feature.scenarios;
    scenarios.forEach((s, si) => {
      const at = `${f.path}.scenarios[${si}]`;
      const before = fixtureOf(f, si, s);
      // step: exactly one action step, whose door is one of `doors`, and every door of `doors` is a door of its
      // command
      const actions = s.steps.filter((step) => step.action);
      if (actions.length !== 1) report('step', f.file, `${at}.steps`, `scenario ${s.id} has ${actions.length} action steps: exactly one step is the action step`);
      const action = actions[0];
      if (action !== undefined) {
        const actionCommand = action.door.split('#')[0] ?? '';
        if (!s.doors.includes(action.door)) report('step', f.file, `${at}.steps`, `the action step's door ${action.door} is not one of the scenario's doors`);
        s.doors.forEach((doorRef, di) => {
          const command = doorRef.split('#')[0] ?? '';
          if (commandById.has(command) && command !== actionCommand) report('step', f.file, `${at}.doors[${di}]`, `${doorRef} is not a door of ${actionCommand}, the action step's command: the doors of a scenario are alternatives for its action step`);
        });
      }
      // held drags: a hold ends at a release on its door or at drag.cancel; a release ends a hold. A panel drag is
      // pressed on the control its arguments stand for (a number field's label), never on a node: with no hold of
      // its door before it, its step is a whole drag, not a release
      const held = new Map<string, number>();
      s.steps.forEach((step, ti) => {
        const entry = doorByRef.get(step.door);
        const drag = entry !== undefined && (GESTURE_DOOR_KINDS as readonly string[]).includes(entry.door.kind);
        const hold = step.hold === true;
        const wholePanelDrag = entry?.door.kind === 'panel-drag' && !held.has(step.door);
        // a stroke whose command takes the path it went through (the Layout Composer's layout.stroke: its points)
        // is drawn whole by its step, from its first point to its last
        const wholeStroke = entry !== undefined && 'points' in entry.command.args && !held.has(step.door);
        const release = drag && !hold && step.target === null && step.drop === null && !wholePanelDrag && !wholeStroke;
        if (hold && !drag) report('step', f.file, `${at}.steps[${ti}].hold`, `${step.door} is not a drag: only a drag is held`);
        if (hold && drag) held.set(step.door, ti);
        if (release) {
          if (held.has(step.door)) held.delete(step.door);
          else report('step', f.file, `${at}.steps[${ti}]`, `${step.door} releases a drag that no earlier step holds`);
        }
        if (entry?.command.id === 'drag.cancel') held.clear();
        const command = commandById.get(step.door.split('#')[0] ?? '');
        if (!command) return;
        for (const [name, value] of Object.entries(step.args)) {
          const arg = command.args[name];
          if (!arg) {
            report('step', f.file, `${at}.steps[${ti}].args.${name}`, `${command.id} has no argument "${name}"`);
            continue;
          }
          if (arg.type === 'rect' || arg.type === 'point') {
            report('step', f.file, `${at}.steps[${ti}].args.${name}`, `the ${arg.type} "${name}" of ${command.id} is produced by the gesture: a step leaves it out`);
            continue;
          }
          if (arg.type === 'clipboard') {
            report('step', f.file, `${at}.steps[${ti}].args.${name}`, `the clipboard "${name}" of ${command.id} is read by the door when it runs: a step leaves it out`);
            continue;
          }
          const problem = argProblem(arg, value);
          if (problem !== null) report('step', f.file, `${at}.steps[${ti}].args.${name}`, `${JSON.stringify(value)}: the argument "${name}" of ${command.id} ${problem}`);
        }
        // a release completes the held drag, whose step gave the arguments
        if (release) return;
        const fixed = entry?.door.args ?? {};
        for (const [name, arg] of Object.entries(command.args)) {
          if (arg.optional || arg.type === 'rect' || arg.type === 'point' || arg.type === 'clipboard' || name in fixed || name in step.args) continue;
          report('step', f.file, `${at}.steps[${ti}].args`, `${step.door} needs the argument "${name}" (${arg.type}) of ${command.id}: the door does not fix it`);
        }
      });
      for (const [doorRef, ti] of held) report('step', f.file, `${at}.steps[${ti}].hold`, `${doorRef} is held and never released or cancelled (drag.cancel)`);
      if (before === null) return;
      // document-path: setup in the fixture; the diff applies; expectations after the diff; steps in either
      s.setup.selection.forEach((nodePath, i) => armCheck(before, f.file, `${at}.setup.selection[${i}]`, nodePath, 'in the fixture'));
      const diff = applyDiff(before, s.expect.document);
      if (diff.error !== null) {
        report('document-path', f.file, `${at}.expect.document[${diff.error.index}]`, diff.error.message);
        return;
      }
      const after = diff.document;
      for (const problem of validateDocument(withStandInIds(after) as DocumentJson, [], modelRules)) {
        report('document-path', f.file, `${at}.expect.document`, `after the diff the document breaks the model at ${problem.path}: ${problem.message}`);
      }
      s.expect.selection.forEach((nodePath, i) => armCheck(after, f.file, `${at}.expect.selection[${i}]`, nodePath, 'after the diff'));
      if (s.expect.hover !== undefined) armCheck(after, f.file, `${at}.expect.hover.node`, s.expect.hover.node, 'after the diff');
      s.expect.render?.computed.forEach((c, i) => armCheck(after, f.file, `${at}.expect.render.computed[${i}].node`, c.node, 'after the diff'));
      s.expect.render?.geometry.forEach((g, i) => {
        armCheck(after, f.file, `${at}.expect.render.geometry[${i}].node`, g.node, 'after the diff');
        if (g.reference !== null) armCheck(after, f.file, `${at}.expect.render.geometry[${i}].reference`, g.reference, 'after the diff');
      });
      s.steps.forEach((step, ti) => {
        if (step.target !== null) eitherCheck(before, after, f.file, `${at}.steps[${ti}].target`, step.target);
        if (step.drop !== null) eitherCheck(before, after, f.file, `${at}.steps[${ti}].drop.reference`, step.drop.reference);
        const command = commandById.get(step.door.split('#')[0] ?? '');
        for (const [name, value] of Object.entries(step.args)) {
          const type = command?.args[name]?.type;
          if (type === 'node' && nodeValue(value)) eitherCheck(before, after, f.file, `${at}.steps[${ti}].args.${name}`, value);
          if (type === 'nodes' && Array.isArray(value)) value.filter(nodeValue).forEach((v) => eitherCheck(before, after, f.file, `${at}.steps[${ti}].args.${name}`, v));
        }
      });
    });

    // door-coverage: once a feature has scenarios, every door of its own runs in one of them
    if (scenarios.length > 0) {
      const used = new Set(scenarios.flatMap((s) => [...s.doors, ...s.steps.map((step) => step.door)]));
      for (const d of doors) {
        if (d.door.feature === f.feature.id && !used.has(d.ref)) report('door-coverage', f.file, `${f.path}.scenarios`, `the door ${d.ref} of ${f.feature.id} runs in none of its scenarios`);
      }
    }

    // tooth-proof: a feature with scenarios and no commands names the module its tooth proof disables
    const tooth = f.feature.toothProof;
    if (tooth !== undefined) {
      if (f.feature.commands.length > 0) report('tooth-proof', f.file, `${f.path}.toothProof`, `${f.feature.id} has commands: its tooth proof disables their handlers, so it names no module`);
      // the module must exist: a tooth proof that names a file nobody has proves nothing
      else if (!input.fileExists(tooth)) report('tooth-proof', f.file, `${f.path}.toothProof`, `${tooth} is not a module of this project`);
    } else if (scenarios.length > 0 && f.feature.commands.length === 0) {
      report('tooth-proof', f.file, `${f.path}`, `${f.feature.id} has scenarios and no commands: name the module its tooth proof replaces with a no-op (toothProof)`);
    }
  }
}

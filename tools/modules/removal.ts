// The removal proof of a module (src/modules/<id>; spec layout-composer "removable"): the project is copied into
// .cache/removal-<id>, everything the module owns is taken out — its folder, its manifest command and feature files,
// its handler references, its panel, region, key context, constants and gestures, its door on the activity bar, its
// line in src/app/modules.ts, src/app/modules-view.ts and src/app/features.ts — and the copy must still generate,
// pass manifest:check, typecheck and build. Usage: node tools/modules/removal.ts layout-composer
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const id = process.argv[2];
if (id === undefined || !/^[a-z-]+$/.test(id)) throw new Error('usage: node tools/modules/removal.ts <module-id>');
const root = process.cwd();
const copy = path.join(root, '.cache', `removal-${id}`);
fs.rmSync(copy, { recursive: true, force: true });
fs.mkdirSync(copy, { recursive: true });
for (const entry of ['src', 'manifest', 'tools', 'tests', 'spec', 'companion', 'playwright.config.ts', 'index.html', 'package.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.core.json', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js']) {
  if (fs.existsSync(path.join(root, entry))) fs.cpSync(path.join(root, entry), path.join(copy, entry), { recursive: true });
}
// the dependencies are the project's own, linked, never copied
fs.symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'junction');

const at = (file: string) => path.join(copy, file);
const json = (file: string) => JSON.parse(fs.readFileSync(at(file), 'utf8')) as Record<string, unknown>;
const write = (file: string, value: unknown) => fs.writeFileSync(at(file), `${JSON.stringify(value, null, 2)}\n`);

// the module's own files
const commandsFile = `manifest/commands/${id}.json`;
const commands = (json(commandsFile).commands as { id: string }[]).map((c) => c.id);
const featureFile = fs.readdirSync(at('manifest/features')).find((f) => f.endsWith(`-${id}.json`));
if (featureFile === undefined) throw new Error(`no feature file of ${id}`);
fs.rmSync(at(`src/modules/${id}`), { recursive: true });
fs.rmSync(at(commandsFile));
fs.rmSync(at(`manifest/features/${featureFile}`));
// fixtures only its scenarios use
for (const fixture of fs.readdirSync(at('manifest/features/fixtures')).filter((f) => f.startsWith(`${id.split('-')[0]}-`))) fs.rmSync(at(`manifest/features/fixtures/${fixture}`));

// its references, panel, region, key context, constants, gestures and activity-bar door
const references = json('manifest/references.json') as { references: { kind: string; id: string }[] };
const predicates = fs.readFileSync(path.join(root, `src/modules/${id}/host/handlers.ts`), 'utf8').match(/registerPredicate<[^>]*>\(\s*'([A-Za-z]+)'/g)?.map((m) => /'([A-Za-z]+)'/.exec(m)?.[1] ?? '') ?? [];
write('manifest/references.json', { ...references, references: references.references.filter((r) => !(r.kind === 'handler' && commands.includes(r.id)) && !(r.kind === 'predicate' && predicates.includes(r.id))) });
const layout = json('manifest/layout.json') as { panels: Record<string, unknown>; regions: { id: string }[] };
const { [id]: _panel, ...panels } = layout.panels;
void _panel;
write('manifest/layout.json', { ...layout, panels, regions: layout.regions.filter((r) => r.id !== `${id}-panel`) });
const spec = `spec/BEHAVIOUR.md#${id}`;
const interactions = json('manifest/interactions.json') as { keyContexts: { id: string }[]; constants: { source: string }[]; gestures: { source: string }[] };
write('manifest/interactions.json', { ...interactions, keyContexts: interactions.keyContexts.filter((k) => k.id !== id), constants: interactions.constants.filter((c) => c.source !== spec), gestures: interactions.gestures.filter((g) => g.source !== spec) });
const workspace = json('manifest/commands/workspace.json') as { commands: { id: string; args: Record<string, { values: string[] }>; entryPoints: { feature: string }[] }[] };
for (const command of workspace.commands) {
  command.entryPoints = command.entryPoints.filter((d) => d.feature !== id);
  for (const arg of Object.values(command.args)) arg.values = arg.values.filter((v) => v !== id);
}
write('manifest/commands/workspace.json', workspace);
// The scenarios of other features that go through one of the module's doors (select-click's "the Select tool puts any
// other tool away" takes the Layout tool as the other tool): they prove how the module meets the rest, and leave
// with it.
const moduleDoor = (door: unknown): boolean => typeof door === 'string' && commands.includes(door.split('#')[0] ?? '');
for (const file of fs.readdirSync(at('manifest/features')).filter((f) => f.endsWith('.json'))) {
  const features = json(`manifest/features/${file}`) as { features: { scenarios: { steps: { door: unknown }[]; doors: unknown[] }[] }[] };
  let changed = false;
  for (const feature of features.features) {
    const kept = feature.scenarios.filter((scenario) => !scenario.steps.some((step) => moduleDoor(step.door)) && !scenario.doors.some(moduleDoor));
    if (kept.length !== feature.scenarios.length) {
      feature.scenarios = kept;
      changed = true;
    }
  }
  if (changed) write(`manifest/features/${file}`, features);
}

// its registration lines
const drop = (file: string, pattern: RegExp) => fs.writeFileSync(at(file), fs.readFileSync(at(file), 'utf8').split('\n').filter((line) => !pattern.test(line)).join('\n'));
const constant = id.toUpperCase().replace(/-/g, '_');
drop('src/app/features.ts', new RegExp(`'${id}'|${id}, a removable module`));
fs.writeFileSync(
  at('src/app/modules.ts'),
  fs
    .readFileSync(at('src/app/modules.ts'), 'utf8')
    .replace(new RegExp(`import \\{ ${constant} \\} from '[^']+';\\n`), '')
    .replace(new RegExp(`= \\[${constant}\\];`), '= [];')
    .replace(new RegExp(`\\{ \\.\\.\\.byCommand\\(${constant}\\.handlers\\) \\}`), '{}')
    .replace(new RegExp(`\\{ \\.\\.\\.${constant}\\.predicates \\}`), '{}'),
);
fs.writeFileSync(
  at('src/app/modules-view.ts'),
  fs
    .readFileSync(at('src/app/modules-view.ts'), 'utf8')
    .replace(new RegExp(`import \\{ ${constant}_VIEW \\} from '[^']+';\\n`), '')
    .replace(new RegExp(`= \\[${constant}_VIEW\\];`), '= [];'),
);

const run = (label: string, command: string) => {
  process.stdout.write(`${label}: `);
  try {
    execSync(command, { cwd: copy, stdio: 'pipe', env: { ...process.env } });
    console.log('ok');
  } catch (error) {
    const failed = error as { stdout?: Buffer; stderr?: Buffer };
    console.log('FAILED');
    console.log(`${failed.stdout?.toString() ?? ''}${failed.stderr?.toString() ?? ''}`.split('\n').slice(-40).join('\n'));
    process.exit(1);
  }
};
run('gen', 'npm run gen');
run('manifest:check', 'npm run manifest:check');
run('typecheck', 'npm run typecheck');
run('build', 'npm run build');
console.log(`the application builds without the module ${id} (${copy})`);

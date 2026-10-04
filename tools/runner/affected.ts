// The browser tests of what changed (npm run e2e:affected [--since <ref>] [--list]): the features a change reaches and
// the spec files that prove them, run in Chrome instead of the whole suite. What changed is the working tree against
// HEAD (or against <ref>), untracked files included. A changed module of src/ reaches every module that imports it,
// directly or not; a feature is affected when one of the modules the inventory names for it (docs/inventory.json) is
// reached, or when its scenarios' file of manifest/features changed. The affected features' scenario tests run
// (@feature:<id>), with the spec files named after an affected feature and the spec files that changed. A change to
// what every browser test stands on (tests/support, the scenario runner, the door helpers, the Playwright
// configuration, the manifest's commands or layout), shared door runtimes and unmapped production sources reach
// everything: the run says why and runs the complete suite instead of treating an unknown path as unaffected.
// The complete suite still runs once at the end of the work (AGENTS.md, The loop and verification); this is the loop
// between.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { affectedPlan, productionSource } from './affected-plan.ts';
import { changedLines, selectorsOn, testsReached, type Recorded } from './affected-coverage.ts';
import { COVERAGE_DIR } from '../../tests/support/coverage.ts';

interface Inventory {
  readonly features: readonly { readonly id: string; readonly built: boolean; readonly modules: readonly string[] }[];
}

const args = process.argv.slice(2);
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : undefined;
const listOnly = args.includes('--list');
const posix = (p: string) => p.split(path.sep).join('/');

const git = (...a: string[]) => execFileSync('git', ['-c', 'safe.directory=*', ...a], { encoding: 'utf8' }).split('\n').filter((l) => l !== '');
const changed = [...new Set([...git('diff', '--name-only', since ?? 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')])];

// the modules of src/ and what each imports (relative imports, resolved to files)
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = posix(path.join(dir, e.name));
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|css|json)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}
// a module's imports of code: an import of types only (`import type`, `export type`) runs nothing and carries no change
const IMPORT = /(?:import|export)\s(?!type\s)[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\s+['"](\.{1,2}\/[^'"]+)['"]/g;
const importers = new Map<string, Set<string>>();
for (const file of sourceFiles('src')) {
  if (!/\.tsx?$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT)) {
    const target = posix(path.normalize(path.join(path.dirname(file), m[1] ?? m[2] ?? '')));
    const set = importers.get(target) ?? new Set<string>();
    set.add(file);
    importers.set(target, set);
  }
}
// every module a change reaches: the changed one and, transitively, those that import it. The command table
// (src/app/commands.ts) imports every handler only to register it; through it every module that dispatches would be
// reached by any handler, so a change stops there: a handler reaches the features whose modules import it.
const WIRING = new Set(['src/app/commands.ts']);
function reachOf(start: string): Set<string> {
  const reached = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    if (WIRING.has(file) && file !== start) continue;
    for (const importer of importers.get(file) ?? []) queue.push(importer);
  }
  return reached;
}
const sources = changed.filter(productionSource);
const reaches = new Map(sources.map((f) => [f, reachOf(f)]));

const inventory = JSON.parse(fs.readFileSync('docs/inventory.json', 'utf8')) as Inventory;
const featureFiles = changed.filter((f) => /^manifest\/features\/\d{2}-.*\.json$/.test(f));
const featuresInFiles = new Set(
  featureFiles.filter((f) => fs.existsSync(f)).flatMap((f) => (JSON.parse(fs.readFileSync(f, 'utf8')) as { features: { id: string }[] }).features.map((x) => x.id)),
);
const plan = affectedPlan({ changed, reaches, features: inventory.features, changedFeatures: featuresInFiles, availableSpecs: new Set(sourceFiles('tests/e2e').filter((file) => file.endsWith('.spec.ts'))) });
const styles = changed.filter((f) => f.endsWith('.css'));

console.log(`changed: ${changed.length} files${since === undefined ? '' : ` since ${since}`}`);
if (plan.reasons.length > 0) console.log(`reaches every browser test: ${plan.reasons.join(', ')}`);
else {
  console.log(`features: ${plan.features.length === 0 ? 'none' : plan.features.join(' ')}`);
  console.log(`spec files: ${plan.specs.length === 0 ? 'none' : plan.specs.join(' ')}`);
  if (styles.length > 0) console.log(`stylesheets changed (${styles.join(', ')}): the tests above prove behaviour; look at the screens with npm run ui`);
}
if (listOnly) for (const run of plan.runs) console.log(`playwright arguments: ${JSON.stringify(run)}`);

const cli = path.join('node_modules', '@playwright', 'test', 'cli.js');
const playwright = (a: string[]) => spawnSync(process.execPath, [cli, 'test', ...a], { stdio: 'inherit' }).status ?? 1;
// With the last coverage run (npm run e2e:coverage), the tests that ran a changed line or used a changed selector
// replace a plan that would run everything for a shared module or a stylesheet (plan G6): a change it cannot place
// keeps the plan above, and a change to what every test stands on still runs the complete suite.
const precise = preciseRuns();
const runs = precise ?? plan.runs;
if (precise !== null) console.log(`from the coverage of ${coverageMeta()?.commit.slice(0, 7) ?? ''}: ${precise.length === 0 ? 'no test' : 'the tests in .cache/coverage/affected.txt'}`);
if (listOnly) process.exit(0);
let status = 0;
for (const run of runs) status = Math.max(status, playwright(run));
if (runs.length === 0) console.log('no browser test is reached by the change');
process.exit(status);

function coverageMeta(): { readonly commit: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join('.cache', 'coverage', 'meta.json'), 'utf8')) as { commit: string };
  } catch {
    return null;
  }
}

function preciseRuns(): string[][] | null {
  const meta = coverageMeta();
  if (meta === null || !fs.existsSync(COVERAGE_DIR)) return null;
  let files: string[];
  try {
    files = [...new Set([...git('diff', '--name-only', meta.commit), ...git('ls-files', '--others', '--exclude-standard')])].map(posix);
  } catch {
    return null;
  }
  // what every test stands on, and the plan's own reasons other than a shared module or a stylesheet, keep the plan
  const sharedOnly = plan.reasons.every((reason) => reason.startsWith('shared door runtime') || reason.startsWith('unmapped production source'));
  if (!sharedOnly) return null;
  const existedAt = (file: string) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${meta.commit}:${file}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  const records = fs.readdirSync(COVERAGE_DIR).map((name) => JSON.parse(fs.readFileSync(path.join(COVERAGE_DIR, name), 'utf8')) as Recorded);
  const scripts = new Map<string, readonly (readonly [number, number])[]>();
  const selectors = new Set<string>();
  const list = new Set<string>();
  for (const file of files) {
    if (/^tests\/e2e\/.*\.spec\.ts$/.test(file) && fs.existsSync(file)) list.add(file);
    if (!productionSource(file)) continue;
    // a data file (a catalogue, a generated list) or a file the coverage never saw: the plan decides
    if (!/\.(tsx?|css)$/.test(file) || !existedAt(file)) return null;
    const changed = changedLines(execFileSync('git', ['diff', '-U0', meta.commit, '--', file], { encoding: 'utf8' })).get(file) ?? [];
    if (file.endsWith('.css')) {
      for (const one of selectorsOn(execFileSync('git', ['show', `${meta.commit}:${file}`], { encoding: 'utf8' }), changed)) selectors.add(one);
      list.add('tests/e2e/visual.spec.ts');
    } else scripts.set(file, changed);
  }
  for (const test of testsReached(records, scripts, selectors)) list.add(test);
  // the features whose scenarios' file changed still run their scenarios
  const featureRuns = featuresInFiles.size === 0 ? [] : [['scenarios.spec', '--grep', [...featuresInFiles].map((id) => `@feature:${id}(?![\\w-])`).join('|')]];
  fs.mkdirSync(path.join('.cache', 'coverage'), { recursive: true });
  fs.writeFileSync(path.join('.cache', 'coverage', 'affected.txt'), `${[...list].join('\n')}\n`);
  console.log(`tests reached: ${list.size}`);
  return [...(list.size > 0 ? [['--test-list', path.join('.cache', 'coverage', 'affected.txt')]] : []), ...featureRuns];
}

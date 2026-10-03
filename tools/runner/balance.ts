// The balance of the two scenario runners (plan I.11; docs/PRODUCT.md section 6, "Two scenario runners, one
// contract"). The fast runner (headless.test.ts) proves a scenario's logic through the editor's own store; the browser
// runner (scenarios.ts) proves it again through the real app, and is the only one that proves a door's gesture and what
// the page draws. A browser run is left out when the fast runner passed the same run on this very tree, the scenario
// expects nothing only a browser reads (computed values, geometry, the editor's regions, a reload, the export, a
// hover), and its door keeps a browser run of its own: every door is still pressed, clicked or dragged in the browser
// at least once. The fast runner writes what it passed, with the tree's fingerprint, to .cache/runner/headless.json;
// the browser runner reads it, and leaves nothing out when the file is missing or was written on another tree. The
// status counts a run left out as passed, since the fast runner passed it on this tree (status.ts).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const HEADLESS_RESULTS = path.join('.cache', 'runner', 'headless.json');
// the annotation a browser run left out carries
export const PROVEN_HEADLESS = 'proven-headless';

interface Results {
  readonly fingerprint: string;
  readonly passed: readonly string[];
}

// What the tree holds now: the commit, the changes to its tracked files and the untracked files with their contents (a
// run on a tree with any other change is a run on another tree). The record the browser runner writes after a complete
// run (docs/feature-results.json) is left out: it follows the runs, never changes what they prove.
export function treeFingerprint(root: string = process.cwd()): string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 1 << 30 });
  const hash = createHash('sha256');
  hash.update(git('rev-parse', 'HEAD'));
  hash.update(git('diff', 'HEAD', '--binary', '--', '.', ':(exclude)docs/feature-results.json'));
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').toString('utf8').split('\0').filter((file) => file !== '');
  for (const file of untracked.sort()) {
    hash.update(`\0${file}\0`);
    hash.update(fs.readFileSync(path.join(root, file)));
  }
  return hash.digest('hex');
}

// The fast runner's record of the runs it passed (each named as the browser runner names its test).
export function writeHeadlessResults(passed: readonly string[]): void {
  const results: Results = { fingerprint: treeFingerprint(), passed: [...passed].sort() };
  fs.mkdirSync(path.dirname(HEADLESS_RESULTS), { recursive: true });
  fs.writeFileSync(HEADLESS_RESULTS, `${JSON.stringify(results, null, 2)}\n`);
}

// The runs the fast runner passed on this tree, or null when it has no record of this tree.
export function headlessProven(fingerprint: string = treeFingerprint(), file: string = HEADLESS_RESULTS): ReadonlySet<string> | null {
  try {
    const results = JSON.parse(fs.readFileSync(file, 'utf8')) as Results;
    return results.fingerprint === fingerprint ? new Set(results.passed) : null;
  } catch {
    return null;
  }
}

interface ScenarioShape {
  readonly id: string;
  readonly doors: readonly string[];
  readonly expect: {
    readonly render: { readonly computed: readonly unknown[]; readonly geometry: readonly unknown[] } | null;
    readonly editor: unknown;
    readonly persistence: unknown;
    readonly export: unknown;
    readonly hover?: unknown;
  };
}

// whether a scenario expects something only a browser reads
export function readsTheBrowser(s: ScenarioShape): boolean {
  const e = s.expect;
  return (e.render?.computed.length ?? 0) > 0 || (e.render?.geometry.length ?? 0) > 0 || e.editor !== null || e.persistence !== null || e.export !== null || e.hover !== undefined;
}

// a browser run's name: the feature, the scenario and the door
export const runName = (feature: string, scenario: string, door: string): string => `${feature} › ${scenario} › ${door}`;

// The browser runs left out: the runs the fast runner proved, of scenarios that read nothing of the browser, but for
// one run of each door that has no other (the first, in the manifest's order).
export function leftOut(features: readonly { readonly id: string; readonly scenarios: readonly ScenarioShape[] }[], proven: ReadonlySet<string>): ReadonlySet<string> {
  const byDoor = new Map<string, { readonly name: string; readonly provable: boolean }[]>();
  for (const feature of features) {
    for (const s of feature.scenarios) {
      for (const door of s.doors) {
        const name = runName(feature.id, s.id, door);
        const runs = byDoor.get(door) ?? [];
        runs.push({ name, provable: proven.has(name) && !readsTheBrowser(s) });
        byDoor.set(door, runs);
      }
    }
  }
  const out = new Set<string>();
  for (const runs of byDoor.values()) {
    const kept = runs.some((run) => !run.provable);
    runs.filter((run) => run.provable).forEach((run, i) => {
      if (kept || i > 0) out.add(run.name);
    });
  }
  return out;
}

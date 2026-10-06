// The balance of the two scenario runners (plan I.11; docs/PRODUCT.md section 6, "Two scenario runners, one
// contract"). The fast runner (headless.test.ts) proves a scenario's logic through the editor's own store; the browser
// runner (scenarios.ts) proves it again through the real app, and is the only one that proves a door's gesture and what
// the page draws. A browser run is left out when the fast runner passed the same run on this very tree, the scenario
// expects nothing only a browser reads (computed values, geometry, the editor's regions, a reload, the export, a
// hover), and its door keeps a browser run of its own: every door is still pressed, clicked or dragged in the browser
// at least once. The fast runner writes what it passed, with the fingerprint of the run's inputs (run-inputs.ts), to
// .cache/runner/headless.json; the browser runner reads it, and leaves nothing out when the file is missing or was
// written on other inputs — and says which (headlessRecord), never silently: a record written on the HEAD's
// fingerprint went stale at every commit and the browser runner left out nothing for months of runs (the study of
// 2026-10-06). The status counts a run left out as passed, since the fast runner passed it on these inputs (status.ts).
import fs from 'node:fs';
import path from 'node:path';
import { inputsFingerprint } from './run-inputs.ts';

const HEADLESS_RESULTS = path.join('.cache', 'runner', 'headless.json');
// the annotation a browser run left out carries
export const PROVEN_HEADLESS = 'proven-headless';

interface Results {
  readonly fingerprint: string;
  readonly passed: readonly string[];
}

// The fast runner's record of the runs it passed (each named as the browser runner names its test).
export function writeHeadlessResults(passed: readonly string[]): void {
  const results: Results = { fingerprint: inputsFingerprint(), passed: [...passed].sort() };
  fs.mkdirSync(path.dirname(HEADLESS_RESULTS), { recursive: true });
  fs.writeFileSync(HEADLESS_RESULTS, `${JSON.stringify(results, null, 2)}\n`);
}

// The fast runner's record as it stands for these inputs: the runs it passed, or why there are none to trust.
export type HeadlessRecord = { readonly proven: ReadonlySet<string> } | { readonly proven: null; readonly why: string };
export function headlessRecord(fingerprint: string = inputsFingerprint(), file: string = HEADLESS_RESULTS): HeadlessRecord {
  let results: Results;
  try {
    results = JSON.parse(fs.readFileSync(file, 'utf8')) as Results;
  } catch {
    return { proven: null, why: `no record of the fast runner (${file}): run npm run unit first` };
  }
  return results.fingerprint === fingerprint ? { proven: new Set(results.passed) } : { proven: null, why: 'the fast runner last ran on other contents of the run inputs (tools/runner/run-inputs.ts): run npm run unit first' };
}

// The runs the fast runner passed on these inputs, or null when it has no record of them.
export function headlessProven(fingerprint: string = inputsFingerprint(), file: string = HEADLESS_RESULTS): ReadonlySet<string> | null {
  return headlessRecord(fingerprint, file).proven;
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

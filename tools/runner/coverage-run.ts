// npm run e2e:coverage — the complete browser suite with E2E_COVERAGE=1 (plan G6, R4): every test records what it
// executed (tests/support/coverage.ts) into .cache/e2e-coverage/tests, and .cache/e2e-coverage/meta.json names the
// commit it ran on, which npm run e2e:affected reads changes against. The run's inputs (tools/runner/run-inputs.ts)
// must hold the commit's contents, since the lines are read against it; the rest of the tree (the owner's .claude/,
// notes at the root) changes nothing a test runs and never blocks it, as it blocked every recording after the first
// (the study of 2026-10-06). The map is the whole suite's or none: a run narrowed to some tests is refused, since it
// would replace the map with a part of it. Arguments after it go to Playwright (--workers, --reporter).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { COVERAGE_DIR, COVERAGE_META, COVERAGE_ROOT } from '../../tests/support/coverage.ts';
import { changedInputs } from './run-inputs.ts';

const args = process.argv.slice(2);
const NARROWING = /^(-g|--grep|--grep-invert|--test-list|--last-failed|--only-changed|--shard|--project)(=|$)/;
const narrowed = args.filter((arg, i) => NARROWING.test(arg) || (!arg.startsWith('-') && !(i > 0 && /^--(workers|reporter|retries|timeout|max-failures)$/.test(args[i - 1] ?? ''))));
if (narrowed.length > 0) {
  console.log(`the coverage map is recorded by the complete suite only; these arguments narrow it: ${narrowed.join(' ')}`);
  process.exit(2);
}
const dirty = changedInputs();
if (dirty.length > 0) {
  console.log(`the coverage is recorded on the committed contents of the run's inputs; commit or put aside first:\n${dirty.join('\n')}`);
  process.exit(2);
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
fs.rmSync(COVERAGE_ROOT, { recursive: true, force: true });
fs.mkdirSync(COVERAGE_ROOT, { recursive: true });
const cli = path.join('node_modules', '@playwright', 'test', 'cli.js');
const started = Date.now();
const status = spawnSync(process.execPath, [cli, 'test', ...args], { stdio: 'inherit', env: { ...process.env, E2E_COVERAGE: '1' } }).status ?? 1;
const recorded = fs.existsSync(COVERAGE_DIR) ? fs.readdirSync(COVERAGE_DIR).length : 0;
fs.writeFileSync(COVERAGE_META, `${JSON.stringify({ commit, at: new Date().toISOString(), status, tests: recorded, minutes: Math.round((Date.now() - started) / 600) / 100 }, null, 2)}\n`);
console.log(`coverage of ${commit.slice(0, 7)} written to ${COVERAGE_ROOT} (${recorded} tests)`);
process.exit(status);

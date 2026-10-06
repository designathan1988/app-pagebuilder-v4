// Every file of the Journey 03 study a test or a tool reads is in the repository (the audit of 2026-10-05, AU6-06):
// `jornada03/` is ignored by git as a whole and only some of its files were added, so on a clean clone the
// large-page and data-c4 flows, `npm run perf` and `npm run journey` met no `probe-large.json`, no Marina assets and no
// `marina-project.zip`. The paths are read from the sources themselves: a quoted 'jornada03/…' path, and a file named
// under a constant that holds a folder of it (`${A}/hero.png`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['tools', 'tests'];
const sources = ROOTS.flatMap((root) => fs.readdirSync(root, { recursive: true, encoding: 'utf8' }).map((file) => path.join(root, file))).filter((file) => /\.(ts|mjs)$/.test(file) && !file.endsWith('test-inputs.test.ts'));
const tracked = new Set(execFileSync('git', ['ls-files', 'jornada03'], { encoding: 'utf8' }).split('\n').filter((line) => line !== ''));

// the study's files a source names, each with the source that names it
function named(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, quoted] of text.matchAll(/'(jornada03\/[^'\s]+)'/g)) found.set(quoted as string, file);
    for (const [, name, folder] of text.matchAll(/const (\w+) = '(jornada03\/[^'\s]+)'/g)) {
      for (const [, leaf] of text.matchAll(new RegExp(`\\$\\{${name}\\}/([\\w.-]+)`, 'g'))) found.set(`${folder}/${leaf}`, file);
    }
  }
  return found;
}

describe("the Journey 03 study's files the tests read", () => {
  it('are each in the repository (a folder: some file of it)', () => {
    const missing = [...named()].filter(([wanted]) => !tracked.has(wanted) && ![...tracked].some((file) => file.startsWith(`${wanted}/`)));
    expect(missing.map(([wanted, by]) => `${wanted} (read by ${by})`)).toEqual([]);
  });
});

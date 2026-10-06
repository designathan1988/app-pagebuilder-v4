// What a run of the tests stands on: the paths whose contents change what the unit tests, the fast scenario runner and
// the browser tests execute. One list, read by every tool that asks "is this the tree that ran?":
// - the fast runner's record is valid for these contents, whatever the commit (balance.ts): a commit that changes
//   nothing here leaves the record good, where a fingerprint of HEAD threw it away at every commit;
// - the coverage map is recorded only while these paths hold their commit's contents (coverage-run.ts), since its
//   lines are read against that commit;
// - the status counts a run only on these paths' committed contents (status.ts).
// Every other path changes nothing a test runs: the user's local configuration under .claude/ (always changed on the
// owner's machine, and not this project's to commit), the documents, the behaviour spec, notes at the root. A root
// path git tracks that is in neither list fails tools/runner/run-inputs.test.ts, so a new configuration file is
// placed on purpose.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const RUN_INPUTS: readonly string[] = [
  'src',
  'tests',
  'manifest',
  'tools',
  'design',
  'jornada03',
  'companion',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'vite.proofs.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.core.json',
  'tsconfig.node.json',
];

// the tracked root paths no test executes
export const NOT_INPUTS: readonly string[] = ['.claude', 'docs', 'spec', 'README.md', 'CLAUDE.md', '.mcp.json', '.gitignore', '.gitattributes', 'eslint.config.js', '.dependency-cruiser.cjs'];

const git = (root: string, ...args: string[]): Buffer => execFileSync('git', ['-c', 'safe.directory=*', ...args], { cwd: root, encoding: 'buffer', maxBuffer: 1 << 30 });
const nulList = (buffer: Buffer): string[] => buffer.toString('utf8').split('\0').filter((entry) => entry !== '');

// the input files on disk: tracked and untracked, without what .gitignore leaves out
export function inputFiles(root: string = process.cwd()): string[] {
  return nulList(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...RUN_INPUTS))
    .filter((file) => fs.existsSync(path.join(root, file)))
    .sort();
}

// The inputs' contents: every input file's path and bytes. Two trees with the same inputs give the same fingerprint,
// whatever their commits.
export function inputsFingerprint(root: string = process.cwd()): string {
  const hash = createHash('sha256');
  for (const file of inputFiles(root)) {
    hash.update(`\0${file}\0`);
    hash.update(fs.readFileSync(path.join(root, file)));
  }
  return hash.digest('hex');
}

// The input paths whose contents differ from the commit's: changed, added, removed or untracked.
export function changedInputs(root: string = process.cwd()): string[] {
  return nulList(git(root, 'status', '--porcelain', '-z', '--untracked-files=all', '--', ...RUN_INPUTS))
    .filter((entry) => /^[ MADRCU?!]{2} /.test(entry))
    .map((entry) => entry.slice(3));
}

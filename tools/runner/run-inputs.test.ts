// The run's inputs (run-inputs.ts): one list of what the tests stand on, every tracked root path placed in it or out
// of it, and a fingerprint of contents that a commit changing nothing a test runs leaves as it was (the study of
// 2026-10-06: the fast runner's record was keyed to HEAD and never survived a commit).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOT_INPUTS, RUN_INPUTS, changedInputs, inputsFingerprint } from './run-inputs.ts';

describe('the run inputs', () => {
  it('place every root path the repository tracks in the inputs or out of them', () => {
    const roots = new Set(execFileSync('git', ['-c', 'safe.directory=*', 'ls-files'], { encoding: 'utf8' }).split('\n').filter((file) => file !== '').map((file) => file.split('/')[0] as string));
    const placed = new Set([...RUN_INPUTS, ...NOT_INPUTS]);
    expect([...roots].filter((root) => !placed.has(root))).toEqual([]);
    expect(RUN_INPUTS.filter((input) => NOT_INPUTS.includes(input))).toEqual([]);
  });

  it('keep their fingerprint across a commit that changes nothing a test runs, and change it with an input', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'run-inputs-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'safe.directory=*', '-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' });
    try {
      git('init', '-q');
      fs.mkdirSync(path.join(repo, 'src'));
      fs.mkdirSync(path.join(repo, 'docs'));
      fs.mkdirSync(path.join(repo, '.claude'));
      fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.join(repo, 'docs', 'notes.md'), 'one\n');
      git('add', '.');
      git('commit', '-qm', 'first');
      const first = inputsFingerprint(repo);
      // a document committed, the local configuration changed, a note at the root: nothing a test runs
      fs.writeFileSync(path.join(repo, 'docs', 'notes.md'), 'two\n');
      git('commit', '-qam', 'docs');
      fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{}\n');
      fs.writeFileSync(path.join(repo, 'NOTES.md'), 'a note\n');
      expect(inputsFingerprint(repo)).toBe(first);
      expect(changedInputs(repo)).toEqual([]);
      // the same input committed or not is the same contents
      fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 2;\n');
      const changed = inputsFingerprint(repo);
      expect(changed).not.toBe(first);
      expect(changedInputs(repo)).toEqual(['src/a.ts']);
      git('commit', '-qam', 'src');
      expect(inputsFingerprint(repo)).toBe(changed);
      expect(changedInputs(repo)).toEqual([]);
      // an untracked input is an input
      fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'export const b = 1;\n');
      expect(inputsFingerprint(repo)).not.toBe(changed);
      expect(changedInputs(repo)).toEqual(['src/b.ts']);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

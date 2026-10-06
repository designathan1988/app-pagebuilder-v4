// The gate's readings (tools/gate): the QA-LOG rows and git's status outside the index.
import { describe, expect, it } from 'vitest';
import { addedRows, fillHashes, pendingMark, pendingRows } from './qa-log.ts';
import { outsideTheIndex } from './status.ts';

const LOG = [
  '| # | Commit | Area | What the user met | What changed |',
  '|---|---|---|---|---|',
  '| 1 | 6c9e0a1 | Pages | a | b |',
  '| 2 | (this commit) | Insert | c | d |',
  '| 3 | (this commit) | Fields | e (this commit) | f |',
  '',
].join('\n');

describe('the QA-LOG rows', () => {
  it('finds the rows still waiting for their hash', () => {
    expect(pendingRows(LOG)).toEqual([2, 3]);
  });

  it('writes a hash into the commit cell only, leaving the other rows and cells as written', () => {
    const filled = fillHashes(LOG, new Map([[2, 'abc1234']]));
    expect(filled).toContain('| 2 | abc1234 | Insert | c | d |');
    expect(filled).toContain('| 3 | (this commit) | Fields | e (this commit) | f |');
    expect(filled.split('\n')).toHaveLength(LOG.split('\n').length);
  });

  it('counts the rows a commit adds', () => {
    const next = `${LOG}| 4 | (this commit) | New | g | h |\n| 5 | (this commit) | Newer | i | j |\n`;
    expect(addedRows(LOG, next)).toEqual([4, 5]);
    expect(addedRows(LOG, LOG)).toEqual([]);
  });

  it('marks a pending row by its number and cell, the text git log -S looks for', () => {
    expect(pendingMark(312)).toBe('| 312 | (this commit) |');
  });
});

describe('what git status reports outside the index', () => {
  it('keeps unstaged, partly staged and untracked paths, and skips the staged ones and a rename source', () => {
    const porcelain = ['M  staged.ts', ' M unstaged.ts', 'MM partly.ts', '?? new file.ts', 'R  renamed.ts', 'old.ts', 'A  added.ts', ''].join('\0');
    expect(outsideTheIndex(porcelain)).toEqual(['unstaged.ts', 'partly.ts', 'new file.ts']);
  });

  it('reports nothing for a clean tree', () => {
    expect(outsideTheIndex('')).toEqual([]);
  });
});

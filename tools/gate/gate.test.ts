// The gate's readings (tools/gate): the QA-LOG rows, git's status outside the index and the task list the Stop
// check reads.
import { describe, expect, it } from 'vitest';
import { addedRows, fillHashes, pendingMark, pendingRows } from './qa-log.ts';
import { outsideTheIndex } from './status.ts';
import { stopReason, taskItems, unfinished } from './task-list.ts';

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

describe('the task list', () => {
  const LIST = [
    '# Task',
    '- [ ] 1. an open criterion',
    '      that continues here',
    '- [ ] 2. blocked: the user must give the token — a criterion',
    '- [x] 3. a done criterion — evidence: .cache/logs/a.txt',
    '- [x] 4. ticked',
    '  evidence: on the next line',
    '- [x] 5. ticked with nothing to show',
    'A closing note.',
  ].join('\n');

  it('reads each item, its continuation lines included, and its state', () => {
    expect(taskItems(LIST).map((item) => item.state)).toEqual(['open', 'blocked', 'done', 'done', 'unproven']);
    expect(taskItems(LIST)[0]?.text).toBe('1. an open criterion that continues here');
  });

  it('keeps a turn going for an open item and an item ticked without evidence, never for a blocked one', () => {
    expect(unfinished(taskItems(LIST)).map((item) => item.text)).toEqual(['1. an open criterion that continues here', '5. ticked with nothing to show']);
  });

  it('names what is left in the message the agent reads', () => {
    const reason = stopReason(unfinished(taskItems(LIST)));
    expect(reason).toContain('2 unfinished criteria');
    expect(reason).toContain('- 1. an open criterion that continues here');
    expect(reason).toContain('- (ticked without evidence) 5. ticked with nothing to show');
  });

  it('reads a list saved with Windows line ends', () => {
    expect(taskItems('- [ ] open\r\n- [x] done — evidence: x\r\n').map((item) => item.state)).toEqual(['open', 'done']);
  });

  it('lets a turn end when every item is done or blocked', () => {
    expect(unfinished(taskItems('- [x] a — evidence: x\n- [ ] blocked: y — b\n'))).toEqual([]);
  });
});

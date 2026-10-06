// The coverage selection (plan G6): a diff's changed lines, a stylesheet's changed rules, the messages a test showed,
// the lines of a later version read back to the map's, and the tests that ran them; and the two coverage folders kept
// apart (the study of 2026-10-06: the unit tests' report emptied the browser tests' map at every check:fast).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config.ts';
import { COVERAGE_ROOT } from '../../tests/support/coverage.ts';
import { changedLines, selectorsOn, testsReached, toOldLines } from './affected-coverage.ts';

describe('the tests a change reaches by their coverage', () => {
  it('reads the old side of a diff: a change its lines, an insertion the line it follows', () => {
    const diff = ['--- a/src/x.ts', '+++ b/src/x.ts', '@@ -10,2 +10,3 @@', '@@ -40,0 +42,1 @@', '--- a/src/y.css', '+++ b/src/y.css', '@@ -3 +3 @@'].join('\n');
    expect(changedLines(diff)).toEqual(new Map([['src/x.ts', [[10, 11], [40, 41]]], ['src/y.css', [[3, 3]]]]));
  });

  it('names the selectors of the rules standing on the changed lines', () => {
    const css = '.a {\n  color: red;\n}\n\n.b,\n.c > .d {\n  margin: 0;\n}\n';
    expect([...selectorsOn(css, [[7, 7]])]).toEqual(['.b', '.c>.d']);
    expect([...selectorsOn(css, [[2, 2]])]).toEqual(['.a']);
  });

  it('keeps the tests that ran a changed line or used a changed selector, and no other', () => {
    const records = [
      { test: 'a › one', lines: { 'src/x.ts': [[5, 12]] as [number, number][] }, selectors: ['.menu'] },
      { test: 'a › two', lines: { 'src/x.ts': [[30, 35]] as [number, number][] }, selectors: ['.row'] },
      { test: 'b › three', lines: {}, selectors: ['.c > .d'] },
    ];
    expect(testsReached(records, new Map([['src/x.ts', [[10, 11]]]]), new Set())).toEqual(['a › one']);
    expect(testsReached(records, new Map(), new Set(['.c>.d']))).toEqual(['b › three']);
    expect(testsReached(records, new Map([['src/z.ts', [[1, 1]]]]), new Set())).toEqual([]);
  });

  it('keeps the tests that showed a changed message', () => {
    const records = [
      { test: 'a › one', lines: {}, selectors: [], keys: ['menu.file', 'status.ready'] },
      { test: 'a › two', lines: {}, selectors: [], keys: ['menu.edit'] },
      { test: 'a › old', lines: {}, selectors: [] },
    ];
    expect(testsReached(records, new Map(), new Set(), new Set(['status.ready']))).toEqual(['a › one']);
  });

  it("reads a later version's lines back to the map's numbering", () => {
    // from the map's commit to now: 2 lines added after line 10, line 20 replaced by 3, 1 line removed at 30
    const diff = ['--- a/src/x.ts', '+++ b/src/x.ts', '@@ -10,0 +11,2 @@', '@@ -20 +23,3 @@', '@@ -30 +34,0 @@'].join('\n');
    // before every hunk: the same line
    expect(toOldLines([[5, 5]], diff)).toEqual([[5, 5]]);
    // the two added lines stand for the lines around their place
    expect(toOldLines([[11, 12]], diff)).toEqual([[10, 11]]);
    // between the hunks: moved back by the 2 added lines
    expect(toOldLines([[15, 15]], diff)).toEqual([[13, 13]]);
    // inside the replacement: the line it replaced
    expect(toOldLines([[24, 24]], diff)).toEqual([[20, 20]]);
    // after the replacement: moved back by the 4 lines the two hunks added; after the removal too, by 3
    expect(toOldLines([[26, 26]], diff)).toEqual([[22, 22]]);
    expect(toOldLines([[40, 40]], diff)).toEqual([[37, 37]]);
    // no diff: no change of numbering
    expect(toOldLines([[7, 9]], '')).toEqual([[7, 9]]);
  });

  it("keeps the browser tests' coverage out of the folder the unit tests' report empties", () => {
    const unit = path.resolve(String(vitestConfig.test?.coverage?.reportsDirectory));
    const browser = path.resolve(COVERAGE_ROOT);
    const inside = (a: string, b: string) => !path.relative(a, b).startsWith('..') && !path.isAbsolute(path.relative(a, b));
    expect(inside(unit, browser) || inside(browser, unit)).toBe(false);
  });
});

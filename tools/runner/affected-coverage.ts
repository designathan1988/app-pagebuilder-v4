// The tests a change reaches, read from what each test executed (plan G6, R4): the last coverage run (npm run
// e2e:coverage, a complete run with E2E_COVERAGE on the committed inputs) recorded, per test, the source lines its
// scripts ran, the selectors its stylesheets used and the message keys the editor translated
// (tests/support/coverage.ts). A change to a script reaches the tests that ran one of its changed lines; a change to a
// stylesheet, the tests that used one of its changed rules' selectors, and the photos (visual.spec); a change to a
// catalogue, the tests that showed one of its changed messages. The lines are the coverage run's own: the current
// change's lines are read back to the numbering of the commit it ran on through the diff between the two (toOldLines),
// so the commits made since the map add nothing to what a change selects. Anything it cannot place (a file it never
// saw, a data file, a change outside src/) is the caller's to decide.
import { parse as parseCss, walk as walkCss, generate as generateCss } from 'css-tree';

export interface Recorded {
  readonly test: string;
  readonly lines: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  readonly selectors: readonly string[];
  // the message keys translated during the test (absent from a map recorded before they were)
  readonly keys?: readonly string[];
}

// the old side's changed lines of a unified diff with no context (git diff -U0), by file: a removal or a change its
// lines, an insertion the line it follows and the next
export function changedLines(diff: string): ReadonlyMap<string, readonly (readonly [number, number])[]> {
  const out = new Map<string, [number, number][]>();
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    const header = /^--- (?:a\/(.+)|\/dev\/null)$/.exec(line);
    if (header !== null) {
      file = header[1] ?? null;
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk === null || file === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const held = out.get(file) ?? [];
    held.push(count === 0 ? [start, start + 1] : [start, start + count - 1]);
    out.set(file, held);
  }
  return out;
}

// the selectors of the rules of a stylesheet's text that stand on one of the given lines, as the coverage writes them
export function selectorsOn(css: string, lines: readonly (readonly [number, number])[]): ReadonlySet<string> {
  const found = new Set<string>();
  let ast;
  try {
    ast = parseCss(css, { positions: true });
  } catch {
    return found;
  }
  walkCss(ast, (node) => {
    if (node.type !== 'Rule' || node.loc === null || node.loc === undefined) return;
    const from = node.loc.start.line;
    const to = node.loc.end.line;
    if (!lines.some(([a, b]) => a <= to && b >= from)) return;
    for (const one of generateCss(node.prelude).split(',')) found.add(one.replace(/\s+/g, ' ').trim());
  });
  return found;
}

// Lines of a file's newer version read back to an older one's numbering, through the unified diff (git diff -U0)
// from the older to the newer: a line outside every hunk moves by the lines the hunks before it added or removed; a
// line inside a hunk, new since the older version, stands for the older lines the hunk replaced (or the two lines
// around the place it was inserted at), so a test that ran there is never missed.
export function toOldLines(lines: readonly (readonly [number, number])[], diff: string): (readonly [number, number])[] {
  const hunks = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({
    oldStart: Number(m[1]),
    oldCount: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newCount: m[4] === undefined ? 1 : Number(m[4]),
  }));
  const one = (line: number): readonly [number, number] => {
    let shift = 0;
    for (const hunk of hunks) {
      // with no new lines, the hunk's place is after newStart
      const newEnd = hunk.newCount === 0 ? hunk.newStart : hunk.newStart + hunk.newCount - 1;
      if (line < (hunk.newCount === 0 ? hunk.newStart + 1 : hunk.newStart)) break;
      if (hunk.newCount > 0 && line <= newEnd) return hunk.oldCount === 0 ? [hunk.oldStart, hunk.oldStart + 1] : [hunk.oldStart, hunk.oldStart + hunk.oldCount - 1];
      shift += hunk.newCount - hunk.oldCount;
    }
    return [line - shift, line - shift];
  };
  const out: (readonly [number, number])[] = [];
  for (const [from, to] of lines) {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let line = from; line <= to; line += 1) {
      const [a, b] = one(line);
      low = Math.min(low, a);
      high = Math.max(high, b);
    }
    if (low <= high) out.push([Math.max(1, low), high]);
  }
  return out;
}

const meets = (ran: readonly (readonly [number, number])[] | undefined, changed: readonly (readonly [number, number])[]): boolean =>
  ran !== undefined && ran.some(([a, b]) => changed.some(([c, d]) => a <= d && b >= c));

// The tests that ran a changed line of a script, used a changed rule's selector or showed a changed message.
export function testsReached(records: readonly Recorded[], scripts: ReadonlyMap<string, readonly (readonly [number, number])[]>, selectors: ReadonlySet<string>, keys: ReadonlySet<string> = new Set()): readonly string[] {
  // one selector however it was spaced: css-tree writes `.c>.d`, Chrome's coverage `.c > .d`
  const normal = (one: string) => one.replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ').trim();
  const wanted = new Set([...selectors].map(normal));
  return records
    .filter((record) => [...scripts].some(([file, changed]) => meets(record.lines[file], changed)) || record.selectors.some((one) => wanted.has(normal(one))) || (record.keys ?? []).some((key) => keys.has(key)))
    .map((record) => record.test);
}

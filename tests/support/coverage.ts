// What each browser test executed of the editor (plan G6, R4): with E2E_COVERAGE=1 a test records Chrome's coverage of
// the page — the source lines its scripts ran, read back through the e2e build's source maps, and the selectors of the
// stylesheet rules the page used, and the message keys the editor translated — into .cache/e2e-coverage/tests/<hash>.json. npm run e2e:affected reads them to run only
// the tests whose executed lines or selectors a change touches (tools/runner/affected-coverage.ts). Over-approximate on
// purpose: a function or block that ran counts as a whole, so a test is never missed for a line it ran.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';

export const COVERAGE = process.env.E2E_COVERAGE === '1';
// the browser tests' own folder, never the unit tests' report (vitest.config.ts), which Vitest empties at every run
export const COVERAGE_ROOT = path.join('.cache', 'e2e-coverage');
export const COVERAGE_DIR = path.join(COVERAGE_ROOT, 'tests');
export const COVERAGE_META = path.join(COVERAGE_ROOT, 'meta.json');
const BUILD = 'dist';

interface TestCoverage {
  // the line Playwright's --test-list takes: the test's file and its titles
  readonly test: string;
  // each source file of src/ by its path, the lines executed as [from, to] intervals, merged and sorted
  readonly lines: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  // the selectors of the rules the page's stylesheets used, as written
  readonly selectors: readonly string[];
  // the message keys the editor translated
  readonly keys: readonly string[];
}

// a chunk's map, read once per worker
const consumers = new Map<string, SourceMapConsumer | null>();
function consumerOf(url: string): SourceMapConsumer | null {
  const file = path.join(BUILD, new URL(url).pathname);
  if (consumers.has(file)) return consumers.get(file) ?? null;
  let consumer: SourceMapConsumer | null;
  try {
    consumer = new SourceMapConsumer(JSON.parse(fs.readFileSync(`${file}.map`, 'utf8')) as RawSourceMap);
  } catch {
    consumer = null;
  }
  consumers.set(file, consumer);
  return consumer;
}

// the line and column of an offset in a text (the starts of its lines, found once per text)
function locator(text: string): (offset: number) => { readonly line: number; readonly column: number } {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (starts[low] as number) };
  };
}

const sourcePath = (source: string): string | null => {
  const at = source.replaceAll('\\', '/').lastIndexOf('/src/');
  return at < 0 ? null : source.replaceAll('\\', '/').slice(at + 1);
};

function merged(intervals: (readonly [number, number])[]): (readonly [number, number])[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out.at(-1);
    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

// The stretches of a script that ran: V8's ranges nest (a function, its blocks, the functions inside it), and the
// innermost range holding an offset says whether it ran, so a block or an inner function that never ran is left out
// of the function around it.
interface Range {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}
function executed(ranges: readonly Range[]): readonly Range[] {
  const sorted = [...ranges].sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const out: Range[] = [];
  const stack: Range[] = [];
  let cursor = 0;
  const emit = (to: number) => {
    const top = stack.at(-1);
    if (top !== undefined && top.count > 0 && to > cursor) out.push({ startOffset: cursor, endOffset: to, count: top.count });
    cursor = Math.max(cursor, to);
  };
  for (const range of sorted) {
    while (stack.length > 0 && (stack.at(-1) as Range).endOffset <= range.startOffset) {
      emit((stack.at(-1) as Range).endOffset);
      stack.pop();
    }
    emit(range.startOffset);
    stack.push(range);
  }
  while (stack.length > 0) {
    emit((stack.at(-1) as Range).endOffset);
    stack.pop();
  }
  return out;
}

export async function startCoverage(page: Page): Promise<void> {
  await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
  await page.coverage.startCSSCoverage({ resetOnNavigation: false });
}

export async function stopCoverage(page: Page, info: TestInfo): Promise<void> {
  const [scripts, sheets] = await Promise.all([page.coverage.stopJSCoverage(), page.coverage.stopCSSCoverage()]);
  const lines = new Map<string, (readonly [number, number])[]>();
  for (const script of scripts) {
    if (!/\/assets\/.*\.js$/.test(new URL(script.url).pathname) || script.source === undefined) continue;
    const consumer = consumerOf(script.url);
    if (consumer === null) continue;
    const at = locator(script.source);
    for (const range of executed(script.functions.flatMap((fn) => fn.ranges))) {
      // every generated line of the stretch read back to its source line (a stretch may cross the bundle's modules)
      const start = at(range.startOffset);
      const end = at(Math.max(range.startOffset, range.endOffset - 1));
      for (let line = start.line; line <= end.line; line += 1) {
        const found = consumer.originalPositionFor({ line, column: line === start.line ? start.column : 0, bias: SourceMapConsumer.LEAST_UPPER_BOUND });
        const source = found.source === null ? null : sourcePath(found.source);
        if (source === null || found.line === null) continue;
        const held = lines.get(source) ?? [];
        held.push([found.line, found.line]);
        lines.set(source, held);
      }
    }
  }
  const selectors = new Set<string>();
  for (const sheet of sheets) {
    const css = sheet.text ?? '';
    for (const range of sheet.ranges) {
      // a used range starts at its rule's selector, or at its body: the selector is then the text before the brace
      const text = css.slice(range.start, range.end);
      const brace = text.indexOf('{');
      const close = text.indexOf('}');
      let header = brace > 0 && (close < 0 || brace < close) ? text.slice(0, brace) : '';
      if (header === '') {
        let i = range.start - 1;
        while (i >= 0 && /\s/.test(css[i] as string)) i -= 1;
        if (css[i] === '{') header = css.slice(Math.max(css.lastIndexOf('}', i), css.lastIndexOf('{', i - 1), css.lastIndexOf(';', i)) + 1, i);
      }
      for (const one of header.split(',')) selectors.add(one.replace(/\s+/g, ' ').trim());
    }
  }
  const keys = await page.evaluate(() => (window as unknown as { __builderTestPort?: { keys: () => string[] } }).__builderTestPort?.keys() ?? []).catch(() => [] as string[]);
  const test = [path.relative(process.cwd(), info.file).replaceAll('\\', '/'), ...info.titlePath.slice(1)].join(' › ');
  const record: TestCoverage = { test, lines: Object.fromEntries([...lines].map(([file, held]) => [file, merged(held)])), selectors: [...selectors].filter((one) => one !== '').sort(), keys };
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  fs.writeFileSync(path.join(COVERAGE_DIR, `${crypto.createHash('sha1').update(test).digest('hex')}.json`), JSON.stringify(record));
}

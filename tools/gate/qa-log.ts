// The rows of docs/QA-LOG.md as the gate reads them: one numbered row per change, its second cell the commit that made
// it. A row is written with the commit cell "(this commit)" because its own hash does not exist yet; the gate of the
// next commit writes the hash in, so the history always names its commits (the reviewer's R8 found 34 rows left
// unnamed while this was a rule to remember instead of a step of the gate).

export const PENDING = '(this commit)';

const ROW = /^\| (\d+) \| ([^|]*?) \|/;

interface Row {
  readonly number: number;
  readonly commit: string;
}

function rows(text: string): Row[] {
  return text.split('\n').flatMap((line) => {
    const match = ROW.exec(line);
    return match === null ? [] : [{ number: Number(match[1]), commit: (match[2] ?? '').trim() }];
  });
}

/** The numbers of the rows whose commit cell still says "(this commit)". */
export function pendingRows(text: string): number[] {
  return rows(text).filter((row) => row.commit === PENDING).map((row) => row.number);
}

/** The rows of `working` that `committed` does not have: the rows this commit adds. */
export function addedRows(committed: string, working: string): number[] {
  const held = new Set(rows(committed).map((row) => row.number));
  return rows(working).map((row) => row.number).filter((number) => !held.has(number));
}

/** The text with each pending row named in `hashes` given its commit; every other line is left as it is. */
export function fillHashes(text: string, hashes: ReadonlyMap<number, string>): string {
  return text
    .split('\n')
    .map((line) => {
      const match = ROW.exec(line);
      if (match === null || (match[2] ?? '').trim() !== PENDING) return line;
      const hash = hashes.get(Number(match[1]));
      return hash === undefined ? line : line.replace(`| ${PENDING} |`, `| ${hash} |`);
    })
    .join('\n');
}

/** The literal text that identifies a pending row in the history (git log -S finds the commit that added it). */
export const pendingMark = (number: number): string => `| ${number} | ${PENDING} |`;

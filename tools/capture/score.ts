// The corpus's scoreboard rule (docs/CAPTURE-CORPUS.md, written by tools/capture/report.ts): whether a measured site
// is at the target. The user, 2026-10-04: the target is 98 % ("pode ser 98"; DEC-62). A site counts when its reference
// is current and every width reaches the target. What the site blocks or never serves (its record's problem) is an
// observation beside the score, never a failure: every real site has some. A site under the target is inconclusive
// when, at every width under it, its own two live loads also differ by more than the target allows: the site varies.
import type { SiteRecord } from './corpus.capture.ts';

export const TARGET = 98;

export interface SiteVerdict {
  readonly kind: 'reached' | 'below' | 'inconclusive' | 'unmeasured';
  // the widths under the target
  readonly widths: readonly number[];
}

export function siteVerdict(record: SiteRecord, referenceCurrent: boolean, widths: readonly number[], target = TARGET): SiteVerdict {
  const scores = widths.map((width) => record.widths.find((one) => one.width === width));
  if (!referenceCurrent || scores.some((one) => one === undefined)) return { kind: 'unmeasured', widths: [] };
  const under = widths.filter((_, index) => (scores[index]?.pixelMatchAdjusted ?? 0) < target);
  if (under.length === 0) return { kind: 'reached', widths: [] };
  const varies = under.every((width) => {
    const live = record.referenceStability?.find((one) => one.width === width)?.pixelMatchCommon;
    return live !== undefined && live < target;
  });
  return { kind: varies ? 'inconclusive' : 'below', widths: under };
}

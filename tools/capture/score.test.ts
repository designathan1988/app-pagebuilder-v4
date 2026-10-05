// The corpus's scoreboard rule (tools/capture/score.ts). The user, 2026-10-04: the target is 98 % ("pode ser 98"). A
// site counts when its reference is current and its four widths reach 98 %; resources the site blocks are an
// observation, never a failure; a site below 98 % whose own live loads differ by as much is inconclusive.
import { describe, expect, it } from 'vitest';
import { siteVerdict, TARGET } from './score.ts';
import type { SiteRecord } from './corpus.capture.ts';

const WIDTHS = [1440, 1180, 834, 390] as const;
const record = (scores: readonly number[], stability: readonly number[] = [100, 100, 100, 100], problem: string | null = null): SiteRecord => ({
  id: 'site', url: 'https://site.test/', kind: 'landing', files: 10, elements: 100,
  widths: WIDTHS.map((width, index) => ({ width, pixelMatchCommon: scores[index] ?? 0, pixelMatchAdjusted: scores[index] ?? 0, originalHeight: 1000, exportHeight: 1000 })),
  referenceStability: WIDTHS.map((width, index) => ({ width, pixelMatchCommon: stability[index] ?? 100 })),
  problem,
});

describe('a site on the corpus scoreboard', () => {
  it('has the target of 98 %', () => {
    expect(TARGET).toBe(98);
  });

  it('is at the target with its four widths at 98 % or more (react: 100, 100, 98.5, 99.5)', () => {
    expect(siteVerdict(record([100, 100, 98.5, 99.5]), true, WIDTHS)).toEqual({ kind: 'reached', widths: [] });
    expect(siteVerdict(record([98, 98, 98, 98]), true, WIDTHS).kind).toBe('reached');
  });

  it('is at the target when resources it blocks are listed as its problem (every real site has some)', () => {
    expect(siteVerdict(record([100, 100, 100, 100], undefined, '46 captured resources unavailable or blocked; see capture snapshot package'), true, WIDTHS).kind).toBe('reached');
  });

  it('is below the target at the widths under 98 % when its live loads agree (nuxt: 96.3, 96.5, 97.5, 97.0)', () => {
    expect(siteVerdict(record([96.3, 96.5, 97.5, 97.0], [98.0, 100, 100, 100]), true, WIDTHS)).toEqual({ kind: 'below', widths: [1440, 1180, 834, 390] });
    expect(siteVerdict(record([100, 97.9, 100, 100]), true, WIDTHS)).toEqual({ kind: 'below', widths: [1180] });
  });

  it('is inconclusive when, at every width under 98 %, its own two live loads also differ by more than 2 %', () => {
    expect(siteVerdict(record([100, 97.7, 97.9, 100], [100, 97.0, 97.5, 100]), true, WIDTHS)).toEqual({ kind: 'inconclusive', widths: [1180, 834] });
  });

  it('is below, not inconclusive, when one width under 98 % has live loads that agree', () => {
    expect(siteVerdict(record([100, 97.7, 97.9, 100], [100, 97.0, 100, 100]), true, WIDTHS)).toEqual({ kind: 'below', widths: [1180, 834] });
  });

  it('is unmeasured with a stale reference or without its four widths, whatever its scores', () => {
    expect(siteVerdict(record([100, 100, 100, 100]), false, WIDTHS).kind).toBe('unmeasured');
    expect(siteVerdict({ ...record([100, 100, 100, 100]), widths: [] }, true, WIDTHS).kind).toBe('unmeasured');
    expect(siteVerdict({ ...record([100, 100, 100, 100]), widths: record([100, 100, 100, 100]).widths.slice(0, 3) }, true, WIDTHS).kind).toBe('unmeasured');
  });
});

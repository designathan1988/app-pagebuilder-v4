// The capture audit's horizontal overflow rule (tools/capture/audit.ts), on the widths the reviewer's R7 measured:
// bellroy's export before the ordered-DOM importer (5750d6d) and after it (.cache/logs/r7-1004/).
import { describe, expect, it } from 'vitest';
import { overflowsWindow } from './audit.ts';

describe('an export wider than its window', () => {
  it('is reported when the original fits the window (bellroy before 5750d6d: 1770, 1251 and 585 px)', () => {
    expect(overflowsWindow(1180, 1180, 1770)).toBe(true);
    expect(overflowsWindow(834, 834, 1251)).toBe(true);
    expect(overflowsWindow(390, 390, 585)).toBe(true);
  });

  it('is not reported when the export fits (bellroy after 5750d6d: 1180 px in 1180)', () => {
    expect(overflowsWindow(1180, 1180, 1180)).toBe(false);
    expect(overflowsWindow(1180, 1180, 1181)).toBe(false);
  });

  it('is not reported when the original itself is wider than the window (the site overflows, not the export)', () => {
    expect(overflowsWindow(1440, 1510, 1510)).toBe(false);
  });

  it('is not reported when a picture is missing', () => {
    expect(overflowsWindow(1180, null, 1770)).toBe(false);
    expect(overflowsWindow(1180, 1180, null)).toBe(false);
  });
});

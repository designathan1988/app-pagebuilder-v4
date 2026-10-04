// Family BA1 of the code audit (2026-10-04, second reading): a behaviour stored without an axis (the reader keeps it
// optional) runs on its kind's own axis (parallax on y, marquee on x), but the inspector drew the X button pressed for
// both and handed the amount door y for both: a marquee's amount was edited on the axis it does not run on.
import { describe, expect, it } from 'vitest';
import { behaviourAxis } from './commands.ts';

describe('a behaviour without an axis takes its kind\'s own (BA1)', () => {
  it('reads parallax on y and marquee on x, and a set axis as it is', () => {
    expect(behaviourAxis({ kind: 'parallax', amount: 0.3 })).toBe('y');
    expect(behaviourAxis({ kind: 'marquee', amount: 60 })).toBe('x');
    expect(behaviourAxis({ kind: 'marquee', amount: 60, axis: 'y' })).toBe('y');
  });
});

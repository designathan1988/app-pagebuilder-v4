// Family WH1 of the code audit (2026-10-04): Shift with the wheel steps a focused number field by ten. Chrome turns a
// Shift+wheel into a horizontal scroll (deltaX set, deltaY 0), the field read deltaY alone: Shift+wheel did nothing.
import { describe, expect, it } from 'vitest';
import { wheelStep } from './wheel-step.ts';

describe('a wheel notch over a number field (WH1)', () => {
  it('steps with Shift held, the notch arriving as deltaX', () => {
    expect(wheelStep({ deltaX: -100, deltaY: 0, shiftKey: true })).toBe('up');
    expect(wheelStep({ deltaX: 100, deltaY: 0, shiftKey: true })).toBe('down');
    expect(wheelStep({ deltaX: 0, deltaY: -100, shiftKey: false })).toBe('up');
    expect(wheelStep({ deltaX: 40, deltaY: 0, shiftKey: false })).toBeNull();
  });
});

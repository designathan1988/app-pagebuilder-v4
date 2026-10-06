import { describe, expect, it } from 'vitest';
import { travelInto } from './reveal.ts';

describe('travelInto', () => {
  it('leaves a box any part of which is in view where it is', () => {
    expect(travelInto(100, 200, 0, 500, 16)).toBe(0);
    expect(travelInto(-50, 10, 0, 500, 16)).toBe(0);
    expect(travelInto(490, 900, 0, 500, 16)).toBe(0);
  });
  it('brings a box below the view up to the view\'s end, an inset inside', () => {
    expect(travelInto(700, 800, 0, 500, 16)).toBe(500 - 16 - 800);
  });
  it('brings a box above the view down to its start, an inset inside', () => {
    expect(travelInto(-300, -200, 0, 500, 16)).toBe(16 + 300);
  });
  it('shows the start of a box taller than the view', () => {
    expect(travelInto(700, 1500, 0, 500, 16)).toBe(16 - 700);
  });
});

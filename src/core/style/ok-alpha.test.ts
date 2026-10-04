// Family CH1 of the code audit (2026-10-04, second reading): the alpha of a colour in OKLCH or OKLab went through
// RGB and was written as rgba(), clamped to sRGB, so a wide-gamut colour lost what lay outside sRGB; and OKLab's a axis
// was taken for the alpha, so editing a on a transparent colour kept it invisible while editing b or L made it opaque.
import { describe, expect, it } from 'vitest';
import { editedColour } from './color.ts';

describe('OKLCH and OKLab keep their colour when the alpha or an axis is edited (CH1)', () => {
  it('writes the alpha of an OKLCH colour in OKLCH, outside sRGB as it is', () => {
    expect(editedColour('oklch(70% 0.4 260)', 'alpha', '50', 'oklch')).toBe('oklch(70% 0.4 260 / 0.5)');
    expect(editedColour('oklab(50% 0.3 -0.2)', 'alpha', '25', 'oklab')).toBe('oklab(50% 0.3 -0.2 / 0.25)');
  });
  it('treats OKLab\'s a axis as the b axis is treated: neither is the alpha', () => {
    const a = editedColour('oklab(50% 0.1 0.1 / 0)', 'ok-a', '0.2', 'oklab') ?? '';
    const b = editedColour('oklab(50% 0.1 0.1 / 0)', 'ok-b', '0.2', 'oklab') ?? '';
    expect(a.includes(' / ')).toBe(b.includes(' / '));
  });
});

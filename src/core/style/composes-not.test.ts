// A composite whose longhands no shorthand writes (a border on one side alone) reads Mixed in its field, never its
// values strung together (src/core/style/set.ts composesNot; the audit of 2026-10-05: "  1px    solid    #eadfce ").
import { describe, expect, it } from 'vitest';
import { manifest } from '../../manifest/runtime.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { composedText, composesNot } from './set.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const sides = (width: readonly string[], style: readonly string[], colour: readonly string[]) => [...width, ...style, ...colour];

describe('composesNot (src/core/style/set.ts)', () => {
  it('says a border on its bottom side alone has no shorthand', () => {
    expect(composesNot('border', sides(['', '', '1px', ''], ['', '', 'solid', ''], ['', '', '#eadfce', '']), RULES)).toBe(true);
  });

  it('lets the four same sides compose, and a property without a shorthand of its own string its values', () => {
    const same = sides(['1px', '1px', '1px', '1px'], ['solid', 'solid', 'solid', 'solid'], ['red', 'red', 'red', 'red']);
    expect(composesNot('border', same, RULES)).toBe(false);
    expect(composedText('border', same, RULES)).toBe('1px solid red');
    expect(composesNot('padding', ['1px', '2px', '1px', '2px'], RULES)).toBe(false);
  });
});

// Family SZ1 of the code audit (2026-10-04, second reading): a file's size was read as three quarters of its base64
// text, padding included, so a file of 1 byte read "3 B" and one of 2 bytes "3 B" too (the Explorer counted the same
// way in two places of its own).
import { describe, expect, it } from 'vitest';
import { byteCount, sizeLabel } from './files.ts';

const file = (bytes: string) => ({ path: 'a.txt', type: 'text/plain', bytes });

describe('a file\'s size is its bytes (SZ1)', () => {
  it('counts what base64 holds, padding left out', () => {
    expect(byteCount(btoa('a'))).toBe(1);
    expect(byteCount(btoa('ab'))).toBe(2);
    expect(byteCount(btoa('abc'))).toBe(3);
    expect(sizeLabel(file(btoa('a')))).toBe('1 B');
  });
});

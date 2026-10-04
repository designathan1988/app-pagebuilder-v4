// Family PT1 of the code audit (2026-10-04, second reading): the HTML Standard compiles a pattern attribute with the
// RegExp v flag (unicodeSets, whatwg/html#7908), where an unescaped "(" or "-" in a character class is an error, and
// the browser then ignores the pattern. The element's field compiled it with v, but the validator without it, so an
// opened or imported pattern such as [(] was kept and never checked anything in the page.
import { describe, expect, it } from 'vitest';
import { attributeValueRefusal } from './validate.ts';
import { RULES } from '../testing/handlers.ts';

describe('a pattern is read as the browser reads it (PT1)', () => {
  it('refuses a pattern the v flag refuses, and keeps one it takes', () => {
    expect(attributeValueRefusal('pattern', '[(]', RULES)).not.toBeNull();
    expect(attributeValueRefusal('pattern', '[0-9]{3}', RULES)).toBeNull();
  });
});

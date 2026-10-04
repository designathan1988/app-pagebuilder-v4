// Family S1 of the code audit (2026-10-04): markup kept by the editor never acts on its own. An SVG's markup kept an
// <animate> or <set> whose to, from, values or by writes a javascript: address into a link at run time.
import { describe, expect, it } from 'vitest';
import { sanitizedSvgMarkup } from './svg.ts';

describe('an SVG keeps no animated link that runs code (S1)', () => {
  it('drops to, values and from that hold javascript:', () => {
    const read = sanitizedSvgMarkup('<a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="href" values="#a;JavaScript:alert(1)"/><text>x</text></a>');
    expect('markup' in read ? read.markup : '').not.toMatch(/javascript:/i);
  });
});

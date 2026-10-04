// Family GA1 of the code audit (2026-10-04, second reading): a grid area is named after its region (Header: header),
// but a region named Auto, Span, None or a CSS-wide keyword gave grid-area: auto or initial, which places the region
// automatically (or not at all) instead of in its area.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.ts';
import { PORTS, drawn, property } from '../testing/ports.ts';

describe('a grid area never takes a keyword as its name (GA1)', () => {
  it('names a region called Auto with a name of its own', () => {
    const graph = drawn(1000, 600, [{ x: 0, y: 0, width: 1000, height: 100 }, { x: 0, y: 100, width: 300, height: 500 }, { x: 300, y: 100, width: 700, height: 300 }], (r, i) => ({ ...r, name: ['Auto', 'Initial', 'Span'][i] ?? r.name }));
    const compiled = compile({ ...graph, preferences: { $root: 'grid' } }, PORTS);
    const areas = compiled.root.children.map((child) => child.styles[property('gridArea')]);
    for (const area of areas) expect(['auto', 'initial', 'span', 'inherit', 'unset', 'none', 'default', 'revert']).not.toContain(area);
  });
});

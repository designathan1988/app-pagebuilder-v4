import { describe, expect, it } from 'vitest';
import { CONCEPT_ROWS, detailsHoldMore, rowClosed, rowOfItem } from './concept-rows.ts';
import type { EditorUi } from '../state.ts';

const row = (id: string) => {
  const found = CONCEPT_ROWS.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no concept row ${id}`);
  return found;
};
const ui = (preferences: Record<string, unknown> = {}) => ({ preferences: { locale: 'en', theme: 'dark', ...preferences } }) as unknown as EditorUi;

describe('concept rows (src/editor/inspector/concept-rows.ts)', () => {
  it('knows the row and the part of every item properties.json names', () => {
    expect(rowOfItem('style.set#inspector-overflow-x')).toEqual({ row: row('overflow'), part: 'details' });
    expect(rowOfItem('style.set#inspector-overflow')).toEqual({ row: row('overflow'), part: 'head' });
    expect(rowOfItem('style.set#inspector-width')).toBeNull();
  });

  // The user's review of 2026-10-05: "por que max está dentro de mín?" A row's details are what its head is made of (a
  // border's sides, a radius's corners, an overflow's axes) or settings that act only through it (an overflow's resize,
  // a background image's size); a field is never inside another of its kind. Where a concept's fields are peers, the
  // row's head is the concept's name and what its fields hold (Scroll, Table), or the fields are rows of their own.
  it('puts no field inside a peer of it', () => {
    // Max is no part of Min, Clear none of Float, Stroke none of Fill: rows of their own
    for (const peer of ['pair:size-min', 'pair:size-max', 'style.set#inspector-float', 'style.set#inspector-clear', 'style.set#inspector-fill', 'style.set#inspector-stroke', 'style.set#inspector-stroke-width']) {
      expect(rowOfItem(peer), peer).toBeNull();
    }
    // the grid's tracks hold their raw value, never the auto flow or the areas
    expect(row('grid-columns').details).toEqual(['style.set#inspector-grid-template-columns']);
    expect(row('grid-rows').details).toEqual(['style.set#inspector-grid-template-rows']);
    expect(rowOfItem('style.set#inspector-grid-auto-flow')).toBeNull();
    expect(rowOfItem('style.set#inspector-grid-template-areas')).toBeNull();
    // scroll and table: peers under the concept's name
    expect(row('scroll').head).toEqual([]);
    expect(row('scroll').details).toEqual(['style.set#inspector-scroll-behavior', 'style.set#inspector-scroll-snap-type', 'style.set#inspector-scroll-snap-align']);
    expect(row('table').head).toEqual([]);
    expect(row('table').details).toEqual(['style.set#inspector-border-collapse', 'style.set#inspector-border-spacing', 'style.set#inspector-table-layout', 'style.set#inspector-caption-side', 'style.set#inspector-empty-cells']);
  });

  it('opens by itself only when a detail holds a value its head does not show', () => {
    // nothing held: closed
    expect(rowClosed(ui(), row('overflow'), new Set())).toBe(true);
    // overflow-x held: the head (overflow) edits it too, so it shows it: closed
    expect(detailsHoldMore(row('overflow'), new Set(['overflow-x']))).toBe(false);
    // resize held: no field of the head edits it: open
    expect(rowClosed(ui(), row('overflow'), new Set(['resize']))).toBe(false);
    // a summary row (no head) opens as soon as a detail holds anything
    expect(rowClosed(ui(), row('filter'), new Set(['filter']))).toBe(false);
    expect(rowClosed(ui(), row('filter'), new Set())).toBe(true);
    // the border's sides are its longhands, which the border's head edits: a border set keeps the row closed
    expect(detailsHoldMore(row('border'), new Set(['border-top-width', 'border-top-style', 'border-top-color']))).toBe(false);
  });

  it("the user's choice wins over what the element holds", () => {
    expect(rowClosed(ui({ collapsedRows: ['overflow'] }), row('overflow'), new Set(['resize']))).toBe(true);
    expect(rowClosed(ui({ expandedRows: ['overflow'] }), row('overflow'), new Set())).toBe(false);
  });
});

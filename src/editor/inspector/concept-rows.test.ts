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
    expect(rowOfItem('pair:size-max')).toEqual({ row: row('limits'), part: 'details' });
    expect(rowOfItem('style.set#inspector-width')).toBeNull();
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

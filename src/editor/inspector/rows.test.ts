import { describe, expect, it } from 'vitest';
import manifestFile from '../../../manifest/properties.json';
import en from '../../i18n/locales/en.json';
import pt from '../../i18n/locales/pt-BR.json';
import { PAIR_ROWS, groupOf, groupOfDoor, groupsOf, orderByGroup, pairRowOf } from './rows.ts';

const MANIFEST = manifestFile as {
  rows: { id: string; section: string; labelKey: string | null; fields: { target: string; prefixKey: string | null }[] }[];
  sections: { id: string; groups: { id: string }[] }[];
};
const EN = en as Record<string, string>;

describe('the pair rows (inspector/rows.ts)', () => {
  it('reads every row of properties.json, with the first field naming it', () => {
    expect(PAIR_ROWS.map((r) => r.id)).toEqual(MANIFEST.rows.map((r) => r.id));
    for (const row of PAIR_ROWS) {
      const declared = MANIFEST.rows.find((r) => r.id === row.id);
      expect(row.fields.map((f) => f.target)).toEqual(declared?.fields.map((f) => f.target));
      expect(row.section).toBe(declared?.section);
      // the label is the row's own (a concept: Size, Gap), else the first field's own, and every name is a word of the
      // catalogue
      if (declared?.labelKey === null) expect(row.labelKey).toMatch(/^property\./);
      else expect(row.labelKey).toBe(declared?.labelKey);
      expect(EN[row.labelKey], `${row.labelKey} is a word of the catalogue`).toBeDefined();
      for (const field of row.fields) if (field.prefixKey !== null) expect(EN[field.prefixKey], `${field.prefixKey} is a word of the catalogue`).toBeDefined();
    }
  });

  it('finds the row a target stands in, and none for a target without one', () => {
    expect(pairRowOf('width')?.id).toBe('size-width-height');
    expect(pairRowOf('height')?.id).toBe('size-width-height');
    // letter spacing has a line of its own since the user's review of 2026-10-05 (a half could not hold its name)
    expect(pairRowOf('letter-spacing')).toBeNull();
    expect(pairRowOf('min-height')?.id).toBe('size-min');
    expect(pairRowOf('opacity')).toBeNull();
    expect(pairRowOf('nope')).toBeNull();
  });

  // The user's review of 2026-10-05 (.cache/logs/labels-review): "Width" beside "H", "Min width" beside "max", a font
  // weight with no name, arrows standing for names. One rule: a row that names a concept (Size, Gap) names each of its
  // fields too; a row named by its first field names its second; every name is a word in every language; the size rows
  // keep one axis per column, as the quick panel's W and H do.
  it('names every field of a pair row with a word', () => {
    const PT = pt as Record<string, string>;
    for (const row of PAIR_ROWS) {
      const own = MANIFEST.rows.find((r) => r.id === row.id)?.labelKey ?? null;
      row.fields.forEach((field, index) => {
        if (index === 0 && own === null) return;
        expect(field.prefixKey, `${row.id}: ${field.target} has a name`).not.toBeNull();
        for (const [language, words] of [['en', EN], ['pt-BR', PT]] as const) expect(words[field.prefixKey ?? ''] ?? '', `${row.id}: ${field.target} in ${language}`).toMatch(/\p{L}/u);
      });
    }
    for (const key of ['quickPanel.key.lineHeight', 'quickPanel.key.letterSpacing']) expect(EN[key] ?? '', key).toMatch(/\p{L}/u);
  });

  it('keeps one axis per column in the size rows, named as the quick panel names them', () => {
    const size = PAIR_ROWS.filter((row) => row.section === 'size');
    expect(size.map((row) => row.fields.map((f) => f.target))).toEqual([['width', 'height'], ['min-width', 'min-height'], ['max-width', 'max-height']]);
    for (const row of size) expect(row.fields.map((f) => f.prefixKey)).toEqual(['quickPanel.width', 'quickPanel.height']);
  });
});

describe('the groups of a section (inspector/rows.ts)', () => {
  it('reads the groups properties.json declares, in their order', () => {
    expect(groupsOf('layout').map((g) => g.id)).toEqual(MANIFEST.sections.find((s) => s.id === 'layout')?.groups.map((g) => g.id));
    expect(groupsOf('nope')).toEqual([]);
  });

  it('knows the group of a property and of a control that edits one', () => {
    expect(groupOf('width')).toBe('size');
    expect(groupOf('grid-template-columns')).toBe('grid');
    expect(groupOf('nope')).toBeNull();
    // the grid's track editor writes grid-template-columns, so it belongs to the grid group of the Layout section
    expect(groupOfDoor('style.setGridTracks#inspector-grid-template-columns-add-track')).toBe('grid');
    expect(groupOfDoor('style.set#inspector-display')).toBe('display');
  });


  it('orders a section group by group, keeping the order inside a group and attaching a control to the field before it', () => {
    const entries = [
      { ref: 'a', target: 'column-span' },
      { ref: 'b', target: 'display' },
      { ref: 'c', target: 'grid-template-columns' },
      { ref: 'd', target: 'flex-direction' },
      { ref: 'e' },
    ];
    // layout's groups in order: display, flex, grid, in-parent, columns, scroll, table — and the control that
    // edits no property of its own (e) stays in the group of the field before it (flex)
    expect(orderByGroup('layout', entries).map((e) => e.ref)).toEqual(['b', 'd', 'e', 'c', 'a']);
    // a section with one group keeps the order it is given
    expect(orderByGroup('space', entries).map((e) => e.ref)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

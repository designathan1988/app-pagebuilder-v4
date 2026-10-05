// The validation rules a form control's kind can break (src/core/elements/inputs.ts rulesOfControl): its Settings tab
// offers these and their messages alone (the audit of 2026-10-05: a checkbox offered counts, a password's
// requirements, dates and file types).
import { describe, expect, it } from 'vitest';
import type { DocNode } from '../document/model.ts';
import { rulesOfControl } from './inputs.ts';

const control = (tag: string, inputType?: string): DocNode => ({ id: 'n', type: tag === 'input' ? 'input' : tag, name: 'Field', tag, attributes: inputType === undefined ? {} : { inputType }, classes: [], styles: {}, text: null, children: [] }) as unknown as DocNode;

describe('rulesOfControl', () => {
  it('gives a checkbox and a radio being required alone', () => {
    expect([...rulesOfControl(control('input', 'checkbox'))].sort()).toEqual(['configuration', 'required']);
    expect([...rulesOfControl(control('input', 'radio'))].sort()).toEqual(['configuration', 'required']);
  });

  it('gives a text its counts and pattern, a password its requirements too, never dates or files', () => {
    const text = rulesOfControl(control('input', 'text'));
    expect(text.has('tooShort') && text.has('pattern')).toBe(true);
    expect(text.has('password') || text.has('dateMinimum') || text.has('fileType')).toBe(false);
    expect(rulesOfControl(control('input', 'password')).has('password')).toBe(true);
    expect(rulesOfControl(control('textarea')).has('tooLong')).toBe(true);
  });

  it('gives a date its days, a number its bounds and step, a file its types and sizes, a select its values', () => {
    expect(rulesOfControl(control('input', 'date')).has('dateMaximum')).toBe(true);
    expect(rulesOfControl(control('input', 'date')).has('tooShort')).toBe(false);
    expect([...rulesOfControl(control('input', 'number'))]).toEqual(expect.arrayContaining(['minimum', 'maximum', 'step']));
    expect([...rulesOfControl(control('input', 'file'))]).toEqual(expect.arrayContaining(['fileType', 'fileSize']));
    expect([...rulesOfControl(control('select'))].sort()).toEqual(['allowed', 'configuration', 'required']);
  });
});

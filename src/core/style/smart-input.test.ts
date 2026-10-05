// Smart input (the plan's stage 3, "entrada inteligente"): arithmetic on lengths worked out or written as calc(), and
// keywords typed and shown in the person's language.
import { describe, expect, it } from 'vitest';
import { lengthPercentage, workOutLengths, type ValueFacts } from './codecs.ts';
import { keywordOfWord } from './keyword-words.ts';
import { translate } from '../../i18n/index.ts';

const facts: ValueFacts = { units: ['px', '%', 'rem', 'em', 'vh'], keywords: ['auto', 'none'], defaultUnit: 'px' };
const read = (text: string) => lengthPercentage.read(text, facts);

describe('arithmetic on lengths', () => {
  it('works one unit out, a plain number beside it taking it', () => {
    expect(read('16px*2')).toEqual({ kind: 'length', number: 32, unit: 'px' });
    expect(read('10px + 4')).toEqual({ kind: 'length', number: 14, unit: 'px' });
    expect(read('(2rem + 1rem) / 2')).toEqual({ kind: 'length', number: 1.5, unit: 'rem' });
    expect(read('64/2')).toEqual({ kind: 'length', number: 32, unit: 'px' });
  });
  it('writes different units added or taken away as calc(), spaced as CSS writes it', () => {
    expect(read('100% - 20px')).toEqual({ kind: 'expression', text: 'calc(100% - 20px)' });
    expect(read('100vh-4rem')).toEqual({ kind: 'expression', text: 'calc(100vh - 4rem)' });
    expect(read('(100% - 2rem) / 3')).toEqual({ kind: 'expression', text: 'calc((100% - 2rem) / 3)' });
    expect(lengthPercentage.write(read('50% + 1em') ?? { kind: 'keyword', keyword: '' })).toBe('calc(50% + 1em)');
  });
  it('refuses two lengths multiplied, a division by a length or by zero, and a unit the property lacks', () => {
    for (const text of ['10px * 2px', '10px / 2px', '10px / 0', '10pt + 2px', '10px +', '(10px']) expect(workOutLengths(text, facts.units)).toBeNull();
    expect(read('2bogus')).toBeNull();
  });
});

describe('keywords in the person’s language', () => {
  const pt = (key: Parameters<typeof translate>[1]) => translate('pt-BR', key);
  const en = (key: Parameters<typeof translate>[1]) => translate('en', key);
  it('reads a word typed in any case, with or without accents, as its keyword where the property offers it', () => {
    expect(keywordOfWord('automático', facts.keywords, pt)).toBe('auto');
    expect(keywordOfWord('  AUTOMATICO ', facts.keywords, pt)).toBe('auto');
    expect(keywordOfWord('nenhum', facts.keywords, pt)).toBe('none');
    expect(keywordOfWord('negrito', facts.keywords, pt)).toBeNull();
    expect(keywordOfWord('auto', facts.keywords, en)).toBe('auto');
  });
});

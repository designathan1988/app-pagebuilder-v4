import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { anyCss, type CssSupport } from '../ports/css.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { convertLength, lengthPercentage, workOut, writeNumber } from './codecs.ts';
import { setStyleCommand } from './set.ts';
import { storedValue } from './stored.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const doc = (actions: Partial<DocNode> = {}, locked: Partial<DocNode> = {}): DocumentJson => ({
  version: 4,
  pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Hero', 'section', 'section', { ...locked, children: [node('Actions', 'div', 'div', actions), node('Other', 'div', 'div')] })] }) }],
});
// a browser that refuses a negative width or height, as Chrome does
const chrome: CssSupport = { supports: (property, value) => !((property === 'width' || property === 'height') && value.trim().startsWith('-')) };
const context = (document: DocumentJson, selection: string[], css: CssSupport = chrome): HandlerContext<never> => ({
  state: { document, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
  clock: manualClock(),
  ids: sequentialIds('x'),
  rules: RULES,
  words: (key) => key,
  layout: noLayout,
  css,
});
const run = (document: DocumentJson, selection: string[], value: string, property = 'width', css: CssSupport = chrome) => setStyleCommand.run(context(document, selection, css), { property: property as never, value });
const widthOf = (document: DocumentJson, id: string) => {
  const found = document.pages[0]?.tree.children[0]?.children.find((n) => n.id === id);
  return found ? storedValue(found, 'width', RULES) : undefined;
};
const FACTS = { units: ['px', '%', 'pt', 'em'], keywords: ['auto', 'min-content'], defaultUnit: 'px' };

describe('the length-percentage codec', () => {
  it('reads a number with a unit, a bare number in the default unit, a keyword, arithmetic and calc()', () => {
    expect(lengthPercentage.read(' 24PX ', FACTS)).toEqual({ kind: 'length', number: 24, unit: 'px' });
    expect(lengthPercentage.read('30', { ...FACTS, defaultUnit: '%' })).toEqual({ kind: 'length', number: 30, unit: '%' });
    expect(lengthPercentage.read('Auto', FACTS)).toEqual({ kind: 'keyword', keyword: 'auto' });
    expect(lengthPercentage.read('64/2', FACTS)).toEqual({ kind: 'length', number: 32, unit: 'px' });
    expect(lengthPercentage.read('(10 + 2) * 3', FACTS)).toEqual({ kind: 'length', number: 36, unit: 'px' });
    expect(lengthPercentage.read('calc(100% - 20px)', FACTS)).toEqual({ kind: 'expression', text: 'calc(100% - 20px)' });
  });

  it('reads nothing from words, units the property does not offer, broken sums and unbalanced calls', () => {
    for (const text of ['abc', '', '24vw', '2 +', '4/0', 'calc(100% - (20px)', '1..2', 'url(x)']) expect(lengthPercentage.read(text, FACTS), text).toBeNull();
  });

  it('works sums out without evaluating code', () => {
    expect(workOut('1+2*3')).toBe(7);
    expect(workOut('-(4-6)')).toBe(2);
    expect(workOut('alert(1)')).toBeNull();
  });

  it('writes at most four decimals and never -0', () => {
    expect(writeNumber(240 - 0.1)).toBe('239.9');
    expect(writeNumber(1 / 3)).toBe('0.3333');
    expect(writeNumber(-0)).toBe('0');
    expect(lengthPercentage.write({ kind: 'length', number: 180.00000000000003, unit: 'pt' })).toBe('180pt');
  });

  it('converts between absolute units and zero into any unit, and nothing that needs the page', () => {
    expect(convertLength({ number: 240, unit: 'px' }, 'pt')).toBeCloseTo(180);
    expect(convertLength({ number: 96, unit: 'px' }, 'in')).toBeCloseTo(1);
    expect(convertLength({ number: 0, unit: 'px' }, '%')).toBe(0);
    expect(convertLength({ number: 240, unit: 'px' }, '%')).toBeNull();
    expect(convertLength({ number: 2, unit: 'em' }, 'px')).toBeNull();
  });
});

describe('style.set', () => {
  it('writes the value at the base breakpoint and state of every selected element, in one transaction, and says it', () => {
    const before = doc();
    const outcome = run(before, ['Actions'], '240');
    if (outcome.kind !== 'change') throw new Error(outcome.kind);
    const after = applyPatches(before, outcome.patches ?? []).document;
    expect(after.pages[0]?.tree.children[0]?.children[0]?.styles).toEqual({ desktop: { base: { width: '240px' } } });
    expect(validateDocument(after, [], RULES)).toEqual([]);
    expect(outcome.message).toEqual({ key: 'status.style.set', params: { property: { key: 'property.width' }, name: 'Actions', value: '240px' } });
    const both = run(before, ['Actions', 'Other'], '10%');
    if (both.kind !== 'change') throw new Error(both.kind);
    const written = applyPatches(before, both.patches ?? []).document;
    expect([widthOf(written, 'Actions'), widthOf(written, 'Other')]).toEqual(['10%', '10%']);
    expect(both.message?.key).toBe('status.style.setMany');
  });

  // spec inspector-number-fields, Problems in Pager 4 (the audit's A3.32): the field's default unit, never the one held
  it('gives a bare number the field\'s default unit, px, even when the element holds another unit', () => {
    const outcome = run(doc({ styles: { desktop: { base: { width: '50%' } } } }), ['Actions'], '30');
    if (outcome.kind !== 'change') throw new Error(outcome.kind);
    expect(outcome.patches?.[0]).toMatchObject({ value: { desktop: { base: { width: '30px' } } } });
  });

  it('keeps the other declarations and records nothing for the value already held', () => {
    const held = doc({ styles: { desktop: { base: { width: '240px', height: '10px' } } } });
    const outcome = run(held, ['Actions'], '240px');
    expect(outcome).toMatchObject({ kind: 'change', patches: [] });
    const other = run(held, ['Actions'], '1px', 'height');
    if (other.kind !== 'change') throw new Error(other.kind);
    expect(other.patches?.[0]).toMatchObject({ value: { desktop: { base: { width: '240px', height: '1px' } } } });
  });

  it('refuses a text the property does not take, or the browser does not, with the field and the text', () => {
    expect(run(doc(), ['Actions'], 'abc')).toEqual({ kind: 'refused', message: { key: 'status.value.invalid', params: { property: { key: 'property.width' }, value: 'abc' } } });
    expect(run(doc(), ['Actions'], '-10px').kind).toBe('refused');
    expect(run(doc(), ['Actions'], '-10px', 'width', anyCss).kind).toBe('change');
  });

  it('refuses a locked element and an element inside one', () => {
    expect(run(doc({ locked: true }), ['Actions'], '240')).toEqual({ kind: 'refused', message: { key: 'status.locked.edit', params: { name: 'Actions' } } });
    expect(run(doc({}, { locked: true }), ['Actions'], '240')).toEqual({ kind: 'refused', message: { key: 'status.locked.byAncestor', params: { name: 'Actions', ancestor: 'Hero' } } });
  });

  it('changes nothing with nothing selected', () => {
    expect(run(doc(), [], '240')).toEqual({ kind: 'change' });
  });
});

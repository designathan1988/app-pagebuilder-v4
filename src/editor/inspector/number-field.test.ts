import { describe, expect, it } from 'vitest';
import type { HandlerContext } from '../../core/commands/registry.ts';
import type { DocNode, DocumentJson, NodeId } from '../../core/document/model.ts';
import { rulesFromManifest } from '../../core/document/validate.ts';
import { EMPTY_HISTORY } from '../../core/history/history.ts';
import { manualClock } from '../../core/ports/clock.ts';
import type { CssSupport } from '../../core/ports/css.ts';
import { sequentialIds } from '../../core/ports/ids.ts';
import { noLayout } from '../../core/ports/layout.ts';
import { manifest } from '../../manifest/runtime.ts';
import { cancelField, factorOf, scrubField, setFieldUnit, stepField } from './number-field.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const DOC = (actions: Partial<DocNode> = {}): DocumentJson => ({
  version: 3,
  pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Actions', 'div', 'div', actions)] }) }],
});
const chrome: CssSupport = { supports: (property, value) => !(property === 'width' && value.startsWith('-')) };
const context = (document = DOC()): HandlerContext<never> => ({
  state: { document, selection: ['Actions' as NodeId], history: EMPTY_HISTORY, message: null, ui: undefined as never },
  clock: manualClock(),
  ids: sequentialIds('x'),
  rules: RULES,
  words: (key) => key,
  layout: noLayout,
  css: chrome,
});
const constant = (id: string) => manifest.interactions.constants.find((c) => c.id === id)?.value as number;
// the width an outcome writes
const written = (outcome: ReturnType<typeof stepField.run>) => (outcome.kind === 'change' ? (outcome.patches?.[0] as { value?: { desktop?: { base?: { width?: string } } } } | undefined)?.value?.desktop?.base?.width : outcome.kind);
const width = 'width' as never;

describe('the number fields', () => {
  it('step by numberField.step, the page keys by numberField.pageStep, Shift and Alt by their factors', () => {
    expect(factorOf('Shift')).toBe(constant('numberField.shiftFactor'));
    expect(factorOf('Alt')).toBe(constant('numberField.altFactor'));
    const step = (args: Partial<Parameters<typeof stepField.run>[1]>) => written(stepField.run(context(), { property: width, value: '240px', direction: 'up', size: 'step', ...args }));
    expect(step({})).toBe('241px');
    expect(step({ direction: 'down' })).toBe('239px');
    expect(step({ modifier: 'Shift' })).toBe('250px');
    expect(step({ direction: 'down', modifier: 'Alt' })).toBe('239.9px');
    expect(step({ size: 'page' })).toBe('250px');
    expect(step({ size: 'page', direction: 'down' })).toBe('230px');
    // a bare number typed and not kept yet takes the field's default unit, never the unit held (Problems in Pager 4)
    expect(written(stepField.run(context(DOC({ styles: { desktop: { base: { width: '10%' } } } })), { property: width, value: '30', direction: 'up', size: 'step' }))).toBe('31px');
    // a font-relative unit steps by numberField.fineStep, with the factors (Problems in Pager 4)
    expect(step({ value: '2em' })).toBe('2.1em');
    expect(step({ value: '2rem', direction: 'down', modifier: 'Shift' })).toBe('1rem');
  });

  it('say that a field holding no number to step steps nothing, and step nothing in an empty one', () => {
    for (const value of ['auto', 'abc', 'calc(100% - 20px)']) {
      const outcome = stepField.run(context(), { property: width, value, direction: 'up', size: 'step' });
      expect(outcome).toMatchObject({ kind: 'refused', message: { key: 'status.value.notSteppable', params: { value } } });
    }
    expect(stepField.run(context(), { property: width, value: '', direction: 'up', size: 'step' })).toEqual({ kind: 'change' });
  });

  it('scrub one step per numberField.scrubPixelsPerStep, with the factors, and stop at zero where negatives are refused', () => {
    const scrub = (distance: number, modifier?: 'Shift' | 'Alt') => written(scrubField.run(context(), { property: width, value: '240px', distance, ...(modifier ? { modifier } : {}) }));
    expect(scrub(50)).toBe(`${240 + Math.round(50 / constant('numberField.scrubPixelsPerStep'))}px`);
    expect(scrub(20, 'Shift')).toBe('340px');
    expect(scrub(20, 'Alt')).toBe('241px');
    expect(scrub(-600)).toBe('0px');
    // 40 px of scrub on 3em is 20 steps of numberField.fineStep: 5em, never 23em (Problems in Pager 4)
    expect(written(scrubField.run(context(), { property: width, value: '3em', distance: 40 }))).toBe('5em');
  });

  it('set a keyword, convert a length between absolute units, and refuse a unit it cannot convert to', () => {
    const unit = (value: string, to: string) => setFieldUnit.run(context(), { property: width, value, unit: to });
    expect(written(unit('240px', 'pt'))).toBe('180pt');
    expect(written(unit('240px', 'auto'))).toBe('auto');
    expect(written(unit('0px', '%'))).toBe('0%');
    expect(unit('240px', '%')).toEqual({ kind: 'refused', message: { key: 'status.value.unitNotConverted', params: { unit: '%' } } });
    expect(unit('auto', 'px').kind).toBe('refused');
  });

  it('refuse a locked element', () => {
    expect(stepField.run(context(DOC({ locked: true })), { property: width, value: '240px', direction: 'up', size: 'step' })).toEqual({ kind: 'refused', message: { key: 'status.locked.edit', params: { name: 'Actions' } } });
  });

  it('cancel by saying the field keeps the value the document holds, writing nothing', () => {
    expect(cancelField.run(context(), { property: width })).toEqual({ kind: 'change', message: { key: 'status.field.cancelled', params: { property: { key: 'property.width' }, name: 'Actions' } } });
  });
});

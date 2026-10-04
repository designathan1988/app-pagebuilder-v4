// J28: a change on several selected elements is said with their count ("Padding of 3 elements: 8px"), never with the
// first element's name alone.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext, Outcome } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { manualClock } from '../ports/clock.ts';
import { anyCss } from '../ports/css.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { resetAllCommand, resetValueCommand } from './reset.ts';
import { setStyleCommand } from './set.ts';
import { setSpacingCommand } from './spacing.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const styled = { desktop: { base: { 'padding-top': '4px', color: 'red' } } };
const node = (id: string): DocNode => ({ id: id as NodeId, type: 'div' as DocNode['type'], name: id, tag: 'div', attributes: {}, classes: [], styles: styled as DocNode['styles'], text: null, children: [] });
const doc: DocumentJson = { version: 4, pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: { ...node('Page'), type: 'page' as DocNode['type'], tag: 'body', styles: {}, children: [node('A'), node('B'), node('C')] } }] } as DocumentJson;
const context = (selection: readonly string[]): HandlerContext<never> =>
  ({ state: { document: doc, selection, history: EMPTY_HISTORY, message: null, ui: undefined as never }, clock: manualClock(), ids: sequentialIds('x'), rules: RULES, words: (key: string) => key, layout: noLayout, css: anyCss, styleClass: null }) as unknown as HandlerContext<never>;
const said = (outcome: Outcome<never>) => (outcome.kind === 'change' ? outcome.message : null);

describe('several elements are named by their count', () => {
  it('in spacing, a set value, a reset and a reset of every value', () => {
    expect(said(setSpacingCommand.run(context(['A', 'B', 'C']), { box: 'padding', sides: 'all', value: '8px' } as never))).toMatchObject({ key: 'status.style.setMany', params: { count: 3 } });
    expect(said(setStyleCommand.run(context(['A', 'B']), { property: 'color' as never, value: 'blue' }))).toMatchObject({ key: 'status.style.setMany', params: { count: 2 } });
    expect(said(resetValueCommand.run(context(['A', 'B']), { property: 'color' } as never))).toMatchObject({ key: 'status.style.resetMany', params: { count: 2 } });
    expect(said(resetAllCommand.run(context(['A', 'B', 'C']), {} as never))).toMatchObject({ key: 'status.style.resetAllMany', params: { count: 3 } });
  });
  it('one element is named by its name', () => {
    expect(said(setSpacingCommand.run(context(['A']), { box: 'padding', sides: 'all', value: '8px' } as never))).toMatchObject({ key: 'status.spacing.set', params: { name: 'A' } });
    expect(said(resetAllCommand.run(context(['B']), {} as never))).toMatchObject({ key: 'status.style.resetAll', params: { name: 'B' } });
  });
});

import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { anyCss } from '../ports/css.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { deleteToken, renameToken, usesOf, usesToken } from './tokens.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const IDS = sequentialIds('x');
const context = (document: DocumentJson): HandlerContext<never> => ({
  state: { document, selection: [], history: EMPTY_HISTORY, message: null, ui: undefined as never },
  clock: manualClock(),
  ids: IDS,
  rules: RULES,
  words: (key) => key,
  layout: noLayout,
  css: anyCss,
});
const shadow = (colour: string) => [{ color: colour, offsetX: '0px', offsetY: '2px', blur: '4px', spread: '0px', inset: false, hidden: false }];

// A project that names the variable brand in every holder the traversal must read: an element's own style, the
// element's keyframe, and the class it lists — with a second element that lists the class, and the class's own
// background. The elements are the ones the refusal counts.
function project(withElements: boolean): DocumentJson {
  const card = (id: string): DocNode => node(id, 'article', 'article', { classes: ['card'], styles: { desktop: { base: { 'box-shadow': shadow('var(--brand)') } } }, animations: [{ name: `pulse-${id}`, settings: { duration: '2s', delay: '0s', iterations: '1', direction: 'normal', fill: 'none', timing: 'ease', 'play-state': 'running' } as unknown as { readonly [k: string]: string }, keyframes: [{ offset: 0, easing: 'ease', declarations: { 'background-color': 'var(--brand)' } }, { offset: 100, easing: 'ease', declarations: { 'background-color': '#ffffff' } }] }] });
  const styles = { desktop: { base: { 'background-color': 'var(--brand)' } } };
  return {
    version: 4,
    pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: withElements ? [card('Card'), card('CardB')] : [] }) }],
    tokens: [{ name: 'brand', kind: 'color', value: '#ff0000' }],
    classes: [{ name: 'card', styles }],
  };
}

describe('the variable references (spec css-variables-tokens, Problems in Pager 2 and 3)', () => {
  it('finds the uses in an element, in its keyframes and in a class, and counts the elements that list it', () => {
    const document = project(true);
    const holders = usesOf(document, 'brand').map((use) => use.holder);
    expect(holders).toContain('element');
    expect(holders).toContain('class');
    expect(holders).toContain('animation');
    // both cards name it themselves, both list the class: two elements, counted once each
    expect(usesToken(document, 'brand')).toBe(2);
  });

  it('renames every use, in the element, in its keyframes and in the class, one undo step', () => {
    const document = project(true);
    const outcome = renameToken.run(context(document), { token: 'brand', name: 'brand-primary' });
    if (outcome.kind !== 'change') throw new Error(`refused: ${JSON.stringify(outcome)}`);
    const next = applyPatches(document, outcome.patches ?? []).document;
    expect(validateDocument(next, [], RULES)).toEqual([]);
    expect(next.tokens?.[0]?.name).toBe('brand-primary');
    expect(next.classes?.[0]?.styles.desktop?.base?.['background-color']).toBe('var(--brand-primary)');
    const card = next.pages[0]?.tree.children[0];
    // the structured value's layer text, not only a plain string value
    expect((card?.styles.desktop?.base?.['box-shadow'] as readonly { readonly color?: string }[])[0]?.color).toBe('var(--brand-primary)');
    expect(card?.animations?.[0]?.keyframes[0]?.declarations['background-color']).toBe('var(--brand-primary)');
  });

  it('refuses to delete a variable a class uses, naming the elements that list the class', () => {
    const outcome = deleteToken.run(context(project(true)), { token: 'brand' });
    expect(outcome.kind).toBe('refused');
    expect(JSON.stringify(outcome)).toContain('status.tokens.inUse');
    expect(JSON.stringify(outcome)).toContain('"count":2');
  });

  it('refuses to delete a variable only a class names, when no element lists it', () => {
    const outcome = deleteToken.run(context(project(false)), { token: 'brand' });
    expect(outcome.kind).toBe('refused');
    expect(JSON.stringify(outcome)).toContain('status.tokens.inUseShared');
  });

  it('deletes a variable nothing names', () => {
    const document = project(false);
    // the class still names it: refused
    expect(deleteToken.run(context(document), { token: 'brand' }).kind).toBe('refused');
    // with the class gone too, nothing names it: the delete goes through
    const free: DocumentJson = { ...document, classes: [] };
    const done = deleteToken.run(context(free), { token: 'brand' });
    expect(done.kind).toBe('change');
    if (done.kind !== 'change') return;
    expect(applyPatches(free, done.patches ?? []).document.tokens).toBeUndefined();
  });
});

// Family LK1 of the code audit (2026-10-04): no command changes a locked element, or one inside a locked element
// (spec lock-element), whichever node its door names. The audit found writes that asked the lock about another node
// than the one they changed: an image file dropped on a locked image, a label pointed at a locked control, a link
// anchored on a locked section, an instance detached or rebuilt by Update component, a site colour replaced.
import { describe, expect, it } from 'vitest';
import type { DocNode, DocumentJson } from '../document/model.ts';
import { locate } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import type { NodeId } from '../../generated/commands.ts';
import { insertImageFileCommand } from '../files/assets.ts';
import { setLabelTargetCommand } from '../elements/inputs.ts';
import { setLinkCommand } from '../elements/link.ts';
import { detachInstanceCommand, updateFromInstanceCommand } from '../design/components.ts';
import { colourToVariableCommand, replaceColourCommand } from '../design/site-colours.ts';

const page = (children: readonly DocNode[]): DocumentJson['pages'][number] => ({ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children }) });
const at = (document: DocumentJson, id: string): DocNode | undefined => locate(document, id as NodeId)?.node;
const refusedByLock = (outcome: { readonly kind: string; readonly message?: { readonly key: string } }) => outcome.kind === 'refused' && /^status\.locked\./.test(outcome.message?.key ?? '');

describe('a locked element keeps what it holds, whatever door names it (LK1)', () => {
  it('an image file dropped on a locked image does not replace its picture', () => {
    const document = documentOf({ pages: [page([node('Photo', 'image', 'img', { locked: true, attributes: { src: 'img/old.png' } })])] });
    const ran = runHandler(insertImageFileCommand, document, { file: { name: 'new.png', type: 'image/png', bytes: '' }, replace: 'Photo' });
    expect(refusedByLock(ran.outcome as never)).toBe(true);
  });

  it('a label pointed at a locked control does not give the control an id', () => {
    const document = documentOf({ pages: [page([node('Field', 'label', 'label'), node('Email', 'input', 'input', { locked: true })])] });
    const ran = runHandler(setLabelTargetCommand, document, { control: 'Email' }, { selection: ['Field'] });
    expect(refusedByLock(ran.outcome as never)).toBe(true);
  });

  it('a link anchored on a locked section does not give the section an id', () => {
    const document = documentOf({ pages: [page([node('Go', 'link', 'a', { text: 'Go' }), node('Contact', 'section', 'section', { locked: true })])] });
    const ran = runHandler(setLinkCommand, document, { target: 'Go', anchor: 'Contact' });
    expect(refusedByLock(ran.outcome as never)).toBe(true);
  });

  it('a locked instance is neither detached nor rebuilt by Update component', () => {
    const instance = (id: string, locked: boolean) => node(id, 'div', 'div', { component: 'Card', componentPart: [], ...(locked ? { locked: true as const } : {}) });
    const document = documentOf({ pages: [page([instance('A', false), instance('B', true)])], components: [{ name: 'Card', tree: node('Def', 'div', 'div') }] });
    expect(refusedByLock(runHandler(detachInstanceCommand, document, {}, { selection: ['B'] }).outcome as never)).toBe(true);
    const edited = documentOf({ pages: [page([node('A', 'div', 'div', { component: 'Card', componentPart: [], classes: ['x'] }), instance('B', true)])], components: [{ name: 'Card', tree: node('Def', 'div', 'div') }] });
    expect(refusedByLock(runHandler(updateFromInstanceCommand, edited, {}, { selection: ['A'] }).outcome as never)).toBe(true);
  });

  it('a site colour replaced or made a variable leaves a locked element as it is', () => {
    const red = { desktop: { base: { 'background-color': '#ff0000' } } } as unknown as DocNode['styles'];
    const document = documentOf({ pages: [page([node('Free', 'div', 'div', { styles: red }), node('Kept', 'div', 'div', { locked: true, styles: red })])] });
    const replaced = runHandler(replaceColourCommand, document, { colour: '#ff0000', value: '#00ff00' });
    expect(refusedByLock(replaced.outcome as never)).toBe(true);
    const variable = runHandler(colourToVariableCommand, document, { colour: '#ff0000', name: 'brand' });
    expect(refusedByLock(variable.outcome as never)).toBe(true);
    expect(at(document, 'Kept')?.styles).toEqual(red);
  });
});

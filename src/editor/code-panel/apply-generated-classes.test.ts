// @vitest-environment happy-dom
// Family CP2 of the code audit (2026-10-04, second reading): the code pane shows an element's markup as the export
// writes it, the class the export invents for its stylesheet left out of the element's own line only. A styled element
// inside kept its invented class in the pane, and applying the markup unchanged made that class one of the element's
// own; taking every class off the selected element's line kept them all, though the markup said none.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { locate } from '../../core/document/model.ts';
import { documentOf, node, runHandler, RULES } from '../../core/testing/handlers.ts';
import { applyHtmlCommand } from '../../core/import/apply-html.ts';
import { elementLines } from './code-panel.ts';

const styled = { desktop: { base: { color: '#ff0000' } } } as never;
const doc = () =>
  documentOf({
    pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Hero', 'section', 'section', { classes: ['band'], styles: styled, children: [node('Title', 'heading', 'h2', { text: 'Hi', styles: styled })] })] }) }],
  });

describe('the code pane writes back no class the export invented (CP2)', () => {
  it('applying the markup the pane shows changes nothing', () => {
    const document = doc();
    const shown = (elementLines({ document, selection: ['Hero' as NodeId] }, RULES) ?? []).map((line) => line.text).join('\n');
    const ran = runHandler(applyHtmlCommand, document, { html: shown }, { selection: ['Hero'] });
    expect(ran.problems).toEqual([]);
    expect(locate(ran.document, 'Title' as NodeId)?.node.classes).toEqual([]);
    expect(locate(ran.document, 'Hero' as NodeId)?.node.classes).toEqual(['band']);
  });
  it('a class taken off the selected element leaves it', () => {
    const ran = runHandler(applyHtmlCommand, doc(), { html: '<section><h2>Hi</h2></section>' }, { selection: ['Hero'] });
    expect(locate(ran.document, 'Hero' as NodeId)?.node.classes).toEqual([]);
  });
});

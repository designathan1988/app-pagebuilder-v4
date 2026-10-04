// @vitest-environment happy-dom
// Family AH1 of the code audit (2026-10-04): the code pane's markup is what the element holds afterwards. The marks,
// the person's own attributes and the hidden flag the markup no longer had stayed on the element: a <strong> removed
// stayed bold, and with the text changed too the result was refused as an invalid document.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { locate } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import { applyHtmlCommand } from './apply-html.ts';

const marked = () =>
  documentOf({
    pages: [{ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Intro', 'paragraph', 'p', { text: 'Hello world', inline: [{ tag: 'strong', children: ['Hello'] }, ' world'], customAttributes: { 'aria-label': 'Greeting' } })] }) }],
  });

describe('the code pane writes what its markup says (AH1)', () => {
  it('a mark and an attribute taken away go, a changed text is kept', () => {
    const ran = runHandler(applyHtmlCommand, marked(), { html: '<p>Hi world</p>' }, { selection: ['Intro'] });
    expect(ran.problems).toEqual([]);
    const intro = locate(ran.document, 'Intro' as NodeId)?.node;
    expect(intro?.text).toBe('Hi world');
    expect(intro?.inline).toBeUndefined();
    expect(intro?.customAttributes).toBeUndefined();
  });
});

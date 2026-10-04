import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../generated/commands.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { HandlerContext } from '../commands/registry.ts';
import { locate, type DocNode, type DocumentJson } from '../document/model.ts';
import { rulesFromManifest, validateDocument } from '../document/validate.ts';
import { EMPTY_HISTORY } from '../history/history.ts';
import { applyPatches } from '../history/transaction.ts';
import { manualClock } from '../ports/clock.ts';
import { sequentialIds } from '../ports/ids.ts';
import { noLayout } from '../ports/layout.ts';
import { anyCss } from '../ports/css.ts';
import { contentModelFrom } from './content-model.ts';
import { equivalentTags, setTagCommand } from './tag.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const HERO_STYLES = { desktop: { base: { 'padding-top': '56px' } } } as DocNode['styles'];
// Page > Hero (section, styled) > Title (h1), Intro (p), Actions (div); Page > Terms (dl) > Group (div) > Word (dt)
const document = (hero: Partial<DocNode> = {}): DocumentJson => ({
  version: 4,
  pages: [
    {
      id: 'p',
      name: 'Home',
      file: 'index.html',
      tree: node('Page', 'page', 'body', {
        children: [
          node('Hero', 'section', 'section', {
            styles: HERO_STYLES,
            classes: ['hero'],
            children: [node('Title', 'heading', 'h1', { text: 'Welcome' }), node('Intro', 'paragraph', 'p', { text: 'Fresh coffee' }), node('Actions', 'div', 'div')],
            ...hero,
          }),
          node('Terms', 'definitionList', 'dl', { children: [node('Group', 'div', 'div', { children: [node('Word', 'term', 'dt')] })] }),
        ],
      }),
    },
  ],
});
const contextOf = (doc: DocumentJson, selection: readonly string[]): HandlerContext<never> => ({
  state: { document: doc, selection: selection as NodeId[], history: EMPTY_HISTORY, message: null, ui: undefined as never },
  clock: manualClock(),
  ids: sequentialIds('x'),
  rules: RULES,
  words: (key) => key,
  layout: noLayout,
  css: anyCss,
});
// the node after the command, the patches and what the status bar says, or the refusal
function run(doc: DocumentJson, selected: string, tag: string) {
  const outcome = setTagCommand.run(contextOf(doc, [selected]), { tag });
  if (outcome.kind === 'refused') return { refused: outcome.message };
  if (outcome.kind !== 'change') throw new Error(outcome.kind);
  const after = applyPatches(doc, outcome.patches ?? []).document;
  expect(validateDocument(after, [selected as NodeId], RULES)).toEqual([]);
  return { node: locate(after, selected as NodeId)?.node, patches: outcome.patches ?? [], message: outcome.message, selection: outcome.selection };
}
const refusal = (key: string, params: Record<string, string>) => ({ refused: { key, params } });

describe('the equivalent tags of an element (elements.json)', () => {
  it('are its type’s tag and alternative tags, and nothing else', () => {
    const of = (type: string) => equivalentTags(RULES.elements.get(type) ?? { tags: [] } as never);
    expect(of('section')).toEqual(['section', 'div', 'header', 'main', 'footer', 'nav', 'aside', 'article']);
    expect(of('heading')).toEqual(['h2', 'h1', 'h3', 'h4', 'h5', 'h6']);
    expect(of('paragraph')).toEqual(['p', 'span', 'pre']);
    expect(of('list')).toEqual(['ul']);
  });
});

describe('element.setTag', () => {
  it('replaces only the tag: type, name, children, text, classes and styles stay; one patch; the status bar names the element and its tag', () => {
    const before = document();
    const done = run(before, 'Hero', 'article');
    const hero = locate(before, 'Hero' as NodeId)?.node;
    expect(done.node).toEqual({ ...hero, tag: 'article' });
    expect(done.patches).toEqual([{ op: 'replace', path: ['pages', 0, 'tree', 'children', 0, 'tag'], value: 'article' }]);
    expect(done.selection).toBeUndefined();
    expect(done.message).toEqual({ key: 'status.tag.set', params: { name: 'Hero', tag: '<article>' } });
  });

  it('switches a heading between levels and a paragraph to pre or span, keeping the text', () => {
    expect(run(document(), 'Title', 'h4').node).toMatchObject({ type: 'heading', tag: 'h4', text: 'Welcome' });
    expect(run(document(), 'Intro', 'pre').node).toMatchObject({ type: 'paragraph', tag: 'pre', text: 'Fresh coffee' });
    expect(run(document(), 'Intro', 'span').node?.tag).toBe('span');
  });

  it('takes the typed tag without the spaces around it and in lower case', () => {
    expect(run(document(), 'Title', '  H3 ').node?.tag).toBe('h3');
  });

  it('records nothing for an empty text or the tag the element has, and says its tag', () => {
    for (const typed of ['', '   ', 'section', 'SECTION']) {
      const same = run(document(), 'Hero', typed);
      expect(same.patches).toEqual([]);
      expect(same.message).toEqual({ key: 'status.tag.set', params: { name: 'Hero', tag: '<section>' } });
    }
  });

  it('refuses a tag that is not equivalent: a container to p, a heading to p, a paragraph to h2', () => {
    expect(run(document(), 'Hero', 'p')).toEqual(refusal('status.tag.notEquivalent', { tag: '<p>', name: 'Hero' }));
    expect(run(document(), 'Title', 'p')).toEqual(refusal('status.tag.notEquivalent', { tag: '<p>', name: 'Title' }));
    expect(run(document(), 'Intro', 'h2')).toEqual(refusal('status.tag.notEquivalent', { tag: '<h2>', name: 'Intro' }));
    expect(run(document(), 'Hero', 'blink')).toEqual(refusal('status.tag.notEquivalent', { tag: '<blink>', name: 'Hero' }));
  });

  it('refuses a locked element with status.locked.edit and one inside it with status.locked.byAncestor', () => {
    expect(run(document({ locked: true }), 'Hero', 'article')).toEqual(refusal('status.locked.edit', { name: 'Hero' }));
    expect(run(document({ locked: true }), 'Title', 'h4')).toEqual(refusal('status.locked.byAncestor', { name: 'Title', ancestor: 'Hero' }));
  });

  it('refuses a tag the parent’s closed list does not accept', () => {
    expect(run(document(), 'Group', 'section')).toEqual(refusal('status.refused.onlyAccepts', { parent: '<dl>', children: '<dt>, <dd>, <div>' }));
  });

  it('refuses a tag an ancestor excludes, and a tag that excludes a descendant, naming both tags', () => {
    const inHeader = document({ tag: 'header' });
    expect(run(inHeader, 'Actions', 'footer')).toEqual(refusal('status.refused.notInside', { child: '<footer>', ancestor: '<header>' }));
    expect(run(inHeader, 'Actions', 'main')).toEqual(refusal('status.refused.notInside', { child: '<main>', ancestor: '<header>' }));
    expect(run(inHeader, 'Actions', 'article').node?.tag).toBe('article');
    const holdingFooter = applyPatches(document(), [{ op: 'replace', path: ['pages', 0, 'tree', 'children', 0, 'children', 2, 'tag'], value: 'footer' }]).document;
    expect(run(holdingFooter, 'Hero', 'header')).toEqual(refusal('status.refused.notInside', { child: '<footer>', ancestor: '<header>' }));
    expect(run(holdingFooter, 'Hero', 'article').node?.tag).toBe('article');
  });

  it('refuses a tag that makes the element interactive inside an element that excludes interactive content', () => {
    const inLinkBlock: DocumentJson = {
      version: 4,
      pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children: [node('Card', 'linkBlock', 'a', { children: [node('Go', 'link', 'a', { text: 'Go' })] })] }) }],
    };
    expect(run(inLinkBlock, 'Go', 'button')).toEqual(refusal('status.refused.interactiveInside', { parent: 'Card' }));
  });

  // any other selection is refused with words, never thrown (the audit's AUD-09; the random probe reached it)
  it('acts on one selected element only: any other selection is refused', () => {
    for (const selection of [[], ['Hero', 'Title']]) {
      const outcome = setTagCommand.run(contextOf(document(), selection), { tag: 'div' });
      expect(outcome.kind === 'refused' ? outcome.message.key : outcome.kind).toBe('status.needsSingleSelection');
    }
  });
});

describe('the content model’s excluded descendants (src/core/elements/content-model.ts)', () => {
  const model = contentModelFrom(manifest.html);
  it('a header or a footer excludes header, footer and main; article, aside and nav exclude main; interactive content is left to its own rule', () => {
    for (const outer of ['header', 'footer']) for (const inner of ['header', 'footer', 'main']) expect(model.excludes(outer, inner)).toBe(true);
    for (const outer of ['article', 'aside', 'nav']) expect(model.excludes(outer, 'main')).toBe(true);
    // a button's exclusion of interactive content is excludesInteractive and isInteractive (elements-structure), which
    // know when a conditional element is interactive; excludes does not read it a second time
    expect(model.excludes('button', 'button')).toBe(false);
    expect(model.excludesInteractive('button')).toBe(true);
    expect(model.excludes('button', 'span')).toBe(false);
    expect(model.excludes('a', 'a')).toBe(true);
    expect(model.excludes('section', 'header')).toBe(false);
    expect(model.excludes('header', 'section')).toBe(false);
    expect(model.excludes('th', 'h2')).toBe(true);
  });
});

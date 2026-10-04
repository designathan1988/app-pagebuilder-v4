// @vitest-environment happy-dom
// The renderer applies a change's patches to the page it built: for every kind of patch, the page it leaves is the
// page a fresh mount of the resulting document builds, and every element whose node the patches did not replace
// is the same object as before (updated in place, never built again).
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../../generated/commands.ts';
import { manifest } from '../../../manifest/runtime.ts';
import type { DocNode, DocumentJson } from '../../../core/document/model.ts';
import { applyPatches, type Patch } from '../../../core/history/transaction.ts';
import { EMPTY_TEXT_ATTRIBUTE, HIDDEN_ATTRIBUTE, NODE_ATTRIBUTE, NODE_STYLE_ATTRIBUTE, PageRenderer, editorCss, nodeCss, renderModelFromManifest, type RenderModel } from './render.ts';

const model = renderModelFromManifest(manifest.elements, manifest.properties, manifest.interactions);
const node = (id: string, type: string, tag: string | null, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const attributes = (a: Record<string, string | number | boolean>) => a as DocNode['attributes'];
const styles = (s: Record<string, Record<string, Record<string, string>>>) => s as DocNode['styles'];

const doc: DocumentJson = {
  version: 3,
  pages: [
    {
      id: 'p1',
      name: 'Home',
      file: 'index.html',
      tree: node('root', 'page', 'body', {
        styles: styles({ desktop: { base: { 'background-color': '#ffffff' } } }),
        children: [
          node('hero', 'section', 'section', {
            styles: styles({ desktop: { base: { 'padding-top': '56px' } }, phone: { base: { 'padding-top': '16px' }, hover: { color: 'red' } } }),
            children: [node('title', 'heading', 'h1', { text: 'Hello\nworld', classes: ['hero__title'] }), node('intro', 'paragraph', 'p', { text: 'Intro' })],
          }),
          node('art', 'svg', 'svg', { children: [node('box', 'rectangle', 'rect', { attributes: attributes({ title: 'box' }) })] }),
          node('footer', 'footer', 'footer', { classes: ['site-footer'], attributes: attributes({ id: 'end' }) }),
        ],
      }),
    },
    { id: 'p2', name: 'About', file: 'about/index.html', tree: node('root2', 'page', 'body', { children: [node('other', 'paragraph', 'p', { text: 'Other' })] }) },
  ],
};

// a path under the rendered page's tree
const at = (...keys: (string | number)[]): (string | number)[] => ['pages', 0, 'tree', ...keys];

const must = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
};
const heroOf = (d: DocumentJson): DocNode => must(must(d.pages[0]).tree.children[0]);

function mounted(from: DocumentJson = doc, renderModel: RenderModel = model): { target: Document; renderer: PageRenderer } {
  const target = document.implementation.createHTMLDocument('page');
  const renderer = new PageRenderer(target, renderModel);
  renderer.mount(from);
  return { target, renderer };
}

// The page as a comparable value: every element with its namespace, tag, attributes (in name order) and children,
// every text, and each node's style element by node id (the order of per-node style elements does not matter: each
// holds the rules of one node only).
function canonical(target: Document): { readonly body: unknown; readonly styles: readonly (readonly [string, string])[] } {
  const visit = (n: Node): unknown => {
    if (n.nodeType === 3) return n.nodeValue;
    const e = n as Element;
    const attrs = [...e.attributes].map((a) => `${a.name}=${a.value}`).sort();
    return { tag: `${e.namespaceURI ?? ''}:${e.localName}`, attrs, children: [...e.childNodes].map(visit) };
  };
  const sheets = [...target.head.querySelectorAll(`style[${NODE_STYLE_ATTRIBUTE}]`)].map((s) => [s.getAttribute(NODE_STYLE_ATTRIBUTE) ?? '', s.textContent] as const);
  return { body: visit(target.body), styles: sheets.sort(([a], [b]) => a.localeCompare(b)) };
}

// Every element of the page by its node id, and every text node.
function inventory(target: Document): { readonly elements: Map<string, Element>; readonly texts: Map<string, readonly Node[]> } {
  const elements = new Map<string, Element>();
  const texts = new Map<string, readonly Node[]>();
  for (const e of [target.body, ...target.body.querySelectorAll(`[${NODE_ATTRIBUTE}]`)]) {
    const id = must(e.getAttribute(NODE_ATTRIBUTE));
    elements.set(id, e);
    texts.set(id, [...e.childNodes].filter((n) => n.nodeType === 3));
  }
  return { elements, texts };
}

// Applies the patches to a page mounted from `before` and checks the page against a fresh mount of the result;
// every node not listed in `rebuilt` keeps its element object. Returns the pages for further checks.
function check(before: DocumentJson, patches: readonly Patch[], rebuilt: readonly string[] = []) {
  const { target, renderer } = mounted(before);
  const was = inventory(target);
  const after = applyPatches(before, patches).document;
  renderer.apply(before, after, patches);
  const fresh = mounted(after).target;
  expect(canonical(target)).toEqual(canonical(fresh));
  const now = inventory(target);
  for (const [id, element] of now.elements) {
    if (!was.elements.has(id)) continue;
    if (rebuilt.includes(id)) expect(element, `${id} is built anew`).not.toBe(was.elements.get(id));
    else expect(element, `${id} keeps its element`).toBe(was.elements.get(id));
  }
  expect(renderer.element('root' as NodeId)).toBe(target.body);
  return { target, renderer, after, was, now };
}

describe('the renderer (src/editor/canvas/render/render.ts)', () => {
  it('builds the page: the root on body, each node its element, text with line breaks, attributes, classes, SVG in its namespace', () => {
    const { target } = mounted();
    expect(target.body.getAttribute('data-node')).toBe('root');
    expect([...target.body.children].map((e) => `${e.localName}#${e.getAttribute('data-node') ?? ''}`)).toEqual(['section#hero', 'svg#art', 'footer#footer']);
    const title = target.querySelector('[data-node="title"]');
    expect(title?.localName).toBe('h1');
    expect(title?.innerHTML).toBe('Hello<br>world');
    const footer = target.querySelector('[data-node="footer"]');
    expect(footer?.getAttribute('class')).toBe('site-footer');
    expect(footer?.getAttribute('id')).toBe('end');
    expect(target.querySelector('[data-node="box"]')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(target.querySelector('[data-node="art"]')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(target.querySelector('[data-node="other"]')).toBeNull();
  });

  it('writes each node’s rules: the base breakpoint plain, the others as max-width queries, states as pseudo-classes', () => {
    expect(nodeCss(heroOf(doc), '[data-node="hero"]', model)).toBe(
      '[data-node="hero"] { padding-top: 56px; }\n@media (max-width: 390px) {\n[data-node="hero"] { padding-top: 16px; }\n[data-node="hero"]:hover { color: red; }\n}',
    );
    const { target } = mounted();
    expect(target.head.querySelector('style[data-node-style="hero"]')?.textContent).toContain('padding-top: 56px');
    expect(target.head.querySelector('style[data-node-style="intro"]')).toBeNull();
  });

  describe('each kind of patch leaves the page a fresh mount builds, and keeps every element it does not replace', () => {
    it('styles: replace a value, add one at another breakpoint and state, remove one', () => {
      const { target } = check(doc, [
        { op: 'replace', path: at('children', 0, 'styles', 'desktop', 'base', 'padding-top'), value: '80px' },
        { op: 'add', path: at('children', 0, 'children', 1, 'styles'), value: styles({ tablet: { base: { 'margin-top': '8px' } } }) },
        { op: 'add', path: at('children', 0, 'children', 1, 'styles', 'tablet', 'focus'), value: { color: 'blue' } },
        { op: 'remove', path: at('children', 0, 'styles', 'phone', 'hover') },
      ]);
      expect(target.head.querySelector('style[data-node-style="hero"]')?.textContent).toBe(
        '[data-node="hero"] { padding-top: 80px; }\n@media (max-width: 390px) {\n[data-node="hero"] { padding-top: 16px; }\n}',
      );
      expect(target.head.querySelector('style[data-node-style="intro"]')?.textContent).toBe(
        '@media (max-width: 834px) {\n[data-node="intro"] { margin-top: 8px; }\n[data-node="intro"]:focus { color: blue; }\n}',
      );
    });

    it('styles: removing a node’s last rule removes its style element, and the other style elements stay the same objects', () => {
      const { target, renderer } = mounted();
      const rootSheet = target.head.querySelector('style[data-node-style="root"]');
      const patches: Patch[] = [{ op: 'replace', path: at('children', 0, 'styles'), value: {} }];
      const after = applyPatches(doc, patches).document;
      renderer.apply(doc, after, patches);
      expect(target.head.querySelector('style[data-node-style="hero"]')).toBeNull();
      expect(rootSheet).not.toBeNull();
      expect(target.head.querySelector('style[data-node-style="root"]')).toBe(rootSheet);
      expect(canonical(target)).toEqual(canonical(mounted(after).target));
    });

    it('text: a new text with a line break, in the same element', () => {
      const { target } = check(doc, [{ op: 'replace', path: at('children', 0, 'children', 0, 'text'), value: 'Good\nmorning' }]);
      expect(target.querySelector('[data-node="title"]')?.innerHTML).toBe('Good<br>morning');
    });

    it('text: a patch that leaves the text as it is keeps its text nodes', () => {
      const { was, now } = check(doc, [{ op: 'replace', path: at('children', 0, 'children', 1, 'name'), value: 'Intro paragraph' }]);
      expect(now.texts.get('intro')).toEqual(was.texts.get('intro'));
      expect(must(now.texts.get('intro'))[0]).toBe(must(was.texts.get('intro'))[0]);
    });

    it('attributes: add, replace and remove, a true boolean as an empty attribute and a false one as none', () => {
      const { target } = check(doc, [
        { op: 'replace', path: at('children', 2, 'attributes', 'id'), value: 'bottom' },
        { op: 'add', path: at('children', 2, 'attributes', 'title'), value: 'Footer' },
        { op: 'add', path: at('children', 0, 'attributes'), value: attributes({ title: 'Hero', id: 'top' }) },
        { op: 'remove', path: at('children', 0, 'attributes', 'id') },
        { op: 'add', path: at('children', 1, 'children', 0, 'attributes', 'open'), value: true },
      ]);
      const footer = must(target.querySelector('[data-node="footer"]'));
      expect([footer.getAttribute('id'), footer.getAttribute('title')]).toEqual(['bottom', 'Footer']);
      const hero = must(target.querySelector('[data-node="hero"]'));
      expect([hero.getAttribute('title'), hero.hasAttribute('id')]).toEqual(['Hero', false]);
      expect(target.querySelector('[data-node="box"]')?.getAttribute('open')).toBe('');
      const { target: off } = check(applyPatches(doc, [{ op: 'add', path: at('children', 1, 'children', 0, 'attributes', 'open'), value: true }]).document, [
        { op: 'replace', path: at('children', 1, 'children', 0, 'attributes', 'open'), value: false },
      ]);
      expect(off.querySelector('[data-node="box"]')?.hasAttribute('open')).toBe(false);
    });

    it('classes: add one, replace the list, remove the last one', () => {
      const { target } = check(doc, [
        { op: 'add', path: at('children', 0, 'children', 0, 'classes', 1), value: 'is-big' },
        { op: 'replace', path: at('children', 2, 'classes'), value: ['site-footer', 'site-footer--dark'] },
      ]);
      expect(target.querySelector('[data-node="title"]')?.getAttribute('class')).toBe('hero__title is-big');
      expect(target.querySelector('[data-node="footer"]')?.getAttribute('class')).toBe('site-footer site-footer--dark');
      const { target: none } = check(doc, [{ op: 'remove', path: at('children', 2, 'classes', 0) }]);
      expect(none.querySelector('[data-node="footer"]')?.hasAttribute('class')).toBe(false);
    });

    it('tag: a new element for that node only, around the same children elements', () => {
      const { target } = check(doc, [{ op: 'replace', path: at('children', 0, 'children', 0, 'tag'), value: 'h2' }], ['title']);
      expect(target.querySelector('[data-node="title"]')?.localName).toBe('h2');
      const { target: page, now, was } = check(doc, [{ op: 'replace', path: at('children', 0, 'tag'), value: 'article' }], ['hero']);
      expect(page.querySelector('[data-node="hero"]')?.localName).toBe('article');
      expect(now.elements.get('title')?.parentElement).toBe(now.elements.get('hero'));
      expect(now.elements.get('title')).toBe(was.elements.get('title'));
    });

    it('children order: a node moved (removed and added as it is) keeps its element', () => {
      const intro = must(heroOf(doc).children[1]);
      const { target } = check(doc, [
        { op: 'remove', path: at('children', 0, 'children', 1) },
        { op: 'add', path: at('children', 0, 'children', 0), value: intro },
      ]);
      expect([...must(target.querySelector('[data-node="hero"]')).children].map((e) => e.getAttribute('data-node'))).toEqual(['intro', 'title']);
      // to another parent
      const { target: page } = check(doc, [
        { op: 'remove', path: at('children', 0, 'children', 1) },
        { op: 'add', path: at('children', 2), value: intro },
      ]);
      expect([...page.body.children].map((e) => e.getAttribute('data-node'))).toEqual(['hero', 'art', 'intro', 'footer']);
      // the whole list replaced by the same nodes in another order
      check(doc, [{ op: 'replace', path: at('children'), value: [...must(doc.pages[0]).tree.children].reverse() }]);
    });

    it('a whole subtree: added, removed, and replaced by one with other content', () => {
      const card = node('card', 'article', 'article', {
        styles: styles({ desktop: { base: { width: '300px' } } }),
        children: [node('cardTitle', 'heading', 'h3', { text: 'Card' }), node('cardBody', 'div', 'div', { children: [node('cardText', 'paragraph', 'p', { text: 'Body' })] })],
      });
      const { target } = check(doc, [{ op: 'add', path: at('children', 1), value: card }]);
      expect(target.querySelector('[data-node="cardText"]')?.textContent).toBe('Body');
      expect(target.head.querySelector('style[data-node-style="card"]')?.textContent).toBe('[data-node="card"] { width: 300px; }');

      const { target: removed } = check(doc, [{ op: 'remove', path: at('children', 0) }]);
      for (const id of ['hero', 'title', 'intro']) expect(removed.querySelector(`[data-node="${id}"]`)).toBeNull();
      expect(removed.head.querySelector('style[data-node-style="hero"]')).toBeNull();

      const hero = heroOf(doc);
      const changed = { ...hero, children: [{ ...must(hero.children[0]), text: 'Changed' }, must(hero.children[1])] };
      const { target: replaced } = check(doc, [{ op: 'replace', path: at('children', 0), value: changed }], ['hero', 'title', 'intro']);
      expect(replaced.querySelector('[data-node="title"]')?.textContent).toBe('Changed');

      // a node wrapped: removed from its parent and added inside a new one
      const wrapper = node('wrap', 'div', 'div', { children: [must(hero.children[1])] });
      check(doc, [
        { op: 'remove', path: at('children', 0, 'children', 1) },
        { op: 'add', path: at('children', 0, 'children', 1), value: wrapper },
      ], ['intro']);
    });

    it('undo: the inverses of a change bring back the page the document had', () => {
      const card = node('card', 'div', 'div', { text: null, children: [node('cardText', 'paragraph', 'p', { text: 'Body' })] });
      const patches: Patch[] = [
        { op: 'add', path: at('children', 0), value: card },
        { op: 'replace', path: at('children', 1, 'children', 0, 'text'), value: 'Bye' },
        { op: 'remove', path: at('children', 3, 'classes', 0) },
        { op: 'replace', path: at('children', 1, 'styles', 'desktop', 'base', 'padding-top'), value: '0px' },
      ];
      const { target, renderer } = mounted();
      const was = inventory(target);
      const applied = applyPatches(doc, patches);
      renderer.apply(doc, applied.document, patches);
      renderer.apply(applied.document, doc, applied.inverses);
      expect(canonical(target)).toEqual(canonical(mounted().target));
      for (const [id, element] of inventory(target).elements) expect(element, id).toBe(was.elements.get(id));
    });

    it('the page’s own fields and other pages change nothing; a page added before it or the tree replaced builds it again', () => {
      check(doc, [
        { op: 'replace', path: ['pages', 0, 'name'], value: 'Start' },
        { op: 'replace', path: ['pages', 1, 'tree', 'children', 0, 'text'], value: 'Changed' },
        { op: 'add', path: ['pages', 2], value: { id: 'p3', name: 'New', file: 'new.html', tree: node('root3', 'page', 'body') } },
      ]);
      const other = { id: 'p0', name: 'First', file: 'first.html', tree: node('root0', 'page', 'body', { children: [node('first', 'paragraph', 'p', { text: 'First' })] }) };
      const { target: page, renderer } = mounted();
      const hero = page.querySelector('[data-node="hero"]');
      const after = applyPatches(doc, [{ op: 'add', path: ['pages', 0], value: other }]).document;
      renderer.apply(doc, after, [{ op: 'add', path: ['pages', 0], value: other }]);
      expect(canonical(page)).toEqual(canonical(mounted(after).target));
      expect(page.body.getAttribute('data-node')).toBe('root0');
      expect(page.querySelector('[data-node="hero"]')).toBeNull();
      expect(hero).not.toBeNull();
    });
  });

  it('marks a hidden node’s element for the editor’s style, which draws it with display none, and unmarks it when shown', () => {
    const hide: Patch[] = [{ op: 'add', path: at('children', 0, 'children', 1, 'hidden'), value: true }];
    const { target, after } = check(doc, hide);
    expect(target.querySelector('[data-node="intro"]')?.getAttribute(HIDDEN_ATTRIBUTE)).toBe('');
    expect(target.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`).length).toBe(1);
    expect(editorCss(model)).toContain(`[${HIDDEN_ATTRIBUTE}] { display: none !important; }`);
    expect(target.head.querySelector('style[data-editor-style]')?.textContent).toBe(editorCss(model));
    const { target: shown } = check(after, [{ op: 'remove', path: at('children', 0, 'children', 1, 'hidden') }]);
    expect(shown.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`).length).toBe(0);
    // a hidden container carries the mark alone: its subtree goes with it
    const { target: section } = check(doc, [{ op: 'add', path: at('children', 0, 'hidden'), value: true }]);
    expect([...section.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)].map((e) => e.getAttribute('data-node'))).toEqual(['hero']);
  });

  // spec text-edit-inline, Problems in Pager 4 (the audit's A3.38): an empty text is marked for the editor's style, and
  // unmarked once it holds text again; the incremental render stays the same as a fresh one (check)
  it('marks a text element whose text is emptied, and unmarks it when it holds text again', () => {
    const { target, after } = check(doc, [{ op: 'replace', path: at('children', 0, 'children', 1, 'text'), value: '' }]);
    expect(target.querySelector('[data-node="intro"]')?.getAttribute(EMPTY_TEXT_ATTRIBUTE)).toBe('');
    expect(target.querySelectorAll(`[${EMPTY_TEXT_ATTRIBUTE}]`).length).toBe(1);
    expect(editorCss(model)).toContain(`:where([${EMPTY_TEXT_ATTRIBUTE}]) { min-height: ${model.emptyTextMinHeight}px;`);
    const { target: filled } = check(after, [{ op: 'replace', path: at('children', 0, 'children', 1, 'text'), value: 'Back' }]);
    expect(filled.querySelectorAll(`[${EMPTY_TEXT_ATTRIBUTE}]`).length).toBe(0);
  });

  it('writes the settings of the page on its <html>, never on <body>, as patches set, change and remove them', () => {
    const set: Patch[] = [
      { op: 'add', path: at('attributes', 'pageLanguage'), value: 'pt-BR' },
      { op: 'add', path: at('attributes', 'pageDirection'), value: 'rtl' },
      { op: 'add', path: at('attributes', 'pageTitle'), value: 'Landing' },
    ];
    const { target, after } = check(doc, set);
    // the title is no HTML attribute: the export writes it (export-zip)
    expect([...target.documentElement.attributes].map((a) => `${a.name}=${a.value}`).sort()).toEqual(['dir=rtl', 'lang=pt-BR']);
    expect(target.body.hasAttribute('lang') || target.body.hasAttribute('dir')).toBe(false);
    expect(mounted(after).target.documentElement.getAttribute('dir')).toBe('rtl');
    const changed = check(after, [{ op: 'replace', path: at('attributes', 'pageDirection'), value: 'ltr' }]);
    expect(changed.target.documentElement.getAttribute('dir')).toBe('ltr');
    const removed = check(after, [{ op: 'remove', path: at('attributes', 'pageDirection') }]);
    expect(removed.target.documentElement.hasAttribute('dir')).toBe(false);
    expect(removed.target.documentElement.getAttribute('lang')).toBe('pt-BR');
  });

  it('a mount removes the style elements an earlier renderer of the same document left', () => {
    const { target } = mounted();
    new PageRenderer(target, model).mount(applyPatches(doc, [{ op: 'remove', path: at('children', 0) }]).document);
    expect(target.head.querySelectorAll('style[data-node-style="hero"]').length).toBe(0);
    expect(target.head.querySelectorAll('style[data-node-style="root"]').length).toBe(1);
  });

  it('draws a text’s marks (spec text-inline-formatting): <strong>, <em> and <a href> around its runs, patched in the same element', () => {
    const marked = ['In', { tag: 'strong', children: ['t', { tag: 'em', children: ['r'] }] }, { tag: 'a', href: 'https://example.com', children: ['o'] }];
    const { target, after } = check(doc, [{ op: 'add', path: at('children', 0, 'children', 1, 'inline'), value: marked }]);
    expect(target.querySelector('[data-node="intro"]')?.innerHTML).toBe('In<strong>t<em>r</em></strong><a href="https://example.com">o</a>');
    const plain = check(after, [{ op: 'remove', path: at('children', 0, 'children', 1, 'inline') }]);
    expect(plain.target.querySelector('[data-node="intro"]')?.innerHTML).toBe('Intro');
  });

  it('reads the edited text back as runs with its selection, and draws a change of its marks with the range selected', () => {
    const { target, renderer } = mounted();
    renderer.editText(doc, 'intro' as NodeId, 'text-editing');
    // the caret at the end of the text
    expect(renderer.editedContent()).toEqual({ runs: ['Intro'], range: { start: 5, end: 5 } });
    renderer.showEdited([{ tag: 'strong', children: ['Int'] }, 'ro'], { start: 0, end: 3 });
    const intro = must(target.querySelector('[data-node="intro"]'));
    expect(intro.innerHTML).toBe('<strong>Int</strong>ro');
    expect(renderer.editedContent()).toEqual({ runs: [{ tag: 'strong', children: ['Int'] }, 'ro'], range: { start: 0, end: 3 } });
    expect(target.getSelection()?.toString()).toBe('Int');
    // a line break at the very end gets the <br> a browser needs after it, which the text read back leaves out
    renderer.showEdited(['Intro\n'], { start: 6, end: 6 });
    expect(intro.innerHTML).toBe('Intro<br><br>');
    expect(renderer.editedContent()?.runs).toEqual(['Intro\n']);
    // the edit ends: the page shows the text the document holds
    renderer.editText(doc, null, 'text-editing');
    expect(intro.innerHTML).toBe('Intro');
    expect(renderer.editedContent()).toBeNull();
  });

  it('never writes an event attribute, even one a model would name', () => {
    const withEvent: RenderModel = { ...model, attributes: new Map([...model.attributes, ['clickHandler', 'onclick']]) };
    const d = applyPatches(doc, [{ op: 'add', path: at('children', 2, 'attributes', 'clickHandler'), value: 'alert(1)' }]).document;
    const { target } = mounted(d, withEvent);
    expect(target.querySelector('[data-node="footer"]')?.hasAttribute('onclick')).toBe(false);
  });

  // The dogfood finding of 2026-09-29: a hero with an uploaded background image drew white on the canvas while the
  // export carried the picture — the stylesheet kept the path the canvas cannot fetch (a source ATTRIBUTE was already
  // written as the file's object URL). A stylesheet's url(…) goes through the same resolver; the export never does.
  it("writes a background image that names a project file as the file's object URL", () => {
    const onePixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const mountedWith = applyPatches(doc, [
      { op: 'add', path: ['files'], value: [{ path: 'img/hero.png', type: 'image/png', bytes: onePixel }] },
      { op: 'add', path: at('children', 0, 'styles'), value: styles({ desktop: { base: { 'background-image': 'url("img/hero.png")' } } }) },
    ]).document;
    const created = URL.createObjectURL;
    const urls: string[] = [];
    URL.createObjectURL = () => {
      const url = `blob:test/${urls.length}`;
      urls.push(url);
      return url;
    };
    try {
      const { target } = mounted(mountedWith);
      const sheet = target.querySelector('style[data-node-style="hero"]')?.textContent ?? '';
      expect(sheet).toContain('background-image: url("blob:test/0")');
      expect(sheet).not.toContain('img/hero.png');
    } finally {
      URL.createObjectURL = created;
    }
  });
});

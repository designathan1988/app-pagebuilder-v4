// The renderer (src/editor/canvas/render/render.ts) in the installed Chrome: the app's own modules, loaded from the served
// build (/proofs.js, tests/support/proofs.ts), build a small document into a fresh same-origin iframe and then apply
// a change's patches to it. The end artifacts are what Chrome lays out in the frame: the computed style of the
// changed nodes (also at a breakpoint other than the base, with the frame at that width), their geometry and their
// text, and the elements of the nodes the change did not replace are the same objects as before (each is marked with
// a property before the change). The first test proves the renderer on its own, on every kind of patch; the second
// proves the editor's canvas uses it that way: a command run through its door changes the page in place.
import fs from 'node:fs';
import { expect, test, type Page } from '../support/test.ts';
import { openEditor } from '../support/editor.ts';
import { openMenu, runs } from './door.ts';

// the manifest files the renderer is built from, as the runner reads them (manifest/runtime.ts loads the same JSON)
const MANIFEST = {
  elements: JSON.parse(fs.readFileSync('manifest/elements.json', 'utf8')),
  properties: JSON.parse(fs.readFileSync('manifest/properties.json', 'utf8')),
  interactions: JSON.parse(fs.readFileSync('manifest/interactions.json', 'utf8')),
};

// what the test reads of the modules it loads in the page (typed here: the tests project does not compile src)
interface Proof {
  readonly apply: () => void;
  readonly frame: HTMLIFrameElement;
}
type ProofWindow = Window & { renderProof?: Proof };

interface Node {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly tag: string;
  readonly attributes: Record<string, string>;
  readonly classes: readonly string[];
  readonly styles: Record<string, Record<string, Record<string, string>>>;
  readonly text: string | null;
  readonly children: readonly Node[];
}
const node = (id: string, type: string, tag: string, fields: Partial<Node> = {}): Node => ({ id, type, name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });

const DOC = {
  version: 1,
  pages: [
    {
      id: 'p1',
      name: 'Home',
      file: 'index.html',
      tree: node('root', 'page', 'body', {
        styles: { desktop: { base: { 'margin-top': '0px', 'margin-left': '0px' } } },
        children: [
          node('hero', 'section', 'section', {
            styles: { desktop: { base: { 'padding-top': '40px' } }, tablet: { base: { 'padding-top': '12px' } } },
            children: [node('box', 'div', 'div', { styles: { desktop: { base: { width: '100px', height: '50px' } } } }), node('title', 'heading', 'h1', { text: 'Hello' })],
          }),
          node('footer', 'footer', 'footer', { children: [node('note', 'paragraph', 'p', { text: 'Footer' })] }),
        ],
      }),
    },
  ],
};
const tree = (...keys: (string | number)[]) => ['pages', 0, 'tree', ...keys];
const PATCHES = [
  { op: 'replace', path: tree('children', 0, 'styles', 'desktop', 'base', 'padding-top'), value: '64px' },
  { op: 'add', path: tree('children', 0, 'children', 0, 'styles', 'tablet'), value: { base: { width: '200px' } } },
  { op: 'replace', path: tree('children', 0, 'children', 1, 'text'), value: 'Good\nmorning' },
  { op: 'add', path: tree('children', 1), value: node('added', 'paragraph', 'p', { text: 'Added' }) },
  { op: 'add', path: tree('children', 2, 'classes', 0), value: 'site-footer' },
];
const IDS = ['root', 'hero', 'box', 'title', 'footer', 'note'];

// Loads the renderer and the manifest from the served build (/proofs.js, tests/support/proofs.ts), mounts DOC into a
// new same-origin iframe (sandboxed without scripts, as the canvas frame is) and keeps a function that applies PATCHES.
async function mount(page: Page): Promise<void> {
  await page.evaluate(
    async ({ doc, patches, manifest }) => {
      const render = (await import(/* @vite-ignore */ '/proofs.js' as string)) as {
        PageRenderer: new (target: Document, model: unknown) => { mount(d: unknown): void; apply(b: unknown, a: unknown, p: unknown): void };
        renderModelFromManifest(elements: unknown, properties: unknown, interactions: unknown): unknown;
        applyPatches(d: unknown, p: unknown): { document: unknown };
      };
      const frame = document.createElement('iframe');
      frame.id = 'render-proof';
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.style.cssText = 'position: fixed; left: 0; top: 0; width: 1440px; height: 900px; border: 0; z-index: 2147483647';
      const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
      frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
      document.body.append(frame);
      await loaded;
      const target = frame.contentDocument;
      if (!target) throw new Error('the frame has no document');
      const renderer = new render.PageRenderer(target, render.renderModelFromManifest(manifest.elements, manifest.properties, manifest.interactions));
      renderer.mount(doc);
      const after = render.applyPatches(doc, patches).document;
      (window as ProofWindow).renderProof = { frame, apply: () => renderer.apply(doc, after, patches) };
    },
    { doc: DOC, patches: PATCHES, manifest: MANIFEST },
  );
}

test('the renderer applies a change to the iframe’s page in place: styles at each breakpoint, geometry, text, same elements', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await mount(page);
  const frame = page.frameLocator('#render-proof');
  const at = (id: string) => frame.locator(`[data-node="${id}"]`);
  const rect = async (id: string) => {
    const box = await at(id).boundingBox();
    if (!box) throw new Error(`${id} is not laid out`);
    return box;
  };

  // the page as mounted
  await expect(at('hero')).toHaveCSS('padding-top', '40px');
  expect(await rect('box')).toEqual({ x: 0, y: 40, width: 100, height: 50 });
  await expect(at('title')).toHaveText('Hello');

  // mark every element, then apply the change
  // (each function below runs in the page, so it reads the proof from the page's window itself)
  await page.evaluate((ids) => {
    const proof = (window as ProofWindow).renderProof;
    if (!proof) throw new Error('the renderer is not mounted');
    for (const id of ids) {
      const element = proof.frame.contentDocument?.querySelector(`[data-node="${id}"]`);
      if (!element) throw new Error(`no element for ${id}`);
      (element as Element & { renderMark?: string }).renderMark = id;
    }
    proof.apply();
  }, IDS);

  // at the base breakpoint (the frame 1440 px wide)
  await expect(at('hero')).toHaveCSS('padding-top', '64px');
  expect(await rect('box')).toEqual({ x: 0, y: 64, width: 100, height: 50 });
  expect(await at('title').evaluate((e) => [(e as HTMLElement).innerText, e.innerHTML])).toEqual(['Good\nmorning', 'Good<br>morning']);
  await expect(at('added')).toHaveText('Added');
  await expect(at('footer')).toHaveClass('site-footer');
  expect(await frame.locator('body > [data-node]').evaluateAll((es) => es.map((e) => e.getAttribute('data-node')))).toEqual(['hero', 'added', 'footer']);

  // the same element objects: none of these nodes was replaced
  const marks = await page.evaluate((ids) => {
    const target = (window as ProofWindow).renderProof?.frame.contentDocument;
    return ids.map((id) => (target?.querySelector(`[data-node="${id}"]`) as (Element & { renderMark?: string }) | null)?.renderMark ?? null);
  }, IDS);
  expect(marks).toEqual(IDS);

  // at the tablet breakpoint (the frame 834 px wide): its padding and the width the change added there
  await page.evaluate(() => {
    const proof = (window as ProofWindow).renderProof;
    if (!proof) throw new Error('the renderer is not mounted');
    proof.frame.style.width = '834px';
  });
  await expect(at('hero')).toHaveCSS('padding-top', '12px');
  await expect(at('box')).toHaveCSS('width', '200px');
  expect(await rect('box')).toEqual({ x: 0, y: 12, width: 200, height: 50 });
});

// The editor's own canvas, through doors: a command that changes the document is applied to the page in place. Every
// element of the page is marked before the command; after it, the page shows the new order and every element, the
// moved one included, is the same object (a canvas that built the page again on every change would lose the marks).
test(
  'the canvas applies a command to its page in place: the elements keep their objects, the moved one included',
  runs('project.open#menu-file', 'selection.select#canvas-click-element-or-page', 'element.moveUp#key-alt-arrow-up-in-canvas'),
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    await openMenu(page, 'file');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-door="project.open#menu-file"]').click();
    await (await chooser).setFiles({ name: 'aurora.json', mimeType: 'application/json', buffer: fs.readFileSync('manifest/features/fixtures/aurora.json') });
    const canvas = page.frameLocator('.frame__page');
    await expect(canvas.locator('[data-node="n-actions"]')).toHaveCount(1);
    const heroOrder = () => canvas.locator('[data-node="n-hero"] > [data-node]').evaluateAll((els) => els.map((el) => el.getAttribute('data-node')));
    expect(await heroOrder()).toEqual(['n-title', 'n-intro', 'n-actions']);

    // every element of the page marked with its node id
    const marked = await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('.frame__page')?.contentDocument;
      if (!doc) throw new Error('the canvas has no page');
      return [...doc.querySelectorAll('[data-node]')].map((el) => {
        const id = el.getAttribute('data-node') ?? '';
        (el as Element & { canvasMark?: string }).canvasMark = id;
        return id;
      });
    });
    expect(marked.length).toBeGreaterThan(10);

    // Actions selected on the canvas, then Alt+ArrowUp: it moves before Intro
    const at = await page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('.frame__page');
      const el = iframe?.contentDocument?.querySelector('[data-node="n-actions"]');
      if (!iframe || !el) throw new Error('the canvas does not draw n-actions');
      const zoom = iframe.currentCSSZoom;
      const frame = iframe.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: frame.left + (r.left + r.width / 2) * zoom, y: frame.top + (r.top + r.height / 2) * zoom };
    });
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(heroOrder, { message: 'the page shows the move' }).toEqual(['n-title', 'n-actions', 'n-intro']);

    // the same element objects: each still carries its mark
    const marks = await page.evaluate((ids) => {
      const doc = document.querySelector<HTMLIFrameElement>('.frame__page')?.contentDocument;
      return ids.map((id) => (doc?.querySelector(`[data-node="${id}"]`) as (Element & { canvasMark?: string }) | null)?.canvasMark ?? null);
    }, marked);
    expect(marks, 'every element is the object it was before the command').toEqual(marked);
  },
);

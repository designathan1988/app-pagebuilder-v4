// @vitest-environment happy-dom
// The capture's reading of a page (tools/companion/serialize.ts): a tree of nodes, never HTML text parsed again.
import { beforeEach, expect, it } from 'vitest';
import { serializePage, type ObservedElement, type ObservedNode } from './serialize.ts';

const find = (node: ObservedNode, test: (element: ObservedElement) => boolean): ObservedElement | null => {
  if (node.kind !== 'element') return null;
  if (test(node)) return node;
  for (const child of [...(node.shadow?.children ?? []), ...node.children]) {
    const found = find(child, test);
    if (found !== null) return found;
  }
  return null;
};
const byId = (root: ObservedElement, id: string) => find(root, (one) => one.attributes.some((attribute) => attribute.name === 'id' && attribute.value === id));
const head = (root: ObservedElement) => root.children.find((one): one is ObservedElement => one.kind === 'element' && one.tag === 'head');

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

it('keeps the root element\'s runtime custom property as a stylesheet rule', () => {
  document.documentElement.setAttribute('style', '--vp-layout-top-height: 72px;');
  document.body.innerHTML = '<header style="top:var(--vp-layout-top-height)">Navigation</header>';
  const read = serializePage('https://site.test');
  expect(read.sheets.at(-1)?.text ?? '').toContain('html:root{--vp-layout-top-height: 72px;}');
});

it('keeps capturing when a site has a malformed srcset candidate', () => {
  document.body.innerHTML = '<img id="art" src="https://site.test/good.svg" srcset="http://[::1 1x, https://site.test/good.svg 2x">';
  const read = serializePage('https://site.test');
  expect(byId(read.root, 'art')?.attributes.some((one) => one.name === 'srcset')).toBe(true);
  expect(read.images.some((image) => image.src === 'https://site.test/good.svg')).toBe(true);
});

// allbirds: a script put a <div> in <head>. As HTML text parsed again, it sent the 587 links after it into the body.
it('keeps a node where the page holds it, even where the HTML parser would not put it', () => {
  const portal = document.createElement('div');
  portal.id = 'portal';
  document.head.append(portal, document.createElement('meta'));
  document.body.innerHTML = '<main>Wallets</main>';
  const read = serializePage('https://site.test');
  expect(head(read.root)?.children.map((one) => (one.kind === 'element' ? one.tag : one.kind))).toEqual(['div', 'meta']);
});

it('reads a style element from its rules when a script inserted them and left its text empty', () => {
  const style = document.createElement('style');
  document.head.append(style);
  style.sheet?.insertRule('.card { color: rgb(1, 2, 3); }');
  const read = serializePage('https://site.test');
  expect(style.textContent).toBe('');
  expect(read.sheets.some((sheet) => (sheet.text ?? '').includes('rgb(1, 2, 3)'))).toBe(true);
  // the element stays at its place as the sheet's placeholder
  expect(head(read.root)?.children.some((one) => one.kind === 'comment' && /^__capture_sheet_\d+__$/.test(one.value))).toBe(true);
});

it('keeps an open shadow root as the host\'s own, its slot and styles included', () => {
  const host = document.createElement('product-card');
  host.id = 'card';
  host.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block}</style><slot></slot>';
  host.textContent = 'Wallet';
  document.body.append(host);
  const card = byId(serializePage('https://site.test').root, 'card');
  expect(card?.shadow?.mode).toBe('open');
  expect(card?.shadow?.children.map((one) => (one.kind === 'element' ? one.tag : one.kind))).toEqual(['comment', 'slot']);
  expect(card?.children).toEqual([expect.objectContaining({ kind: 'text', value: 'Wallet' })]);
});

it('keeps what a person typed and checked, which the markup does not hold', () => {
  document.body.innerHTML = '<input id="name" value="default"><input id="agree" type="checkbox">';
  (document.getElementById('name') as HTMLInputElement).value = 'Typed';
  (document.getElementById('agree') as HTMLInputElement).checked = true;
  const read = serializePage('https://site.test');
  expect(byId(read.root, 'name')?.state).toEqual({ value: 'Typed' });
  expect(byId(read.root, 'agree')?.state).toEqual({ checked: true });
});

// vuejs.org (VitePress): its whole stylesheet is a link that is a hint and a sheet at once; dropped as a hint, the page
// lost every rule (5 % of its pixels alike).
it('keeps a stylesheet linked as rel="preload stylesheet"', () => {
  document.head.innerHTML = '<link rel="preload stylesheet" href="https://site.test/assets/style.css" as="style">';
  const read = serializePage('https://site.test');
  expect(read.sheets).toEqual([expect.objectContaining({ href: 'https://site.test/assets/style.css' })]);
  expect(head(read.root)?.children).toEqual([expect.objectContaining({ kind: 'comment', value: '__capture_sheet_0__' })]);
});

it('leaves out scripts, noscript and resource hints', () => {
  document.head.innerHTML = '<link rel="preload" href="/a.js"><link rel="preconnect" href="https://cdn.test"><script>1</script>';
  document.body.innerHTML = '<noscript><p>No script</p></noscript><p id="kept">Kept</p>';
  const read = serializePage('https://site.test');
  expect(head(read.root)?.children).toEqual([]);
  expect(byId(read.root, 'kept')).not.toBeNull();
  expect(JSON.stringify(read.root)).not.toContain('No script');
});

// every-layout.dev: the testimonials' avatars outside the carousel's view are loading="lazy" and the page never loads
// them; dropped, the export loaded every one, and each testimonial's text went below its avatar.
it('keeps an image\'s loading attribute as the page wrote it', () => {
  document.body.innerHTML = '<img id="lazy" src="https://site.test/a.png" loading="lazy" alt="A">';
  const read = serializePage('https://site.test');
  expect(byId(read.root, 'lazy')?.attributes).toContainEqual({ name: 'loading', namespace: null, value: 'lazy' });
});

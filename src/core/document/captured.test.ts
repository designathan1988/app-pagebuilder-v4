// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { sequentialIds } from '../ports/ids.ts';
import { capturedFromPackage, captureTree, capturedProblems, type CapturedNode } from './captured.ts';
import { manifest } from '../../manifest/runtime.ts';
import { rulesFromManifest, validateDocument } from './validate.ts';
import { createEmptyDocument, type DocumentJson } from './model.ts';
import { migrateDocument } from './migrations.ts';

const descendants = (node: CapturedNode): CapturedNode[] => node.kind === 'element'
  ? [node, ...node.children.flatMap(descendants)]
  : [node];

it('retains ordered mixed DOM content, unknown tags and SVG namespace without executable attributes', () => {
  const html = '<!doctype html><html class="brand"><head><title>Mixed</title><script>alert(1)</script></head>'
    + '<body><p id="lead">Before <a href="/about"><img src="/art.svg" alt="Art"></a> after</p>'
    + '<brand-card data-tone="warm"><svg viewBox="0 0 20 20"><circle fill="red"/></svg></brand-card>'
    + '<img src="/safe.svg" onerror="alert(2)"><a href="javascript:alert(3)">Unsafe</a></body></html>';
  const root = captureTree(html, sequentialIds('captured'));
  expect(root.tag).toBe('html');
  expect(root.attributes).toContainEqual({ name: 'class', namespace: null, value: 'brand' });
  const nodes = descendants(root);
  const lead = nodes.find((node) => node.kind === 'element' && node.attributes.some((attribute) => attribute.name === 'id' && attribute.value === 'lead'));
  if (lead?.kind !== 'element') throw new Error('paragraph missing');
  expect(lead.children.map((node) => node.kind)).toEqual(['text', 'element', 'text']);
  expect(lead.children[0]).toMatchObject({ kind: 'text', value: 'Before ' });
  expect(lead.children[1]).toMatchObject({ kind: 'element', tag: 'a', children: [{ kind: 'element', tag: 'img' }] });
  expect(lead.children[2]).toMatchObject({ kind: 'text', value: ' after' });
  expect(nodes.some((node) => node.kind === 'element' && node.tag === 'brand-card')).toBe(true);
  const svg = nodes.find((node) => node.kind === 'element' && node.tag === 'svg');
  expect(svg).toMatchObject({ kind: 'element', namespace: 'http://www.w3.org/2000/svg' });
  if (svg?.kind !== 'element') throw new Error('SVG missing');
  expect(svg.attributes).toContainEqual({ name: 'viewBox', namespace: null, value: '0 0 20 20' });
  expect(nodes.some((node) => node.kind === 'element' && node.tag === 'script')).toBe(false);
  expect(nodes.flatMap((node) => node.kind === 'element' ? node.attributes : []).some((attribute) => attribute.name.startsWith('on') || attribute.value.startsWith('javascript:'))).toBe(false);
});

it('rejects unsafe or ambiguous captured project data before it can render', () => {
  const root = captureTree('<!doctype html><html><head></head><body><p>Safe</p></body></html>', sequentialIds('valid'));
  expect(capturedProblems({ widths: [1440], root })).toEqual([]);
  expect(capturedProblems({ widths: [1440, 1440], root: { ...root, attributes: [{ name: 'onload', namespace: null, value: 'alert(1)' }] } }).map((problem) => problem.path))
    .toEqual(expect.arrayContaining(['/root/attributes/0', '/widths/1']));
  const duplicate = { ...root, children: [...root.children, { kind: 'text' as const, id: root.id, value: 'duplicate' }] };
  expect(capturedProblems({ widths: [390], root: duplicate }).some((problem) => problem.message.includes('already used'))).toBe(true);
  const unsafe = { ...root, attributes: [{ name: 'href', namespace: null, value: 'java\nscript:alert(1)' }] };
  expect(capturedProblems({ widths: [390], root: unsafe }).some((problem) => problem.message.includes('unsafe'))).toBe(true);
  // a width's values must be one of the page's widths, and safe as the node's own
  const atUnknown = { ...root, at: { 834: { attributes: [{ name: 'onclick', namespace: null, value: 'x()' }] } } };
  expect(capturedProblems({ widths: [1440, 390], root: atUnknown }).map((problem) => problem.path)).toEqual(expect.arrayContaining(['/root/at/834', '/root/at/834/attributes/0']));
});

it('validates saved captured pages and carries a version-three capture to its widest snapshot', () => {
  const rules = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
  const old = createEmptyDocument(sequentialIds('authored'), { page: 'Home', root: 'Page' }, rules.root);
  expect(migrateDocument({ ...old, version: 2 })).toMatchObject({ ok: true, document: { version: 4, pages: old.pages } });
  const wide = captureTree('<html><head></head><body><p>Wide</p></body></html>', sequentialIds('w'));
  const narrow = captureTree('<html><head></head><body><p>Narrow</p></body></html>', sequentialIds('n'));
  const migrated = migrateDocument({ ...old, version: 3, pages: [{ ...old.pages[0], capture: { viewports: [{ width: 390, root: narrow }, { width: 1440, root: wide }] } }] });
  expect(migrated).toMatchObject({ ok: true, document: { version: 4, pages: [{ capture: { widths: [1440], root: wide } }] } });
  if (!migrated.ok) throw new Error('migration refused');
  expect(validateDocument(migrated.document as DocumentJson, [], rules)).toEqual([]);
  const valid = migrated.document as DocumentJson;
  const page = valid.pages[0] as DocumentJson['pages'][number];
  const unsafe = { ...valid, pages: [{ ...page, capture: { widths: [1440], root: { ...wide, attributes: [{ name: 'onload', namespace: null, value: 'alert(1)' }] } } }] } as DocumentJson;
  expect(validateDocument(unsafe, [], rules).some((problem) => problem.path.includes('/capture/'))).toBe(true);
});

it('reads a capture package: format 2 cleaned of what runs code, format 1 by its widest snapshot', () => {
  const tree = captureTree('<html><head></head><body><p>Kept</p></body></html>', sequentialIds('p'));
  const body = tree.children[1];
  if (body?.kind !== 'element') throw new Error('body missing');
  const dirty = { ...tree, children: [tree.children[0], { ...body, attributes: [{ name: 'onclick', namespace: null, value: 'steal()' }], children: [...body.children, { kind: 'element', id: 'x', namespace: 'http://www.w3.org/1999/xhtml', tag: 'script', attributes: [], children: [] }] }] };
  const read = capturedFromPackage({ format: 2, widths: [1440, 390], root: dirty }, sequentialIds('doc'));
  expect(read.widths).toEqual([1440, 390]);
  const readBody = read.root.children[1];
  if (readBody?.kind !== 'element') throw new Error('body missing');
  expect(readBody.attributes).toEqual([]);
  expect(readBody.children.map((one) => (one.kind === 'element' ? one.tag : one.kind))).toEqual(['p']);
  expect(read.root.id.startsWith('doc')).toBe(true);
  const legacy = capturedFromPackage({ format: 1, viewports: [{ width: 390, html: '<html><head></head><body>narrow</body></html>' }, { width: 1440, html: '<html><head></head><body>wide</body></html>' }] }, sequentialIds('old'));
  expect(legacy.widths).toEqual([1440]);
  expect(JSON.stringify(legacy.root)).toContain('wide');
});

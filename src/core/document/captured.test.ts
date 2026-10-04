// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { sequentialIds } from '../ports/ids.ts';
import { captureTree, capturedProblems, type CapturedNode } from './captured.ts';
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
  expect(capturedProblems({ viewports: [{ width: 1440, root }] })).toEqual([]);
  const invalid = {
    viewports: [
      { width: 1440, root: { ...root, attributes: [{ name: 'onload', namespace: null, value: 'alert(1)' }] } },
      { width: 1440, root },
    ],
  };
  expect(capturedProblems(invalid).map((problem) => problem.path)).toEqual(expect.arrayContaining(['/viewports/0/root/attributes/0', '/viewports/1/width']));
  const duplicate = { ...root, children: [...root.children, { kind: 'text' as const, id: root.id, value: 'duplicate' }] };
  expect(capturedProblems({ viewports: [{ width: 390, root: duplicate }] }).some((problem) => problem.message.includes('already used'))).toBe(true);
  const unsafe = { ...root, attributes: [{ name: 'href', namespace: null, value: 'java\nscript:alert(1)' }] };
  expect(capturedProblems({ viewports: [{ width: 390, root: unsafe }] }).some((problem) => problem.message.includes('unsafe'))).toBe(true);
});

it('validates saved captured pages and migrates old authored pages without changing their trees', () => {
  const rules = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
  const old = createEmptyDocument(sequentialIds('authored'), { page: 'Home', root: 'Page' }, rules.root);
  const migrated = migrateDocument({ ...old, version: 2 });
  expect(migrated).toMatchObject({ ok: true, document: { version: 3, pages: old.pages } });
  const root = captureTree('<html><head></head><body><p>Visible</p></body></html>', sequentialIds('capture'));
  const valid = { ...old, version: 3, pages: [{ ...old.pages[0], capture: { viewports: [{ width: 1440, root }] } }] } as DocumentJson;
  expect(validateDocument(valid, [], rules)).toEqual([]);
  const unsafe = { ...valid, pages: [{ ...valid.pages[0], capture: { viewports: [{ width: 1440, root: { ...root, attributes: [{ name: 'onload', namespace: null, value: 'alert(1)' }] } }] } }] } as DocumentJson;
  expect(validateDocument(unsafe, [], rules).some((problem) => problem.path.includes('/capture/'))).toBe(true);
});

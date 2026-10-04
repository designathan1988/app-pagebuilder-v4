// @vitest-environment happy-dom
// Family RN1 of the code audit (2026-10-04, second reading): a change of a file's bytes (an SVG edited in the code pane
// and saved) rewrote the page's fonts and captured sheet only; the image and the url() rules that draw the file kept
// the object URL of the old bytes, which objectUrl had revoked, so the canvas drew a broken picture until the element
// itself changed.
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../../generated/commands.ts';
import { manifest } from '../../../manifest/runtime.ts';
import type { DocNode, DocumentJson } from '../../../core/document/model.ts';
import { applyPatches, type Patch } from '../../../core/history/transaction.ts';
import { PageRenderer, renderModelFromManifest } from './render.ts';
import { canvasValue } from '../../../core/files/values.ts';

const model = renderModelFromManifest(manifest.elements, manifest.properties, manifest.interactions);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });

describe('new bytes of a file reach the elements that draw it (RN1)', () => {
  it('draws the image again with the new bytes\' object URL', () => {
    const created = URL.createObjectURL;
    let n = 0;
    URL.createObjectURL = () => `blob:test/${n++}`;
    try {
      const doc: DocumentJson = { version: 4, files: [{ path: 'img/a.svg', type: 'image/svg+xml', bytes: btoa('<svg/>') }], pages: [{ id: 'p', name: 'Home', file: 'index.html', tree: node('root', 'page', 'body', { children: [node('pic', 'image', 'img', { attributes: { src: 'img/a.svg', alt: '' } as never })] }) }] };
      const target = document.implementation.createHTMLDocument('page');
      let current = doc;
      const renderer = new PageRenderer(target, model, 0, null, (name, value) => canvasValue(current, name, value));
      renderer.mount(doc);
      expect(target.querySelector('img')?.getAttribute('src')).toBe('blob:test/0');
      const patches: Patch[] = [{ op: 'replace', path: ['files', 0, 'bytes'], value: btoa('<svg><rect/></svg>') }];
      const after = applyPatches(doc, patches).document;
      current = after;
      renderer.apply(doc, after, patches);
      expect(target.querySelector('img')?.getAttribute('src')).toBe('blob:test/1');
    } finally {
      URL.createObjectURL = created;
    }
  });
});

// Families PS1 and RP1 of the code audit (2026-10-04, second reading): the preview writes a page's linked script and
// the interactions script into the page itself. A "</script" inside the code ended the inline element early, the rest
// of the code showing as page text (PS1); and the code was the replacement string of String.replace, so its $&, $' and
// $` were read as replacement patterns, the page's own HTML pasted into the script (RP1).
import { describe, expect, it } from 'vitest';
import { manifest } from '../../manifest/runtime.ts';
import { rulesFromManifest } from '../document/validate.ts';
import type { DocNode, DocumentJson, NodeId } from '../document/model.ts';
import { previewPage } from './export.ts';

const RULES = rulesFromManifest(manifest.elements, manifest.properties, manifest.html);
const node = (id: string, type: string, tag: string, fields: Partial<DocNode> = {}): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag, attributes: {}, classes: [], styles: {}, text: null, children: [], ...fields });
const CODE = "var price = '$&'; var tail = \"$'\"; var tag = '</script><b>out</b>';";
const bytes = btoa(CODE);

describe('the preview writes a script\'s code as it is (PS1, RP1)', () => {
  it('keeps $ patterns and never ends the inline script early', () => {
    const tree = node('root', 'page', 'body', { attributes: { pageScripts: 'js/app.js' } as DocNode['attributes'], children: [node('h', 'heading', 'h1', { text: 'Hi' })] });
    const document: DocumentJson = { version: 4, pages: [{ id: 'p', name: 'Home', file: 'index.html', tree }], files: [{ path: 'js/app.js', type: 'text/javascript', bytes }] } as DocumentJson;
    const html = previewPage(document, RULES);
    expect(html).toContain("var price = '$&'; var tail = \"$'\";");
    expect(html).toContain("var tag = '<\\/script><b>out</b>';");
    expect(html).not.toContain("'</script><b>out");
  });
});

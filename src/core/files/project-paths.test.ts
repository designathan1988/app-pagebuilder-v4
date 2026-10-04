// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true,"disableJavaScriptFileLoading":true}}
// Family AD1 of the code audit (2026-10-04): a file of the project keeps its own name, a space or an accented letter
// in it, and every road an address of it takes — an image placed from it, a file renamed, a site imported, the export —
// takes it as the path it is. The address rule refused any relative address with a space, so an uploaded "My
// photo.png" placed on the canvas was refused as an invalid document (the invariant probe, seed 4101, renamed a used
// file to such a name), and an imported page's "My%20photo.jpg" named no project file.
import { describe, expect, it } from 'vitest';
import type { PickedFile } from '../../generated/commands.ts';
import type { DocNode } from '../document/model.ts';
import { locate, walk } from '../document/model.ts';
import { documentOf, node, runHandler } from '../testing/handlers.ts';
import type { NodeId } from '../../generated/commands.ts';
import { readAddress } from '../elements/address.ts';
import { insertImageFileCommand } from './assets.ts';
import { renameFileCommand } from './files.ts';
import { exportValue } from './values.ts';
import { importHtmlCommand } from '../import/import.ts';

const home = (children: readonly DocNode[] = []) => ({ id: 'home', name: 'Home', file: 'index.html', tree: node('Page', 'page', 'body', { children }) });

describe('a file of the project keeps its own name on every road (AD1)', () => {
  it('an image file named with a space is placed on the page', () => {
    const ran = runHandler(insertImageFileCommand, documentOf({ pages: [home()] }), { file: { name: 'My photo.png', type: 'image/png', bytes: '' } });
    expect(ran.outcome.kind).toBe('change');
    expect(ran.problems).toEqual([]);
  });

  it('a used file renamed to a name with spaces and accents keeps the element showing it', () => {
    const document = documentOf({ pages: [home([node('Pic', 'image', 'img', { attributes: { src: 'img/a.png' } })])], files: [{ path: 'img/a.png', type: 'image/png', bytes: '' }] });
    const ran = runHandler(renameFileCommand, document, { path: 'img/a.png', name: 'Título com acentos ção.png' });
    expect(ran.problems).toEqual([]);
    expect(locate(ran.document, 'Pic' as NodeId)?.node.attributes.src).toBe('img/Título com acentos ção.png');
  });

  it('a space still reads as a typo where no file is named', () => {
    expect(readAddress('img/a b.png').ok).toBe(true);
    expect(readAddress('example .com').ok).toBe(false);
    expect(readAddress('example.com/a b').ok).toBe(false);
    expect(readAddress('img/a\tb.png').ok).toBe(false);
  });

  it('the export writes such a path as a URL holds it', () => {
    const document = documentOf({ pages: [home()], files: [{ path: 'img/My photo.png', type: 'image/png', bytes: '' }] });
    expect(exportValue(document, 'src', 'img/My photo.png', 'index.html')).toBe('img/My%20photo.png');
  });

  it("an imported page's percent-encoded address names the picked file", () => {
    const html = '<!doctype html><html><body><img src="img/My%20photo.jpg" alt="Me"></body></html>';
    const files: PickedFile[] = [{ name: 'index.html', type: 'text/html', bytes: btoa(html) }, { name: 'img/My photo.jpg', type: 'image/jpeg', bytes: '' }];
    const ran = runHandler(importHtmlCommand, documentOf({ pages: [] }), { files }, { confirmed: true });
    if (ran.outcome.kind !== 'change') throw new Error(JSON.stringify(ran.outcome));
    const image = [...walk(ran.document.pages[0]?.tree as DocNode)].find((one) => one.tag === 'img');
    expect(image?.attributes.src).toBe('img/My photo.jpg');
    expect(ran.problems).toEqual([]);
  });
});

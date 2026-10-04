// What an attribute's stored value is written as (PRODUCT.md §5; the user's real-use audit, items 7.3 and A3.4): the
// one module that turns a stored value into the text the page's output writer puts in the HTML (elementAttributes,
// src/core/render/output.ts). Two kinds of value are not what they seem in the document: a reference that names another
// element (a label's `for`, a link's `#anchor`) and a source that names a file of the project. A reference is written
// the same way wherever it goes — the target's id attribute as it stands — but the two readers want different things
// from a project file: the canvas draws it through its object URL, while the export writes the path it carries in the
// archive (spec explorer-assets), and the preview turns those paths into data URLs itself (src/core/export/export.ts,
// previewPage: its frame has an opaque origin, where a blob: URL of the editor's origin does not load). So there is one
// writer per reader here, and no third rule anywhere.
import type { DocumentJson } from '../document/model.ts';
import { resolvedReference } from '../elements/references.ts';
import { fileAt, pageAtPath, relativePath, resolvedSource } from './files.ts';
import { rewriteSrcsetUrls } from './srcset.ts';

// whether a stored value is a reference to another element (elements.json: the label's `for`, an anchored link)
const isReference = (name: string, value: string): boolean => name === 'for' || (name === 'href' && value.startsWith('#'));

// What the export writes: the path a project file is stored at, a reference as the target's id attribute, everything
// else as it is. A reference whose target holds no id is written as nothing at all. `from` is the file the value is
// written in: an address that names a file or a page of the project is written relative to it (spec export-multi-page,
// export-file-tree), so a page in a folder reaches the stylesheet and its neighbours.
export function exportValue(document: DocumentJson, name: string, value: string, from = ''): string | null {
  if (isReference(name, value)) return resolvedReference(document, value);
  if (name === 'srcset') return rewriteSrcsetUrls(value, (url) => exportPath(document, url, from));
  return exportPath(document, value, from);
}

// Inline text links carry literal HTML fragments, not model-node references, but share project path resolution.
export function exportPath(document: DocumentJson, value: string, from = ''): string {
  if (from === '' || value === '') return value;
  const cut = value.search(/[#?]/);
  const path = cut < 0 ? value : value.slice(0, cut);
  const known = fileAt(document, path) !== null || pageAtPath(document, path) !== null;
  // a file's name is written as a URL holds it: a space or an accented letter percent-encoded, a srcset's candidates
  // never split by one (the audit's AD1)
  return known ? encodeURI(relativePath(from, path)) + (cut < 0 ? '' : value.slice(cut)) : value;
}

// What the canvas writes: the same, except that a source naming a project file draws through the file's object URL.
export function canvasValue(document: DocumentJson, name: string, value: string): string | null {
  if (isReference(name, value)) return resolvedReference(document, value);
  if (name === 'srcset') return rewriteSrcsetUrls(value, (url) => resolvedSource(document, url) ?? url);
  return resolvedSource(document, value) ?? value;
}

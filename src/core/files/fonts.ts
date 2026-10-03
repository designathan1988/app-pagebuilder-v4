// The project's fonts (INVENTORY.md, owners; the manifest's custom-fonts): the font files of the tree and
// the @font-face rules they need, so a font file the person uploaded is usable as a family in the Style panel's font
// menu, is drawn by the canvas, and reaches the export. One owner: which files are fonts, the family a font file is
// known by, and the rule text; the three readers differ only in the address they serve the file from — the export
// writes the file's path relative to the stylesheet, the canvas and the editor draw the fence with the file's object
// URL (core/files/files.ts).
import type { DocumentJson } from '../document/model.ts';
import type { ProjectFile } from './files.ts';
import { filesOf } from '../document/model.ts';


// The font kinds the project serves, by the file's type or, when it has none, its extension (fonts.upload stores a
// font in fonts/; a folder import keeps whatever the disc held).
const FONT_TYPES: readonly string[] = ['font/', 'application/font', 'application/vnd.ms-fontobject', 'application/x-font'];
const FONT_EXTENSIONS: readonly string[] = ['woff2', 'woff', 'ttf', 'otf'];

const extensionOf = (path: string): string => {
  const at = path.lastIndexOf('.');
  return at < 0 ? '' : path.slice(at + 1).toLowerCase();
};

export function isFontFile(file: ProjectFile): boolean {
  const type = file.type.toLowerCase();
  return FONT_TYPES.some((one) => type.startsWith(one)) || FONT_EXTENSIONS.includes(extensionOf(file.path));
}

// The project's fonts, in the tree's order: what the font menu offers and every @font-face rule is written for.
export function fontFiles(document: DocumentJson): readonly ProjectFile[] {
  return filesOf(document).filter(isFontFile);
}

// The family a project font is known by: its file's name without the folder or the extension ("fonts/Heading
// Bold.woff2" -> "Heading Bold"), so a file dropped in any folder is one family, named as the person named the file.
export function familyOf(file: ProjectFile): string {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  const at = name.lastIndexOf('.');
  return at <= 0 ? name : name.slice(0, at);
}

// A family as CSS text: quoted when it is not a single identifier (a space, a digit first), as font-family requires.
const IDENTIFIER = /^-?[a-zA-Z_][\w-]*$/;
export const cssFamily = (family: string): string => (IDENTIFIER.test(family) ? family : `'${family.replaceAll("'", "\\'")}'`);

// The format() hint of a font file, from its extension.
function formatOf(path: string): string | null {
  switch (extensionOf(path)) {
    case 'woff2':
      return 'woff2';
    case 'woff':
      return 'woff';
    case 'ttf':
      return 'truetype';
    case 'otf':
      return 'opentype';
    default:
      return null;
  }
}

// The @font-face rules of the given font files, in their order, one per file: `source(file)` is the address the font
// is served from (the export's path relative to the stylesheet, the canvas's and the editor's object URL). The text is
// what the export writes into css/styles.css and what the canvas and the editor write into a style element of their
// own, so the family the person chose in the font menu is the face both draw.
export function fontFaceCss(files: readonly ProjectFile[], source: (file: ProjectFile) => string): string {
  return files
    .filter(isFontFile)
    .map((file) => {
      const format = formatOf(file.path);
      const src = `url("${source(file).replaceAll('"', '\\"')}")${format === null ? '' : ` format("${format}")`}`;
      return ['@font-face {', `  font-family: ${cssFamily(familyOf(file))};`, `  src: ${src};`, '  font-display: swap;', '}'].join('\n');
    })
    .join('\n');
}

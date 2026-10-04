// One rule for every place the document writes a project path (spec explorer-file-system, "the users of a renamed file
// follow it"): when a file, a folder or a page's file takes another path, every element attribute that names it (an
// image's src, a link's href — with or without its #fragment —, a poster, a srcset), every url("…") of a style (an
// element's, a class's, a component part's), every script a page links (pageScripts) and, for a font file, every
// font-family that names its family, are written with the new path in the same undo step. Nothing else changes.
import type { AttributeValue, ComponentDefinition, DocNode, DocumentJson, StyleClass, Styles } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import type { ModelRules } from '../document/validate.ts';
import { cssFamily } from './fonts.ts';
import { mapInlineLinks } from '../text/inline.ts';

// A path's new place, or the same path when the move does not touch it.
export type PathRewrite = (path: string) => string;

// The rewrite a move of `from` to `to` gives: the path itself and everything under it (a folder's contents).
export const movedPath = (from: string, to: string): PathRewrite => (path) => (path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path);

// An address as a link or a source writes it: a path, optionally followed by a #fragment or a ?query.
function followAddress(value: string, rewrite: PathRewrite): string {
  const cut = value.search(/[#?]/);
  const base = cut < 0 ? value : value.slice(0, cut);
  const moved = base === '' ? base : rewrite(base);
  return moved === base ? value : `${moved}${cut < 0 ? '' : value.slice(cut)}`;
}

// A srcset or a pageScripts list: several addresses separated by commas or spaces, each kept with its descriptor.
function followList(value: string, rewrite: PathRewrite, separator: RegExp, joiner: string): string {
  const parts = value.split(separator);
  const moved = parts.map((part) => {
    const trimmed = part.trim();
    const space = trimmed.search(/\s/);
    const address = space < 0 ? trimmed : trimmed.slice(0, space);
    const rest = space < 0 ? '' : trimmed.slice(space);
    return `${followAddress(address, rewrite)}${rest}`;
  });
  return moved.some((part, i) => part !== parts[i]?.trim()) ? moved.join(joiner) : value;
}

function followAttribute(name: string, value: AttributeValue, rewrite: PathRewrite, addresses?: ReadonlySet<string>): AttributeValue {
  if (typeof value !== 'string' || value === '' || (addresses !== undefined && !addresses.has(name))) return value;
  if (name === 'pageScripts') return followList(value, rewrite, /\s+/, ' ');
  if (name === 'srcset') return followList(value, rewrite, /,/, ', ');
  return followAddress(value, rewrite);
}

// url("…") / url('…') / url(…) inside a declaration value
const URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

export function followCssUrls(value: string, rewrite: PathRewrite): string {
  return value.includes('url(') ? value.replace(URL, (all, quote: string, address: string) => {
    const moved = followAddress(address.trim(), rewrite);
    return moved === address.trim() ? all : `url(${quote === '' ? '"' : quote}${moved}${quote === '' ? '"' : quote})`;
  }) : value;
}

// The renamed font families, and the properties whose value is a list of families (the manifest's properties of the
// font-family-list codec): where a family name is written.
export interface FamilyRenames {
  readonly names: ReadonlyMap<string, string>;
  readonly properties: ReadonlySet<string>;
}
const NO_FAMILIES: FamilyRenames = { names: new Map(), properties: new Set() };

function followDeclaration(property: string, value: string, rewrite: PathRewrite, families: FamilyRenames): string {
  let next = followCssUrls(value, rewrite);
  if (families.names.size > 0 && families.properties.has(property)) {
    const names = next.split(',').map((one) => one.trim());
    const renamed = names.map((one) => {
      const bare = one.replace(/^(['"])(.*)\1$/, '$2');
      const family = families.names.get(bare);
      return family === undefined ? one : cssFamily(family);
    });
    if (renamed.some((one, i) => one !== names[i])) next = renamed.join(', ');
  }
  return next;
}

function followStyles(styles: Styles, rewrite: PathRewrite, families: FamilyRenames): Styles {
  let changed = false;
  const next: Record<string, Record<string, Record<string, string>>> = {};
  for (const [breakpoint, states] of Object.entries(styles)) {
    const nextStates: Record<string, Record<string, string>> = {};
    for (const [state, declarations] of Object.entries(states ?? {})) {
      const nextDeclarations: Record<string, string> = {};
      for (const [property, value] of Object.entries(declarations ?? {})) {
        const moved = typeof value === 'string' ? followDeclaration(property, value, rewrite, families) : value;
        if (moved !== value) changed = true;
        nextDeclarations[property] = moved as string;
      }
      nextStates[state] = nextDeclarations;
    }
    next[breakpoint] = nextStates;
  }
  return changed ? (next as Styles) : styles;
}

function followNode(node: DocNode, rewrite: PathRewrite, families: FamilyRenames, addresses?: ReadonlySet<string>): DocNode {
  let attributes = node.attributes;
  for (const [name, value] of Object.entries(node.attributes)) {
    if (value === undefined) continue;
    const moved = followAttribute(name, value, rewrite, addresses);
    if (moved !== value) attributes = { ...attributes, [name]: moved };
  }
  const styles = followStyles(node.styles, rewrite, families);
  const inline = node.inline === undefined ? undefined : mapInlineLinks(node.inline, href => followAddress(href, rewrite));
  const children = node.children.map((child) => followNode(child, rewrite, families, addresses));
  const same = attributes === node.attributes && styles === node.styles && inline === node.inline && children.every((child, i) => child === node.children[i]);
  return same ? node : { ...node, attributes, styles, ...(inline === undefined ? {} : { inline }), children };
}

// The attributes that hold an address (elements.json: a url, a list of paths, a srcset): the only ones a moved path is
// written into. An id, an alt or a title that happens to read like the path is the person's text (the audit's RF1: a
// folder img renamed images took an element's id "img" with it).
export function addressAttributes(rules: Pick<ModelRules, 'attributeValues'>): ReadonlySet<string> {
  return new Set([...rules.attributeValues].filter(([, facts]) => facts.valueType === 'url' || facts.valueType === 'path-list' || facts.html === 'srcset').map(([id]) => id));
}

// The patches that write every reference of the document through `rewrite` (and the renamed font families), one per
// part of the document that changed: a page's tree, the classes, the components.
export function followPaths(document: DocumentJson, rewrite: PathRewrite, families: FamilyRenames = NO_FAMILIES, addresses?: ReadonlySet<string>): Patch[] {
  const patches: Patch[] = [];
  document.pages.forEach((page, index) => {
    const tree = followNode(page.tree, rewrite, families, addresses);
    if (tree !== page.tree) patches.push({ op: 'replace', path: ['pages', index, 'tree'], value: tree });
  });
  const classes: readonly StyleClass[] = document.classes ?? [];
  const nextClasses = classes.map((one) => {
    const styles = followStyles(one.styles, rewrite, families);
    return styles === one.styles ? one : { ...one, styles };
  });
  if (nextClasses.some((one, i) => one !== classes[i])) patches.push({ op: 'replace', path: ['classes'], value: nextClasses });
  const components: readonly ComponentDefinition[] = document.components ?? [];
  const nextComponents = components.map((one) => {
    const tree = followNode(one.tree, rewrite, families, addresses);
    return tree === one.tree ? one : { ...one, tree };
  });
  if (nextComponents.some((one, i) => one !== components[i])) patches.push({ op: 'replace', path: ['components'], value: nextComponents });
  return patches;
}

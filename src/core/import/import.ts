// project.importHtml (INVENTORY.md, owners; the manifest's html-import-* and clipboard-paste-external; the
// spec spec/BEHAVIOUR.md#html-import): the one owner of reading HTML — from files the person picked, from a ZIP they
// hold, or from the code pane's markup — into nodes of the model, with the cleaning, the repair and the report the
// manifest's features ask for. The rules are the ones the editor already holds: an element type is the one whose tags
// elements.json names (its own tag is kept, so an h3 stays an h3), an attribute is the one elements.json declares for
// that type under that HTML name, its value validated by the model's own rule (validate.ts attributeValueRefusal), a
// text element's content becomes its text and its inline marks (core/text/inline.ts), an <svg> keeps its markup
// (core/elements/svg.ts), and the nesting is the content model (core/elements/content-model.ts).
//
// What the model has no place for is never invented and never silently lost:
//  - a script is kept with its page: an inline script's code becomes a project file whose path joins the page's own
//    scripts (pageScripts), a `src` among the picked files keeps that file at its path, and a `src` that is no picked
//    file stays the address the page lists. Nothing of it runs on the editing canvas, and the export writes it back;
//  - an element no type is written with is unwrapped: its children take its place, and the report says so;
//  - a nesting the content model forbids is repaired the way HTML repairs it (a stray li gets a ul; an element a
//    closed list refuses is wrapped in the first tag that list accepts) or dropped, and the report says so;
//  - an event handler attribute (on…) and an attribute the model refuses are removed, and the report says so.
// The import report is the message the command says: what came in, and per kind the source lines. The status bar shows
// it (archive/DESIGN.md "Dock and status bar").
//
// The styles (html-import-styles, html-import-media-queries, html-import-states): the <style> blocks the page holds,
// the stylesheets it links (found by their path among the picked files) and the style attributes are read by the one
// reader of a stylesheet (src/core/import/stylesheet.ts) and matched onto the nodes by the one matcher
// (src/core/import/selectors.ts); the declarations themselves are read by the one owner of a declarations text
// (style/custom.ts parseDeclarations), a shadow by its own reader (style/shadows.ts shadowLayersFromCss). A declaration
// lands on the element, the breakpoint and the state CSS gives it (importance, inline, specificity, then order), so the
// canvas computes what the original page computed.
//
// The parsing of the markup itself is the browser's (DOMParser: the same parser the clipboard reads with), so an outer
// <html>, <body> or a stray <table> wrapper is unwrapped as the parser does; the source's line of a piece is found by
// looking it up in the text, which is why the report names lines a person can see.
import type { NodeId, PickedFile } from '../../generated/commands.ts';
import type { ElementType, MessageId } from '../../generated/ids.ts';
import { message, registerHandler, type HandlerContext, type Message } from '../commands/registry.ts';
import { probeOf, TOKEN_KINDS, type Token } from '../design/tokens.ts';
import { readValue } from '../style/set.ts';
import { allNodes, isEmptyProject, type Animation, type DocNode, type DocumentJson, type Keyframe, type Page, type ProjectFile, type StoredValue, type Styles } from '../document/model.ts';
import { SETTINGS as ANIMATION_SETTINGS, defaultSetting, keyframeEasingProperty, settingProperty } from '../animation/animation.ts';
import type { InlineRun } from '../text/inline.ts';
import { attributeValueRefusal, customAttributeRefusal, type ModelRules } from '../document/validate.ts';
import { validClassName } from '../design/classes.ts';
import { followCssUrls } from '../files/references.ts';
import { importDestination } from './destinations.ts';
import { childrenRefusal } from '../elements/content-model.ts';
import { readAddress } from '../elements/address.ts';
import { sanitizedSvgMarkup } from '../elements/svg.ts';
import { fileBytes, pickedFilePath, resolveHref, typeOfFile } from '../files/files.ts';
import { ArchiveError, archiveReason, isZip, unzip } from '../project/zip.ts';
import { canonical, hasMarks } from '../text/inline.ts';
import { freshName, type NodeMaker } from '../structure/node-maker.ts';
import { parseDeclarations } from '../style/custom.ts';
import { shadowLayersFromCss } from '../style/shadows.ts';
import { matches, readSelector, type Compound, type Facts, type Selector } from './selectors.ts';
import { readDeclarations, readStylesheet, type CssRule, type CssSheet } from './stylesheet.ts';
import { baseCss, CAPTURE_BASE_LAYER } from '../render/base.ts';
import { ELEMENTS_HEADING, underClassesHeading } from '../export/sheet-headings.ts';
// reading markup (core/import/markup.ts): the DOM walk and the source lines, moved out of this file
import { lineOf, lineOfNode, parseMarkup, parsePage, textOf, type MarkupChild, type MarkupNode } from './markup.ts';
import { browserPorts } from '../ports/browser.ts';
import { orphanReferences } from '../elements/references.ts';
import { generate as generateCssTree, parse as parseCssTree, walk as walkCssTree, type CssNode as CssTreeNode } from 'css-tree';
import { capturedPageStylePath } from './capture-styles.ts';

// the entries this module published before the markup reading moved out stay published here: consumers need not change
export { parseMarkup, parsePage, lineOf } from './markup.ts';
export type { MarkupChild, MarkupNode, MarkupPage } from './markup.ts';


// ---------------------------------------------------------------- the picked files

// The files a door that reads several at once hands the command, read here (the door calls this before it dispatches):
// each file's bytes (base64), its type and, for an image, its intrinsic size. A ZIP file stands for the entries it
// holds, each with the path it has inside the archive; one the reader cannot read stands for its own file with the
// reason, which the command refuses with.
export async function readPickedFiles(files: readonly File[]): Promise<readonly PickedFile[]> {
  const picked: PickedFile[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isZip(bytes)) {
      try {
        for (const [path, data] of await unzip(bytes)) {
          if (!path.endsWith('/')) picked.push(await fileOf(path, data, ''));
        }
      } catch (error) {
        picked.push({ name: file.name, type: file.type === '' ? 'application/zip' : file.type, bytes: base64(bytes), error: error instanceof ArchiveError ? error.reason : (error as Error).message });
      }
      continue;
    }
    picked.push(await fileOf(pickedFilePath(file), bytes, file.type));
  }
  return picked;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function fileOf(name: string, bytes: Uint8Array, declared: string): Promise<PickedFile> {
  const type = declared !== '' ? declared : typeOfFile(name);
  const held = base64(bytes);
  // an image's own size, as an upload reads it: the document keeps it beside the bytes
  if (type.startsWith('image/') && type !== 'image/svg+xml') {
    const size = await browserPorts().imageSize(held, type);
    if (size !== null) return { name, type, bytes: held, width: size.width, height: size.height };
  }
  return { name, type, bytes: held };
}

const isHtmlFile = (name: string): boolean => /\.html?$/i.test(name);
const isCssFile = (name: string): boolean => /\.css$/i.test(name);
const baseName = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
};

// the text a picked file holds
const textOfFile = (file: PickedFile): string => new TextDecoder().decode(fileBytes({ path: file.name, type: file.type, bytes: file.bytes }));

// A file's record in the project, at the path it came with: the export writes it back where it stood.
const recordOf = (file: PickedFile): ProjectFile => ({
  path: file.name,
  type: file.type,
  bytes: file.bytes,
  ...(file.width === undefined ? {} : { width: file.width }),
  ...(file.height === undefined ? {} : { height: file.height }),
});

// ---------------------------------------------------------------- the import report

// What the import found, per kind, by the source line: the message the command says reads it, nothing else does.
interface Report {
  readonly scripts: number[];
  readonly handlers: number[];
  readonly unwrapped: number[];
  readonly repaired: number[];
  readonly dropped: number[];
  readonly attributes: number[];
  // per file: the rules that could not be mapped, the rules a nearby breakpoint took, and the declarations the editor
  // does not store, each by line
  readonly unmapped: Map<string, number[]>;
  readonly approximated: Map<string, number[]>;
  readonly declarations: Map<string, number[]>;
  readonly sheetsMissing: string[];
  // the references (a link's #fragment, a label's for) that named no element of the imported pages, released
  readonly released: string[];
  // the variables of the sheets' :root rule kept as the project's, and the classes no element lists kept (AUD-05)
  readonly tokens: string[];
  readonly unusedClasses: string[];
}

const emptyReport = (): Report => ({
  scripts: [],
  handlers: [],
  unwrapped: [],
  repaired: [],
  dropped: [],
  attributes: [],
  unmapped: new Map(),
  approximated: new Map(),
  declarations: new Map(),
  sheetsMissing: [],
  released: [],
  tokens: [],
  unusedClasses: []
});

const add = (into: Map<string, number[]>, file: string, line: number): void => {
  const held = into.get(file);
  if (held === undefined) into.set(file, [line]);
  else if (!held.includes(line)) held.push(line);
};

// a list of lines as the report reads them (a long one is cut: the status bar holds one line)
const linesOf = (lines: readonly number[]): string => {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  return sorted.length <= 12 ? sorted.join(', ') : `${sorted.slice(0, 12).join(', ')}…`;
};

// The report as the words of a message: one fragment per kind that found something, the words from the catalogue
// (words, the language the person reads the editor in) and the lines themselves. The fragments are full sentences, so
// the message reads in any language.
export function reportNotes(report: Report, words: (key: MessageId, params?: Readonly<Record<string, string | number>>) => string): string {
  const notes: string[] = [];
  // a fragment the person pasted has no file name of its own: the lines are the pasted markup's own
  const named = (file: string): string => (file === '' ? words('status.pasted.source') : file);
  if (report.scripts.length > 0) notes.push(words('status.import.scripts', { lines: linesOf(report.scripts) }));
  if (report.handlers.length > 0) notes.push(words('status.import.handlers', { lines: linesOf(report.handlers) }));
  if (report.unwrapped.length > 0) notes.push(words('status.import.unwrapped', { lines: linesOf(report.unwrapped) }));
  if (report.repaired.length > 0) notes.push(words('status.import.repaired', { lines: linesOf(report.repaired) }));
  if (report.dropped.length > 0) notes.push(words('status.import.dropped', { lines: linesOf(report.dropped) }));
  if (report.attributes.length > 0) notes.push(words('status.import.attributes', { lines: linesOf(report.attributes) }));
  for (const [file, lines] of report.approximated) notes.push(words('status.import.approximated', { file: named(file), lines: linesOf(lines) }));
  for (const [file, lines] of report.unmapped) notes.push(words('status.import.unmapped', { file: named(file), lines: linesOf(lines) }));
  for (const [file, lines] of report.declarations) notes.push(words('status.import.declarations', { file: named(file), lines: linesOf(lines) }));
  for (const file of report.sheetsMissing) notes.push(words('status.import.sheetMissing', { file }));
  if (report.released.length > 0) notes.push(words('status.import.released', { count: report.released.length, values: [...new Set(report.released)].slice(0, 6).join(', ') }));
  if (report.tokens.length > 0) notes.push(words('status.import.tokensKept', { names: report.tokens.slice(0, 6).join(', ') }));
  if (report.unusedClasses.length > 0) notes.push(words('status.import.unusedClassesKept', { names: report.unusedClasses.slice(0, 6).join(', ') }));
  return notes.length === 0 ? '' : ` ${notes.join(' ')}`;
}

// ---------------------------------------------------------------- building one page's nodes

export interface ImportProblem {
  readonly line: number;
  readonly message: Message;
}

// what the strict reader (element.applyHtml) did with what the model has no place for
export interface Dropped {
  readonly elements: number;
  readonly attributes: number;
}

export interface Imported {
  readonly nodes: readonly DocNode[];
  readonly dropped: Dropped;
}

// What a fragment of markup the person pasted becomes (spec clipboard-paste-external, Problems in Pager 1): the nodes
// the importer's rules make of it — the same cleaning, the same repair, the same report — with no page to keep a script
// with, so a script is dropped and reported, and no stylesheet of its own (a pasted style attribute lands on its
// element as it does for a page).
export interface PastedFragment {
  readonly nodes: readonly DocNode[];
  readonly report: Report;
}

export function nodesFromExternal(markup: string, make: NodeMaker, context: HandlerContext<never>): PastedFragment {
  const builder = newBuilder(make, context, markup, [], '', 'import');
  const nodes = buildChildren(parseMarkup(markup) as readonly MarkupChild[], 'body', ['body'], builder, 1);
  // a fragment holds no stylesheet: what its elements carry is their own style attributes, at the base layer
  const write = (node: DocNode): void => {
    const own = builder.inline.get(node.id) ?? [];
    if (own.length > 0) (node as { styles: Styles }).styles = { [builder.rules.baseLayer.breakpoint]: { [builder.rules.baseLayer.state]: Object.fromEntries(own) } } as Styles;
    for (const child of node.children) write(child);
  };
  for (const node of nodes) write(node);
  return { nodes, report: builder.report };
}

interface Script {
  readonly line: number;
  // the address the page lists (a src that is no picked file), or the path of the file that holds the code
  readonly path: string;
}

interface Sheet {
  readonly file: string;
  readonly css: CssSheet;
  // the sheet as written (a captured page keeps what the model does not hold: residualCss)
  readonly text: string;
}

// What builds one page: the names no node has, the picked files (a script's src resolves among them), the report, the
// cells the cascade reads (the style attributes, by node) and what the page keeps.
// An <svg>'s size and coordinate system as its attributes write them (the audit's AUD-15: the MDN logo came in as an
// empty box, its width, height and viewBox dropped). Its width and height are presentation attributes (SVG 2,
// "Presentation attributes": CSS properties of specificity zero, written before every rule of the author), so they
// become its size unless a rule of the sheets sets one (the cascade: applyStyles). Its viewBox is the coordinate system
// of its drawing: the model writes an svg's viewBox from its size (core/elements/svg.ts viewBoxOf), so a viewBox other
// than its own size keeps the drawing in an svg of its own inside, filling it (svgDrawing).
const SVG_TYPE = 'svg';
interface SvgSize {
  declarations: string;
  viewBox: string | null;
  aspect: string | null;
}
// takes the attribute when it is one of the svg's size or coordinates (the parser gives the names in lower case): its
// width and height are named as the properties of a box's size (the model's boxSize)
function svgSizeAttribute(size: SvgSize, html: string, value: string, boxSize: readonly string[]): boolean {
  const text = value.trim();
  if (boxSize.includes(html)) {
    // a bare number is a length in px, as SVG reads it
    size.declarations += `${html}: ${/^\d+(?:\.\d+)?$/.test(text) ? `${text}px` : text};`;
    return true;
  }
  if (html === 'viewbox') {
    size.viewBox = text.split(/[\s,]+/).join(' ');
    const box = size.viewBox.split(' ');
    const width = Number(box[2]);
    const height = Number(box[3]);
    if (box.length === 4 && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      size.declarations += `aspect-ratio: ${box[2]} / ${box[3]};`;
    }
    return true;
  }
  if (html === 'preserveaspectratio') {
    size.aspect = text;
    return true;
  }
  return false;
}
// the svg's own size in px when its width and height attributes give both, else null
function svgOwnBox(size: SvgSize): string | null {
  const width = /width: (\d+(?:\.\d+)?)px;/.exec(size.declarations)?.[1];
  const height = /height: (\d+(?:\.\d+)?)px;/.exec(size.declarations)?.[1];
  return width === undefined || height === undefined ? null : `0 0 ${width} ${height}`;
}
// the drawing an svg keeps: its own markup, inside an svg of its own when its viewBox is not its own size
function svgDrawing(markup: string, size: SvgSize): string {
  if (markup === '' || size.viewBox === null || size.viewBox === svgOwnBox(size)) return markup;
  const aspect = size.aspect === null ? '' : ` preserveAspectRatio="${size.aspect.replaceAll('"', '&quot;')}"`;
  return `<svg viewBox="${size.viewBox.replaceAll('"', '&quot;')}" width="100%" height="100%"${aspect}>${markup}</svg>`;
}

interface Builder {
  readonly make: NodeMaker;
  readonly rules: ModelRules;
  readonly context: HandlerContext<never>;
  readonly markup: string;
  readonly picked: readonly PickedFile[];
  readonly file: string;
  readonly pageFile: string;
  readonly report: Report;
  readonly scripts: Script[];
  readonly sheets: Sheet[];
  readonly held: ProjectFile[];
  // the declarations a style attribute holds, by node id, and the line each node was written on
  readonly inline: Map<string, readonly (readonly [string, StoredValue])[]>;
  // the declarations an <svg>'s width and height attributes give it, by node id: presentation attributes, below every
  // rule of the sheets (applySvgSize)
  readonly presentational: Map<string, readonly (readonly [string, StoredValue])[]>;
  readonly lines: Map<string, number>;
  readonly nameBlocks: Map<string, Set<string>>;
  exportedSheet: boolean;
  // 'import': an unknown element is unwrapped and a forbidden nesting repaired or dropped, each reported; 'strict':
  // the code pane's own reader (element.applyHtml) refuses a nesting the model forbids and drops what it cannot read
  readonly mode: 'import' | 'strict';
  // whether a script is kept with the page (a page import) or dropped, with the report (a pasted fragment)
  readonly keepScripts: boolean;
  // what the strict reader dropped, and the first nesting it refused (the import reports instead)
  readonly dropped: { elements: number; attributes: number };
  problem: ImportProblem | null;
}

// Resolve only addresses that name picked resources; external addresses retain the address owner's rules.
function importedPath(builder: Builder, address: string, from = builder.file): string | null {
  const cut = address.search(/[#?]/);
  const path = cut < 0 ? address : address.slice(0, cut);
  if (path === '') return null;
  const resolved = resolveHref(from, path);
  const found = builder.picked.find(file => file.name === resolved) ?? builder.picked.find(file => file.name === path);
  return found ? found.name + (cut < 0 ? '' : address.slice(cut)) : null;
}

// the element type whose tags name this tag, the type the tag is its own first tag for: <section> is the Section and
// not the Div that may also be written with it, <pre> is the Pre and not the Paragraph that offers it too
function typeOfTag(tag: string, rules: ModelRules): string | null {
  let fallback: string | null = null;
  for (const [id, element] of rules.elements) {
    if (!element.tags.includes(tag)) continue;
    if (element.tags[0] === tag) return id;
    fallback ??= id;
  }
  return fallback;
}

// an attribute of the element's type under this HTML name
function attributeNamed(html: string, type: string, rules: ModelRules): string | null {
  for (const [id, kinds] of rules.attributes) {
    if ((rules.attributeValues.get(id)?.html ?? null) !== html) continue;
    if (kinds === 'all' || kinds.includes(type)) return id;
  }
  return null;
}

// The class list a node keeps: the model's own rule (validate.ts: a class name, once each), and whether any was left
// out
function classList(value: string): { readonly names: readonly string[]; readonly dropped: boolean } {
  const words = value.split(/\s+/).filter((one) => one !== '');
  const names: string[] = [];
  for (const word of words) if (validClassName(word) && !names.includes(word)) names.push(word);
  return { names, dropped: names.length !== words.length };
}

// The name the import gives an element: the BEM class it was written with, else the type's own name in the person's
// language (the manifest's html-import-structure: "Element names are taken from BEM classes when present").
function elementName(classes: readonly string[], type: string, rules: ModelRules, make: NodeMaker): string {
  const element = rules.elements.get(type as ElementType);
  // card__title -> Title, card--featured -> Featured, hero -> Hero
  const last = classes[classes.length - 1] ?? '';
  const part = last.includes('__') ? (last.split('__')[1] ?? '') : last.includes('--') ? (last.split('--')[1] ?? '') : last;
  const base = part.replace(/[-_]+/g, ' ').trim();
  if (base === '') return make.words((element?.labelKey ?? 'element.container.label') as MessageId);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

type Raw = { readonly node: DocNode } | { readonly text: string } | { readonly nothing: true } | { readonly nodes: readonly DocNode[] };

// the inline runs of a text element's markup: its elements' marks, its texts as they are (a <br> is a line break)
function runsOf(children: readonly MarkupChild[], builder: Builder, preserveWhitespace = false): InlineRun[] {
  const out: InlineRun[] = [];
  for (const child of children) {
    if (typeof child === 'string') {
      if (child !== '') out.push(preserveWhitespace ? child : child.replace(/\s+/g, ' '));
      continue;
    }
    if (child.tag === 'br') {
      out.push('\n');
      continue;
    }
    // an element the page does not draw (hidden: a captured page's short label of a wide one) is no part of the line
    // the text shows: dropped, and the report names its line (a text holds no hidden piece of its own)
    if (child.attributes.has('hidden')) {
      if (builder.mode === 'import') builder.report.dropped.push(lineOfNode(builder.markup, child));
      continue;
    }
    const inner = runsOf(child.children, builder, preserveWhitespace);
    if (child.tag === 'a') {
      const href = (child.attributes.get('href') ?? '').trim();
      // the one rule of an address a link may have (core/elements/address.ts): one it refuses leaves the text plain,
      // and the report names the line
      const read = readAddress(href);
      if (href !== '' && !read.ok) builder.report.attributes.push(lineOfNode(builder.markup, child));
      out.push({ tag: 'a', href: read.ok ? (importedPath(builder, href) ?? read.value) : '', children: inner });
      continue;
    }
    if (child.tag === 'strong' || child.tag === 'b') out.push({ tag: 'strong', children: inner });
    else if (child.tag === 'em' || child.tag === 'i') out.push({ tag: 'em', children: inner });
    // anything else a text element holds is unwrapped: what it holds runs on in the line, and what it cannot hold is
    // dropped (an image inside a paragraph); the report says which, with the line
    else {
      if (builder.mode === 'import') {
        const holds = textOf(child).trim() !== '';
        (holds ? builder.report.unwrapped : builder.report.dropped).push(lineOfNode(builder.markup, child));
      }
      out.push(...inner);
    }
  }
  return out;
}

const plainOf = (runs: readonly InlineRun[]): string => runs.map((run) => (typeof run === 'string' ? run : plainOf(run.children))).join('');

// the path an inline script's code takes in the project: js/<page>-<n>.js, the first free number
function scriptPath(builder: Builder, module: boolean): string {
  const extension = module ? 'mjs' : 'js';
  for (let n = 1; ; n += 1) {
    const path = `js/${builder.pageFile}-${n}.${extension}`;
    if (!builder.held.some((file) => file.path === path)) return path;
  }
}

// A <script> the page keeps: its code (an inline script, kept as a project file) or its address (a src among the picked
// files keeps that file, at its own path; any other src stays the address the page lists). Never runs on the canvas.
function keepScript(child: MarkupNode, builder: Builder): void {
  const line = lineOfNode(builder.markup, child);
  const source = (child.attributes.get('src') ?? '').trim();
  const src = importedPath(builder, source) ?? source;
  const type = (child.attributes.get('type') ?? '').trim().toLowerCase();
  if (src === '') {
    // a script that is data (a JSON-LD block) holds no code the editor could keep: it is dropped, reported
    if (type !== '' && type !== 'text/javascript' && type !== 'module' && type !== 'application/javascript') {
      builder.report.dropped.push(line);
      return;
    }
    const code = textOf(child);
    const path = scriptPath(builder, type === 'module');
    builder.held.push({ path, type: 'text/javascript', bytes: utf8Base64(code) });
    builder.scripts.push({ line, path });
    builder.report.scripts.push(line);
    return;
  }
  const read = readAddress(src);
  if (!read.ok) {
    builder.report.attributes.push(line);
    return;
  }
  const held = builder.picked.find((file) => !isHtmlFile(file.name) && !isCssFile(file.name) && (file.name === read.value || file.name.endsWith(`/${read.value}`) || read.value.endsWith(`/${file.name}`)));
  // the file a src names, kept at its own path; anything else is the address the page lists
  if (held !== undefined) builder.held.push(recordOf(held));
  builder.scripts.push({ line, path: held === undefined ? read.value : held.name });
  builder.report.scripts.push(line);
}

function utf8Base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

// Why the nodes below a node may not sit where they are, read from the content model the way placementRefusal reads a
// whole document: an ancestor that refuses interactive content inside it, or one that excludes the element or
// something inside it.
function nestingRefusal(rules: ModelRules, ancestors: readonly string[], node: DocNode): Message | null {
  const tags = [...walkTags(node)];
  const interactive = [...walkNodes(node)].some((inner) => inner.tag !== null && rules.contentModel.isInteractive(inner.tag, htmlNames(inner, rules)));
  const excludingAncestor = [...ancestors].reverse().find((tag) => rules.contentModel.excludesInteractive(tag));
  if (excludingAncestor !== undefined && interactive) return message('status.refused.interactiveInside', { parent: `<${excludingAncestor}>` });
  for (const inner of tags) {
    const excluding = [...ancestors].reverse().find((ancestor) => rules.contentModel.excludes(ancestor, inner));
    if (excluding !== undefined) return message('status.refused.notInside', { child: `<${inner}>`, ancestor: `<${excluding}>` });
  }
  return null;
}

function* walkNodes(node: DocNode): Generator<DocNode> {
  yield node;
  for (const child of node.children) yield* walkNodes(child);
}

function* walkTags(node: DocNode): Generator<string> {
  if (node.tag !== null) yield node.tag;
  for (const child of node.children) yield* walkTags(child);
}

// a node's attributes under their HTML names, as HTML's own rules read them (the interactive conditions)
function htmlNames(node: DocNode, rules: ModelRules): ReadonlyMap<string, string | true> {
  const out = new Map<string, string | true>();
  for (const [id, value] of Object.entries(node.attributes)) {
    const name = rules.attributeValues.get(id)?.html;
    if (name === null || name === undefined || value === false) continue;
    out.set(name, typeof value === 'boolean' ? true : String(value));
  }
  return out;
}

// Builds the nodes of one markup child: the element it names, the text it holds (inside a text element), nothing (an
// empty text, a script, a style, a piece with no place here), or several nodes (an unknown element unwrapped).
function build(child: MarkupChild, builder: Builder, ancestors: readonly string[]): Raw {
  if (typeof child === 'string') return child.trim() === '' && ancestors[ancestors.length - 1] !== 'pre' ? { nothing: true } : { text: child };
  const { rules, make } = builder;
  const visualSpan = builder.mode === 'import' && child.tag === 'span' && holdsLinkedMedia(child) && visualOnlyChildren(child.children);
  // A plain span around only visual media is HTML phrasing content, but the model's span is a text-only Paragraph.
  // Release the wrapper so its visual children remain editable rather than turning the span into empty text.
  if (visualSpan && child.attributes.size === 0) {
    builder.report.unwrapped.push(lineOfNode(builder.markup, child));
    return { nodes: child.children.flatMap((one) => {
      const made = build(one, builder, ancestors);
      return 'node' in made ? [made.node] : 'nodes' in made ? [...made.nodes] : [];
    }) };
  }
  // an <a> is the Link Block when it holds a block of its own (a card made of one link) and the Link otherwise, as
  // the editor's two types of the same tag are meant (elements.json)
  // A styled image wrapper needs a children-bearing model element. Keep its classes and attributes on a Div so its
  // layout rules and the image remain editable; the model's span variant is text-only.
  const type = visualSpan ? 'div' : child.tag === 'a' ? (holdsBlock(child, rules) || holdsLinkedMedia(child) ? 'linkBlock' : 'link') : typeOfTag(child.tag, rules);
  const tag = visualSpan ? 'div' : child.tag;
  if (type === null) {
    // A script and a style are no elements of the page: the import reads them itself (a page keeps its script's code,
    // a linked sheet's rules land on the elements), the code pane's reader drops them as anything else it has no
    // element for, and a pasted fragment has no page to keep a script with — it is dropped, and the report says so.
    if (builder.mode === 'import' && child.tag === 'script') {
      if (builder.keepScripts) {
        keepScript(child, builder);
        return { nothing: true };
      }
      builder.report.dropped.push(lineOfNode(builder.markup, child));
      return { nothing: true };
    }
    if (builder.mode === 'import' && child.tag === 'style') {
      if (builder.keepScripts) {
        const text = textOf(child);
        builder.sheets.push({ file: builder.file, css: readStylesheet(text), text });
      }
      else builder.report.dropped.push(lineOfNode(builder.markup, child));
      return { nothing: true };
    }
    if (builder.mode === 'strict') {
      builder.dropped.elements += 1;
      return { nothing: true };
    }
    // an unknown element is unwrapped: its children take its place, and the report says so
    builder.report.unwrapped.push(lineOfNode(builder.markup, child));
    const inner: DocNode[] = [];
    for (const grand of child.children) {
      const made = build(grand, builder, ancestors);
      if ('node' in made) inner.push(made.node);
      else if ('nodes' in made) inner.push(...made.nodes);
    }
    return { nodes: inner };
  }
  const element = rules.elements.get(type as ElementType);
  const line = lineOfNode(builder.markup, child);
  const kept = classList(child.attributes.get('class') ?? '');
  const proposedName = elementName(kept.names, type, rules, make);
  const generated = kept.names.at(-1) ?? '';
  const block = generated.includes('__') ? generated.split('__')[0] ?? '' : '';
  const previousBlocks = builder.nameBlocks.get(proposedName);
  const keepRepeatedName = builder.exportedSheet && block !== '' && previousBlocks !== undefined && !previousBlocks.has(block);
  const name = keepRepeatedName ? proposedName : freshName(make, proposedName);
  if (builder.exportedSheet && block !== '') {
    const blocks = previousBlocks ?? new Set<string>();
    blocks.add(block);
    builder.nameBlocks.set(proposedName, blocks);
  }
  const start: DocNode = {
    id: make.ids.next(),
    type: type as ElementType,
    name,
    tag,
    attributes: {},
    classes: kept.names,
    styles: {},
    text: null,
    children: [],
  };
  let attributes: Record<string, unknown> = {};
  let customAttributes: Record<string, string> = {};
  let inlineStyle: string | null = null;
  // a class the model cannot hold (a name it refuses, one listed twice) is left out, and the report says so
  if (kept.dropped) {
    if (builder.mode === 'import') builder.report.attributes.push(line);
    else builder.dropped.attributes += 1;
  }
  // the HTML hidden attribute is the editor's own Hide (spec hide-element): the element stays in the document and in
  // Layers, the canvas does not draw it, and the export writes it hidden again (a captured page's closed dropdown)
  let hiddenFlag = false;
  // an <svg>'s size and its drawing's coordinate system (svgSizeAttribute)
  const svgSize: SvgSize = { declarations: '', viewBox: null, aspect: null };
  const imageSize = new Map<string, string>();
  for (const [html, value] of child.attributes) {
    if (html === 'class') continue;
    if (type === SVG_TYPE && svgSizeAttribute(svgSize, html, value, rules.boxSize)) continue;
    if (child.tag === 'img' && rules.boxSize.includes(html) && /^\d+$/.test(value)) {
      imageSize.set(html, value);
      continue;
    }
    if (html === 'hidden') {
      hiddenFlag = true;
      continue;
    }
    // the inline style is read with the stylesheet's rules (the styles pass), not as an attribute
    if (html === 'style') {
      if (builder.mode === 'import') inlineStyle = value;
      else builder.dropped.attributes += 1;
      continue;
    }
    if (html.startsWith('on')) {
      if (builder.mode === 'import') builder.report.handlers.push(line);
      else builder.dropped.attributes += 1;
      continue;
    }
    const id = attributeNamed(html, type, rules);
    if (id !== null) {
      const facts = rules.attributeValues.get(id);
      const kept = facts?.valueType === 'boolean' ? true : facts?.valueType === 'number' ? Number(value) : facts?.valueType === 'url' ? (importedPath(builder, value) ?? value) : html === 'srcset' ? value.split(',').map(part => part.trim().replace(/^([^\s]+)/, address => importedPath(builder, address) ?? address)).join(', ') : value;
      if (attributeValueRefusal(id, kept, rules) !== null) {
        if (builder.mode === 'import') builder.report.attributes.push(line);
        else builder.dropped.attributes += 1;
        continue;
      }
      attributes = { ...attributes, [id]: kept };
      continue;
    }
    // the person's own attributes (aria-*, data-*, role…): kept as they are, unless the model refuses the name
    if (customAttributeRefusal(html, rules) === null) customAttributes = { ...customAttributes, [html]: value };
    else if (builder.mode === 'import') builder.report.attributes.push(line);
    else builder.dropped.attributes += 1;
  }
  const made: DocNode = {
    ...start,
    attributes: attributes as DocNode['attributes'],
    ...(Object.keys(customAttributes).length === 0 ? {} : { customAttributes }),
    ...(hiddenFlag ? { hidden: true as const } : {}),
  };
  builder.lines.set(made.id, line);
  if (inlineStyle !== null) builder.inline.set(made.id, styleDeclarations(builder, inlineStyle, line));
  if (svgSize.declarations !== '') builder.presentational.set(made.id, styleDeclarations(builder, svgSize.declarations, line));
  if (imageSize.size > 0) {
    const [widthProperty, heightProperty] = rules.boxSize;
    const width = widthProperty === undefined ? undefined : imageSize.get(widthProperty);
    const height = heightProperty === undefined ? undefined : imageSize.get(heightProperty);
    const dimensions = [
      ...(width === undefined ? [] : [`${widthProperty}: ${width}px;`]),
      ...(height === undefined ? [] : [`${heightProperty}: ${height}px;`]),
      ...(width !== undefined && height !== undefined && Number(width) > 0 && Number(height) > 0 ? [`aspect-ratio: auto ${width} / ${height};`] : []),
    ].join('');
    builder.presentational.set(made.id, styleDeclarations(builder, dimensions, line));
  }
  const content = element?.content ?? 'children';
  if (content === 'text') {
    const runs = canonical(runsOf(child.children, builder, child.tag === 'pre' || child.tag === 'textarea'));
    // the tree of marks is kept only while something is marked: a plain text carries none (validate.ts)
    return { node: { ...made, text: plainOf(runs), ...(hasMarks(runs) ? { inline: runs } : {}) } };
  }
  if (content === 'markup') return { node: { ...made, text: child.children.map((one) => (typeof one === 'string' ? one : '')).join('') } };
  // an <svg> keeps its markup: its shapes and its own content are the svg element's business (core/elements/svg.ts)
  if (type === 'svg') {
    const parsed = sanitizedSvgMarkup(nodeMarkup(child));
    if ('refusal' in parsed) return { nothing: true };
    const drawn = svgDrawing(parsed.markup, svgSize);
    return { node: { ...made, attributes: { ...attributes, ...(drawn === '' ? {} : { svgMarkup: drawn }) } as DocNode['attributes'] } };
  }
  const below = [...ancestors, tag];
  return { node: { ...made, children: buildChildren(child.children, tag, below, builder, line) } };
}

// The children of an element that holds elements (or of the page's body): each built, each placed by the content
// model, and a run of text directly inside it (with its marks, or an element the table does not know) becoming one
// Paragraph — the model has no text there, and the editor's own list items and cells hold their words in one.
function buildChildren(children: readonly MarkupChild[], parentTag: string, ancestors: readonly string[], builder: Builder, parentLine: number): DocNode[] {
  const { rules } = builder;
  const out: DocNode[] = [];
  let phrasing: MarkupChild[] = [];
  const flushPhrasing = (): void => {
    const run = phrasing;
    phrasing = [];
    if (run.length === 0) return;
    const runs = canonical(runsOf(run, builder, parentTag === 'pre' || parentTag === 'textarea'));
    const text = plainOf(runs);
    if (text.trim() === '') return;
    place(buildParagraph(text, runs, builder, parentLine), parentTag, ancestors, out, builder);
  };
  for (const grand of children) {
    if (typeof grand === 'string') {
      if (grand.trim() !== '' || parentTag === 'pre') phrasing.push(grand);
      continue;
    }
    if (holdsInline(grand, rules)) {
      phrasing.push(grand);
      continue;
    }
    flushPhrasing();
    const inner = build(grand, builder, ancestors);
    if ('node' in inner) place(inner.node, parentTag, ancestors, out, builder);
    // an unknown element unwrapped (a custom element): its children take its place (they were dropped)
    else if ('nodes' in inner) for (const one of inner.nodes) place(one, parentTag, ancestors, out, builder);
  }
  flushPhrasing();
  return out;
}

// The marks a text element's run reads itself (runsOf): a link, a bold, an italic and a line break. Only the marks
// that carry no element of their own outside a text: an <a> in a container is a Link, an element like any other.
const RUN_MARKS: ReadonlySet<string> = new Set(['br', 'strong', 'b', 'em', 'i']);

// Whether an element belongs to the run of text around it: a mark that is no element of its own, or an element the
// table does not know (a custom element) that holds no block of its own — it unwraps into the text it carries.
// Anything else (a link, an image, a span the editor writes as a Paragraph, a known block) is a node of its own, and a
// script or a style is read by its own pass.
function holdsInline(node: MarkupNode, rules: ModelRules): boolean {
  if (RUN_MARKS.has(node.tag)) return true;
  if (node.tag === 'script' || node.tag === 'style') return false;
  return typeOfTag(node.tag, rules) === null && !holdsBlock(node, rules);
}

// whether anything inside an element is a block-level element (HTML's own categories; an element the table does not
// know counts as inline unless a block is inside it)
function holdsBlock(node: MarkupNode, rules: ModelRules): boolean {
  return node.children.some((child) => typeof child !== 'string' && (rules.contentModel.phrasing(child.tag) === false || holdsBlock(child, rules)));
}

// An image or another visual child is phrasing content in HTML but cannot live in the editor's text-only Link.
// The Link Block owns children, so the image stays editable and exportable inside the anchor.
function holdsLinkedMedia(node: MarkupNode): boolean {
  return node.children.some((child) => typeof child !== 'string' && (['img', 'svg', 'video'].includes(child.tag) || holdsLinkedMedia(child)));
}

function visualOnlyChildren(children: readonly MarkupChild[]): boolean {
  return children.every((child) => typeof child === 'string' ? child.trim() === '' : ['img', 'svg', 'video'].includes(child.tag) || (['a', 'picture'].includes(child.tag) && visualOnlyChildren(child.children)));
}

// the Paragraph a run of text directly inside a container becomes: built as any text element, some of its runs marked
function buildParagraph(text: string, runs: readonly InlineRun[], builder: Builder, line: number): DocNode {
  const { rules, make } = builder;
  const element = rules.elements.get('paragraph' as ElementType);
  const node: DocNode = {
    id: make.ids.next(),
    type: 'paragraph' as ElementType,
    name: freshName(make, make.words((element?.labelKey ?? 'element.paragraph.label') as MessageId)),
    tag: element?.tags[0] ?? 'p',
    attributes: {},
    classes: [],
    styles: {},
    text,
    ...(hasMarks(runs) ? { inline: runs } : {}),
    children: [],
  };
  builder.lines.set(node.id, line);
  builder.report.repaired.push(line);
  return node;
}

// Where a built node goes among a parent's children: itself when the content model takes it; wrapped in the element
// HTML would require (a stray li gets a ul; a child a closed list refuses is wrapped in the first tag that list
// accepts) when that repairs it; dropped, and reported, when nothing can.
function place(node: DocNode, parentTag: string | null, ancestors: readonly string[], children: DocNode[], builder: Builder): void {
  const { rules, make } = builder;
  const line = builder.lines.get(node.id) ?? 1;
  const refusal = parentTag === null ? null : childrenRefusal(rules, parentTag, [node]);
  // the code pane's reader refuses the nesting instead of repairing it (its own contract: the markup is the person's,
  // and it is their business to fix it), and names the line of the piece that is wrong
  if (builder.mode === 'strict') {
    if (refusal !== null) builder.problem = { line, message: message('status.html.invalidAt', { line, reason: { key: refusal.key, params: refusal.params } }) };
    else children.push(node);
    return;
  }
  const inside = nestingRefusal(rules, ancestors, node);
  // the parent holds at most one of it and has it already
  const uniqueHeld = node.tag !== null && parentTag !== null && rules.contentModel.unique(parentTag, node.tag) && children.some((held) => held.tag === node.tag);
  if (refusal === null && inside === null && !uniqueHeld) {
    children.push(node);
    return;
  }
  // The repair: the element HTML requires around it (a stray li gets the List: the first parent the editor has an
  // element type for, in the manifest's order, so HTML's <menu> and <ol> do not win), or the first tag the parent's
  // closed list accepts (that list's own order).
  const required = refusal !== null ? rules.contentModel.parentsOf(node.tag ?? '') : null;
  const accepted = parentTag === null ? null : rules.contentModel.refusal(parentTag, node.tag ?? '');
  const wrapperTag = (required === null ? null : firstWrapper(required, rules)) ?? accepted?.find((tag) => typeOfTag(tag, rules) !== null) ?? null;
  const wrapperType = wrapperTag === null ? null : typeOfTag(wrapperTag, rules);
  if (wrapperTag !== null && wrapperType !== null && childrenRefusal(rules, wrapperTag, [node]) === null) {
    const labelKey = rules.elements.get(wrapperType as ElementType)?.labelKey ?? 'element.container.label';
    const wrapper: DocNode = {
      id: make.ids.next(),
      type: wrapperType as ElementType,
      name: freshName(make, make.words(labelKey as MessageId)),
      tag: wrapperTag,
      attributes: {},
      classes: [],
      styles: {},
      text: null,
      children: [node],
    };
    if (nestingRefusal(rules, ancestors, wrapper) === null) {
      children.push(wrapper);
      builder.report.repaired.push(line);
      return;
    }
  }
  builder.report.dropped.push(line);
}

// the first of these tags the editor has an element type for, in the manifest's order (a stray li: the List, not the
// Ordered list)
function firstWrapper(tags: readonly string[], rules: ModelRules): string | null {
  for (const [, element] of rules.elements) {
    const tag = element.tags.find((one): one is string => one !== null && tags.includes(one));
    if (tag !== undefined) return tag;
  }
  return null;
}

// the markup of an element as the source holds it, the way the parser kept it (an <svg>'s own content)
function nodeMarkup(node: MarkupNode): string {
  const attributes = [...node.attributes].map(([name, value]) => ` ${name}="${value.replaceAll('"', '&quot;')}"`).join('');
  const inner = node.children.map((child) => (typeof child === 'string' ? child.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') : nodeMarkup(child))).join('');
  return `<${node.tag}${attributes}>${inner}</${node.tag}>`;
}

// ---------------------------------------------------------------- the styles

// The declared values one declaration's text stands for: the pairs "property: value" (a composite expanded into its
// longhands, a shadow read into its layers), or nothing when the editor does not store it, reported with its line.
function storedDeclarations(builder: Builder, text: string, line: number, file: string): readonly (readonly [string, StoredValue])[] {
  text = followCssUrls(text, path => importedPath(builder, path, file) ?? path);
  const colon = text.indexOf(':');
  const property = colon <= 0 ? '' : text.slice(0, colon).trim().toLowerCase();
  if (property === '') {
    add(builder.report.declarations, file, line);
    return [];
  }
  const fields = builder.rules.structures.get(property);
  if (fields !== undefined) {
    const layers = shadowLayersFromCss(text.slice(colon + 1), fields);
    if (layers === null) {
      add(builder.report.declarations, file, line);
      return [];
    }
    return [[property, layers]];
  }
  const parsed = parseDeclarations(`${property}: ${text.slice(colon + 1).trim()};`, builder.context);
  if ('refused' in parsed) {
    add(builder.report.declarations, file, line);
    return [];
  }
  return [...parsed.declarations].map(([name, value]) => [name, value] as const);
}

// A captured width condition that the project's breakpoint model cannot express keeps its declarations in the
// original sheet. Keep the same properties in that sheet at every width, or a later generated base rule would beat
// the conditional rule. Parsed longhands cover shorthand declarations as well.
function storedProperties(text: string, context: HandlerContext<never>, rules: ModelRules): readonly string[] {
  const colon = text.indexOf(':');
  const property = colon <= 0 ? '' : text.slice(0, colon).trim().toLowerCase();
  if (property === '' || property.startsWith('--')) return [];
  if (rules.structures.has(property)) return storesDeclaration(context, rules, text) ? [property] : [];
  const parsed = parseDeclarations(`${property}: ${text.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim()};`, context);
  return 'refused' in parsed ? [] : [...parsed.declarations].map(([name]) => name);
}

function capturedWidthProperties(sources: readonly SheetSource[], context: HandlerContext<never>, rules: ModelRules): ReadonlySet<string> {
  const properties = new Set<string>();
  for (const source of sources) for (const rule of source.css.rules) {
    if (!rule.media.some((condition) => /\b(?:min-width|max-width)\b|\bwidth\s*[<>]=?\s*[\d.]+(?:px|rem|em)\b|\b[\d.]+(?:px|rem|em)\s*[<>]=?\s*width\b/i.test(condition))) continue;
    if (!mediaPlace(rule.media, rules).unmappable) continue;
    for (const declaration of rule.declarations) for (const property of storedProperties(declaration.text, context, rules)) properties.add(property);
  }
  return properties;
}

// the declarations of a style attribute, with the line they are on
function styleDeclarations(builder: Builder, text: string, line: number): readonly (readonly [string, StoredValue])[] {
  return readDeclarations(text, line, text).flatMap((declaration) => storedDeclarations(builder, declaration.text, declaration.line, builder.file));
}

interface Candidate {
  readonly value: StoredValue;
  readonly rank: readonly number[];
  readonly author?: boolean;
}

const higher = (a: readonly number[], b: readonly number[]): boolean => {
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const left = a[at] ?? 0;
    const right = b[at] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
};

// The layer a rule's media conditions name: the breakpoint it becomes an override of (null for no condition), the
// nearest breakpoint at or below a width that is no breakpoint's own (reported), or one no breakpoint can take.
function mediaPlace(conditions: readonly string[], rules: ModelRules): { readonly breakpoint: string | null; readonly unmappable: boolean; readonly approximated: boolean } {
  if (conditions.length === 0) return { breakpoint: null, unmappable: false, approximated: false };
  // a rule inside two media queries at once is no breakpoint (the reader reports the inner one as an at-rule already)
  if (conditions.length > 1) return { breakpoint: null, unmappable: true, approximated: false };
  const condition = (conditions[0] ?? '').trim().toLowerCase().replace(/^(only\s+)?(screen|all)\s*(and\s*)?/, '').trim();
  if (condition === '') return { breakpoint: null, unmappable: false, approximated: false };
  const width = /^\(?\s*max-width\s*:\s*([\d.]+)px\s*\)?$/.exec(condition);
  if (width === null) return { breakpoint: null, unmappable: true, approximated: false };
  const px = Number(width[1]);
  const widths = [...rules.breakpoints].flatMap((id) => {
    const held = rules.breakpointWidths.get(id);
    return held === undefined ? [] : [{ id, width: held }];
  });
  const exact = widths.find((one) => one.width === px);
  if (exact !== undefined) return { breakpoint: exact.id, unmappable: false, approximated: false };
  const below = widths.filter((one) => one.width <= px).sort((a, b) => b.width - a.width)[0];
  return below === undefined ? { breakpoint: null, unmappable: true, approximated: false } : { breakpoint: below.id, unmappable: false, approximated: true };
}

interface SheetSource {
  readonly file: string;
  readonly css: CssSheet;
  // the sheet as written (a captured page keeps what the model does not hold: residualCss)
  readonly text: string;
}

// One rule of a stylesheet the importer can map, with the layer (breakpoint and state) and the rank (specificity and
// order) CSS gives it.
interface Ready {
  readonly rule: CssRule;
  readonly source: string;
  readonly media: { readonly breakpoint: string | null };
  readonly state: string;
  readonly bare: Selector;
  readonly classRule: string | null;
  readonly order: number;
}

interface ReadyRules {
  readonly ready: readonly Ready[];
  // the class names the sheets name: the last class of an element that one of them names is its own rule's
  readonly classNames: ReadonlySet<string>;
  // the last rule's order (the style attribute ranks after it)
  readonly order: number;
}

// One pass over every source: the rules the importer cannot map are reported here (once each, with their line) and
// the rest are kept with the layer (breakpoint and state) and the rank (specificity and order) CSS gives them.
function readyRules(builder: Builder, sources: readonly SheetSource[]): ReadyRules {
  const { rules } = builder;
  const ready: Ready[] = [];
  // the class names the sheets name: the last class of an element that one of them names is its own rule's
  const classNames = new Set<string>();
  let order = 0;
  for (const source of sources) {
    // the at-rules the importer cannot map (@supports, @font-face, a nested @media): reported with their lines
    // (an @keyframes block is read back as an element's animation: keyframesIn)
    for (const at of source.css.atRules) if (!/^keyframes\b/i.test(at.name.trim())) add(builder.report.unmapped, source.file, at.line);
    for (const rule of source.css.rules) {
      order += 1;
      // The exported base is already in force. Match its entire selector and declaration list: an author's rule
      // may reuse a value such as margin: 0 on another selector and still needs to be imported.
      if (isBaseRule(rule)) continue;
      // the project's variables: rootTokens reads them
      if (isRootTokenRule(rule)) continue;
      const media = mediaPlace(rule.media, rules);
      if (media.unmappable) {
        add(builder.report.unmapped, source.file, rule.line);
        continue;
      }
      if (media.approximated) add(builder.report.approximated, source.file, rule.line);
      const selector = readSelector(rule.selector);
      // a pseudo-class on an ancestor (nav a:hover > span) is no state of the element the rule styles: the matcher
      // reads only the compounds' names, so the rule would hold always; it is reported, never guessed
      if (selector === null || innerPseudo(selector)) {
        add(builder.report.unmapped, source.file, rule.line);
        continue;
      }
      const last = selector.compounds[selector.compounds.length - 1] as Compound;
      const classRule = classRuleOf(selector);
      let state = rules.baseLayer.state;
      if (last.pseudo !== null) {
        const named = rules.statePseudos.get(last.pseudo);
        // a pseudo-class that is no state of the editor, or a state rule whose selector names more than the element
        // (a descendant rule): the rule is reported, never guessed
        if (named === undefined || (selector.compounds.length > 1 && classRule === null)) {
          add(builder.report.unmapped, source.file, rule.line);
          continue;
        }
        state = named;
      }
      if (classRule !== null) {
        // a class name the project's own registry cannot hold is nothing this importer can map
        if (!validClassName(classRule)) {
          add(builder.report.unmapped, source.file, rule.line);
          continue;
        }
        classNames.add(classRule);
      }
      const bare: Selector = last.pseudo === null ? selector : { ...selector, compounds: [...selector.compounds.slice(0, -1), { ...last, pseudo: null }] };
      ready.push({ rule, source: source.file, media, state, bare, classRule, order });
    }
  }
  return { ready, classNames, order };
}

// A property's winning declarations in one layer of an element (a breakpoint and a state).
interface Layer {
  readonly breakpoint: string;
  readonly state: string;
  readonly own: Map<string, Candidate>;
}

type Animated = Map<string, Map<string, { readonly value: string; readonly rank: readonly number[] }>>;

// The elements: the winner of each property, in each layer (a breakpoint and a state), by importance, inline,
// specificity and order — the cascade the browser runs, a rule of one breakpoint never beating one of another. The
// class of the element's own rule (the last of its classes the sheet names) reads as a value of the element's own,
// and that class does not stand among its classes: the export makes it again from the name.
interface Cascaded {
  // each element's winning declarations, by layer
  readonly winners: ReadonlyMap<string, ReadonlyMap<string, Layer>>;
  // the classes each element keeps (its own rule's class left the list)
  readonly kept: ReadonlyMap<string, readonly string[]>;
  // the animation properties each element's rules give it at the base layer
  readonly animated: Animated;
}

function cascade(tree: DocNode, builder: Builder, { ready, classNames, order }: ReadyRules, authors: ReadonlySet<string>, deferred: ReadonlySet<string>): Cascaded {
  const { rules } = builder;
  const winners = new Map<string, Map<string, Layer>>();
  const kept = new Map<string, readonly string[]>();
  // the animation properties each element's rules give it at the base layer (AN2: read back as its animations)
  const animated: Animated = new Map();
  const walk = (node: DocNode, ancestors: readonly Facts[]): void => {
    // the last of the element's classes a rule of the sheet is written for: the export's own class, which does not
    // stand among the element's (the export makes it again from the name); the others the element keeps as its own
    let at = node.classes.length - 1;
    while (at >= 0 && (!classNames.has(node.classes[at] as string) || authors.has(node.classes[at] as string))) at -= 1;
    const generated = at < 0 ? null : (node.classes[at] as string);
    const classes = node.classes.filter((_one, i) => i !== at);
    kept.set(node.id, classes);
    const facts: Facts = {
      tag: node.tag,
      // every class the markup gave it, the export's own among them: a descendant rule (.card p) names it whether the
      // element keeps it or its rule becomes the element's own styles
      classes: node.classes,
      id: typeof node.attributes.id === 'string' ? node.attributes.id : null,
      attributes: cssAttributes(node, rules),
    };
    const layers = new Map<string, Layer>();
    const layerOf = (breakpoint: string, state: string): Layer => {
      const key = `${breakpoint}\u0000${state}`;
      let held = layers.get(key);
      if (held === undefined) {
        held = { breakpoint, state, own: new Map() };
        layers.set(key, held);
      }
      return held;
    };
    for (const one of ready) {
      // Author classes keep their definitions, but their declarations still compete in the cascade. A winning
      // author declaration must not be written again as the element's own rule after the class in the export.
      const author = one.classRule !== null && authors.has(one.classRule);
      // the rule of the class the element's own rule is written with applies to the element (the class left its class
      // list); every other rule applies where the matcher says it does
      const ownRule = one.classRule !== null && one.classRule === generated;
      if (!ownRule && !matches(one.bare, facts, ancestors)) continue;
      // a state the element's type does not take (:visited on a block that is a link) is no layer of it: the rule is
      // reported, never written where the document cannot hold it
      const takes = rules.stateElements.get(one.state);
      if (one.state !== rules.baseLayer.state && takes !== undefined && takes !== null && !takes.includes(node.type)) {
        add(builder.report.unmapped, one.source, one.rule.line);
        continue;
      }
      const layer = layerOf(one.media.breakpoint ?? rules.baseLayer.breakpoint, one.state);
      for (const declaration of one.rule.declarations) {
        const colon = declaration.text.indexOf(':');
        const named = colon < 0 ? '' : declaration.text.slice(0, colon).trim().toLowerCase();
        if (named.startsWith('animation-') && one.media.breakpoint === null && one.state === rules.baseLayer.state) {
          const rank = [declaration.important ? 1 : 0, 0, one.bare.specificity[0], one.bare.specificity[1], one.bare.specificity[2], one.order];
          const held = animated.get(node.id) ?? new Map<string, { readonly value: string; readonly rank: readonly number[] }>();
          animated.set(node.id, held);
          const was = held.get(named);
          if (was === undefined || higher(rank, was.rank)) held.set(named, { value: declaration.text.slice(colon + 1).trim(), rank });
          continue;
        }
        for (const [property, value] of storedDeclarations(builder, declaration.text, declaration.line, one.source)) {
          if (deferred.has(property)) continue;
          // importance, the style attribute, then ids, classes and types, each counted apart (as CSS ranks them: one
          // class outweighs any number of types), then source order
          const rank = [declaration.important ? 1 : 0, 0, one.bare.specificity[0], one.bare.specificity[1], one.bare.specificity[2], one.order];
          const held = layer.own.get(property);
          if (held === undefined || higher(rank, held.rank)) layer.own.set(property, { value, rank, author });
        }
      }
    }
    // the element's own style attribute: above any selector, below an !important declaration (as CSS has it)
    const base = layerOf(rules.baseLayer.breakpoint, rules.baseLayer.state);
    for (const [property, value] of builder.inline.get(node.id) ?? []) {
      const rank = [0, 1, 0, 0, 0, order + 1];
      const held = base.own.get(property);
      if (held === undefined || higher(rank, held.rank)) base.own.set(property, { value, rank });
    }
    // an <svg>'s width and height attributes: below every rule of the sheets, which all rank above them
    for (const [property, value] of builder.presentational.get(node.id) ?? []) if (!base.own.has(property) && !deferred.has(property)) base.own.set(property, { value, rank: [0, 0, 0, 0, 0, 0] });
    const own = new Map<string, Layer>();
    for (const [key, layer] of layers) if (layer.own.size > 0) own.set(key, layer);
    if (own.size > 0) winners.set(node.id, own);
    for (const child of node.children) walk(child, [facts, ...ancestors]);
  };
  walk(tree, []);
  return { winners, kept, animated };
}

// the definitions of the person's own classes: each class's rules, by breakpoint and state, the later or !important
// declaration winning as CSS has it (the audit's B-04: they were copied onto every element and the class was lost)
function classDefinitions(builder: Builder, ready: readonly Ready[], authors: ReadonlySet<string>, deferred: ReadonlySet<string>): ReadonlyMap<string, Styles> {
  const { rules } = builder;
  const definitions = new Map<string, Styles>();
  const ranked = new Map<string, Map<string, Map<string, Candidate>>>();
  for (const one of ready) {
    if (one.classRule === null || !authors.has(one.classRule)) continue;
    const layerKey = `${one.media.breakpoint ?? rules.baseLayer.breakpoint}\u0000${one.state}`;
    const byLayer = ranked.get(one.classRule) ?? new Map<string, Map<string, Candidate>>();
    ranked.set(one.classRule, byLayer);
    const own = byLayer.get(layerKey) ?? new Map<string, Candidate>();
    byLayer.set(layerKey, own);
    for (const declaration of one.rule.declarations) {
      for (const [property, value] of storedDeclarations(builder, declaration.text, declaration.line, one.source)) {
        if (deferred.has(property)) continue;
        const rank = [declaration.important ? 1 : 0, 0, 0, 0, 0, one.order];
        const held = own.get(property);
        if (held === undefined || higher(rank, held.rank)) own.set(property, { value, rank });
      }
    }
  }
  for (const [name, byLayer] of ranked) {
    const styles: Record<string, Record<string, Record<string, StoredValue>>> = {};
    for (const [layerKey, own] of byLayer) {
      const [breakpoint = '', state = ''] = layerKey.split('\u0000');
      const declarations = ((styles[breakpoint] ??= {})[state] ??= {});
      for (const [property, candidate] of own) declarations[property] = candidate.value;
    }
    definitions.set(name, styles as Styles);
  }
  return definitions;
}

// The winners written on the elements: their styles by breakpoint and state, the classes they keep, and the
// animations their animation properties and the sheets' @keyframes make.
function writeStyles(tree: DocNode, builder: Builder, sources: readonly SheetSource[], { winners, kept, animated }: Cascaded): void {
  const frames = keyframesIn(builder, sources);
  const write = (node: DocNode): void => {
    const playing = animated.get(node.id);
    if (playing !== undefined) {
      const animations = animationsFrom(new Map([...playing].map(([property, one]) => [property, one.value])), frames);
      if (animations.length > 0) (node as { animations?: readonly Animation[] }).animations = animations;
    }
    const own = winners.get(node.id);
    if (own !== undefined) {
      const styles: Record<string, Record<string, Record<string, StoredValue>>> = {};
      for (const layer of own.values()) {
        const written = [...layer.own].filter(([, candidate]) => !candidate.author);
        if (written.length === 0) continue;
        const byState = (styles[layer.breakpoint] ??= {});
        const declarations = (byState[layer.state] ??= {});
        for (const [property, candidate] of written) declarations[property] = candidate.value;
      }
      (node as { styles: Styles }).styles = styles as Styles;
    }
    const classes = kept.get(node.id);
    if (classes !== undefined && classes.length !== node.classes.length) (node as { classes: readonly string[] }).classes = classes;
    for (const child of node.children) write(child);
  };
  write(tree);
}

// The declarations a stylesheet gives the nodes of a page: each rule read by the matcher, its declarations read by the
// one readers of a declarations text, and the winners by importance, inline, specificity and order — the cascade the
// browser runs. A rule that cannot be mapped (a media query no breakpoint takes, a selector this importer does not
// read, a pseudo-class that is no state, a descendant state rule) is reported and left alone.
//
// A rule whose selector is one class name alone (`.card`, `.card:hover`, `.card` inside a @media) is the class's own:
// it becomes a definition of the project's style classes (core/design/classes.ts), not a value written on each element
// that lists it — that is what a class is for, and it is what makes an exported page import back as it was.
// `authors`: the classes of the person's own (authorClasses): their rules are the project's class definitions, never
// values of the elements that list them; `definitions`, when given empty, receives those definitions (one pass).
function applyStyles(tree: DocNode, builder: Builder, sources: readonly SheetSource[], authors: ReadonlySet<string> = new Set(), definitions: Map<string, Styles> | null = null, deferred: ReadonlySet<string> = new Set()): void {
  const ready = readyRules(builder, sources);
  const cascaded = cascade(tree, builder, ready, authors, deferred);
  if (definitions !== null && definitions.size === 0) for (const [name, styles] of classDefinitions(builder, ready.ready, authors, deferred)) definitions.set(name, styles);
  writeStyles(tree, builder, sources, cascaded);
}

// An element's animations read back from its animation properties and the sheets' @keyframes (AN2: the export writes
// both, core/export/export.ts animationListDeclarations and keyframesCss, and the import dropped them): one animation
// per name of animation-name's list, each setting the item of its property's list at the same place (a shorter list
// repeats, as CSS has it), its keyframes the @keyframes of that name (none: the start and the end, empty).
const listItems = (value: string): readonly string[] => {
  const items: string[] = [];
  let depth = 0;
  let piece = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      items.push(piece.trim());
      piece = '';
      continue;
    }
    piece += char;
  }
  items.push(piece.trim());
  return items.filter((item) => item !== '');
};
function animationsFrom(properties: ReadonlyMap<string, string>, frames: ReadonlyMap<string, readonly Keyframe[]>): readonly Animation[] {
  const names = listItems(properties.get('animation-name') ?? '').filter((name) => name !== 'none');
  return names.map((name, i) => {
    const settings: Record<string, string> = {};
    for (const setting of ANIMATION_SETTINGS) {
      const property = settingProperty(setting);
      const items = property === null ? [] : listItems(properties.get(property) ?? '');
      settings[setting] = items.length === 0 ? defaultSetting(setting) : (items[i % items.length] as string);
    }
    const keyframes = frames.get(name) ?? [
      { offset: 0, easing: '', declarations: {} },
      { offset: 100, easing: '', declarations: {} },
    ];
    return { name, settings, keyframes };
  });
}
// the @keyframes blocks of the sheets, by name: each step's offset (from 0, to 100, a percentage) and its declarations
// read as a style layer's (storedDeclarations), the timing function written in a step its easing
// the property a keyframe's easing is written with (the timeline's easing field offers it)
const KEYFRAME_EASING = keyframeEasingProperty();
function keyframesIn(builder: Builder, sources: readonly SheetSource[]): ReadonlyMap<string, readonly Keyframe[]> {
  const found = new Map<string, readonly Keyframe[]>();
  for (const source of sources) {
    let ast: CssTreeNode;
    try {
      ast = parseCssTree(source.text, { positions: true });
    } catch {
      continue;
    }
    walkCssTree(ast, (node) => {
      if (node.type !== 'Atrule' || node.name.toLowerCase() !== 'keyframes' || node.prelude === null || node.block === null) return;
      const name = generateCssTree(node.prelude).trim();
      const steps: Keyframe[] = [];
      for (const rule of node.block.children.toArray()) {
        if (rule.type !== 'Rule') continue;
        const offsets = generateCssTree(rule.prelude)
          .split(',')
          .map((one) => one.trim().toLowerCase())
          .map((one) => (one === 'from' ? 0 : one === 'to' ? 100 : Number.parseFloat(one)));
        let easing = '';
        const declarations: Record<string, StoredValue> = {};
        for (const declaration of rule.block.children.toArray()) {
          if (declaration.type !== 'Declaration') continue;
          if (declaration.property.toLowerCase() === KEYFRAME_EASING) {
            easing = generateCssTree(declaration.value).trim();
            continue;
          }
          const line = declaration.loc?.start.line ?? 0;
          for (const [property, value] of storedDeclarations(builder, generateCssTree(declaration), line, source.file)) declarations[property] = value;
        }
        for (const offset of offsets) if (Number.isFinite(offset)) steps.push({ offset, easing, declarations: { ...declarations } });
      }
      found.set(name, steps.sort((a, b) => a.offset - b.offset));
    });
  }
  return found;
}

// A base rule exported by this editor, identified by selector and all its declarations rather than by values alone.
// The stylesheet reader splits a selector list into rules, so this comparison also handles the grouped :where rules.
const normalizedBaseText = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();
const BASE_RULES = readStylesheet(baseCss()).rules;
function isBaseRule(rule: CssRule): boolean {
  if (rule.media.length > 0 || rule.declarations.some((declaration) => declaration.important)) return false;
  const selector = normalizedBaseText(rule.selector);
  const declarations = rule.declarations.map((declaration) => normalizedBaseText(declaration.text)).sort();
  return BASE_RULES.some((base) => {
    if (normalizedBaseText(base.selector) !== selector || base.declarations.length !== declarations.length) return false;
    const expected = base.declarations.map((declaration) => normalizedBaseText(declaration.text)).sort();
    return expected.every((value, index) => value === declarations[index]);
  });
}

// the class name a selector is the rule of (`.card`, `.card:hover`), or null when it is no single class
// The classes of the person's own among the ones a stylesheet has a rule of its own for (`.card`): a class listed by
// two elements or more, or not the last of an element's classes. The class the export makes for an element's own
// styles is the element's alone and the last of its list ("hero", "card__title", "card--featured"); a class of the
// person's is shared and comes first. Their rules become the project's class definitions, not element values. A class
// whose rule sits under the classes heading of this editor's own export (core/export/sheet-headings.ts) is the
// person's whatever its uses: one element alone may list a class of the person's last ("card card--featured").
function authorClasses(pages: readonly Page[], sources: readonly SheetSource[]): ReadonlySet<string> {
  const ruled = new Set<string>();
  const headed = new Set<string>();
  for (const source of sources) {
    const underHeading = underClassesHeading(source.text);
    for (const rule of source.css.rules) {
      const selector = readSelector(rule.selector);
      const name = selector === null ? null : classRuleOf(selector);
      if (name === null || !validClassName(name)) continue;
      ruled.add(name);
      if (underHeading(rule.line)) headed.add(name);
    }
  }
  const uses = new Map<string, number>();
  const notLast = new Set<string>();
  for (const page of pages) {
    for (const node of walkNodes(page.tree)) {
      node.classes.forEach((name, i) => {
        uses.set(name, (uses.get(name) ?? 0) + 1);
        if (i < node.classes.length - 1) notLast.add(name);
      });
    }
  }
  // a class no element lists is the person's too (the export never writes a class for nobody): a variant kept for
  // later, a class the person made and has not used yet (the audit's AUD-05: they were dropped without a word)
  return new Set([...ruled].filter((name) => headed.has(name) || (uses.get(name) ?? 0) === 0 || (uses.get(name) ?? 0) >= 2 || notLast.has(name)));
}

// the classes a stylesheet defines that no element of the pages lists
function unusedClasses(pages: readonly Page[], authors: ReadonlySet<string>): readonly string[] {
  const listed = new Set(pages.flatMap((page) => [...walkNodes(page.tree)].flatMap((node) => node.classes)));
  return [...authors].filter((name) => !listed.has(name));
}

// The design tokens a stylesheet declares (the audit's AUD-05: the export writes the project's variables as one :root
// rule, and the import dropped it as "rules not mapped", so every var(--name) lost its definition). A :root rule of
// custom properties alone, outside any @media, holds them; each becomes a variable of the project, its kind read from
// the kinds whose property reads its value, the one whose property is where the sheets use it winning (a length used
// only in font sizes is a font size), else the first in the manifest's order (a colour, a length). A value of no kind
// the project's variables have is reported with its line, never guessed.
const ROOT = ':root';
export function isRootTokenRule(rule: CssRule): boolean {
  return rule.media.length === 0 && rule.selector.trim() === ROOT && rule.declarations.length > 0 && rule.declarations.every((declaration) => declaration.text.trim().startsWith('--'));
}

// The variables a sheet defines inside an at-rule (@supports, @media, @layer): defined again under a condition.
function conditionalVariables(sources: readonly SheetSource[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const source of sources) {
    let ast: CssTreeNode;
    try {
      ast = parseCssTree(source.text, { parseValue: false, parseCustomProperty: false });
    } catch {
      continue;
    }
    walkCssTree(ast, {
      visit: 'Declaration',
      enter(node) {
        if (this.atrule !== null && node.property.startsWith('--')) out.add(node.property.slice(2));
      },
    });
  }
  return out;
}

// `captured`: on a captured page a variable its sheets define again under a condition (MDN's colours: a value, then a
// light-dark() one inside @supports) is no token: the project's stylesheet comes after the residual one (capture-styles
// .ts), so its first value would win over the condition; it stays in the residual stylesheet, in the site's order.
function rootTokens<Ui>(context: HandlerContext<Ui>, sources: readonly SheetSource[], report: Report, captured = false): Token[] {
  const conditional = captured ? conditionalVariables(sources) : new Set<string>();
  const declared = new Map<string, { readonly value: string; readonly file: string; readonly line: number }>();
  const usedIn = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const rule of source.css.rules) {
      for (const declaration of rule.declarations) {
        const colon = declaration.text.indexOf(':');
        if (colon < 0) continue;
        const property = declaration.text.slice(0, colon).trim();
        const value = declaration.text.slice(colon + 1).trim().replace(/\s*!important$/i, '');
        if (isRootTokenRule(rule)) declared.set(property.slice(2), { value, file: source.file, line: declaration.line });
        else for (const match of value.matchAll(/var\(\s*--([A-Za-z0-9_-]+)/g)) usedIn.set(match[1] as string, (usedIn.get(match[1] as string) ?? new Set()).add(property));
      }
    }
  }
  const reads = (kind: string, value: string): boolean => {
    const probe = probeOf(context, kind);
    return probe !== null && readValue(context, probe, value) !== null;
  };
  const tokens: Token[] = [];
  for (const [name, { value, file, line }] of declared) {
    if (conditional.has(name)) continue;
    // the kinds whose property reads the value, in their manifest order; the one whose property is the only one the
    // sheets use the variable in wins (a length used only in font sizes is a font size), else the first
    const readers = TOKEN_KINDS.filter((kind) => reads(kind, value));
    const uses = usedIn.get(name);
    const exact = uses === undefined ? undefined : readers.find((kind) => [...uses].every((property) => property === probeOf(context, kind)));
    const kind = exact ?? readers[0] ?? null;
    if (kind === null) add(report.unmapped, file, line);
    else tokens.push({ name, kind, value });
  }
  return tokens;
}

// whether a compound before the last carries a pseudo-class (a state of an ancestor)
const innerPseudo = (selector: Selector): boolean => selector.compounds.slice(0, -1).some((compound) => compound.pseudo !== null);

function classRuleOf(selector: Selector): string | null {
  if (selector.compounds.length !== 1) return null;
  const only = selector.compounds[0] as Compound;
  return only.tag === null && !only.universal && only.id === null && only.attributes.length === 0 && only.classes.length === 1 ? (only.classes[0] as string) : null;
}

// the CSS facts of a node: its attributes under their HTML names (an id and a class list included) and the person's own
function cssAttributes(node: DocNode, rules: ModelRules): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [id, value] of Object.entries(node.attributes)) {
    const name = rules.attributeValues.get(id)?.html;
    if (name === null || name === undefined || typeof value === 'boolean') continue;
    out.set(name, String(value));
  }
  for (const [name, value] of Object.entries(node.customAttributes ?? {})) out.set(name, value);
  return out;
}

// The strict reader (element.applyHtml, the code pane's markup): the markup read as nodes, or the line and the reason
// of the first piece the model refuses (a nesting the content model forbids), as the code pane's contract has it.
export function nodesFromMarkup(markup: string, make: NodeMaker, context: HandlerContext<never>): Imported | ImportProblem {
  const builder = newBuilder(make, context, markup, [], '(markup)', 'strict');
  const nodes: DocNode[] = [];
  for (const child of parseMarkup(markup)) {
    const made = build(child, builder, []);
    if (builder.problem !== null) return builder.problem;
    if ('node' in made) place(made.node, null, [], nodes, builder);
    else if ('nodes' in made) for (const one of made.nodes) place(one, null, [], nodes, builder);
    if (builder.problem !== null) return builder.problem;
  }
  return { nodes, dropped: builder.dropped };
}

// One builder per page (or per markup the code pane reads)
function newBuilder(make: NodeMaker, context: HandlerContext<never>, markup: string, picked: readonly PickedFile[], file: string, mode: 'import' | 'strict', report: Report = emptyReport(), held: ProjectFile[] = [], nameBlocks: Map<string, Set<string>> = new Map()): Builder {
  return {
    make,
    rules: make.rules,
    context,
    markup,
    picked,
    file,
    pageFile: baseName(file),
    report,
    scripts: [],
    sheets: [],
    held,
    inline: new Map(),
    presentational: new Map(),
    lines: new Map(),
    nameBlocks,
    exportedSheet: false,
    mode,
    dropped: { elements: 0, attributes: 0 },
    problem: null,
    // a page keeps its scripts; a fragment the person pasted has no page to keep them with
    keepScripts: mode === 'import' && file !== '',
  };
}

// ---------------------------------------------------------------- one page

// One page's markup as a page of the document: its root element named as every page's root is, the head's settings, its
// scripts and its stylesheets, and the nodes its body holds.
function pageFrom(file: PickedFile, builder: Builder): Page {
  const { rules, ids, words } = builder.make;
  const parsed = parsePage(builder.markup);
  const rootElement = rules.elements.get(rules.root.type as ElementType);
  const body: DocNode = {
    id: ids.next(),
    type: rules.root.type as ElementType,
    name: freshName(builder.make, words((rootElement?.labelKey ?? 'element.page.label') as MessageId)),
    tag: rootElement?.tags[0] ?? 'body',
    attributes: {},
    classes: [],
    styles: {},
    text: null,
    children: [],
  };
  builder.lines.set(body.id, lineOf(builder.markup, '<body'));
  // the head first: the stylesheets it links and the settings it holds come before the body's own (a <style> block in
  // the body is later in the document, and later rules win)
  const settings: [string, string][] = [];
  const lang = (parsed.htmlAttributes.get('lang') ?? '').trim();
  const dir = (parsed.htmlAttributes.get('dir') ?? '').trim().toLowerCase();
  // a page's language that is the project's own is no setting of the page (the export writes the project's on every
  // page: re-importing it keeps the page as it was; spec export-clean)
  if (lang !== '' && lang !== (builder.context.state.document.language ?? 'en')) settings.push(['pageLanguage', lang]);
  if (['ltr', 'rtl', 'auto'].includes(dir)) settings.push(['pageDirection', dir]);
  for (const node of parsed.head) {
    if (node.tag === 'script') {
      keepScript(node, builder);
      continue;
    }
    if (node.tag === 'meta') {
      const name = (node.attributes.get('name') ?? '').trim().toLowerCase();
      const property = (node.attributes.get('property') ?? '').trim().toLowerCase();
      const content = (node.attributes.get('content') ?? '').trim();
      if (content === '') continue;
      if (name === 'description') settings.push(['pageDescription', content]);
      if (property === 'og:title') settings.push(['pageOgTitle', content]);
      if (property === 'og:image') settings.push(['pageOgImage', content]);
      continue;
    }
    if (node.tag === 'link') {
      const rel = (node.attributes.get('rel') ?? '').trim().toLowerCase();
      const originalHref = (node.attributes.get('href') ?? '').trim();
      const href = importedPath(builder, originalHref) ?? originalHref;
      if (href === '') continue;
      if (rel.split(/\s+/).includes('stylesheet')) {
        const sheet = builder.picked.find((one) => !isHtmlFile(one.name) && (one.name === href || one.name.endsWith(`/${href}`) || one.name === href.replace(/^\.?\//, '')));
        if (sheet === undefined) builder.report.sheetsMissing.push(href);
        else { const text = textOfFile(sheet);
          builder.sheets.push({ file: sheet.name, css: readStylesheet(text), text });
        }
        continue;
      }
      if (rel === 'canonical') settings.push(['pageCanonical', href]);
      else if (rel.split(/\s+/).includes('icon')) settings.push(['pageFavicon', href]);
      continue;
    }
    if (node.tag === 'style') {
      const text = textOf(node);
      builder.sheets.push({ file: builder.file, css: readStylesheet(text), text });
    }
  }
  builder.exportedSheet = builder.sheets.some((sheet) => sheet.text.split('\n').some((line) => line.trim() === ELEMENTS_HEADING));
  const children = buildChildren(parsed.body, 'body', ['body'], builder, lineOf(builder.markup, '<body'));
  // the body's own attributes: its classes, its inline style and the person's own attributes
  let attributes: Record<string, unknown> = {};
  let customAttributes: Record<string, string> = {};
  let classes: readonly string[] = [];
  let inlineStyle: string | null = null;
  for (const [html, value] of parsed.bodyAttributes) {
    if (html === 'class') {
      const held = classList(value);
      classes = held.names;
      if (held.dropped) builder.report.attributes.push(lineOf(builder.markup, '<body'));
      continue;
    }
    if (html === 'style') {
      inlineStyle = value;
      continue;
    }
    if (html.startsWith('on')) {
      builder.report.handlers.push(lineOf(builder.markup, '<body'));
      continue;
    }
    const id = attributeNamed(html, rules.root.type, rules);
    if (id !== null && attributeValueRefusal(id, value, rules) === null) {
      attributes = { ...attributes, [id]: value };
      continue;
    }
    if (customAttributeRefusal(html, rules) === null) customAttributes = { ...customAttributes, [html]: value };
    else builder.report.attributes.push(lineOf(builder.markup, '<body'));
  }
  if (inlineStyle !== null) builder.inline.set(body.id, styleDeclarations(builder, inlineStyle, lineOf(builder.markup, '<body')));
  for (const [setting, value] of settings) {
    const facts = rules.attributeValues.get(setting);
    if (facts === undefined) continue;
    const kept = settingValue(facts.valueType, facts.valueType === 'url' ? (importedPath(builder, value) ?? value) : value, rules, setting);
    if (kept !== null) attributes[setting] = kept;
  }
  // the scripts the page keeps, in order, as the export writes them back one <script src> each
  if (builder.scripts.length > 0) attributes.pageScripts = builder.scripts.map((script) => script.path).join(' ');
  const title = parsed.title.trim();
  return {
    id: ids.next(),
    name: title !== '' ? title : baseName(file.name),
    file: file.name,
    tree: { ...body, attributes: attributes as DocNode['attributes'], classes, children, ...(Object.keys(customAttributes).length === 0 ? {} : { customAttributes }) },
  };
}

// a page setting's value as the model keeps it (a language tag, an address, a path list), or null when it cannot hold
// it
function settingValue(valueType: string, value: string, rules: ModelRules, setting: string): string | null {
  if (valueType === 'url') {
    const read = readAddress(value);
    return read.ok ? read.value : null;
  }
  if (valueType === 'path-list') {
    const parts = value.split(/\s+/).filter((one) => one !== '');
    const read = parts.map((one) => readAddress(one));
    return read.every((one) => one.ok) ? read.map((one) => (one.ok ? one.value : '')).join(' ') : null;
  }
  return attributeValueRefusal(setting, value, rules) === null ? value : null;
}

// ---------------------------------------------------------------- the command

export const importPageFiles = (files: readonly PickedFile[]): PickedFile[] => files.filter(file => isHtmlFile(file.name)).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

export const importHtmlCommand = registerHandler('project.importHtml', (context, { files, destination = 'page', target }) => {
  const { state, rules, ids, words, confirmed } = context;
  const picked = (files ?? []) as readonly PickedFile[];
  const broken = picked.find((file) => file.error !== undefined && file.error !== '');
  if (broken !== undefined) return { kind: 'refused' as const, message: message('status.import.invalidArchive', { file: broken.name, reason: typeof broken.error === 'string' ? broken.error : (archiveReason(broken.error) ?? '') }) };
  // the home page first: index.html, else the files in their own order
  const markup = importPageFiles(picked);
  if (markup.length === 0) return { kind: 'refused' as const, message: message('status.import.noPage') };
  // Only explicit replacement asks to remove work; new-page import may reuse a pristine blank placeholder.
  if (destination === 'replace' && confirmed !== true) return { kind: 'confirm' as const };
  const pristine = isEmptyProject(state.document) && [state.document.classes, state.document.files, state.document.components, state.document.tokens, state.document.swatches, state.document.folders].every(values => !values?.length);
  const replacing = destination === 'replace' || (destination === 'page' && pristine);
  const report = emptyReport();
  // Merging reserves every existing node name; replacement starts a fresh naming scope.
  const make: NodeMaker = { rules, ids, words, taken: replacing ? new Set() : new Set([...allNodes(state.document)].map(node => node.name)) };
  const held: ProjectFile[] = [];
  const pages: Page[] = [];
  const sources: SheetSource[] = [];
  const built: { readonly page: Page; readonly builder: Builder }[] = [];
  const nameBlocks = new Map<string, Set<string>>();
  let elements = 0;
  for (const file of markup) {
    const builder = newBuilder(make, context as HandlerContext<never>, textOfFile(file), picked, file.name, 'import', report, held, nameBlocks);
    const page = pageFrom(file, builder);
    elements += countOf(page.tree) - 1;
    pages.push(page);
    built.push({ page, builder });
    for (const sheet of builder.sheets) sources.push(sheet);
  }
  const authors = authorClasses(pages, sources);
  const definitions = new Map<string, Styles>();
  const captured = markup.some((file) => isCapturedPage(textOfFile(file)));
  const deferred = captured ? capturedWidthProperties(sources, context as HandlerContext<never>, rules) : new Set<string>();
  for (const one of built) applyStyles(one.page.tree, one.builder, sources, authors, definitions, isCapturedPage(one.builder.markup) ? deferred : new Set());
  const tokens = rootTokens(context, sources, report, markup.some((file) => isCapturedPage(textOfFile(file))));
  report.tokens.push(...tokens.map((token) => token.name));
  report.unusedClasses.push(...unusedClasses(pages, authors).filter((name) => definitions.has(name)));
  // A reference that names no element of the imported pages (a link to #search, whose element was a script's, or one
  // the model does not keep) is released as element.applyHtml releases one, so the result stays a valid document; the
  // report names them (the plan's stage 12: a captured page is imported whole)
  const dangling = orphanReferences({ version: state.document.version, pages });
  if (dangling.length > 0) {
    const releasing = new Map<string, Set<string>>();
    for (const one of dangling) {
      releasing.set(one.node.id, (releasing.get(one.node.id) ?? new Set()).add(one.attribute));
      report.released.push(one.value);
    }
    const released = (node: DocNode): DocNode => {
      const gone = releasing.get(node.id);
      const attributes = gone === undefined ? node.attributes : Object.fromEntries(Object.entries(node.attributes).filter(([id]) => !gone.has(id)));
      return { ...node, attributes, children: node.children.map(released) };
    };
    pages.splice(0, pages.length, ...pages.map((page) => ({ ...page, tree: released(page.tree) })));
  }
  // The files the import keeps: everything picked that is no page (a stylesheet's rules are in the document now) and no
  // file a script already kept. A file an address of a page names is kept at that address's path — a src written
  // img/logo.png with the file picked as logo.png draws on the canvas — and the others at their own path.
  const wanted = new Map<string, string>();
  for (const page of pages) {
    for (const node of walkNodes(page.tree)) {
      for (const [id, value] of Object.entries(node.attributes)) {
        const html = rules.attributeValues.get(id)?.html;
        if ((html !== 'src' && html !== 'poster') || typeof value !== 'string' || value === '' || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
        const file = picked.find((one) => !isHtmlFile(one.name) && !isCssFile(one.name) && (one.name === value || one.name.endsWith(`/${value}`) || value.endsWith(`/${one.name}`)));
        if (file !== undefined && !wanted.has(value)) wanted.set(value, file.name);
      }
    }
  }
  for (const file of picked) {
    if (isHtmlFile(file.name) || isCssFile(file.name)) continue;
    if (held.some((one) => one.path === file.name)) continue;
    const referenced = [...wanted].find(([, name]) => name === file.name);
    if (referenced !== undefined && held.some((one) => one.path === referenced[0])) continue;
    held.push(referenced === undefined ? recordOf(file) : { ...recordOf(file), path: referenced[0] });
  }
  // a captured page keeps what the model does not hold of its sheets, in its residual stylesheet (spec capture-url)
  for (const one of built) {
    const source = markup.find((file) => file.name === one.builder.file);
    if (source === undefined || !isCapturedPage(textOfFile(source))) continue;
    const at = capturedPageStylePath(one.page);
    const css = one.builder.sheets.map((sheet) => residualCss(sheet.text, sheet.file, at, context as HandlerContext<never>, rules, deferred)).filter((part) => part !== '').join('\n');
    if (css === '') continue;
    const index = held.findIndex((file) => file.path === at);
    const record: ProjectFile = { path: at, type: 'text/css', bytes: base64(new TextEncoder().encode(css)) };
    if (index < 0) held.push(record);
    else held[index] = record;
  }
  // the project's languages are the project's own (spec export-clean): an import keeps them, whatever it replaces
  const parsed = {
    version: state.document.version,
    ...projectLanguages(state.document),
    pages,
    ...(tokens.length ? { tokens } : {}),
    ...(definitions.size ? { classes: [...definitions].map(([name, styles]) => ({ name, styles })) } : {}),
    ...(held.length ? { files: held } : {})
  };
  const composed = importDestination(context, parsed, replacing ? 'replace' : destination, (target ?? (state.selection.length === 1 ? state.selection[0] : undefined)) as NodeId | undefined);
  if ('refused' in composed) return { kind: 'refused' as const, message: composed.refused };
  const said = message('status.import.done', {
    elements,
    files: markup.map((file) => file.name).join(', '),
    notes: reportNotes(report, words),
  });
  return { kind: 'change' as const, ...composed, message: said };
});

// The document and code languages of a project, as they stand: what an import or an opened folder keeps.
export const projectLanguages = (document: DocumentJson): Pick<DocumentJson, 'language' | 'codeLanguage'> => ({
  ...(document.language === undefined ? {} : { language: document.language }),
  ...(document.codeLanguage === undefined ? {} : { codeLanguage: document.codeLanguage }),
});

const rank = (name: string): number => (name === 'index.html' || name.endsWith('/index.html') ? 0 : 1);

// every node of a tree
function countOf(node: DocNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countOf(child), 0);
}

// What a page's own head holds (the manifest's explorer-open-folder): its language and direction, its title, and the
// stylesheets and scripts it links, as the source wrote them. The same reader parses the markup (the browser's own
// parser), so a page imported with its markup keeps what its head said about the page itself.
// ---------------------------------------------------------------- what a captured page keeps of its sheets

// A captured page (the Builder Companion marks it: <meta name="builder-capture">; spec capture-url) keeps, beside the
// classes and values the import maps, what the model does not hold — a rule whose selector this importer does not read
// (a descendant, :has(), an attribute), an at-rule other than a media query a breakpoint takes (@font-face, @keyframes,
// @layer, @supports), and a declaration the editor does not store (a custom property, a vendor prefix) — in a residual
// stylesheet the page links before the project's own (capture-styles.ts capturedPageStylePath), so the page looks as
// it did and what the person edits in the inspector still wins.
export const isCapturedPage = (markup: string): boolean => /<meta\b[^>]*\bname\s*=\s*["']?builder-capture\b/i.test(markup);

// whether this importer maps a selector, as applyStyles decides it
function mapsSelector(text: string, rules: ModelRules): boolean {
  const selector = readSelector(text);
  if (selector === null || innerPseudo(selector)) return false;
  const last = selector.compounds[selector.compounds.length - 1] as Compound;
  // The SVG node is one model element; its text, paths and shapes are markup inside it, not model nodes.
  if (last.tag !== null && last.tag !== rules.root.tag && typeOfTag(last.tag, rules) === null) return false;
  const classRule = classRuleOf(selector);
  if (last.pseudo !== null && (rules.statePseudos.get(last.pseudo) === undefined || (selector.compounds.length > 1 && classRule === null))) return false;
  return classRule === null || validClassName(classRule);
}

// whether the editor stores a declaration, as storedDeclarations decides it (without its report)
function storesDeclaration(context: HandlerContext<never>, rules: ModelRules, text: string): boolean {
  const colon = text.indexOf(':');
  const property = colon <= 0 ? '' : text.slice(0, colon).trim().toLowerCase();
  if (property === '' || property.startsWith('--')) return false;
  const fields = rules.structures.get(property);
  if (fields !== undefined) return shadowLayersFromCss(text.slice(colon + 1).replace(/!\s*important\s*$/i, ''), fields) !== null;
  return !('refused' in parseDeclarations(`${property}: ${text.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim()};`, context));
}

// a sheet's address rewritten from where the sheet was (`from`) to where the residual stylesheet is (`at`)
function movedUrl(value: string, from: string, at: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return value;
  const target = new URL(value, new URL(from, 'https://capture.invalid/')).pathname.slice(1);
  const base = at.split('/').slice(0, -1);
  const parts = target.split('/');
  while (base.length > 0 && parts.length > 1 && base[0] === parts[0]) {
    base.shift();
    parts.shift();
  }
  return '../'.repeat(base.length) + parts.join('/');
}

// The part of one sheet the model does not hold, as CSS, its addresses written from the residual stylesheet's place.
export function residualCss(text: string, from: string, at: string, context: HandlerContext<never>, rules: ModelRules, deferred: ReadonlySet<string> = new Set()): string {
  let ast: CssTreeNode;
  try {
    ast = parseCssTree(text, { parseValue: true, parseCustomProperty: false });
  } catch {
    return '';
  }
  walkCssTree(ast, (node) => {
    if (node.type === 'Url') node.value = movedUrl(node.value, from, at);
  });
  const rulesOf = (list: readonly CssTreeNode[], inMedia: boolean): string[] =>
    list.flatMap((node): string[] => {
      if (node.type === 'Rule') {
        if (node.prelude.type !== 'SelectorList') return [generateCssTree(node)];
        const selectors = node.prelude.children.toArray().map((one) => generateCssTree(one));
        const declarations = node.block.children.toArray().filter((one) => one.type === 'Declaration').map((one) => generateCssTree(one));
        const unmapped = selectors.filter((one) => !mapsSelector(one, rules));
        const mapped = selectors.filter((one) => mapsSelector(one, rules));
        const left = declarations.filter((one) => !storesDeclaration(context, rules, one) || storedProperties(one, context, rules).some((property) => deferred.has(property)));
        return [
          ...(unmapped.length > 0 && declarations.length > 0 ? [`${unmapped.join(',')}{${declarations.join(';')}}`] : []),
          ...(mapped.length > 0 && left.length > 0 ? [`${mapped.join(',')}{${left.join(';')}}`] : []),
        ];
      }
      if (node.type === 'Atrule') {
        const prelude = node.prelude === null ? '' : generateCssTree(node.prelude);
        if (node.name.toLowerCase() === 'layer' && prelude === CAPTURE_BASE_LAYER && node.block !== null) return [];
        if (node.name.toLowerCase() === 'media' && !inMedia && node.block !== null && !mediaPlace([prelude], rules).unmappable) {
          const inner = rulesOf(node.block.children.toArray(), true);
          return inner.length === 0 ? [] : [`@media ${prelude}{${inner.join('')}}`];
        }
        return [generateCssTree(node)];
      }
      return [];
    });
  const residual = ast.type === 'StyleSheet' ? rulesOf(ast.children.toArray(), false).join('\n') : '';
  if (residual === '') return '';
  const ordered = residual.startsWith(`@layer ${CAPTURE_BASE_LAYER};`) ? residual : `@layer ${CAPTURE_BASE_LAYER};\n${residual}`;
  return byCaptureClass(ordered);
}

// A captured element keeps the classes its markup gave it in data-capture-class (the Companion writes it), whatever the
// import did with them (a class it made the element's own styles is dropped from the element): the residual's class
// selectors name that attribute instead ([data-capture-class~="name"], the same specificity), so they still match.
function byCaptureClass(css: string): string {
  let ast: CssTreeNode;
  try {
    ast = parseCssTree(css);
  } catch {
    return css;
  }
  walkCssTree(ast, {
    visit: 'ClassSelector',
    enter(node, item, list) {
      if (list === null || item === null) return;
      const name = node.name.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_escape, hex: string | undefined, character: string | undefined) => hex === undefined ? character ?? '' : String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)));
      list.replace(item, list.createItem({ type: 'AttributeSelector', name: { type: 'Identifier', name: 'data-capture-class' }, matcher: '~=', value: { type: 'String', value: name }, flags: null }));
    },
  });
  return generateCssTree(ast);
}

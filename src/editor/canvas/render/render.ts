// The renderer (PRODUCT.md §5): the one writer of a page's HTML and CSS from the document JSON. It builds one page
// into the document it is given (the canvas iframe's; it never reads a global document) and then applies each
// change's patches to that DOM without rebuilding the page: a style patch rewrites that node's rules, a patch of an
// attribute, a class, the text or the tag updates that node's element, a patch of a node's children reconciles
// them by node id (a node added whole is built anew, unless it is the very node the page shows, moved), and only a
// patch that replaces or shifts the rendered page itself builds the page again. A patch of another page, or of a
// field of the page that is not rendered (its name, its file), leaves the page as it is.
//
// The page root's element is the page's <body>. The settings of the page it stores (the attributes elements.json gives
// a page root alone, src/core/page/settings.ts) are the page's own: their HTML attributes (lang, dir) are written on
// the page's <html>, never on <body>, so the canvas lays the page out in its language and direction as the export does.
//
// Every element carries data-node="<id>" so the canvas and the tests find the element of a node; the export writes
// its own markup (BEM classes, no data attributes). The node's styles are one style element per node in the head,
// marked data-node-style="<id>", with rules keyed by data-node: the base breakpoint without a media query, the
// others as max-width queries in the cascade order of properties.json, the states as their pseudo-classes. A
// recipe's stored value is written as the recipe's declarations. A markup element (embed) renders empty until its
// feature sanitizes the markup. The project's design tokens are one style element of their own (data-tokens-style),
// the :root rule of their variables, written again when they change. An SVG's markup (core/elements/svg.ts, kept
// sanitized) is drawn in a group after its shapes, marked data-svg-markup (editor-only: the export writes the markup
// itself). The renderer adds no event handler to the page and writes no event attribute: the page only renders, and
// every pointer input arrives on the canvas overlay.
//
// Editor-only, never in the document nor in an export: every element of a container below the page root carries
// data-container, and one style element of the editor (data-editor-style), first in the head, gives an empty one the
// minimum height of the manifest's constant canvas.emptyContainerMinHeight, so it can be seen and pointed at. Its
// selector weighs nothing (:where), so any min-height the node's own styles set wins. The element of a hidden node
// (its hidden flag, spec hide-element) carries data-hidden, which the same style element draws with display: none,
// important so that no display of the node's own rules shows it; showing it again removes the mark, and the element
// takes back the layout its own rules give it.
//
// A text element's text is drawn with its inline marks (src/core/text/inline.ts): <strong>, <em> and <a href> around
// its runs, a <br> for each line break.
//
// Editor-only too, while a text is edited in place (src/editor/canvas/text-edit.ts): the edited element carries
// contenteditable="plaintext-only" and data-key-context naming the key context of the edit, is focused with the caret
// at the end of its text, and takes a line break at the caret when asked; its content is read back from the element
// as runs (a <br> is "\n", <strong> or <b> bold, <em> or <i> italic, <a href> a link), with the text selection as a
// range of its characters, and is drawn again with the runs and the range a change of its marks produced (spec
// text-inline-formatting). The marks go when the edit ends, and the element shows again the text the document holds.
// They are the renderer's state, never the document's, and the page still gets no event handler.
import type { NodeId } from '../../../generated/commands.ts';
import { baseCss } from '../../../core/render/base.ts';
import { formNodes } from '../../../core/export/authoring.ts';
import { classesCss, elementAttributes, fileUrlsIn, nodeCss, outputModelFromManifest, type OutputModel } from '../../../core/render/output.ts';
export { elementAttributes, nodeCss, outputModelFromManifest, type OutputModel } from '../../../core/render/output.ts';
import type { ElementsFile, InteractionsFile, PropertiesFile } from '../../../manifest/schema.ts';
import { locate, walk, type DocNode, type DocumentJson } from '../../../core/document/model.ts';
import { applyPatches, deepEqual, type Patch } from '../../../core/history/transaction.ts';
import { canonical, type InlineRun, type TextRange } from '../../../core/text/inline.ts';
// what a contenteditable's DOM says about the runs (editor/canvas/render/inline.ts), moved out of this file
import { ELEMENT_NODE, TEXT_NODE, browserBreak, leavesOf, lastContent, precedes, runsOfLeaves, type Leaf } from './inline.ts';
import { svgMarkupOf } from '../../../core/elements/svg.ts';
import { rootCss } from '../../../core/design/tokens.ts';
import { objectUrl, resolvedSource } from '../../../core/files/files.ts';
import { filesOf } from '../../../core/document/model.ts';
import { fontFaceCss } from '../../../core/files/fonts.ts';
import { animationsOf, keyframesCss, previewDeclarations } from '../../../core/animation/animation.ts';
import { outputForTable } from '../../../core/document/breakpoint-rules.ts';
import { captureAssetPath, capturedPageCss } from '../../../core/import/capture-styles.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const NODE_ATTRIBUTE = 'data-node';
// a node's style element in the head: its own attribute, so [data-node] finds only elements of the page
export const NODE_STYLE_ATTRIBUTE = 'data-node-style';
// the editor-only marks: an element of a container, a hidden node's element, and the editor's own style element
export const CONTAINER_ATTRIBUTE = 'data-container';
export const HIDDEN_ATTRIBUTE = 'data-hidden';
// editor-only: a text element whose text is empty (the audit's A3.38)
export const EMPTY_TEXT_ATTRIBUTE = 'data-empty-text';
export const EDITOR_STYLE_ATTRIBUTE = 'data-editor-style';
// the project's base style element (core/render/base.ts): written first in the page's head, before every other rule, as
// the exported stylesheet carries it (the user's real-use audit, item 2.4)
export const BASE_STYLE_ATTRIBUTE = 'data-base-style';
// the marks of the text edited in place: editable as plain text, in the key context the editor names
export const EDITABLE_ATTRIBUTE = 'contenteditable';
// editor-only: the sandboxed frame that shows an embed's markup on the canvas
const EMBED_FRAME_ATTRIBUTE = 'data-embed-frame';
// the style element of the project's design tokens (core/design/tokens.ts): the :root rule of its variables, after the
// editor's, before every node's (the export writes the same rule first in its stylesheet)
export const TOKENS_STYLE_ATTRIBUTE = 'data-tokens-style';
const TOKENS_FIELD = 'tokens';
// the style element of the project's style classes (core/design/classes.ts): their rules, after the tokens', before
// every node's, so an element's own values override its classes (spec shared-style-classes)
export const CLASSES_STYLE_ATTRIBUTE = 'data-classes-style';
// the style element of a captured page's residual stylesheet (spec capture-url): before the classes and every node's
// rules, so what the person edits wins over it
export const CAPTURE_STYLE_ATTRIBUTE = 'data-capture-style';
// the style element of the project's fonts (core/files/fonts.ts): one @font-face per font file of the tree, serving
// it through the file's object URL, so the family the font menu offers draws on the canvas (manifest: custom-fonts)
export const FONTS_STYLE_ATTRIBUTE = 'data-fonts-style';
// the stylesheet of the state the editor previews on the selection (previewState)
export const PREVIEW_STYLE_ATTRIBUTE = 'data-preview-style';
// the outline of the selection in a side frame (spec side-by-side-view)
export const OUTLINE_STYLE_ATTRIBUTE = 'data-outline-style';
// The animations' @keyframes of the page the canvas shows (group 18): the canvas writes them so the timeline can play
// an animation at the playhead; the animation properties themselves are drawn only while the timeline previews one
// (previewTimeline), so the editing canvas never runs an animation on its own.
export const KEYFRAMES_STYLE_ATTRIBUTE = 'data-keyframes-style';
// the stylesheet of the animation the timeline previews at its playhead (previewTimeline)
export const PLAY_STYLE_ATTRIBUTE = 'data-play-style';
const CLASSES_FIELD = 'classes';
const FILES_FIELD = 'files';
// editor-only: the group that draws an SVG's markup after its shapes (the export writes the markup itself there)
const SVG_MARKUP_ATTRIBUTE = 'data-svg-markup';
const SVG_TAG = 'svg';
// editor-only: what an image with no source shows on the canvas (jornada03 J22): a neutral 16:9 marker with a picture
// glyph, which keeps its proportion at any width (the 800 x 300 band it was spanned widths its picture would not)
const IMAGE_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#e2e8f0"/><g fill="none" stroke="#94a3b8" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"><rect x="260" y="130" width="120" height="100" rx="10"/><circle cx="295" cy="162" r="11"/><path d="M262 214l38-34 26 22 22-18 32 30"/></g></svg>',
)}`;
export const EDITABLE_VALUE = 'plaintext-only';
export const KEY_CONTEXT_ATTRIBUTE = 'data-key-context';

// The canvas's model: the output's, and the editor-only minimum heights of an empty container and of an empty text,
// in CSS px (canvas.emptyContainerMinHeight, canvas.emptyTextMinHeight)
export interface RenderModel extends OutputModel {
  readonly emptyContainerMinHeight: number;
  readonly emptyTextMinHeight: number;
}

export function renderModelFromManifest(elements: ElementsFile, properties: PropertiesFile, interactions: InteractionsFile): RenderModel {
  const minHeight = interactions.constants.find((c) => c.id === 'canvas.emptyContainerMinHeight')?.value;
  if (typeof minHeight !== 'number') throw new Error('the manifest has no number canvas.emptyContainerMinHeight');
  const textMinHeight = interactions.constants.find((c) => c.id === 'canvas.emptyTextMinHeight')?.value;
  if (typeof textMinHeight !== 'number') throw new Error('the manifest has no number canvas.emptyTextMinHeight');
  return { ...outputModelFromManifest(elements, properties), emptyContainerMinHeight: minHeight, emptyTextMinHeight: textMinHeight };
}

// The editor's own CSS in the page: an empty container keeps a visible minimum height; a hidden node's element is
// not drawn, whatever its own rules say; an empty text keeps a minimum height and a dashed outline in its own colour
// (the audit's A3.38), weightless (:where) so the node's own rules win.
// The browser's own scrollbar width, measured once in the editor's document (the same scrollbar the site shows): the
// page keeps it free whatever the zoom, so its usable width is the site's (the user's real-use audit, item A3.22).
let measuredScrollbar: number | null = null;
export function scrollbarWidth(): number {
  if (measuredScrollbar !== null) return measuredScrollbar;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;overflow:scroll;width:100px;height:100px;visibility:hidden';
  document.body.append(probe);
  measuredScrollbar = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return measuredScrollbar;
}

export function editorCss(model: RenderModel): string {
  // The page lays out at the width a real browser gives it: the scrollbar's own width stays free whatever the zoom (the
  // canvas draws no scrollbar inside the frame; the stage scrolls the page), so the usable width is the site's at any
  // zoom (the user's real-use audit, item A3.22). The frame sets the variable from the browser's own scrollbar.
  return `html { padding-right: ${scrollbarWidth()}px; scrollbar-width: none; }\n:where([${CONTAINER_ATTRIBUTE}]:empty) { min-height: ${model.emptyContainerMinHeight}px; }\n:where([${EMPTY_TEXT_ATTRIBUTE}]) { min-height: ${model.emptyTextMinHeight}px; outline: 1px dashed currentColor; outline-offset: -1px; }\n[${HIDDEN_ATTRIBUTE}] { display: none !important; }\n[${EMBED_FRAME_ATTRIBUTE}] { display: block; width: 100%; min-height: ${model.emptyContainerMinHeight}px; border: 0; pointer-events: none; }`;
}

// The selector of a node's element: its id quoted as a CSS string.
export function nodeSelector(id: NodeId): string {
  return `[${NODE_ATTRIBUTE}="${id.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;
}

// What a patch changes, found in the document as it was just before the patch: the rendered page as a whole
// (replaced, or shifted to another index), nothing the page shows, or one node's children, styles or the rest of
// the node.
type Touch = { readonly kind: 'page' } | { readonly kind: 'none' } | { readonly kind: 'children' | 'styles' | 'element'; readonly node: NodeId };

function touchOf(doc: DocumentJson, page: number, patch: Patch): Touch {
  const { path } = patch;
  if (path[0] !== 'pages') return { kind: 'none' };
  if (path.length === 1) return { kind: 'page' };
  const index = path[1];
  if (typeof index !== 'number') return { kind: 'page' };
  if (path.length === 2) {
    // a page added or removed before the rendered one moves it to another index
    if (patch.op === 'replace') return { kind: index === page ? 'page' : 'none' };
    return { kind: index <= page ? 'page' : 'none' };
  }
  if (index !== page) return { kind: 'none' };
  if (path[2] !== 'tree') return { kind: 'none' };
  if (path.length === 3) return { kind: 'page' };
  let node: DocNode | undefined = doc.pages[page]?.tree;
  let at = 3;
  while (node && path[at] === 'children' && typeof path[at + 1] === 'number' && at + 2 < path.length) {
    node = node.children[path[at + 1] as number];
    at += 2;
  }
  if (!node) return { kind: 'page' };
  const field = path[at];
  if (field === 'children') return { kind: 'children', node: node.id };
  if (field === 'styles') return { kind: 'styles', node: node.id };
  // a node's id or type is never changed in place; if it were, the page is built again
  if (field === 'id' || field === 'type') return { kind: 'page' };
  return { kind: 'element', node: node.id };
}

function isNode(value: unknown): value is DocNode {
  return value !== null && typeof value === 'object' && 'id' in value && 'children' in value && Array.isArray((value as DocNode).children);
}

// The nodes a children patch writes: one node (an index of the list) or a whole list.
function writtenNodes(patch: Patch): readonly DocNode[] {
  if (patch.op === 'remove') return [];
  if (isNode(patch.value)) return [patch.value];
  return Array.isArray(patch.value) ? patch.value.filter(isNode) : [];
}

function findNode(root: DocNode, id: NodeId): DocNode | null {
  for (const node of walk(root)) if (node.id === id) return node;
  return null;
}


// Gives an element exactly the attributes wanted, writing only what differs.
function writeAttributes(element: Element, wanted: ReadonlyMap<string, string>): void {
  for (const attribute of [...element.attributes]) if (!wanted.has(attribute.name)) element.removeAttribute(attribute.name);
  for (const [name, value] of wanted) if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

// An SVG's markup group stays after its shapes, whatever order the shapes arrived in.
function markupLast(element: Element): void {
  const group = [...element.children].find((child) => child.hasAttribute(SVG_MARKUP_ATTRIBUTE));
  if (group !== undefined && element.lastElementChild !== group) element.append(group);
}

export class PageRenderer {
  private readonly elements = new Map<NodeId, Element>();
  private readonly sheets = new Map<NodeId, HTMLStyleElement>();
  // the markup each SVG markup group draws
  private readonly markups = new WeakMap<Element, string>();
  // the text being edited in place: its node and the key context its element names
  private edit: { readonly node: NodeId; readonly context: string } | null = null;
  // the closed details and dialogs drawn open because of the selection (reveal)
  private revealed = new Set<NodeId>();
  // The document the page shows now, kept at every entry point: a stylesheet's url(…) naming a project file is written
  // as the file's object URL, as the source attributes are (files.ts), since the canvas holds the bytes and has no
  // folder to fetch a path from — a background image the person uploaded draws on the canvas as it does in the export.
  private doc: DocumentJson | null = null;
  private model: RenderModel;

  constructor(
    private readonly target: Document,
    // the manifest's model; the one the page is written with takes the project's breakpoints
    // (core/document/breakpoints.ts)
    private readonly manifestModel: RenderModel,
    private readonly page = 0,
    // the breakpoint's screen the canvas resolves vh, svh, dvh and lvh against (item 2.3); null in the export's own
    // writing, which keeps the units the person typed
    private readonly screen: { readonly height: number } | null = null,
    // how a stored attribute value is written (core/files/values.ts): the canvas hands a source that names a project
    // file over as its object URL and a reference as the target's id attribute; null writes nothing
    private readonly address: (name: string, value: string) => string | null = (_name, value) => value,
  ) {
    this.model = manifestModel;
  }

  // The element that renders a node, or null.
  element(id: NodeId): Element | null {
    return this.elements.get(id) ?? null;
  }

  // Editor-only (spec elements-interactive): a closed <details> or <dialog> is drawn open while it, or a node inside
  // it, is selected, so its content can be seen and edited; the document and the export keep its own open state.
  reveal(doc: DocumentJson, selection: readonly NodeId[]): void {
    const wanted = new Set<NodeId>();
    for (const id of selection) {
      for (let at = locate(doc, id); at !== null; at = at.parent === null ? null : locate(doc, at.parent.id)) {
        if (at.node.tag === 'details' || at.node.tag === 'dialog') wanted.add(at.node.id);
      }
    }
    const changed = [...wanted].filter((id) => !this.revealed.has(id)).concat([...this.revealed].filter((id) => !wanted.has(id)));
    this.revealed = wanted;
    const tree = doc.pages[this.page]?.tree ?? null;
    for (const id of changed) {
      const node = tree === null ? null : findNode(tree, id);
      const element = this.elements.get(id);
      if (node && element) this.dress(element, node);
    }
  }

  // Editor-only (spec side-by-side-view): the selected elements outlined in a colour, in a page that draws no canvas
  // chrome over it (a side frame); one stylesheet, the last of the page's, emptied with no selection.
  outline(selection: readonly NodeId[], color: string): void {
    let sheet = this.target.head.querySelector<HTMLStyleElement>(`style[${OUTLINE_STYLE_ATTRIBUTE}]`);
    if (sheet === null) {
      sheet = this.target.createElement('style');
      sheet.setAttribute(OUTLINE_STYLE_ATTRIBUTE, '');
      this.target.head.append(sheet);
    }
    sheet.textContent = selection.map((id) => `${nodeSelector(id)}{outline:2px solid ${color};outline-offset:-1px}`).join('\n');
  }

  // Editor-only (spec state-styles): the selected elements drawn as if a state held, while a state other than Base is
  // edited: one stylesheet, after every node's, holding each selected node's values of that state as plain rules (with
  // their breakpoints' media queries); none otherwise. The export never has it.
  previewState(doc: DocumentJson, selection: readonly NodeId[], state: string | null): void {
    this.doc = doc;
    const tree = doc.pages[this.page]?.tree ?? null;
    const css =
      state === null || tree === null
        ? ''
        : selection
            .map((id) => findNode(tree, id))
            .flatMap((node) => {
              if (!node) return [];
              const held: Record<string, Record<string, unknown>> = {};
              const merge = (breakpoint: string, values: unknown) => {
                held[breakpoint] = { ...(held[breakpoint] ?? {}), ...(values as Record<string, unknown>) };
              };
              for (const [breakpoint, byState] of Object.entries(node.styles as Record<string, Record<string, unknown>>)) {
                const values = byState[state];
                if (values !== undefined) held[breakpoint] = { [this.model.base.state]: values };
              }
              // the classes the node wears hold values of that state too: with the target on a class, the canvas shows
              // them (A3.36); they follow the node's own, as the class rules do
              for (const name of (node as { classes?: readonly string[] }).classes ?? []) {
                const defined = (doc as { classes?: readonly { readonly name: string; readonly styles: Record<string, Record<string, unknown>> }[] }).classes?.find((c) => c.name === name);
                if (defined === undefined) continue;
                for (const [breakpoint, byState] of Object.entries(defined.styles)) {
                  const values = byState[state];
                  if (values !== undefined) merge(breakpoint, values);
                }
              }
              return [nodeCss({ styles: held as DocNode['styles'], type: node.type }, nodeSelector(node.id), this.model)];
            })
            .filter((c) => c !== '')
            .join('\n');
    const resolved = this.fileCss(css);
    let sheet = this.target.head.querySelector(`style[${PREVIEW_STYLE_ATTRIBUTE}]`);
    if (resolved === '') {
      sheet?.remove();
      return;
    }
    if (!sheet) {
      sheet = this.target.createElement('style');
      sheet.setAttribute(PREVIEW_STYLE_ATTRIBUTE, '');
    }
    // always last, after every node's rules, so the state's values win as a state would
    if (sheet !== this.target.head.lastElementChild) this.target.head.append(sheet);
    if (sheet.textContent !== resolved) sheet.textContent = resolved;
  }

  // The @keyframes of every animation the shown page holds, in the one style element of the canvas: what the timeline
  // preview plays (spec timeline-preview; the export writes its own from the same writer, core/animation/animation.ts).
  writeKeyframes(doc: DocumentJson): void {
    this.doc = doc;
    const tree = doc.pages[this.page]?.tree ?? null;
    const blocks: string[] = [];
    const walk = (node: DocNode): void => {
      for (const animation of animationsOf(node)) {
        const css = keyframesCss(animation, this.model, 'line');
        if (css !== '') blocks.push(css);
      }
      for (const child of node.children) walk(child);
    };
    if (tree) walk(tree);
    let sheet = this.target.head.querySelector(`style[${KEYFRAMES_STYLE_ATTRIBUTE}]`);
    if (blocks.length === 0) {
      sheet?.remove();
      return;
    }
    if (!sheet) {
      sheet = this.target.createElement('style');
      sheet.setAttribute(KEYFRAMES_STYLE_ATTRIBUTE, '');
      this.target.head.append(sheet);
    }
    const css = this.fileCss(blocks.join('\n'));
    if (sheet.textContent !== css) sheet.textContent = css;
  }

  // The animation the timeline previews, drawn at the playhead (spec timeline-preview): the animation properties with
  // the playhead as a negative delay and the play state — so Play animates the element from the stored keyframes, Pause
  // freezes it there and Stop (no preview) puts it back to its base styles. Editor-only; the export never has it.
  previewTimeline(doc: DocumentJson, preview: { readonly node: NodeId; readonly animation: string; readonly time: number; readonly playing: boolean; readonly loop: boolean } | null): void {
    const tree = doc.pages[this.page]?.tree ?? null;
    const node = preview === null || tree === null ? null : findNode(tree, preview.node);
    const animation = node === null || preview === null ? null : (node.animations ?? []).find((a) => a.name === preview.animation) ?? null;
    const css = node === null || animation === null || preview === null ? '' : this.fileCss(`${nodeSelector(node.id)} { ${previewDeclarations(animation, preview.time, preview.playing, preview.loop).join(' ')} }`);
    let sheet = this.target.head.querySelector(`style[${PLAY_STYLE_ATTRIBUTE}]`);
    if (css === '') {
      sheet?.remove();
      return;
    }
    if (!sheet) {
      sheet = this.target.createElement('style');
      sheet.setAttribute(PLAY_STYLE_ATTRIBUTE, '');
    }
    // after every node's rules, so the previewed animation wins over the element's own values as a CSS animation does
    if (sheet !== this.target.head.lastElementChild) this.target.head.append(sheet);
    if (sheet.textContent !== css) sheet.textContent = css;
  }

  // Starts editing a text element in place (the marks, the focus without scrolling, the caret at the end of its
  // text), or, with null, ends the edit: the element loses the marks and shows the text the document holds.
  editText(doc: DocumentJson, id: NodeId | null, context: string): void {
    const tree = doc.pages[this.page]?.tree ?? null;
    const previous = this.edit;
    if (previous?.node === id && previous.context === context) return;
    this.edit = null;
    const left = previous && tree ? findNode(tree, previous.node) : null;
    const leftElement = previous ? this.elements.get(previous.node) : undefined;
    if (left && leftElement) this.dress(leftElement, left, true);
    if (id === null || !tree) return;
    const node = findNode(tree, id);
    const element = this.elements.get(id);
    if (!node || !element || this.model.elements.get(node.type)?.content !== 'text') return;
    this.edit = { node: id, context };
    this.dress(element, node);
    (element as HTMLElement).focus({ preventScroll: true });
    const selection = this.target.getSelection();
    selection?.selectAllChildren(element);
    selection?.collapseToEnd();
  }

  // A line break at the caret of the edited text. One at the very end is followed by the <br> a browser needs to
  // show the new line, which the text read back leaves out.
  insertLineBreak(): void {
    const element = this.edit ? this.elements.get(this.edit.node) : undefined;
    const selection = this.target.getSelection();
    if (!element || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const lineBreak = this.target.createElement('br');
    range.insertNode(lineBreak);
    if (lastContent(element, lineBreak)) lineBreak.after(this.target.createElement('br'));
    range.setStartAfter(lineBreak);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Every character of the edited text as the text selection, so what is typed next replaces it.
  selectEditedText(): void {
    const element = this.edit ? this.elements.get(this.edit.node) : undefined;
    const selection = this.target.getSelection();
    if (!element || !selection) return;
    selection.selectAllChildren(element);
  }

  // What the edited element holds now, or null when no text is edited: its canonical runs ("\n" for each line break,
  // the browser's last <br> left out) and the text selection as a range of their characters, null when the selection
  // is not inside the element.
  editedContent(): { readonly runs: InlineRun[]; readonly range: TextRange | null } | null {
    const element = this.edit ? this.elements.get(this.edit.node) : undefined;
    if (!element) return null;
    const all = leavesOf(element);
    const dropped = browserBreak(all);
    const leaves = all.filter((l) => l !== dropped);
    const length = leaves.reduce((n, l) => n + l.text.length, 0);
    const selection = this.target.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (range === null || !element.contains(range.startContainer) || !element.contains(range.endContainer)) return { runs: runsOfLeaves(leaves), range: null };
    const start = Math.min(this.offsetIn(leaves, range.startContainer, range.startOffset), length);
    const end = Math.min(this.offsetIn(leaves, range.endContainer, range.endOffset), length);
    return { runs: runsOfLeaves(leaves), range: { start, end } };
  }

  // Draws the edited element again with the runs a change of its marks produced (the <br> a browser needs after a line
  // break at the very end included), selects the range given in it, and gives it the focus back without scrolling.
  showEdited(runs: readonly InlineRun[], range: TextRange): void {
    const element = this.edit ? this.elements.get(this.edit.node) : undefined;
    if (!element) return;
    element.replaceChildren(...this.runNodes(runs));
    const leaves = leavesOf(element);
    if (leaves.findLast((l) => l.text !== '')?.node.nodeName.toUpperCase() === 'BR') element.append(this.target.createElement('br'));
    this.focusEdited(range);
  }

  // Gives the edited element the focus back without scrolling, with the range given selected in it (or, with none, the
  // selection it kept): after a control outside the page held the focus (the link prompt).
  focusEdited(range: TextRange | null): void {
    const element = this.edit ? this.elements.get(this.edit.node) : undefined;
    if (!element) return;
    (element as HTMLElement).focus({ preventScroll: true });
    const selection = this.target.getSelection();
    if (range === null || !selection) return;
    const all = leavesOf(element);
    const dropped = browserBreak(all);
    const leaves = all.filter((l) => l !== dropped);
    const [endNode, endOffset] = this.pointAt(element, leaves, Math.max(range.start, range.end), false);
    if (range.start === range.end) {
      selection.collapse(endNode, endOffset);
      return;
    }
    const [startNode, startOffset] = this.pointAt(element, leaves, Math.min(range.start, range.end), true);
    selection.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
  }

  // The number of characters of an edited text before a boundary point inside its element.
  private offsetIn(leaves: readonly Leaf[], container: Node, offset: number): number {
    let count = 0;
    for (const leaf of leaves) {
      if (leaf.node === container) return count + (leaf.node.nodeType === TEXT_NODE ? offset : 0);
      if (!precedes(leaf.node, container, offset)) break;
      count += leaf.text.length;
    }
    return count;
  }

  // The boundary point at a number of characters into an edited text: inside a text node, or before a <br>; at a
  // boundary between two texts, the start of the next one (`next`, a range's start) or the end of the previous one
  // (a range's end and a caret, so what is typed next takes the marks of what it follows).
  private pointAt(element: Element, leaves: readonly Leaf[], offset: number, next: boolean): [Node, number] {
    let count = 0;
    for (const leaf of leaves) {
      const length = leaf.text.length;
      if (leaf.node.nodeType === TEXT_NODE) {
        if (offset < count + length || (offset === count + length && !next)) return [leaf.node, offset - count];
      } else if (offset <= count && leaf.node.parentNode !== null) return [leaf.node.parentNode, [...leaf.node.parentNode.childNodes].indexOf(leaf.node as ChildNode)];
      count += length;
    }
    return [element, element.childNodes.length];
  }

  // The page's nodes of runs: a text node for each line of a string with a <br> between lines, an element for each
  // mark.
  private runNodes(runs: readonly InlineRun[]): Node[] {
    return runs.flatMap((run): Node[] => {
      // an empty line makes no text node, so an emptied text leaves its element as empty as a fresh one
      const text = (line: string): Node[] => (line === '' ? [] : [this.target.createTextNode(line)]);
      if (typeof run === 'string') return run.split('\n').flatMap((line, i) => (i === 0 ? text(line) : [this.target.createElement('br'), ...text(line)]));
      const element = this.target.createElement(run.tag);
      if (run.tag === 'a') element.setAttribute('href', run.href);
      element.append(...this.runNodes(run.children));
      return [element];
    });
  }

  // Builds the whole page: once, and when the rendered page itself is replaced.
  mount(doc: DocumentJson): void {
    this.doc = doc;
    this.model = outputForTable(this.manifestModel, doc.breakpoints);
    // the style elements of every node, also those a previous renderer of this document left
    for (const sheet of [...this.target.head.querySelectorAll(`style[${NODE_STYLE_ATTRIBUTE}], style[${EDITOR_STYLE_ATTRIBUTE}], style[${TOKENS_STYLE_ATTRIBUTE}], style[${CLASSES_STYLE_ATTRIBUTE}], style[${FONTS_STYLE_ATTRIBUTE}], style[${BASE_STYLE_ATTRIBUTE}], style[${CAPTURE_STYLE_ATTRIBUTE}]`)]) sheet.remove();
    for (const sheet of [
      ...this.target.head.querySelectorAll(
        `style[${NODE_STYLE_ATTRIBUTE}], style[${EDITOR_STYLE_ATTRIBUTE}], style[${TOKENS_STYLE_ATTRIBUTE}], style[${CLASSES_STYLE_ATTRIBUTE}], style[${BASE_STYLE_ATTRIBUTE}], style[${PREVIEW_STYLE_ATTRIBUTE}], style[${KEYFRAMES_STYLE_ATTRIBUTE}], style[${PLAY_STYLE_ATTRIBUTE}]`,
      ),
    ])
      sheet.remove();
    this.sheets.clear();
    this.elements.clear();
    // the project's base style first, as every exported stylesheet carries it at its head, so the canvas lays the page
    // out as the site does (the user's real-use audit, items 2.4 and 7.7)
    const base = this.target.createElement('style');
    base.setAttribute(BASE_STYLE_ATTRIBUTE, '');
    base.textContent = baseCss();
    this.target.head.prepend(base);
    // the editor's style element, next, so every node's rules come after it
    const editor = this.target.createElement('style');
    editor.setAttribute(EDITOR_STYLE_ATTRIBUTE, '');
    editor.textContent = editorCss(this.model);
    base.after(editor);
    const tokens = this.target.createElement('style');
    tokens.setAttribute(TOKENS_STYLE_ATTRIBUTE, '');
    editor.after(tokens);
    this.writeTokens(doc);
    const fonts = this.target.createElement('style');
    fonts.setAttribute(FONTS_STYLE_ATTRIBUTE, '');
    tokens.after(fonts);
    this.writeFonts(doc);
    const classes = this.target.createElement('style');
    classes.setAttribute(CLASSES_STYLE_ATTRIBUTE, '');
    tokens.after(classes);
    this.writeClasses(doc);
    const capture = this.target.createElement('style');
    capture.setAttribute(CAPTURE_STYLE_ATTRIBUTE, '');
    tokens.after(capture);
    this.writeCapture(doc);
    this.writeKeyframes(doc);
    const body = this.target.body;
    body.replaceChildren();
    const tree = doc.pages[this.page]?.tree ?? null;
    if (!tree) {
      writeAttributes(body, new Map());
      writeAttributes(this.target.documentElement, new Map());
      return;
    }
    this.elements.set(tree.id, body);
    this.dress(body, tree);
    this.writeStyle(tree);
    body.append(...tree.children.map((child) => this.build(child)));
  }

  // Applies a change's patches to the page: `before` is the document the page shows, `after` the one the patches
  // make of it.
  apply(before: DocumentJson, after: DocumentJson, patches: readonly Patch[]): void {
    // the project's breakpoints changed: every media query is written again
    if (before.breakpoints !== after.breakpoints) return this.mount(after);
    this.doc = after;
    if (patches.some((patch) => patch.path[0] === TOKENS_FIELD)) this.writeTokens(after);
    if (patches.some((patch) => patch.path[0] === CLASSES_FIELD)) this.writeClasses(after);
    // a font file added, removed or changed writes the fonts' @font-face rules again (the manifest's custom-fonts)
    if (patches.some((patch) => patch.path[0] === FILES_FIELD)) this.writeFonts(after);
    if (patches.some((patch) => patch.path[0] === FILES_FIELD)) this.writeCapture(after);
    const children = new Set<NodeId>();
    const styles = new Set<NodeId>();
    const elements = new Set<NodeId>();
    // the nodes added or replaced whole with a content other than the one the page shows: built anew
    const rebuilt = new Set<NodeId>();
    const shown = before.pages[this.page]?.tree ?? null;
    let state = before;
    for (const patch of patches) {
      const touch = touchOf(state, this.page, patch);
      if (touch.kind === 'page') return this.mount(after);
      state = applyPatches(state, [patch]).document;
      if (touch.kind === 'none') continue;
      if (touch.kind === 'styles') styles.add(touch.node);
      else if (touch.kind === 'element') elements.add(touch.node);
      else {
        children.add(touch.node);
        for (const written of writtenNodes(patch)) {
          // a node the page shows exactly as written is moved, keeping its element
          const current = shown ? findNode(shown, written.id) : null;
          if (current && deepEqual(current, written)) continue;
          for (const node of walk(written)) rebuilt.add(node.id);
        }
      }
    }
    const tree = after.pages[this.page]?.tree ?? null;
    if (!tree) return this.mount(after);
    // an animation added, changed or taken away writes the page's @keyframes again
    if (patches.some((patch) => patch.path.includes('animations'))) this.writeKeyframes(after);
    for (const id of rebuilt) this.forget(id);
    for (const id of elements) {
      const node = findNode(tree, id);
      if (node) this.redress(node);
    }
    for (const id of children) {
      const node = findNode(tree, id);
      if (node) this.reconcile(node);
    }
    if (children.size > 0) this.dropMissing(tree);
    for (const id of styles) {
      const node = findNode(tree, id);
      if (node) this.writeStyle(node);
      // an SVG's viewBox is its size (core/elements/svg.ts): a new size writes it again
      if (node && node.tag === SVG_TAG && !elements.has(id)) this.redress(node);
    }
  }

  private create(node: DocNode): Element {
    const kind = this.model.elements.get(node.type);
    const tag = node.tag ?? 'div';
    return kind?.namespace === 'svg' || tag === 'svg' ? this.target.createElementNS(SVG_NS, tag) : this.target.createElement(tag);
  }

  // A node's element and its whole subtree, with the styles of every node in it.
  private build(node: DocNode): Element {
    const element = this.create(node);
    this.dress(element, node);
    this.elements.set(node.id, element);
    this.writeStyle(node);
    element.append(...node.children.map((child) => this.build(child)));
    markupLast(element);
    return element;
  }

  // A stylesheet's text with its project-file addresses resolved to the files' object URLs (files.ts resolvedSource):
  // what the canvas writes; the export writes the same CSS with its paths, which the archive's folder serves.
  private fileCss(css: string): string {
    return this.doc === null ? css : fileUrlsIn(css, (address) => resolvedSource(this.doc as DocumentJson, address));
  }

  // The node's own attributes (elementAttributes, the output's) and text on its element, with the editor's own marks,
  // writing only what differs. The text of the element
  // being edited is the edit's until it ends (`rewrite` then writes the document's text whatever the element shows).
  private dress(element: Element, node: DocNode, rewrite = false): void {
    // the page root's element is the page's <body>; the settings of the page it stores are the page's <html>'s
    const root = element === this.target.body;
    const wanted = new Map<string, string>([[NODE_ATTRIBUTE, node.id]]);
    const page = new Map<string, string>();
    // a container below the page root (editor-only: see the top of this file); an SVG is no box of the layout, its
    // declared size is its drawing's (core/elements/svg.ts)
    if (!root && this.model.elements.get(node.type)?.content === 'children' && element.localName !== SVG_TAG) wanted.set(CONTAINER_ATTRIBUTE, '');
    // a hidden node (editor-only: see the top of this file)
    if (node.hidden === true) wanted.set(HIDDEN_ATTRIBUTE, '');
    const edited = this.edit?.node === node.id ? this.edit : null;
    if (edited) {
      wanted.set(EDITABLE_ATTRIBUTE, EDITABLE_VALUE);
      wanted.set(KEY_CONTEXT_ATTRIBUTE, edited.context);
    }
    const tag = element.localName;
    const output = elementAttributes(node, tag, root, this.model, (_name, value) => value, { language: this.doc?.language ?? 'en', inForm: this.doc !== null && formNodes(this.doc).has(node.id) });
    for (const [name, value] of output.element) {
      if (wanted.has(name)) continue;
      const written = value === true ? '' : this.address(name, value);
      if (written !== null) wanted.set(name, written);
    }
    for (const [name, value] of output.page) page.set(name, value);
    // editor-only: media never play by themselves on the canvas
    wanted.delete('autoplay');
    // editor-only: an embedded frame is sandboxed, so what it shows can run nothing against the editor; an image with
    // no source shows a placeholder of its default size (spec elements-media-images)
    if (tag === 'iframe') wanted.set('sandbox', '');
    if (this.revealed.has(node.id)) wanted.set('open', '');
    if (tag === 'img' && !wanted.has('src')) wanted.set('src', IMAGE_PLACEHOLDER);
    // a text element with no text (editor-only, the audit's A3.38), but the one being edited in place
    if (!edited && this.model.elements.get(node.type)?.content === 'text' && (node.text ?? '') === '') wanted.set(EMPTY_TEXT_ATTRIBUTE, '');
    writeAttributes(element, wanted);
    if (root) writeAttributes(this.target.documentElement, page);
    if (tag === SVG_TAG) this.drawSvgMarkup(element, node);
    // editor-only (feature embed-html): an embed's markup is shown inside a sandboxed frame, where its scripts never
    // run; the document and the export keep the markup as it is
    if (this.model.elements.get(node.type)?.content === 'markup') {
      const frame = element.firstElementChild?.localName === 'iframe' ? element.firstElementChild : null;
      const markup = node.text ?? '';
      if (frame !== null && frame.getAttribute('srcdoc') === markup) return;
      const shown = frame ?? this.target.createElement('iframe');
      shown.setAttribute('sandbox', '');
      shown.setAttribute('srcdoc', markup);
      shown.setAttribute(EMBED_FRAME_ATTRIBUTE, '');
      if (frame === null) element.replaceChildren(shown);
      return;
    }
    if (this.model.elements.get(node.type)?.content !== 'text' || edited) return;
    // the text with its marks (src/core/text/inline.ts), or the plain text when nothing is marked
    const runs = node.inline ?? [node.text ?? ''];
    if (!rewrite && deepEqual(runsOfLeaves(leavesOf(element)), canonical(runs))) return;
    element.replaceChildren(...this.runNodes(runs));
  }

  // After a change of the node itself: a new tag builds a new element around the same children elements.
  private redress(node: DocNode): void {
    const element = this.elements.get(node.id);
    if (!element) return;
    if (node.tag !== null && element.localName !== node.tag && element !== this.target.body) {
      const replacement = this.create(node);
      this.dress(replacement, node);
      // the elements of child nodes only (never the <br> of a text), compared by node type: the page's elements
      // belong to the iframe's realm, where `instanceof Element` of the editor's realm is false
      replacement.append(...[...element.children].filter((child) => child.nodeType === ELEMENT_NODE && child.hasAttribute(NODE_ATTRIBUTE)));
      element.replaceWith(replacement);
      this.elements.set(node.id, replacement);
      return;
    }
    this.dress(element, node);
  }

  // Drops one node's element, so the next reconcile builds it anew. Its style element stays: build rewrites it.
  private forget(id: NodeId): void {
    this.elements.get(id)?.remove();
    this.elements.delete(id);
  }

  // Puts the node's children elements in the document's order, moving the ones that exist and building the rest;
  // an element already in its place is not touched.
  private reconcile(node: DocNode): void {
    const element = this.elements.get(node.id);
    if (!element) return;
    const wanted = node.children.map((child) => this.elements.get(child.id) ?? this.build(child));
    wanted.forEach((child, i) => {
      if (element.children[i] !== child) element.insertBefore(child, element.children[i] ?? null);
    });
    for (const extra of [...element.children].slice(wanted.length)) {
      if (extra.hasAttribute(NODE_ATTRIBUTE)) extra.remove();
    }
    markupLast(element);
  }

  // The :root rule of the project's design tokens, in their style element.
  private writeTokens(doc: DocumentJson): void {
    const sheet = this.target.head.querySelector(`style[${TOKENS_STYLE_ATTRIBUTE}]`);
    const css = rootCss(doc.tokens ?? []);
    if (sheet !== null && sheet.textContent !== css) sheet.textContent = css;
  }

  // The project's fonts (core/files/fonts.ts), in their style element: each @font-face serves its file through the
  // file's object URL, since the canvas holds the bytes and not a folder to fetch a path from, so a family the person
  // chose in the font menu is the face the page draws with (the manifest's custom-fonts).
  private writeFonts(doc: DocumentJson): void {
    const sheet = this.target.head.querySelector(`style[${FONTS_STYLE_ATTRIBUTE}]`);
    const css = fontFaceCss(filesOf(doc), (file) => objectUrl(file));
    if (sheet !== null && sheet.textContent !== css) sheet.textContent = css;
  }

  // A captured page's residual stylesheet (capture-styles.ts), its addresses drawn from the project's files.
  private writeCapture(doc: DocumentJson): void {
    const sheet = this.target.head.querySelector(`style[${CAPTURE_STYLE_ATTRIBUTE}]`);
    const page = doc.pages[this.page];
    const css = page === undefined ? '' : fileUrlsIn(capturedPageCss(doc, page), (address) => resolvedSource(doc, captureAssetPath(page, address)));
    if (sheet !== null && sheet.textContent !== css) sheet.textContent = css;
  }

  // The rules of the project's style classes, in their style element.
  private writeClasses(doc: DocumentJson): void {
    const sheet = this.target.head.querySelector(`style[${CLASSES_STYLE_ATTRIBUTE}]`);
    const css = this.fileCss(classesCss(doc.classes ?? [], this.model));
    if (sheet !== null && sheet.textContent !== css) sheet.textContent = css;
  }

  // An SVG's markup (core/elements/svg.ts, sanitized when it was kept): its group, drawn anew only when the markup
  // changed, and gone when there is none.
  private drawSvgMarkup(element: Element, node: DocNode): void {
    const markup = svgMarkupOf(node);
    const held = [...element.children].find((child) => child.hasAttribute(SVG_MARKUP_ATTRIBUTE)) ?? null;
    if (markup === '') {
      held?.remove();
      return;
    }
    const group = held ?? this.target.createElementNS(SVG_NS, 'g');
    if (held === null) group.setAttribute(SVG_MARKUP_ATTRIBUTE, '');
    if (this.markups.get(group) !== markup) {
      group.innerHTML = markup;
      this.markups.set(group, markup);
    }
    element.append(group);
  }

  // Forgets the elements and style elements of nodes the document no longer has.
  private dropMissing(tree: DocNode): void {
    const alive = new Set<NodeId>();
    for (const node of walk(tree)) alive.add(node.id);
    for (const [id, element] of this.elements) {
      if (alive.has(id)) continue;
      element.remove();
      this.elements.delete(id);
    }
    for (const [id, sheet] of this.sheets) {
      if (alive.has(id)) continue;
      sheet.remove();
      this.sheets.delete(id);
    }
  }

  private writeStyle(node: DocNode): void {
    const css = this.fileCss(nodeCss(node, nodeSelector(node.id), this.model, 'line', this.screen));
    let sheet = this.sheets.get(node.id);
    if (css === '') {
      sheet?.remove();
      this.sheets.delete(node.id);
      return;
    }
    if (!sheet) {
      sheet = this.target.createElement('style');
      sheet.setAttribute(NODE_STYLE_ATTRIBUTE, node.id);
      this.target.head.append(sheet);
      this.sheets.set(node.id, sheet);
    }
    if (sheet.textContent !== css) sheet.textContent = css;
  }
}

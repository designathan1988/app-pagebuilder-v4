// Reading markup (split out of core/import/import.ts, which keeps the mapping): the tree of tags, attributes and
// text the importer reads, read by the browser port (the browser's own parser), and the source line a piece starts on.
import { browserPorts } from '../ports/browser.ts';

export interface MarkupNode {
  readonly tag: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly MarkupChild[];
}
export type MarkupChild = MarkupNode | string;

// The markup's own elements and texts, as the browser parses them, through the browser port (src/core/ports/browser.ts:
// the core holds no DOM)
export const parseMarkup = (markup: string): readonly MarkupChild[] => browserPorts().fragment(markup);

// A whole page's markup: the head's elements, the title, and the body's children and attributes (File › Import HTML
// reads the page's settings from the head, which parseMarkup alone leaves out).
export interface MarkupPage {
  readonly head: readonly MarkupNode[];
  readonly title: string;
  readonly htmlAttributes: ReadonlyMap<string, string>;
  readonly body: readonly MarkupChild[];
  readonly bodyAttributes: ReadonlyMap<string, string>;
}

export const parsePage = (markup: string): MarkupPage => browserPorts().page(markup);

// What a page's head says of it: its language, direction, title, stylesheets and scripts
export interface PageHead {
  readonly lang: string | null;
  readonly dir: string | null;
  readonly title: string | null;
  readonly stylesheets: readonly string[];
  readonly scripts: readonly string[];
}

export const pageHead = (markup: string): PageHead => browserPorts().head(markup);

// the text an element's children hold as one string (a head element's content, a script's code)
export function textOf(node: MarkupNode): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

// The line of the first piece of the source that starts with `needle` (1 when the source does not hold it): what a
// report names, so the person sees where the piece is.
export function lineOf(markup: string, needle: string): number {
  const at = markup.indexOf(needle);
  return at < 0 ? 1 : markup.slice(0, at).split('\n').length;
}

// the line of an element's start tag as the source wrote it (a repeated identical tag names the first of them)
export function lineOfNode(markup: string, node: MarkupNode): number {
  const attributes = [...node.attributes].map(([name, value]) => ` ${name}="${value.replaceAll('"', '&quot;')}"`).join('');
  return lineOf(markup, `<${node.tag}${attributes}`);
}

// The pieces of a text element's text on the page, in order: its text nodes and its <br>s ("\n"), each with the marks
// of the elements around it inside the element (<strong> and <b> bold, <em> and <i> italic, <a href> a link; any other
// element only holds its text).
// What a contenteditable's DOM says about the runs of an inline text (split out of editor/canvas/render/render.ts,
// which
// patches the page): the pieces of a text element's text in page order with the marks around them, the trailing line
// break a browser keeps that the text read back leaves out, and whether a leaf lies before a boundary point.
import { runsOf, type InlineRun, type Segment } from '../../../core/text/inline.ts';

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

export interface Leaf {
  readonly node: Node;
  readonly text: string;
  readonly marks: Omit<Segment, 'text'>;
}
const MARK_ELEMENTS: Readonly<Record<string, 'strong' | 'em'>> = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em' };
export function leavesOf(element: Element): Leaf[] {
  const out: Leaf[] = [];
  const visit = (parent: Node, marks: Omit<Segment, 'text'>) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === TEXT_NODE) out.push({ node: child, text: child.nodeValue ?? '', marks });
      else if (child.nodeType !== ELEMENT_NODE) continue;
      else if (child.nodeName.toUpperCase() === 'BR') out.push({ node: child, text: '\n', marks });
      else {
        const name = child.nodeName.toUpperCase();
        const mark = MARK_ELEMENTS[name];
        const href = name === 'A' ? (child as Element).getAttribute('href') : null;
        visit(child, mark !== undefined ? { ...marks, [mark]: true } : href !== null ? { ...marks, href } : marks);
      }
    }
  };
  visit(element, { strong: false, em: false, href: null });
  return out;
}
export const runsOfLeaves = (leaves: readonly Leaf[]): InlineRun[] => runsOf(leaves.map((l) => ({ text: l.text, ...l.marks })));

// The last <br> of an edited text when nothing but empty text follows it: the one a browser needs to show a line
// break at the very end, which the text read back leaves out.
export function browserBreak(leaves: readonly Leaf[]): Leaf | null {
  const last = leaves.findLast((l) => l.text !== '');
  return last !== undefined && last.node.nodeName.toUpperCase() === 'BR' ? last : null;
}

// Whether a leaf of a text (a text node or a <br>, never the point's own container) lies before a boundary point: the
// point is inside no leaf but its container, so a leaf is wholly before it or wholly after it.
const DOCUMENT_POSITION_PRECEDING = 2;
export function precedes(leaf: Node, container: Node, offset: number): boolean {
  if (container.nodeType === TEXT_NODE) return (container.compareDocumentPosition(leaf) & DOCUMENT_POSITION_PRECEDING) !== 0;
  const next = container.childNodes[offset] ?? null;
  if (next === null) return container.contains(leaf) || (container.compareDocumentPosition(leaf) & DOCUMENT_POSITION_PRECEDING) !== 0;
  return next !== leaf && !next.contains(leaf) && (next.compareDocumentPosition(leaf) & DOCUMENT_POSITION_PRECEDING) !== 0;
}

// Whether nothing but empty text follows a node of an element's text inside the element (a mark around it included).
export function lastContent(element: Element, node: Node): boolean {
  const leaves = leavesOf(element);
  const at = leaves.findIndex((l) => l.node === node);
  return at >= 0 && leaves.slice(at + 1).every((l) => l.text === '');
}

// Bound elements (spec content-data, "binding"): what an element can show of an item, how it shows a value, and what
// it shows now. A binding is the element's own mark (`bind`): a field of the item and the part of the element it fills
// (its text, an image's source or alternative text, a link's address). The item comes from where the element stands:
// the n-th repeated item of a bound list shows the n-th item of the list's query, and every element of a page made
// for an item shows that item.
import type { MessageId } from '../../generated/ids.ts';
import type { DocNode, DocumentJson } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import type { IdGenerator } from '../ports/ids.ts';
import { imageSource } from '../design/components.ts';
import { readAddress } from '../elements/address.ts';
import { canonical, hasMarks, plainText, type InlineRun } from '../text/inline.ts';
import { cellText, refuse } from './collections.ts';
import { ITEM_PAGE, type BindTarget, type Bound, type Cell, type Collection, type Item } from './model.ts';
export { fieldFits, targetsOf } from './targets.ts';

// What a content operation needs of the store: new ids, the model's rules, the words of the person's language.
export interface DataContext {
  readonly ids: IdGenerator;
  readonly rules: ModelRules;
  words(key: MessageId, params?: Readonly<Record<string, string | number>>): string;
}

// The addresses of the pages made for items (spec content-data, "one page per item"): collection name and item id →
// the page's file.
export type ItemPages = ReadonlyMap<string, string>;
const itemPageKey = (collection: string, item: string): string => `${collection}\u0000${item}`;
export function itemPagesOf(document: DocumentJson): ItemPages {
  const pages = new Map<string, string>();
  for (const page of document.pages) {
    const mark = page.tree.dataItem;
    if (mark !== undefined) pages.set(itemPageKey(mark.collection, mark.item), page.file);
  }
  return pages;
}

// What an element shows now for a target: its text, its source, its alternative text or its address; undefined when
// it shows none.
export function shownBy(node: DocNode, to: BindTarget): string | undefined {
  const attribute = (name: string): string | undefined => {
    const value = (node.attributes as Readonly<Record<string, unknown>>)[name];
    return value === undefined ? undefined : String(value);
  };
  switch (to) {
    case 'text':
      return node.text ?? undefined;
    case 'image':
      return attribute('src');
    case 'alt':
      return attribute('alt');
    case 'link':
      return attribute('href');
  }
}

// Where a value is, to say it in a refusal: the row (counted from 1) and the column's label.
export interface Place {
  readonly collection: Collection;
  readonly item: Item;
  readonly row: number;
}

const yesNo = (words: DataContext['words']) => ({ yes: words('data.yes'), no: words('data.no') });

// What a binding makes an element show for its item: the value as text, the image the value names (a project path, a
// project image by its file name, a web address), the address of a link, or of the item's page. Undefined when the item
// holds no value there: the element keeps what it shows (a template's own text stays until the item has one). A value
// the target cannot show is refused, naming the row, the column and the value.
export function valueFor(document: DocumentJson, bound: Bound, place: Place, pages: ItemPages, context: DataContext): string | readonly InlineRun[] | undefined {
  if (bound.field === ITEM_PAGE) return pages.get(itemPageKey(place.collection.name, place.item.id));
  const field = place.collection.fields.find((f) => f.key === bound.field);
  if (field === undefined) return undefined;
  const value: Cell | undefined = place.item.values[field.key];
  if (value === undefined) return undefined;
  const text = cellText(value, yesNo(context.words));
  switch (bound.to) {
    case 'text':
      return Array.isArray(value) ? canonical(value as readonly InlineRun[]) : text;
    case 'alt':
      return text;
    case 'image': {
      const source = imageSource(document, text);
      if (source === null) refuse('status.data.imageNotFound', { row: place.row, column: field.label, value: text });
      return source;
    }
    case 'link': {
      const address = readAddress(text);
      if (!address.ok || address.value === '') refuse('status.data.badLink', { row: place.row, column: field.label, value: text });
      return address.value;
    }
  }
}

// The element showing its own bindings' values for an item (its children untouched). A text written by a binding takes
// the rich text's marks when the field holds some, and loses any marks it had otherwise.
function fillNode(document: DocumentJson, node: DocNode, place: Place, pages: ItemPages, context: DataContext): DocNode {
  let next = node;
  for (const bound of node.bind ?? []) {
    const value = valueFor(document, bound, place, pages, context);
    if (bound.field === ITEM_PAGE && bound.to === 'link' && value === undefined) {
      // an item with no page yet: its link goes nowhere rather than somewhere wrong
      const { href: _href, ...attributes } = next.attributes as Readonly<Record<string, unknown>>;
      void _href;
      next = { ...next, attributes: attributes as DocNode['attributes'] };
      continue;
    }
    if (value === undefined) continue;
    if (bound.to === 'text') {
      const runs = typeof value === 'string' ? null : value;
      const { inline: _inline, ...plain } = next;
      void _inline;
      next = runs !== null && hasMarks(runs) ? { ...plain, text: plainText(runs), inline: runs } : { ...plain, text: runs === null ? (value as string) : plainText(runs) };
    } else {
      const attribute = bound.to === 'image' ? 'src' : bound.to === 'alt' ? 'alt' : 'href';
      next = { ...next, attributes: { ...next.attributes, [attribute]: value } };
    }
  }
  return next;
}

// Every element of a subtree that a fill of it reaches: the subtree's elements, except the repeated items of a bound
// list inside it (they show the list's items, not this one's).
export function* reached(root: DocNode): Generator<DocNode> {
  yield root;
  const list = root.dataList;
  for (const child of root.children) {
    if (list !== undefined && child.component === list.component) continue;
    yield* reached(child);
  }
}

// A subtree showing an item: every element it reaches filled by its own bindings.
export function fillTree(document: DocumentJson, root: DocNode, place: Place, pages: ItemPages, context: DataContext): DocNode {
  const visit = (node: DocNode): DocNode => {
    const filled = node.bind === undefined ? node : fillNode(document, node, place, pages, context);
    const list = node.dataList;
    const children = node.children.map((child) => (list !== undefined && child.component === list.component ? child : visit(child)));
    return children.every((child, i) => child === node.children[i]) ? filled : { ...filled, children };
  };
  return visit(root);
}

// The bindings of a subtree, where a fill of it reaches.
export const boundIn = (root: DocNode): DocNode[] => [...reached(root)].filter((node) => (node.bind ?? []).length > 0);

// Split text (plan stage 10, "texto dividido letra/palavra/linha com escalonamento"; spec motion-runtime, Split
// text): an element's text cut into pieces an animation staggers, keeping what the text is made of — a bold word stays
// bold, a link stays a link — because each text node is cut where it is, never the element's text rebuilt.
//  - Letters and words are spans around the characters of each text node; spaces stay plain text so the line still
//    breaks where it did. Lines are the words grouped by the line they sit on (measured once, after the split).
//  - Assistive technology reads the text as it was: the pieces are aria-hidden and a visually hidden copy of the text
//    stands beside them, so a screen reader never spells a word letter by letter.
//  - Restoring puts the original text nodes back, the very same nodes, so nothing else of the page is disturbed.
//
// Self-contained: embedded as text in the page's motion script (self-contained.test.ts).
interface SplitText {
  // the pieces, in reading order, each with the line it sits on (0 for the first)
  readonly pieces: readonly { readonly element: HTMLElement; readonly line: number }[];
  restore(): void;
}

export interface SplitKit {
  split(element: Element, by: 'letter' | 'word' | 'line'): SplitText;
}

export function createSplitText(): SplitKit {
  // the inline styles of a visually hidden element (the copy assistive technology reads)
  const HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0';
  // an element already split is split once: a second split action on it shares the first's pieces
  const splits = new WeakMap<Element, { split: SplitText; by: string; users: number }>();

  function textNodesOf(element: Element): Text[] {
    const found: Text[] = [];
    const visit = (node: Node): void => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          if ((child.nodeValue ?? '').length > 0) found.push(child as Text);
        } else if (child.nodeType === 1) {
          const tag = (child as Element).localName;
          // a script, a style or an embedded document holds no text a person reads
          if (tag !== 'script' && tag !== 'style' && tag !== 'svg' && tag !== 'iframe') visit(child);
        }
      }
    };
    visit(element);
    return found;
  }

  function piece(document: Document, text: string): HTMLElement {
    const span = document.createElement('span');
    span.textContent = text;
    // a transform needs a box: an inline span cannot move on its own
    span.style.display = 'inline-block';
    span.style.whiteSpace = 'pre';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function split(element: Element, by: 'letter' | 'word' | 'line'): SplitText {
    const held = splits.get(element);
    if (held !== undefined && held.by === by) {
      held.users += 1;
      return held.split;
    }
    const document = element.ownerDocument;
    const original = element.textContent ?? '';
    const replaced: { text: Text; fragment: Node[] }[] = [];
    const pieces: HTMLElement[] = [];
    for (const text of textNodesOf(element)) {
      const value = text.nodeValue ?? '';
      const parts = by === 'letter' ? Array.from(value) : value.split(/(\s+)/);
      const fragment: Node[] = [];
      for (const part of parts) {
        if (part === '') continue;
        if (/^\s+$/.test(part)) {
          fragment.push(document.createTextNode(part));
          continue;
        }
        const span = piece(document, part);
        pieces.push(span);
        fragment.push(span);
      }
      replaced.push({ text, fragment });
    }
    for (const { text, fragment } of replaced) {
      const parent = text.parentNode;
      if (parent === null) continue;
      for (const node of fragment) parent.insertBefore(node, text);
      parent.removeChild(text);
    }
    const copy = document.createElement('span');
    copy.textContent = original;
    copy.setAttribute('style', HIDDEN);
    element.appendChild(copy);
    // the line each piece sits on: a new line starts where a piece's top is lower than the line's
    let line = 0;
    let top: number | null = null;
    const placed = pieces.map((one) => {
      const at = one.offsetTop;
      if (by === 'line' && top !== null && at > top + 1) line += 1;
      if (top === null || at > top + 1) top = at;
      return { element: one, line: by === 'line' ? line : 0 };
    });
    const made: SplitText = {
      pieces: placed,
      restore() {
        const entry = splits.get(element);
        if (entry !== undefined && entry.users > 1) {
          entry.users -= 1;
          return;
        }
        splits.delete(element);
        copy.remove();
        for (const { text, fragment } of replaced) {
          const first = fragment[0];
          const parent = first?.parentNode ?? null;
          if (first === undefined || parent === null) continue;
          parent.insertBefore(text, first);
          for (const node of fragment) node.parentNode?.removeChild(node);
        }
      },
    };
    splits.set(element, { split: made, by, users: 1 });
    return made;
  }

  return { split };
}

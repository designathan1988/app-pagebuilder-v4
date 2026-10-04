// A row of the inspector whose label or value does not fit beside the other stacks: its label takes a line of its own,
// above its values, which then take the whole row (spec inspector-panel, Problem 12; the audit's AUD-23: in Portuguese
// a pair's halves read "autom… 120" and "máx nenh…", and a detail's label broke "Transbordamento" in two). A
// translation runs longer than the English it comes from, a short text most of all (W3C, "Text size in translation"),
// so the inspector lets its text reflow rather than cut or abbreviate it. A row stacks when, laid out side by side:
// - a word of its label is wider than the label column (a label wraps between its words, never inside one);
// - a pair's value of one word (a keyword's word, a number) is wider than its half. A value of several parts (a list of
//   fonts, a shorthand) may still end in an ellipsis: no cell holds it, and its slot's tooltip carries it whole;
// - a field of offered values (an input with its list: the Form section's preset, its moment, its error's place) shows
//   words wider than its box (CL1: "Brazilian taxpaye…"); an input cuts its text with no ellipsis. A row whose field
//   is being typed in keeps its layout, so nothing moves under the caret.
// Each row is judged as it would be laid out beside its label, from the widths of its text and of its cells as drawn,
// never by laying it out the other way, so a stacked row stays judged the same and nothing flickers or scrolls.

const ROWS = '.field-row';
const PAIR = 'field-row--pair';
const LABEL = ':scope > .field-row__label';
const CELLS = ':scope > .field-cell';
// a field of offered values standing in the row's value column: the input itself, or the input of a panel's field
// form (shell/panel-field.tsx: an interaction card's fields, the timeline's settings)
const CHOICE = ':scope > input[list], :scope > .panel-field__form > input[list]';
// the texts a cell cuts with an ellipsis: a field's shown value, a keyword menu's value
const CLIPS = '.field__rest-value, .field__keyword-value';
// the width of each row's label column, read while the row is laid out beside its label (a row is drawn so before it is
// first judged): the Style and Settings tabs' 100 px, a card's 72 px
const COLUMNS = new WeakMap<HTMLElement, number>();
// the sub-pixel difference between the canvas's measure and the laid-out text
const TOLERANCE = 0.5;

const oneWord = (text: string): boolean => text !== '' && !/[\s,]/u.test(text);
const px = (value: string): number => parseFloat(value) || 0;

function widthOf(context: CanvasRenderingContext2D, text: string, style: CSSStyleDeclaration): number {
  context.font = style.font;
  context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  return context.measureText(text).width;
}

// Whether the row's label and values fit beside each other.
function fitsBeside(row: HTMLElement, context: CanvasRenderingContext2D): boolean {
  const style = getComputedStyle(row);
  if (!('stacked' in row.dataset)) COLUMNS.set(row, parseFloat(style.gridTemplateColumns));
  const column = COLUMNS.get(row);
  if (column === undefined || Number.isNaN(column)) return true;
  const label = row.querySelector<HTMLElement>(LABEL);
  if (label !== null) {
    const own = getComputedStyle(label);
    const room = column - px(own.paddingLeft) - px(own.paddingRight);
    const words = (label.textContent ?? '').split(/\s+/u).filter((word) => word !== '');
    if (words.some((word) => widthOf(context, word, own) > room + TOLERANCE)) return false;
  }
  const gap = px(style.columnGap);
  const inner = row.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
  const choice = row.querySelector<HTMLInputElement>(CHOICE);
  if (choice !== null && choice.value !== '') {
    // the field beside its label: the row less the label column and the gap
    const own = getComputedStyle(choice);
    const frame = px(own.paddingLeft) + px(own.paddingRight) + px(own.borderLeftWidth) + px(own.borderRightWidth);
    // what else its form holds beside it (an easing's curve button) takes its share of the value column
    const beside = choice.parentElement === row ? 0 : (choice.parentElement?.getBoundingClientRect().width ?? 0) - choice.getBoundingClientRect().width;
    // what the field needs: while it overflows as drawn, its own width plus what it cuts (the browser's scroll width
    // counts what the text cannot see beside it: the list's drop-down indicator Chrome draws inside an input with a
    // datalist, which the text's own width leaves out); else the width of its words
    const overflow = choice.scrollWidth - choice.clientWidth;
    const needs = overflow > 1 ? choice.getBoundingClientRect().width + overflow : widthOf(context, choice.value, own) + frame;
    if (needs + beside > inner - column - gap + TOLERANCE) return false;
  }
  if (!row.classList.contains(PAIR)) return true;
  // a pair's half beside its label: the row less the label column and the two gaps, halved (inspector.css)
  const half = (inner - column - 2 * gap) / 2;
  for (const cell of row.querySelectorAll<HTMLElement>(CELLS)) {
    // what the cell has beyond its half while the row is stacked goes to its value (the value slot takes the free room)
    const extra = cell.getBoundingClientRect().width - half;
    for (const clip of cell.querySelectorAll<HTMLElement>(CLIPS)) {
      const text = (clip.textContent ?? '').trim();
      if (clip.getClientRects().length === 0 || !oneWord(text)) continue;
      if (widthOf(context, text, getComputedStyle(clip)) > clip.clientWidth - extra + TOLERANCE) return false;
    }
  }
  return true;
}

// Judges the rows under root whenever its text, its rows or its width change (and once the fonts are loaded); returns
// its removal.
export function installRowFit(root: HTMLElement): () => void {
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) return () => undefined;
  let frame = 0;
  let removed = false;
  const judge = () => {
    frame = 0;
    const rows = [...root.querySelectorAll<HTMLElement>(ROWS)];
    // every row read before any is changed, so the layout is computed once; a row whose field is being typed in keeps
    // its layout until the field is left
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
    const stacked = rows.map((row) => (typing !== null && row.contains(typing) ? 'stacked' in row.dataset : !fitsBeside(row, context)));
    rows.forEach((row, index) => {
      if (stacked[index] === ('stacked' in row.dataset)) return;
      if (stacked[index] === true) row.dataset.stacked = '';
      else delete row.dataset.stacked;
    });
  };
  const soon = () => {
    if (frame === 0 && !removed) frame = requestAnimationFrame(judge);
  };
  const changes = new MutationObserver(soon);
  changes.observe(root, { subtree: true, childList: true, characterData: true });
  const sizes = new ResizeObserver(soon);
  sizes.observe(root);
  // a field left or changed: its words may be others now (an input's value is no text the DOM observer sees)
  root.addEventListener('focusout', soon);
  root.addEventListener('change', soon);
  void document.fonts.ready.then(soon);
  soon();
  return () => {
    removed = true;
    cancelAnimationFrame(frame);
    changes.disconnect();
    sizes.disconnect();
    root.removeEventListener('focusout', soon);
    root.removeEventListener('change', soon);
  };
}

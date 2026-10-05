// A quick panel field whose value does not fit its half of a two-column group takes the group's whole row (spec
// quick-panel; the user's review of 2026-10-05: "Display g", "Gap 2…", "transpar…", "Tamanho 1…" read cut where the
// panel had the room under them). Each field is judged as it stands in its half, from the widths of its texts and of
// its boxes as drawn there, never by laying it out the other way: a widened field stays judged the same, so nothing
// flickers (as the inspector's rows are: shell/row-fit.ts). A field being typed in keeps its place under the caret.

const GROUPS = '.quick-panel__group-fields';
const FIELDS = ':scope > .field-row';
// the texts a field cuts: a value shown at rest, a keyword menu's value
const CLIPS = '.field__rest-value, .field__keyword-value';
// each field's width while it stands in a half, read before it is first widened
const HALVES = new WeakMap<HTMLElement, number>();
const TOLERANCE = 0.5;

const px = (value: string): number => parseFloat(value) || 0;

function widthOf(context: CanvasRenderingContext2D, text: string, style: CSSStyleDeclaration): number {
  context.font = style.font;
  context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  return context.measureText(text).width;
}

// Whether a field's values fit it as it stands in its half.
function fitsHalf(field: HTMLElement, context: CanvasRenderingContext2D): boolean {
  if (!('wide' in field.dataset)) HALVES.set(field, field.getBoundingClientRect().width);
  const half = HALVES.get(field);
  if (half === undefined) return true;
  // what the field has beyond its half while it takes the row goes to its texts
  const extra = field.getBoundingClientRect().width - half;
  for (const clip of field.querySelectorAll<HTMLElement>(CLIPS)) {
    const text = (clip.textContent ?? '').trim();
    if (text === '' || clip.getClientRects().length === 0) continue;
    if (widthOf(context, text, getComputedStyle(clip)) > clip.clientWidth - extra + TOLERANCE) return false;
  }
  for (const input of field.querySelectorAll<HTMLInputElement>('input')) {
    if (input.offsetWidth === 0) continue;
    const text = input.value !== '' ? input.value : input.placeholder;
    if (text === '') continue;
    const style = getComputedStyle(input);
    const room = input.clientWidth - px(style.paddingLeft) - px(style.paddingRight) - extra;
    if (widthOf(context, text, style) > room + TOLERANCE) return false;
  }
  return true;
}

// Judges the fields of root's two-column groups whenever their texts, their fields or their widths change; returns its
// removal.
export function installChipFit(root: HTMLElement): () => void {
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) return () => undefined;
  let frame = 0;
  let removed = false;
  const judge = () => {
    frame = 0;
    const typing = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const fields = [...root.querySelectorAll<HTMLElement>(GROUPS)]
      .filter((group) => getComputedStyle(group).gridTemplateColumns.split(' ').length > 1)
      .flatMap((group) => [...group.querySelectorAll<HTMLElement>(FIELDS)]);
    // every field read before any is changed, so the layout is computed once
    const wide = fields.map((field) => (typing !== null && field.contains(typing) ? 'wide' in field.dataset : !fitsHalf(field, context)));
    fields.forEach((field, index) => {
      if (wide[index] === ('wide' in field.dataset)) return;
      if (wide[index] === true) field.dataset.wide = '';
      else delete field.dataset.wide;
    });
  };
  const soon = () => {
    if (frame === 0 && !removed) frame = requestAnimationFrame(judge);
  };
  const changes = new MutationObserver(soon);
  changes.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['value', 'placeholder'] });
  const sizes = new ResizeObserver(soon);
  sizes.observe(root);
  // a field left or changed: its text may be another now (an input's value is no text the DOM observer sees)
  root.addEventListener('focusout', soon);
  root.addEventListener('change', soon);
  void document.fonts.ready.then(soon);
  soon();
  return () => {
    removed = true;
    if (frame !== 0) cancelAnimationFrame(frame);
    changes.disconnect();
    sizes.disconnect();
    root.removeEventListener('focusout', soon);
    root.removeEventListener('change', soon);
  };
}

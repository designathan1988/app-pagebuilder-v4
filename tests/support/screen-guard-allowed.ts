// The screen guard's exceptions (tests/support/screen-guard.ts, DEC-74): a finding the product keeps on purpose, each
// with the elements it covers (a CSS selector, matched by the element or an ancestor), the reason, and the decision or
// requirement that says so. Nothing else is ever left out: a finding without an entry here is a defect to fix where it
// comes from, never a test to loosen.
export interface Allowed {
  readonly kind: 'cut' | 'wrapped' | 'off-window' | 'covered' | 'english';
  readonly selector: string;
  readonly why: string;
  readonly decision: string;
}

export const ALLOWED: readonly Allowed[] = [
  {
    kind: 'covered',
    selector: '.frame-tabs',
    why: "the label of an element at the page's top stands above the page, fixed in the window, over the breakpoint tabs (nothing clips it there); the tab takes a press beside it, and the label hides once the page scrolls it out of view",
    decision: 'DEC-70',
  },
  {
    kind: 'english',
    selector: '.settings-default-message',
    why: "a form field's default validation message is the page's, in the language its messages are written in (the select above it, messages.locale), as the page's visitor will read it; never the editor's own text",
    decision: 'src/editor/forms/settings.tsx (the messages written whole in their own language)',
  },
];

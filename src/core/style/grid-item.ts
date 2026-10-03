// style.setGridItem (spec props-grid-container, the user's real-use audit, item A1.3): the start and the span a grid
// item takes on one axis, written as the composite's own value (grid-column or grid-row, "2 / span 3") through
// style.set's reader and writer, at the base breakpoint and state, in one undo step. What the door leaves out is
// read from the value the element holds, so a span written alone keeps the start it had. A start below 1, and a span
// below 1, are refused with the number named; a locked element refuses as every style write does.
import { message, registerHandler } from '../commands/registry.ts';
import { locate, type DocNode } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import { longhandValues, propertyName, readValue, writeStyle } from './set.ts';
import { storedValue } from './stored.ts';
import { argumentRefused } from '../store/args.ts';

// the start and the span a composite's text holds ("2 / span 3", "span 3", "auto / b"): a start that is a whole
// number, else none; a span that is "span N" in either side, else one (a value written as longhands keeps the span in
// the start longhand: "span 2" + "auto")
export function startAndSpan(text: string | undefined): { readonly start: number | null; readonly span: number } {
  const held = text?.trim() ?? '';
  const [first = '', second = ''] = held.split('/').map((part) => part.trim());
  const start = /^\d+$/.test(first) ? Number.parseInt(first, 10) : null;
  const spanned = /^span\s+(\d+)$/i.exec(first) ?? (second === '' ? null : /^span\s+(\d+)$/i.exec(second));
  return { start, span: spanned === null ? 1 : Number.parseInt(spanned[1] as string, 10) };
}

// The start and the span a node holds for a composite of an item's place (grid-column, grid-row), read from the
// longhands the document keeps ("2" and "span 3", "span 2" and "auto"). The editor reads an item's place here.
export function storedPlace(node: DocNode, property: string, rules: ModelRules): { readonly start: number | null; readonly span: number } {
  const longhands = rules.compositeFacts.get(property)?.longhands ?? [];
  return startAndSpan(longhands.map((longhand) => storedValue(node, longhand, rules) ?? '').join(' / '));
}

// what the door's start and span make of the place the element holds (storedPlace: its longhands)
export function gridItemValue(now: { readonly start: number | null; readonly span: number }, start: number | undefined, span: number | undefined): string | { readonly refused: 'start' } | { readonly refused: 'span' } {
  const nextStart = start ?? now.start;
  const nextSpan = span ?? now.span;
  if (nextStart !== null && nextStart < 1) return { refused: 'start' };
  if (nextSpan < 1) return { refused: 'span' };
  const first = nextStart === null ? '' : String(nextStart);
  if (nextSpan === 1) return first === '' ? 'auto' : first;
  return first === '' ? `span ${String(nextSpan)}` : `${first} / span ${String(nextSpan)}`;
}

export const setGridItemCommand = registerHandler('style.setGridItem', (context, { property, start, span }) => {
  if (typeof property !== 'string' || (start !== undefined && typeof start !== 'number') || (span !== undefined && typeof span !== 'number')) {
    return { kind: 'refused', message: argumentRefused(typeof property !== 'string' ? 'property' : typeof start !== 'number' && start !== undefined ? 'start' : 'span') };
  }
  const { state, rules } = context;
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null) return { kind: 'change' };
  // the half the door leaves out is the one the element holds, read from its longhands as the editor reads it (the
  // audit's S-012: the composite's own value was read, which the document never stores, so the other half was lost)
  const written = gridItemValue(storedPlace(primary.node, property, rules), start, span);
  if (typeof written !== 'string') {
    return { kind: 'refused', message: message(written.refused === 'start' ? 'status.gridItem.noStart' : 'status.gridItem.noSpan') };
  }
  const read = readValue(context, property, written);
  if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(property, rules), value: written }) };
  return writeStyle(context, property, read.css, longhandValues(property, read.value, context.rules));
});

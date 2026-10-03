// Filters (INVENTORY.md, owners; spec props-filters-clip): style.setFilter sets the filter functions it is
// given (blur: 4px) in the filter value of every selected element, each in its place or added last, one taken away for
// an empty argument, the whole declaration for none (Remove filters: removeStyle, reset.ts), in one undo step through
// writeStyle. The value the functions make is read by the property's codec and written only when the browser takes it,
// else refused naming the field.
import { message, registerHandler } from '../commands/registry.ts';
import { locate } from '../document/model.ts';
import { withFunction } from './functions.ts';
import { removeStyle } from './reset.ts';
import { propertyName, readValue, typedText, writeStyle } from './set.ts';
import { storedValue } from './stored.ts';

// the functions to set (name → argument), each one added or replaced in the value
export function applyFunctions(held: string | undefined, functions: unknown): string | null {
  if (functions === null || typeof functions !== 'object' || Array.isArray(functions)) return null;
  let value: string | null = held ?? '';
  for (const [name, argument] of Object.entries(functions as Record<string, unknown>)) {
    if (value === null || typeof argument !== 'string') return null;
    value = withFunction(value, name, argument);
  }
  return value;
}

export const setFilterCommand = registerHandler('style.setFilter', (context, { property, functions }) => {
  const { state, rules } = context;
  // Remove filters: no functions means the declaration goes, not a filter: none left in its place
  if (functions === 'none') return removeStyle(context, property);
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null) return { kind: 'change' };
  const value = applyFunctions(storedValue(primary.node, property, rules), functions);
  const read = value === null ? null : readValue(context, property, value);
  if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(property, rules), value: value ?? typedText(functions) }) };
  return writeStyle(context, property, read.css);
});

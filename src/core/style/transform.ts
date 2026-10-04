// Transforms (INVENTORY.md, owners; spec props-transforms): style.setTransform sets the transform functions
// it is given (skewX: 10deg) in the transform value of every selected element, each in its place or added last, one
// taken away for an empty argument, in one undo step through writeStyle; the value they make is written only when the
// browser takes it. Translate, rotate and scale are their own properties, written by style.set.
import { message, registerHandler } from '../commands/registry.ts';
import { locate } from '../document/model.ts';
import { applyFunctions } from './filter.ts';
import { propertyName, readValue, withTargets, writeStyle } from './set.ts';
import { storedValue } from './stored.ts';

export const setTransformCommand = registerHandler('style.setTransform', (given, { property, parts, targets }) => {
  const context = withTargets(given, targets);
  if (context === null) return { kind: 'change' };
  const { state, rules } = context;
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  if (primary === null) return { kind: 'change' };
  const value = applyFunctions(storedValue(primary.node, property, rules), parts);
  const read = value === null ? null : readValue(context, property, value);
  if (read === null) return { kind: 'refused', message: message('status.value.invalid', { property: propertyName(property, rules), value: value ?? JSON.stringify(parts) }) };
  return writeStyle(context, property, read.css);
});

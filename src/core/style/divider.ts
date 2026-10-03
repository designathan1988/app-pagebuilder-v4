// element.setDivider (INVENTORY.md, owners; the user's real-use audit, item 8.1): the proportions of two
// neighbours in a flex row, dragged by the grip the canvas chrome draws on their boundary. The two children's real
// boxes come from the layout port; the width asked for the child before the boundary says the fraction of the room
// they share, and both take it as their growth (a basis of 0, so the row's free space splits by it and the proportion
// holds however the container is resized afterwards). A width below the least a column may take is bounded to it. The
// primary selected element must be a flex row (its own display and direction, both read by the names the command's own
// doors carry); a locked element, or one inside a locked element, is refused and keeps its proportions.
import type { NodeId  } from '../../generated/commands.ts';
import type { CommandId } from '../../generated/ids.ts';
import { message, registerHandler, registerPredicate, type Outcome } from '../commands/registry.ts';
import { locate, type Location, type StoredValue } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import type { Patch } from '../history/transaction.ts';
import { commandOf, numberConstant } from '../../manifest/runtime.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import { writeDeclarations } from './set.ts';
import { storedValue } from './stored.ts';

// the arguments a command's own doors carry, as text (the manifest's data)
const doorArgs = (command: CommandId): Readonly<Record<string, string>> => {
  const entry = commandOf(command).entryPoints[0];
  return Object.fromEntries(Object.entries(entry?.args ?? {}).map(([name, value]) => [name, String(value)]));
};

// the least a column of a row may measure, in CSS px (interactions.json)
const MIN_WIDTH = numberConstant('divider.minWidth');
// a fraction is written with at most these decimals
const PLACES = 2;
const round = (n: number): number => Math.round(n * 10 ** PLACES) / 10 ** PLACES;

// The row the boundary lies in: the primary selected element, holding children, laid out as a flex row.
function rowOf(state: { readonly document: Parameters<typeof locate>[0]; readonly selection: readonly NodeId[] }, rules: ModelRules): Location | null {
  const [only, ...others] = state.selection;
  if (only === undefined || others.length > 0) return null;
  const at = locate(state.document, only);
  if (at === null || at.node.children.length < 2) return null;
  const display = storedValue(at.node, ARGS.view ?? '', rules);
  if (display === undefined || !display.includes('flex') || display.includes('grid')) return null;
  const direction = storedValue(at.node, ARGS.axis ?? '', rules) ?? 'row';
  return direction.startsWith('row') ? at : null;
}

export const divideableSelection = registerPredicate('divideableSelection', (state, rules) => rowOf(state, rules) !== null, (state) =>
  message('status.divider.unavailable', { name: state.selection[0] === undefined ? '' : (locate(state.document, state.selection[0])?.node.name ?? '') }),
);

export const setDividerCommand = registerHandler('element.setDivider', (context, { index, value }): Outcome<never> => {
  const { state, rules, layout } = context;
  const at = rowOf(state, rules);
  // the availability predicate (divideableSelection) keeps anything else from reaching here
  if (at === null) throw new Error('element.setDivider: the selection is not one flex row');
  const before = at.node.children[index];
  const after = at.node.children[index + 1];
  if (before === undefined || after === undefined) return { kind: 'refused', message: message('status.divider.unavailable', { name: at.node.name }) };
  const locked = firstLockRefusal(state.document, [at.node.id as NodeId, before.id as NodeId, after.id as NodeId], 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const left = layout.box(before.id as NodeId);
  const right = layout.box(after.id as NodeId);
  // what the canvas does not draw cannot be read: the command says so instead of guessing
  if (left === null || right === null) return { kind: 'refused', message: message('status.divider.unmeasured', { name: at.node.name }) };
  const room = left.width + right.width;
  if (room <= 0) return { kind: 'refused', message: message('status.divider.unmeasured', { name: at.node.name }) };
  const asked = Number.parseFloat(value);
  if (!Number.isFinite(asked)) return { kind: 'refused', message: message('status.value.invalid', { value }) };
  const wanted = Math.min(Math.max(asked, MIN_WIDTH), Math.max(MIN_WIDTH, room - MIN_WIDTH));
  const fraction = round(wanted / room);
  const patches: Patch[] = [];
  for (const [child, share] of [
    [before, fraction],
    [after, round(1 - fraction)],
  ] as const) {
    const where = locate(state.document, child.id as NodeId);
    if (where === null) continue;
    const values: Record<string, StoredValue> = { [ARGS.grow ?? '']: String(share), [ARGS.basis ?? '']: '0px' };
    patches.push(...writeDeclarations(where.node, where.path, rules.base, values));
  }
  return {
    kind: 'change',
    patches,
    message: message('status.divider', { name: at.node.name, left: Math.round(fraction * 100), right: Math.round((1 - fraction) * 100) }),
  };
});

// the arguments element.setDivider's own doors carry, read after its registration
const ARGS = doorArgs(setDividerCommand.command);

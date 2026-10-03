// The direction an element lays its children along (INVENTORY.md, owners; the user's real-use audit, item
// 8.1): element.swapDirection writes the opposite of what the primary element holds — a flex row into a column and
// back, a grid's row auto flow into a column and back — for every selected element, at the breakpoint and state the
// editor edits, through style.set's one writer and its target rules (a class target, an instance's definition).
// element.stackOnPhone writes one column at the narrowest breakpoint alone (properties.json: the last of the cascade,
// the Phone), whatever breakpoint the editor edits: a flex container's direction, a grid's single track — the
// direction per breakpoint the audit asks for; the per-breakpoint override the Styles tab shows keeps working.
// Both are available on a stored flex or grid container (the valuePredicates' flexOrGridContainer, which
// style.setAlignment reads too); a locked element, or one inside a locked element, is refused and keeps its value.
//
// The property names they write are the arguments their own doors fix in the manifest (elements: a door's drawing,
// the command's arguments); no name is written by hand here.
import type { NodeId  } from '../../generated/commands.ts';
import type { CommandId } from '../../generated/ids.ts';
import { message, registerHandler, type MessageParam, type Outcome } from '../commands/registry.ts';
import { locate, type DocNode, type StoredValue } from '../document/model.ts';
import type { ModelRules } from '../document/validate.ts';
import type { Patch } from '../history/transaction.ts';
import { commandOf } from '../../manifest/runtime.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import { styleHolders, writeDeclarations, writeStyle } from './set.ts';
import { storedValue } from './stored.ts';
import { tracksForChildren } from './tracks.ts';
import { breakpointWords, type ProjectBreakpoint } from '../document/breakpoints.ts';

// the arguments a command's own doors carry, as text (the manifest's data)
const doorArgs = (command: CommandId): Readonly<Record<string, string>> => {
  const entry = commandOf(command).entryPoints[0];
  return Object.fromEntries(Object.entries(entry?.args ?? {}).map(([name, value]) => [name, String(value)]));
};
// the opposite of each flex direction, one turn of the axis
const OPPOSITE: Readonly<Record<string, string>> = { row: 'column', column: 'row', 'row-reverse': 'column-reverse', 'column-reverse': 'row-reverse' };

export const swapDirectionCommand = registerHandler('element.swapDirection', (context): Outcome<never> => {
  const { state, rules } = context;
  const nodes = state.selection.map((id) => locate(state.document, id)).filter((found) => found !== null);
  const primary = nodes[0];
  // the availability predicate (flexOrGridContainer) keeps an empty selection and a container of neither layout away
  if (primary === undefined) throw new Error('element.swapDirection: nothing is selected');
  const asked = laysOut(primary.node, rules);
  if (asked === null) return { kind: 'refused', message: message('status.swap.notContainer', { name: primary.node.name }) };
  const written = writeStyle(context, asked.property, asked.value);
  if (written.kind !== 'change') return written;
  return {
    ...written,
    message:
      nodes.length === 1
        ? message('status.swapped', { name: primary.node.name, property: asked.property, value: asked.value })
        : message('status.swappedMany', { count: nodes.length, property: asked.property, value: asked.value }),
  };
});

// The properties and the display this command reads, from its own doors' arguments
const SWAP = doorArgs(swapDirectionCommand.command);
const DIRECTION = SWAP.axis ?? '';
const FLOW = SWAP.flow ?? '';
const DISPLAY = SWAP.view ?? '';

// What the element lays its children along, and the value its opposite is: the property and value element.swapDirection
// writes, or null when the element's own display does not lay children out (a block's children stack as they come).
function laysOut(node: DocNode, rules: ModelRules): { readonly property: string; readonly value: string } | null {
  const display = storedValue(node, DISPLAY, rules);
  if (display === undefined) return null;
  if (display.includes('grid')) {
    const flow = storedValue(node, FLOW, rules) ?? 'row';
    return { property: FLOW, value: flow.includes('column') ? flow.replace('column', 'row') : flow.replace('row', 'column') };
  }
  if (display.includes('flex')) {
    const direction = storedValue(node, DIRECTION, rules) ?? 'row';
    return { property: DIRECTION, value: OPPOSITE[direction] ?? 'column' };
  }
  return null;
}

// The narrowest breakpoint of the page (properties.json lists the cascade widest first; the Phone is its last): where
// element.stackOnPhone writes, whatever breakpoint the editor edits.
function narrowest(rules: ModelRules): ProjectBreakpoint {
  const last = rules.breakpointTable.at(-1);
  if (last === undefined) throw new Error('the project names no breakpoint to stack at');
  return last;
}

// what a stack at the narrowest breakpoint writes into the element: its property and value (a grid's tracks, from the
// one owner of them)
function stackOf(node: DocNode, rules: ModelRules): { readonly property: string; readonly value: string } {
  const display = storedValue(node, DISPLAY, rules) ?? '';
  return display.includes('grid') ? { property: STACK.tracks ?? '', value: tracksForChildren(1, rules).columns } : { property: STACK.axis ?? '', value: 'column' };
}

// The value a node holds for a property at one breakpoint and state, its own only (nothing inherited): the layer a
// stack would write into.
const heldAt = (node: DocNode, property: string, breakpoint: string, state: string): StoredValue | undefined =>
  ((node.styles as Record<string, Record<string, Record<string, StoredValue>>>)[breakpoint]?.[state] ?? {})[property];

export const stackOnPhoneCommand = registerHandler('element.stackOnPhone', (context): Outcome<never> => {
  const { state, rules } = context;
  const nodes = state.selection.map((id) => locate(state.document, id)).filter((found) => found !== null);
  const primary = nodes[0];
  // the availability predicate (flexOrGridContainer) keeps an empty selection and a container of neither layout away
  if (primary === undefined) throw new Error('element.stackOnPhone: nothing is selected');
  const locked = firstLockRefusal(state.document, nodes.map((found) => found.node.id as NodeId), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const at = narrowest(rules);
  const layer = { breakpoint: at.id, state: rules.baseLayer.state };
  const patches: Patch[] = [];
  for (const holder of styleHolders(context, nodes)) {
    const asked = stackOf(holder.node, rules);
    if (heldAt(holder.node, asked.property, layer.breakpoint, layer.state) === asked.value) continue;
    patches.push(...writeDeclarations(holder.node, holder.path, layer, { [asked.property]: asked.value }));
  }
  const breakpoint: MessageParam = breakpointWords(at);
  return {
    kind: 'change',
    patches,
    message: nodes.length === 1 ? message('status.stacked', { name: primary.node.name, breakpoint }) : message('status.stackedMany', { count: nodes.length, breakpoint }),
  };
});

// the arguments element.stackOnPhone's own doors carry, read after its registration
const STACK = doorArgs(stackOnPhoneCommand.command);

// Resetting values (INVENTORY.md, owners; spec inspector-provenance-reset): style.reset takes one property
// (a composite: its longhands) away from the styles of every selected element at the base breakpoint and state, so the
// element shows what it inherits or its default again; style.resetAll takes every style value of the selected elements
// away, at every breakpoint and state, one undo step. A locked element refuses both; an element that holds nothing to
// take away records nothing.
// The taking away is one rule (removeStyle), shared with the other commands whose door means "away with it": the
// filter's Remove filters and the gradient editor's Remove the gradient go through it, so no door leaves a dead
// declaration behind. A declaration a coupling filled in (couplings.ts, setValue) goes with its trigger while it still
// holds exactly the value the coupling wrote: a rule width reset takes the solid rule style it made with it, and a
// style a person set otherwise stays.
import { message, registerHandler, type HandlerContext, type Outcome } from '../commands/registry.ts';
import { locate, type NodeId } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import { propertyName, styleHolders, writeDeclarations } from './set.ts';
import { storedValue } from './stored.ts';

export function removeStyle<Ui>(context: HandlerContext<Ui>, property: string): Outcome<Ui> {
  const { state, rules } = context;
  const nodes = state.selection.map((id) => locate(state.document, id)).filter((found) => found !== null);
  const primary = nodes[0];
  if (primary === undefined) return { kind: 'change' };
  const locked = firstLockRefusal(state.document, nodes.map((found) => found.node.id as NodeId), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const names = rules.compositeFacts.get(property)?.longhands ?? [property];
  const gone = Object.fromEntries(names.map((name) => [name, null] as const));
  const holders = styleHolders(context, nodes);
  const patches: Patch[] = holders.flatMap((held) => {
    const removed: Record<string, null> = { ...gone };
    for (const coupling of rules.couplings) {
      const effect = coupling.effect;
      if (!names.includes(coupling.trigger.property) || coupling.trigger.via !== null) continue;
      if (effect.action !== 'setValue' || effect.value === null || effect.property === null) continue;
      if (effect.property in removed) continue;
      if (storedValue(held.node, effect.property, rules) === effect.value) removed[effect.property] = null;
    }
    return writeDeclarations(held.node, held.path, rules.base, removed);
  });
  // several elements are named by their count (J28)
  if (holders.length > 1) return { kind: 'change', patches, message: message('status.style.resetMany', { property: propertyName(property, rules), count: holders.length }) };
  return { kind: 'change', patches, message: message('status.style.reset', { property: propertyName(property, rules), name: holders[0]?.name ?? primary.node.name }) };
}

export const resetValueCommand = registerHandler('style.reset', (context, { property }) => removeStyle(context, property));

export const resetAllCommand = registerHandler('style.resetAll', (context) => {
  const { state } = context;
  const nodes = state.selection.map((id) => locate(state.document, id)).filter((found) => found !== null);
  const primary = nodes[0];
  if (primary === undefined) return { kind: 'change' };
  const locked = firstLockRefusal(state.document, nodes.map((found) => found.node.id as NodeId), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const holders = styleHolders(context, nodes);
  const patches: Patch[] = holders.filter((held) => Object.keys(held.node.styles).length > 0).map((held) => ({ op: 'replace', path: [...held.path, 'styles'], value: {} }));
  if (holders.length > 1) return { kind: 'change', patches, message: message('status.style.resetAllMany', { count: holders.length }) };
  return { kind: 'change', patches, message: message('status.style.resetAll', { name: holders[0]?.name ?? primary.node.name }) };
});

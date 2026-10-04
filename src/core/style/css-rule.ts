// style.applyCssRule (INVENTORY.md, owners; the manifest's code-panel-edit-css): the CSS the person edited in
// the code pane's rule for the selected element, written on it. The declarations are parsed by the one owner of a
// declarations text (style/custom.ts parseDeclarations: "property: value" pairs, a shorthand expanded by its codec, a
// url() put to the one rule of an address, the first wrong piece refused naming its line and why) and replace the
// declarations the element holds at the active breakpoint and style state (rules.base, what the editor edits —
// breakpoint-overrides, state-styles), as one undo step. A locked element refuses (spec lock-element).
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler } from '../commands/registry.ts';
import { locate } from '../document/model.ts';
import { replaceLayer } from './set.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { parseDeclarations } from './custom.ts';

export const applyCssRuleCommand = registerHandler('style.applyCssRule', (context, { css }) => {
  const { state } = context;
  const id = state.selection.length === 1 ? state.selection[0] : undefined;
  if (id === undefined) return { kind: 'refused' as const, message: message('status.needsSingleSelection') };
  const at = locate(state.document, id);
  if (at === null) throw new Error(`style.applyCssRule: the document has no node ${id as NodeId}`);
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused' as const, message: locked };
  const parsed = parseDeclarations(String(css ?? ''), context);
  if ('refused' in parsed) return { kind: 'refused' as const, message: parsed.refused };
  const { breakpoint, state: base } = context.rules.base;
  const byBreakpoint = (at.node.styles as Record<string, Record<string, Record<string, string>> | undefined>)[breakpoint];
  const wanted = Object.fromEntries(parsed.declarations);
  const current = byBreakpoint?.[base] ?? {};
  const same = Object.keys(current).length === Object.keys(wanted).length && Object.entries(wanted).every(([property, value]) => current[property] === value);
  const said = message('status.css.applied', { name: at.node.name });
  if (same) return { kind: 'change' as const, message: said };
  // the one writer of declarations, through the holders every style write goes to (the audit's OW1)
  return { kind: 'change' as const, patches: replaceLayer(context, at, wanted), message: said };
});

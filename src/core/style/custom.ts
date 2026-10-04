// style.setCustomDeclarations (INVENTORY.md, owners; feature props-attributes): the element's declarations
// written as CSS text, one "property: value;" each, at the base breakpoint and state. The text replaces the
// declarations the element holds there: a property written is stored with its value, a property left out is removed.
// A property is an edited property of properties.json, a custom property of the person's own (--brand, the user's
// real-use audit, item A3.33) or a shorthand an owner reads (background, border: the composite's codec expands it into
// its longhands, which are what is stored); every value is non-empty CSS text without braces inside; the first piece
// that is not is refused naming its line and why (status.css.notDeclaration, status.css.unknownProperty,
// status.css.badValue), and the document keeps its declarations. One undo step; a locked element refuses (spec
// lock-element). The declarations are written to the page by the renderer through the element's own style rule, never
// as a style attribute.
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, type HandlerContext, type Message, type Outcome } from '../commands/registry.ts';
import { locate } from '../document/model.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { declarationsOf, readValue, replaceLayer } from './set.ts';
import { readAddress } from '../elements/address.ts';

// every address a url(…) in a value carries, in order (spec props-attributes, the audit's A3.2)
function addressesIn(value: string): readonly string[] {
  const found: string[] = [];
  for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*))\s*\)/gi)) {
    const address = match[1] ?? match[2] ?? match[3] ?? '';
    if (address !== '') found.push(address.trim());
  }
  return found;
}

// "property: value" pairs of CSS text, or why the first piece that is wrong is wrong, naming its line
export function parseDeclarations<Ui>(text: string, context: HandlerContext<Ui>): { readonly declarations: ReadonlyMap<string, string> } | { readonly refused: Message } {
  const { rules } = context;
  const declarations = new Map<string, string>();
  const lines = text.split('\n');
  for (const [i, raw] of lines.entries()) {
    for (const part of raw.split(';')) {
      const piece = part.trim();
      if (piece === '') continue;
      const colon = piece.indexOf(':');
      if (colon <= 0) return { refused: message('status.css.notDeclaration', { line: i + 1, text: piece }) };
      const property = piece.slice(0, colon).trim().toLowerCase();
      const value = piece.slice(colon + 1).trim();
      // the person's own custom property: any --name, its value kept as typed
      if (property.startsWith('--')) {
        if (value === '' || /[{}]/.test(value)) return { refused: message('status.css.badValue', { line: i + 1, property, value }) };
        declarations.set(property, value);
        continue;
      }
      // a shorthand an owner reads: expanded into its longhands here, so the store holds what is written out
      if (rules.compositeFacts.has(property)) {
        const read = readValue(context, property, value);
        if (read === null) return { refused: message('status.css.badValue', { line: i + 1, property, value }) };
        for (const [longhand, written] of Object.entries(declarationsOf(property, read, rules))) declarations.set(longhand, written);
        continue;
      }
      if (!rules.properties.has(property)) return { refused: message('status.css.unknownProperty', { line: i + 1, property }) };
      if (value === '' || /[{}]/.test(value)) return { refused: message('status.css.badValue', { line: i + 1, property, value }) };
      // a url() inside a declaration is an address: the one rule of an address decides (core/elements/address.ts, the
      // audit's A3.2), so url("javascript:…") is refused with its reason
      for (const address of addressesIn(value)) {
        const read = readAddress(address);
        if (!read.ok) return { refused: read.refusal };
      }
      declarations.set(property, value);
    }
  }
  return { declarations };
}

export const setCustomDeclarationsCommand = registerHandler('style.setCustomDeclarations', (context, { declarations, target }): Outcome<never> => {
  const { state, rules } = context;
  const id = (target as NodeId | undefined) ?? (state.selection.length === 1 ? state.selection[0] : undefined);
  if (id === undefined) return { kind: 'refused', message: message('status.needsSingleSelection') };
  const at = locate(state.document, id);
  if (at === null) throw new Error(`style.setCustomDeclarations: the document has no node ${id}`);
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const parsed = parseDeclarations(String(declarations), context);
  if ('refused' in parsed) return { kind: 'refused', message: parsed.refused };
  const { breakpoint, state: base } = rules.base;
  const byBreakpoint = (at.node.styles as Record<string, Record<string, Record<string, string>> | undefined>)[breakpoint];
  const current = byBreakpoint?.[base] ?? {};
  const wanted = Object.fromEntries(parsed.declarations);
  const same = Object.keys(current).length === Object.keys(wanted).length && Object.entries(wanted).every(([p, v]) => current[p] === v);
  const said = message('status.style.declarationsSet', { name: at.node.name, count: parsed.declarations.size });
  if (same) return { kind: 'change', message: said };
  // the one writer of declarations, through the holders every style write goes to (the audit's OW1)
  return { kind: 'change' as const, patches: replaceLayer(context, at, wanted), message: said };
});

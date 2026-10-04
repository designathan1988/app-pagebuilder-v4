// text.set (INVENTORY.md, owners; spec text-edit-inline): writes a text element's text in one transaction.
// Its doors are the end of an inline edit (Enter, a click outside the edited element) and the inspector's text field;
// each hands the node and the content it produced: a plain text, or (an inline edit of a text that is or was marked,
// spec text-inline-formatting) its whole tree of runs (src/core/text/inline.ts). A line break is stored as "\n" (the
// renderer draws it as <br>). The plain text is always stored in `text`; the canonical tree goes in `inline` only
// while something is marked. A plain text written over a marked one keeps the marks of what it keeps (the same text
// keeps them all); a tree with no mark removes them. A link whose address is not allowed is refused
// (status.link.unsafe) and nothing is written. The same content records nothing (the manifest's history.noChange
// "no-entry"), and the status bar says the text is kept either way (spec: "Text kept."). The text of a locked element,
// or of one inside a locked element, is refused and stays (spec lock-element).
import { message, registerHandler } from '../commands/registry.ts';
import { locate } from '../document/model.ts';
import { deepEqual, type Patch } from '../history/transaction.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { canonical, hasMarks, keptHref, mapInlineLinks, parseInline, plainText, withText, type InlineRun } from './inline.ts';
import { argumentRefused } from '../store/args.ts';

export const setTextCommand = registerHandler('text.set', ({ state, rules }, { target, content }) => {
  const found = locate(state.document, target);
  // a door hands the node it edits and the content the edit produced; anything else is a defect of the door
  if (!found) throw new Error(`text.set: the document has no node ${target}`);
  if (rules.elements.get(found.node.type)?.content !== 'text') return { kind: 'refused', message: message('status.element.notApplicable', { command: { key: 'command.editText' }, name: found.node.name }) };
  // a plain text keeps the marks of what it keeps of a marked text (the inspector's text field); a tree is whole
  // a link the content brings keeps the address the rule reads (keptHref: the audit's AD2)
  const parsed = typeof content === 'string' ? withText(found.node.inline ?? [found.node.text ?? ''], content) : parseInline(content);
  const runs = Array.isArray(parsed) ? [...mapInlineLinks(parsed, keptHref)] : parsed;
  if (runs === null) return { kind: 'refused', message: argumentRefused('content') };
  // the text of a locked element, or of one inside a locked element, stays (spec lock-element)
  const locked = lockRefusal(state.document, target, 'status.locked.editText');
  if (locked !== null) return { kind: 'refused', message: locked };
  if (runs === 'unsafe') return { kind: 'refused', message: message('status.link.unsafe') };
  const text = plainText(runs);
  const inline: readonly InlineRun[] | null = hasMarks(runs) ? canonical(runs) : null;
  const patches: Patch[] = [];
  if (found.node.text !== text) patches.push({ op: 'replace', path: [...found.path, 'text'], value: text });
  const stored = found.node.inline ?? null;
  if (inline === null && stored !== null) patches.push({ op: 'remove', path: [...found.path, 'inline'] });
  else if (inline !== null && !deepEqual(stored, inline)) patches.push({ op: stored === null ? 'add' : 'replace', path: [...found.path, 'inline'], value: inline });
  // a text kept as it was says so (Escape and Enter both keep an edit: "Saved" for nothing saved misled)
  if (patches.length === 0) return { kind: 'change', message: message('status.textEdit.cancelled', { name: found.node.name }) };
  return { kind: 'change', patches, message: message('status.textEdit.committed', { name: found.node.name }) };
});

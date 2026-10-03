// element.applyHtml (INVENTORY.md, owners; the manifest's code-panel-edit-html): the markup the person
// edited in the code pane's HTML tab, read as nodes by the importer's rules (src/core/import/import.ts, the one owner
// of turning markup into nodes) and written on the document in place of the selected element's subtree. The element
// keeps its id and its name — the markup's root IS that element, so its tag, its attributes and its text come from the
// markup while its identity and its styles stay — and a node the markup leaves where it was (the same position among
// its parent's children, the same tag and type) keeps its id, its name and its styles: what the markup does not say,
// the document keeps; what the markup moves, adds or retags is a new element. One undo step; a locked element refuses
// (spec lock-element), and markup the model refuses is refused with the line of the piece that is wrong and why.
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, type HandlerContext } from '../commands/registry.ts';
import { placementRefusal } from '../elements/content-model.ts';
import { locate, walk, type DocNode } from '../document/model.ts';
import { releaseReferencesPatch, withoutReferencesTo } from '../document/tree.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { nodeMaker } from '../structure/node-maker.ts';
import { nodesFromMarkup } from './import.ts';

// the node the document holds, as the markup writes it: the markup's tag, attributes, classes and text; the document's
// identity and styles; the held children matched against the markup's own, one by one
function reconciled(before: DocNode, made: DocNode): DocNode {
  const children = made.children.map((child, at) => {
    const held = before.children[at];
    return held !== undefined && held.type === child.type && held.tag === child.tag ? reconciled(held, child) : child;
  });
  return {
    ...before,
    tag: made.tag,
    attributes: made.attributes,
    classes: made.classes.length > 0 ? made.classes : before.classes,
    text: made.text,
    ...(made.inline === undefined ? {} : { inline: made.inline }),
    children,
  };
}

export const applyHtmlCommand = registerHandler('element.applyHtml', (context, { html }) => {
  const { state, rules, ids, words } = context;
  const id = state.selection.length === 1 ? state.selection[0] : undefined;
  if (id === undefined) return { kind: 'refused' as const, message: message('status.needsSingleSelection') };
  const at = locate(state.document, id);
  if (at === null) throw new Error(`element.applyHtml: the document has no node ${id as NodeId}`);
  const locked = lockRefusal(state.document, at.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused' as const, message: locked };
  const imported = nodesFromMarkup(String(html ?? ''), nodeMaker(state.document, rules, ids, words), context as HandlerContext<never>);
  if ('line' in imported) return { kind: 'refused' as const, message: imported.message };
  const root = imported.nodes[0];
  // the markup of an element is that one element: none, or more than one, is markup for something else
  if (root === undefined || imported.nodes.length !== 1) return { kind: 'refused' as const, message: message('status.html.invalidAt', { line: 1, reason: { key: 'status.html.oneElement' } }) };
  // the root is the element itself: its own markup may not say it is something the element's parent refuses
  if (at.parent !== null) {
    const refusal = placementRefusal(state.document, rules, at.parent.id, [root]);
    if (refusal !== null) return { kind: 'refused' as const, message: refusal };
  }
  const reconciledNode = reconciled(at.node, root);
  // What the markup dropped leaves the document: a reference inside the written subtree goes with it (the value-level
  // rule — the node is written back, so a patch would put the old value back), and a reference elsewhere in the
  // document is released by its own patch (the plan's T1/T6; the kernel owns both shapes of the rule).
  const kept = new Set([...walk(reconciledNode)].map((inner) => inner.id as NodeId));
  const leaving = new Set([...walk(at.node)].map((inner) => inner.id as NodeId).filter((id) => !kept.has(id)));
  const written = leaving.size === 0 ? reconciledNode : withoutReferencesTo(reconciledNode, leaving);
  const same = JSON.stringify(at.node) === JSON.stringify(written);
  const said = message('status.html.applied', { name: at.node.name });
  if (same) return { kind: 'change' as const, message: said };
  const rootPath = at.path.join('/');
  const released =
    leaving.size === 0
      ? []
      : releaseReferencesPatch(state.document, leaving).filter((patch) => {
          // the written subtree carries its own release; these patches cover the references that stay where they are
          const owner = patch.path.slice(0, at.path.length).join('/');
          return owner !== rootPath;
        });
  return { kind: 'change' as const, patches: [{ op: 'replace', path: [...at.path], value: written }, ...released], message: said };
});

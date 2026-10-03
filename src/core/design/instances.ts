// Where an element stands among the project's components (spec reusable-components): the project's definitions, the
// root of the instance an element lies in, and the elements a style write on a part of an instance reaches. They read
// the document only, so the style writer (core/style/set.ts styleHolders) asks them without importing the component
// commands, which make elements through the structure commands that write styles (plan I.8: no cycle). The commands
// themselves are core/design/components.ts.
import type { NodeId } from '../../generated/commands.ts';
import { lineage, locate, type ComponentDefinition, type DocNode, type DocumentJson } from '../document/model.ts';
import { deepEqual } from '../history/transaction.ts';

const NONE: readonly ComponentDefinition[] = [];
export const componentsOf = (document: DocumentJson): readonly ComponentDefinition[] => document.components ?? NONE;

// the root of the instance a node lies in (the node itself or an ancestor naming a component), or null
export function instanceRootOf(document: DocumentJson, id: NodeId): DocNode | null {
  return lineage(document, id).findLast((node) => node.component !== undefined) ?? null;
}

// What a style write on an element goes to, when the element belongs to an instance: the definition's element (its
// path in the project's components, its parent there) and the element of the same part of every instance of the
// component in every page; null for an element of no instance, or one added to its instance alone.
export function componentHolders(document: DocumentJson, id: NodeId): { readonly node: DocNode; readonly path: readonly (string | number)[]; readonly parent: DocNode | null }[] | null {
  const found = locate(document, id);
  const part = found?.node.componentPart;
  const root = found === null ? null : instanceRootOf(document, found.node.id as NodeId);
  if (found === null || part === undefined || root === null || root.component === undefined) return null;
  const index = componentsOf(document).findIndex((c) => c.name === root.component);
  const definition = componentsOf(document)[index];
  if (definition === undefined) return null;
  // the definition's element of that part, and its parent
  let node: DocNode | undefined = definition.tree;
  let parent: DocNode | null = null;
  const path: (string | number)[] = ['components', index, 'tree'];
  for (const i of part) {
    parent = node ?? null;
    node = node?.children[i];
    path.push('children', i);
  }
  if (node === undefined) return null;
  const holders = [{ node, path, parent }];
  // the same part of every instance of the component
  const visit = (at: DocNode, atPath: (string | number)[], atParent: DocNode | null, instanceOf: string | null) => {
    const within = at.component ?? instanceOf;
    if (within === root.component && at.componentPart !== undefined && deepEqual(at.componentPart, part)) holders.push({ node: at, path: atPath, parent: atParent });
    at.children.forEach((child, i) => visit(child, [...atPath, 'children', i], at, within));
  };
  document.pages.forEach((page, i) => visit(page.tree, ['pages', i, 'tree'], null, null));
  return holders;
}

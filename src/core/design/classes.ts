// The project's style classes (INVENTORY.md, owners; spec shared-style-classes): a class is a name an element
// lists in its classes and the styles every element with it takes, kept with the project (the document's `classes`, in
// the order they were made). The one owner of:
//  - classes.create: the one selected element's own styles become a new class of the typed name, which the element then
//    lists last; the element holds no style of its own after it (the page looks the same).
//  - classes.apply: the class is listed last by every selected element that does not list it; a name the project has no
//    class of becomes a class with no styles, so it can be styled as a target.
//  - classes.detach: every selected element that lists the class stops listing it; the class stays in the project.
//    A name is a CSS class name (status.classes.badName); a class made twice is refused (status.classes.nameTaken); a
//    locked element, or one inside one, is refused (status.locked.edit). One undo step each.
//  - targetClass: the class a style write goes to (core/style/set.ts styleHolders): the class the editor names as the
//    style target (HandlerContext.styleClass), while the project has it and every selected element lists it.
import { isIdentifier } from '../text/identifier.ts';
import { message, registerHandler, type HandlerContext, type Outcome } from '../commands/registry.ts';
import { locate, walk, type DocNode, type DocumentJson, type NodeId, type Selection, type StyleClass } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import { commandOf } from '../../manifest/runtime.ts';

const NONE: readonly StyleClass[] = [];
export const classesOf = (document: DocumentJson): readonly StyleClass[] => document.classes ?? NONE;
// a CSS class name, as an element's classes take it (validate.ts): any language's letters (text/identifier.ts)
export const validClassName = (name: string): boolean => isIdentifier(name);

// Settings Classes uses the same project registry as + Class. A new word is defined once,
// before the element lists it, so its Style chip is immediately a writable target.
export function missingClassDefinitions(document: DocumentJson, names: readonly string[]): Patch[] {
  const existing = new Set(classesOf(document).map((styleClass) => styleClass.name));
  const missing: StyleClass[] = [];
  for (const name of names) {
    if (existing.has(name)) continue;
    existing.add(name);
    missing.push({ name, styles: {} });
  }
  if (missing.length === 0) return [];
  return document.classes === undefined
    ? [{ op: 'add', path: ['classes'], value: missing }]
    : missing.map((styleClass, index): Patch => ({ op: 'add', path: ['classes', classesOf(document).length + index], value: styleClass }));
}


// how many elements of the project list a class
export function usesOfClass(document: DocumentJson, name: string): number {
  let count = 0;
  for (const page of document.pages) for (const node of walk(page.tree)) if (node.classes.includes(name)) count += 1;
  return count;
}

// the selected elements, found in the document
const selectedNodes = <Ui>({ state }: HandlerContext<Ui>) => state.selection.map((id) => locate(state.document, id)).filter((found) => found !== null);

// The class a style write goes to, and its place in the project's list: the editor's style target, while the project
// has that class and every selected element lists it; null otherwise (the elements themselves).
export function targetClass<Ui>(context: HandlerContext<Ui>): { readonly index: number; readonly styleClass: StyleClass } | null {
  return classTarget(context.state.document, context.state.selection, context.styleClass ?? null);
}
// the same, for a document, a selection and the class named as the target
export function classTarget(document: DocumentJson, selection: Selection, name: string | null): { readonly index: number; readonly styleClass: StyleClass } | null {
  if (name === null) return null;
  const index = classesOf(document).findIndex((c) => c.name === name);
  const nodes = selection.map((id) => locate(document, id)?.node);
  if (index < 0 || nodes.length === 0 || !nodes.every((node) => node !== undefined && node.classes.includes(name))) return null;
  return { index, styleClass: classesOf(document)[index] as StyleClass };
}

// the patch that adds a class to the project's list
function classAdded(document: DocumentJson, styleClass: StyleClass): Patch {
  return document.classes === undefined ? { op: 'add', path: ['classes'], value: [styleClass] } : { op: 'add', path: ['classes', classesOf(document).length], value: styleClass };
}

export const createClassCommand = registerHandler('classes.create', (context, { name }): Outcome<never> => {
  const { state } = context;
  const typed = name.trim();
  const found = selectedNodes(context)[0];
  if (found === undefined) return { kind: 'change' };
  if (!isIdentifier(typed)) return { kind: 'refused', message: message('status.classes.badName', { name: typed }) };
  if (classesOf(state.document).some((c) => c.name === typed)) return { kind: 'refused', message: message('status.classes.nameTaken', { name: typed }) };
  const locked = firstLockRefusal(state.document, [found.node.id as NodeId], 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const patches: Patch[] = [classAdded(state.document, { name: typed, styles: found.node.styles })];
  if (Object.keys(found.node.styles).length > 0) patches.push({ op: 'replace', path: [...found.path, 'styles'], value: {} });
  if (!found.node.classes.includes(typed)) patches.push({ op: 'replace', path: [...found.path, 'classes'], value: [...found.node.classes, typed] });
  return { kind: 'change', patches, message: message('status.classes.created', { name: typed, element: found.node.name }) };
});

export const applyClassCommand = registerHandler('classes.apply', (context, { className }): Outcome<never> => {
  const { state } = context;
  const typed = className.trim();
  const nodes = selectedNodes(context);
  if (nodes.length === 0) return { kind: 'change' };
  if (!isIdentifier(typed)) return { kind: 'refused', message: message('status.classes.badName', { name: typed }) };
  const without = nodes.filter((found) => !found.node.classes.includes(typed));
  const locked = firstLockRefusal(state.document, without.map((found) => found.node.id as NodeId), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const said = message('status.classes.applied', { name: typed });
  if (without.length === 0) return { kind: 'change', message: said };
  const defined = classesOf(state.document).some((c) => c.name === typed);
  const patches: Patch[] = [
    ...(defined ? [] : [classAdded(state.document, { name: typed, styles: {} })]),
    ...without.map((found): Patch => ({ op: 'replace', path: [...found.path, 'classes'], value: [...found.node.classes, typed] })),
  ];
  return { kind: 'change', patches, message: said };
});

export const detachClassCommand = registerHandler('classes.detach', (context, { className }): Outcome<never> => {
  const { state } = context;
  const holding = selectedNodes(context).filter((found) => found.node.classes.includes(className));
  if (holding.length === 0) return { kind: 'change' };
  const locked = firstLockRefusal(state.document, holding.map((found) => found.node.id as NodeId), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const patches: Patch[] = holding.map((found) => ({ op: 'replace', path: [...found.path, 'classes'], value: found.node.classes.filter((c) => c !== className) }));
  return { kind: 'change', patches, message: message('status.classes.detached', { name: className }) };
});

// All uses across all pages, in document order. A project class has one definition; a rename or
// deletion changes that definition and every element naming it in one transaction.
function classUses(document: DocumentJson, name: string) {
  return document.pages.flatMap((page) => [...walk(page.tree)].filter((node) => node.classes.includes(name)).map((node) => locate(document, node.id)).filter((at) => at !== null));
}

// Every element that lists a class, with its path: the pages' (classUses) and the components' definitions', whose
// instances placed later list what the definition lists (the audit's RF1: a renamed class stayed in a definition, and
// every instance placed after it came out unstyled).
function classListers(document: DocumentJson, name: string): { readonly node: DocNode; readonly path: readonly (string | number)[] }[] {
  const found: { node: DocNode; path: readonly (string | number)[] }[] = classUses(document, name).map((at) => ({ node: at.node, path: at.path }));
  const visit = (node: DocNode, path: readonly (string | number)[]): void => {
    if (node.classes.includes(name)) found.push({ node, path });
    node.children.forEach((child, i) => visit(child, [...path, 'children', i]));
  };
  (document.components ?? []).forEach((component, i) => visit(component.tree, ['components', i, 'tree']));
  return found;
}

// Shared by class renaming and collision isolation of an imported group.
export function renameClassPatches(document: DocumentJson, className: string, nextName: string): Patch[] {
  const index = classesOf(document).findIndex(c => c.name === className);
  return [
    ...(index < 0 ? [] : [{ op: 'replace' as const, path: ['classes', index, 'name'], value: nextName }]),
    ...classListers(document, className).map((at): Patch => ({ op: 'replace', path: [...at.path, 'classes'], value: at.node.classes.map(name => name === className ? nextName : name) })),
  ];
}

export const renameClassCommand = registerHandler('classes.rename', ({ state }, { className, nextName }): Outcome<never> => {
  const typed = nextName.trim();
  const index = classesOf(state.document).findIndex((c) => c.name === className);
  if (index < 0 || className === typed) return { kind: 'change' };
  if (!isIdentifier(typed)) return { kind: 'refused', message: message('status.classes.badName', { name: typed }) };
  if (classesOf(state.document).some((c) => c.name === typed)) return { kind: 'refused', message: message('status.classes.nameTaken', { name: typed }) };
  const uses = classUses(state.document, className);
  const locked = firstLockRefusal(state.document, uses.map((at) => at.node.id as NodeId), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const patches = renameClassPatches(state.document, className, typed);
  return { kind: 'change', patches, message: message('status.classes.renamed', { oldName: className, name: typed }) };
});

export const deleteClassCommand = registerHandler('classes.delete', ({ state, confirmed }, { className }): Outcome<never> => {
  const classes = classesOf(state.document);
  const index = classes.findIndex((c) => c.name === className);
  if (index < 0) return { kind: 'change' };
  const uses = classUses(state.document, className);
  const locked = firstLockRefusal(state.document, uses.map((at) => at.node.id as NodeId), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  if (!confirmed) return { kind: 'confirm', params: { count: uses.length } };
  const patches: Patch[] = [
    ...classListers(state.document, className).map((at): Patch => ({ op: 'replace', path: [...at.path, 'classes'], value: at.node.classes.filter((name) => name !== className) })),
    classes.length === 1 ? { op: 'remove', path: ['classes'] } : { op: 'remove', path: ['classes', index] },
  ];
  return { kind: 'change', patches, message: message('status.classes.deleted', { name: className, count: uses.length }) };
});

// The styles of one styles object laid over another's (breakpoint → state → property): the over one's values win.
function mergedStyles(under: StyleClass['styles'], over: StyleClass['styles']): StyleClass['styles'] {
  const merged: Record<string, Record<string, Record<string, unknown>>> = JSON.parse(JSON.stringify(under ?? {}));
  for (const [breakpoint, states] of Object.entries(over ?? {})) {
    for (const [state, declarations] of Object.entries(states ?? {})) {
      merged[breakpoint] = merged[breakpoint] ?? {};
      merged[breakpoint][state] = { ...(merged[breakpoint][state] ?? {}), ...(declarations ?? {}) };
    }
  }
  return merged as StyleClass['styles'];
}

// classes.moveInto (the plan's stage 7, "mover para classe existente"; journey D1): the primary selected element's own
// styles go into a class the project has, laid over the class's (the element looked as it does, and now the class says
// it), the element keeps none of its own and lists the class; one undo step. Every element listing the class takes the
// moved styles with it, which is the point.
export const moveIntoClassCommand = registerHandler('classes.moveInto', (context, { className }): Outcome<never> => {
  const { state } = context;
  const found = selectedNodes(context)[0];
  if (found === undefined) return { kind: 'change' };
  const index = classesOf(state.document).findIndex((c) => c.name === className);
  if (index < 0) return { kind: 'refused', message: message('status.classes.unknown', { name: className }) };
  if (Object.keys(found.node.styles).length === 0) return { kind: 'refused', message: message('status.classes.nothingToMove', { element: found.node.name }) };
  const locked = firstLockRefusal(state.document, [found.node.id as NodeId], 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const styleClass = classesOf(state.document)[index] as StyleClass;
  const patches: Patch[] = [
    { op: 'replace', path: ['classes', index, 'styles'], value: mergedStyles(styleClass.styles, found.node.styles) },
    { op: 'replace', path: [...found.path, 'styles'], value: {} },
  ];
  if (!found.node.classes.includes(className)) patches.push({ op: 'replace', path: [...found.path, 'classes'], value: [...found.node.classes, className] });
  return { kind: 'change', patches, message: message('status.classes.moved', { element: found.node.name, name: className }) };
});

// classes.applyToSimilar (the plan's stage 7, "aplicar a todos os parecidos"): the class goes on the elements of a
// scope that do not list it yet, one undo step; a locked one refuses the whole change. The scope (the audit's AUD-19:
// the three price cards' class went on the three benefit cards too): the elements of the primary selected element's
// type on its page, the narrowest and the default; or on every page. The selected elements themselves take a class with
// + Class (classes.apply), its one owner.
export const applyToSimilarCommand = registerHandler('classes.applyToSimilar', (context, { className, scope }): Outcome<never> => {
  const { state } = context;
  const found = selectedNodes(context)[0];
  if (found === undefined) return { kind: 'change' };
  if (!classesOf(state.document).some((c) => c.name === className)) return { kind: 'refused', message: message('status.classes.unknown', { name: className }) };
  const onPage = (scope ?? PAGE_SCOPE) === PAGE_SCOPE;
  const pool = (onPage ? [state.document.pages[found.page]] : state.document.pages).flatMap((page) => (page === undefined ? [] : [...walk(page.tree)])).filter((node) => node.type === found.node.type);
  const without = pool.filter((node) => !node.classes.includes(className));
  if (without.length === 0) return { kind: 'refused', message: message('status.classes.noSimilar', { name: className }) };
  const locked = firstLockRefusal(state.document, without.map((node) => node.id as NodeId), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  const patches = without.map((node): Patch => {
    const at = locate(state.document, node.id) as NonNullable<ReturnType<typeof locate>>;
    return { op: 'replace', path: [...at.path, 'classes'], value: [...node.classes, className] };
  });
  return { kind: 'change', patches, message: message('status.classes.appliedToSimilar', { name: className, count: without.length }) };
});
// the narrowest scope, as the command's argument lists it first (manifest/commands/design-system.json): the page
const [PAGE_SCOPE] = commandOf(applyToSimilarCommand.command).args.scope?.values ?? [];

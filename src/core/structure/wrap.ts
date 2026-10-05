// element.wrapRow, element.wrapColumn, element.wrapContainer and element.wrapGrid (INVENTORY.md, owners):
// the one owner of the Row, Column, Container and Grid wrappers (spec wrap-row-column, Problems 1 and 3; the user's
// real-use audit, item 8.1). The selected roots, which must share one parent, are replaced at
// the first one's index by a new element of the wrapper's definition (elements.json wrappers, one for every door),
// named in the person's language and numbered when the name is taken, holding them in their order, with the
// wrapper's styles at the base breakpoint and state; the status names the styles it added. A wrapper that lays one
// equal track per element (the grid) writes grid-template-columns for the count it holds, with its breakpoint
// overrides from interactions.json (A1.4: two tracks at Tablet while it holds more, one at Phone). The page root
// cannot be wrapped, nor a locked element or one inside a locked element (spec lock-element), and a parent whose
// content model refuses the wrapper's element refuses it; nothing changes then. The
// wrapper becomes the selection. element.unwrap (feature unwrap, below) takes a wrapper away and lifts its children.
import { instanceMoveRefusal } from '../design/components.ts';
import type { NodeId } from '../../generated/commands.ts';
import { message, registerHandler, registerPredicate, type HandlerContext, type Outcome } from '../commands/registry.ts';
import { locate, type DocNode, type Location, type StoredValue, type Styles } from '../document/model.ts';
import { childPath, leavingNames, movesIntoItself, releaseReferencesPatch, removeSubtree, withoutReferencesTo } from '../document/tree.ts';
import type { ModelRules, WrapperId } from '../document/validate.ts';
import { applyPatches, type Patch } from '../history/transaction.ts';
import { firstLockRefusal, lockRefusal } from '../nodes/flags.ts';
import { childrenRefusal, placementRefusal } from '../elements/content-model.ts';
import { valuePredicateHolds } from '../style/couplings.ts';
import { tracksForChildren } from '../style/tracks.ts';
import { paletteNode, uniqueName } from './insert.ts';
import { freshName, nodeMaker } from './node-maker.ts';
import { selectionRoots } from './remove.ts';

// the styles as the status names them: "display: flex; flex-direction: row"
const stylesText = (styles: Readonly<Record<string, string>>): string =>
  Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');

// The children of a wrapper built here, with the wrapper's own child styles (the Row's columns grow alike, exactly as
// the template's children do: spec wrap-row-column, Problems in Pager 4)
const withChildStyles = (rules: ModelRules, children: readonly DocNode[], childStyles: Readonly<Record<string, string>> | undefined): DocNode[] => {
  if (childStyles === undefined || Object.keys(childStyles).length === 0) return [...children];
  const { breakpoint, state } = rules.baseLayer;
  return children.map((child) => {
    const styles = child.styles as Record<string, Record<string, Record<string, StoredValue>>>;
    const byBreakpoint = styles[breakpoint] ?? {};
    const written = { ...styles, [breakpoint]: { ...byBreakpoint, [state]: { ...(byBreakpoint[state] ?? {}), ...childStyles } } };
    return { ...child, styles: written as Styles };
  });
};
// The child styles of the wrapper definition a node was made by: a wrapper of that element type whose own styles the
// node still holds at the base layer; none for any other node.
function wrapperChildStyles(rules: ModelRules, node: DocNode): Readonly<Record<string, string>> {
  const { breakpoint, state } = rules.baseLayer;
  const own = (node.styles as Record<string, Record<string, Record<string, StoredValue>> | undefined>)[breakpoint]?.[state] ?? {};
  for (const definition of rules.wrappers.values()) {
    if (definition.element !== node.type || Object.keys(definition.childStyles).length === 0) continue;
    if (Object.entries(definition.styles).every(([property, value]) => own[property] === value)) return definition.childStyles;
  }
  return {};
}

// A child without the declarations a wrapper gave it, where it still holds them as given.
function withoutChildStyles(rules: ModelRules, child: DocNode, given: Readonly<Record<string, string>>): DocNode {
  if (Object.keys(given).length === 0) return child;
  const { breakpoint, state } = rules.baseLayer;
  const styles = child.styles as Record<string, Record<string, Record<string, StoredValue>>>;
  const layer = styles[breakpoint]?.[state];
  if (layer === undefined) return child;
  const rest = Object.fromEntries(Object.entries(layer).filter(([property, value]) => given[property] !== value));
  if (Object.keys(rest).length === Object.keys(layer).length) return child;
  const byBreakpoint = Object.fromEntries(Object.entries(styles[breakpoint] ?? {}).filter(([one]) => one !== state || Object.keys(rest).length > 0).map(([one, declarations]) => [one, one === state ? rest : declarations]));
  const next = Object.fromEntries(Object.entries(styles).filter(([one]) => one !== breakpoint || Object.keys(byBreakpoint).length > 0).map(([one, layers]) => [one, one === breakpoint ? byBreakpoint : layers]));
  return { ...child, styles: next as Styles };
}

// the selected nodes no other selected node contains, in the order they sit in their parent
function roots(selection: readonly NodeId[], at: (id: NodeId) => Location): Location[] {
  const chosen = new Set(selection);
  const found = selection.map(at).filter((l) => {
    for (let up = l.parent; up !== null; up = at(up.id).parent) if (chosen.has(up.id)) return false;
    return true;
  });
  return found.sort((a, b) => a.index - b.index);
}

function wrap(id: WrapperId, { state, ids, rules, words, confirmed }: HandlerContext<never>): Outcome<never> {
  const at = (node: NodeId): Location => {
    const found = locate(state.document, node);
    // the selection only names nodes of the document, so an unknown one is a defect of the store
    if (found === null) throw new Error(`element.wrap: the document has no node ${String(node)}`);
    return found;
  };
  const selected = roots(state.selection, at);
  const first = selected[0];
  // the availability predicate (hasSelection) keeps an empty selection from reaching here
  if (first === undefined) throw new Error('element.wrap: nothing is selected');
  if (selected.some((l) => l.parent === null)) return { kind: 'refused', message: message('status.wrap.root') };
  const parent = first.parent as DocNode;
  if (selected.some((l) => l.parent?.id !== parent.id)) return { kind: 'refused', message: message('status.wrap.needsSameParent') };
  // a locked root, or one inside a locked element, is not wrapped (spec lock-element)
  const locked = firstLockRefusal(state.document, selected.map((l) => l.node.id), 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  // The person is asked first where the wrapper changes what the page shows (the user's real-use audit, item A3.13): a
  // selected element is positioned, so the wrapper takes it out of the flow it was placed in, or the selected siblings
  // are not next to each other, so the elements between them come out in another order than they showed.
  if (confirmed !== true) {
    const positioned = selected.some((l) => valuePredicateHolds(l.node, 'positionedSelection', rules, state.document.classes));
    const nextToEachOther = selected.every((l, i) => i === 0 || l.index === (selected[i - 1] as Location).index + 1);
    if (positioned || !nextToEachOther) return { kind: 'confirm' };
  }

  const wrapper = rules.wrappers.get(id);
  const element = wrapper === undefined ? undefined : rules.elements.get(wrapper.element);
  if (wrapper === undefined || element === undefined) throw new Error(`element.wrap: elements.json defines no ${id} wrapper`);
  const tag = element.tags[0] ?? null;

  // the wrapper's styles at the base layer, and the tracks a per-child grid lays (A1.4) over them
  const perChild = wrapper.perChildTracks === true ? tracksForChildren(selected.length, rules) : null;
  const baseStyles: Readonly<Record<string, string>> = perChild === null ? wrapper.styles : { ...wrapper.styles, [perChild.property]: perChild.columns };
  const base = rules.baseLayer;
  const layer = (styles: Readonly<Record<string, string>>): Record<string, Readonly<Record<string, string>>> => ({ [base.state]: styles });
  const styles = {
    ...(Object.keys(baseStyles).length > 0 ? { [base.breakpoint]: layer(baseStyles) } : {}),
    ...Object.fromEntries(Object.entries(perChild?.layers ?? {}).map(([breakpoint, columns]) => [breakpoint, layer({ [perChild?.property ?? '']: columns })])),
  } as Styles;

  const node: DocNode = {
    id: ids.next(),
    type: wrapper.element,
    name: uniqueName(state.document, words(wrapper.nameKey)),
    tag,
    attributes: {},
    classes: [],
    styles,
    text: null,
    children: withChildStyles(rules, selected.map((l) => l.node), wrapper.childStyles),
  };
  // the one rule of where elements may go (content-model.ts): the selection inside the wrapper, the wrapper in the
  // parent
  const refused = placementRefusal(state.document, rules, parent.id, [node]) ?? (tag === null ? null : childrenRefusal(rules, tag, node.children));
  if (refused !== null) return { kind: 'refused', message: refused };
  const parentPath = at(parent.id).path;
  // the roots leave their parent from the last one up, so each index still names its node; the wrapper takes the
  // first's place
  const patches: Patch[] = [...selected].reverse().map((l): Patch => ({ op: 'remove', path: [...parentPath, 'children', l.index] }));
  patches.push({ op: 'add', path: [...parentPath, 'children', first.index], value: node });
  const named = stylesText(baseStyles);
  const said =
    named === ''
      ? selected.length === 1
        ? message('status.wrappedPlain', { name: first.node.name, wrapper: node.name })
        : message('status.wrappedManyPlain', { count: selected.length, wrapper: node.name })
      : selected.length === 1
        ? message('status.wrapped', { name: first.node.name, wrapper: node.name, styles: named })
        : message('status.wrappedMany', { count: selected.length, wrapper: node.name, styles: named });
  return { kind: 'change', patches, selection: [node.id], message: said };
}

export const wrapRowCommand = registerHandler('element.wrapRow', (context): Outcome<never> => wrap('row', context));
export const wrapColumnCommand = registerHandler('element.wrapColumn', (context): Outcome<never> => wrap('column', context));
// element.wrapContainer and element.wrapGrid (feature layout-actions; the user's real-use audit, item 8.1): the same
// wrap, with the Container's plain styles (none: a div to group with) and the Grid's one equal track per wrapped
// element, responsive per breakpoint (A1.4)
export const wrapContainerCommand = registerHandler('element.wrapContainer', (context): Outcome<never> => wrap('container', context));
export const wrapGridCommand = registerHandler('element.wrapGrid', (context): Outcome<never> => wrap('grid', context));

// element.unwrap (spec unwrap): the one selected element with children, below the page root, leaves its parent and
// its children take its place, in their order, the same nodes; the wrapper's own styles go with it. A locked wrapper
// or one inside a locked element (spec lock-element), and a parent whose content model refuses one of the children,
// refuse the whole unwrap, and nothing changes. The lifted children
// become the selection; one undo step restores the wrapper around them.
function unwrappable(state: { readonly document: Parameters<typeof locate>[0]; readonly selection: readonly NodeId[] }): Location | null {
  const [only, ...others] = state.selection;
  if (only === undefined || others.length > 0) return null;
  const found = locate(state.document, only);
  return found !== null && found.parent !== null && found.node.children.length > 0 ? found : null;
}

// canUnwrap: one element selected, below the page root, holding children. Refused, the status bar says which: an
// element with no children to lift names itself; anything else says what can lose its wrapper.
// An instance keeps its wrapper: its root is what makes its children parts of it, and lifted out they would be parts of
// no instance (the audit's AUD-04). Detaching it first makes them ordinary elements.
export const canUnwrap = registerPredicate(
  'canUnwrap',
  (state) => {
    const found = unwrappable(state);
    return found !== null && found.node.component === undefined;
  },
  (state) => {
    const [only, ...others] = state.selection;
    const found = only === undefined || others.length > 0 ? null : locate(state.document, only);
    if (found !== null && found.node.component !== undefined) return message('status.unwrap.instance', { name: found.node.name });
    if (found !== null && found.parent !== null && found.node.children.length === 0) return message('status.unwrap.noChildren', { name: found.node.name });
    return message('status.unwrap.unavailable');
  },
);

export const unwrapCommand = registerHandler('element.unwrap', ({ state, rules }): Outcome<never> => {
  const wrapper = unwrappable(state);
  // the availability predicate (canUnwrap) keeps anything else from reaching here
  if (wrapper === null || wrapper.parent === null) throw new Error('element.unwrap: the selection is not one element with children below the page root');
  const parent = wrapper.parent;
  // a locked wrapper, or one inside a locked element, keeps its children (spec lock-element)
  const locked = lockRefusal(state.document, wrapper.node.id, 'status.locked.edit');
  if (locked !== null) return { kind: 'refused', message: locked };
  // the one rule of where elements may go (content-model.ts): the children in the wrapper's parent
  const refused = placementRefusal(state.document, rules, parent.id, wrapper.node.children);
  if (refused !== null) return { kind: 'refused', message: refused };
  // The wrapper leaves and its children take its place, keeping their ids — so what leaves is the wrapper alone, and
  // whatever pointed at it (a label's `for`, a link's `#anchor`) is released in the same undo step. Without this the
  // document would hold a reference to nothing, which the model refuses: an unwrap would have thrown instead of
  // running (the plan's T1/T6; the kernel owns the rule).
  const leaving = new Set([wrapper.node.id]);
  // a reference inside the children the wrapper held goes with them (they are written back, so a patch would not reach
  // it), and every other reference to the wrapper is released by its own patch
  const released = releaseReferencesPatch(state.document, leaving);
  // what a Row or a Column gave its children (their growing alike, elements.json wrappers childStyles) goes with it,
  // when the child still holds exactly that: unwrap undoes what wrap did, and a value the person changed since stays
  const given = wrapperChildStyles(rules, wrapper.node);
  const names = leavingNames(state.document, leaving);
  const kept = wrapper.node.children.map((child) => withoutChildStyles(rules, withoutReferencesTo(child, names), given));
  // the wrapper's own place (`…/children/<i>`) gives way to its children, at the wrapper's index on
  const parentPath = wrapper.path.slice(0, -2);
  const patches: Patch[] = [
    ...released,
    ...removeSubtree(wrapper),
    ...kept.map((child, i): Patch => ({ op: 'add', path: childPath(parentPath, wrapper.index + i), value: child })),
  ];
  return { kind: 'change', patches, selection: wrapper.node.children.map((c) => c.id), message: message('status.unwrapped', { name: wrapper.node.name }) };
});

// element.wrapBeside (feature drag-side-wrap; spec wrap-row-column, "Side drop during a drag" and Problems 2): a drop
// in a side band of an element, once confirmed, puts what the drag brings beside it in a new Row (a target laid out in
// a vertical flow) or Column (in a row flow), the wrapper's definition being the wrap commands' own. The wrapper takes
// the target's place and holds the target and what arrives, in the order of the side: before it or after it. What
// arrives is a new element of a palette entry (a tile's creation drag) or the selection's roots (an element drag),
// which leave their places. The wrapper becomes the selection, in one undo step. A target that is the page root, a
// moved node or inside one is refused; locked nodes stay (spec lock-element); the content model decides whether the
// wrapper may stand there and hold them (content-model.ts), and nothing changes when it refuses.
export const wrapBesideCommand = registerHandler('element.wrapBeside', ({ state, ids, rules, words }, { target, side, wrapper: kind, entry }): Outcome<never> => {
  const at = locate(state.document, target);
  if (at === null) throw new Error(`element.wrapBeside: the document has no node ${target}`);
  if (at.parent === null) return { kind: 'refused', message: message('status.wrap.root') };
  const make = nodeMaker(state.document, rules, ids, words);
  const arriving: DocNode[] = entry === undefined ? selectionRoots(state.document, state.selection).map((l) => l.node) : [paletteNode(make, entry)];
  if (arriving.length === 0) throw new Error('element.wrapBeside: nothing arrives');
  if (movesIntoItself(arriving, target)) return { kind: 'refused', message: message('status.refused.intoItself') };
  const moving = entry === undefined ? arriving.map((n) => n.id) : [];
  const locked = firstLockRefusal(state.document, moving, 'status.locked.move') ?? lockRefusal(state.document, at.parent.id, 'status.locked.insert') ?? lockRefusal(state.document, target, 'status.locked.move');
  if (locked !== null) return { kind: 'refused', message: locked };
  // what moves into the wrapper lands in the target's parent: a part stays in its instance and no instance goes
  // inside another, as element.moveTo asks (the audit's IN1)
  const instanced = instanceMoveRefusal(state.document, entry === undefined ? arriving : [], at.parent.id as NodeId);
  if (instanced !== null) return { kind: 'refused', message: instanced };

  const definition = rules.wrappers.get(kind as WrapperId);
  const element = definition === undefined ? undefined : rules.elements.get(definition.element);
  if (definition === undefined || element === undefined) throw new Error(`element.wrapBeside: elements.json defines no ${kind} wrapper`);
  const tag = element.tags[0] ?? null;
  // the target as it will be once the moved nodes left it (one of them may lie inside it)
  let document = state.document;
  const patches: Patch[] = [];
  for (const id of moving) {
    const now = locate(document, id);
    if (!now) continue;
    const patch: Patch = { op: 'remove', path: now.path };
    patches.push(patch);
    document = applyPatches(document, [patch]).document;
  }
  const place = locate(document, target);
  if (place === null) throw new Error(`element.wrapBeside: ${target} is gone once the moved nodes left`);
  const children = withChildStyles(rules, side === 'before' ? [...arriving, place.node] : [place.node, ...arriving], definition.childStyles);
  const node: DocNode = {
    id: ids.next(),
    type: definition.element,
    name: freshName(make, words(definition.nameKey)),
    tag,
    attributes: {},
    classes: [],
    styles: { [rules.baseLayer.breakpoint]: { [rules.baseLayer.state]: definition.styles } } as Styles,
    text: null,
    children,
  };
  // the wrapper in the target's parent (the target leaves it for the wrapper), what arrives inside the wrapper
  const refused = placementRefusal(state.document, rules, at.parent.id, [node], new Set([target])) ?? (tag === null ? null : childrenRefusal(rules, tag, children));
  if (refused !== null) return { kind: 'refused', message: refused };

  // the moved nodes have left their places (above); the wrapper replaces the target where it stands now
  patches.push({ op: 'replace', path: place.path, value: node });
  const first = arriving[0] as DocNode;
  return {
    kind: 'change',
    patches,
    selection: [node.id],
    message: message('status.wrappedBeside', { wrapper: node.name, name: first.name, target: at.node.name, styles: stylesText(definition.styles) }),
  };
});

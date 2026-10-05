// Layers folding (PRODUCT.md §5): which branches of the Layers tree are folded. It is editor state, kept in memory
// only (spec layers-tree: not saved, not an undo step): folding never changes the document nor the selection. A
// branch that hides a selected node unfolds when the selection changes (spec layers-tree, Problems in Pager 2), so a
// selection made on the canvas always has its row in Layers.
import { message, registerHandler, type RegisteredHandler } from '../../core/commands/registry.ts';
import { locate, walk, type DocNode, type DocumentJson, type NodeId } from '../../core/document/model.ts';
import type { StoreState } from '../../core/store/store.ts';
import { asking } from '../focus/focus.ts';
import type { RowDetail } from '../preferences/preferences.ts';
import { commandOf } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';
import { itemSwitched } from '../preferences/said.ts';

export interface LayersState {
  // the nodes whose branch is folded
  readonly collapsed: readonly NodeId[];
  // what the Layers search field holds (layers.search); empty while nothing is searched
  readonly query: string;
}

export const INITIAL_LAYERS: LayersState = { collapsed: [], query: '' };

// layers.search filters the Layers rows (spec layers-search): a row shows while its node's name, HTML tag, id or one
// of its classes holds the text, ignoring case and the spaces around it, and so do the rows above it, whatever is
// folded; the rows that match are marked. Clearing the field shows the tree as it was folded before, since the search
// never changes the folds. The status bar says how many layers match.
export const search = registerHandler<'layers.search', EditorUi>('layers.search', ({ state }, { query }) => {
  const text = query.trim();
  const ui: EditorUi = { ...state.ui, layers: { ...state.ui.layers, query } };
  if (text === '') return state.ui.layers.query.trim() === '' ? { kind: 'change', ui } : { kind: 'change', ui, message: message('status.layers.searchCleared') };
  const count = state.document.pages.reduce((n, page) => n + [...walk(page.tree)].filter((node) => layerMatches(node, text)).length, 0);
  return { kind: 'change', ui, message: count === 0 ? message('status.layers.searchNoMatch', { query: text }) : message('status.layers.searchMatches', { count, query: text }) };
});

// whether a node's row matches a searched text (not empty)
function layerMatches(node: DocNode, text: string): boolean {
  const wanted = text.trim().toLowerCase();
  const id = node.attributes.id;
  return [node.name, node.tag ?? '', typeof id === 'string' ? id : '', ...node.classes].some((word) => word.toLowerCase().includes(wanted));
}

// What a search shows of a tree: the rows that match and every row above one of them; null while nothing is searched
export interface SearchView {
  readonly matches: ReadonlySet<NodeId>;
  readonly shown: ReadonlySet<NodeId>;
}
export function searchView(tree: DocNode, query: string): SearchView | null {
  const text = query.trim();
  if (text === '') return null;
  const matches = new Set<NodeId>();
  const shown = new Set<NodeId>();
  const visit = (node: DocNode): boolean => {
    let below = false;
    for (const child of node.children) below = visit(child) || below;
    const hit = layerMatches(node, text);
    if (hit) matches.add(node.id);
    if (hit || below) shown.add(node.id);
    return hit || below;
  };
  visit(tree);
  return { matches, shown };
}

export const isExpanded = (ui: EditorUi, id: NodeId): boolean => !ui.layers.collapsed.includes(id);

const withCollapsed = (ui: EditorUi, collapsed: readonly NodeId[]): EditorUi => ({ ...ui, layers: { ...ui.layers, collapsed } });

// layers.setExpanded: folds, unfolds or toggles a node's branch; a node without children has no branch
export const setExpanded = registerHandler<'layers.setExpanded', EditorUi>('layers.setExpanded', ({ state }, { target, expanded }) => {
  const found = locate(state.document, target);
  if (!found || found.node.children.length === 0) return { kind: 'change' };
  const { collapsed } = state.ui.layers;
  const folded = collapsed.includes(target);
  const fold = expanded === 'toggle' ? !folded : expanded === 'collapse';
  if (fold === folded) return { kind: 'change' };
  return { kind: 'change', ui: withCollapsed(state.ui, fold ? [...collapsed, target] : collapsed.filter((id) => id !== target)) };
});

// The row keys of the Layers tree (spec layers-keyboard-navigation, WAI-ARIA tree): on the focused row's node (its
// target; the primary selected node without one), ArrowRight unfolds a folded branch, or moves the focus to the first
// child of an unfolded one; ArrowLeft folds an unfolded branch, or moves the focus to the parent row. The focus moves
// through the focus owner (focus.ts); neither changes the document nor the selection. Folding and unfolding say so in
// the status bar ("Hero folded.", read by assistive technology too).
export const expandOrFocusChild = registerHandler<'layers.expandOrFocusChild', EditorUi>('layers.expandOrFocusChild', ({ state }, { target }) => {
  const id = target ?? state.selection[0];
  const found = id === undefined ? null : locate(state.document, id);
  if (!found || found.node.children.length === 0) return { kind: 'change' };
  const { collapsed } = state.ui.layers;
  if (collapsed.includes(found.node.id)) return { kind: 'change', ui: withCollapsed(state.ui, collapsed.filter((x) => x !== found.node.id)), message: message('status.layers.unfolded', { name: found.node.name }) };
  return { kind: 'change', ui: asking(state.ui, 'next') };
});

export const collapseOrFocusParent = registerHandler<'layers.collapseOrFocusParent', EditorUi>('layers.collapseOrFocusParent', ({ state }, { target }) => {
  const id = target ?? state.selection[0];
  const found = id === undefined ? null : locate(state.document, id);
  if (!found) return { kind: 'change' };
  const { collapsed } = state.ui.layers;
  if (found.node.children.length > 0 && !collapsed.includes(found.node.id)) return { kind: 'change', ui: withCollapsed(state.ui, [...collapsed, found.node.id]), message: message('status.layers.folded', { name: found.node.name }) };
  return found.parent === null ? { kind: 'change' } : { kind: 'change', ui: asking(state.ui, 'parent') };
});

// layers.collapseAll folds every branch below the page root, so the page's row and its first level stay in view (the
// page's own outline; jornada03 J9: folding the root left one row and nothing to work with); layers.expandAll
// unfolds every branch (spec layers-expand-collapse-all). A selection inside a folded branch unfolds its ancestors
// (revealSelection, Problems in Pager 1).
export const collapseAll = registerHandler<'layers.collapseAll', EditorUi>('layers.collapseAll', ({ state }) => {
  const branches: NodeId[] = [];
  for (const page of state.document.pages) {
    const visit = (node: DocNode) => {
      if (node.children.length > 0) branches.push(node.id);
      node.children.forEach(visit);
    };
    page.tree.children.forEach(visit);
  }
  return { kind: 'change', ui: withCollapsed(state.ui, branches), message: message('status.layers.collapsedAll') };
});

export const expandAll = registerHandler<'layers.expandAll', EditorUi>('layers.expandAll', ({ state }) => ({ kind: 'change', ui: withCollapsed(state.ui, []), message: message('status.layers.expandedAll') }));

// layers.setRowDetails shows or hides one detail beside each row's name (spec layers-row-columns): the HTML tag, the
// id, the classes, the attributes; the choice is a preference, kept after a reload. Its menu item stands for the detail
// being shown; run without `shown` (its menu item), it turns the detail over.
export const setRowDetails: RegisteredHandler<'layers.setRowDetails', EditorUi> = registerHandler(
  'layers.setRowDetails',
  ({ state }, { detail, shown }) => {
    const now = rowDetailsOf(state.ui);
    const on = shown ?? !now.includes(detail);
    const next = ROW_DETAILS.filter((d) => (d === detail ? on : now.includes(d)));
    if (next.join() === now.join()) return { kind: 'change' };
    const said = itemSwitched(setRowDetails.command, { detail }, on);
    const { rowDetails: _dropped, ...rest } = state.ui.preferences;
    void _dropped;
    const same = next.join() === DEFAULT_ROW_DETAILS.join();
    return { kind: 'change', ui: { ...state.ui, preferences: same ? rest : { ...rest, rowDetails: next } }, message: said };
  },
  (state, args) => rowDetailsOf(state.ui).includes(args.detail as RowDetail),
);

// the details a row may show (the values of the command's detail argument, the manifest's) and the default, the tag
export const ROW_DETAILS: readonly RowDetail[] = (commandOf(setRowDetails.command).args.detail?.values ?? []) as RowDetail[];
const DEFAULT_ROW_DETAILS: readonly RowDetail[] = ROW_DETAILS.filter((d) => d === 'tag');
// what each row shows beside its name now
export const rowDetailsOf = (ui: EditorUi): readonly RowDetail[] => ui.preferences.rowDetails ?? DEFAULT_ROW_DETAILS;

// the nodes above a node, from its page's root down to its parent
function ancestorsOf(doc: DocumentJson, id: NodeId): NodeId[] {
  const chain: NodeId[] = [];
  const find = (node: DocNode): boolean => {
    if (node.id === id) return true;
    chain.push(node.id);
    if (node.children.some(find)) return true;
    chain.pop();
    return false;
  };
  return doc.pages.some((page) => find(page.tree)) ? chain : [];
}

// The editor state after the selection changed: every folded branch that hides a selected node unfolds.
export function revealSelection(state: StoreState<EditorUi>): EditorUi {
  const { collapsed } = state.ui.layers;
  if (collapsed.length === 0) return state.ui;
  const hiding = new Set(state.selection.flatMap((id) => ancestorsOf(state.document, id)));
  const kept = collapsed.filter((id) => !hiding.has(id));
  return kept.length === collapsed.length ? state.ui : withCollapsed(state.ui, kept);
}

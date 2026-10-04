// Snapping on the canvas (PRODUCT.md §5; spec snap-while-moving): the lines of the targets Snap settings enables,
// measured on the page the canvas draws, and the snap of a free drag (the moved box's start, centre and end on each
// axis) and of a resize (the dragged edges). The pointer owner asks it at every move of those gestures while snap is
// on and Ctrl is not held (Ctrl suspends snapping for the gesture, Problems in Pager 2); the rule that picks a line is
// the core's (src/core/geometry/snap.ts). What an axis snapped to is published for the canvas chrome, which draws it
// from the moving element to its target (Problems in Pager 4), until the gesture ends.
//  - elements: the moved element's siblings (Elements), their edges (Edges) and centres (Centers);
//  - the parent and the page: their edges and centres, as Edges and Centers say;
//  - the manual guides (Guides) while they show; the lines of a shown column or row grid (Grid); the ruler ticks
//    (Rulers) while the rulers show, at the rulers' tick step for the zoom.
import { openedPage, pageShown } from '../../core/project/pages.ts';
import { locate, type NodeId } from '../../core/document/model.ts';
import { equalGap, placesOf, rulerLines, snapAxis, type Box, type EqualGap, type Snap, type SnapAxis, type SnapLine, type SnapSource } from '../../core/geometry/snap.ts';
import { numberConstant } from '../../manifest/runtime.ts';
import { columnBands, columnsOf, gridShown, rowBands, rowsOf } from '../../core/page/grid.ts';
import { guidesOf } from '../../core/page/guides.ts';
import type { EditorState } from '../store.ts';
import { activeBreakpoint } from '../view/breakpoints.ts';
import { snapSettingsOf } from '../view/snap.ts';
import { pageLayout } from './coordinates.ts';
import { rulerSteps } from './rulers.ts';

// the Snap settings targets each source needs (snap.setSettings' list), and those that pick a box's edges and centre
const ELEMENTS = 'elements';
const PARENT = 'parent';
const PAGE = 'page';
const GUIDES = 'guides';
const GRID = 'grid';
const RULERS = 'rulers';
const EDGES = 'edges';
const CENTERS = 'centers';
// equal spacing (interactions.json): the radius, a factor of the snap distance; the least overlap across; and how near
// two gaps are to be equal when nothing is applied (half a page px)
const EQUAL_RADIUS = numberConstant('snap.equalSpacingRadius');
const EQUAL_OVERLAP = numberConstant('snap.equalSpacingOverlap');
const EQUAL_ALREADY = 0.5;

export interface Snapped {
  // the moved box after the snap, in page px
  readonly box: Box;
  // the line each axis snapped to, or aligns with (a hint)
  readonly x: Snap | null;
  readonly y: Snap | null;
  // the equal gaps the box repeats, to mark
  readonly gaps: readonly EqualGap[];
  // what the gesture's travel shifts by: the snap applied, nothing for a hint
  readonly offset: { readonly x: number; readonly y: number };
}

// the lines of a box: its edges and its centre on each axis, as the enabled parts say
function boxLines(box: Box, source: SnapSource, target: string, targets: readonly string[]): SnapLine[] {
  const lines: SnapLine[] = [];
  for (const axis of ['x', 'y'] as const) {
    const [start, centre, end] = placesOf(box, axis);
    const span = axis === 'x' ? { from: box.y, to: box.y + box.height } : { from: box.x, to: box.x + box.width };
    if (targets.includes(EDGES)) lines.push({ axis, at: start, source, target, span }, { axis, at: end, source, target, span });
    if (targets.includes(CENTERS)) lines.push({ axis, at: centre, source, target, span });
  }
  return lines;
}

// Every line the targets enable for a gesture on this node, but the ruler ticks (they depend on the moving edges).
function targetLines(state: EditorState, node: NodeId): SnapLine[] {
  const { targets } = snapSettingsOf(state.ui);
  const found = locate(state.document, node);
  const page = pageShown(state)?.tree;
  const lines: SnapLine[] = [];
  if (found === null || page === undefined) return lines;
  if (targets.includes(ELEMENTS) && found.parent !== null)
    for (const sibling of found.parent.children) {
      const box = sibling.id === node ? null : pageLayout.box(sibling.id);
      if (box !== null) lines.push(...boxLines(box, 'element', sibling.id, targets));
    }
  const parentBox = targets.includes(PARENT) && found.parent !== null && found.parent.id !== page.id ? pageLayout.box(found.parent.id) : null;
  if (parentBox !== null && found.parent !== null) lines.push(...boxLines(parentBox, 'parent', found.parent.id, targets));
  const pageBox = pageLayout.box(page.id);
  if (pageBox !== null && targets.includes(PAGE)) lines.push(...boxLines(pageBox, 'page', page.id, targets));
  if (targets.includes(GUIDES) && state.ui.preferences.guidesHidden !== true)
    for (const guide of guidesOf(state.document, openedPage(state))) lines.push({ axis: guide.axis === 'vertical' ? 'x' : 'y', at: guide.at, source: 'guide', target: guide.id, span: null });
  if (targets.includes(GRID) && pageBox !== null) {
    const breakpoint = activeBreakpoint(state).id;
    if (gridShown(state, 'gridColumns')) {
      for (const band of columnBands(pageBox.width, columnsOf(state.document, breakpoint, openedPage(state))))
        for (const at of [band.x, band.x + band.width]) lines.push({ axis: 'x', at: pageBox.x + at, source: 'grid', target: null, span: null });
    }
    if (gridShown(state, 'gridRows')) {
      const rows = rowsOf(state.document, breakpoint, openedPage(state));
      for (const top of rowBands(pageBox.height, rows.height, rows.gutter))
        for (const at of [top, top + rows.height]) lines.push({ axis: 'y', at: pageBox.y + at, source: 'grid', target: null, span: null });
    }
  }
  return lines;
}

// the lines of an axis for these moving edges: the targets' and, while the rulers show, the ticks near the edges
function axisLines(state: EditorState, lines: readonly SnapLine[], axis: SnapAxis, edges: readonly number[], zoom: number, distance: number): SnapLine[] {
  const own = lines.filter((l) => l.axis === axis);
  const { targets } = snapSettingsOf(state.ui);
  if (!targets.includes(RULERS) || state.ui.preferences.rulersHidden === true) return own;
  return [...own, ...rulerLines(axis, edges, rulerSteps(zoom).tick, distance)];
}

// whether a gesture's hints are drawn (smart guides on) and its snap applied (snap on, Ctrl not held)
export function snapMode(state: EditorState, suspended: boolean): { readonly apply: boolean; readonly hint: boolean } {
  return { apply: snapSettingsOf(state.ui).on && !suspended, hint: state.ui.preferences.smartGuidesOff !== true };
}

// An axis's line as the gesture uses it: applied, any enabled target's; only hinted (snap off or suspended), an
// alignment with an element, a guide, the parent or the page (a grid line or a ruler tick is no alignment).
const HINTS: readonly SnapSource[] = ['element', 'guide', 'parent', 'page'];
const kept = (snap: Snap | null, apply: boolean): Snap | null => (snap === null || apply || HINTS.includes(snap.line.source) ? snap : null);

// the boxes of the moved node's siblings the page draws
function siblingBoxes(state: EditorState, node: NodeId): Box[] {
  const parent = locate(state.document, node)?.parent ?? null;
  return (parent?.children ?? []).flatMap((c) => {
    const box = c.id === node ? null : pageLayout.box(c.id);
    return box === null ? [] : [box];
  });
}

// The snap of a moved box (a free drag): each axis by its start, centre and end; on an axis where no edge snapped, an
// equal gap (while equal spacing is on). Applied, the box moves by the offsets; hinted, it stays where it is, and an
// equal gap is marked only once the gaps are equal.
export function snapMove(state: EditorState, node: NodeId, box: Box, zoom: number, apply: boolean): Snapped {
  const { distance } = snapSettingsOf(state.ui);
  const lines = targetLines(state, node);
  const x = kept(snapAxis(placesOf(box, 'x'), axisLines(state, lines, 'x', placesOf(box, 'x'), zoom, distance), distance), apply);
  const y = kept(snapAxis(placesOf(box, 'y'), axisLines(state, lines, 'y', placesOf(box, 'y'), zoom, distance), distance), apply);
  const siblings = state.ui.preferences.equalSpacingOff === true ? [] : siblingBoxes(state, node);
  const equal = (axis: SnapAxis, snapped: Snap | null): EqualGap | null => {
    if (snapped !== null || siblings.length < 2) return null;
    const found = equalGap(axis, box, siblings, distance * EQUAL_RADIUS, EQUAL_OVERLAP);
    return found !== null && (apply || Math.abs(found.offset) <= EQUAL_ALREADY) ? found : null;
  };
  const gaps = [equal('x', x), equal('y', y)].filter((g): g is EqualGap => g !== null);
  const offset = {
    x: apply ? (x?.offset ?? gaps.find((g) => g.axis === 'x')?.offset ?? 0) : 0,
    y: apply ? (y?.offset ?? gaps.find((g) => g.axis === 'y')?.offset ?? 0) : 0,
  };
  return { box: { ...box, x: box.x + offset.x, y: box.y + offset.y }, x, y, gaps, offset };
}

// The snap of a resized box's dragged edges (a resize handle's sides: e, w, n, s): the offset each axis's edge moves
// by.
export function snapResize(state: EditorState, node: NodeId, box: Box, sides: string, zoom: number, apply: boolean): Snapped {
  const { distance } = snapSettingsOf(state.ui);
  const lines = targetLines(state, node);
  const edgeOn = (axis: SnapAxis): number | null => {
    const [first, , last] = placesOf(box, axis);
    if (axis === 'x') return sides.includes('e') ? last : sides.includes('w') ? first : null;
    return sides.includes('s') ? last : sides.includes('n') ? first : null;
  };
  const snapOn = (axis: SnapAxis): Snap | null => {
    const edge = edgeOn(axis);
    return edge === null ? null : kept(snapAxis([edge], axisLines(state, lines, axis, [edge], zoom, distance), distance), apply);
  };
  const x = snapOn('x');
  const y = snapOn('y');
  const offset = { x: apply ? (x?.offset ?? 0) : 0, y: apply ? (y?.offset ?? 0) : 0 };
  return { box, x, y, gaps: [], offset };
}

// What the chrome draws: the moved box and the line each axis snapped to, while a gesture snaps; null otherwise.
let shown: Snapped | null = null;
const listeners = new Set<() => void>();
export const snapShown = {
  get: (): Snapped | null => shown,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set(next: Snapped | null): void {
    const drawn = next === null || (next.x === null && next.y === null && next.gaps.length === 0) ? null : next;
    if (drawn === shown) return;
    shown = drawn;
    for (const listener of listeners) listener();
  },
};

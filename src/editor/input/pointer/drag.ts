// The drag of elements and tiles (plan I.12): the marquee, the drop proposal redrawn, the side drop offered,
// autoscroll, a folded Layers row's dwell, and the drag's timers.
import type { Message } from '../../../core/commands/registry.ts';
import type { NodeId } from '../../../core/document/model.ts';
import type { CommandId } from '../../../generated/ids.ts';
import { canvasFrame, geometryOf, nodesUnder, screenToPage, scrollPage, type Point } from '../../canvas/coordinates.ts';
import { drawnProposal, liveDrag } from '../../drag/drag-session.ts';
import { rowDrop, SIDE_DWELL, type DropProposal } from '../../drag/drop.ts';
import { DRAG_HYSTERESIS } from './machine.ts';
import { NOT_PICKING, argsFor } from './press.ts';
import { CONTAINERS, isInside, keepsSide, nearestAccepted, proposalAt, ROW_DROP, ROW_SELECT, rowUnder, sideAt } from '../drop-proposals.ts';
import type { SideView } from './views.ts';
import { leavesNow, dropDoor, ROW_DWELL, PILL_OFFSET, PILL_FREEZE, AUTOSCROLL_ZONE, AUTOSCROLL_MAX, TREE_SHARE, TREE_DWELL, EXPAND_DWELL, SIDE_ELEMENT, sideTileFor } from './common.ts';
import type { PointerOwner } from './owner.ts';

export function pointerDrag(p: PointerOwner): Pick<PointerOwner, 'pagePoint' | 'drawMarquee' | 'redraw' | 'sideView' | 'offer' | 'autoscroll' | 'rest' | 'stopDragTimers' | 'over'> {
  const { ps, shared, store } = p;
  const { altHeld, setBand, setDrag } = p.views;
  const pagePoint = (at: Point): Point | null => {
    const frame = canvasFrame();
    const g = frame ? geometryOf(frame) : null;
    return g ? screenToPage(at, g) : null;
  };
  // The marquee follows the pointer: every move selects anew from the selection the gesture started from, so the
  // gesture is cancelled (back to that selection) and opened again with the band from the press to the pointer. The
  // leaves key (Alt) is read live: holding it while the band is drawn takes the leaves (spec marquee-select, Problems
  // in Pager 3).
  const drawMarquee = (at: Point) => {
    if (ps.marquee === null || ps.pressedAt === null || ps.pressedAt.page === null) return;
    const to = p.pagePoint(at);
    if (to === null) return;
    const from = ps.pressedAt.page;
    shared.open?.cancel();
    shared.open = store.gesture();
    const rect = { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y };
    shared.open.dispatch(ps.marquee.entry.command.id as CommandId, { ...argsFor(ps.marquee.entry, ps.marquee.press, NOT_PICKING), rect, mode: ps.marquee.mode, ...(leavesNow(altHeld) ? { leaves: true } : {}) } as never);
    const s = ps.pressedAt.screen;
    setBand({ x: Math.min(s.x, at.x), y: Math.min(s.y, at.y), width: Math.abs(at.x - s.x), height: Math.abs(at.y - s.y) });
  };
  // The proposal drawn, and dropped at the release: the pointer's own at the level the drag session holds (its level
  // keys, drag-session.ts), and, for a creation drag, the refusal its drop would meet there. It is published when it
  // changes, whether the pointer or a level key changed it (a level key redraws it at once, without a pointer move),
  // and on every move of a creation drag, whose ghost follows the pointer.
  const redraw = (at: Point, publish: boolean) => {
    const live = liveDrag.get();
    if (ps.dragging === null || live === null) return;
    const state = store.getState();
    const { proposal, level } = drawnProposal(state.ui.drag, live, state.document);
    // a proposal redirected beside what refuses it is asked again on every move: its side follows the pointer across
    // the refusing element's middle, which never changes the raw proposal inside it (a tile dragged down a list that
    // refuses it kept the side it entered by)
    const redirected = ps.dragging.redirect !== null;
    const changed = level !== ps.dragging.levels || JSON.stringify(proposal) !== JSON.stringify(ps.dragging.raw) || redirected;
    if (changed) {
      ps.dragging.raw = proposal;
      ps.dragging.levels = level;
      // the refusal the drop would meet there, its command's own, asked without running it; where there is one, the
      // nearest place that takes it instead (spec drag-layout, Problems in Pager 4)
      const inserting = ps.dragging.inserting;
      const refusalAt = (p: DropProposal): Message | null => {
        if (inserting !== null) return store.refusal(inserting.drop.command.id, { ...inserting.drop.door.args, ...inserting.args, parent: p.parent, index: p.index } as never);
        const door = dropDoor(p);
        return door === null ? null : store.refusal(door.command.id, { ...door.door.args, parent: p.parent, index: p.index } as never);
      };
      const why = proposal === null || proposal.refused ? null : refusalAt(proposal);
      // a lock is never worked around: a drop a lock refuses stays refused (spec lock-element)
      const nearest = why === null || proposal === null || why.key.startsWith('status.locked') ? null : nearestAccepted(state.document, ps.dragging.dragged, proposal, at, (p) => refusalAt(p) === null);
      ps.dragging.proposal = nearest ?? proposal;
      ps.dragging.refusal = nearest === null ? why : null;
      ps.dragging.redirect = nearest !== null && why !== null && proposal !== null ? { why, from: proposal.parent } : null;
    }
    if (changed || publish) setDrag({ dragged: ps.dragging.dragged, inserting: ps.dragging.inserting, proposal: ps.dragging.proposal, refusal: ps.dragging.refusal, redirect: ps.dragging.redirect, levels: ps.dragging.levels, at, side: p.sideView() });
  };
  const sideView = (): SideView | null => (ps.dragging?.side ? { offer: ps.dragging.side.offer, armed: ps.dragging.side.armed, pill: ps.dragging.side.pill, refusal: ps.dragging.side.refusal } : null);
  // The side drop the pointer offers (spec drag-layout, row 5): a new offer (another target or side) starts the dwell
  // anew; after wrap.sideDwell in the same band it is confirmed, its pill drawn at the pointer, and it stays while the
  // pointer is within wrap.pillFreeze of the pill. The refusal its wrap would meet is asked of its command.
  const offer = (at: Point, onPage: boolean) => {
    if (ps.dragging === null) return;
    const current = ps.dragging.side;
    if (SIDE_DWELL > 0 && current?.armed && current.pill !== null && Math.hypot(at.x - current.pill.x, at.y - current.pill.y) <= PILL_FREEZE) return;
    // the side drop drawn holds while the pointer stays by that side of its element, wrap.sideEdgeExclusion around it:
    // a tremor never moves it to another element (spec drag-layout, the user's decision: no surgical pointing)
    const door = ps.dragging.inserting !== null ? sideTileFor(ps.dragging.inserting) : SIDE_ELEMENT;
    const fresh = door === null || (ps.dragging.inserting !== null && !onPage) ? null : sideAt(store.getState().document, ps.dragging.dragged, at);
    // a tremor out of the element keeps its side drop, but a deeper element's own side drop takes over
    const deeper = fresh !== null && current !== null && fresh.target !== current.offer.target && isInside(store.getState().document, fresh.target, current.offer.target);
    if (current !== null && !deeper && keepsSide(current.offer, at)) return;
    const next = fresh;
    const same = next !== null && current !== null && next.target === current.offer.target && next.side === current.offer.side;
    if (same) return;
    if (ps.dwell !== null) clearTimeout(ps.dwell);
    ps.dwell = null;
    if (next === null || door === null) {
      ps.dragging.side = null;
      return;
    }
    const args = { ...door.door.args, target: next.target, side: next.side, wrapper: next.wrapper, ...(ps.dragging.inserting !== null ? ps.dragging.inserting.args : {}) };
    ps.dragging.side = { offer: next, armed: false, pill: null, refusal: store.refusal(door.command.id, args as never) };
    // with no dwell (interactions.json wrap.sideDwell 0) the side zone confirms the offer at once
    if (SIDE_DWELL <= 0) {
      ps.dragging.side = { ...ps.dragging.side, armed: true, pill: { x: at.x + PILL_OFFSET[0], y: at.y + PILL_OFFSET[1] } };
      return;
    }
    ps.dwell = setTimeout(() => {
      ps.dwell = null;
      if (ps.dragging?.side?.offer !== next) return;
      ps.dragging.side = { ...ps.dragging.side, armed: true, pill: { x: ps.pointerAt.x + PILL_OFFSET[0], y: ps.pointerAt.y + PILL_OFFSET[1] } };
      p.redraw(ps.pointerAt, true);
    }, SIDE_DWELL);
  };
  // Autoscroll (spec drag-autoscroll): while the pointer is within drop.autoscrollZone of the top or the bottom of a
  // scroller — the page's visible box, or the Layers tree's — once it has been inside that box beyond the zone, that
  // scroller moves each frame by up to drop.autoscrollMaxStep screen pixels, more the nearer the edge, and the
  // proposal follows what the scroll brought under the pointer.
  const autoscroll = () => {
    ps.scrolling = 0;
    const frame = canvasFrame();
    if (ps.dragging === null || !frame) return;
    let scrolled = false;
    const box = frame.getBoundingClientRect();
    const fromTop = ps.pointerAt.y - box.top;
    const fromBottom = box.bottom - ps.pointerAt.y;
    const across = ps.pointerAt.x >= box.left && ps.pointerAt.x <= box.right;
    if (across && fromTop > AUTOSCROLL_ZONE && fromBottom > AUTOSCROLL_ZONE) ps.insideOnce = true;
    let step = 0;
    if (ps.insideOnce && across && fromTop >= 0 && fromTop < AUTOSCROLL_ZONE) step = -AUTOSCROLL_MAX * (1 - fromTop / AUTOSCROLL_ZONE);
    else if (ps.insideOnce && across && fromBottom >= 0 && fromBottom < AUTOSCROLL_ZONE) step = AUTOSCROLL_MAX * (1 - fromBottom / AUTOSCROLL_ZONE);
    if (step !== 0 && scrollPage(frame, step)) scrolled = true;
    // the Layers tree scrolls the same way while the pointer is over it (Problems in Pager 2: a row below its fold is
    // reached by dragging): its own box, its own arming, its own scrolled distance. Two things keep a drag aimed at a
    // visible row from having it carried away (the audit's tile onto a Layers row landed on the room the row had left):
    // the band is at most a share of the tree's height (drop.autoscrollTreeShare, dnd-kit's threshold), and over a row
    // the tree scrolls only once the pointer has rested in the band (drop.autoscrollTreeDwell, the time dampening of
    // hello-pangea/dnd's auto-scroller) — a drag released on the row is done before. Past the rows (the empty room
    // below the last one, above the first) it scrolls at once. It used to scroll nowhere but there, so a tree taller
    // than its panel, whose bottom edge always holds a row, never scrolled down to the rows below the fold (LA1).
    const tree = document.querySelector('.layers-tree');
    if (tree !== null) {
      const treeBox = tree.getBoundingClientRect();
      const treeZone = Math.min(AUTOSCROLL_ZONE, treeBox.height * TREE_SHARE);
      const treeTop = ps.pointerAt.y - treeBox.top;
      const treeBottom = treeBox.bottom - ps.pointerAt.y;
      const overTree = ps.pointerAt.x >= treeBox.left && ps.pointerAt.x <= treeBox.right;
      if (overTree && treeTop > treeZone && treeBottom > treeZone) ps.insideTreeOnce = true;
      const inBand = ps.insideTreeOnce && overTree && ((treeTop >= 0 && treeTop < treeZone) || (treeBottom >= 0 && treeBottom < treeZone));
      if (!inBand) {
        if (ps.treeBand !== null) clearTimeout(ps.treeBand);
        ps.treeBand = null;
        ps.treeRested = false;
      } else if (ps.treeBand === null && !ps.treeRested) {
        ps.treeBand = setTimeout(() => {
          ps.treeBand = null;
          ps.treeRested = true;
        }, TREE_DWELL);
      }
      const underRow = ROW_SELECT !== null && document.elementFromPoint(ps.pointerAt.x, ps.pointerAt.y)?.closest(`[data-door="${ROW_SELECT.ref}"]`) != null;
      let treeStep = 0;
      if (inBand && (!underRow || ps.treeRested)) treeStep = treeTop < treeZone ? -AUTOSCROLL_MAX * (1 - treeTop / treeZone) : AUTOSCROLL_MAX * (1 - treeBottom / treeZone);
      if (treeStep !== 0) {
        const before = tree.scrollTop;
        tree.scrollTop += treeStep;
        if (tree.scrollTop !== before) scrolled = true;
      }
    }
    // a scroller that moved carried the page under a still pointer: the proposal is taken again there (the drag's
    // hysteresis suppresses a proposal that changed while the pointer stood still, which a scroll must not)
    if (scrolled) {
      ps.dragging.takenAt = null;
      p.over(ps.pointerAt, ps.dragging.inserting === null || nodesUnder(frame, ps.pointerAt).length > 0);
    }
    ps.scrolling = requestAnimationFrame(p.autoscroll);
  };
  // Resting on a folded row during a drag unfolds it after layers.expandDwell (spec layers-drag, Problems in Pager 1);
  // leaving it earlier cancels the timer. The unfolding runs the dwell's door in the drag's gesture.
  const rest = (row: { readonly node: NodeId; readonly folded: boolean } | null) => {
    if (ps.dragging === null) return;
    const folded = row !== null && row.folded ? row.node : null;
    if (folded === ps.dragging.resting) return;
    ps.dragging.resting = folded;
    if (ps.unfold !== null) clearTimeout(ps.unfold);
    ps.unfold = null;
    // (the door read once: an imported constant is not narrowed inside the timer's callback)
    const dwell = ROW_DWELL;
    if (folded === null || dwell === null) return;
    ps.unfold = setTimeout(() => {
      ps.unfold = null;
      if (ps.dragging?.resting !== folded) return;
      shared.open?.dispatch(dwell.command.id as CommandId, { ...dwell.door.args, target: folded } as never);
    }, EXPAND_DWELL);
  };
  const stopDragTimers = () => {
    if (ps.unfold !== null) clearTimeout(ps.unfold);
    ps.unfold = null;
    if (ps.dwell !== null) clearTimeout(ps.dwell);
    ps.dwell = null;
    if (ps.scrolling !== 0) cancelAnimationFrame(ps.scrolling);
    ps.scrolling = 0;
    ps.insideOnce = false;
    ps.insideTreeOnce = false;
    if (ps.treeBand !== null) clearTimeout(ps.treeBand);
    ps.treeBand = null;
    ps.treeRested = false;
  };
  const over = (at: Point, onPage: boolean) => {
    if (ps.dragging === null) return;
    const creation = ps.dragging.inserting !== null;
    // over a Layers row (an element drag from the canvas or from Layers, and a palette tile's creation drag, which
    // lands on a row as it lands on the canvas: the user's real-use audit, item 3.9): the row's zones decide
    const row = ROW_DROP === null ? null : rowUnder(at);
    p.rest(row);
    ps.dragging.fromRow = row !== null;
    const next = row !== null ? rowDrop(store.getState().document, (type) => CONTAINERS.has(type), ps.dragging.dragged, row.node, row.at) : creation && !onPage ? null : proposalAt(store.getState().document, ps.dragging.dragged, at);
    const taken = JSON.stringify(next) !== JSON.stringify(ps.dragging.base) && !(ps.dragging.takenAt !== null && Math.hypot(at.x - ps.dragging.takenAt.x, at.y - ps.dragging.takenAt.y) < DRAG_HYSTERESIS);
    if (taken) {
      ps.dragging.base = next;
      ps.dragging.takenAt = at;
      liveDrag.propose(next);
    }
    const offered = ps.dragging.side;
    if (row === null) p.offer(at, onPage);
    else ps.dragging.side = null;
    p.redraw(at, creation || ps.dragging.dragged.length > 0 || offered !== ps.dragging.side);
    if (ps.scrolling === 0) ps.scrolling = requestAnimationFrame(p.autoscroll);
  };
  return { pagePoint, drawMarquee, redraw, sideView, offer, autoscroll, rest, stopDragTimers, over };
}

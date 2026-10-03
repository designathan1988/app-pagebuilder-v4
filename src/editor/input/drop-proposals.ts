// Where a drop would land (split out of input/pointer.ts, which keeps the pointer machine): a pointer position
// measured on the page, turned into the proposal the chrome draws and a release commits — the insert the drop's own
// module computes (drag/drop.ts), the side drop an element's edge offers, the refusal's nearest accepted place, and
// the Layers row under the pointer. Pure measurement: the document it reads comes as an argument, and nothing here
// changes anything.
import { locate, type DocumentJson, type NodeId } from '../../core/document/model.ts';
import { manifest, numberConstant } from '../../manifest/runtime.ts';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { FeatureId } from '../../generated/ids.ts';
import { canvasFrame, flowAxis, flowReversed, geometryOf, laysOut, nodeBox, nodesUnder, sideFlow, type Point } from '../canvas/coordinates.ts';
import { offerSide, proposeDrop, sideBand, SIDE_ZONES, type DropProposal, type SideOffer } from '../drag/drop.ts';

// how near the middle of a refusing element still counts as its near side (interactions.json)
const MIDDLE_TIE = numberConstant('drop.middleTie');

// the element types that hold children (elements.json content): what a proposal may insert into
export const CONTAINERS = new Set(manifest.elements.elements.filter((e) => e.content === 'children').map((e) => e.id));

// the drag of a Layers row (spec layers-drag): the row's own click door (which selects its node) and the drop of its
// row zones, each only once its feature is built
export const ROW_SELECT = manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.gesture === 'layers-row-click' && (d.door.modifier ?? null) === null && d.door.button === undefined) ?? null;
export const layersDrag = (zone: string) => manifest.doors.find((d) => d.door.kind === 'layers-drag' && d.door.zone === zone && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
export const ROW_DROP = layersDrag('row-zones');

// The proposal a pointer position makes now, measured on the page through the coordinates module.
export function proposalAt(document: DocumentJson, dragged: readonly NodeId[], at: Point): DropProposal | null {
  const frame = canvasFrame();
  const g = frame ? geometryOf(frame) : null;
  if (!frame || !g) return null;
  return proposeDrop(document, (type) => CONTAINERS.has(type), dragged, nodesUnder(frame, at), at, {
    zoom: g.zoom,
    box: (id) => nodeBox(frame, id),
    axis: (id) => flowAxis(frame, id),
    reversed: (id) => flowReversed(frame, id),
    laysOut: (id) => laysOut(frame, id),
  });
}

// Whether a pointer position still lies by the side of the element a side drop was offered for: within its box and
// its side strip, both widened by wrap.sideEdgeExclusion, and never needing the clearance from its other edges.
export function keepsSide(offer: SideOffer, at: Point): boolean {
  const frame = canvasFrame();
  const b = frame ? nodeBox(frame, offer.target) : null;
  if (!b) return false;
  const m = SIDE_ZONES.edgeExclusion;
  if (at.x < b.x - m || at.x > b.x + b.width + m || at.y < b.y - m || at.y > b.y + b.height + m) return false;
  const across = offer.wrapper === 'row' ? b.width : b.height;
  const pos = offer.wrapper === 'row' ? at.x - b.x : at.y - b.y;
  const band = sideBand(across);
  return offer.side === 'before' ? pos <= band + m : pos >= across - band - m;
}

// The nearest place that takes the drop where `refused` would not: before or after the element that refused (its
// receiver), on the pointer's side of its middle along its parent's flow, one level further up while that is refused
// too; null when no level takes it (spec drag-layout, Problems in Pager 4).
export function nearestAccepted(document: DocumentJson, dragged: readonly NodeId[], refused: DropProposal, at: Point, accepts: (p: DropProposal) => boolean): DropProposal | null {
  const frame = canvasFrame();
  if (frame === null) return null;
  for (let at_ = locate(document, refused.parent); at_?.parent; at_ = locate(document, at_.parent.id)) {
    const refuser = at_.node.id;
    const parent = at_.parent;
    const box = nodeBox(frame, refuser);
    if (box === null) return null;
    const axis = flowAxis(frame, parent.id);
    // the pointer on the refusing element's middle, within drop.middleTie screen pixels past it, counts as on its near
    // side: a drag aimed at the middle of what refuses it lands before it, the side a person reading the list expects
    // (the audit's rule, asked at the tie; a pointer is whole pixels, a middle rarely is)
    const shownBefore = axis === 'x' ? at.x <= box.x + box.width / 2 + MIDDLE_TIE : at.y <= box.y + box.height / 2 + MIDDLE_TIE;
    const placement = flowReversed(frame, parent.id) === shownBefore ? 'after' : 'before';
    const siblings = parent.children.filter((c) => !dragged.includes(c.id));
    const index = siblings.findIndex((c) => c.id === refuser) + (placement === 'after' ? 1 : 0);
    const candidate: DropProposal = { parent: parent.id, index, placement, reference: refuser, refused: false };
    if (accepts(candidate)) return candidate;
  }
  return null;
}

// whether a node lies inside another (below it in the tree)
export function isInside(document: DocumentJson, node: NodeId, ancestor: NodeId): boolean {
  for (let at = locate(document, node)?.parent ?? null; at !== null; at = locate(document, at.id)?.parent ?? null) if (at.id === ancestor) return true;
  return false;
}

// The Layers row under a pointer position, where the pointer is down it (a fraction of its height) and whether its
// branch is folded; null off the rows.
export function rowUnder(at: Point): { readonly node: NodeId; readonly at: number; readonly folded: boolean } | null {
  if (ROW_SELECT === null) return null;
  const row = document.elementFromPoint(at.x, at.y)?.closest(`[data-door="${ROW_SELECT.ref}"]`);
  if (!row) return null;
  const stands: unknown = JSON.parse(row.getAttribute('data-args') ?? '{}');
  const node = stands !== null && typeof stands === 'object' ? (stands as Record<string, unknown>).target : undefined;
  if (typeof node !== 'string') return null;
  const box = row.getBoundingClientRect();
  return { node: node as NodeId, at: box.height > 0 ? (at.y - box.top) / box.height : 0.5, folded: row.getAttribute('aria-expanded') === 'false' };
}

// The side drop a pointer position offers now, measured on the page. Where the drop there is before or after an
// ancestor of the offer's element (its escape band: a card's side edge in a grid, whose title fills it), the drop
// wins and nothing is offered (spec drag-reorder-canvas, Problems in Pager 5).
export function sideAt(document: DocumentJson, dragged: readonly NodeId[], at: Point): SideOffer | null {
  const frame = canvasFrame();
  if (!frame) return null;
  const offer = offerSide(document, dragged, nodesUnder(frame, at), at, { box: (id) => nodeBox(frame, id), flow: (id) => sideFlow(frame, id) });
  if (offer === null) return null;
  const proposal = proposalAt(document, dragged, at);
  return proposal !== null && proposal.placement !== 'inside' && proposal.reference !== offer.target && isInside(document, offer.target, proposal.reference) ? null : offer;
}

// The canvas chrome (PRODUCT.md §5): what the editor draws over the page, on the canvas overlay: the outline of
// every selected node and the primary's label (its name and its exported tag, so the page root reads "body"); with
// several selected, the dashed outline of their union and one label counting them ("3 elements selected"); the
// thinner outline of the node the pointer hovers (pointer.ts); the band of a marquee while pointer.ts draws one
// (spec marquee-select: a 1 px accent border, a 16 % accent fill); and during an element drag (pointer.ts), the drop
// indicator (the insertion line, the receiver's outline and the drop label), with the dragged selection's outline
// dashed and its label hidden. A palette tile's creation drag (spec palette-drag-insert: nothing dragged) draws the
// same indicator, its label reading "Insert Paragraph · position 2 of 4 in Hero" (Problems in Pager 1), and, where
// the element's command would refuse it, the refused indicator with that refusal and no line (Problems in Pager 3);
// it leaves the selection's outline solid, and its ghost, the element's icon and name, follows the pointer at
// drag.ghostOffset over the whole window (Problems in Pager 4); cancelled with Escape, the ghost goes back to its
// tile and fades out (spec drag-level-keys-escape, Problems in Pager 4). While the keyboard's hand holds an element
// (core/structure/hand.ts), the same indicator stands at the hand's aim, with the refusal the move would meet there
// (spec hand-keyboard-move, "Visual feedback"). While a text is edited in place, its outline and label ("Editing
// text · Intro") wear the text editing mode colour instead of the selection's, and the text toolbar (text-toolbar.tsx)
// sits above the label, at its start; the toolbar's controls take presses of their own.
// The label of the one selected element is the one part of the chrome that takes a
// press: pointer.ts reads it (data-label-for) as a press on that element (spec select-click, "Hit zones"). Where a
// node is on the screen comes from the
// coordinates module (nodeBox), measured on every animation frame while there is something to draw, so the chrome
// follows scrolling, zoom and layout; the page itself is never touched (only the renderer writes it). Apart from
// those labels the chrome takes no pointer event, and it has no listener of its own (pointer.ts owns every gesture).
//
// The selection's label has one place (DEC-70, canvas/placement.ts selectionLabelBox): above its element, touching the
// top of its frame, at the frame's left edge. A drop label never covers page content (placeLabel): above its element
// when that space is free, otherwise inside the element's top-left corner, otherwise below it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref, type RefObject } from 'react';
import { styleClassOf } from '../inspector/style-target.ts';
import { useSelectionContext } from '../shell/field.tsx';
import { activeBreakpoint } from '../view/breakpoints.ts';
import { BASE_STATE, activeState } from '../view/style-state.ts';
import { createPortal } from 'react-dom';
import { message, type Message } from '../../core/commands/registry.ts';
import { lineage, locate, type DocNode, type DocumentJson, type NodeId } from '../../core/document/model.ts';
import { lineExtent, linesOf, sameLine } from '../../core/geometry/lines.ts';
import { layerColourCss } from '../../core/nodes/flags.ts';
import { heldHand, type HandState } from '../../core/structure/hand.ts';
import type { MessageId } from '../../generated/ids.ts';
import { elementIcon, manifest, numberConstant, type DoorEntry } from '../../manifest/runtime.ts';
import { Icon, isDoorBuilt } from '../doors/door.tsx';
import { GLYPHS } from '../doors/placement.ts';
import type { DropProposal } from '../drag/drop.ts';
import { type DragView, type GhostReturn, type Inserting, type SideView } from '../input/pointer.ts';
import { MODEL_RULES, useEditorState, useStore } from '../store.ts';
import { openedPage } from '../../core/project/pages.ts';
import { useT } from '../text.ts';
import { canvasFrame, capturedBox, contentBoxes, flowAxis, flowReversed, holdsNode, innerBox, nodeBox, nodeSize, pageAnimating, resizeBasis, elementRotation, type Point } from './coordinates.ts';
import { onPageChange } from './page-clock.ts';
import { TextToolbar } from './text-toolbar.tsx';
import { GridEditor } from './grid-editor.tsx';
import { EditHandles } from './edit-handles.tsx';
import { editMode, modeApplies, NO_MODE, type EditMode } from './edit-mode.ts';

// the manifest's own door that leaves the edit mode (the Escape shortcut of canvas.setEditMode, which carries the
// leaving value): the chrome runs it where a mode has to be let go of, so no command id is written by hand
const LEAVE_MODE = manifest.doors.find((d) => d.door.kind === 'shortcut' && d.door.args.mode === NO_MODE) ?? null;
import { ViewOverlays } from './view-overlays.tsx';
import { GridOverlay } from './grid-overlay.tsx';
// where a label and a resize handle may be drawn (canvas/placement.ts): the rules moved out of this file, which draws
import { controlBoxes, handleHitBox, overlaps as overlapsBox, placeLabel, selectionLabelBox, turnedFrame, visibleCanvas, type Box, type Placement } from './placement.ts';
import { distancesOf, type Distance } from './distances.ts';
import { altDistances, hoverSizeOf, type HoverSize } from './hover-measure.ts';
import { breakpointName } from '../../core/document/breakpoints.ts';
import { useDuplicating, usePointerValue } from '../input/pointer/use-views.ts';
import type { PointerViews } from '../input/pointer/views.ts';

// the entries this module published before the placement rules moved out stay published here: consumers need not change
export {  handleHitBox,   } from './placement.ts';
export type { Box,  } from './placement.ts';

// the resize handles (spec resize-handles): the doors of the resize gesture, one per handle, drawn on the one selected
// element that can be resized (not the page, not locked, shown), each pressed outside the element
// (the resize gesture: the one whose Shift keeps the aspect ratio, interactions.json)
const RESIZE_GESTURE = manifest.interactions.gestures.find((g) => g.modifiers.some((m) => m.meaning === 'toggle-aspect-ratio'))?.id;
const RESIZE_DOORS = manifest.doors.filter((d) => d.door.kind === 'canvas-handle' && d.door.gesture === RESIZE_GESTURE);
// the handle of an edge's whole length (resize-edge-n, -e, -s, -w): each side of the selected element is a grip
// (interactions.json resize.edgeGrip screen px inside its border, over the padding band there), so a person who takes
// the edge itself resizes, as in a design tool, and the handle at the side's middle is not the only place that does
const isEdgeGrip = (entry: (typeof RESIZE_DOORS)[number]): boolean => entry.door.kind === 'canvas-handle' && entry.door.handle.includes('-edge-');
const RESIZE_HANDLES = RESIZE_DOORS.filter((entry) => !isEdgeGrip(entry));
const EDGE_GRIPS = RESIZE_DOORS.filter(isEdgeGrip);
const EDGE_GRIP = numberConstant('resize.edgeGrip');
// an edge grip's box on the chrome: the whole side, EDGE_GRIP deep inside the element, touching its border line
const edgeGripBox = (side: string, b: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): CSSProperties => {
  const deep = Math.min(EDGE_GRIP, b.width / 4, b.height / 4);
  if (side === 'n') return { left: b.x, top: b.y, width: b.width, height: deep };
  if (side === 's') return { left: b.x, top: b.y + b.height - deep, width: b.width, height: deep };
  if (side === 'w') return { left: b.x, top: b.y, width: deep, height: b.height };
  return { left: b.x + b.width - deep, top: b.y, width: deep, height: b.height };
};
// the rotation handle (spec rotation-handle): outside the selection's top-right corner, dragged by the pointer owner
const ROTATE_GESTURE = manifest.interactions.gestures.find((g) => g.modifiers.some((m) => m.meaning === 'snap-to-15-degree-steps'))?.id;
const ROTATE_HANDLE = manifest.doors.find((d) => d.door.kind === 'canvas-handle' && d.door.gesture === ROTATE_GESTURE) ?? null;
// Whether a resize handle has room on the element (interactions.json resize.handleRoom): the top and bottom ones where
// it is tall enough on the screen, the sides where it is wide enough, a corner where it is both, so the handles never
// cover a small element and a press on it drags it (the user's real use, 2026-09-27).
const HANDLE_ROOM = (() => {
  const value = manifest.interactions.constants.find((c) => c.id === 'resize.handleRoom')?.value;
  if (typeof value !== 'number') throw new Error('interactions.json has no number resize.handleRoom');
  return value;
})();
// the side a handle stands for ("resize-nw" -> "nw"): the letters after its last dash, never the handle's own name
// (which carries n, s, e and w in "resize" itself)
const handleSide = (handle: string): string => handle.slice(handle.lastIndexOf('-') + 1);
const roomFor = (handle: string, b: { readonly width: number; readonly height: number }) => {
  const side = handleSide(handle);
  return (!/[ns]/.test(side) || b.height >= HANDLE_ROOM) && (!/[ew]/.test(side) || b.width >= HANDLE_ROOM);
};
const handlePoint = (handle: string, b: { x: number; y: number; width: number; height: number }) => {
  const side = handleSide(handle);
  return { left: b.x + (side.includes('w') ? 0 : side.includes('e') ? b.width : b.width / 2), top: b.y + (side.includes('n') ? 0 : side.includes('s') ? b.height : b.height / 2) };
};



// How many siblings on each side of the selected element are measured for the handles: the ones sharing a handle's
// edge (in a grid a good number of columns away). A very long child list is not measured whole, per frame.
const HANDLE_KIN = 8;

const PALETTE = new Map(manifest.elements.palette.flatMap((g) => g.entries.map((e) => [e.id, e] as const)));

// What a creation drag inserts, as its words and its ghost show it: a palette entry's label and its element's icon, or
// a component's name and its tile's icon (spec reusable-components); null for a tile that stands for neither.
function insertingLook(inserting: Inserting): { readonly name: { readonly key: MessageId } | string; readonly icon: string; readonly id: string } | null {
  const entry = inserting.args.entry;
  const item = typeof entry === 'string' ? PALETTE.get(entry) : undefined;
  if (item !== undefined) return { name: { key: item.labelKey as MessageId }, icon: elementIcon(item.element) ?? GLYPHS.folder, id: item.id };
  const component = inserting.args.component;
  if (typeof component === 'string') return { name: component, icon: inserting.tile.door.icon ?? GLYPHS.folder, id: component };
  return null;
}
// where a creation drag's ghost sits from the pointer, in screen pixels (interactions.json)
const GHOST_OFFSET = ((): readonly [number, number] => {
  const value = manifest.interactions.constants.find((c) => c.id === 'drag.ghostOffset')?.value;
  if (!Array.isArray(value) || typeof value[0] !== 'number' || typeof value[1] !== 'number') throw new Error('interactions.json has no pair drag.ghostOffset');
  return [value[0], value[1]];
})();
// how long the elements a drop placed flash (interactions.json drop.flashDuration)
const FLASH_MS = (() => {
  const value = manifest.interactions.constants.find((c) => c.id === 'drop.flashDuration')?.value;
  if (typeof value !== 'number') throw new Error('interactions.json has no number drop.flashDuration');
  return value;
})();
// how long the ghost of a cancelled creation drag takes to go back to its tile: halfway between the bounds of
// interactions.json (spec drag-level-keys-escape, Problems in Pager 4: 150 to 250 ms)
const GHOST_RETURN_MS = ((): number => {
  const bound = (id: string) => manifest.interactions.constants.find((c) => c.id === id)?.value;
  const [min, max] = [bound('drag.cancelReturnMin'), bound('drag.cancelReturnMax')];
  if (typeof min !== 'number' || typeof max !== 'number') throw new Error('interactions.json has no number drag.cancelReturnMin or drag.cancelReturnMax');
  return (min + max) / 2;
})();

// What the drop indicator draws: the drag in progress (pointer.ts), or the aim of the keyboard's hand, which has no
// pointer and no ghost (and climbs no level of a drag).
type DropView = Pick<DragView, 'dragged' | 'inserting' | 'proposal' | 'refusal' | 'redirect' | 'levels' | 'side'> & { readonly at: DragView['at'] | null };

// The words of the drag in progress (archive/DESIGN.md "Canvas", drag): what its drop label reads, and, for a palette
// tile's creation drag, the status bar too (spec palette-drag-insert, Problems in Pager 1 and 2). Over the dragged
// nodes' own subtree, or where the new element's command refuses it, the refusal; a move reads "Drop in Hero · position
// 2 of 3"; a creation drag "Insert Paragraph · position 2 of 4 in Hero", or "Insert Container · into Actions" into a
// receiver with no child, and, with no proposal (off the page), "Outside the page — release to cancel.". Null for a
// move with no proposal. The hand's aim reads as a move, or its refusal. A proposal the level keys climbed says how
// many receiver levels it climbed ("· ↑1", spec drag-level-keys-escape, Problems in Pager 3): the levels actually
// climbed, never the keys pressed.
function dragWords(document: DocumentJson, view: DropView): Message | null {
  const { proposal, dragged, inserting, refusal, levels } = view;
  // a confirmed side drop names the wrapper it creates, or the refusal its wrap would meet
  if (view.side?.armed === true) return view.side.refusal ?? sideWords(document, view.side, dragged, inserting);
  if (proposal === null) return inserting !== null ? message('status.drop.outsidePage') : null;
  // the refusal its drop would meet (a creation drag's, the hand's aim), else the dragged nodes' own subtree
  if (refusal !== null) return refusal;
  if (proposal.refused) return message('status.refused.intoItself');
  const receiver = locate(document, proposal.parent)?.node ?? null;
  if (receiver === null) return null;
  // in words (the user's real-use audit, item 3.3): the neighbours the drop lands between, and the path to the receiver
  const siblings = receiver.children.filter((c) => !dragged.includes(c.id));
  const before = siblings[proposal.index - 1]?.name;
  const after = siblings[proposal.index]?.name;
  const where = { path: pathTo(document, receiver.id), before: before ?? '', after: after ?? '', levels: levels > 0 ? `↑${levels}` : '' };
  const place = before !== undefined && after !== undefined ? 'between' : after !== undefined ? 'first' : before !== undefined ? 'last' : 'into';
  const suffix = levels > 0 ? 'Level' : '';
  if (inserting === null) return message(`canvas.drop.${place}${suffix}` as MessageId, where);
  return message(`canvas.insert.${place}${suffix}` as MessageId, { ...where, element: insertingLook(inserting)?.name ?? '' });
}

// The names from the page root to a node, joined as the breadcrumb joins them; past three levels the outer ones are
// left out (archive/DESIGN.md "Canvas", drag).
const PATH_SHOWN = 3;
function pathTo(document: DocumentJson, id: NodeId): string {
  const names: string[] = [];
  for (let at = locate(document, id); at !== null; at = at.parent === null ? null : locate(document, at.parent.id)) names.unshift(at.node.name);
  return (names.length > PATH_SHOWN ? ['…', ...names.slice(-PATH_SHOWN)] : names).join(' › ');
}

// Everything the drop's label and the status bar read, in order: the refusal met where the pointer is when the drop
// moved to the nearest place that takes it (spec drag-layout, Problems in Pager 4), then where it lands.
export function dragMessages(document: DocumentJson, view: DropView, duplicate = false): readonly Message[] {
  const words = dragWords(document, view);
  if (words === null) return [];
  const said = view.redirect !== null && view.side?.armed !== true ? [view.redirect.why, words] : [words];
  // the duplicate's key held over an element drag: a copy lands there (spec drag-duplicate)
  return duplicate && view.dragged.length > 0 && view.inserting === null && view.side?.armed !== true ? [message('canvas.drag.duplicating'), ...said] : said;
}

// What a confirmed side drop reads: "Side by side: Paragraph beside Card" (the wrapper the release builds, named by
// what it will look like; a Column in a row parent reads "Stacked").
function sideWords(document: DocumentJson, side: SideView, dragged: readonly NodeId[], inserting: Inserting | null): Message {
  const target = locate(document, side.offer.target)?.node.name ?? '';
  const first = dragged[0] === undefined ? null : (locate(document, dragged[0])?.node.name ?? null);
  const looked = inserting === null ? null : insertingLook(inserting);
  const name = looked !== null ? looked.name : dragged.length > 1 ? String(dragged.length) : (first ?? '');
  return message(side.offer.wrapper === 'row' ? 'canvas.drop.sideRow' : 'canvas.drop.sideColumn', { name, target });
}

// Where an insertion line is drawn: its place and its length; its thickness is the class's (across or down).
const lineStyle = (b: Box): CSSProperties => (b.height === 0 ? { left: b.x, top: b.y, width: b.width } : { left: b.x, top: b.y, height: b.height });

// The line of a confirmed side drop: along the target's side edge, on the side the dragged element goes.
function sideLine(target: Box, side: SideView['offer']): Box {
  if (side.wrapper === 'row') return { x: side.side === 'before' ? target.x : target.x + target.width, y: target.y, width: 0, height: target.height };
  return { x: target.x, y: side.side === 'before' ? target.y : target.y + target.height, width: target.width, height: 0 };
}

interface Layout {
  readonly selected: readonly Box[];
  // the box around every selected node, drawn dashed while several are selected (archive/DESIGN.md "Canvas", multi)
  readonly union: Box | null;
  readonly hovered: Box | null;
  // `seen`: whether its place lies in view (the element's top inside the page's view, the label inside the stage): it
  // is drawn fixed in the window (canvas.css), so nothing clips it and it hides itself where it would stand out of view
  readonly label: { readonly box: Box; readonly placement: Placement; readonly covers?: boolean; readonly seen?: boolean } | null;
  // where the text toolbar goes while a text is edited in place: above the edit's label, placed with it as one
  readonly toolbar: { readonly x: number; readonly y: number } | null;
  // the marquee's band while one is drawn (pointer.ts)
  readonly band: Box | null;
  // where the four rotation zones of the one selected node go (rotateSpot), in ROTATE_ZONES order
  readonly rotate: readonly { readonly x: number; readonly y: number }[] | null;
  // whether the one selected element's own declarations move its start edge on each axis (4.2): where they do not
  // (the parent lays it out, an inline-level element), the north and west handles are drawn disabled with the reason
  readonly starts: { readonly x: boolean; readonly y: boolean } | null;
  // the one selected element's size in CSS px, the label's own chip (item 4.2: "L x A", live while a drag goes on)
  readonly size: { readonly width: number; readonly height: number } | null;
  // the element's own rotation in degrees (0 when it holds none): the outline and the handles turn with it (item 4.4)
  readonly rotation: number;
  // the hovered element's size in CSS px, drawn below its hover outline (spec hover-measure)
  readonly hoverSize: HoverSize | null;
  // while Alt is held, the distances from the selection to the hovered element, each a line and its length in CSS px
  readonly distances: readonly Distance[];
  // the boxes of the one selected element's neighbouring siblings, in the chrome layer's pixels: a resize handle
  // keeps its hit area out of them (handleHitBox, the canvas audit of 2026-09-28), so the element below the edge
  // keeps being its own press
  readonly neighbours: readonly Box[];
  // the selection this layout was measured for: a label measured for another is not drawn yet (for a frame after a new
  // selection the label showed its new name where the last one stood, and the quick panel's chip followed it there)
  readonly measuredFor: string;
  // --space-6: the side of a resize handle's square, read with the rest of the layer's own measures
  readonly handleSize: number;
}

// The distances a resize in flow measures (item 4.5): the gap from the box being resized to its nearest sibling
// along each axis the handle drags, drawn as the Alt measurement is. A flow resize moves against its neighbours, and
// the number says where it stands from them.
function resizeDistances(iframe: HTMLIFrameElement, drawn: DocumentJson, id: string, handle: string, zoom: number, local: (b: Box | null) => Box | null): Distance[] {
  const found = locate(drawn, id as NodeId);
  const mine = local(nodeBox(iframe, id));
  if (found === null || found.parent === null || mine === null) return [];
  const side = handleSide(handle);
  const axes: readonly ('x' | 'y')[] = [...(side.includes('e') || side.includes('w') ? (['x'] as const) : []), ...(side.includes('n') || side.includes('s') ? (['y'] as const) : [])];
  const out: Distance[] = [];
  for (const axis of axes) {
    let best: Box | null = null;
    let gap = Number.POSITIVE_INFINITY;
    for (const sibling of found.parent.children) {
      if (sibling.id === id) continue;
      const box = local(nodeBox(iframe, sibling.id));
      if (box === null) continue;
      const away = axis === 'x' ? (box.x >= mine.x + mine.width ? box.x - (mine.x + mine.width) : box.x + box.width <= mine.x ? mine.x - (box.x + box.width) : -1) : box.y >= mine.y + mine.height ? box.y - (mine.y + mine.height) : box.y + box.height <= mine.y ? mine.y - (box.y + box.height) : -1;
      if (away >= 0 && away < gap) {
        gap = away;
        best = box;
      }
    }
    if (best === null) continue;
    out.push(...distancesOf(mine, best, null, zoom).filter((d) => (axis === 'x' ? d.box.width > 0 : d.box.height > 0)));
  }
  return out;
}


// The rotation zone's place (spec rotation-handle; item 4.4: one zone outside each of the four corners): a fixed
// screen distance outside the corner, held inside the canvas (the chrome is clipped to it): inside the corner on a
// side where outside would leave it, and at the canvas's edge when even the corner lies beyond it (a turned element's
// box can be larger than the page)
function rotateSpot(box: Box, area: { readonly width: number; readonly height: number }, size: number, gap: number, side: string): { readonly x: number; readonly y: number } {
  const west = side.includes('w');
  const north = side.includes('n');
  const outside = { x: west ? box.x - gap - size : box.x + box.width + gap, y: north ? box.y - gap - size : box.y + box.height + gap };
  const x = west ? (outside.x >= 0 ? outside.x : box.x + gap) : outside.x + size <= area.width ? outside.x : box.x + box.width - gap - size;
  const y = north ? (outside.y >= 0 ? outside.y : box.y + gap) : outside.y + size <= area.height ? outside.y : box.y + box.height - gap - size;
  return { x: Math.min(Math.max(x, 0), area.width - size), y: Math.min(Math.max(y, 0), area.height - size) };
}
// A zone's place once the element itself is turned (item 4.4): its place about the element's centre, held inside the
// canvas as rotateSpot's is. The zone is round, so turning it is moving it — and a wide turned element's corner can
// leave the canvas, where a CSS turn could not hold it in.
function turnedSpot(spot: { readonly x: number; readonly y: number }, box: Box, rotation: number, size: number, area: { readonly width: number; readonly height: number }): { readonly x: number; readonly y: number } {
  if (rotation === 0) return spot;
  const radians = (rotation * Math.PI) / 180;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const at = { x: spot.x + size / 2 - centre.x, y: spot.y + size / 2 - centre.y };
  const turned = { x: centre.x + at.x * Math.cos(radians) - at.y * Math.sin(radians), y: centre.y + at.x * Math.sin(radians) + at.y * Math.cos(radians) };
  return { x: Math.min(Math.max(turned.x - size / 2, 0), area.width - size), y: Math.min(Math.max(turned.y - size / 2, 0), area.height - size) };
}
// the four zones, in the manifest's own handle order (the corners of the box)
const ROTATE_ZONES: readonly string[] = ['nw', 'ne', 'se', 'sw'];
// Whether the one selected element's own declarations move its start edge on each axis (item 4.2): a positioned
// element by left/top, a block-level element in a block container by its margins. Where the parent lays it out (a
// flex or a grid) or the element is inline-level, that edge is the parent's, and the north or west handle is drawn
// disabled with the reason (spec resize-handles).
function startsOf(iframe: HTMLIFrameElement, id: string | null): Layout['starts'] {
  if (id === null) return null;
  return resizeBasis(iframe, id)?.starts ?? null;
}

// How one drawn control of the selection turns with it: the element's rotation about the element's centre, whatever
// the control's own place (its transform-origin is the vector from the control's corner to that centre)
function spun(rotation: number, box: Box, at2: { readonly left?: number; readonly top?: number; readonly x?: number; readonly y?: number }): CSSProperties | undefined {
  if (rotation === 0) return undefined;
  const x = at2.left ?? at2.x ?? 0;
  const y = at2.top ?? at2.y ?? 0;
  return { transform: `rotate(${rotation}deg)`, transformOrigin: `${box.x + box.width / 2 - x}px ${box.y + box.height / 2 - y}px` };
}

// whether a handle carries a start edge that is not the element's to move (north or west): it is drawn disabled
const startHeld = (handle: string, starts: Layout['starts']): boolean => {
  if (starts === null) return false;
  const side = handleSide(handle);
  return (side.includes('n') && !starts.y) || (side.includes('w') && !starts.x);
};

const EMPTY: Layout = { selected: [], union: null, hovered: null, label: null, toolbar: null, band: null, rotate: null, starts: null, size: null, rotation: 0, hoverSize: null, distances: [], neighbours: [], handleSize: 24, measuredFor: '' };

// whether two pieces of what the chrome draws read the same (the layout is compared as its text, so an unchanged
// measure is not drawn again)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// the smallest box around every box given; null for none
function unionOf(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}



// Where the insertion line of a drop goes, on the screen: in the middle of the gap between the reference and its
// neighbour on the side of the drop as shown (the reference's own edge when it has none there), along the receiver's
// flow axis; across the receiver's box, or across the line of children the reference is on (`across`, when the
// receiver lays its children on several lines: a grid's row, a wrapped line).
function dropLine(axis: 'x' | 'y', receiver: Box, reference: Box, neighbour: Box | null, placement: 'before' | 'after', across: { readonly from: number; readonly to: number } | null = null): Box {
  const [start, end] = axis === 'y' ? [(b: Box) => b.y, (b: Box) => b.y + b.height] : [(b: Box) => b.x, (b: Box) => b.x + b.width];
  const at = placement === 'before' ? (neighbour ? (end(neighbour) + start(reference)) / 2 : start(reference)) : neighbour ? (end(reference) + start(neighbour)) / 2 : end(reference);
  const span = across ?? (axis === 'y' ? { from: receiver.x, to: receiver.x + receiver.width } : { from: receiver.y, to: receiver.y + receiver.height });
  return axis === 'y' ? { x: span.from, y: at, width: span.to - span.from, height: 0 } : { x: at, y: span.from, width: 0, height: span.to - span.from };
}

// The insertion line's reference, neighbour and side as shown (spec drag-reorder-canvas, Problems in Pager 5): a
// neighbour on another line of children is none; at the end of a line (the slot's child begins the next line) the
// line is drawn after the child before it when the pointer is on that child's line; in a parent that shows its
// children reversed, before in the document is after as shown.
function shownAnchor(axis: 'x' | 'y', reversed: boolean, reference: Box, neighbour: Box | null, placement: 'before' | 'after', pointer: { readonly x: number; readonly y: number } | null): { reference: Box; neighbour: Box | null; placement: 'before' | 'after' } {
  let anchor = { reference, neighbour, placement };
  if (neighbour !== null && !sameLine(reference, neighbour, axis)) {
    const cross = pointer === null ? null : axis === 'x' ? pointer.y : pointer.x;
    const onNeighbour = cross !== null && (axis === 'x' ? cross >= neighbour.y && cross <= neighbour.y + neighbour.height : cross >= neighbour.x && cross <= neighbour.x + neighbour.width);
    anchor = onNeighbour ? { reference: neighbour, neighbour: null, placement: placement === 'before' ? 'after' : 'before' } : { reference, neighbour: null, placement };
  }
  return reversed ? { ...anchor, placement: anchor.placement === 'before' ? 'after' : 'before' } : anchor;
}

// The sibling an insertion line is drawn against, and its neighbour on that side: the proposal's own reference
// beside a sibling; inside a container, the child at the slot (before it) or the last child (after it); none for a
// refused proposal or a container with no other child, which shows its outline alone.
function lineAnchor(proposal: DropProposal, siblings: readonly string[]): { reference: string; neighbour: string | null; placement: 'before' | 'after' } | null {
  if (proposal.refused) return null;
  if (proposal.placement !== 'inside') {
    const at = siblings.indexOf(proposal.reference);
    return { reference: proposal.reference, neighbour: siblings[proposal.placement === 'before' ? at - 1 : at + 1] ?? null, placement: proposal.placement };
  }
  const slot = siblings[proposal.index];
  if (slot !== undefined) return { reference: slot, neighbour: siblings[proposal.index - 1] ?? null, placement: 'before' };
  const last = siblings.at(-1);
  return last === undefined ? null : { reference: last, neighbour: null, placement: 'after' };
}

interface DropLayout {
  readonly line: Box | null;
  readonly receiver: Box;
  // the element that refused what the drag brings, drawn refused, when the drop moved to the nearest valid place
  readonly refuser: Box | null;
  readonly label: { readonly box: Box; readonly placement: Placement } | null;
}

// The hand's aim as a drop (spec hand-keyboard-move: "the same indicator a mouse drag draws"): the held element is
// dragged, the aim is a slot inside its receiver, and the move's refusal of the aim, if any, is the drop's.
function handDrop(hand: HandState): DropView {
  const { parent, index } = hand.aim;
  return { dragged: [hand.held], inserting: null, proposal: { parent, index, placement: 'inside', reference: parent, refused: false }, refusal: hand.refusal, redirect: null, levels: 0, side: null, at: null };
}

// The drop indicator of the drag in progress (spec drag-reorder-canvas, "Visual feedback", and Problems in Pager 3):
// the insertion line where the dragged nodes will land, the receiving parent's outline, and the label naming the
// receiver and the position ("Drop in Hero · position 1 of 3", archive/DESIGN.md "Canvas", drag), placed by the label
// rule next to the line, never at the receiver's far corner. A proposal that the command would refuse (a creation
// drag's, the hand's aim) is drawn refused (spec palette-drag-insert, Problems in Pager 3). A drag's proposal drawn is
// the one of the level the level keys set (drag-session.ts), redrawn as soon as a key changes it.
function DropIndicator({ view }: { readonly view: DropView }) {
  const document = useEditorState((s) => s.document);
  const t = useT();
  const layer = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<DropLayout | null>(null);
  const { dragged } = view;
  const armed = view.side?.armed === true ? view.side : null;
  const refusedHere = armed !== null ? armed.refusal !== null : view.refusal !== null;
  const proposal = useMemo(() => (view.proposal !== null && refusedHere ? { ...view.proposal, refused: true } : view.proposal), [view.proposal, refusedHere]);
  const sideTarget = armed?.offer.target ?? null;
  const sideOffer = armed?.offer ?? null;
  // where the pointer is, for the line at the end of a line of children (shownAnchor)
  const pointerAt = view.at;
  const copying = useDuplicating();
  const words = dragMessages(document, view, copying);
  const redirectFrom = view.redirect?.from ?? null;
  const receiver = proposal === null ? null : (locate(document, proposal.parent)?.node ?? null);
  const siblings = receiver === null ? [] : receiver.children.filter((c) => !dragged.includes(c.id));

  useEffect(() => {
    let request = 0;
    const parent = proposal === null ? null : (locate(document, proposal.parent)?.node ?? null);
    if (proposal === null || parent === null) {
      request = requestAnimationFrame(() => setLayout(null));
      return () => cancelAnimationFrame(request);
    }
    const siblings = parent.children.filter((c) => !dragged.includes(c.id));
    const anchor = lineAnchor(proposal, siblings.map((c) => c.id));
    const measure = () => {
      const iframe = canvasFrame();
      const origin = layer.current?.getBoundingClientRect();
      if (iframe && origin) {
        const local = (b: Box | null): Box | null => (b === null ? null : { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height });
        // a confirmed side drop: the target is the receiver, the line runs along its side edge
        const target = sideTarget === null ? null : local(nodeBox(iframe, sideTarget));
        const box = target ?? local(nodeBox(iframe, proposal.parent));
        const reference = anchor === null ? null : local(nodeBox(iframe, anchor.reference));
        const next = anchor?.neighbour == null ? null : local(nodeBox(iframe, anchor.neighbour));
        if (box && (target !== null || anchor === null || reference)) {
          // the line between the neighbours as shown, across the line of children they are on when there are several
          const axis = flowAxis(iframe, proposal.parent);
          const laid = siblings.flatMap((c) => {
            const b = local(nodeBox(iframe, c.id));
            return b === null ? [] : [{ box: b }];
          });
          const lines = linesOf(laid, axis);
          const pointer = pointerAt === null ? null : local({ x: pointerAt.x, y: pointerAt.y, width: 0, height: 0 });
          const shown = anchor !== null && reference ? shownAnchor(axis, flowReversed(iframe, proposal.parent), reference, next, anchor.placement, pointer) : null;
          const across = shown === null || lines.length < 2 ? null : lineExtent(lines.find((l) => l.some((i) => sameLine(i.box, shown.reference, axis))) ?? [{ box: shown.reference }], axis);
          const line = target !== null && sideOffer !== null ? sideLine(target, sideOffer) : shown !== null ? dropLine(axis, box, shown.reference, shown.neighbour, shown.placement, across) : null;
          const size = label.current ? { width: label.current.offsetWidth, height: label.current.offsetHeight } : null;
          const gap = parseFloat(getComputedStyle(layer.current as HTMLDivElement).getPropertyValue('--space-2')) || 0;
          const content = [...contentBoxes(iframe).map((b) => local(b) as Box), ...(layer.current === null ? [] : controlBoxes(layer.current, origin))];
          // the drag's ghost chip, drawn beside the pointer over the whole window: the label never lies under it
          const chip = layer.current?.ownerDocument.querySelector('[data-chrome="ghost"]')?.closest('.chrome-ghost-stack')?.getBoundingClientRect();
          const ghost = chip === undefined ? null : local({ x: chip.x, y: chip.y, width: chip.width, height: chip.height });
          const placed = size === null ? null : placeLabel(line ?? box, size, gap, content, visibleCanvas(origin), ghost);
          const refuser = redirectFrom === null ? null : local(nodeBox(iframe, redirectFrom));
          const nextLayout: DropLayout = { line, receiver: box, refuser, label: placed };
          setLayout((before) => (same(before, nextLayout) ? before : nextLayout));
        }
      }
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [proposal, dragged, document, sideTarget, sideOffer, pointerAt, redirectFrom]);

  if (proposal === null || receiver === null) return <div ref={layer} className="chrome__drop" />;
  const at = (b: Box): CSSProperties => ({ left: b.x, top: b.y, width: b.width, height: b.height });
  // refused over the dragged subtree; into a container that shows no line (it has no other child); or between siblings
  const state = proposal.refused ? 'refused' : armed !== null ? 'side' : lineAnchor(proposal, siblings.map((c) => c.id)) === null ? 'into' : 'between';
  return (
    <div ref={layer} className="chrome__drop" data-chrome="drop">
      {layout ? <div className={`chrome__receiver is-${state}`} data-chrome="drop-receiver" data-state={state} style={at(layout.receiver)} /> : null}
      {layout?.refuser ? <div className="chrome__receiver is-refused" data-chrome="drop-refused" style={at(layout.refuser)} /> : null}
      {layout?.line ? <div className={`chrome__drop-line is-${layout.line.height === 0 ? 'across' : 'down'}${proposal.refused ? ' is-refused' : ''}`} data-chrome="drop-line" style={lineStyle(layout.line)} /> : null}
      <div
        ref={label}
        className={`chrome__label${layout?.label ? '' : ' is-measuring'}${proposal.refused ? ' is-refused' : ''}`}
        data-chrome="drop-label"
        data-placement={layout?.label?.placement}
        style={layout?.label ? { left: layout.label.box.x, top: layout.label.box.y } : undefined}
      >
        <span className="chrome__name">{words.map((w) => t(w.key, w.params)).join(' · ')}</span>
      </div>
    </div>
  );
}

// The ghost of a palette tile's creation drag (spec palette-drag-insert, Problems in Pager 4): a chip with the new
// element's icon and name, at drag.ghostOffset from the pointer wherever it is in the window (over the palette, the
// stage or the page), so a creation drag never looks like the move of an element of the same name. Drawn over the
// whole window (a portal on the body), never a pointer target; refused (off the page, or where the element is
// refused) it wears the refusal's colour.
function Ghost({ inserting, at, refused, note = null, ref }: {
  readonly inserting: Inserting;
  readonly at: { readonly x: number; readonly y: number };
  readonly refused: boolean;
  readonly note?: GhostNote | null;
  readonly ref?: Ref<HTMLDivElement>
}) {
  const t = useT();
  const looked = insertingLook(inserting);
  if (looked === null) return null;
  return createPortal(
    <div className="chrome-ghost-stack" style={{ left: at.x + GHOST_OFFSET[0], top: at.y + GHOST_OFFSET[1] }}>
      <div ref={ref} className={`chrome-ghost${refused ? ' is-refused' : ''}`} data-chrome="ghost" data-entry={looked.id}>
        <Icon name={looked.icon} size="sm" />
        <span className="chrome-ghost__label">{typeof looked.name === 'string' ? looked.name : t(looked.name.key)}</span>
      </div>
      <Note note={note} />
    </div>,
    document.body,
  );
}

// What the ghost says under its chip about a side drop (spec drag-layout, row 5): offered, how to confirm it (a hint);
// confirmed, what the release creates (the pill, with the wrapper's glyph), or the refusal its wrap would meet.
export interface GhostNote {
  readonly kind: 'hint' | 'pill';
  readonly words: Message;
  readonly wrapper: 'row' | 'column';
  readonly refused: boolean;
}
function Note({ note }: { readonly note: GhostNote | null }) {
  const t = useT();
  if (note === null) return null;
  return (
    <div className={`chrome__${note.kind}${note.refused ? ' is-refused' : ''}`} data-chrome={note.kind === 'pill' ? 'side-pill' : 'side-hint'}>
      {note.kind === 'pill' ? <Icon name={note.wrapper === 'row' ? GLYPHS.sideRow : GLYPHS.sideColumn} size="sm" /> : null}
      {t(note.words.key, note.words.params)}
    </div>
  );
}
// the note of the drag in progress: the side drop it offers or has confirmed, if any
function ghostNote(document: DocumentJson, view: DragView): GhostNote | null {
  const side = view.side;
  if (side === null) return null;
  if (!side.armed) return { kind: 'hint', words: message('canvas.drop.sideHint'), wrapper: side.offer.wrapper, refused: false };
  return { kind: 'pill', words: side.refusal ?? sideWords(document, side, view.dragged, view.inserting), wrapper: side.offer.wrapper, refused: side.refusal !== null };
}

// The ghost of an element drag (spec drag-layout, row 4): the dragged element's icon and name ("3 elements" for
// several) beside the pointer, as a creation drag's ghost, while the element itself keeps its place, outlined dashed.
function MovingGhost({ dragged, at, refused, note }: { readonly dragged: readonly NodeId[]; readonly at: { readonly x: number; readonly y: number }; readonly refused: boolean; readonly note: GhostNote | null }) {
  const t = useT();
  const first = useEditorState((s) => (dragged[0] === undefined ? null : (locate(s.document, dragged[0])?.node ?? null)));
  if (first === null) return null;
  return createPortal(
    <div className="chrome-ghost-stack" style={{ left: at.x + GHOST_OFFSET[0], top: at.y + GHOST_OFFSET[1] }}>
      <div className={`chrome-ghost${refused ? ' is-refused' : ''}`} data-chrome="ghost" data-node={first.id}>
        <Icon name={elementIcon(first.type) ?? GLYPHS.folder} size="sm" />
        <span className="chrome-ghost__label">{dragged.length > 1 ? t('canvas.selectedCount', { count: dragged.length }) : first.name}</span>
      </div>
      <Note note={note} />
    </div>,
    document.body,
  );
}

// The elements a drop has just placed flash for drop.flashDuration (spec drag-layout, row 10): an outline in the drop
// colour that fades, drawn over each of them; at once gone when the person asks for reduced motion.
function DropFlash() {
  const drop = usePointerValue('lastDrop');
  const [boxes, setBoxes] = useState<{ readonly id: number; readonly boxes: readonly Box[] } | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (drop === null) return;
    const iframe = canvasFrame();
    const origin = layer.current?.parentElement?.getBoundingClientRect();
    if (!iframe || !origin) return;
    const found = drop.nodes.map((id) => nodeBox(iframe, id)).filter((b): b is Box => b !== null).map((b) => ({ x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height }));
    setBoxes({ id: drop.id, boxes: found });
    const done = setTimeout(() => setBoxes((now) => (now?.id === drop.id ? null : now)), FLASH_MS);
    return () => clearTimeout(done);
  }, [drop]);
  return (
    <div ref={layer} className="chrome__flashes">
      {boxes?.boxes.map((b, i) => <div key={`${boxes.id}-${i}`} className="chrome__flash" data-chrome="drop-flash" style={{ left: b.x, top: b.y, width: b.width, height: b.height, animationDuration: `${FLASH_MS}ms` }} />)}
    </div>
  );
}

// The element of a captured page the captured inspector or a press on the canvas selected (ui.capturedNode, spec
// capture-url): its outline and a label with its tag, in the selection's colours, measured on every animation frame
// (the page scrolls, zooms and lays out under it).
function CapturedSelection() {
  const id = useEditorState((s) => s.ui.capturedNode ?? null);
  const [shown, setShown] = useState<{ readonly id: string; readonly box: Box; readonly tag: string; readonly edge: number } | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (id === null) return;
    let request = 0;
    const measure = () => {
      const iframe = canvasFrame();
      const origin = layer.current?.parentElement?.getBoundingClientRect();
      const found = iframe && origin ? capturedBox(iframe, id) : null;
      // the label touches the frame's line (DEC-70): its width, once the frame is drawn
      const edge = frame.current ? parseFloat(getComputedStyle(frame.current).outlineWidth) || 0 : 0;
      setShown((was) => {
        if (found === null || !origin) return null;
        const next = { x: found.box.x - origin.x, y: found.box.y - origin.y, width: found.box.width, height: found.box.height };
        const same = was !== null && was.id === id && was.tag === found.tag && was.edge === edge;
        return same && was.box.x === next.x && was.box.y === next.y && was.box.width === next.width && was.box.height === next.height ? was : { id, box: next, tag: found.tag, edge };
      });
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [id]);
  // what was measured for another selection (or none) is not drawn
  const drawn = shown !== null && shown.id === id ? shown : null;
  const origin = useScreenOrigin(layer, drawn !== null);
  // the label's one place (DEC-70): above the element, touching its frame, at the frame's left edge (its own height is
  // taken by the stylesheet's translate), fixed in the window as the selection's label; away while the element's top
  // is out of the page's view
  return (
    <div ref={layer} className="chrome__captured">
      {drawn === null ? null : (
        <>
          <div ref={frame} className="chrome__selection" data-chrome="captured-selection" style={{ left: drawn.box.x, top: drawn.box.y, width: drawn.box.width, height: drawn.box.height }} />
          <div className={`chrome__label is-target${drawn.box.y < -drawn.edge - 0.5 ? ' is-away' : ''}`} data-chrome="captured-label" style={{ left: origin.x + drawn.box.x - drawn.edge, top: origin.y + drawn.box.y - drawn.edge }}>
            <span className="chrome__name">{drawn.tag}</span>
          </div>
        </>
      )}
    </div>
  );
}

// The ghost of a creation drag Escape cancelled (pointer.ts, ghostReturn) goes back to the tile it came from and fades
// out over GHOST_RETURN_MS (spec drag-level-keys-escape, Problems in Pager 4), then is drawn no more; at once when the
// person asks for reduced motion.
function ReturningGhost({ view }: { readonly view: GhostReturn }) {
  const ghost = useRef<HTMLDivElement>(null);
  const [back, setBack] = useState(false);
  useLayoutEffect(() => {
    const element = ghost.current;
    if (element === null) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const way = element.animate(
      [
        { transform: 'translate(0px, 0px)', opacity: 1 },
        { transform: `translate(${view.to.x - view.from.x}px, ${view.to.y - view.from.y}px)`, opacity: 0 },
      ],
      { duration: reduced ? 0 : GHOST_RETURN_MS, easing: 'ease-in', fill: 'forwards' },
    );
    let playing = true;
    way.finished.then(
      () => {
        if (playing) setBack(true);
      },
      () => {},
    );
    return () => {
      playing = false;
      way.cancel();
    };
  }, [view]);
  return back ? null : <Ghost ref={ghost} inserting={view.inserting} at={view.from} refused={false} />;
}

// The selected nodes the canvas draws an outline for: those shown. A node hidden itself or inside a hidden element has
// no box on the page, and the canvas draws nothing for it, neither outline nor label: its Layers row, selected and
// marked hidden, says where it is (spec hide-element, Problems in Pager 1; the audit's A3.11). As one text, so the
// store's selector returns the same value while nothing changes.
function drawnTargets(document: DocumentJson, selection: readonly NodeId[]): string {
  return JSON.stringify(selection.filter((id) => !lineage(document, id).some((n: DocNode) => n.hidden === true)));
}

// Where the chrome draws what it draws (CanvasChrome): the boxes of the selection, the hovered element, the band, the
// label and the text toolbar, the rotation zones, the sizes and distances, measured from the page when it may have
// changed and then every frame while the chrome still moves.
function useChromeLayout({ layer, label, bar, selection, targets, hovered, node, drawnBand, editing, altHeld, resizing, documentNow, mode }: {
  readonly layer: RefObject<HTMLDivElement | null>;
  readonly label: RefObject<HTMLDivElement | null>;
  readonly bar: RefObject<HTMLDivElement | null>;
  readonly selection: readonly NodeId[];
  readonly targets: readonly NodeId[];
  readonly hovered: string | null;
  readonly node: DocNode | null;
  readonly drawnBand: Box | null;
  readonly editing: boolean;
  readonly altHeld: boolean;
  readonly resizing: ReturnType<PointerViews['resizingNow']['get']>;
  readonly documentNow: DocumentJson;
  readonly mode: EditMode;
}): Layout {
  const [layout, setLayout] = useState<Layout>(EMPTY);
  useEffect(() => {
    let request = 0;
    // nothing selected, hovered or banded: nothing to measure, and the last layout is dropped
    if (selection.length === 0 && hovered === null && drawnBand === null) {
      request = requestAnimationFrame(() => setLayout(EMPTY));
      return () => cancelAnimationFrame(request);
    }
    let placedFor = '';
    let placed: Layout['label'] = null;
    let placedToolbar: Layout['toolbar'] = null;
    // the layout last measured: a measure that changes it is followed by another, since the overlay's own controls
    // (drawn from it) are what the label keeps clear of; the overlay settles in a frame or two
    let last: Layout | null = null;
    const measure = (): boolean => {
      const iframe = canvasFrame();
      const origin = layer.current?.getBoundingClientRect();
      if (iframe && origin) {
        const local = (b: Box | null): Box | null => (b === null ? null : { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height });
        const selected = targets.map((target) => local(nodeBox(iframe, target))).filter((b): b is Box => b !== null);
        const union = selection.length > 1 ? unionOf(selected) : null;
        // the label belongs to the one selected node, or to the union of several
        const first = union ?? selected[0];
        const size = label.current ? { width: label.current.offsetWidth, height: label.current.offsetHeight } : null;
        const tools = editing && bar.current ? { width: bar.current.offsetWidth, height: bar.current.offsetHeight } : null;
        // the width of the frame's line drawn outside the box (the selection's outline, the union's dashed one): the
        // label touches the line, so it is part of the key the label is placed again on
        const frameLine = layer.current?.querySelector<HTMLElement>(union === null ? '[data-chrome="selection"]' : '[data-chrome="union"]');
        const edge = frameLine ? parseFloat(getComputedStyle(frameLine).outlineWidth) || 0 : 0;
        // the label is placed again only when its element, its size or its frame's line changed: reading the page's
        // content (whether the label lies over text) is the slow part
        // an element's own rotation turns its frame (item 4.4): the label stands on the turned frame's bounding box
        const turn = union === null && selection.length === 1 && selection[0] !== undefined ? elementRotation(iframe, selection[0]) : 0;
        const key = JSON.stringify([first, size, tools, mode, edge, turn, Math.round(origin.x), Math.round(origin.y), Math.round(origin.width), Math.round(origin.height)]);
        if (first === undefined || size === null) {
          placed = null;
          placedToolbar = null;
        } else if (key !== placedFor) {
          // The selection's label has one place (the user's rule of 2026-10-05, DEC-70): above its element, touching
          // the top of the frame's line, at its left edge — whatever lies there, for one element or several, at every
          // zoom, scroll and breakpoint. Over page text it takes no press (`covers`, jornada03 J16). While a text is
          // edited in place, its toolbar sits above the label, at the same start.
          const gap = parseFloat(getComputedStyle(layer.current as HTMLDivElement).getPropertyValue('--space-1')) || 0;
          const content = contentBoxes(iframe).map((b) => local(b) as Box);
          const spot = selectionLabelBox(turn === 0 || first === undefined ? first : turnedFrame(first, turn, edge), size, edge, content);
          // in view while the element's top is inside the page's view and the label inside the stage: the label is
          // fixed in the window, above the page's edge too (an element at the page's top), so no layer clips it, and
          // it hides where it would stand over the rulers, the panels or the breakpoint tabs of a page scrolled away
          const shown = document.querySelector('[data-canvas-stage]')?.getBoundingClientRect();
          const stage = shown === undefined ? { x: 0, y: 0, width: origin.width, height: origin.height } : { x: shown.x - origin.x, y: shown.y - origin.y, width: shown.width, height: shown.height };
          const top = tools === null ? spot.box.y : spot.box.y - gap - tools.height;
          const seen = first.y >= -edge - 0.5 && first.y <= origin.height + 0.5 && spot.box.x >= stage.x - 0.5 && spot.box.x + Math.max(size.width, tools?.width ?? 0) <= stage.x + stage.width + 0.5 && top >= stage.y - 0.5;
          placed = { ...spot, seen };
          placedToolbar = tools === null ? null : { x: spot.box.x, y: top };
        }
        placedFor = key;
        const hoveredBox = hovered !== null && !selection.includes(hovered as (typeof selection)[number]) ? local(nodeBox(iframe, hovered)) : null;
        const style = getComputedStyle(layer.current as HTMLDivElement);
        const single = selection.length === 1 ? selected[0] : undefined;
        const zone = parseFloat(style.getPropertyValue('--space-6')) || 0;
        const gapTo = parseFloat(style.getPropertyValue('--space-4')) || 0;
        const spin = selection.length === 1 && selection[0] !== undefined ? elementRotation(iframe, selection[0]) : 0;
        const rotate = single === undefined ? null : ROTATE_ZONES.map((side) => turnedSpot(rotateSpot(single, origin, zone, gapTo, side), single, spin, zone, origin));
        // the hovered element's size in CSS px, and, with Alt held, its distances to the one selected element
        const zoom = iframe.currentCSSZoom > 0 ? iframe.currentCSSZoom : 1;
        // the hovered element's size chip stands under its bottom-left corner, or under its bottom-right one where the
        // selection's label is (jornada03 J16: a button's label and its section's size chip were drawn one over the
        // other); the chip's own size is read from the one drawn
        const chip = layer.current?.querySelector<HTMLElement>('[data-chrome="hover-size"]');
        const chipSize = { width: chip?.offsetWidth ?? 0, height: chip?.offsetHeight ?? 0 };
        const atStart = hoveredBox === null ? null : { x: hoveredBox.x, y: hoveredBox.y + hoveredBox.height, ...chipSize };
        const meetsLabel = atStart !== null && placed !== null && overlapsBox(atStart, placed.box);
        // the hover measure's own module draws the chip and the Alt distances (hover-measure.ts), nothing when it says
        // none
        const hoverSize = hoverSizeOf(hoveredBox, hovered === null ? null : nodeSize(iframe, hovered), meetsLabel) ?? null;
        // the selected element's own size in CSS px (the label's chip); with several, their union's (the canonical
        // "3 elements selected 1248 × 390")
        const sized = union ?? single;
        const ownSize = sized === undefined ? null : { width: Math.round(sized.width / zoom), height: Math.round(sized.height / zoom) };
        const ancestor = hovered !== null && single !== undefined && selection[0] !== undefined && holdsNode(iframe, hovered, selection[0]);
        const inner = ancestor && hovered !== null ? local(innerBox(iframe, hovered)) : null;
        // a resize in flow draws the distances to its neighbours; Alt over an element draws the ones to it
        const measured = resizing !== null && selection[0] !== undefined ? resizeDistances(iframe, documentNow, selection[0], resizing.handle, zoom, local) : [];
        const distances = measured.length > 0 ? measured : (altDistances(altHeld, single, hoveredBox, inner, zoom) ?? []);
        // the neighbouring siblings of the one selected element, for the resize handles' hit areas (handleHitBox)
        const picked = selection.length === 1 ? selection[0] : undefined;
        const list = picked === undefined ? [] : (locate(documentNow, picked)?.parent?.children ?? []);
        const index = picked === undefined ? -1 : list.findIndex((c) => c.id === picked);
        const kin = index < 0 ? [] : [...list.slice(Math.max(0, index - HANDLE_KIN), index), ...list.slice(index + 1, index + 1 + HANDLE_KIN)];
        const neighbours = kin.flatMap((c) => {
          const b = local(nodeBox(iframe, c.id));
          return b === null ? [] : [b];
        });
        const next: Layout = {
          selected,
          union,
          hovered: hoveredBox,
          label: placed,
          measuredFor: selection.join(' '),
          toolbar: placedToolbar,
          band: local(drawnBand),
          rotate,
          starts: startsOf(iframe, selection.length === 1 ? selection[0] ?? null : null),
          size: ownSize,
          rotation: selection.length === 1 && selection[0] !== undefined ? elementRotation(iframe, selection[0]) : 0,
          hoverSize,
          distances,
          neighbours,
          handleSize: zone > 0 ? zone : 24
        };
        const moved = last === null || !same(last, next);
        last = next;
        setLayout((before) => (same(before, next) ? before : next));
        return moved;
      }
      return false;
    };
    // The overlay measures when the page may have changed (the page clock: a store change, a scroll, a load), then at
    // every frame while its layout still moves (its own controls drawn) or the page moves on its own, and stops once
    // both are still (the plan's stage 4: it measured every frame, always).
    let running = false;
    // frames measured with nothing moving: what it draws from a measure is committed a frame or two later, and its
    // controls are read back by the next measure, so it stops after a few still frames
    let still = 0;
    const STILL_FRAMES = 4;
    const follow = () => {
      const moved = measure();
      still = moved ? 0 : still + 1;
      if (still < STILL_FRAMES || pageAnimating()) request = requestAnimationFrame(follow);
      else running = false;
    };
    const tick = () => {
      still = 0;
      if (running) return;
      running = true;
      follow();
    };
    request = requestAnimationFrame(tick);
    const stop = onPageChange(tick);
    return () => {
      cancelAnimationFrame(request);
      stop();
    };
  }, [selection, targets, hovered, node, drawnBand, editing, altHeld, resizing, documentNow, mode, layer, label, bar]);
  return layout;
}

// The resize handles of the one selected element (item 4.2), but while an Edit on canvas mode draws its own: a handle
// carrying a start edge the element's own declarations cannot move (its parent lays it out) is drawn disabled, with
// the reason, and a press on it is no resize.
function ResizeHandles({ box, shown }: { readonly box: Box; readonly shown: Layout }) {
  const t = useT();
  return RESIZE_HANDLES.filter(isDoorBuilt).filter((entry) => roomFor(entry.door.kind === 'canvas-handle' ? entry.door.handle : '', box)).map((entry) => {
    const handle = entry.door.kind === 'canvas-handle' ? entry.door.handle : '';
    const held = startHeld(handle, shown.starts);
    // the hit area never covers a neighbouring element (handleHitBox); with the element turned it stays where
    // the stylesheet draws it — turning slides it along the neighbours' boxes with the element
    const hit = shown.rotation === 0 ? handleHitBox(handleSide(handle), box, shown.handleSize, shown.neighbours) : null;
    const spot = handlePoint(handle, box);
    const where: CSSProperties =
      hit === null
        ? { ...spot, ...spun(shown.rotation, box, spot) }
        : ({ left: hit.box.x, top: hit.box.y, translate: 'none', '--handle-x': `${hit.at.x * 100}%`, '--handle-y': `${hit.at.y * 100}%` } as CSSProperties);
    return (
      <div
        key={entry.ref}
        className={`chrome__handle${held ? ' is-unavailable' : ''}`}
        data-door={entry.ref}
        data-resize-handle={handle}
        data-chrome="handle"
        aria-disabled={held ? true : undefined}
        title={held ? t('common.disabledTitle', { label: t(entry.door.labelKey as MessageId), reason: { key: 'canvas.resize.parentPlaces' } }) : undefined}
        style={where}
      />
    );
  });
}

// Each side's whole length takes a resize too (resize.edgeGrip), over the padding band along the border; a start edge
// the parent places has none.
function EdgeGrips({ box, shown }: { readonly box: Box; readonly shown: Layout }) {
  const t = useT();
  return EDGE_GRIPS.filter(isDoorBuilt).filter((entry) => roomFor(entry.door.kind === 'canvas-handle' ? entry.door.handle : '', box)).filter((entry) => !startHeld(entry.door.kind === 'canvas-handle' ? entry.door.handle : '', shown.starts)).map((entry) => {
    const handle = entry.door.kind === 'canvas-handle' ? entry.door.handle : '';
    return <div key={entry.ref} className="chrome__edge" data-door={entry.ref} data-resize-handle={handle} data-chrome="edge" title={t(entry.door.labelKey as MessageId)} style={edgeGripBox(handleSide(handle), box)} />;
  });
}

// The rotation zones, one outside each corner (item 4.4): the same door, drawn four times, each turned with the
// element when it holds a rotation.
function RotateZones({ door, spots }: { readonly door: DoorEntry; readonly spots: readonly Point[] }) {
  const t = useT();
  return spots.map((spot, i) => (
    <div
      key={ROTATE_ZONES[i] ?? i}
      className="chrome__rotate"
      data-door={door.ref}
      data-rotate-handle=""
      data-rotate-zone={ROTATE_ZONES[i] ?? ''}
      data-chrome="handle"
      title={t(door.door.labelKey as MessageId)}
      style={{ left: spot.x, top: spot.y }}
    >
      {ROTATE_ZONES[i] === 'ne' ? <Icon name={manifest.layout.glyphs.rotate} size="sm" /> : null}
    </div>
  ));
}

// Where a chrome layer stands in the window, read at every frame while `active` (the page pans, zooms and the panels
// move it): what is drawn fixed in the window from the layer's own pixels adds it (the selection's label, DEC-70).
function useScreenOrigin(layer: RefObject<HTMLElement | null>, active: boolean): { readonly x: number; readonly y: number } {
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!active) return;
    let request = 0;
    const read = () => {
      const box = layer.current?.getBoundingClientRect();
      if (box) setOrigin((was) => (was.x === box.x && was.y === box.y ? was : { x: box.x, y: box.y }));
      request = requestAnimationFrame(read);
    };
    request = requestAnimationFrame(read);
    return () => cancelAnimationFrame(request);
  }, [layer, active]);
  return origin;
}

// The selection's label: the count of several selected elements with their union's size, or the one element's name,
// tag, the class the writes land in, its angle and size, the state and the breakpoint in view (A3.8, A3.36).
function SelectionLabel({ labelRef, selection, node, targets, shown, dropping, editing, styleClass, state, breakpoint, origin }: {
  readonly labelRef: RefObject<HTMLDivElement | null>;
  readonly origin: { readonly x: number; readonly y: number };
  readonly selection: readonly NodeId[];
  readonly node: DocNode | null;
  readonly targets: readonly NodeId[];
  readonly shown: Layout;
  readonly dropping: DropView | null;
  readonly editing: boolean;
  readonly styleClass: string | null;
  readonly state: ReturnType<typeof activeState>;
  readonly breakpoint: ReturnType<typeof activeBreakpoint>;
}) {
  const t = useT();
  // a layout measured for another selection places nothing yet: the label waits, measuring, for its own
  const placed = shown.measuredFor === selection.join(' ') ? shown.label : null;
  // fixed in the window (DEC-70): the chrome layer's place on the screen plus the label's in the layer
  const at = placed ? { left: origin.x + placed.box.x, top: origin.y + placed.box.y } : undefined;
  const away = placed?.seen === false ? ' is-away' : '';
  return selection.length > 1 ? (
    <div
      ref={labelRef}
      className={`chrome__label${placed ? '' : ' is-measuring'}${away}`}
      data-chrome="label"
      data-placement={placed?.placement}
      style={at}
    >
      <span className="chrome__name">{t('canvas.selectedCount', { count: selection.length })}</span>
      {shown.size !== null ? (
        <small className="chrome__label-size" data-chrome="label-size">
          {t('canvas.measure.size', { width: shown.size.width, height: shown.size.height })}
        </small>
      ) : null}
    </div>
  ) : node !== null && targets.includes(node.id) ? (
    <div
      ref={labelRef}
      className={`chrome__label is-target${placed ? '' : ' is-measuring'}${placed?.covers === true ? ' is-covering' : ''}${dropping ? ' is-hidden' : ''}${editing ? ' is-editing' : ''}${away}`}
      data-chrome="label"
      data-label-for={node.id}
      data-placement={placed?.placement}
      style={at}
    >
      {editing ? (
        <span className="chrome__name">{t('canvas.editingText', { name: node.name })}</span>
      ) : (
        <>
          <span className="chrome__name">{node.name}</span>
          <small className="chrome__tag">{node.tag ?? ''}</small>
          {/* the context the writes land in is named on the label (A3.8, A3.36): "Heading 2 · .card2 · Hover ·
             Tablet" */}
          {styleClass !== null ? <small className="chrome__target">{'.' + styleClass}</small> : null}
          {/* the angle the element holds, live while a rotate drag goes on (item 4.4) */}
          {shown.rotation !== 0 ? (
            <small className="chrome__spin" data-chrome="label-angle">
              {t('canvas.rotate.angle', { angle: Math.round(shown.rotation * 10) / 10 })}
            </small>
          ) : null}
          {/* the element's own size, live while a resize drag goes on (item 4.2) */}
          {shown.size !== null ? (
            // a part of the label, after the name (the audit's U-004: the hover's absolutely placed size chip
            // covered the name)
            <small className="chrome__label-size" data-chrome="label-size">
              {t('canvas.measure.size', { width: shown.size.width, height: shown.size.height })}
            </small>
          ) : null}
          {/* the state as its selector writes it (the canonical "Assinar agora · :hover"), its name in the
             tooltip */}
          {state.id !== BASE_STATE.id ? <small className="chrome__state" title={t(state.labelKey as MessageId)}>{state.pseudo}</small> : null}
          {breakpoint.base !== true ? <small className="chrome__breakpoint">{breakpointName(breakpoint, t)}</small> : null}
        </>
      )}
    </div>
  ) : null;
}

export function CanvasChrome() {
  const selection = useEditorState((s) => s.selection);
  const state = useEditorState((s) => activeState(s.ui));
  // the class the style target names (null for the element itself) and the breakpoint in view (A3.8)
  const styleClass = useEditorState((s) => styleClassOf(s));
  const breakpoint = useEditorState((s) => activeBreakpoint(s));
  const targetsText = useEditorState((s) => drawnTargets(s.document, s.selection));
  const targets = useMemo(() => JSON.parse(targetsText) as NodeId[], [targetsText]);
  // the drag in progress (pointer.ts): the drop indicator is drawn, the selection's label hides and its outline turns
  // into the dashed outline of the source (Problems in Pager 1)
  const dragging = usePointerValue('drag');
  // the ghost of a creation drag Escape cancelled, on its way back to its tile
  const returning = usePointerValue('ghostReturn');
  // the element the keyboard's hand holds: its aim is drawn as a drag's drop (spec hand-keyboard-move, "Visual
  // feedback")
  const hand = useEditorState(heldHand);
  const aiming = useMemo(() => (hand === null ? null : handDrop(hand)), [hand]);
  const dropping: DropView | null = dragging ?? aiming;
  // what the ghost says under its chip about a side drop
  const documentNow = useEditorState((s) => s.document);
  // the label colour of the selection (spec layers-row-colours): the first selected element that has one paints the
  // selection outline, so the canvas and the Layers row say the same thing about the element; none keeps the token
  const layerColour = useEditorState((s) => {
    const root = openedPage(s) === undefined ? undefined : s.document.pages[openedPage(s)]?.tree;
    for (const id of s.selection) {
      const colour = root?.layerColors?.find((one) => one.node === id)?.colour;
      if (typeof colour === 'string' && colour !== '') return colour;
    }
    return null;
  });
  const note = dragging === null ? null : ghostNote(documentNow, dragging);
  // the primary selected node, read as the store holds it (a node object is replaced only when it changes)
  const node = useEditorState((s) => (s.selection[0] === undefined ? null : (locate(s.document, s.selection[0])?.node ?? null)));
  // the one selected element can be resized: not the page, not locked (itself or an ancestor), shown
  const resizable = useEditorState((s) => {
    if (s.selection.length !== 1 || s.selection[0] === undefined) return false;
    for (let at = locate(s.document, s.selection[0]), first = true; at !== null; at = at.parent === null ? null : locate(s.document, at.parent.id), first = false) {
      if (first && at.parent === null) return false;
      if (at.node.locked === true || at.node.hidden === true) return false;
    }
    return true;
  });
  const hovered = usePointerValue('hover');
  // Alt held: the distances from the selection to the hovered element are drawn (spec hover-measure)
  const altHeld = usePointerValue('measuring');
  // an Edit on canvas mode is on (canvas/edit-mode.ts)
  const mode = useEditorState((s) => editMode(s.ui));
  const editingOnCanvas = mode !== NO_MODE;
  const drawnBand = usePointerValue('band');
  // the resize drag in progress, whose distances to the neighbours the canvas draws (item 4.5)
  const resizing = usePointerValue('resizingNow');
  // the text edited in place (text-edit.ts): its outline and label wear the text editing mode, so the edit never looks
  // like a plain selection (spec text-edit-inline, Problems in Pager 2; archive/DESIGN.md "Canvas", text)
  const editing = useEditorState((s) => s.ui.textEdit.node !== null && s.selection.length === 1 && s.selection[0] === s.ui.textEdit.node);
  const t = useT();
  const store = useStore();
  // the layout the page computes for the one selected element: where a mode's values apply (A3.15)
  const context = useSelectionContext();
  const layer = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  // the text toolbar while a text is edited in place (text-toolbar.tsx)
  const bar = useRef<HTMLDivElement>(null);

  // An Edit on canvas mode never stays over a selection it cannot edit (A3.15): it is let go the moment the element
  // under it takes none of its values (the gap on a container that is not flex or grid, a shadow mode on an element
  // with no shadow), the selection is not one resizable element, or a project was opened or created (the selection
  // becomes empty). The resize handles a mode hides come back with it.
  useEffect(() => {
    if (!editingOnCanvas || LEAVE_MODE === null) return;
    if (node !== null && resizable && modeApplies(mode, node, MODEL_RULES, context)) return;
    store.dispatch(LEAVE_MODE.command.id, LEAVE_MODE.door.args as never);
  }, [editingOnCanvas, mode, node, resizable, context, store]);

  const layout = useChromeLayout({ layer, label, bar, selection, targets, hovered, node, drawnBand, editing, altHeld, resizing, documentNow, mode });
  const origin = useScreenOrigin(layer, selection.length > 0);

  const at = (b: Box): CSSProperties => ({ left: b.x, top: b.y, width: b.width, height: b.height });
  const shown = selection.length === 0 && hovered === null && drawnBand === null ? EMPTY : layout;
  return (
    // a state other than Base edited: the selection wears the state's colour (the canonical .ov-sel.is-state)
    <div className="chrome" ref={layer} data-canvas-chrome data-edited-state={state.id === BASE_STATE.id ? undefined : state.id} style={layerColour === null ? undefined : ({ '--color-layer-label': layerColourCss(layerColour) } as CSSProperties)}>
      <GridOverlay />
      <ViewOverlays />
      {shown.hovered ? <div className="chrome__hover" data-chrome="hover" style={at(shown.hovered)} /> : null}
      {shown.hoverSize ? (
        <div className={`chrome__size${shown.hoverSize.end ? ' chrome__size--end' : ''}`} data-chrome="hover-size" data-region="canvas-hover-size" style={{ left: shown.hoverSize.x, top: shown.hoverSize.y }}>
          {t('canvas.measure.size', { width: shown.hoverSize.width, height: shown.hoverSize.height })}
        </div>
      ) : null}
      {shown.distances.map((d, i) => (
        <div key={i} className={`chrome__distance chrome__distance--${d.box.width === 0 ? 'down' : 'across'}`} data-chrome="distance" data-region="canvas-distance" data-value={d.value} style={at(d.box)}>
          <span className="chrome__distance-label">{t('canvas.measure.distance', { value: d.value })}</span>
        </div>
      ))}
      {drawnBand !== null && shown.band ? <div className="chrome__marquee" data-chrome="band" style={at(shown.band)} /> : null}
      {shown.selected.map((b, i) => (
        <div
          key={i}
          className={`chrome__selection${dropping && dropping.dragged.length > 0 ? ' is-source' : ''}${editing ? ' is-editing' : ''}`}
          data-chrome="selection"
          style={{ ...at(b), ...spun(shown.rotation, b, b) }}
        />
      ))}
      {dropping ? <DropIndicator view={dropping} /> : null}
      {dragging?.inserting != null ? <Ghost inserting={dragging.inserting} at={dragging.at} refused={dragging.side?.armed === true ? dragging.side.refusal !== null : dragging.proposal === null || dragging.refusal !== null} note={note} /> : null}
      {dragging !== null && dragging.inserting === null && dragging.dragged.length > 0 ? (
        <MovingGhost
          dragged={dragging.dragged}
          at={dragging.at}
          refused={dragging.side?.armed === true ? dragging.side.refusal !== null : dragging.proposal === null || dragging.proposal.refused}
          note={note}
        />
      ) : null}
      <DropFlash />
      <CapturedSelection />
      {returning !== null && dragging === null ? <ReturningGhost key={returning.id} view={returning} /> : null}
      {shown.union && selection.length > 1 ? <div className="chrome__union" data-chrome="union" style={at(shown.union)} /> : null}
      {/* the handles of the Edit on canvas mode on the one selected element (edit-handles.tsx), and the spacing and gap
          bands any selection draws: the bands sit under the handles — the mode's own and the resize ones after them —
          so a press that lands on a handle takes that handle, never a band passing under it */}
      {resizable && shown.selected[0] && node !== null && !dropping && !editing ? <EditHandles node={node.id} box={shown.selected[0]} /> : null}
      {/* the canvas grid editor's line numbers and grips (grid-editor.tsx; the user's real-use audit, item 8.2) */}
      <GridEditor />
      {/* the resize handles, but while an Edit on canvas mode draws its own (edit-handles.tsx). A handle carrying a
          start edge the element's own declarations cannot move (its parent lays it out: a flex or a grid, an inline
          element) is drawn disabled, with the reason, and a press on it is no resize (item 4.2) */}
      {resizable && shown.selected[0] && !dropping && !editing && !editingOnCanvas ? <ResizeHandles box={shown.selected[0]} shown={shown} /> : null}
      {/* each side's whole length takes a resize too (resize.edgeGrip), over the padding band that lies along the
          border; a start edge the parent places has none (its handle is drawn disabled above) */}
      {resizable && shown.selected[0] && !dropping && !editing && !editingOnCanvas && shown.rotation === 0 ? <EdgeGrips box={shown.selected[0]} shown={shown} /> : null}
      {/* the rotation zones, one outside each corner (item 4.4): the same door, drawn four times, each turned with the
          element when it holds a rotation */}
      {resizable && shown.selected[0] && !dropping && !editing && !editingOnCanvas && ROTATE_HANDLE !== null && isDoorBuilt(ROTATE_HANDLE) && shown.rotate !== null ? <RotateZones door={ROTATE_HANDLE} spots={shown.rotate} /> : null}
      <SelectionLabel labelRef={label} selection={selection} node={node} targets={targets} shown={shown} dropping={dropping} editing={editing} styleClass={styleClass} state={state} breakpoint={breakpoint} origin={origin} />
      {editing && node !== null ? <TextToolbar bar={bar} className={shown.toolbar ? (shown.label?.seen === false ? 'is-away' : '') : 'is-measuring'} style={shown.toolbar ? { left: origin.x + shown.toolbar.x, top: origin.y + shown.toolbar.y } : undefined} /> : null}
    </div>
  );
}

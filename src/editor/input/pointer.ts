// Pointer input (PRODUCT.md §5): the one owner of pointer, mouse and drag input on the canvas. Lint rule
// builder/pointer-owner refuses pointer, mouse and drag listeners and props anywhere else; a control's onClick stays
// with the control. Presses reach the canvas on its overlay (the iframe takes no pointer event) and on the stage
// around the frame; the node under the pointer comes from the coordinates module.
//
// Each press is one gesture, run by an explicit state machine (idle → pressed → dragging → idle) whose threshold is
// the manifest's drag.threshold. The door of the press is found by its data (a canvas click's target, button, count
// and modifier), and the gesture's doors run through one transaction the pointer owner opens with store.gesture()
// when the press starts and commits when it ends, or cancels when the browser takes the pointer away: a whole
// gesture is one undo step, and no handler ever opens a transaction (lint rule builder/gesture-owner). A drag pressed
// on the empty area of the page or of a container with children is the marquee (spec marquee-select), whose band it
// publishes for the canvas chrome.
//
// A primary press on any other element (a leaf, an empty container) that turns into a drag drags the selection's
// roots (the press has just selected the element): each move asks the drop proposal (src/editor/drag/drop.ts) where
// they would land, publishes it for the canvas chrome (hysteresis: drag.hysteresis), and the release runs the
// canvas-drag door of the drawn proposal's zone (beside a sibling, or inside a container) with its parent and index,
// inside the same gesture.
//
// A double-click on a text element starts its edit in place; while a text is edited, a press elsewhere keeps the text
// once its own door has run (spec text-edit-inline), and a press on the text toolbar over the canvas is its control's
// click, which leaves the focus in the text (spec text-inline-formatting).
//
// A primary press on a palette tile (the tile door of the command whose canvas-drag door takes a palette tile as its
// source) is a gesture too (spec palette-drag-insert, "Trigger"): released below drag.threshold it is the tile's click
// and runs the tile's door at the release; past the threshold it is a creation drag with no dragged node, which asks
// the same drop proposal and publishes it for the same drop indicator, and whose release runs the palette-drag door
// with the tile's entry and the drawn proposal's parent and index, inside the gesture: one undo step. Released where
// there is no proposal (outside the page), it inserts nothing.
//
// The keys of a drag (spec drag-level-keys-escape) run through the gesture too (keymap.ts, drag key context). Each
// drag, an element's or a tile's, is the live drag of the drag session (src/editor/drag/drag-session.ts), which gets
// the proposal the pointer makes; the proposal drawn, and dropped at the release, is the one of the level the session
// holds, redrawn as soon as a level key changes it, without a pointer move. Escape (drag.cancel) ends the gesture at
// once, its button still down: what the drag proposed is dropped with it, and the release that follows does nothing;
// what the press itself did stays (the element it selected), except for a marquee, whose band is its own selection
// and goes back to the selection held before the press (spec marquee-select); a creation drag's ghost goes back to
// the tile it came from (ghostReturn, played by the canvas chrome).
//
// A primary press on a number field's label in the inspector (the panel drag whose source is a field label, spec
// inspector-number-fields) scrubs the field from the press on, with no threshold (numberField.scrubDeadZone 0): each
// move cancels the gesture back to the value held before the press and runs the scrub door again inside a new one,
// with the text the field held at the press, the pointer's horizontal travel since the press in screen pixels and the
// key held now (the gesture number-scrub: Shift, Alt), so the field and the canvas follow the pointer live and the
// release commits the last value: one undo step. Escape (drag.cancel) cancels it back to the value before the press.
import { isFeatureBuilt } from '../../app/features.ts';
import type { Message } from '../../core/commands/registry.ts';
import { reportError } from '../../core/incidents.ts';
import { locate, type NodeId } from '../../core/document/model.ts';
import type { DispatchResult, Gesture } from '../../core/store/store.ts';
import { selectionRoots } from '../../core/structure/remove.ts';
import type { CommandId, DoorId, FeatureId, KeyContextId } from '../../generated/ids.ts';
import { manifest, numberConstant, pairConstant, type DoorEntry } from '../../manifest/runtime.ts';
import { canvasFrame, geometryOf, nodeAt, nodeBox, nodesUnder, pageLayout, resizeBasis, screenToPage, scrollPage, type Point } from '../canvas/coordinates.ts';
import { snapMode, snapMove, snapResize, snapShown } from '../canvas/snapping.ts';
import type { Box } from '../../core/geometry/snap.ts';
import { resizedBox, type ResizeFrom } from '../../core/geometry/resize.ts';
import { storedValue } from '../../core/style/stored.ts';
import { guidesOf } from '../../core/page/guides.ts';
import { panelDrop, panelHintAt, showPanelHint } from '../workspace/panel-drag.ts';
import { PANELS, type Panel } from '../workspace/panel-catalogue.ts';
import { formatColor, hsbToRgb, pickedAlpha } from '../../core/style/color.ts';
import { gradientView } from '../inspector/gradient-view.ts';
import { drawnProposal, liveDrag } from '../drag/drag-session.ts';
import { rowDrop, SIDE_DWELL, type DropProposal, type SideOffer } from '../drag/drop.ts';
import { elementPredicate } from '../../core/style/applies.ts';
import { MODEL_RULES, type EditorStore } from '../store.ts';
import type { EditorUi } from '../state.ts';
import { toolPoint, toolPress, type ToolSession } from './pointer-tools.ts';
import { SPLITTERS, splitterSize, type SplitterId } from '../workspace/layout.ts';
import { typedBand } from '../canvas/band-typing.ts';
import { SHADOW_EDITS } from '../canvas/handles.ts';
// a shadow handle that moves the offset (canvas/edit-handles.tsx data-shadow)
const SHADOW_OFFSET = 'offset';
import { geometryAttributes, shapeResizeFrom } from '../../core/elements/svg.ts';
import { TEXT_TOOLBAR, editArgs, editedNode, isTextElement } from '../canvas/text-edit.ts';
import { isValueControl } from '../../core/elements/inputs.ts';
import { offsetFromTrackX, playheadTimeFromTrackX, shownAnimation } from '../timeline/playhead.ts';
import { pickingTarget } from '../inspector/pick-target.ts';
import { motionPicking } from '../motion/state.ts';
// the gesture state machine lives in its own module (pointer/machine.ts); this owner keeps the installer and the state
import { DRAG_HYSTERESIS, DRAG_THRESHOLD, IDLE, step, type Effect, type Machine, type Press } from './pointer/machine.ts';
// which door a press runs lives in its own module too (pointer/press.ts): the facts it is judged by, the modifier held
import { NOT_PICKING, argsFor, clickDoor, editEndDoor, laysGrid, modifierOf, type Button, type Picking, type PressFacts } from './pointer/press.ts';
import { CONTAINERS, isInside, keepsSide, layersDrag, nearestAccepted, proposalAt, ROW_DROP, ROW_SELECT, rowUnder, sideAt } from './drop-proposals.ts';
// what the pointer publishes for the canvas chrome and the panels (pointer/views.ts); the installer is their only
// writer
import {
  altHeld,
  guideOverRuler,
  measuring,
  pointerPressing,
  setBand,
  setCanvasPointer,
  setDrag,
  setDropped,
  setGhostReturn,
  setGuideOnRuler,
  setHovered,
  setPanView,
  setPressPoint,
  setPressRegion,
  setPressing,
  publishOutsidePress,
  type PressRegion,
  setResizing,
  setBanding,
  setMenuOver,
  type Inserting,
  type Redirect,
  type SideView,
} from './pointer/views.ts';
import { viewportWidth } from '../view/breakpoints.ts';

// the entries this module published before the machine moved out stay published here: consumers need not change
export { DRAG_THRESHOLD, IDLE, step } from './pointer/machine.ts';
export type { Effect, Machine, MachineEvent, Press } from './pointer/machine.ts';
export { clickDoor, editEndDoor, modifierOf } from './pointer/press.ts';
export type { Button, PressFacts } from './pointer/press.ts';
export { band, bandingNow, canvasPointer, menuOver, drag, ghostReturn, guideOverRuler, holdAlt, hover, lastDrop, measuring, panState, pointerPressing, pressPoint, resizingNow } from './pointer/views.ts';
export type { Band, DragView, Dropped, GhostReturn, Inserting, PanView, Redirect, SideView } from './pointer/views.ts';



// The marquee (spec marquee-select): the canvas-drag doors a press may start a band with, and whether it may. The
// empty-area door (zone "page-or-container") takes a press on the page root or on a container's own area (not on a
// child); a press on a leaf, or on an empty container (whose marquee could take nothing, having no descendants), is
// that element's drag, never a marquee (specs drag-reorder-canvas, drag-drop-inside). The element door takes a press
// on any element but the page root with a modifier held: the band works over that element's siblings, the children of
// its parent, which is the way to band a container that fills its parent (Problems in Pager 4). The mode is the one
// the gesture's modifier (interactions.json gestures) names, read at the press: a modifier's meaning starts with the
// mode it stands for ("add-to-selection"), and with no modifier the mode is the one no modifier names; a modifier the
// gesture does not know starts no marquee, and one that is no mode (the take-leaves Alt) keeps the plain mode, leaving
// its own work to the live key (altDown).
const MARQUEE = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === 'empty-area') ?? null;
const MARQUEE_ELEMENT = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === 'element') ?? null;
// the element types that hold children, and the Layers row's tables: measured with the drops (input/drop-proposals.ts)
function marqueeMode(entry: DoorEntry, press: Press, modifier: string | null, node: { readonly type: string; readonly children: readonly unknown[] } | null): string | null {
  const door = entry.door;
  if (door.kind !== 'canvas-drag' || press.on !== 'node' || press.label === true) return null;
  const gesture = manifest.interactions.gestures.find((g) => g.id === door.gesture);
  const modes = entry.command.args.mode?.values ?? [];
  const names = (mode: string, meaning: string) => meaning.startsWith(`${mode}-`);
  const meaning = modifier === null ? undefined : gesture?.modifiers.find((m) => m.key === modifier)?.meaning;
  if (door.source === 'element') {
    // the band a press on an element starts, over its siblings: a modifier must name one of its modes (Shift)
    if (press.root || modifier === null || meaning === undefined) return null;
    return modes.find((mode) => names(mode, meaning)) ?? null;
  }
  if (door.zone !== 'page-or-container') return null;
  if (!press.root && (node === null || !CONTAINERS.has(node.type) || node.children.length === 0)) return null;
  const plain = modes.find((mode) => !(gesture?.modifiers ?? []).some((m) => names(mode, m.meaning))) ?? null;
  if (modifier === null) return plain;
  if (meaning === undefined) return null;
  return modes.find((mode) => names(mode, meaning)) ?? plain;
}
// Whether the box being drawn takes the leaves (spec marquee-select, Problems in Pager 3): the key the marquee
// gestures name for it is held now.
const LEAVES_KEY = (manifest.interactions.gestures.find((g) => g.id === 'marquee')?.modifiers ?? []).find((m) => m.meaning === 'take-leaves')?.key ?? null;
const leavesNow = (): boolean => LEAVES_KEY === 'Alt' && altHeld();

// Whether the key that duplicates a drag is held, once the duplicate by dragging is built (spec drag-duplicate): the
// drop label and the status bar say "Duplicate" then.
export const duplicating = {
  get: (): boolean => DUPLICATE_DRAG !== null && DUPLICATE_KEY === 'Alt' && altHeld(),
  subscribe: measuring.subscribe,
};

// The browser's own menu never opens where the editor's opens (spec context-menu, Problems in Pager 5): on the canvas
// (the overlay and the stage) and over the editor's context menu and its backdrop, which a secondary press on the
// canvas draws before the browser asks for its menu at the release.
const EDITOR_MENU_AREA ='[data-canvas-overlay], [data-canvas-stage], [data-context-menu]';

// The canvas-drag doors a press on an element starts (specs drag-reorder-canvas, drag-drop-inside): the door of the
// zone a drop proposal falls in, found by its data: "before-after" beside a sibling, "inside" into a container (a
// refused proposal, over the dragged nodes' own subtree, is one inside them). The gesture's own modifiers
// (interactions.json) are the only keys a drag press may hold: an element drag holds none.
const ELEMENT_DRAGS = manifest.doors.filter((d) => d.door.kind === 'canvas-drag' && d.door.source === 'canvas-element');
// The free drag of positioned elements (spec absolute-free-drag): the canvas-drag door whose source is a positioned
// element, once its feature is built. A drag of a selection whose elements are all absolute or fixed (its command's
// predicate) moves them freely instead of proposing a place in the flow: each move runs the door's command with the
// travel since the last one, in page px (screen px divided by the zoom, whole px), inside the press's gesture.
const FREE_DRAG = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === 'positioned-element' && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
const zoneDoor = (zone: string) => ELEMENT_DRAGS.find((d) => d.door.kind === 'canvas-drag' && d.door.zone === zone) ?? null;
const REORDER = zoneDoor('before-after');
const INTO = zoneDoor('inside');
const dropDoor = (proposal: DropProposal) => (proposal.placement === 'inside' ? INTO : REORDER);
// The duplicate by dragging (spec drag-duplicate): the element drag door whose gesture holds a key for the whole drag
// ("held-duplicates", interactions.json), once its feature is built; the release then runs its command (the duplicate
// of the selection) and the move of the copies through the door of the place drawn, in the drag's one gesture.
const DUPLICATE_GESTURE = manifest.interactions.gestures.find((g) => g.modifiers.some((m) => m.meaning === 'held-duplicates'));
const DUPLICATE_KEY = DUPLICATE_GESTURE?.modifiers.find((m) => m.meaning === 'held-duplicates')?.key ?? null;
const DUPLICATE_DRAG = ELEMENT_DRAGS.find((d) => d.door.kind === 'canvas-drag' && d.door.gesture === DUPLICATE_GESTURE?.id && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
// the keys a drag press may hold: its gestures' own (the duplicate's Alt)
const DRAG_MODIFIERS = new Set(manifest.interactions.gestures.filter((g) => ELEMENT_DRAGS.some((d) => d.door.kind === 'canvas-drag' && d.door.gesture === g.id && (d === DUPLICATE_DRAG || d === REORDER))).flatMap((g) => g.modifiers.map((m) => m.key)));
// The drag keys that are no click's, alone: a key the click gesture also names (Shift adds to the selection, Ctrl
// toggles it) belongs to the click too, so it must reach the click's door — Shift still means wrap-vertical on a drop,
// which the drag branch reads for itself. Without this, a drag gesture that claims Shift (the side drop's wrap) made
// every Shift+click a plain select: the person's selection was replaced instead of added to.
const CLICK_KEYS = new Set((manifest.interactions.gestures.find((g) => g.id === 'canvas-click')?.modifiers ?? []).map((m) => m.key));
const DRAG_ONLY_MODIFIERS = new Set([...DRAG_MODIFIERS].filter((key) => !CLICK_KEYS.has(key)));

// The creation drags of tiles (specs palette-drag-insert, reusable-components): the canvas-drag doors of the
// palette-drag gesture that drop on a proposal, one per command (a palette tile's element.insert, a component tile's
// components.insertInstance), and the tiles they start from, that command's doors drawn as items (their clicks insert
// at the selection). A drag runs once its feature is registered as built in the feature table (src/app/features.ts);
// until then a tile's press is the tile's own click.
const TILE_DRAGS = manifest.doors.filter((d) => d.door.kind === 'canvas-drag' && d.door.gesture === 'palette-drag' && d.door.zone === 'drop-proposal');
// The dwell that unfolds a folded row, once its feature is built (the row's own click and drop doors are measured
// with the drops, input/drop-proposals.ts).
const ROW_DWELL = layersDrag('collapsed-row-dwell');
// how long the pointer rests on a folded row before it unfolds (interactions.json layers.expandDwell)
// the confirmed side drop's pill: where it is drawn from the pointer, and how near it the pointer keeps the offer
const PILL_OFFSET = pairConstant('wrap.pillOffset');
const PILL_FREEZE = numberConstant('wrap.pillFreeze');
// a pointer resting this long on another application menu's button opens it while one is open (spec app-menu)
const MENU_HOVER_SWITCH = numberConstant('menus.hoverSwitch');
const MENU_HOVER_TOLERANCE = numberConstant('menus.hoverTolerance');
// autoscroll (spec drag-layout, row 8): the band along the page's visible edges, and the most it scrolls a frame
const AUTOSCROLL_ZONE = numberConstant('drop.autoscrollZone');
const AUTOSCROLL_MAX = numberConstant('drop.autoscrollMaxStep');
// the Layers tree's band: at most this share of the tree's height, and over a row only after a rest in it (LA1)
const TREE_SHARE = numberConstant('drop.autoscrollTreeShare');
const TREE_DWELL = numberConstant('drop.autoscrollTreeDwell');
const EXPAND_DWELL = numberConstant('layers.expandDwell');

// The view's wheel and pan (spec zoom-wheel-pan): over the stage, the wheel runs its door by the modifier held (Ctrl
// zooms around the pointer by exp(-deltaY × zoom.wheelFactor), Shift pans across, none pans down); a drag with Space
// held, or with the middle button, pans by the pointer's travel, and Escape during it puts the view back. Space is
// the keymap's key: it tells this owner when Space goes down or up (holdSpace), and the stage shows a grab cursor
// while Space is held over it (panState).
const WHEEL_DOORS = manifest.doors.filter((d) => d.door.kind === 'canvas-wheel');
// A resize handle's drag (spec resize-handles): the chrome draws the handles of the resize gesture's doors on the one
// selected element; a press on one, moved past the drag threshold, opens a gesture whose geometry.resize runs on every
// move with the size the travel gives (the page shows it live, the history keeps one step), Shift keeping the ratio and
// Alt resizing from the centre as the move reads them; the release commits it and Escape (drag.cancel) drops it.
const RESIZE_MIN = numberConstant('resize.minBox');
// The rotation handle (spec rotation-handle): its drag writes the property its door writes (rotate) as the pointer's
// angle around the element's centre, from the angle it held, in whole degrees; Shift snaps it to rotate.snapStep.
const ROTATE_SNAP = numberConstant('rotate.snapStep');
// The guide drags (spec guides-manual): out of a ruler (data-ruler: the axis of the guides it makes) a new guide, once
// the pointer has moved past drag.threshold; a guide (data-guide) moved over the page; either released over its own
// ruler is no guide: a new one is not made, a moved one is deleted, through the door of that zone. One gesture each.
const guideDoor = (source: string, zone: string) => manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === source && d.door.zone === zone && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
const GUIDE_CREATES: Readonly<Record<string, DoorEntry | null>> = { horizontal: guideDoor('top-ruler', 'page'), vertical: guideDoor('left-ruler', 'page') };
const GUIDE_MOVE = guideDoor('guide', 'page');
const GUIDE_DELETE = guideDoor('guide', 'own-ruler');
// an angle as degrees: deg, rad, grad or turn, else none
function degreesOf(value: string | undefined): number {
  const match = value === undefined ? null : /^(-?\d*\.?\d+)(deg|rad|grad|turn)$/.exec(value.trim());
  if (match === null) return 0;
  const n = Number(match[1]);
  const per: Readonly<Record<string, number>> = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };
  return n * (per[match[2] ?? ''] ?? 1);
}
// an angle folded into -180 to 180 degrees
const folded = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;
// An Edit on canvas handle's drag (spec spacing-handles, radius-border-gap-handles): the chrome draws the handles of
// the mode (canvas/edit-handles.tsx), each saying what its drag starts from, which way on the screen grows it and which
// argument of its command the value goes in; a press on one, moved past the drag threshold, opens a gesture whose
// command runs on every move with the new value (its start plus the travel along its normal ÷ the zoom, whole CSS px,
// never below its minimum); for a spacing band Shift writes all four sides and Alt the opposite side by the same amount
// (the gesture spacing-band of interactions.json). The release commits it, one undo step, and Escape (drag.cancel)
// drops it. A spacing band pressed and released without a drag opens its typed field (canvas/band-typing.ts); any other
// handle takes the focus, for its arrows (handle.step).
interface SpacingDrag {
  readonly entry: DoorEntry;
  readonly args: Readonly<Record<string, string>>;
  readonly valueArg: string;
  readonly element: HTMLElement;
  readonly start: number;
  readonly normal: readonly [number, number];
  readonly min: number | null;
  readonly opposite: string;
  readonly oppositeStart: number;
  // the four sides' starts at the press, in the composite's order: Shift writes each its own start plus the travel
  // (A3.15)
  readonly sidesStart: readonly number[] | null;
  readonly pointer: number;
  readonly from: Point;
  readonly zoom: number;
  // a shadow handle: the property it edits, whether it moves the offset (else the blur), and the layer's X and Y
  readonly shadow: { readonly property: string; readonly offset: boolean; readonly x: number; readonly y: number } | null;
  gesture: Gesture | null;
  cancels: number;
}
const MODIFIER_MEANINGS = new Map((manifest.interactions.gestures.find((g) => g.id === 'spacing-band')?.modifiers ?? []).map((m) => [m.meaning, m.key] as const));
const ALL_SIDES_KEY = MODIFIER_MEANINGS.get('change-all-four-sides');
const OPPOSITE_KEY = MODIFIER_MEANINGS.get('change-opposite-side');
// Whether a drawn handle stands on its corner or edge centre of the element's box now (screen px, within a pixel): its
// hit area lies outside the box on its sides, so its anchor is its edge next to the box, or its middle across. A handle
// the chrome slid inside the element — its hit area kept out of a neighbour's box (canvas/chrome.tsx, handleHitBox) —
// touches the edge line with the far side of its box instead, so each side is looked for on both of the handle's own
// sides; its middle across the edge stays where it belongs.
function handleInPlace(handle: Element, box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): boolean {
  const drawn = handle.getBoundingClientRect();
  const side = (handle.getAttribute('data-resize-handle') ?? '').split('-').pop() ?? '';
  const edgeX = (value: number) => Math.abs(value - box.x) <= 1 || Math.abs(value - (box.x + box.width)) <= 1;
  const edgeY = (value: number) => Math.abs(value - box.y) <= 1 || Math.abs(value - (box.y + box.height)) <= 1;
  const wantX = box.x + box.width / 2;
  const wantY = box.y + box.height / 2;
  const acrossX = Math.abs(drawn.left + drawn.width / 2 - wantX) <= 1;
  const acrossY = Math.abs(drawn.top + drawn.height / 2 - wantY) <= 1;
  return (side.includes('w') || side.includes('e') ? edgeX(drawn.left) || edgeX(drawn.right) : acrossX) && (side.includes('n') || side.includes('s') ? edgeY(drawn.top) || edgeY(drawn.bottom) : acrossY);
}
// The drawn controls of the canvas chrome a press may take: the eight resize handles, the spacing and gap bands, the
// rotation zones.
const CHROME_CONTROLS = '[data-canvas-overlay] [data-edit-handle], [data-canvas-overlay] [data-resize-handle], [data-canvas-overlay] [data-rotate-handle]';
// The drawn control of the canvas chrome a press hits (a resize handle, a spacing band, a rotation zone): the press's
// own target when it is one, else the control whose drawn box covers the press where it went down on the stage. The
// chrome clips its drawing to the canvas and an element at the page's edge reaches past it: the visible sliver of its
// handle (2 px wide at 25 %) would be the whole target, and the stage would take a press just outside it and clear the
// selection (the user's real-use audit). The interaction area is the handle's whole box, as large as its drawing, and
// the topmost control (the last drawn, handles over bands) wins.
function chromeControl(at: Point, selector: string, target: EventTarget | null): Element | null {
  const direct = target instanceof Element ? target.closest(selector) : null;
  if (direct !== null) return direct;
  // a press on a control of the editor's own — a drawn door, an anchor tab among them — is that control's, never one
  // of the chrome's handles drawn over the same point (a tab stands beside the edge its handle sits on)
  if (target instanceof Element && target.closest('[data-door]') !== null) return null;
  // Only a press that lands on the stage looks past its own target: a press on the page keeps its own door (a marquee
  // on a container's own area, a guide from a ruler), and a press on any editor surface over the canvas — a panel, the
  // quick panel, the text toolbar, the command bar, a dialog — keeps it too, or a handle drawn underneath would take
  // it and the control the person pressed would lose its press (a bar field whose click blurred it).
  if (!(target instanceof Element) || target.closest('[data-canvas-stage]') === null) return null;
  const covering = [...document.querySelectorAll(CHROME_CONTROLS)].filter((el) => {
    const r = el.getBoundingClientRect();
    return at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom;
  });
  const top = covering.at(-1) ?? null;
  return top !== null && top.matches(selector) ? top : null;
}
const PAN_DRAGS = manifest.doors.filter((d) => d.door.kind === 'canvas-drag' && d.door.gesture === 'space-pan');
const WHEEL_FACTOR = numberConstant('zoom.wheelFactor');
// a wheel's line (deltaMode 1) in screen px, as the spec measured it
const WHEEL_LINE = 16;
const panDrag = (source: string): DoorEntry | null => PAN_DRAGS.find((d) => d.door.kind === 'canvas-drag' && d.door.source === source) ?? null;
const onStage = (target: EventTarget | null): boolean => target instanceof Element && target.closest('[data-canvas-stage]') !== null;
// the region a press went down in, by the keys it gives the canvas (jornada03 J2; views.ts PressRegion): the page in
// the frame (another document) or the stage is the canvas, the Layers tree its own, anything else elsewhere
function pressRegionOf(target: EventTarget | null): PressRegion {
  const element = target !== null && typeof (target as Element).closest === 'function' ? (target as Element) : null;
  if (element === null) return 'elsewhere';
  if (element.ownerDocument !== document) return 'canvas';
  if (element.closest('[data-key-context="layers-tree"]') !== null) return 'layers';
  return element.closest('[data-key-context="canvas"]') !== null ? 'canvas' : 'elsewhere';
}
let spaceDown = false;
let overStage = false;
let panning: { pointer: number; last: Point; moved: Point; entry: DoorEntry } | null = null;
let panDispatch: ((entry: DoorEntry, args: Readonly<Record<string, unknown>>) => void) | null = null;
// Space went down or up (the keymap, which owns the keys): held over the stage it arms the pan; true when it did
export function holdSpace(down: boolean): boolean {
  if (!down) {
    spaceDown = false;
    if (panning === null) setPanView('idle');
    return false;
  }
  if (!overStage && panning === null) return false;
  spaceDown = true;
  if (panning === null) setPanView('armed');
  return true;
}
// Escape during a pan puts the view back where the pan began; true when a pan was cancelled
export function cancelPan(): boolean {
  if (panning === null) return false;
  const { entry, moved } = panning;
  panning = null;
  if (moved.x !== 0 || moved.y !== 0) panDispatch?.(entry, { dx: -moved.x, dy: -moved.y });
  setPanView(spaceDown ? 'armed' : 'idle');
  return true;
}
// the creation drag a tile starts: its command's drop door, while its feature is built; null for any other control
const tileDrag = (entry: DoorEntry): DoorEntry | null =>
  entry.door.kind === 'panel-control' && entry.door.drawnAs === 'item' ? (TILE_DRAGS.find((d) => d.command.id === entry.command.id && isFeatureBuilt(d.door.feature as FeatureId)) ?? null) : null;
// The side drop (spec drag-layout, row 5): the canvas-drag doors of the side band, one for an element drag and one for
// a tile's creation drag; a door whose feature is not built offers nothing.
const sideDoor = (source: string) => manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.zone === 'side-band' && d.door.source === source && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
const SIDE_ELEMENT = sideDoor('canvas-element');
// the key that turns a side drop's wrapper to the other axis (the gesture's own modifier meaning, interactions.json)
const WRAP_KEY = manifest.interactions.gestures.find((g) => g.id === 'element-drag')?.modifiers.find((m) => m.meaning === 'wrap-vertical')?.key ?? null;
const wrapped = (wrapper: 'row' | 'column', modifier: string | null): 'row' | 'column' => (WRAP_KEY !== null && modifier === WRAP_KEY ? (wrapper === 'row' ? 'column' : 'row') : wrapper);
const SIDE_TILE = sideDoor('palette-tile');
const isTile = (entry: DoorEntry) => tileDrag(entry) !== null;
// The side drop of a creation drag: the side band's door, when its command takes what the tile stands for (a palette
// entry: element.wrapBeside); a component's tile offers none.
const sideTileFor = (inserting: Inserting): DoorEntry | null => (SIDE_TILE !== null && Object.keys(inserting.args).every((name) => name in SIDE_TILE.command.args) ? SIDE_TILE : null);
// The scrub of a number field (spec inspector-number-fields): the panel drag doors pressed on a field's label, and the
// key held now when their gesture gives it a meaning (interactions.json number-scrub) and their command takes it.
const SCRUBS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'field-label');
// the drag of a gradient stop along its bar (spec gradient-editor): the panel drag pressed on a stop
const STOP_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'gradient-stop');
// the rows of a shadow editor (A3.34): dragging one moves the layer among the others
const LAYER_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source.endsWith('-shadow-row'));
// the drag of a shadow's light on its pad (spec shadow-editor): the panel drags pressed on a light pad
const PAD_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.gesture === 'shadow-pad-drag');
// The quick panel's grip (spec quick-panel): the panel drag doors pressed on it.
// the four sides of a box, in the composite's order (properties.json: top, right, bottom, left)
const BOX_SIDES = manifest.properties.composites.find((c) => c.control === 'box-model')?.longhands ?? [];
const SIDES: readonly string[] = BOX_SIDES.map((property) => property.slice(property.lastIndexOf('-') + 1));
// the margin arguments geometry.resize takes for a flow drag (the manifest's own names): the dragged edge follows
// the pointer by its margin (item 4.2)
const MARGIN_ARGS: Readonly<Record<'marginLeft' | 'marginTop', string>> = { marginLeft: 'marginLeft', marginTop: 'marginTop' };
const GRIP_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'quick-panel-grip');
// The splitters (spec panel-resize): the panel drag doors pressed on a divider between panels; the frame's edge is
// one too (spec breakpoints-switch): it sizes the screen the canvas shows, from the width at the press.
const FRAME_EDGE = 'frame-edge';
const SPLITTER_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && (d.door.source === 'splitter' || d.door.source === FRAME_EDGE));
// The Explorer's file tree (spec explorer-file-system): the panel drag doors pressed on a row of the tree, released on
// a folder row — the file lands in that folder (files.move)
const EXPLORER_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'explorer-row');
// The Data panel's columns (spec content-data, "binding"): the panel drag doors pressed on a column, released on an
// element's part in Connect fields, which they bind to the column's field
const COLUMN_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'data-column');
// The timeline (specs timeline-preview, timeline-keyframes): the panel drag pressed on the ruler (the playhead) and the
// one pressed on a keyframe's marker (its animation and offset stand in the control's arguments).
const PLAYHEAD_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'playhead');
const KEYFRAME_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'keyframe');
// A panel's header (specs floating-panels and panel-combine-tabs): the panel drag doors pressed on it. What the panel
// becomes where the pointer is — a window, a side dock, a tab of the panel under it — is
// src/editor/workspace/panel-drag.ts, which the moves and the release ask.
const PANEL_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && (d.door.source === 'panel-header' || d.door.source === 'floating-header'));
// the door a press on a header itself stands for (the header carries no datum of its own): the first of the panel
// drags, whose place is only the fallback a release over no other place lands in
const PANEL_FALLBACK = PANEL_DRAGS.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'panel-header') ?? null;
// the door a row's press opens the file with when it was no drag: the tree's own row door (files.open)
const EXPLORER_OPEN = manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.control === 'file-row') ?? null;
function scrubModifier(entry: DoorEntry, modifier: string | null): string | null {
  const gesture = manifest.interactions.gestures.find((g) => entry.door.kind === 'panel-drag' && g.id === entry.door.gesture);
  return modifier !== null && 'modifier' in entry.command.args && gesture?.modifiers.some((m) => m.key === modifier) === true ? modifier : null;
}

// Whether the pointer owner runs the presses of a drawn control (a palette tile): its click then comes from here, and
// the control's own onClick runs only an activation with no press (assistive technology's, or a key's).
export function pressedByPointer(entry: DoorEntry): boolean {
  return isTile(entry);
}

// The drag in progress, for the canvas chrome: the nodes dragged, or, for a palette tile's creation drag, none and
// the palette entry it inserts; the drop proposal drawn now (the one a release commits) and, for a creation drag, the
// refusal its drop would meet there (the command's own, store.refusal: a parent that does not accept the element,
// spec palette-drag-insert, Problems in Pager 3); the receiver levels the drawn proposal climbed above the pointer's
// own (the drag session's level keys); and where the pointer is on the screen (the ghost of a creation drag follows
// it). Pointer state, not editor state: nothing changes until the release.
// What a creation drag inserts: the tile pressed, the arguments it stands for (a palette entry: {entry}; a component:
// {component}) and the canvas-drag door that drops it where the proposal says.
// While a gesture is open the keys belong to it: they are read in the drag key context and their doors run through
// the gesture's transaction (keymap.ts).
let open: Gesture | null = null;
export function openGesture(): { readonly context: KeyContextId; readonly gesture: Gesture } | null {
  if (open === null) return null;
  return { context: session !== null && open === session ? COLOR_PICKER_CONTEXT : 'drag', gesture: open };
}

// The colour picker's session (spec color-picker; its state: src/editor/inspector/color-picker.ts): one gesture opened
// when the picker opens, through which every part of the picker writes (dispatchInSession); the picker's Apply
// commits it, its Cancel, Escape (drag.cancel, in the picker's own key context) or its closing otherwise cancels it.
// A press on the picker's area (saturation across, brightness down) writes the colour it points at, and so does every
// move while the button is held.
const COLOR_PICKER_CONTEXT: KeyContextId = 'color-picker';
// the picker's own cancel, run when Escape ends its session: the command of its Cancel button
const CANCEL_PICKER = (manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.panel === 'color-picker' && d.door.control === 'cancel')?.command.id ?? '') as CommandId;
let session: Gesture | null = null;
let sessionDispatch: ((id: CommandId, args: unknown) => DispatchResult) | null = null;
export function dispatchInSession(id: CommandId, args: unknown): DispatchResult | null {
  const result = sessionDispatch === null ? null : sessionDispatch(id, args);
  finishPickerSession();
  return result;
}
let pendingPickerEnd: (() => void) | null = null;
function finishPickerSession(): void {
  const finish = pendingPickerEnd;
  pendingPickerEnd = null;
  finish?.();
}

// Runs a dispatch of its own once no gesture is open: at once, or, when a press opened one before a field lost the
// focus (a click elsewhere), once that gesture ends, since a command recorded once per dispatch never joins a gesture.
// A field keeps what was typed this way when it is left (the inspector's text field, a number field).
export function afterGesture(run: () => void): void {
  if (open === null) {
    run();
    return;
  }
  const wait = () => (open === null ? run() : requestAnimationFrame(wait));
  requestAnimationFrame(wait);
}

// The slider a field draws beside its value (the user's real-use audit, item A3.30). The field registers what its
// release commits (the text the range holds, with the unit the value carries); the pointer owner writes it on the
// release alone, so nothing is written while the pointer moves and the whole drag is one undo step.
const SLIDER_COMMITS = new WeakMap<HTMLInputElement, (value: string) => void>();
export function registerSlider(element: HTMLInputElement, commit: (value: string) => void): () => void {
  SLIDER_COMMITS.set(element, commit);
  return () => SLIDER_COMMITS.delete(element);
}

// A control that repeats while held (a number field's step buttons, shell/field.tsx, which carry data-repeat): the
// press runs its step, with the
// one key it holds; held down, the step runs again after numberField.repeatDelay and then every
// numberField.repeatInterval (Chromium's press-and-hold), until the release, a cancel or the pointer leaving it. The
// press keeps the focus where it is.
const REPEATS = new WeakMap<HTMLElement, (modifier: string | null) => void>();
const REPEAT_DELAY = numberConstant('numberField.repeatDelay');
const REPEAT_INTERVAL = numberConstant('numberField.repeatInterval');
export function registerRepeat(element: HTMLElement, step: (modifier: string | null) => void): () => void {
  REPEATS.set(element, step);
  return () => REPEATS.delete(element);
}


// The text toolbar over the canvas while a text is edited (text-toolbar.tsx): its controls run their own doors, so a
// press there is no press on the page under it, and it leaves the focus in the edited text (spec
// text-inline-formatting: Bold, Italic and Link act on what is selected there).
const TEXT_TOOLBAR_AREA = `[data-canvas-overlay] [data-region="${TEXT_TOOLBAR}"]`;
const onTextToolbar = (target: EventTarget | null) => target instanceof Element && target.closest(TEXT_TOOLBAR_AREA) !== null;
// an option of the list the focused combobox controls (a value field's variable suggestions): a press there keeps the
// focus in the combobox, as the WAI-ARIA combobox keeps it, and the option's click runs
const onOwnOption = (target: EventTarget | null) => {
  const field = document.activeElement;
  const list = field?.getAttribute('role') === 'combobox' ? field.getAttribute('aria-controls') : null;
  return list !== null && list !== undefined && target instanceof Element && target.closest('[role="option"]')?.closest(`[id="${CSS.escape(list)}"]`) != null;
};

// What a pointer event is on: the label of an element on the canvas chrome (spec select-click, "Hit zones": the
// selection label and the hover label select or drag the element they name), the page under the overlay, the
// stage, or neither (the rest of the editor, and the text toolbar drawn over the canvas).
function pressAt(event: MouseEvent, isRoot: (node: string) => boolean, under: EventTarget | null = event.target): Press | null | 'elsewhere' {
  const target = under instanceof Element ? under : null;
  if (onTextToolbar(target)) return 'elsewhere';
  const named = target?.closest('[data-canvas-overlay] [data-label-for]')?.getAttribute('data-label-for') ?? null;
  if (named !== null) return { on: 'node', node: named, root: isRoot(named), label: true };
  if (target?.closest('[data-canvas-overlay]')) {
    const frame = canvasFrame();
    const hit = frame ? nodeAt(frame, { x: event.clientX, y: event.clientY }) : null;
    return hit === null ? null : { on: 'node', node: hit.node, root: hit.root };
  }
  if (target?.hasAttribute('data-canvas-stage')) return { on: 'stage' };
  // a Layers row, pressed on itself or its name (not on its caret, eye, lock or name field) with no key held
  const row = ROW_DROP !== null && ROW_SELECT !== null ? target?.closest(`[data-door="${ROW_SELECT.ref}"]`) : null;
  if (row && !target?.closest('button, input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]') && modifierOf(event) === null) {
    const stands: unknown = JSON.parse(row.getAttribute('data-args') ?? '{}');
    const node = stands !== null && typeof stands === 'object' ? (stands as Record<string, unknown>).target : undefined;
    if (typeof node === 'string') return { on: 'row', node };
  }
  // a palette tile that is available (a tile of a feature not built yet is drawn disabled and takes no press), or a
  // number field's label that is (its field's feature registered): the text its field holds is read now, at the press
  const control = target?.closest('[data-door]');
  const entry = manifest.doorByRef.get((control?.getAttribute('data-door') ?? '') as DoorId);
  if (control instanceof HTMLElement && entry && PAD_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const box = control.getBoundingClientRect();
    // the centre on the pixel grid, so a press on the drawn centre puts the light at 0, 0
    return { on: 'pad', entry, args: args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {}, centre: { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }, element: control };
  }
  if (control instanceof HTMLElement && entry && GRIP_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const base: unknown = JSON.parse(control.getAttribute('data-offset') ?? '{}');
    const { x, y } = (base ?? {}) as Record<string, unknown>;
    if (typeof x === 'number' && typeof y === 'number') return { on: 'grip', entry, args: args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {}, base: { x, y } };
  }
  if (control && entry && STOP_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const stands = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    const edit = stands.edit !== null && typeof stands.edit === 'object' ? (stands.edit as Record<string, unknown>) : {};
    const bar = control.closest('[data-gradient-bar]')?.getBoundingClientRect();
    if (typeof edit.stop === 'number' && bar && bar.width > 0) return { on: 'stop', entry, args: stands, index: edit.stop, bar: { left: bar.left, width: bar.width } };
  }
  if (control instanceof HTMLElement && entry && SPLITTER_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    return { on: 'splitter', entry, args: args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {} };
  }
  if (control instanceof HTMLElement && entry && LAYER_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const stands = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    const edit = stands.edit !== null && typeof stands.edit === 'object' ? (stands.edit as Record<string, unknown>) : {};
    const move = edit.move !== null && typeof edit.move === 'object' ? (edit.move as Record<string, unknown>) : {};
    const rows = [...(control.closest('[data-shadow-rows]')?.querySelectorAll<HTMLElement>('[data-shadow-row]') ?? [])].map((el) => el.getBoundingClientRect()).map((b) => ({ top: b.top, bottom: b.bottom }));
    if (typeof move.from === 'number' && rows.length > 0) return { on: 'layer', entry, args: stands, index: move.from, rows };
  }
  if (control instanceof HTMLElement && entry && EXPLORER_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const stands = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    if (typeof stands.path === 'string' && stands.path !== '') return { on: 'explorer', entry, args: stands, path: stands.path };
  }
  if (control instanceof HTMLElement && entry && COLUMN_DRAGS.includes(entry) && isFeatureBuilt(entry.door.feature as FeatureId)) {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const stands = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    if (typeof stands.field === 'string' && stands.field !== '') return { on: 'column', entry, args: stands, field: stands.field };
  }
  if (control instanceof HTMLElement && entry && PANEL_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const stands = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    if (typeof stands.panel === 'string' && stands.panel in PANELS) return { on: 'panel', entry, args: stands, panel: stands.panel as Panel };
  }
  if (control && entry && SCRUBS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const input = control.closest('[data-number-field]')?.querySelector('input');
    return { on: 'scrub', entry, args: args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {}, value: input?.value ?? '' };
  }
  // the timeline: a press on the ruler moves the playhead (a click sets it, the drag scrubs), a press on a keyframe's
  // marker drags that keyframe along the track (spec timeline-preview, spec timeline-keyframes)
  if (control instanceof HTMLElement && entry && PLAYHEAD_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const track = control.closest('[data-track]')?.getBoundingClientRect();
    if (track !== undefined && track.width > 0) return { on: 'playhead', entry, args: { ...entry.door.args }, track: { left: track.left, width: track.width } };
  }
  if (control instanceof HTMLElement && entry && KEYFRAME_DRAGS.includes(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const stands = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    const track = control.closest('[data-track]')?.getBoundingClientRect();
    if (typeof stands.keyframe === 'number' && typeof stands.animation === 'string' && track !== undefined && track.width > 0) {
      return { on: 'keyframe', entry, args: stands, track: { left: track.left, width: track.width } };
    }
  }
  if (control && entry && isTile(entry) && control.getAttribute('aria-disabled') !== 'true') {
    const args: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    return { on: 'tile', entry, args: args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {} };
  }
  // a press on a panel's header itself (its name, its empty room): the same drag the grip's controls open, with the
  // header standing for the panel it names (spec floating-panels)
  if (target instanceof Element) {
    const header = target.closest('[data-panel-header]');
    const panel = header?.getAttribute('data-panel-header') ?? null;
    if (header !== null && panel !== null && panel in PANELS && PANEL_FALLBACK !== null && target.closest('button, input') === null) {
      return { on: 'panel', entry: PANEL_FALLBACK, args: { panel }, panel: panel as Panel };
    }
  }
  return 'elsewhere';
}

// Installs the pointer owner on the editor's window; returns its removal.
//
// One editor per document, and this is where that is enforced: the transient state above (the band, the hovered node,
// the drag, the press, the pan…) is per window, not per store, so a second editor installed over a live one would
// share it. That cannot happen silently — the second installer is refused here, records an incident, and in
// development and tests throws, so the defect shows instead of two editors writing each other's state. The first
// installer keeps the pointer. A future feature that shows two editors side by side must first make this state
// per store (the plan's T7); until one exists, no second instance can appear — this guard is the proof.
let pointerOwner: EditorStore | null = null;
// what is being picked now: an interaction's target or a motion action's (pointer/press.ts Picking)
const pickingOf = (ui: EditorUi): Picking => ({ interaction: pickingTarget(ui), motion: motionPicking(ui) });

export function installPointer(store: EditorStore, target: Window = window): () => void {
  if (pointerOwner !== null && pointerOwner !== store) {
    reportError('a second editor tried to take the pointer owner', 'the pointer owner is installed: one editor per document');
    if (import.meta.env.DEV) throw new Error('the pointer owner is installed: one editor per document');
    return () => undefined;
  }
  pointerOwner = store;
  let machine: Machine = IDLE;
  let buttons: { button: Button; count: number; modifier: string | null } | null = null;
  // an element drag, or a palette tile's creation drag: what it moves (nothing for a tile), the palette entry it
  // inserts (a tile's), the pointer's own proposal (level 0) and where the pointer was when it was taken
  // (drag.hysteresis), and the proposal drawn at the drag session's level, the levels it climbed and the refusal its
  // drop would meet (a creation drag's)
  let dragging: {
    readonly dragged: readonly NodeId[];
    readonly inserting: Inserting | null;
    base: DropProposal | null;
    takenAt: Point | null;
    proposal: DropProposal | null;
    levels: number;
    refusal: Message | null;
    // the proposal the pointer and the level made, before a refusal moved it to the nearest valid place, and that
    // refusal with the element that refused (spec drag-layout, Problems in Pager 4)
    raw: DropProposal | null;
    redirect: Redirect | null;
    // the side drop offered, whether the dwell confirmed it, where its pill is drawn and the refusal its wrap would
    // meet
    side: { offer: SideOffer; armed: boolean; pill: Point | null; refusal: Message | null } | null;
    // whether the pointer's proposal came from a Layers row (its release runs the row drop's door)
    fromRow: boolean;
    // the folded row the pointer rests on, and the timer that unfolds it
    resting: string | null;
  } | null = null;
  let unfold: ReturnType<typeof setTimeout> | null = null;
  // the colour picker's area held with the pointer
  let pickingColor: { area: HTMLElement; pointer: number } | null = null;
  // the colour at a point of the area: the hue and alpha it shows (data-hue, data-alpha), the saturation across and the
  // brightness down, written with the area's door (style.set) for its property through the session
  const pickColor = (area: HTMLElement, x: number, y: number) => {
    const box = area.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || session === null) return;
    const s = Math.min(1, Math.max(0, (x - box.left) / box.width));
    const v = 1 - Math.min(1, Math.max(0, (y - box.top) / box.height));
    // a pick that keeps the alpha writes it opaque when the colour the picker shows is fully transparent (item 6.5)
    const shown = Number(area.dataset.alpha ?? '1');
    const value = formatColor(hsbToRgb({ h: Number(area.dataset.hue ?? '0'), s, v, a: pickedAlpha(shown, shown) }));
    const entry = manifest.doorByRef.get((area.getAttribute('data-door') ?? '') as DoorId);
    if (!entry) return;
    session.dispatch(entry.command.id as CommandId, { ...entry.door.args, property: area.dataset.property ?? '', value } as never);
  };
  // the resize handle pressed: its door and handle, where it went down, what the element measured then and the zoom,
  // and the gesture its drag opened (none before the threshold) with the cancellations counted when it opened
  // a resize: its handle, where it began, its basis, the zoom, and the resized node and its box then (page px), which
  // the snapping reads
  let resizing: { entry: DoorEntry; handle: string; pointer: number; start: Point; basis: ResizeFrom; zoom: number; gesture: Gesture | null; cancels: number; node: NodeId; box: Box | null; media: boolean } | null = null;
  // a rotation in progress: its handle's door, the element's centre and the pointer's angle around it at the press, the
  // angle the element held, and its gesture once the pointer moved past the threshold
  // a guide drag in progress: a new guide out of a ruler or a guide moved, its axis, the guide once there is one, and
  // its gesture once the pointer moved past the threshold
  let guiding: { kind: 'create' | 'move'; axis: string; guide: string | null; pointer: number; start: Point; gesture: Gesture | null; cancels: number } | null = null;
  let rotating: { entry: DoorEntry; property: string; pointer: number; start: Point; centre: Point; startAngle: number; base: number; gesture: Gesture | null; cancels: number } | null = null;
  let spacing: SpacingDrag | null = null;
  // the timer that confirms the side drop offered after wrap.sideDwell, and the frame loop of the autoscroll
  let dwell: ReturnType<typeof setTimeout> | null = null;
  // the menu button the pointer rests on, published after menus.hoverSwitch (spec app-menu): a pointer crossing a
  // button on its way into the open menu switches nothing
  let menuResting: string | null = null;
  let menuRestPoint: Point | null = null;
  let menuDwell: ReturnType<typeof setTimeout> | null = null;
  let scrolling = 0;
  // whether the pointer has been inside the page's visible box since the drag began, far enough from its edges: the
  // autoscroll waits for it, so a drag that starts at an edge does not scroll at once (spec drag-layout, Problems 3)
  let insideOnce = false;
  // the same, for the Layers tree (spec drag-autoscroll, Problems in Pager 2), and since when the pointer stands in the
  // tree's band: a timer of drop.autoscrollTreeDwell started when it enters, and whether it has run out (its rest
  // there before the tree scrolls under a row, LA1)
  let insideTreeOnce = false;
  let treeBand: ReturnType<typeof setTimeout> | null = null;
  let treeRested = false;
  // the press of the gesture, while one is open: a tile's press decides its click or its drop at the release
  let pressed: Press | null = null;
  // where the pointer is on the screen, from its last press or move
  let pointerAt: Point = { x: 0, y: 0 };
  // the drags cancelled when the gesture opened (drag-session.ts): a newer cancellation ends the gesture
  let cancelsAtOpen = 0;
  // where the press went down, on the screen and in page pixels (null outside the page)
  let pressedAt: { screen: Point; page: Point | null } | null = null;
  // the marquee being drawn: its door, its mode, and the press the band started from
  let marquee: { entry: DoorEntry; mode: string; press: Extract<Press, { on: 'node' }> } | null = null;
  // a free drag in progress: where it started on the screen, the zoom then, and the travel already run (page px)
  // a free drag: where it began, the zoom, the travel already run, and the moved node and its box then (page px), which
  // the snapping reads
  let freeing: { start: Point; zoom: number; applied: Point; node: NodeId | null; box: Box | null } | null = null;
  // whether the press just handled leaves the focus where it is: in the text edited in place, which the press
  // started or landed on (the browser would otherwise move the focus to the editor's page body at the mousedown)
  let keepFocus = false;
  // the door that keeps the text a press outside it left, with the edit's arguments, run once the gesture closes
  let keeping: { entry: DoorEntry; args: Record<string, unknown> } | null = null;
  // The pick of an interaction's target (spec events-actions): the element the press landed on. It is recorded here and
  // run once the gesture closes, as a dispatch of its own (interactions.update records one transaction per dispatch and
  // never joins a gesture).
  let pickAfter: { entry: DoorEntry; args: Record<string, unknown> } | null = null;
  // a plain press on an element of a selection of several: its click waits for the release, so a drag from it drags
  // the whole selection (archive/DESIGN.md "Canvas", drag; the user's real-use audit, item 3.4), and a release without
  // a drag selects that element alone, as the click does
  let deferredClick: { entry: DoorEntry; args: Record<string, unknown> } | null = null;
  // the modifier held at the last release (a drag's Alt duplicates, spec drag-duplicate)
  let releaseModifier: string | null = null;
  // the scrub of a number field's label: its press, and where the pointer went down on the screen
  let scrubbing: { readonly press: Extract<Press, { on: 'scrub' }>; readonly startX: number } | null = null;
  // a slider a field draws (A3.30), held: what its release writes
  let sliding: { readonly element: HTMLInputElement; readonly commit: (value: string) => void; readonly pointer: number } | null = null;
  // a repeating control held down (registerRepeat): its element, the pointer and the timer of its next step
  let repeating: { readonly element: HTMLElement; readonly pointer: number; timer: number } | null = null;
  const stopRepeating = () => {
    if (repeating === null) return;
    window.clearTimeout(repeating.timer);
    window.clearInterval(repeating.timer);
    repeating = null;
  };
  // the drag of a shadow's light: its press, and where the pointer went down on the screen
  let lighting: { readonly press: Extract<Press, { on: 'pad' }>; readonly startX: number } | null = null;
  // The light follows the pointer from the press on: X and Y are the pointer's offset from the pad's centre, whole
  // pixels, set anew at every move (the gesture cancelled back to the shadow before the press and opened again); the
  // release keeps them, one undo step; Escape puts them back.
  const moveLight = (at: Point) => {
    if (lighting === null) return;
    const { press, startX } = lighting;
    open?.cancel();
    open = store.gesture();
    const edit = { ...(press.args.edit as Record<string, unknown>), x: `${Math.round(at.x - press.centre.x)}px`, y: `${Math.round(at.y - press.centre.y)}px` };
    open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, edit, distance: at.x - startX } as never);
  };
  // the drag of the quick panel by its grip: its press, and where the pointer went down on the screen
  let gripping: { readonly press: Extract<Press, { on: 'grip' }>; readonly start: Point } | null = null;
  // The drag of a splitter (spec panel-resize): its press, where the pointer went down, and the size it showed then,
  // which every move sizes anew from (the gesture cancelled back to it and opened again), so Escape puts it back
  let splitting: { readonly press: Extract<Press, { on: 'splitter' }>; readonly start: Point; readonly from: number } | null = null;
  // a panel dragged by its header: the panel it moves. Its hint follows the pointer from the press on; the release
  // runs the door of the place the pointer is in (spec floating-panels)
  let panelling: { readonly press: Extract<Press, { on: 'panel' }> } | null = null;
  // The panel follows the pointer from the press on: its offset from its element is the one it was drawn at plus the
  // pointer's travel, set anew at every move (the gesture cancelled back and opened again); the release keeps it (not
  // an undo step); Escape puts it back.
  const moveGrip = (at: Point) => {
    if (gripping === null) return;
    const { press, start } = gripping;
    open?.cancel();
    open = store.gesture();
    open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, offset: { x: press.base.x + at.x - start.x, y: press.base.y + at.y - start.y }, distance: at.x - start.x } as never);
  };
  // the drag of a gradient stop: its press, and where the pointer went down on the screen
  let stopping: { readonly press: Extract<Press, { on: 'stop' }>; readonly startX: number } | null = null;
  // The drag of a row of the Explorer's file tree (spec explorer-file-system): its press and the folder row the
  // pointer is over, marked while the drag goes on; the release moves the file there through the row's move door, one
  // undo step, and Escape moves nothing
  let exploring: { readonly press: Extract<Press, { on: 'explorer' }>; over: string | null } | null = null;
  // The drag of a column of the Data panel (spec content-data, "binding"): its press and the element's part the pointer
  // is over (the node and the part a [data-data-target] stands for), marked while the drag goes on; the release binds
  // that part to the column's field through the drag door, one undo step, and Escape binds nothing
  let columning: { readonly press: Extract<Press, { on: 'column' }>; over: { readonly node: string; readonly to: string } | null } | null = null;
  const partUnder = (at: Point): HTMLElement | null => {
    const under = document.elementFromPoint(at.x, at.y);
    return under instanceof Element ? under.closest<HTMLElement>('[data-data-target]') : null;
  };
  const moveColumn = (at: Point): void => {
    if (columning === null) return;
    const part = partUnder(at);
    const stands: unknown = part === null ? null : JSON.parse(part.getAttribute('data-args') ?? 'null');
    const over = stands !== null && typeof stands === 'object' && typeof (stands as { node?: unknown }).node === 'string' && typeof (stands as { to?: unknown }).to === 'string' ? { node: (stands as { node: string }).node, to: (stands as { to: string }).to } : null;
    if (JSON.stringify(over) === JSON.stringify(columning.over)) return;
    columning = { ...columning, over };
    document.querySelectorAll('[data-data-target].is-over').forEach((el) => el.classList.remove('is-over'));
    part?.classList.add('is-over');
  };
  // The timeline: the drag of the playhead along the ruler and the drag of a keyframe along the track (specs
  // timeline-preview, timeline-keyframes). Each follows the pointer from the press on, dispatching its command in a
  // gesture of its own opened anew at every move (so Escape puts the playhead, or what the keyframe held, back).
  let playheading: { readonly press: Extract<Press, { on: 'playhead' }>; readonly startX: number } | null = null;
  let keyframing: { readonly press: Extract<Press, { on: 'keyframe' }>; readonly startX: number } | null = null;
  const movePlayhead = (at: Point) => {
    if (playheading === null) return;
    const { press, startX } = playheading;
    const shown = shownAnimation(store.getState());
    if (shown === null) return;
    const time = playheadTimeFromTrackX(shown.animation, at.x - press.track.left);
    open?.cancel();
    open = store.gesture();
    open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, time, distance: at.x - startX } as never);
  };
  const moveKeyframe = (at: Point) => {
    if (keyframing === null) return;
    const { press, startX } = keyframing;
    const offset = offsetFromTrackX(at.x - press.track.left);
    open?.cancel();
    open = store.gesture();
    open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, offset, distance: at.x - startX } as never);
  };
  const folderUnder = (at: Point): HTMLElement | null => {
    const under = document.elementFromPoint(at.x, at.y);
    return under instanceof Element ? under.closest<HTMLElement>('[data-folder]') : null;
  };
  const moveExplorer = (at: Point): void => {
    if (exploring === null) return;
    const over = folderUnder(at)?.getAttribute('data-folder') ?? null;
    if (over === exploring.over) return;
    exploring = { ...exploring, over };
    document.querySelectorAll('[data-folder].is-over').forEach((el) => el.classList.remove('is-over'));
    if (over !== null) document.querySelector(`[data-folder="${CSS.escape(over)}"]`)?.classList.add('is-over');
  };
  // the drag of a shadow's layer row (A3.34): its press; every move dispatches the move door with the index the
  // pointer is over, from the press state each time (the gesture cancelled back), so what the release keeps is one
  // undo step and Escape puts the rows back
  let layering: { readonly press: Extract<Press, { on: 'layer' }> } | null = null;
  const moveLayer = (at: Point) => {
    if (layering === null) return;
    const { press } = layering;
    const inside = press.rows.findIndex((r) => at.y >= r.top && at.y <= r.bottom);
    const to = inside === -1 ? (at.y < (press.rows[0]?.top ?? 0) ? 0 : press.rows.length - 1) : inside;
    if (to === press.index) return;
    open?.cancel();
    open = store.gesture();
    const edit = { ...(press.args.edit as Record<string, unknown> | undefined), move: { from: press.index, to } };
    open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, edit } as never);
  };  // The splitter follows the pointer from the press on: its travel along the splitter's own axis is handed to the
  // command, which sizes the panel from the size it held at the press (spec panel-resize); the gesture is cancelled
  // back to that size first, so Escape puts it back
  const resize = (at: Point) => {
    if (splitting === null) return;
    const { press, start, from } = splitting;
    const axis = SPLITTERS[String(press.args.splitter ?? '') as SplitterId]?.axis ?? 'x';
    const distance = axis === 'x' ? Math.round(at.x - start.x) : Math.round(at.y - start.y);
    open?.cancel();
    open = store.gesture();
    open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, size: from, distance } as never);
  };
  // A dragged panel's hint follows the pointer from the press on: where the panel would land is what the hint draws
  // (workspace/panel-drag.ts), and the release runs that place's door. Nothing is dispatched while dragging.
  const movePanelHint = (at: Point) => {
    if (panelling === null) return;
    showPanelHint(panelHintAt(at.x, at.y, panelling.press.panel));
  };
  // The stop follows the pointer along its bar from the press on: every move sets its position anew (the gesture
  // cancelled back to the gradient before the press and opened again), a whole per cent from 0 to 100; the release
  // keeps it, one undo step; Escape puts it back.
  const moveStop = (at: Point) => {
    if (stopping === null) return;
    const { press, startX } = stopping;
    const position = Math.round(Math.min(100, Math.max(0, ((at.x - press.bar.left) / press.bar.width) * 100)));
    open?.cancel();
    open = store.gesture();
    const edit = { ...(press.args.edit as Record<string, unknown>), stop: press.index, position };
    open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, edit, distance: at.x - startX } as never);
  };

  // The scrub follows the pointer: every move scrubs anew from the value held before the press, so the gesture is
  // cancelled (back to that value) and opened again with the pointer's travel and the key held now.
  const scrub = (at: Point, modifier: string | null) => {
    if (scrubbing === null) return;
    const { press, startX } = scrubbing;
    const held = scrubModifier(press.entry, modifier);
    open?.cancel();
    open = store.gesture();
    open.dispatch(press.entry.command.id as CommandId, { ...press.entry.door.args, ...press.args, value: press.value, distance: at.x - startX, ...(held !== null ? { modifier: held } : {}) } as never);
  };

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
    if (marquee === null || pressedAt === null || pressedAt.page === null) return;
    const to = pagePoint(at);
    if (to === null) return;
    const from = pressedAt.page;
    open?.cancel();
    open = store.gesture();
    const rect = { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y };
    open.dispatch(marquee.entry.command.id as CommandId, { ...argsFor(marquee.entry, marquee.press, NOT_PICKING), rect, mode: marquee.mode, ...(leavesNow() ? { leaves: true } : {}) } as never);
    const s = pressedAt.screen;
    setBand({ x: Math.min(s.x, at.x), y: Math.min(s.y, at.y), width: Math.abs(at.x - s.x), height: Math.abs(at.y - s.y) });
  };

  const factsOf = (press: Press): PressFacts => {
    const state = store.getState();
    const formControl = press.on === 'node' && isValueControl(state.document, press.node);
    const grid = press.on === 'node' && laysGrid(press.node);
    return { textual: press.on === 'node' && !formControl && isTextElement(state.document, press.node), edited: editedNode(state), formControl, grid };
  };

  const run = (effect: Effect) => {
    if (effect === 'press' && machine.phase !== 'idle' && buttons !== null) {
      const press = machine.press;
      // a press outside the text edited in place keeps that text: the edit's node and text are read now, before the
      // press's own door (a selection elsewhere) ends the edit, and its door runs once the gesture closes, as a
      // dispatch of its own (text.set records one transaction per dispatch and never joins a gesture); the press's own
      // door records nothing, so the press is one undo step, and the status bar ends on the kept text
      const ending = editEndDoor(press, buttons.button, buttons.count, buttons.modifier, factsOf(press));
      const endArgs = ending ? editArgs(store.getState(), ending.command) : null;
      keeping = ending && endArgs ? { entry: ending, args: endArgs } : null;
      open = store.gesture();
      pressed = press;
      cancelsAtOpen = store.getState().ui.drag.cancels;
      // a key only a drag gesture holds (the duplicate's Alt) is no click's: the press selects as a plain one does
      const clickModifier = buttons.modifier !== null && DRAG_ONLY_MODIFIERS.has(buttons.modifier as never) ? null : buttons.modifier;
      const picking = pickingOf(store.getState().ui);
      const entry = clickDoor(press, buttons.button, buttons.count, clickModifier, factsOf(press), picking);
      const selected = store.getState().selection;
      const plainPress = press.on === 'node' && !press.root && buttons.button === 'primary' && buttons.count === 1 && clickModifier === null;
      const ofSeveral = plainPress && selected.length > 1 && selected.includes(press.node as NodeId);
      // a plain press inside a selected element (not the page root): a drag from it drags that element, a click selects
      // what was pressed (the user's real-use audit, item 3.5)
      const now = store.getState().document;
      const insideSelected = plainPress && !selected.includes(press.node as NodeId) && selected.some((id) => locate(now, id)?.parent != null && isInside(now, press.node as NodeId, id));
      // a press that picks an interaction's target is no press of its own within the gesture: the pick runs once the
      // gesture closes (its command records one transaction per dispatch)
      const pickingDoor = entry !== null && entry.door.kind === 'canvas-click' && (entry.door.target === 'pick-target' || entry.door.target === 'pick-motion-target') ? entry : null;
      const deferred = (ofSeveral || insideSelected) && pickingDoor === null;
      deferredClick = entry && deferred ? { entry, args: argsFor(entry, press, picking) as Record<string, unknown> } : null;
      if (pickingDoor !== null) pickAfter = { entry: pickingDoor, args: argsFor(pickingDoor, press, picking) };
      if (entry && !deferred && pickingDoor === null) open.dispatch(entry.command.id as CommandId, argsFor(entry, press, picking) as never);
      // a press that lands on the edited text leaves the focus in it
      const edited = editedNode(store.getState());
      keepFocus = edited !== null && press.on === 'node' && press.node === edited;
      // a press on a field's label starts its scrub, which the moves run
      if (press.on === 'scrub') scrubbing = { press, startX: machine.start.x };
      // a press on the timeline's ruler sets the playhead where it lands, and the moves scrub it (spec
      // timeline-preview); a press on a keyframe's marker starts its drag (spec timeline-keyframes)
      if (press.on === 'playhead') {
        playheading = { press, startX: machine.start.x };
        movePlayhead(machine.start);
      }
      if (press.on === 'keyframe') keyframing = { press, startX: machine.start.x };
      // a press on a shadow layer's row starts its move, which the moves run (A3.34)
      if (press.on === 'layer') layering = { press };
      // a press on a gradient stop chooses it (the editor's fields edit it) and starts its drag, which the moves run
      if (press.on === 'stop') {
        stopping = { press, startX: machine.start.x };
        gradientView.chooseStop(press.index);
      }
      // a press on a light pad puts the light where it lands, and the moves drag it; the pad takes the focus (its keys)
      // a press on the quick panel's grip starts its drag, which the moves run
      if (press.on === 'grip') gripping = { press, start: machine.start };
      // a press on a row of the Explorer's tree starts its drag; the moves mark the folder under the pointer
      if (press.on === 'explorer') exploring = { press, over: null };
      // a press on a column of the Data panel starts its drag; the moves mark the element's part under the pointer
      if (press.on === 'column') columning = { press, over: null };
      // a press on a splitter starts its drag, which the moves run; the size it shows now is the one Escape puts back
      if (press.on === 'splitter') {
        const from = press.entry.door.kind === 'panel-drag' && press.entry.door.source === FRAME_EDGE ? viewportWidth(store.getState()) : splitterSize(store.getState().ui, String(press.args.splitter ?? ''));
        if (from !== null) splitting = { press, start: machine.start, from };
      }
      // a press on a panel's header starts its drag: the panel follows the pointer as a hint of where it would land
      if (press.on === 'panel') panelling = { press };
      if (press.on === 'pad') {
        lighting = { press, startX: machine.start.x };
        press.element.focus();
        moveLight(machine.start);
      }
    } else if (effect === 'drag' && machine.phase === 'dragging' && buttons?.button === 'primary') {
      const press = machine.press;
      if (press.on === 'tile') {
        // a tile's creation drag: nothing is dragged; what the tile stands for is inserted where it is dropped. It
        // starts over the palette, outside the page: no proposal yet
        const drop = tileDrag(press.entry);
        if (drop === null) return;
        const inserting: Inserting = { tile: press.entry, args: press.args, drop };
        dragging = { dragged: [], inserting, base: null, takenAt: null, proposal: null, levels: 0, refusal: null, raw: null, redirect: null, side: null, fromRow: false, resting: null };
        liveDrag.begin([]);
        setDrag({ dragged: [], inserting, proposal: null, refusal: null, redirect: null, levels: 0, at: pointerAt, side: null });
        return;
      }
      if (press.on === 'row') {
        if (ROW_SELECT === null || ROW_DROP === null) return;
        if (!store.getState().selection.includes(press.node as NodeId)) open?.dispatch(ROW_SELECT.command.id as CommandId, { ...ROW_SELECT.door.args, target: press.node } as never);
        const state = store.getState();
        const roots = selectionRoots(state.document, state.selection);
        // the page root's row is never dragged
        if (roots.length === 0 || roots.some((at) => at.parent === null)) return;
        const dragged = roots.map((at) => at.node.id);
        dragging = { dragged, inserting: null, base: null, takenAt: null, proposal: null, levels: 0, refusal: null, raw: null, redirect: null, side: null, fromRow: false, resting: null };
        liveDrag.begin(dragged);
        setDrag({ dragged, inserting: null, proposal: null, refusal: null, redirect: null, levels: 0, at: pointerAt, side: null });
        return;
      }
      const node = press.on === 'node' ? (locate(store.getState().document, press.node as NodeId)?.node ?? null) : null;
      // The band's door: the empty area's for a press on the page root or on a container's own area, the element's for
      // a press the empty area does not take (a leaf, or a container without children) — started by its modifier
      // (Shift), the band then working over that element's siblings (Problems in Pager 4). What the press's click did
      // is undone, so the marquee starts from the selection held before the press.
      const bandDoor = press.on === 'node' && (press.root || (node !== null && CONTAINERS.has(node.type) && node.children.length > 0)) ? MARQUEE : MARQUEE_ELEMENT;
      const mode = bandDoor === null || press.on !== 'node' ? null : marqueeMode(bandDoor, press, buttons.modifier, node);
      const plain = buttons.modifier === null || DRAG_MODIFIERS.has(buttons.modifier as never);
      const frame = canvasFrame();
      const zoom = frame ? geometryOf(frame)?.zoom : undefined;
      if (bandDoor !== null && press.on === 'node' && mode !== null) marquee = { entry: bandDoor, mode, press };
      else if (FREE_DRAG !== null && press.on === 'node' && !press.root && zoom !== undefined && positionedNow()) {
        const moved = store.getState().selection[0] ?? null;
        freeing = { start: machine.start, zoom, applied: { x: 0, y: 0 }, node: moved, box: moved === null ? null : pageLayout.box(moved) };
      }
      else if (ELEMENT_DRAGS.length > 0 && press.on === 'node' && !press.root && plain) {
        // any other press on an element drags the selection's roots, which the press has just made that element
        const state = store.getState();
        const dragged = selectionRoots(state.document, state.selection).map((at) => at.node.id);
        if (dragged.length > 0) {
          dragging = { dragged, inserting: null, base: null, takenAt: null, proposal: null, levels: 0, refusal: null, raw: null, redirect: null, side: null, fromRow: false, resting: null };
          liveDrag.begin(dragged);
          setDrag({ dragged, inserting: null, proposal: null, refusal: null, redirect: null, levels: 0, at: pointerAt, side: null });
        }
      }
    } else if (effect === 'commit' || effect === 'cancel') {
      const closing = open;
      const dropped = dragging?.proposal ?? null;
      const dragged = dragging !== null;
      const draggedIds = dragging?.dragged ?? [];
      const side = dragging?.side?.armed === true && dragging.fromRow === false ? dragging.side : null;
      const fromRow = dragging?.fromRow === true;
      // a creation drag's doors: where it drops, and its side drop (a palette tile's only)
      const inserting = dragging?.inserting ?? null;
      const dropDoorOf = inserting?.drop ?? null;
      const sideDoorOf = inserting === null ? null : sideTileFor(inserting);
      // the document before the release, to tell whether the drop placed anything
      const before = store.getState().document;
      stopDragTimers();
      const press = pressed;
      open = null;
      dragging = null;
      freeing = null;
      snapShown.set(null);
      liveDrag.end();
      scrubbing = null;
      stopping = null;
      layering = null;
      playheading = null;
      keyframing = null;
      // a dragged panel: the release runs the door of the place the pointer is in, with the panel and that place as
      // its arguments (spec floating-panels); a cancelled one puts nothing anywhere, and the hint goes either way
      if (panelling !== null) {
        const dragging = panelling;
        panelling = null;
        showPanelHint(null);
        if (effect === 'commit') {
          const place = panelDrop(panelHintAt(pointerAt.x, pointerAt.y, dragging.press.panel));
          if (place.door !== null) closing?.dispatch(place.door.command.id as CommandId, { ...place.door.door.args, panel: dragging.press.panel, ...place.args } as never);
        }
      }
      if (exploring !== null && effect === 'commit' && exploring.press.path !== '') {
        const into = exploring.over;
        const exploringNow = exploring.press;
        // a release over a folder moves the file there; a release anywhere else (a click) opens it in the code pane
        if (into !== null) closing?.dispatch(exploringNow.entry.command.id as CommandId, { ...exploringNow.entry.door.args, ...exploringNow.args, to: into } as never);
        else if (EXPLORER_OPEN !== null) closing?.dispatch(EXPLORER_OPEN.command.id as CommandId, { ...EXPLORER_OPEN.door.args, path: exploringNow.path } as never);
        document.querySelectorAll('[data-folder].is-over').forEach((el) => el.classList.remove('is-over'));
      }
      exploring = null;
      // a column released over an element's part binds the part to its field; released anywhere else, nothing
      if (columning !== null && effect === 'commit' && columning.over !== null) closing?.dispatch(columning.press.entry.command.id as CommandId, { ...columning.press.entry.door.args, field: columning.press.field, node: columning.over.node, to: columning.over.to } as never);
      if (columning !== null) document.querySelectorAll('[data-data-target].is-over').forEach((el) => el.classList.remove('is-over'));
      columning = null;
      lighting = null;
      gripping = null;
      splitting = null;
      pressed = null;
      setDrag(null);
      marquee = null;
      pressedAt = null;
      setBand(null);
      if (effect === 'commit' && press?.on === 'tile') {
        // a tile released below the threshold is its click (its door, at the selection); past it, the proposal drawn
        // last receives the tile's entry through the palette's canvas-drag door (its command refuses a parent that
        // does not accept it); with no proposal drawn (outside the page) nothing is inserted
        if (!dragged) closing?.dispatch(press.entry.command.id, { ...press.entry.door.args, ...press.args } as never);
        else if (side !== null && sideDoorOf !== null) closing?.dispatch(
          sideDoorOf.command.id,
          { ...sideDoorOf.door.args, ...press.args, target: side.offer.target, side: side.offer.side, wrapper: wrapped(side.offer.wrapper, releaseModifier) } as never
        );
        else if (dropped !== null && dropDoorOf !== null) closing?.dispatch(dropDoorOf.command.id, { ...dropDoorOf.door.args, ...press.args, parent: dropped.parent, index: dropped.index } as never);
      } else if (effect === 'commit' && dragged && side !== null && SIDE_ELEMENT !== null) {
        // a confirmed side drop puts the dragged elements beside its target in a new wrapper
        closing?.dispatch(SIDE_ELEMENT.command.id, { ...SIDE_ELEMENT.door.args, target: side.offer.target, side: side.offer.side, wrapper: wrapped(side.offer.wrapper, releaseModifier) } as never);
      } else if (effect === 'commit' && dropped !== null && !fromRow && DUPLICATE_DRAG !== null && releaseModifier !== null && releaseModifier === DUPLICATE_KEY) {
        // the duplicate's key held at the release (spec drag-duplicate): the originals stay; their copies (the
        // selection then) move to the place drawn, counted among the parent's children the originals included
        const parent = locate(before, dropped.parent)?.node ?? null;
        const others = parent === null ? [] : parent.children.filter((c) => !draggedIds.includes(c.id));
        const anchor = others[dropped.index];
        const index = parent === null ? dropped.index : anchor !== undefined ? parent.children.indexOf(anchor) : parent.children.length;
        const made = closing?.dispatch(DUPLICATE_DRAG.command.id, { ...DUPLICATE_DRAG.door.args } as never);
        const move = dropDoor(dropped);
        if (made?.status === 'done' && made.changed && move !== null) closing?.dispatch(move.command.id, { ...move.door.args, parent: dropped.parent, index } as never);
      } else if (effect === 'commit' && dropped !== null) {
        // the release commits exactly the proposal drawn last, through the door of its zone (a Layers row's, when it
        // came from a row), in the gesture's transaction
        const door = fromRow ? ROW_DROP : dropDoor(dropped);
        if (door !== null) closing?.dispatch(door.command.id, { ...door.door.args, parent: dropped.parent, index: dropped.index } as never);
      }
      // a press on an element of a selection of several, released without a drag: its click, now
      const waiting = deferredClick;
      deferredClick = null;
      if (effect === 'commit' && !dragged && waiting !== null) closing?.dispatch(waiting.entry.command.id as CommandId, waiting.args as never);
      if (effect === 'commit') closing?.commit();
      else closing?.cancel();
      // what a drop placed flashes (spec drag-layout, row 10): the selection it left, when the document changed
      if (effect === 'commit' && dragged && store.getState().document !== before) setDropped(store.getState().selection);
      // the text the press left is kept whether the gesture ends or the browser takes the pointer away, and a press
      // that picked an interaction's target runs its command now
      const kept = keeping;
      keeping = null;
      if (kept) store.dispatch(kept.entry.command.id as CommandId, kept.args as never);
      const picked = pickAfter;
      pickAfter = null;
      if (picked) store.dispatch(picked.entry.command.id as CommandId, picked.args as never);
    }
  };

  // The proposal drawn, and dropped at the release: the pointer's own at the level the drag session holds (its level
  // keys, drag-session.ts), and, for a creation drag, the refusal its drop would meet there. It is published when it
  // changes, whether the pointer or a level key changed it (a level key redraws it at once, without a pointer move),
  // and on every move of a creation drag, whose ghost follows the pointer.
  const redraw = (at: Point, publish: boolean) => {
    const live = liveDrag.get();
    if (dragging === null || live === null) return;
    const state = store.getState();
    const { proposal, level } = drawnProposal(state.ui.drag, live, state.document);
    // a proposal redirected beside what refuses it is asked again on every move: its side follows the pointer across
    // the refusing element's middle, which never changes the raw proposal inside it (a tile dragged down a list that
    // refuses it kept the side it entered by)
    const redirected = dragging.redirect !== null;
    const changed = level !== dragging.levels || JSON.stringify(proposal) !== JSON.stringify(dragging.raw) || redirected;
    if (changed) {
      dragging.raw = proposal;
      dragging.levels = level;
      // the refusal the drop would meet there, its command's own, asked without running it; where there is one, the
      // nearest place that takes it instead (spec drag-layout, Problems in Pager 4)
      const inserting = dragging.inserting;
      const refusalAt = (p: DropProposal): Message | null => {
        if (inserting !== null) return store.refusal(inserting.drop.command.id, { ...inserting.drop.door.args, ...inserting.args, parent: p.parent, index: p.index } as never);
        const door = dropDoor(p);
        return door === null ? null : store.refusal(door.command.id, { ...door.door.args, parent: p.parent, index: p.index } as never);
      };
      const why = proposal === null || proposal.refused ? null : refusalAt(proposal);
      // a lock is never worked around: a drop a lock refuses stays refused (spec lock-element)
      const nearest = why === null || proposal === null || why.key.startsWith('status.locked') ? null : nearestAccepted(state.document, dragging.dragged, proposal, at, (p) => refusalAt(p) === null);
      dragging.proposal = nearest ?? proposal;
      dragging.refusal = nearest === null ? why : null;
      dragging.redirect = nearest !== null && why !== null && proposal !== null ? { why, from: proposal.parent } : null;
    }
    if (changed || publish) setDrag({ dragged: dragging.dragged, inserting: dragging.inserting, proposal: dragging.proposal, refusal: dragging.refusal, redirect: dragging.redirect, levels: dragging.levels, at, side: sideView() });
  };
  const sideView = (): SideView | null => (dragging?.side ? { offer: dragging.side.offer, armed: dragging.side.armed, pill: dragging.side.pill, refusal: dragging.side.refusal } : null);

  // The side drop the pointer offers (spec drag-layout, row 5): a new offer (another target or side) starts the dwell
  // anew; after wrap.sideDwell in the same band it is confirmed, its pill drawn at the pointer, and it stays while the
  // pointer is within wrap.pillFreeze of the pill. The refusal its wrap would meet is asked of its command.
  const offer = (at: Point, onPage: boolean) => {
    if (dragging === null) return;
    const current = dragging.side;
    if (SIDE_DWELL > 0 && current?.armed && current.pill !== null && Math.hypot(at.x - current.pill.x, at.y - current.pill.y) <= PILL_FREEZE) return;
    // the side drop drawn holds while the pointer stays by that side of its element, wrap.sideEdgeExclusion around it:
    // a tremor never moves it to another element (spec drag-layout, the user's decision: no surgical pointing)
    const door = dragging.inserting !== null ? sideTileFor(dragging.inserting) : SIDE_ELEMENT;
    const fresh = door === null || (dragging.inserting !== null && !onPage) ? null : sideAt(store.getState().document, dragging.dragged, at);
    // a tremor out of the element keeps its side drop, but a deeper element's own side drop takes over
    const deeper = fresh !== null && current !== null && fresh.target !== current.offer.target && isInside(store.getState().document, fresh.target, current.offer.target);
    if (current !== null && !deeper && keepsSide(current.offer, at)) return;
    const next = fresh;
    const same = next !== null && current !== null && next.target === current.offer.target && next.side === current.offer.side;
    if (same) return;
    if (dwell !== null) clearTimeout(dwell);
    dwell = null;
    if (next === null || door === null) {
      dragging.side = null;
      return;
    }
    const args = { ...door.door.args, target: next.target, side: next.side, wrapper: next.wrapper, ...(dragging.inserting !== null ? dragging.inserting.args : {}) };
    dragging.side = { offer: next, armed: false, pill: null, refusal: store.refusal(door.command.id, args as never) };
    // with no dwell (interactions.json wrap.sideDwell 0) the side zone confirms the offer at once
    if (SIDE_DWELL <= 0) {
      dragging.side = { ...dragging.side, armed: true, pill: { x: at.x + PILL_OFFSET[0], y: at.y + PILL_OFFSET[1] } };
      return;
    }
    dwell = setTimeout(() => {
      dwell = null;
      if (dragging?.side?.offer !== next) return;
      dragging.side = { ...dragging.side, armed: true, pill: { x: pointerAt.x + PILL_OFFSET[0], y: pointerAt.y + PILL_OFFSET[1] } };
      redraw(pointerAt, true);
    }, SIDE_DWELL);
  };

  // Autoscroll (spec drag-autoscroll): while the pointer is within drop.autoscrollZone of the top or the bottom of a
  // scroller — the page's visible box, or the Layers tree's — once it has been inside that box beyond the zone, that
  // scroller moves each frame by up to drop.autoscrollMaxStep screen pixels, more the nearer the edge, and the
  // proposal follows what the scroll brought under the pointer.
  const autoscroll = () => {
    scrolling = 0;
    const frame = canvasFrame();
    if (dragging === null || !frame) return;
    let scrolled = false;
    const box = frame.getBoundingClientRect();
    const fromTop = pointerAt.y - box.top;
    const fromBottom = box.bottom - pointerAt.y;
    const across = pointerAt.x >= box.left && pointerAt.x <= box.right;
    if (across && fromTop > AUTOSCROLL_ZONE && fromBottom > AUTOSCROLL_ZONE) insideOnce = true;
    let step = 0;
    if (insideOnce && across && fromTop >= 0 && fromTop < AUTOSCROLL_ZONE) step = -AUTOSCROLL_MAX * (1 - fromTop / AUTOSCROLL_ZONE);
    else if (insideOnce && across && fromBottom >= 0 && fromBottom < AUTOSCROLL_ZONE) step = AUTOSCROLL_MAX * (1 - fromBottom / AUTOSCROLL_ZONE);
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
      const treeTop = pointerAt.y - treeBox.top;
      const treeBottom = treeBox.bottom - pointerAt.y;
      const overTree = pointerAt.x >= treeBox.left && pointerAt.x <= treeBox.right;
      if (overTree && treeTop > treeZone && treeBottom > treeZone) insideTreeOnce = true;
      const inBand = insideTreeOnce && overTree && ((treeTop >= 0 && treeTop < treeZone) || (treeBottom >= 0 && treeBottom < treeZone));
      if (!inBand) {
        if (treeBand !== null) clearTimeout(treeBand);
        treeBand = null;
        treeRested = false;
      } else if (treeBand === null && !treeRested) {
        treeBand = setTimeout(() => {
          treeBand = null;
          treeRested = true;
        }, TREE_DWELL);
      }
      const underRow = ROW_SELECT !== null && document.elementFromPoint(pointerAt.x, pointerAt.y)?.closest(`[data-door="${ROW_SELECT.ref}"]`) != null;
      let treeStep = 0;
      if (inBand && (!underRow || treeRested)) treeStep = treeTop < treeZone ? -AUTOSCROLL_MAX * (1 - treeTop / treeZone) : AUTOSCROLL_MAX * (1 - treeBottom / treeZone);
      if (treeStep !== 0) {
        const before = tree.scrollTop;
        tree.scrollTop += treeStep;
        if (tree.scrollTop !== before) scrolled = true;
      }
    }
    // a scroller that moved carried the page under a still pointer: the proposal is taken again there (the drag's
    // hysteresis suppresses a proposal that changed while the pointer stood still, which a scroll must not)
    if (scrolled) {
      dragging.takenAt = null;
      over(pointerAt, dragging.inserting === null || nodesUnder(frame, pointerAt).length > 0);
    }
    scrolling = requestAnimationFrame(autoscroll);
  };
  // Resting on a folded row during a drag unfolds it after layers.expandDwell (spec layers-drag, Problems in Pager 1);
  // leaving it earlier cancels the timer. The unfolding runs the dwell's door in the drag's gesture.
  const rest = (row: { readonly node: NodeId; readonly folded: boolean } | null) => {
    if (dragging === null) return;
    const folded = row !== null && row.folded ? row.node : null;
    if (folded === dragging.resting) return;
    dragging.resting = folded;
    if (unfold !== null) clearTimeout(unfold);
    unfold = null;
    if (folded === null || ROW_DWELL === null) return;
    unfold = setTimeout(() => {
      unfold = null;
      if (dragging?.resting !== folded) return;
      open?.dispatch(ROW_DWELL.command.id as CommandId, { ...ROW_DWELL.door.args, target: folded } as never);
    }, EXPAND_DWELL);
  };
  const stopDragTimers = () => {
    if (unfold !== null) clearTimeout(unfold);
    unfold = null;
    if (dwell !== null) clearTimeout(dwell);
    dwell = null;
    if (scrolling !== 0) cancelAnimationFrame(scrolling);
    scrolling = 0;
    insideOnce = false;
    insideTreeOnce = false;
    if (treeBand !== null) clearTimeout(treeBand);
    treeBand = null;
    treeRested = false;
  };

  // While a drag goes on, each pointer position proposes a drop; a new proposal replaces the pointer's own only once
  // the pointer is drag.hysteresis screen pixels from where that one was taken. A creation drag proposes a drop only
  // over the page (the canvas overlay): over the stage around it or over a panel it proposes none (spec
  // palette-drag-insert, "Hit zones").
  // whether the selection is one a free drag moves: its command's predicate holds (a lock still refuses the move,
  // which the status bar says)
  const positionedNow = () => {
    if (FREE_DRAG === null) return false;
    const why = store.refusal(FREE_DRAG.command.id as CommandId, { ...FREE_DRAG.door.args, dx: 0, dy: 0 } as never);
    return why === null || why.key !== FREE_DRAG.command.availability.refusalKey;
  };
  // A resize's travel in page px: with snap on and Ctrl not held, the dragged edges are pulled to the nearest enabled
  // target first (canvas/snapping.ts); with smart guides on, what they align with is drawn. Alt (from the centre) and
  // Shift (the aspect) keep their own meanings.
  const snappedResize = (r: NonNullable<typeof resizing>, dx: number, dy: number, suspended: boolean): Point => {
    const state = store.getState();
    const mode = snapMode(state, suspended);
    if ((!mode.apply && !mode.hint) || r.box === null) {
      snapShown.set(null);
      return { x: dx, y: dy };
    }
    const sides = r.handle.slice(r.handle.lastIndexOf('-') + 1);
    const east = sides.includes('e');
    const west = sides.includes('w');
    const south = sides.includes('s');
    const north = sides.includes('n');
    const box = { x: r.box.x + (west ? dx : 0), y: r.box.y + (north ? dy : 0), width: r.box.width + (east ? dx : west ? -dx : 0), height: r.box.height + (south ? dy : north ? -dy : 0) };
    const snapped = snapResize(state, r.node, box, sides, r.zoom, mode.apply);
    snapShown.set(mode.hint ? snapped : null);
    return { x: dx + snapped.offset.x, y: dy + snapped.offset.y };
  };
  // a free drag follows the pointer: the travel since the press, in whole page px, less what already ran; with snap on
  // and Ctrl not held, the moved box is pulled to the nearest enabled target or equal gap first (canvas/snapping.ts);
  // with smart guides on, what it aligns with and the gaps it repeats are drawn
  const moveFree = (at: Point, suspended: boolean) => {
    if (freeing === null || open === null || FREE_DRAG === null) return;
    const travel = { x: (at.x - freeing.start.x) / freeing.zoom, y: (at.y - freeing.start.y) / freeing.zoom };
    const state = store.getState();
    const mode = snapMode(state, suspended);
    const snapped = (mode.apply || mode.hint) && freeing.node !== null && freeing.box !== null ? snapMove(state, freeing.node, { ...freeing.box, x: freeing.box.x + travel.x, y: freeing.box.y + travel.y }, freeing.zoom, mode.apply) : null;
    snapShown.set(mode.hint ? snapped : null);
    const total = { x: Math.round(travel.x + (snapped?.offset.x ?? 0)), y: Math.round(travel.y + (snapped?.offset.y ?? 0)) };
    const dx = total.x - freeing.applied.x;
    const dy = total.y - freeing.applied.y;
    if (dx === 0 && dy === 0) return;
    freeing.applied = total;
    open.dispatch(FREE_DRAG.command.id as CommandId, { ...FREE_DRAG.door.args, dx, dy } as never);
  };
  const over = (at: Point, onPage: boolean) => {
    if (dragging === null) return;
    const creation = dragging.inserting !== null;
    // over a Layers row (an element drag from the canvas or from Layers, and a palette tile's creation drag, which
    // lands on a row as it lands on the canvas: the user's real-use audit, item 3.9): the row's zones decide
    const row = ROW_DROP === null ? null : rowUnder(at);
    rest(row);
    dragging.fromRow = row !== null;
    const next = row !== null ? rowDrop(store.getState().document, (type) => CONTAINERS.has(type), dragging.dragged, row.node, row.at) : creation && !onPage ? null : proposalAt(store.getState().document, dragging.dragged, at);
    const taken = JSON.stringify(next) !== JSON.stringify(dragging.base) && !(dragging.takenAt !== null && Math.hypot(at.x - dragging.takenAt.x, at.y - dragging.takenAt.y) < DRAG_HYSTERESIS);
    if (taken) {
      dragging.base = next;
      dragging.takenAt = at;
      liveDrag.propose(next);
    }
    const offered = dragging.side;
    if (row === null) offer(at, onPage);
    else dragging.side = null;
    redraw(at, creation || dragging.dragged.length > 0 || offered !== dragging.side);
    if (scrolling === 0) scrolling = requestAnimationFrame(autoscroll);
  };

  const isRoot = (node: string) => locate(store.getState().document, node as NodeId)?.parent === null;
  // A double click is the browser's own (its dblclick, after the second release, by the system's double-click time;
  // Chrome's pointerdown carries no click count, so each press is a single click): the double-click door of what it
  // lands on runs as a gesture of its own.
  const onDoubleClick = (event: MouseEvent) => {
    if (machine.phase !== 'idle' || open !== null || event.button !== 0) return;
    const press = pressAt(event, isRoot);
    if (press === null || press === 'elsewhere') return;
    const entry = clickDoor(press, 'primary', 2, modifierOf(event), factsOf(press), pickingOf(store.getState().ui));
    if (!entry) return;
    const gesture = store.gesture();
    gesture.dispatch(entry.command.id as CommandId, argsFor(entry, press, pickingOf(store.getState().ui)) as never);
    gesture.commit();
  };
  // A press the pointer owner takes first takes the focus from a field of the editor (a Layers row's name being
  // renamed, spec rename-element: leaving the field keeps its name): the field keeps what it holds as it loses the
  // focus, before the press opens its gesture and runs its door, which would otherwise end the field's work first (a
  // selection elsewhere ends a rename) or find a gesture open. The text edited in place on the page is no field of the
  // editor: the frame holds that focus, and a press outside it keeps the text through its own door.
  const leaveField = () => {
    const focused = target.document.activeElement;
    if (focused instanceof HTMLElement && (focused.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName))) focused.blur();
  };
  // The pointer a gesture holds (the user's real-use audit, A3.14): once a gesture opens (past the drag threshold), its
  // pointer is captured on the editor's root, so its moves and its release arrive wherever it goes, and while it is
  // held a move reads what lies under it on the screen. A capture lost before the release, a cancelled pointer
  // (pointercancel) and a press while a gesture is still open (a release that never arrived) end every open gesture
  // with nothing kept, so no command is ever sent through a closed gesture.
  let captured: number | null = null;
  const capture = (pointer: number) => {
    if (captured === pointer) return;
    try {
      target.document.documentElement.setPointerCapture(pointer);
      captured = pointer;
    } catch {
      // a pointer the browser no longer tracks (its button already up): there is nothing to hold
    }
  };
  const underPointer = (event: PointerEvent): EventTarget | null => (captured === event.pointerId ? target.document.elementFromPoint(event.clientX, event.clientY) : event.target);
  // the gestures of a handle (a spacing band, a guide, a rotation, a resize), the pan and the colour pick: ended, their
  // open gesture cancelled
  // a press a pointer tool took (pointer-tools.ts): its session, the pointer, the gesture open now (opened at the
  // press, opened anew at each move that runs a command) and the cancellations counted at the press (Escape,
  // drag.cancel)
  let tooling: { readonly session: ToolSession; readonly pointer: number; gesture: Gesture; readonly cancels: number } | null = null;
  const dropTool = () => {
    if (tooling === null) return;
    const { session, gesture } = tooling;
    tooling = null;
    if (open === gesture) open = null;
    session.cancel();
    gesture.cancel();
  };
  const dropHandleGestures = () => {
    dropTool();
    const opened = [spacing?.gesture, guiding?.gesture, rotating?.gesture, resizing?.gesture].filter((g): g is Gesture => g != null);
    const panned = panning !== null;
    spacing = null;
    setBanding(null);
    guiding = null;
    rotating = null;
    setResizing(null);
    resizing = null;
    panning = null;
    pickingColor = null;
    setGuideOnRuler(null);
    snapShown.set(null);
    if (panned) setPanView(spaceDown ? 'armed' : 'idle');
    for (const gesture of opened) {
      if (open === gesture) open = null;
      gesture.cancel();
    }
  };
  const onDown = (event: PointerEvent) => {
    // a press or a gesture still open here lost its release: it ends before anything new begins
    if (pointerPressing() || spacing !== null || guiding !== null || rotating !== null || resizing !== null || panning !== null || pickingColor !== null || sliding !== null || tooling !== null) onCancel();
    setPressing(true);
    setPressRegion(pressRegionOf(event.target));
    publishOutsidePress(event.target);
    // a pointer tool (the Layout Composer's stage, the motion Timeline's drags): a primary press on its surface, Space
    // not held (a pan)
    const tool = event.button === 0 && machine.phase === 'idle' && open === null && !spaceDown ? toolPress(toolPoint(event), event.target, store) : null;
    if (tool !== null) {
      event.preventDefault();
      leaveField();
      capture(event.pointerId);
      const gesture = store.gesture();
      open = gesture;
      tooling = { session: tool, pointer: event.pointerId, gesture, cancels: store.getState().ui.drag.cancels };
      return;
    }
    // a slider a field draws (A3.30): the pointer moves the thumb freely, and only the release writes
    const commit = event.button === 0 && event.target instanceof HTMLInputElement && event.target.type === 'range' ? (SLIDER_COMMITS.get(event.target) ?? null) : null;
    if (commit !== null && event.target instanceof HTMLInputElement) {
      sliding = { element: event.target, commit, pointer: event.pointerId };
      return;
    }
    // a control that repeats while held (registerRepeat): it steps now, and again while held
    const repeater = event.button === 0 && event.target instanceof Element ? event.target.closest<HTMLElement>('[data-repeat]') : null;
    const repeat = repeater === null ? undefined : REPEATS.get(repeater);
    if (repeater !== null && repeat !== undefined) {
      event.preventDefault();
      const held = modifierOf(event);
      repeat(held);
      const hold = { element: repeater, pointer: event.pointerId, timer: 0 };
      repeating = hold;
      hold.timer = window.setTimeout(() => {
        if (repeating !== hold) return;
        repeat(held);
        hold.timer = window.setInterval(() => repeat(held), REPEAT_INTERVAL);
      }, REPEAT_DELAY);
      return;
    }
    // the colour picker's area, during its session: the colour it points at, then at every move while held
    const area = session !== null && event.button === 0 && event.target instanceof Element ? event.target.closest<HTMLElement>('[data-color-area]') : null;
    if (area !== null) {
      event.preventDefault();
      pickingColor = { area, pointer: event.pointerId };
      pickColor(area, event.clientX, event.clientY);
      return;
    }
    // a handle of the Edit on canvas mode, pressed with the primary button
    const bandEl = event.button === 0 && machine.phase === 'idle' ? (chromeControl({ x: event.clientX, y: event.clientY }, '[data-canvas-overlay] [data-edit-handle]', event.target) as HTMLElement | null) : null;
    const bandEntry = bandEl ? manifest.doorByRef.get((bandEl.getAttribute('data-door') ?? '') as DoorId) : undefined;
    const bandZoom = canvasFrame()?.currentCSSZoom;
    if (bandEl && bandEntry && bandEl.getAttribute('aria-disabled') !== 'true' && bandZoom !== undefined && bandZoom > 0) {
      event.preventDefault();
      const parsed: unknown = JSON.parse(bandEl.getAttribute('data-args') ?? '{}');
      // what the handle stands for, its own name (for its arrows) aside
      const { handle: _named, ...args } = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
      void _named;
      const [nx = 0, ny = 0] = (bandEl.getAttribute('data-normal') ?? '0,0').split(',').map(Number);
      const min = bandEl.getAttribute('data-min');
      spacing = {
        entry: bandEntry,
        args,
        valueArg: bandEl.getAttribute('data-value-arg') ?? 'value',
        element: bandEl,
        start: Number(bandEl.getAttribute('data-start') ?? '0'),
        normal: [nx, ny],
        min: min === null || min === '' ? null : Number(min),
        opposite: bandEl.getAttribute('data-opposite') ?? '',
        oppositeStart: Number(bandEl.getAttribute('data-opposite-start') ?? '0'),
        sidesStart: (bandEl.getAttribute('data-sides-start') ?? '').split(',').map(Number).filter((n) => Number.isFinite(n)),
        pointer: event.pointerId,
        from: { x: event.clientX, y: event.clientY },
        zoom: bandZoom,
        shadow:
          bandEl.hasAttribute('data-shadow')
            ? { property: args.property ?? '', offset: bandEl.getAttribute('data-shadow') === SHADOW_OFFSET, x: Number(bandEl.getAttribute('data-start-x') ?? '0'), y: Number(bandEl.getAttribute('data-start-y') ?? '0') }
            : null,
        gesture: null,
        cancels: 0,
      };
      return;
    }
    // a guide, or a ruler (a new guide), pressed with the primary button
    const guideEl = event.button === 0 && machine.phase === 'idle' && event.target instanceof Element ? event.target.closest('[data-canvas-overlay] [data-guide]') : null;
    const rulerEl = event.button === 0 && machine.phase === 'idle' && event.target instanceof Element ? event.target.closest('[data-ruler]') : null;
    if (guideEl instanceof HTMLElement && GUIDE_MOVE !== null) {
      event.preventDefault();
      guideEl.focus();
      guiding = { kind: 'move', axis: guideEl.getAttribute('data-axis') ?? '', guide: guideEl.getAttribute('data-guide'), pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, gesture: null, cancels: 0 };
      return;
    }
    const rulerAxis = rulerEl?.getAttribute('data-ruler') ?? '';
    if (rulerEl && GUIDE_CREATES[rulerAxis]) {
      event.preventDefault();
      guiding = { kind: 'create', axis: rulerAxis, guide: null, pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, gesture: null, cancels: 0 };
      return;
    }
    // the rotation handle of the selection, pressed with the primary button
    const rotator = event.button === 0 && machine.phase === 'idle' ? chromeControl({ x: event.clientX, y: event.clientY }, '[data-canvas-overlay] [data-rotate-handle]', event.target) : null;
    const rotateEntry = rotator ? manifest.doorByRef.get((rotator.getAttribute('data-door') ?? '') as DoorId) : undefined;
    if (rotator && rotateEntry) {
      const state = store.getState();
      const only = state.selection.length === 1 && state.selection[0] !== undefined ? locate(state.document, state.selection[0])?.node : undefined;
      const frame = canvasFrame();
      const box = frame && only ? nodeBox(frame, only.id) : null;
      const property = rotateEntry.door.adapter.writes[0];
      if (only && box && property !== undefined) {
        event.preventDefault();
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        rotating = {
          entry: rotateEntry,
          property,
          pointer: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          centre,
          startAngle: Math.atan2(event.clientY - centre.y, event.clientX - centre.x),
          base: degreesOf(storedValue(only, property, MODEL_RULES)),
          gesture: null,
          cancels: 0
        };
        return;
      }
    }
    // a resize handle of the selection, pressed with the primary button (a handle drawn disabled — a start edge the
    // parent places, item 4.2 — takes no press: the press belongs to what lies under it)
    const grabbable = event.button === 0 && machine.phase === 'idle' ? chromeControl({ x: event.clientX, y: event.clientY }, '[data-canvas-overlay] [data-resize-handle]', event.target) : null;
    const handle = grabbable !== null && grabbable.getAttribute('aria-disabled') !== 'true' ? grabbable : null;
    const handleEntry = handle ? manifest.doorByRef.get((handle.getAttribute('data-door') ?? '') as DoorId) : undefined;
    const selected = store.getState().selection;
    const frame = canvasFrame();
    // a shape of an SVG resizes the box its geometry spans (spec elements-svg-shapes); any other element its border box
    const only = selected.length === 1 && selected[0] !== undefined ? locate(store.getState().document, selected[0])?.node : undefined;
    const shape = handleEntry && only ? shapeResizeFrom(only, geometryAttributes(MODEL_RULES, only.type, handleEntry.command.id)) : null;
    const basis = handleEntry && frame && selected.length === 1 && selected[0] !== undefined ? (shape ?? resizeBasis(frame, selected[0])) : null;
    const zoom = frame ? geometryOf(frame)?.zoom : undefined;
    // the chrome draws the handles from its last measure: right after a change (a drop that moved the element) they
    // may still stand where the element was, so a handle is taken only where the element is now
    const current = frame && selected[0] !== undefined ? nodeBox(frame, selected[0]) : null;
    if (handle && handleEntry && basis !== null && zoom !== undefined && current !== null && handleInPlace(handle, current)) {
      event.preventDefault();
      const resized = selected[0] as NodeId;
      // a medium (img, video, canvas, iframe) keeps its ratio by default and Shift releases it; any other element
      // keeps it only with Shift (A3.16)
      const media = only !== undefined && elementPredicate('media', only, MODEL_RULES) === true;
      setResizing({ node: resized, handle: handle.getAttribute('data-resize-handle') ?? '' });
      resizing = { entry: handleEntry, handle: handle.getAttribute('data-resize-handle') ?? '', pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, basis, zoom, gesture: null, cancels: 0, node: resized, box: pageLayout.box(resized), media };
      return;
    }
    // a pan: the middle button, or the primary one with Space held, on the stage
    const source = onStage(event.target) && machine.phase === 'idle' ? (event.button === 1 ? 'middle-button' : event.button === 0 && spaceDown ? 'space-held' : null) : null;
    const panEntry = source !== null ? panDrag(source) : null;
    if (panEntry !== null) {
      event.preventDefault();
      panning = { pointer: event.pointerId, last: { x: event.clientX, y: event.clientY }, moved: { x: 0, y: 0 }, entry: panEntry };
      setPanView('panning');
      return;
    }
    setPressPoint({ x: event.clientX, y: event.clientY });
    keepFocus = false;
    setGhostReturn(null);
    const press = pressAt(event, isRoot);
    if (press === null || press === 'elsewhere') return;
    if (event.button !== 0 && event.button !== 2) return;
    // a palette tile, a Layers row and a field's label take the primary button only
    if (
      (press.on === 'tile' || press.on === 'row' || press.on === 'scrub' || press.on === 'stop' || press.on === 'pad' || press.on === 'grip' || press.on === 'splitter' || press.on === 'playhead' || press.on === 'keyframe' || press.on === 'panel') &&
      event.button !== 0
    )
      return;
    leaveField();
    buttons = { button: event.button === 2 ? 'secondary' : 'primary', count: Math.min(Math.max(event.detail, 1), 2), modifier: modifierOf(event) };
    const at = { x: event.clientX, y: event.clientY };
    pointerAt = at;
    const next = step(machine, { type: 'down', pointer: event.pointerId, at, press });
    if (next.effect === 'press') pressedAt = { screen: at, page: pagePoint(at) };
    machine = next.machine;
    run(next.effect);
  };
  const onMove = (event: PointerEvent) => {
    // a repeating control stops once the pointer leaves it
    if (repeating !== null && event.pointerId === repeating.pointer && !(event.target instanceof Node && repeating.element.contains(event.target))) stopRepeating();
    if (tooling !== null) {
      if (event.pointerId !== tooling.pointer) return;
      const step = tooling.session.move(toolPoint(event));
      if (step !== null) {
        // the drag runs anew from the press: the page follows the pointer, and Escape puts everything back
        tooling.gesture.cancel();
        const gesture = store.gesture();
        open = gesture;
        tooling.gesture = gesture;
        gesture.dispatch(step.command as never, step.args as never);
      }
      return;
    }
    if (pickingColor !== null) {
      if (event.pointerId === pickingColor.pointer) pickColor(pickingColor.area, event.clientX, event.clientY);
      return;
    }
    const under = underPointer(event);
    // an application menu's button under the pointer (the open menu's backdrop covers the window: the buttons are
    // looked for by their boxes), for the menu bar's hover switch
    const menuButton = [...document.querySelectorAll<HTMLElement>('[data-region="top-bar"] [data-menu]')].find((b) => {
      const r = b.getBoundingClientRect();
      return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    });
    const menuUnder = menuButton?.getAttribute('data-menu') ?? null;
    const menuMoved = menuRestPoint !== null && Math.hypot(event.clientX - menuRestPoint.x, event.clientY - menuRestPoint.y) > MENU_HOVER_TOLERANCE;
    if (menuUnder !== menuResting || (menuUnder !== null && menuMoved)) {
      menuResting = menuUnder;
      menuRestPoint = menuUnder === null ? null : { x: event.clientX, y: event.clientY };
      if (menuDwell !== null) clearTimeout(menuDwell);
      menuDwell = null;
      if (menuUnder === null) setMenuOver(null);
      else menuDwell = setTimeout(() => setMenuOver(menuUnder), MENU_HOVER_SWITCH);
    }
    overStage = onStage(under);
    setCanvasPointer(overStage ? { x: event.clientX, y: event.clientY } : null);
    if (spacing !== null) {
      if (event.pointerId !== spacing.pointer) return;
      const dx = event.clientX - spacing.from.x;
      const dy = event.clientY - spacing.from.y;
      if (spacing.gesture === null) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        spacing.gesture = store.gesture();
        spacing.cancels = store.getState().ui.drag.cancels;
        open = spacing.gesture;
        setBanding(spacing.element.getAttribute('data-door'));
        capture(event.pointerId);
      }
      // a shadow handle: the first layer's X and Y follow the pointer, or its blur its horizontal travel
      if (spacing.shadow !== null) {
        const { property, offset, x, y } = spacing.shadow;
        const edit = offset ? { layer: 0, [SHADOW_EDITS.x]: `${Math.round(x + dx / spacing.zoom)}px`, [SHADOW_EDITS.y]: `${Math.round(y + dy / spacing.zoom)}px` } : { layer: 0, [SHADOW_EDITS.blur]: `${Math.max(0, Math.round(spacing.start + dx / spacing.zoom))}px` };
        spacing.gesture.dispatch(spacing.entry.command.id as CommandId, { ...spacing.entry.door.args, property, edit, distance: dx } as never);
        return;
      }
      const held = modifierOf(event);
      // the new value in whole CSS px (a start the page computes with decimals included)
      const travel = (dx * spacing.normal[0] + dy * spacing.normal[1]) / spacing.zoom;
      const bounded = (value: number) => (spacing?.min === null || spacing === null ? value : Math.max(spacing.min, value));
      const value = bounded(Math.round(spacing.start + travel));
      const all = held !== null && held === ALL_SIDES_KEY;
      // Shift and Alt act on a spacing band alone (the one that names its opposite side)
      const band = spacing.opposite !== '';
      // Shift adds the same displacement to the four sides (A3.15): each keeps its own start, so the band's element
      // carries them (data-sides-start, in the composite's order)
      const starts = band && all ? spacing.sidesStart : null;
      if (starts !== null && starts.length === 4 && starts.every((n) => Number.isFinite(n))) {
        const delta = value - spacing.start;
        // the side the pointer holds is written last: the status names the side the drag is on, never another one
        const dragged = spacing.args.sides ?? '';
        const order = [...SIDES.filter((side) => side !== dragged), ...SIDES.filter((side) => side === dragged)];
        for (const side of order) {
          spacing.gesture.dispatch(spacing.entry.command.id as CommandId, { ...spacing.entry.door.args, ...spacing.args, sides: side, [spacing.valueArg]: `${bounded((starts[SIDES.indexOf(side)] ?? 0) + delta)}px` } as never);
        }
        return;
      }
      spacing.gesture.dispatch(spacing.entry.command.id as CommandId, { ...spacing.entry.door.args, ...spacing.args, [spacing.valueArg]: `${value}px` } as never);
      if (band && !all && held !== null && held === OPPOSITE_KEY) {
        spacing.gesture.dispatch(spacing.entry.command.id as CommandId, { ...spacing.entry.door.args, ...spacing.args, sides: spacing.opposite, [spacing.valueArg]: `${bounded(Math.round(spacing.oppositeStart + (value - spacing.start)))}px` } as never);
      }
      return;
    }
    if (guiding !== null) {
      if (event.pointerId !== guiding.pointer) return;
      const frame = canvasFrame();
      const g = frame ? geometryOf(frame) : null;
      if (g === null) return;
      if (guiding.gesture === null) {
        if (Math.hypot(event.clientX - guiding.start.x, event.clientY - guiding.start.y) < DRAG_THRESHOLD) return;
        guiding.gesture = store.gesture();
        guiding.cancels = store.getState().ui.drag.cancels;
        open = guiding.gesture;
        capture(event.pointerId);
      }
      // over its own ruler, or past it (the pointer carried out of the canvas beyond the ruler: the person throws the
      // guide away; it stuck at 0 before — the dogfooding pass)
      const ownRuler = document.querySelector(`[data-ruler="${guiding.axis}"]`)?.getBoundingClientRect() ?? null;
      const pastRuler = ownRuler !== null && (guiding.axis === 'horizontal' ? event.clientY <= ownRuler.bottom : event.clientX <= ownRuler.right);
      const onOwnRuler = pastRuler || document.elementFromPoint(event.clientX, event.clientY)?.closest(`[data-ruler="${guiding.axis}"]`) != null;
      setGuideOnRuler(onOwnRuler ? guiding.axis : null);
      if (onOwnRuler) return;
      const point = screenToPage({ x: event.clientX, y: event.clientY }, g);
      const at = Math.max(0, Math.round(guiding.axis === 'horizontal' ? point.y : point.x));
      const create = GUIDE_CREATES[guiding.axis];
      if (guiding.guide === null && create) {
        guiding.gesture.dispatch(create.command.id as CommandId, { ...create.door.args, axis: guiding.axis, at } as never);
        guiding.guide = [...guidesOf(store.getState().document)].reverse().find((guide) => guide.axis === guiding?.axis)?.id ?? null;
      } else if (guiding.guide !== null && GUIDE_MOVE !== null) guiding.gesture.dispatch(GUIDE_MOVE.command.id as CommandId, { ...GUIDE_MOVE.door.args, guide: guiding.guide, at } as never);
      return;
    }
    if (rotating !== null) {
      if (event.pointerId !== rotating.pointer) return;
      if (rotating.gesture === null) {
        if (Math.hypot(event.clientX - rotating.start.x, event.clientY - rotating.start.y) < DRAG_THRESHOLD) return;
        rotating.gesture = store.gesture();
        rotating.cancels = store.getState().ui.drag.cancels;
        open = rotating.gesture;
        capture(event.pointerId);
      }
      const turned = folded(rotating.base + ((Math.atan2(event.clientY - rotating.centre.y, event.clientX - rotating.centre.x) - rotating.startAngle) * 180) / Math.PI);
      const angle = event.shiftKey ? Math.round(turned / ROTATE_SNAP) * ROTATE_SNAP : Math.round(turned);
      rotating.gesture.dispatch(rotating.entry.command.id as CommandId, { ...rotating.entry.door.args, property: rotating.property, value: `${angle}deg` } as never);
      return;
    }
    if (resizing !== null) {
      if (event.pointerId !== resizing.pointer) return;
      const dx = event.clientX - resizing.start.x;
      const dy = event.clientY - resizing.start.y;
      if (resizing.gesture === null) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        resizing.gesture = store.gesture();
        resizing.cancels = store.getState().ui.drag.cancels;
        open = resizing.gesture;
        capture(event.pointerId);
      }
      const travel = snappedResize(resizing, dx / resizing.zoom, dy / resizing.zoom, event.ctrlKey);
      const values = resizedBox(resizing.basis, resizing.handle, travel.x, travel.y, { aspect: resizing.media ? !event.shiftKey : event.shiftKey, centre: event.altKey }, RESIZE_MIN);
      const { marginLeft, marginTop, ...rest } = values;
      const named: Record<string, string | undefined> = { ...rest };
      if (marginLeft !== undefined) named[MARGIN_ARGS.marginLeft] = marginLeft;
      if (marginTop !== undefined) named[MARGIN_ARGS.marginTop] = marginTop;
      const given = Object.fromEntries(Object.entries(named).filter(([, value]) => value !== undefined));
      resizing.gesture.dispatch(resizing.entry.command.id as CommandId, { ...resizing.entry.door.args, ...given } as never);
      return;
    }
    if (panning !== null) {
      if (event.pointerId !== panning.pointer) return;
      const dx = event.clientX - panning.last.x;
      const dy = event.clientY - panning.last.y;
      panning.last = { x: event.clientX, y: event.clientY };
      if (dx === 0 && dy === 0) return;
      capture(event.pointerId);
      panning.moved = { x: panning.moved.x + dx, y: panning.moved.y + dy };
      dispatchPan(panning.entry, { dx, dy });
      return;
    }
    const press = pressAt(event, isRoot, under);
    setHovered(machine.phase === 'idle' && press !== null && press !== 'elsewhere' && press.on === 'node' ? press.node : null);
    const at = { x: event.clientX, y: event.clientY };
    const next = step(machine, { type: 'move', pointer: event.pointerId, at });
    if (machine.phase === 'idle' || event.pointerId === machine.pointer) pointerAt = at;
    machine = next.machine;
    run(next.effect);
    // a scrub follows every move of its pointer, from the press on (no threshold)
    if (scrubbing !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) scrub(at, modifierOf(event));
    // a gradient stop follows every move of its pointer, from the press on
    if (stopping !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) moveStop(at);
    // the timeline's playhead and a keyframe's marker follow every move of their pointer (specs timeline-preview,
    // timeline-keyframes)
    if (playheading !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) movePlayhead(at);
    if (keyframing !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) moveKeyframe(at);
    // a shadow's light follows every move of its pointer, from the press on
    if (lighting !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) moveLight(at);
    // a shadow's layer row follows the pointer too (A3.34)
    if (layering !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) moveLayer(at);
    // a row of the Explorer's tree marks the folder the pointer is over (spec explorer-file-system)
    if (exploring !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) moveExplorer(at);
    // a column of the Data panel marks the element's part the pointer is over (spec content-data)
    if (columning !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) moveColumn(at);
    // the quick panel follows every move of its pointer, from the press on
    if (gripping !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) moveGrip(at);
    // a splitter follows every move of its pointer, from the press on (no threshold)
    if (splitting !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) resize(at);
    // a dragged panel's hint follows every move of its pointer (spec floating-panels)
    if (panelling !== null && machine.phase !== 'idle' && event.pointerId === machine.pointer) movePanelHint(at);
    // the gesture's drag in progress, if any: the marquee's band, or the drop proposal of an element or a tile (over
    // the page: the canvas overlay is what the pointer is on)
    if (machine.phase === 'dragging' && event.pointerId === machine.pointer) {
      capture(event.pointerId);
      drawMarquee(at);
      moveFree(at, event.ctrlKey);
      over(at, press !== null && press !== 'elsewhere' && press.on === 'node');
    }
  };
  const onUp = (event: PointerEvent) => {
    setPressing(false);
    if (event.pointerId === captured) captured = null;
    // the key held at the release: the duplicate's (spec drag-duplicate)
    releaseModifier = modifierOf(event);
    if (repeating !== null && event.pointerId === repeating.pointer) {
      stopRepeating();
      return;
    }
    // a slider's release: what it was left on, written once through the field's own commit (A3.30)
    if (sliding !== null) {
      if (event.pointerId !== sliding.pointer) return;
      const { element, commit } = sliding;
      sliding = null;
      if (element.isConnected) commit(element.value);
      return;
    }
    if (pickingColor !== null) {
      if (event.pointerId === pickingColor.pointer) pickingColor = null;
      return;
    }
    // a pointer tool's release: what it means runs through the gesture open now, one undo step
    if (tooling !== null) {
      if (event.pointerId !== tooling.pointer) return;
      const { session, gesture } = tooling;
      tooling = null;
      if (open === gesture) open = null;
      session.release(toolPoint(event), gesture);
      gesture.commit();
      return;
    }
    if (spacing !== null) {
      if (event.pointerId !== spacing.pointer) return;
      const { gesture, entry, opposite, element } = spacing;
      spacing = null;
      setBanding(null);
      if (gesture !== null) {
        open = null;
        gesture.commit();
        return;
      }
      // a band pressed and released without a drag: its typed field; any other handle: the focus, for its arrows
      if (opposite !== '') typedBand.open(entry.ref);
      else element.focus();
      return;
    }
    if (guiding !== null) {
      if (event.pointerId !== guiding.pointer) return;
      const { gesture, kind, guide } = guiding;
      const dropped = guideOverRuler.get() !== null;
      guiding = null;
      setGuideOnRuler(null);
      if (gesture === null) return;
      open = null;
      // over its own ruler: a new guide is not made, a moved one is deleted
      if (dropped && kind === 'create') {
        gesture.cancel();
        return;
      }
      if (dropped && guide !== null && GUIDE_DELETE !== null) gesture.dispatch(GUIDE_DELETE.command.id as CommandId, { ...GUIDE_DELETE.door.args, guide } as never);
      gesture.commit();
      return;
    }
    if (rotating !== null) {
      if (event.pointerId !== rotating.pointer) return;
      const { gesture } = rotating;
      rotating = null;
      if (gesture !== null) {
        open = null;
        gesture.commit();
      }
      return;
    }
    if (resizing !== null) {
      if (event.pointerId !== resizing.pointer) return;
      const { gesture, start } = resizing;
      setResizing(null);
      resizing = null;
      snapShown.set(null);
      if (gesture !== null) {
        open = null;
        gesture.commit();
        return;
      }
      // a handle pressed and released without a drag is a click on what lies under it (a neighbour the handle, drawn
      // outside its element, covers): the press and the release run as they would have there
      const frame = canvasFrame();
      const hit = frame ? nodeAt(frame, start) : null;
      if (hit === null) return;
      leaveField();
      buttons = { button: 'primary', count: 1, modifier: modifierOf(event) };
      pointerAt = start;
      const down = step(machine, { type: 'down', pointer: event.pointerId, at: start, press: { on: 'node', node: hit.node, root: hit.root } });
      if (down.effect === 'press') pressedAt = { screen: start, page: pagePoint(start) };
      machine = down.machine;
      run(down.effect);
      const up = step(machine, { type: 'up', pointer: event.pointerId });
      machine = up.machine;
      run(up.effect);
      return;
    }
    if (panning !== null) {
      if (event.pointerId !== panning.pointer) return;
      panning = null;
      setPanView(spaceDown ? 'armed' : 'idle');
      return;
    }
    const next = step(machine, { type: 'up', pointer: event.pointerId });
    machine = next.machine;
    run(next.effect);
  };
  const onCancel = () => {
    setPressing(false);
    captured = null;
    sliding = null;
    stopRepeating();
    dropHandleGestures();
    const next = step(machine, { type: 'cancel' });
    machine = next.machine;
    run(next.effect);
    setHovered(null);
  };
  // the capture lost while the button is still down (the pointer taken away): as a cancelled pointer
  const onLostCapture = (event: PointerEvent) => {
    if (event.pointerId !== captured) return;
    captured = null;
    if (pointerPressing()) onCancel();
  };
  // While a press on the canvas is held, the browser neither selects the editor's text nor starts its own drag and
  // drop of it: a native drag would take the pointer away (pointercancel) and end the gesture.
  const onNative = (event: Event) => {
    if (machine.phase !== 'idle') event.preventDefault();
  };

  const onContextMenu = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest(EDITOR_MENU_AREA)) event.preventDefault();
  };
  // A secondary press there moves no focus: the context menu it opens takes the focus at once, and the press would
  // otherwise hand it to the page body right after. Nor does a press on the text edited in place, or on the text
  // toolbar while it is edited: the focus, and the text selection, stay in the text.
  const onMouseDown = (event: MouseEvent) => {
    // the middle button on the stage pans; the browser's own autoscroll does not start
    if (event.button === 1 && onStage(event.target)) event.preventDefault();
    const keep = keepFocus;
    keepFocus = false;
    const toolbar = editedNode(store.getState()) !== null && onTextToolbar(event.target);
    if (keep || toolbar || onOwnOption(event.target) || (event.button === 2 && event.target instanceof Element && event.target.closest(EDITOR_MENU_AREA))) event.preventDefault();
  };

  // A drag Escape cancelled ends its gesture at once, its button still down: the drag and what it would do at the
  // release (its drop, a tile's click or insertion) are dropped, and the machine is idle, so the release that follows
  // does nothing. What the press itself did stays (the element it selected: spec drag-level-keys-escape, the selection
  // after Escape is the dragged element); a marquee's band is its own selection, and goes back to the selection held
  // before the press (spec marquee-select). A creation drag's ghost goes back to the tile it came from.
  const endCancelled = () => {
    // a marquee's band and a scrub's values go back to what they were before the press; any other drag keeps what its
    // press did. A dragged panel is let go of too (spec floating-panels: Escape cancels the drag and the panel stays
    // where it was), and a dragged panel's press moved nothing, so cancelling is what leaves it where it was.
    const effect: Effect =
      marquee !== null || scrubbing !== null || stopping !== null || lighting !== null || gripping !== null || exploring !== null || columning !== null || playheading !== null || keyframing !== null || panelling !== null
        ? 'cancel'
        : 'commit';
    stopDragTimers();
    if (dragging?.inserting != null && pressedAt !== null) setGhostReturn({ inserting: dragging.inserting, from: pointerAt, to: pressedAt.screen });
    dragging = null;
    pressed = null;
    machine = IDLE;
    run(effect);
  };

  // The keys of the drag (drag-session.ts) change the editor state while the gesture is open: a level key's new level
  // is redrawn at once; drag.cancel records a cancellation, and one newer than the open gesture ends it (once the
  // dispatch that recorded it has returned).
  // the picker's session follows the picker: opened with it, committed or cancelled as it closes
  let pickerClosings = store.getState().ui.colorPickerClosed.count;
  let pickerCancels = store.getState().ui.drag.cancels;
  sessionDispatch = (id, args) => {
    const through = session ?? null;
    return through !== null ? through.dispatch(id as never, args as never) : (store.dispatch as (i: CommandId, a: unknown) => DispatchResult)(id, args);
  };
  const followPicker = () => {
    const ui = store.getState().ui;
    if (ui.colorPicker !== null && session === null && open === null) {
      session = store.gesture();
      open = session;
      pickerCancels = ui.drag.cancels;
      pickerClosings = ui.colorPickerClosed.count;
      return;
    }
    if (session === null) return;
    const ended = ui.colorPickerClosed.count !== pickerClosings;
    const escaped = ui.drag.cancels !== pickerCancels;
    if (!ended && !escaped) return;
    pickerClosings = ui.colorPickerClosed.count;
    const closing = session;
    session = null;
    open = null;
    const applied = ended && ui.colorPickerClosed.applied;
    pendingPickerEnd = () => {
      // Escape ended the session: the picker closes too, inside it, so that nothing opens a session again
      if (escaped && store.getState().ui.colorPicker !== null) closing.dispatch(CANCEL_PICKER as never, {} as never);
      if (applied) closing.commit();
      else closing.cancel();
    };
    queueMicrotask(finishPickerSession);
  };
  const stopPicker = store.subscribe(followPicker);
  const stopListening = store.subscribe(() => {
    if (session !== null) return;
    // Escape during a pointer tool's press (drag.cancel): nothing it did is kept
    if (tooling !== null && store.getState().ui.drag.cancels !== tooling.cancels) {
      queueMicrotask(dropTool);
      return;
    }
    // Escape during a band's drag (drag.cancel): the side goes back to where it was
    if (spacing?.gesture != null && store.getState().ui.drag.cancels !== spacing.cancels) {
      const cancelled = spacing.gesture;
      spacing = null;
      setBanding(null);
      open = null;
      queueMicrotask(() => cancelled.cancel());
      return;
    }
    // Escape during a guide drag (drag.cancel): a new guide is not made, a moved one goes back
    if (guiding?.gesture != null && store.getState().ui.drag.cancels !== guiding.cancels) {
      const cancelled = guiding.gesture;
      guiding = null;
      setGuideOnRuler(null);
      open = null;
      queueMicrotask(() => cancelled.cancel());
      return;
    }
    // Escape during a rotation (drag.cancel): the angle goes back to where it was
    if (rotating?.gesture != null && store.getState().ui.drag.cancels !== rotating.cancels) {
      const cancelled = rotating.gesture;
      rotating = null;
      open = null;
      queueMicrotask(() => cancelled.cancel());
      return;
    }
    // Escape during a resize (drag.cancel, a newer cancellation): the size goes back to where it was
    if (resizing?.gesture != null && store.getState().ui.drag.cancels !== resizing.cancels) {
      const cancelled = resizing.gesture;
      resizing = null;
      snapShown.set(null);
      open = null;
      queueMicrotask(() => cancelled.cancel());
      return;
    }
    if (open === null) return;
    if (store.getState().ui.drag.cancels === cancelsAtOpen) {
      redraw(pointerAt, false);
      return;
    }
    const cancelled = open;
    queueMicrotask(() => {
      if (open === cancelled) endCancelled();
    });
  });

  // the pan's and the wheel's doors, run through the store
  const dispatchPan = (entry: DoorEntry, args: Readonly<Record<string, unknown>>) => {
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, ...args });
  };
  panDispatch = dispatchPan;
  const onWheel = (event: WheelEvent) => {
    if (!onStage(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey ? 'Ctrl' : event.shiftKey ? 'Shift' : null;
    const entry = WHEEL_DOORS.find((d) => d.door.kind === 'canvas-wheel' && d.door.modifier === modifier);
    if (!entry) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? target.innerHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    if ('factor' in entry.command.args) dispatchPan(entry, { factor: Math.exp(-dy * WHEEL_FACTOR), point: { x: event.clientX, y: event.clientY } });
    else if (modifier === 'Shift') dispatchPan(entry, { dx: -(dx !== 0 ? dx : dy), dy: 0 });
    else dispatchPan(entry, { dx: -dx, dy: -dy });
  };
  target.addEventListener('wheel', onWheel, { passive: false, capture: true });
  target.addEventListener('pointerdown', onDown, true);
  target.addEventListener('dblclick', onDoubleClick, true);
  target.addEventListener('pointermove', onMove, true);
  target.addEventListener('pointerup', onUp, true);
  target.addEventListener('pointercancel', onCancel, true);
  target.addEventListener('lostpointercapture', onLostCapture, true);
  target.addEventListener('contextmenu', onContextMenu, true);
  target.addEventListener('mousedown', onMouseDown, true);
  target.addEventListener('blur', onCancel);
  target.addEventListener('selectstart', onNative, true);
  target.addEventListener('dragstart', onNative, true);
  return () => {
    stopListening();
    stopPicker();
    sessionDispatch = null;
    finishPickerSession();
    onCancel();
    panDispatch = null;
    // the window's own transient state goes with the owner: a test that unmounts in the middle of a pan or with Space
    // held leaves nothing behind for the next editor installed over it
    panning = null;
    spaceDown = false;
    overStage = false;
    if (menuDwell !== null) clearTimeout(menuDwell);
    menuDwell = null;
    menuResting = null;
    setPanView('idle');
    // the document is free again: another editor (a new document, a test that unmounts and mounts) may take the pointer
    if (pointerOwner === store) pointerOwner = null;
    target.removeEventListener('wheel', onWheel, { capture: true });
    target.removeEventListener('pointerdown', onDown, true);
    target.removeEventListener('dblclick', onDoubleClick, true);
    target.removeEventListener('pointermove', onMove, true);
    target.removeEventListener('pointerup', onUp, true);
    target.removeEventListener('pointercancel', onCancel, true);
    target.removeEventListener('lostpointercapture', onLostCapture, true);
    target.removeEventListener('contextmenu', onContextMenu, true);
    target.removeEventListener('mousedown', onMouseDown, true);
    target.removeEventListener('blur', onCancel);
    target.removeEventListener('selectstart', onNative, true);
    target.removeEventListener('dragstart', onNative, true);
  };
}

// The OS file drop (the frame's own window included) lives in input/file-drop.ts, re-exported here as its entry.
export { installOsFileDrop } from './file-drop.ts';

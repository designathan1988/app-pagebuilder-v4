// What the pointer owner's parts share (plan I.12: installPointer split into its parts): the doors and the constants
// they read from the manifest, the state of an editor that outlives a gesture (the pan, the open gesture, the colour
// picker's session), the helpers the rest of the editor calls (holdSpace, afterGesture, registerSlider…), and how a
// press is read (pressAt).
import { isFeatureBuilt } from '../../../core/commands/registry.ts';
import type { DispatchResult, Gesture } from '../../../core/store/store.ts';
import type { CommandId, DoorId, FeatureId, KeyContextId } from '../../../generated/ids.ts';
import { manifest, numberConstant, pairConstant, type DoorEntry } from '../../../manifest/runtime.ts';
import { canvasFrame, capturedNodeAt, nodeAt, type Point } from '../../canvas/coordinates.ts';
import { PANELS, type Panel } from '../../workspace/panel-catalogue.ts';
import type { DropProposal } from '../../drag/drop.ts';
import type { EditorStore } from '../../store.ts';
import type { EditorUi } from '../../state.ts';
import { TEXT_TOOLBAR } from '../../canvas/text-edit.ts';
import { pickingTarget } from '../../inspector/pick-target.ts';
import { motionPicking } from '../../motion/state.ts';
import type { Press } from './machine.ts';
import { modifierOf, type Picking } from './press.ts';
import { CONTAINERS, layersDrag, ROW_DROP, ROW_SELECT } from '../drop-proposals.ts';
import { pointerViews, type Inserting, type PressRegion } from './views.ts';

// a shadow handle that moves the offset (canvas/edit-handles.tsx data-shadow)
export const SHADOW_OFFSET = 'offset';

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
export const MARQUEE = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === 'empty-area') ?? null;
export const MARQUEE_ELEMENT = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === 'element') ?? null;
// the element types that hold children, and the Layers row's tables: measured with the drops (input/drop-proposals.ts)
export function marqueeMode(entry: DoorEntry, press: Press, modifier: string | null, node: { readonly type: string; readonly children: readonly unknown[] } | null): string | null {
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
export const leavesNow = (altHeld: () => boolean): boolean => LEAVES_KEY === 'Alt' && altHeld();

// Whether the key that duplicates a drag is held, once the duplicate by dragging is built (spec drag-duplicate): the
// drop label and the status bar say "Duplicate" then.
export function duplicating(store: EditorStore): { readonly get: () => boolean; readonly subscribe: (listener: () => void) => () => void } {
  const { altHeld, measuring } = pointerViews(store);
  return { get: () => DUPLICATE_DRAG !== null && DUPLICATE_KEY === 'Alt' && altHeld(), subscribe: measuring.subscribe };
}

// The browser's own menu never opens where the editor's opens (spec context-menu, Problems in Pager 5): on the canvas
// (the overlay and the stage) and over the editor's context menu and its backdrop, which a secondary press on the
// canvas draws before the browser asks for its menu at the release.
export const EDITOR_MENU_AREA ='[data-canvas-overlay], [data-canvas-stage], [data-context-menu]';

// The canvas-drag doors a press on an element starts (specs drag-reorder-canvas, drag-drop-inside): the door of the
// zone a drop proposal falls in, found by its data: "before-after" beside a sibling, "inside" into a container (a
// refused proposal, over the dragged nodes' own subtree, is one inside them). The gesture's own modifiers
// (interactions.json) are the only keys a drag press may hold: an element drag holds none.
export const ELEMENT_DRAGS = manifest.doors.filter((d) => d.door.kind === 'canvas-drag' && d.door.source === 'canvas-element');
// The free drag of positioned elements (spec absolute-free-drag): the canvas-drag door whose source is a positioned
// element, once its feature is built. A drag of a selection whose elements are all absolute or fixed (its command's
// predicate) moves them freely instead of proposing a place in the flow: each move runs the door's command with the
// travel since the last one, in page px (screen px divided by the zoom, whole px), inside the press's gesture.
export const FREE_DRAG = manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === 'positioned-element' && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
const zoneDoor = (zone: string) => ELEMENT_DRAGS.find((d) => d.door.kind === 'canvas-drag' && d.door.zone === zone) ?? null;
const REORDER = zoneDoor('before-after');
const INTO = zoneDoor('inside');
export const dropDoor = (proposal: DropProposal) => (proposal.placement === 'inside' ? INTO : REORDER);
// The duplicate by dragging (spec drag-duplicate): the element drag door whose gesture holds a key for the whole drag
// ("held-duplicates", interactions.json), once its feature is built; the release then runs its command (the duplicate
// of the selection) and the move of the copies through the door of the place drawn, in the drag's one gesture.
const DUPLICATE_GESTURE = manifest.interactions.gestures.find((g) => g.modifiers.some((m) => m.meaning === 'held-duplicates'));
export const DUPLICATE_KEY = DUPLICATE_GESTURE?.modifiers.find((m) => m.meaning === 'held-duplicates')?.key ?? null;
export const DUPLICATE_DRAG = ELEMENT_DRAGS.find((d) => d.door.kind === 'canvas-drag' && d.door.gesture === DUPLICATE_GESTURE?.id && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
// the keys a drag press may hold: its gestures' own (the duplicate's Alt)
export const DRAG_MODIFIERS = new Set(manifest.interactions.gestures.filter((g) => ELEMENT_DRAGS.some((d) => d.door.kind === 'canvas-drag' && d.door.gesture === g.id && (d === DUPLICATE_DRAG || d === REORDER))).flatMap((g) => g.modifiers.map((m) => m.key)));
// The drag keys that are no click's, alone: a key the click gesture also names (Shift adds to the selection, Ctrl
// toggles it) belongs to the click too, so it must reach the click's door — Shift still means wrap-vertical on a drop,
// which the drag branch reads for itself. Without this, a drag gesture that claims Shift (the side drop's wrap) made
// every Shift+click a plain select: the person's selection was replaced instead of added to.
const CLICK_KEYS = new Set((manifest.interactions.gestures.find((g) => g.id === 'canvas-click')?.modifiers ?? []).map((m) => m.key));
export const DRAG_ONLY_MODIFIERS = new Set([...DRAG_MODIFIERS].filter((key) => !CLICK_KEYS.has(key)));

// The creation drags of tiles (specs palette-drag-insert, reusable-components): the canvas-drag doors of the
// palette-drag gesture that drop on a proposal, one per command (a palette tile's element.insert, a component tile's
// components.insertInstance), and the tiles they start from, that command's doors drawn as items (their clicks insert
// at the selection). A drag runs once its feature is registered as built in the feature table (src/app/features.ts);
// until then a tile's press is the tile's own click.
const TILE_DRAGS = manifest.doors.filter((d) => d.door.kind === 'canvas-drag' && d.door.gesture === 'palette-drag' && d.door.zone === 'drop-proposal');
// The dwell that unfolds a folded row, once its feature is built (the row's own click and drop doors are measured
// with the drops, input/drop-proposals.ts).
export const ROW_DWELL = layersDrag('collapsed-row-dwell');
// the confirmed side drop's pill: where it is drawn from the pointer, and how near it the pointer keeps the offer
export const PILL_OFFSET = pairConstant('wrap.pillOffset');
export const PILL_FREEZE = numberConstant('wrap.pillFreeze');
// a pointer resting this long on another application menu's button opens it while one is open (spec app-menu)
export const MENU_HOVER_SWITCH = numberConstant('menus.hoverSwitch');
export const MENU_HOVER_TOLERANCE = numberConstant('menus.hoverTolerance');
// autoscroll (spec drag-layout, row 8): the band along the page's visible edges, and the most it scrolls a frame
export const AUTOSCROLL_ZONE = numberConstant('drop.autoscrollZone');
export const AUTOSCROLL_MAX = numberConstant('drop.autoscrollMaxStep');
// the Layers tree's band: at most this share of the tree's height, and over a row only after a rest in it (LA1)
export const TREE_SHARE = numberConstant('drop.autoscrollTreeShare');
export const TREE_DWELL = numberConstant('drop.autoscrollTreeDwell');
export const EXPAND_DWELL = numberConstant('layers.expandDwell');

// The view's wheel and pan (spec zoom-wheel-pan): over the stage, the wheel runs its door by the modifier held (Ctrl
// zooms around the pointer by exp(-deltaY × zoom.wheelFactor), Shift pans across, none pans down); a drag with Space
// held, or with the middle button, pans by the pointer's travel, and Escape during it puts the view back. Space is
// the keymap's key: it tells this owner when Space goes down or up (holdSpace), and the stage shows a grab cursor
// while Space is held over it (panState).
export const WHEEL_DOORS = manifest.doors.filter((d) => d.door.kind === 'canvas-wheel');
// A resize handle's drag (spec resize-handles): the chrome draws the handles of the resize gesture's doors on the one
// selected element; a press on one, moved past the drag threshold, opens a gesture whose geometry.resize runs on every
// move with the size the travel gives (the page shows it live, the history keeps one step), Shift keeping the ratio and
// Alt resizing from the centre as the move reads them; the release commits it and Escape (drag.cancel) drops it.
export const RESIZE_MIN = numberConstant('resize.minBox');
// The rotation handle (spec rotation-handle): its drag writes the property its door writes (rotate) as the pointer's
// angle around the element's centre, from the angle it held, in whole degrees; Shift snaps it to rotate.snapStep.
export const ROTATE_SNAP = numberConstant('rotate.snapStep');
// The guide drags (spec guides-manual): out of a ruler (data-ruler: the axis of the guides it makes) a new guide, once
// the pointer has moved past drag.threshold; a guide (data-guide) moved over the page; either released over its own
// ruler is no guide: a new one is not made, a moved one is deleted, through the door of that zone. One gesture each.
const guideDoor = (source: string, zone: string) => manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.source === source && d.door.zone === zone && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
export const GUIDE_CREATES: Readonly<Record<string, DoorEntry | null>> = { horizontal: guideDoor('top-ruler', 'page'), vertical: guideDoor('left-ruler', 'page') };
export const GUIDE_MOVE = guideDoor('guide', 'page');
export const GUIDE_DELETE = guideDoor('guide', 'own-ruler');
// an angle as degrees: deg, rad, grad or turn, else none
export function degreesOf(value: string | undefined): number {
  const match = value === undefined ? null : /^(-?\d*\.?\d+)(deg|rad|grad|turn)$/.exec(value.trim());
  if (match === null) return 0;
  const n = Number(match[1]);
  const per: Readonly<Record<string, number>> = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };
  return n * (per[match[2] ?? ''] ?? 1);
}
// an angle folded into -180 to 180 degrees
export const folded = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;
// An Edit on canvas handle's drag (spec spacing-handles, radius-border-gap-handles): the chrome draws the handles of
// the mode (canvas/edit-handles.tsx), each saying what its drag starts from, which way on the screen grows it and which
// argument of its command the value goes in; a press on one, moved past the drag threshold, opens a gesture whose
// command runs on every move with the new value (its start plus the travel along its normal ÷ the zoom, whole CSS px,
// never below its minimum); for a spacing band Shift writes all four sides and Alt the opposite side by the same amount
// (the gesture spacing-band of interactions.json). The release commits it, one undo step, and Escape (drag.cancel)
// drops it. A spacing band pressed and released without a drag opens its typed field (canvas/band-typing.ts); any other
// handle takes the focus, for its arrows (handle.step).
export interface SpacingDrag {
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
export const ALL_SIDES_KEY = MODIFIER_MEANINGS.get('change-all-four-sides');
export const OPPOSITE_KEY = MODIFIER_MEANINGS.get('change-opposite-side');
// Whether a drawn handle stands on its corner or edge centre of the element's box now (screen px, within a pixel): its
// hit area lies outside the box on its sides, so its anchor is its edge next to the box, or its middle across. A handle
// the chrome slid inside the element — its hit area kept out of a neighbour's box (canvas/chrome.tsx, handleHitBox) —
// touches the edge line with the far side of its box instead, so each side is looked for on both of the handle's own
// sides; its middle across the edge stays where it belongs.
export function handleInPlace(handle: Element, box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): boolean {
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
export function chromeControl(at: Point, selector: string, target: EventTarget | null): Element | null {
  const direct = target instanceof Element ? target.closest(selector) : null;
  if (direct !== null) return direct;
  // a press on a control of the editor's own — a drawn door, an anchor tab among them — is that control's, never one
  // of the chrome's handles drawn over the same point (a tab stands beside the edge its handle sits on)
  if (target instanceof Element && target.closest('[data-door]') !== null) return null;
  // a press on an element's label is the label's (it selects and drags the element it names): the label touches its
  // element and may lie over a faint band along its edge, drawn under it (canvas.css; the user's review of 2026-10-05)
  if (target instanceof Element && target.closest('[data-canvas-overlay] [data-label-for]') !== null) return null;
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
export const WHEEL_FACTOR = numberConstant('zoom.wheelFactor');
// a wheel's line (deltaMode 1) in screen px, as the spec measured it
export const WHEEL_LINE = 16;
export const panDrag = (source: string): DoorEntry | null => PAN_DRAGS.find((d) => d.door.kind === 'canvas-drag' && d.door.source === source) ?? null;
export const onStage = (target: EventTarget | null): boolean => target instanceof Element && target.closest('[data-canvas-stage]') !== null;
// the region a press went down in, by the keys it gives the canvas (jornada03 J2; views.ts PressRegion): the page in
// the frame (another document) or the stage is the canvas, the Layers tree its own, anything else elsewhere
export function pressRegionOf(target: EventTarget | null): PressRegion {
  const element = target !== null && typeof (target as Element).closest === 'function' ? (target as Element) : null;
  if (element === null) return 'elsewhere';
  if (element.ownerDocument !== document) return 'canvas';
  if (element.closest('[data-key-context="layers-tree"]') !== null) return 'layers';
  return element.closest('[data-key-context="canvas"]') !== null ? 'canvas' : 'elsewhere';
}
// The pointer state of one editor that outlives a gesture (the plan's T7: one per editor, by its store, never shared):
// the pan (Space held, the pointer over the stage, the pan going on and the door it runs), the gesture open now, and
// the colour picker's session with what ends it.
export interface PointerShared {
  spaceDown: boolean;
  overStage: boolean;
  panning: { pointer: number; last: Point; moved: Point; entry: DoorEntry } | null;
  panDispatch: ((entry: DoorEntry, args: Readonly<Record<string, unknown>>) => void) | null;
  open: Gesture | null;
  session: Gesture | null;
  sessionDispatch: ((id: CommandId, args: unknown) => DispatchResult) | null;
  pendingPickerEnd: (() => void) | null;
}
const SHARED = new WeakMap<EditorStore, PointerShared>();
export function sharedOf(store: EditorStore): PointerShared {
  let shared = SHARED.get(store);
  if (shared === undefined) {
    shared = { spaceDown: false, overStage: false, panning: null, panDispatch: null, open: null, session: null, sessionDispatch: null, pendingPickerEnd: null };
    SHARED.set(store, shared);
  }
  return shared;
}
// Space went down or up (the keymap, which owns the keys): held over the stage it arms the pan; true when it did
export function holdSpace(store: EditorStore, down: boolean): boolean {
  const shared = sharedOf(store);
  const { setPanView } = pointerViews(store);
  if (!down) {
    shared.spaceDown = false;
    if (shared.panning === null) setPanView('idle');
    return false;
  }
  if (!shared.overStage && shared.panning === null) return false;
  shared.spaceDown = true;
  if (shared.panning === null) setPanView('armed');
  return true;
}
// Escape during a pan puts the view back where the pan began; true when a pan was cancelled
export function cancelPan(store: EditorStore): boolean {
  const shared = sharedOf(store);
  const { setPanView } = pointerViews(store);
  if (shared.panning === null) return false;
  const { entry, moved } = shared.panning;
  shared.panning = null;
  if (moved.x !== 0 || moved.y !== 0) shared.panDispatch?.(entry, { dx: -moved.x, dy: -moved.y });
  setPanView(shared.spaceDown ? 'armed' : 'idle');
  return true;
}
// the creation drag a tile starts: its command's drop door, while its feature is built; null for any other control
export const tileDrag = (entry: DoorEntry): DoorEntry | null =>
  entry.door.kind === 'panel-control' && entry.door.drawnAs === 'item' ? (TILE_DRAGS.find((d) => d.command.id === entry.command.id && isFeatureBuilt(d.door.feature as FeatureId)) ?? null) : null;
// The side drop (spec drag-layout, row 5): the canvas-drag doors of the side band, one for an element drag and one for
// a tile's creation drag; a door whose feature is not built offers nothing.
const sideDoor = (source: string) => manifest.doors.find((d) => d.door.kind === 'canvas-drag' && d.door.zone === 'side-band' && d.door.source === source && isFeatureBuilt(d.door.feature as FeatureId)) ?? null;
export const SIDE_ELEMENT = sideDoor('canvas-element');
// the key that turns a side drop's wrapper to the other axis (the gesture's own modifier meaning, interactions.json)
const WRAP_KEY = manifest.interactions.gestures.find((g) => g.id === 'element-drag')?.modifiers.find((m) => m.meaning === 'wrap-vertical')?.key ?? null;
export const wrapped = (wrapper: 'row' | 'column', modifier: string | null): 'row' | 'column' => (WRAP_KEY !== null && modifier === WRAP_KEY ? (wrapper === 'row' ? 'column' : 'row') : wrapper);
const SIDE_TILE = sideDoor('palette-tile');
const isTile = (entry: DoorEntry) => tileDrag(entry) !== null;
// The side drop of a creation drag: the side band's door, when its command takes what the tile stands for (a palette
// entry: element.wrapBeside); a component's tile offers none.
export const sideTileFor = (inserting: Inserting): DoorEntry | null => (SIDE_TILE !== null && Object.keys(inserting.args).every((name) => name in SIDE_TILE.command.args) ? SIDE_TILE : null);
// The scrub of a number field (spec inspector-number-fields): the panel drag doors pressed on a field's label, and the
// key held now when their gesture gives it a meaning (interactions.json number-scrub) and their command takes it.
const SCRUBS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'field-label');
// the drag of a gradient stop along its bar (spec gradient-editor): the panel drag pressed on a stop
const STOP_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'gradient-stop');
// the rows of a shadow editor (A3.34): dragging one moves the layer among the others
const LAYER_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source.endsWith('-shadow-row'));
// the drag of a shadow's light on its pad (spec shadow-editor): the panel drags pressed on a light pad
const PAD_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.gesture === 'shadow-pad-drag');
// the four sides of a box, in the composite's order (properties.json: top, right, bottom, left)
const BOX_SIDES = manifest.properties.composites.find((c) => c.control === 'box-model')?.longhands ?? [];
export const SIDES: readonly string[] = BOX_SIDES.map((property) => property.slice(property.lastIndexOf('-') + 1));
// the margin arguments geometry.resize takes for a flow drag (the manifest's own names): the dragged edge follows
// the pointer by its margin (item 4.2)
export const MARGIN_ARGS: Readonly<Record<'marginLeft' | 'marginTop', string>> = { marginLeft: 'marginLeft', marginTop: 'marginTop' };
// The quick panel's grip (spec quick-panel): the panel drag doors pressed on it.
const GRIP_DRAGS = manifest.doors.filter((d) => d.door.kind === 'panel-drag' && d.door.source === 'quick-panel-grip');
// The splitters (spec panel-resize): the panel drag doors pressed on a divider between panels; the frame's edge is
// one too (spec breakpoints-switch): it sizes the screen the canvas shows, from the width at the press.
export const FRAME_EDGE = 'frame-edge';
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
export const EXPLORER_OPEN = manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.control === 'file-row') ?? null;
export function scrubModifier(entry: DoorEntry, modifier: string | null): string | null {
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
export function openGesture(store: EditorStore): { readonly context: KeyContextId; readonly gesture: Gesture } | null {
  const shared = sharedOf(store);
  if (shared.open === null) return null;
  return { context: shared.session !== null && shared.open === shared.session ? COLOR_PICKER_CONTEXT : 'drag', gesture: shared.open };
}

// The colour picker's session (spec color-picker; its state: src/editor/inspector/color-picker.ts): one gesture opened
// when the picker opens, through which every part of the picker writes (dispatchInSession); the picker's Apply
// commits it, its Cancel, Escape (drag.cancel, in the picker's own key context) or its closing otherwise cancels it.
// A press on the picker's area (saturation across, brightness down) writes the colour it points at, and so does every
// move while the button is held.
const COLOR_PICKER_CONTEXT: KeyContextId = 'color-picker';
// the picker's own cancel, run when Escape ends its session: the command of its Cancel button
export const CANCEL_PICKER = (manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.panel === 'color-picker' && d.door.control === 'cancel')?.command.id ?? '') as CommandId;
export function dispatchInSession(store: EditorStore, id: CommandId, args: unknown): DispatchResult | null {
  const shared = sharedOf(store);
  const result = shared.sessionDispatch === null ? null : shared.sessionDispatch(id, args);
  finishPickerSession(shared);
  return result;
}
export function finishPickerSession(shared: PointerShared): void {
  const finish = shared.pendingPickerEnd;
  shared.pendingPickerEnd = null;
  finish?.();
}

// Runs a dispatch of its own once no gesture is open: at once, or, when a press opened one before a field lost the
// focus (a click elsewhere), once that gesture ends, since a command recorded once per dispatch never joins a gesture.
// A field keeps what was typed this way when it is left (the inspector's text field, a number field).
export function afterGesture(store: EditorStore, run: () => void): void {
  const shared = sharedOf(store);
  if (shared.open === null) {
    run();
    return;
  }
  const wait = () => (shared.open === null ? run() : requestAnimationFrame(wait));
  requestAnimationFrame(wait);
}

// The slider a field draws beside its value (the user's real-use audit, item A3.30). The field registers what its
// release commits (the text the range holds, with the unit the value carries); the pointer owner writes it on the
// release alone, so nothing is written while the pointer moves and the whole drag is one undo step.
export const SLIDER_COMMITS = new WeakMap<HTMLInputElement, (value: string) => void>();
export function registerSlider(element: HTMLInputElement, commit: (value: string) => void): () => void {
  SLIDER_COMMITS.set(element, commit);
  return () => SLIDER_COMMITS.delete(element);
}

// A control that repeats while held (a number field's step buttons, shell/field.tsx, which carry data-repeat): the
// press runs its step, with the
// one key it holds; held down, the step runs again after numberField.repeatDelay and then every
// numberField.repeatInterval (Chromium's press-and-hold), until the release, a cancel or the pointer leaving it. The
// press keeps the focus where it is.
export const REPEATS = new WeakMap<HTMLElement, (modifier: string | null) => void>();
export const REPEAT_DELAY = numberConstant('numberField.repeatDelay');
export const REPEAT_INTERVAL = numberConstant('numberField.repeatInterval');
export function registerRepeat(element: HTMLElement, step: (modifier: string | null) => void): () => void {
  REPEATS.set(element, step);
  return () => REPEATS.delete(element);
}

// The text toolbar over the canvas while a text is edited (text-toolbar.tsx): its controls run their own doors, so a
// press there is no press on the page under it, and it leaves the focus in the edited text (spec
// text-inline-formatting: Bold, Italic and Link act on what is selected there).
const TEXT_TOOLBAR_AREA = `[data-canvas-overlay] [data-region="${TEXT_TOOLBAR}"]`;
export const onTextToolbar = (target: EventTarget | null) => target instanceof Element && target.closest(TEXT_TOOLBAR_AREA) !== null;
// an option of the list the focused combobox controls (a value field's variable suggestions): a press there keeps the
// focus in the combobox, as the WAI-ARIA combobox keeps it, and the option's click runs
export const onOwnOption = (target: EventTarget | null) => {
  const field = document.activeElement;
  const list = field?.getAttribute('role') === 'combobox' ? field.getAttribute('aria-controls') : null;
  return list !== null && list !== undefined && target instanceof Element && target.closest('[role="option"]')?.closest(`[id="${CSS.escape(list)}"]`) != null;
};

// What a pointer event is on: the label of an element on the canvas chrome (spec select-click, "Hit zones": the
// selection label and the hover label select or drag the element they name), the page under the overlay, the
// stage, or neither (the rest of the editor, and the text toolbar drawn over the canvas).
export function pressAt(event: MouseEvent, isRoot: (node: string) => boolean, under: EventTarget | null = event.target): Press | null | 'elsewhere' {
  const target = under instanceof Element ? under : null;
  if (onTextToolbar(target)) return 'elsewhere';
  const named = target?.closest('[data-canvas-overlay] [data-label-for]')?.getAttribute('data-label-for') ?? null;
  if (named !== null) return { on: 'node', node: named, root: isRoot(named), label: true };
  if (target?.closest('[data-canvas-overlay]')) {
    const frame = canvasFrame();
    // a captured page's element (its canvas copy wears data-capture-node): the captured node, not the page root
    const captured = frame ? capturedNodeAt(frame, { x: event.clientX, y: event.clientY }) : null;
    if (captured !== null) return { on: 'captured', node: captured };
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
// The pointer's state is the editor's own (the views by its store, pointer/views.ts; the pan, the open gesture and the
// picker's session, sharedOf; the gesture's own state in the installer), so two editors never share it (the plan's
// T7). The installer listens to the whole window, so one window has one pointer owner: a second installer on the same
// window is refused, records an incident, and in development and tests throws.
export const OWNERS = new WeakMap<Window, EditorStore>();
// what is being picked now: an interaction's target or a motion action's (pointer/press.ts Picking)
export const pickingOf = (ui: EditorUi): Picking => ({ interaction: pickingTarget(ui), motion: motionPicking(ui) });

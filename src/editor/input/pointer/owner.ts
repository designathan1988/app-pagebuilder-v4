// The pointer owner of one editor (plan I.12: installPointer split into its parts over one state object): the store and
// window it serves, its state (the session between events, the state that outlives a gesture, the published views)
// and every part's functions, so each part reads the others through it (pointer/panels.ts, resize.ts, drag.ts,
// effects.ts, tools.ts, events.ts).
import type { Message } from '../../../core/commands/registry.ts';
import type { NodeId } from '../../../core/document/model.ts';
import type { Gesture } from '../../../core/store/store.ts';
import type { DoorEntry } from '../../../manifest/runtime.ts';
import type { Point } from '../../canvas/coordinates.ts';
import type { Box } from '../../../core/geometry/snap.ts';
import type { ResizeFrom } from '../../../core/geometry/resize.ts';
import type { DropProposal, SideOffer } from '../../drag/drop.ts';
import type { EditorStore } from '../../store.ts';
import type { ToolSession } from '../pointer-tools.ts';
import type { Effect, Machine, Press } from './machine.ts';
import type { Button, PressFacts } from './press.ts';
import type { Inserting, PointerViews, Redirect, SideView } from './views.ts';
import type { SpacingDrag, PointerShared } from './common.ts';

// What one installed pointer owner holds between events (plan I.12: the closure's locals as one object): the gesture
// machine and the press, each drag's own state, the timers, the picker and the pan.
export interface PointerSession {
  machine: Machine;
  buttons: { button: Button; count: number; modifier: string | null } | null;
  // an element drag, or a palette tile's creation drag: what it moves (nothing for a tile), the palette entry it
  // inserts (a tile's), the pointer's own proposal (level 0) and where the pointer was when it was taken
  // (drag.hysteresis), and the proposal drawn at the drag session's level, the levels it climbed and the refusal its
  // drop would meet (a creation drag's)
  dragging: {
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
  } | null;
  unfold: ReturnType<typeof setTimeout> | null;
  // the colour picker's area held with the pointer
  pickingColor: { area: HTMLElement; pointer: number } | null;
  // a resize: its handle's door and handle, where it began, its basis, the zoom, the resized node and its box then
  // (page px), which the snapping reads, and the gesture its drag opened with the cancellations counted when it opened
  resizing: { entry: DoorEntry; handle: string; pointer: number; start: Point; basis: ResizeFrom; zoom: number; gesture: Gesture | null; cancels: number; node: NodeId; box: Box | null; media: boolean } | null;
  // a guide drag in progress: a new guide out of a ruler or a guide moved, its axis, the guide once there is one, and
  // its gesture once the pointer moved past the threshold
  guiding: { kind: 'create' | 'move'; axis: string; guide: string | null; pointer: number; start: Point; gesture: Gesture | null; cancels: number } | null;
  // a rotation in progress: its handle's door, the element's centre and the pointer's angle around it at the press, the
  // angle the element held, and its gesture once the pointer moved past the threshold
  rotating: { entry: DoorEntry; property: string; pointer: number; start: Point; centre: Point; startAngle: number; base: number; gesture: Gesture | null; cancels: number } | null;
  spacing: SpacingDrag | null;
  // the timer that confirms the side drop offered after wrap.sideDwell, and the frame loop of the autoscroll
  dwell: ReturnType<typeof setTimeout> | null;
  // the menu button the pointer rests on, published after menus.hoverSwitch (spec app-menu): a pointer crossing a
  // button on its way into the open menu switches nothing
  menuResting: string | null;
  menuRestPoint: Point | null;
  menuDwell: ReturnType<typeof setTimeout> | null;
  scrolling: number;
  // whether the pointer has been inside the page's visible box since the drag began, far enough from its edges: the
  // autoscroll waits for it, so a drag that starts at an edge does not scroll at once (spec drag-layout, Problems 3)
  insideOnce: boolean;
  // the same, for the Layers tree (spec drag-autoscroll, Problems in Pager 2), and since when the pointer stands in the
  // tree's band: a timer of drop.autoscrollTreeDwell started when it enters, and whether it has run out (its rest
  // there before the tree scrolls under a row, LA1)
  insideTreeOnce: boolean;
  treeBand: ReturnType<typeof setTimeout> | null;
  treeRested: boolean;
  // the press of the gesture, while one is open: a tile's press decides its click or its drop at the release
  pressed: Press | null;
  // where the pointer is on the screen, from its last press or move
  pointerAt: Point;
  // the drags cancelled when the gesture opened (drag-session.ts): a newer cancellation ends the gesture
  cancelsAtOpen: number;
  // where the press went down, on the screen and in page pixels (null outside the page)
  pressedAt: { screen: Point; page: Point | null } | null;
  // the marquee being drawn: its door, its mode, and the press the band started from
  marquee: { entry: DoorEntry; mode: string; press: Extract<Press, { on: 'node' }> } | null;
  // a free drag in progress: where it started on the screen, the zoom then, and the travel already run (page px)
  // a free drag: where it began, the zoom, the travel already run, and the moved node and its box then (page px), which
  // the snapping reads
  freeing: { start: Point; zoom: number; applied: Point; node: NodeId | null; box: Box | null } | null;
  // whether the press just handled leaves the focus where it is: in the text edited in place, which the press
  // started or landed on (the browser would otherwise move the focus to the editor's page body at the mousedown)
  keepFocus: boolean;
  // the door that keeps the text a press outside it left, with the edit's arguments, run once the gesture closes
  keeping: { entry: DoorEntry; args: Record<string, unknown> } | null;
  // The pick of an interaction's target (spec events-actions): the element the press landed on. It is recorded here and
  // run once the gesture closes, as a dispatch of its own (interactions.update records one transaction per dispatch and
  // never joins a gesture).
  pickAfter: { entry: DoorEntry; args: Record<string, unknown> } | null;
  // a plain press on an element of a selection of several: its click waits for the release, so a drag from it drags
  // the whole selection (archive/DESIGN.md "Canvas", drag; the user's real-use audit, item 3.4), and a release without
  // a drag selects that element alone, as the click does
  deferredClick: { entry: DoorEntry; args: Record<string, unknown> } | null;
  // the modifier held at the last release (a drag's Alt duplicates, spec drag-duplicate)
  releaseModifier: string | null;
  // the scrub of a number field's label: its press, and where the pointer went down on the screen
  scrubbing: { readonly press: Extract<Press, { on: 'scrub' }>; readonly startX: number } | null;
  // a slider a field draws (A3.30), held: what its release writes
  sliding: { readonly element: HTMLInputElement; readonly commit: (value: string) => void; readonly pointer: number } | null;
  // a repeating control held down (registerRepeat): its element, the pointer and the timer of its next step
  repeating: { readonly element: HTMLElement; readonly pointer: number; timer: number } | null;
  // the drag of a shadow's light: its press, and where the pointer went down on the screen
  lighting: { readonly press: Extract<Press, { on: 'pad' }>; readonly startX: number } | null;
  // the drag of the quick panel by its grip: its press, and where the pointer went down on the screen
  gripping: { readonly press: Extract<Press, { on: 'grip' }>; readonly start: Point } | null;
  // The drag of a splitter (spec panel-resize): its press, where the pointer went down, and the size it showed then,
  // which every move sizes anew from (the gesture cancelled back to it and opened again), so Escape puts it back
  splitting: { readonly press: Extract<Press, { on: 'splitter' }>; readonly start: Point; readonly from: number } | null;
  // a panel dragged by its header: the panel it moves. Its hint follows the pointer from the press on; the release
  // runs the door of the place the pointer is in (spec floating-panels)
  panelling: { readonly press: Extract<Press, { on: 'panel' }> } | null;
  // the drag of a gradient stop: its press, and where the pointer went down on the screen
  stopping: { readonly press: Extract<Press, { on: 'stop' }>; readonly startX: number } | null;
  // The drag of a row of the Explorer's file tree (spec explorer-file-system): its press and the folder row the
  // pointer is over, marked while the drag goes on; the release moves the file there through the row's move door, one
  // undo step, and Escape moves nothing
  exploring: { readonly press: Extract<Press, { on: 'explorer' }>; over: string | null } | null;
  // The drag of a column of the Data panel (spec content-data, "binding"): its press and the element's part the pointer
  // is over (the node and the part a [data-data-target] stands for), marked while the drag goes on; the release binds
  // that part to the column's field through the drag door, one undo step, and Escape binds nothing
  columning: { readonly press: Extract<Press, { on: 'column' }>; over: { readonly node: string; readonly to: string } | null } | null;
  // The timeline: the drag of the playhead along the ruler and the drag of a keyframe along the track (specs
  // timeline-preview, timeline-keyframes). Each follows the pointer from the press on, dispatching its command in a
  // gesture of its own opened anew at every move (so Escape puts the playhead, or what the keyframe held, back).
  playheading: { readonly press: Extract<Press, { on: 'playhead' }>; readonly startX: number } | null;
  keyframing: { readonly press: Extract<Press, { on: 'keyframe' }>; readonly startX: number } | null;
  // the drag of a shadow's layer row (A3.34): its press; every move dispatches the move door with the index the
  // pointer is over, from the press state each time (the gesture cancelled back), so what the release keeps is one
  // undo step and Escape puts the rows back
  layering: { readonly press: Extract<Press, { on: 'layer' }> } | null;
  // The pointer a gesture holds (the user's real-use audit, A3.14): once a gesture opens (past the drag threshold), its
  // pointer is captured on the editor's root, so its moves and its release arrive wherever it goes, and while it is
  // held a move reads what lies under it on the screen. A capture lost before the release, a cancelled pointer
  // (pointercancel) and a press while a gesture is still open (a release that never arrived) end every open gesture
  // with nothing kept, so no command is ever sent through a closed gesture.
  captured: number | null;
  // a press a pointer tool took (pointer-tools.ts): its session, the pointer, the gesture open now (opened at the
  // press, opened anew at each move that runs a command) and the cancellations counted at the press (Escape,
  // drag.cancel)
  tooling: { readonly session: ToolSession; readonly pointer: number; gesture: Gesture; readonly cancels: number } | null;
  // the picker's session follows the picker: opened with it, committed or cancelled as it closes
  pickerClosings: number;
  pickerCancels: number;
}

export interface PointerOwner {
  readonly store: EditorStore;
  readonly target: Window;
  readonly ps: PointerSession;
  readonly shared: PointerShared;
  readonly views: PointerViews;
  pickColor: (area: HTMLElement, x: number, y: number) => void;
  stopRepeating: () => void;
  moveLight: (at: Point) => void;
  moveGrip: (at: Point) => void;
  partUnder: (at: Point) => HTMLElement | null;
  moveColumn: (at: Point) => void;
  movePlayhead: (at: Point) => void;
  moveKeyframe: (at: Point) => void;
  folderUnder: (at: Point) => HTMLElement | null;
  moveExplorer: (at: Point) => void;
  moveLayer: (at: Point) => void;
  movePanelHint: (at: Point) => void;
  moveStop: (at: Point) => void;
  scrub: (at: Point, modifier: string | null) => void;
  resize: (at: Point) => void;
  positionedNow: () => boolean;
  snappedResize: (r: NonNullable<PointerSession['resizing']>, dx: number, dy: number, suspended: boolean) => Point;
  moveFree: (at: Point, suspended: boolean) => void;
  dropHandleGestures: () => void;
  pagePoint: (at: Point) => Point | null;
  drawMarquee: (at: Point) => void;
  redraw: (at: Point, publish: boolean) => void;
  sideView: () => SideView | null;
  offer: (at: Point, onPage: boolean) => void;
  autoscroll: () => void;
  rest: (row: { readonly node: NodeId; readonly folded: boolean; } | null) => void;
  stopDragTimers: () => void;
  over: (at: Point, onPage: boolean) => void;
  factsOf: (press: Press) => PressFacts;
  run: (effect: Effect) => void;
  isRoot: (node: string) => boolean;
  capture: (pointer: number) => void;
  underPointer: (event: PointerEvent) => EventTarget | null;
  leaveField: () => void;
  endCancelled: () => void;
  dropTool: () => void;
  followPicker: () => void;
  dispatchPan: (entry: DoorEntry, args: Readonly<Record<string, unknown>>) => void;
  onWheel: (event: WheelEvent) => void;
  onDoubleClick: (event: MouseEvent) => void;
  onDown: (event: PointerEvent) => void;
  onMove: (event: PointerEvent) => void;
  onUp: (event: PointerEvent) => void;
  onCancel: () => void;
  onLostCapture: (event: PointerEvent) => void;
  onNative: (event: Event) => void;
  onContextMenu: (event: MouseEvent) => void;
  onMouseDown: (event: MouseEvent) => void;
}

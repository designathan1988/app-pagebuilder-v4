// What the pointer publishes (split out of src/editor/input/pointer.ts, which keeps the installer): the transient
// pointer state the canvas chrome, the rulers, the panels and the keymap read — the marquee's band, the hovered node,
// the drag in progress and the drop it proposes, the ghosts coming back, where the pointer is, whether Alt is held.
//
// None of it is editor state: it changes no command, it is not stored in the project and it is not undoable. Each is a
// value with a subscribe, so a React control redraws on it and nothing else. The installer is the only writer, through
// the setters here; a reader only gets and subscribes. Each editor has its own (the plan's T7): pointerViews(store)
// hands out the views of that editor's store, made the first time they are asked for, so two editors never share a
// drag, a hover or a band.
import type { Message } from '../../../core/commands/registry.ts';
import type { NodeId } from '../../../core/document/model.ts';
import type { DoorEntry } from '../../../manifest/runtime.ts';
import type { Point } from '../../canvas/coordinates.ts';
import type { DropProposal, SideOffer } from '../../drag/drop.ts';

// The band of the marquee being drawn, in screen pixels, for the canvas chrome; null when no marquee is drawn.
// Pointer state, like the hovered node: the selection it makes goes through the store.
export interface Band {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Where the last press went down, by the keys it gives the canvas (jornada03 J2): on the canvas (the stage or the page
// in its frame), on the Layers tree, or elsewhere (a panel, a picker, a menu).
export type PressRegion = 'canvas' | 'layers' | 'elsewhere';

// Whether the stage is being panned (spec canvas-pan): idle, armed by space over the stage, or panning.
export type PanView = 'idle' | 'armed' | 'panning';

// A creation drag from a palette tile: the tile's door, its arguments and the drop door it will run.
export interface Inserting {
  readonly tile: DoorEntry;
  readonly args: Readonly<Record<string, unknown>>;
  readonly drop: DoorEntry;
}

// A refusal the drop met where the pointer is, and the element that refused: the proposal drawn is then the nearest
// place that takes it (spec drag-layout, Problems in Pager 4).
export interface Redirect {
  readonly why: Message;
  readonly from: NodeId;
}
export interface DragView {
  readonly dragged: readonly NodeId[];
  readonly inserting: Inserting | null;
  readonly proposal: DropProposal | null;
  readonly refusal: Message | null;
  readonly redirect: Redirect | null;
  readonly levels: number;
  readonly at: Point;
  // the side drop offered where the pointer is (spec drag-layout, row 5): confirmed once the pointer stayed
  // wrap.sideDwell in its band (then its pill is drawn where it was confirmed, and a release wraps), else only offered
  // (a release is the ordinary drop the proposal draws); with the refusal its wrap would meet
  readonly side: SideView | null;
}
export interface SideView {
  readonly offer: SideOffer;
  readonly armed: boolean;
  readonly pill: Point | null;
  readonly refusal: Message | null;
}

// The elements a drop has just placed, for the canvas chrome, which flashes them (spec drag-layout, row 10); numbered,
// so the same elements dropped again flash again.
export interface Dropped {
  readonly id: number;
  readonly nodes: readonly NodeId[];
}

// The ghost of a creation drag Escape cancelled, for the canvas chrome, which plays its way back (spec
// drag-level-keys-escape, Problems in Pager 4): the palette entry, where the pointer was and where the press went down
// on the tile, on the screen; each one numbered, so a new one plays anew. Pointer state: the next press takes it away.
export interface GhostReturn {
  readonly id: number;
  readonly inserting: Inserting;
  readonly from: Point;
  readonly to: Point;
}

// A value with its listeners: get and subscribe for the readers, set for the installer (a value equal to the one held
// tells nobody).
interface Published<T> {
  readonly get: () => T;
  readonly subscribe: (listener: () => void) => () => void;
}
function published<T>(first: T, same: (a: T, b: T) => boolean = (a, b) => a === b): Published<T> & { readonly set: (next: T) => void } {
  let value = first;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      if (same(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

// The views of one editor.
export function createPointerViews() {
  const band = published<Band | null>(null);
  // The node the pointer hovers on the canvas, for the canvas chrome: set by pointer moves over the page, null
  // elsewhere.
  const hover = published<string | null>(null);
  // The application menu button the pointer stands on (its data-menu), or null: while one application menu is open,
  // the pointer moving onto another menu's button opens that one instead, as a desktop menu bar does (the dogfooding
  // pass: each menu wanted its own click).
  const menuOver = published<string | null>(null);
  // Whether Alt is held (spec hover-measure): while it is, the canvas draws the distances from the selection to the
  // element under the pointer. The keymap, the owner of keys, says when it goes down and up (holdAlt); nothing changes
  // in the document or the selection.
  const measuring = published(false);
  // The node whose box a resize is dragging, and the handle it is pulled by, for the canvas chrome (item 4.5: the
  // distances from the dragged edges to the neighbouring siblings are drawn while the drag goes on).
  const resizingNow = published<{ readonly node: string; readonly handle: string } | null>(null, (a, b) => a?.node === b?.node && a?.handle === b?.handle);
  // The edit handle (a spacing band, a gap, a radius, a shadow handle) a drag is pulling now, by its door: the chrome
  // keeps it drawn, with its value, while the pointer has left it (the dogfooding pass: an unpinned band went faint
  // the moment the pointer moved off it, and the value changing under the drag could not be read).
  const bandingNow = published<string | null>(null);
  // Where the pointer is while it is over the canvas's stage, for the rulers' marker (spec rulers); null elsewhere.
  const canvasPointer = published<Point | null>(null, (a, b) => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y));
  // the ruler a guide being dragged is over, its own (the chrome's delete hint), or null
  const guideOverRuler = published<string | null>(null);
  const panState = published<PanView>('idle');
  const drag = published<DragView | null>(null);
  const lastDrop = published<Dropped | null>(null, () => false);
  const ghostReturn = published<GhostReturn | null>(null, (a, b) => a === null && b === null);
  // Where the last press went down on the screen, whatever it pressed (the canvas, a Layers row): the context menu
  // opens there (spec context-menu: "a menu at the pointer").
  let lastPress: Point | null = null;
  // The keymap runs the canvas's single-letter shortcuts only while the person chose the canvas or the Layers
  // (keymap.ts lettersChosen); a count tells the keymap a press, or the keyboard choosing the canvas (F6 onto it,
  // focus.ts), happened since it last read.
  let lastRegion: PressRegion = 'elsewhere';
  let choiceOrder = 0;
  let presses = 0;
  let keyboardChoices = 0;
  // Whether a pointer button is down anywhere in the editor: the keymap asks it to tell a focus a click gave from one
  // the keyboard gave (Space on a focused control, keymap.ts)
  let pressing = false;
  let drops = 0;
  let ghostReturns = 0;
  // Nonmodal layers observe a press before its target acts; they never cancel or forward the event.
  const outsidePressListeners = new Set<(target: Node) => void>();
  return {
    band: { get: band.get, subscribe: band.subscribe },
    setBand: band.set,
    hover: { get: hover.get, subscribe: hover.subscribe },
    setHovered: hover.set,
    menuOver: { get: menuOver.get, subscribe: menuOver.subscribe },
    setMenuOver: menuOver.set,
    measuring: { get: measuring.get, subscribe: measuring.subscribe },
    // whether Alt is held now, for the installer's own decisions (the leaves marquee, the duplicating drag)
    altHeld: measuring.get,
    holdAlt: measuring.set,
    resizingNow: { get: resizingNow.get, subscribe: resizingNow.subscribe },
    setResizing: resizingNow.set,
    bandingNow: { get: bandingNow.get, subscribe: bandingNow.subscribe },
    setBanding: bandingNow.set,
    canvasPointer: { get: canvasPointer.get, subscribe: canvasPointer.subscribe },
    setCanvasPointer: canvasPointer.set,
    pressPoint: (): Point | null => lastPress,
    setPressPoint(at: Point | null): void {
      lastPress = at;
    },
    pressRegion: (): PressRegion => lastRegion,
    pressCount: (): number => presses,
    setPressRegion(region: PressRegion): void {
      lastRegion = region;
      presses = ++choiceOrder;
    },
    canvasChosenCount: (): number => keyboardChoices,
    chooseCanvasByKeyboard(): void {
      keyboardChoices = ++choiceOrder;
    },
    pointerPressing: (): boolean => pressing,
    setPressing(down: boolean): void {
      pressing = down;
    },
    guideOverRuler: { get: guideOverRuler.get, subscribe: guideOverRuler.subscribe },
    setGuideOnRuler: guideOverRuler.set,
    panState: { get: panState.get, subscribe: panState.subscribe },
    setPanView: panState.set,
    drag: { get: drag.get, subscribe: drag.subscribe },
    setDrag: drag.set,
    lastDrop: { get: lastDrop.get, subscribe: lastDrop.subscribe },
    setDropped(nodes: readonly NodeId[]): void {
      drops += 1;
      lastDrop.set({ id: drops, nodes });
    },
    ghostReturn: { get: ghostReturn.get, subscribe: ghostReturn.subscribe },
    setGhostReturn(next: Omit<GhostReturn, 'id'> | null): void {
      if (next === null && ghostReturn.get() === null) return;
      if (next !== null) ghostReturns += 1;
      ghostReturn.set(next === null ? null : { id: ghostReturns, ...next });
    },
    outsidePress: {
      subscribe(listener: (target: Node) => void): () => void {
        outsidePressListeners.add(listener);
        return () => {
          outsidePressListeners.delete(listener);
        };
      },
    },
    publishOutsidePress(target: EventTarget | null): void {
      if (!(target instanceof Node)) return;
      for (const listener of outsidePressListeners) listener(target);
    },
  };
}

export type PointerViews = ReturnType<typeof createPointerViews>;

// The views of an editor, by its store: made the first time they are asked for.
const VIEWS = new WeakMap<object, PointerViews>();
export function pointerViews(store: object): PointerViews {
  let views = VIEWS.get(store);
  if (views === undefined) {
    views = createPointerViews();
    VIEWS.set(store, views);
  }
  return views;
}

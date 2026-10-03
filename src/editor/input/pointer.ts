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
import { reportError } from '../../core/incidents.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId } from '../../generated/ids.ts';
import { snapShown } from '../canvas/snapping.ts';
import type { EditorStore } from '../store.ts';
// the gesture state machine lives in its own module (pointer/machine.ts); this owner keeps the installer and the state
import { IDLE } from './pointer/machine.ts';
// which door a press runs lives in its own module too (pointer/press.ts): the facts it is judged by, the modifier held
// what the pointer publishes for the canvas chrome and the panels (pointer/views.ts); the installer is their only
// writer
import { pointerViews } from './pointer/views.ts';

// the entries this module published before the machine moved out stay published here: consumers need not change
export { DRAG_THRESHOLD, IDLE, step } from './pointer/machine.ts';
export type { Effect, Machine, MachineEvent, Press } from './pointer/machine.ts';
export { clickDoor, editEndDoor, modifierOf } from './pointer/press.ts';
export type { Button, PressFacts } from './pointer/press.ts';
export { pointerViews } from './pointer/views.ts';
export type { Band, DragView, Dropped, GhostReturn, Inserting, PanView, Redirect, SideView } from './pointer/views.ts';
import { sharedOf, finishPickerSession, OWNERS } from './pointer/common.ts';
import type { PointerSession, PointerOwner } from './pointer/owner.ts';
import { pointerPanels } from './pointer/panels.ts';
import { pointerResize } from './pointer/resize.ts';
import { pointerDrag } from './pointer/drag.ts';
import { pointerEffects } from './pointer/effects.ts';
import { pointerTools } from './pointer/tools.ts';
import { pointerEvents } from './pointer/events.ts';
// what the rest of the editor calls of the pointer, kept in its parts' common module
export { duplicating, holdSpace, cancelPan, pressedByPointer, openGesture, dispatchInSession, afterGesture, registerSlider, registerRepeat } from './pointer/common.ts';


export function installPointer(store: EditorStore, target: Window = window): () => void {
  const owner = OWNERS.get(target);
  if (owner !== undefined && owner !== store) {
    reportError('a second editor tried to take the pointer owner', 'the pointer owner is installed: one editor per window');
    if (import.meta.env.DEV) throw new Error('the pointer owner is installed: one editor per window');
    return () => undefined;
  }
  OWNERS.set(target, store);
  const shared = sharedOf(store);
  const views = pointerViews(store);
  const {
    setBanding,
    setGuideOnRuler,
    setPanView,
  } = views;
  const ps: PointerSession = {
    machine: IDLE,
    buttons: null,
    dragging: null,
    unfold: null,
    pickingColor: null,
    resizing: null,
    guiding: null,
    rotating: null,
    spacing: null,
    dwell: null,
    menuResting: null,
    menuRestPoint: null,
    menuDwell: null,
    scrolling: 0,
    insideOnce: false,
    insideTreeOnce: false,
    treeBand: null,
    treeRested: false,
    pressed: null,
    pointerAt: { x: 0, y: 0 },
    cancelsAtOpen: 0,
    pressedAt: null,
    marquee: null,
    freeing: null,
    keepFocus: false,
    keeping: null,
    pickAfter: null,
    deferredClick: null,
    releaseModifier: null,
    scrubbing: null,
    sliding: null,
    repeating: null,
    lighting: null,
    gripping: null,
    splitting: null,
    panelling: null,
    stopping: null,
    exploring: null,
    columning: null,
    playheading: null,
    keyframing: null,
    layering: null,
    captured: null,
    tooling: null,
    pickerClosings: store.getState().ui.colorPickerClosed.count,
    pickerCancels: store.getState().ui.drag.cancels,
  };
  // the owner's parts (pointer/*.ts), each reading the others through it: all are bound before the first event
  const p = { store, target, ps, shared, views } as PointerOwner;
  Object.assign(p, pointerPanels(p), pointerResize(p), pointerDrag(p), pointerEffects(p), pointerTools(p), pointerEvents(p));
  // The splitter follows the pointer from the press on: its travel along the splitter's own axis is handed to the













  shared.sessionDispatch = (id, args) => {
    const through = shared.session ?? null;
    return through !== null ? through.dispatch(id as never, args as never) : (store.dispatch as (i: CommandId, a: unknown) => DispatchResult)(id, args);
  };
  const stopPicker = store.subscribe(p.followPicker);
  const stopListening = store.subscribe(() => {
    if (shared.session !== null) return;
    // Escape during a pointer tool's press (drag.cancel): nothing it did is kept
    if (ps.tooling !== null && store.getState().ui.drag.cancels !== ps.tooling.cancels) {
      queueMicrotask(p.dropTool);
      return;
    }
    // Escape during a band's drag (drag.cancel): the side goes back to where it was
    if (ps.spacing?.gesture != null && store.getState().ui.drag.cancels !== ps.spacing.cancels) {
      const cancelled = ps.spacing.gesture;
      ps.spacing = null;
      setBanding(null);
      shared.open = null;
      queueMicrotask(() => cancelled.cancel());
      return;
    }
    // Escape during a guide drag (drag.cancel): a new guide is not made, a moved one goes back
    if (ps.guiding?.gesture != null && store.getState().ui.drag.cancels !== ps.guiding.cancels) {
      const cancelled = ps.guiding.gesture;
      ps.guiding = null;
      setGuideOnRuler(null);
      shared.open = null;
      queueMicrotask(() => cancelled.cancel());
      return;
    }
    // Escape during a rotation (drag.cancel): the angle goes back to where it was
    if (ps.rotating?.gesture != null && store.getState().ui.drag.cancels !== ps.rotating.cancels) {
      const cancelled = ps.rotating.gesture;
      ps.rotating = null;
      shared.open = null;
      queueMicrotask(() => cancelled.cancel());
      return;
    }
    // Escape during a resize (drag.cancel, a newer cancellation): the size goes back to where it was
    if (ps.resizing?.gesture != null && store.getState().ui.drag.cancels !== ps.resizing.cancels) {
      const cancelled = ps.resizing.gesture;
      ps.resizing = null;
      snapShown.set(null);
      shared.open = null;
      queueMicrotask(() => cancelled.cancel());
      return;
    }
    if (shared.open === null) return;
    if (store.getState().ui.drag.cancels === ps.cancelsAtOpen) {
      p.redraw(ps.pointerAt, false);
      return;
    }
    const cancelled = shared.open;
    queueMicrotask(() => {
      if (shared.open === cancelled) p.endCancelled();
    });
  });

  shared.panDispatch = p.dispatchPan;
  target.addEventListener('wheel', p.onWheel, { passive: false, capture: true });
  target.addEventListener('pointerdown', p.onDown, true);
  target.addEventListener('dblclick', p.onDoubleClick, true);
  target.addEventListener('pointermove', p.onMove, true);
  target.addEventListener('pointerup', p.onUp, true);
  target.addEventListener('pointercancel', p.onCancel, true);
  target.addEventListener('lostpointercapture', p.onLostCapture, true);
  target.addEventListener('contextmenu', p.onContextMenu, true);
  target.addEventListener('mousedown', p.onMouseDown, true);
  target.addEventListener('blur', p.onCancel);
  target.addEventListener('selectstart', p.onNative, true);
  target.addEventListener('dragstart', p.onNative, true);
  return () => {
    stopListening();
    stopPicker();
    shared.sessionDispatch = null;
    finishPickerSession(shared);
    p.onCancel();
    shared.panDispatch = null;
    // the window's own transient state goes with the owner: a test that unmounts in the middle of a pan or with Space
    // held leaves nothing behind for the next editor installed over it
    shared.panning = null;
    shared.spaceDown = false;
    shared.overStage = false;
    if (ps.menuDwell !== null) clearTimeout(ps.menuDwell);
    ps.menuDwell = null;
    ps.menuResting = null;
    setPanView('idle');
    // the document is free again: another editor (a new document, a test that unmounts and mounts) may take the pointer
    if (OWNERS.get(target) === store) OWNERS.delete(target);
    target.removeEventListener('wheel', p.onWheel, { capture: true });
    target.removeEventListener('pointerdown', p.onDown, true);
    target.removeEventListener('dblclick', p.onDoubleClick, true);
    target.removeEventListener('pointermove', p.onMove, true);
    target.removeEventListener('pointerup', p.onUp, true);
    target.removeEventListener('pointercancel', p.onCancel, true);
    target.removeEventListener('lostpointercapture', p.onLostCapture, true);
    target.removeEventListener('contextmenu', p.onContextMenu, true);
    target.removeEventListener('mousedown', p.onMouseDown, true);
    target.removeEventListener('blur', p.onCancel);
    target.removeEventListener('selectstart', p.onNative, true);
    target.removeEventListener('dragstart', p.onNative, true);
  };
}

// The OS file drop (the frame's own window included) lives in input/file-drop.ts, re-exported here as its entry.
export { installOsFileDrop } from './file-drop.ts';

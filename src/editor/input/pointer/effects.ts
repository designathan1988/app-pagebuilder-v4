// What the gesture machine's effects do (plan I.12; the machine: pointer/machine.ts): the press's facts, each effect
// run, the pointer's capture and what lies under it, a field left, a cancelled gesture ended.
import { locate, type NodeId } from '../../../core/document/model.ts';
import { selectionRoots } from '../../../core/structure/remove.ts';
import type { CommandId } from '../../../generated/ids.ts';
import { canvasFrame, geometryOf, pageLayout } from '../../canvas/coordinates.ts';
import { snapShown } from '../../canvas/snapping.ts';
import { panelDrop, panelHintAt, showPanelHint } from '../../workspace/panel-drag.ts';
import { gradientView } from '../../inspector/gradient-view.ts';
import { liveDrag } from '../../drag/drag-session.ts';
import { splitterSize } from '../../workspace/layout.ts';
import { editArgs, editedNode, isTextElement } from '../../canvas/text-edit.ts';
import { isValueControl } from '../../../core/elements/inputs.ts';
import { IDLE, type Effect, type Press } from './machine.ts';
import { argsFor, clickDoor, editEndDoor, laysGrid, type PressFacts } from './press.ts';
import { CONTAINERS, isInside, ROW_DROP, ROW_SELECT } from '../drop-proposals.ts';
import type { Inserting } from './views.ts';
import { viewportWidth } from '../../view/breakpoints.ts';
import { MARQUEE, MARQUEE_ELEMENT, marqueeMode, ELEMENT_DRAGS, FREE_DRAG, dropDoor, DUPLICATE_KEY, DUPLICATE_DRAG, DRAG_MODIFIERS, DRAG_ONLY_MODIFIERS, tileDrag, SIDE_ELEMENT, wrapped, sideTileFor, FRAME_EDGE, EXPLORER_OPEN, pickingOf } from './common.ts';
import type { PointerOwner } from './owner.ts';

export function pointerEffects(p: PointerOwner): Pick<PointerOwner, 'factsOf' | 'run' | 'isRoot' | 'capture' | 'underPointer' | 'leaveField' | 'endCancelled'> {
  const { store, ps, shared, target } = p;
  const { setDrag, setBand, setDropped, setGhostReturn } = p.views;
  const factsOf = (press: Press): PressFacts => {
    const state = store.getState();
    const formControl = press.on === 'node' && isValueControl(state.document, press.node);
    const grid = press.on === 'node' && laysGrid(press.node);
    return { textual: press.on === 'node' && !formControl && isTextElement(state.document, press.node), edited: editedNode(state), formControl, grid };
  };
  const run = (effect: Effect) => {
    if (effect === 'press' && ps.machine.phase !== 'idle' && ps.buttons !== null) {
      const press = ps.machine.press;
      // a press outside the text edited in place keeps that text: the edit's node and text are read now, before the
      // press's own door (a selection elsewhere) ends the edit, and its door runs once the gesture closes, as a
      // dispatch of its own (text.set records one transaction per dispatch and never joins a gesture); the press's own
      // door records nothing, so the press is one undo step, and the status bar ends on the kept text
      const ending = editEndDoor(press, ps.buttons.button, ps.buttons.count, ps.buttons.modifier, p.factsOf(press));
      const endArgs = ending ? editArgs(store.getState(), ending.command) : null;
      ps.keeping = ending && endArgs ? { entry: ending, args: endArgs } : null;
      shared.open = store.gesture();
      ps.pressed = press;
      ps.cancelsAtOpen = store.getState().ui.drag.cancels;
      // a key only a drag gesture holds (the duplicate's Alt) is no click's: the press selects as a plain one does
      const clickModifier = ps.buttons.modifier !== null && DRAG_ONLY_MODIFIERS.has(ps.buttons.modifier as never) ? null : ps.buttons.modifier;
      const picking = pickingOf(store.getState().ui);
      const entry = clickDoor(press, ps.buttons.button, ps.buttons.count, clickModifier, p.factsOf(press), picking);
      const selected = store.getState().selection;
      const plainPress = press.on === 'node' && !press.root && ps.buttons.button === 'primary' && ps.buttons.count === 1 && clickModifier === null;
      const ofSeveral = plainPress && selected.length > 1 && selected.includes(press.node as NodeId);
      // a plain press inside a selected element (not the page root): a drag from it drags that element, a click selects
      // what was pressed (the user's real-use audit, item 3.5)
      const now = store.getState().document;
      const insideSelected = plainPress && !selected.includes(press.node as NodeId) && selected.some((id) => locate(now, id)?.parent != null && isInside(now, press.node as NodeId, id));
      // a press that picks an interaction's target is no press of its own within the gesture: the pick runs once the
      // gesture closes (its command records one transaction per dispatch)
      const pickingDoor = entry !== null && entry.door.kind === 'canvas-click' && (entry.door.target === 'pick-target' || entry.door.target === 'pick-motion-target') ? entry : null;
      const deferred = (ofSeveral || insideSelected) && pickingDoor === null;
      ps.deferredClick = entry && deferred ? { entry, args: argsFor(entry, press, picking) as Record<string, unknown> } : null;
      if (pickingDoor !== null) ps.pickAfter = { entry: pickingDoor, args: argsFor(pickingDoor, press, picking) };
      if (entry && !deferred && pickingDoor === null) shared.open.dispatch(entry.command.id as CommandId, argsFor(entry, press, picking) as never);
      // a press that lands on the edited text leaves the focus in it
      const edited = editedNode(store.getState());
      ps.keepFocus = edited !== null && press.on === 'node' && press.node === edited;
      // a press on a field's label starts its scrub, which the moves run
      if (press.on === 'scrub') ps.scrubbing = { press, startX: ps.machine.start.x };
      // a press on the timeline's ruler sets the playhead where it lands, and the moves scrub it (spec
      // timeline-preview); a press on a keyframe's marker starts its drag (spec timeline-keyframes)
      if (press.on === 'playhead') {
        ps.playheading = { press, startX: ps.machine.start.x };
        p.movePlayhead(ps.machine.start);
      }
      if (press.on === 'keyframe') ps.keyframing = { press, startX: ps.machine.start.x };
      // a press on a shadow layer's row starts its move, which the moves run (A3.34)
      if (press.on === 'layer') ps.layering = { press };
      // a press on a gradient stop chooses it (the editor's fields edit it) and starts its drag, which the moves run
      if (press.on === 'stop') {
        ps.stopping = { press, startX: ps.machine.start.x };
        gradientView.chooseStop(press.index);
      }
      // a press on a light pad puts the light where it lands, and the moves drag it; the pad takes the focus (its keys)
      // a press on the quick panel's grip starts its drag, which the moves run
      if (press.on === 'grip') ps.gripping = { press, start: ps.machine.start };
      // a press on a row of the Explorer's tree starts its drag; the moves mark the folder under the pointer
      if (press.on === 'explorer') ps.exploring = { press, over: null };
      // a press on a column of the Data panel starts its drag; the moves mark the element's part under the pointer
      if (press.on === 'column') ps.columning = { press, over: null };
      // a press on a splitter starts its drag, which the moves run; the size it shows now is the one Escape puts back
      if (press.on === 'splitter') {
        const from = press.entry.door.kind === 'panel-drag' && press.entry.door.source === FRAME_EDGE ? viewportWidth(store.getState()) : splitterSize(store.getState().ui, String(press.args.splitter ?? ''));
        if (from !== null) ps.splitting = { press, start: ps.machine.start, from };
      }
      // a press on a panel's header starts its drag: the panel follows the pointer as a hint of where it would land
      if (press.on === 'panel') ps.panelling = { press };
      if (press.on === 'pad') {
        ps.lighting = { press, startX: ps.machine.start.x };
        press.element.focus();
        p.moveLight(ps.machine.start);
      }
    } else if (effect === 'drag' && ps.machine.phase === 'dragging' && ps.buttons?.button === 'primary') {
      const press = ps.machine.press;
      // a captured page's element is not dragged on the canvas: the captured inspector moves it (capture.edit)
      if (press.on === 'captured') return;
      if (press.on === 'tile') {
        // a tile's creation drag: nothing is dragged; what the tile stands for is inserted where it is dropped. It
        // starts over the palette, outside the page: no proposal yet
        const drop = tileDrag(press.entry);
        if (drop === null) return;
        const inserting: Inserting = { tile: press.entry, args: press.args, drop };
        ps.dragging = { dragged: [], inserting, base: null, takenAt: null, proposal: null, levels: 0, refusal: null, raw: null, redirect: null, side: null, fromRow: false, resting: null };
        liveDrag.begin([]);
        setDrag({ dragged: [], inserting, proposal: null, refusal: null, redirect: null, levels: 0, at: ps.pointerAt, side: null });
        return;
      }
      if (press.on === 'row') {
        if (ROW_SELECT === null || ROW_DROP === null) return;
        if (!store.getState().selection.includes(press.node as NodeId)) shared.open?.dispatch(ROW_SELECT.command.id as CommandId, { ...ROW_SELECT.door.args, target: press.node } as never);
        const state = store.getState();
        const roots = selectionRoots(state.document, state.selection);
        // the page root's row is never dragged
        if (roots.length === 0 || roots.some((at) => at.parent === null)) return;
        const dragged = roots.map((at) => at.node.id);
        ps.dragging = { dragged, inserting: null, base: null, takenAt: null, proposal: null, levels: 0, refusal: null, raw: null, redirect: null, side: null, fromRow: false, resting: null };
        liveDrag.begin(dragged);
        setDrag({ dragged, inserting: null, proposal: null, refusal: null, redirect: null, levels: 0, at: ps.pointerAt, side: null });
        return;
      }
      const node = press.on === 'node' ? (locate(store.getState().document, press.node as NodeId)?.node ?? null) : null;
      // The band's door: the empty area's for a press on the page root or on a container's own area, the element's for
      // a press the empty area does not take (a leaf, or a container without children) — started by its modifier
      // (Shift), the band then working over that element's siblings (Problems in Pager 4). What the press's click did
      // is undone, so the marquee starts from the selection held before the press.
      const bandDoor = press.on === 'node' && (press.root || (node !== null && CONTAINERS.has(node.type) && node.children.length > 0)) ? MARQUEE : MARQUEE_ELEMENT;
      const mode = bandDoor === null || press.on !== 'node' ? null : marqueeMode(bandDoor, press, ps.buttons.modifier, node);
      const plain = ps.buttons.modifier === null || DRAG_MODIFIERS.has(ps.buttons.modifier as never);
      const frame = canvasFrame();
      const zoom = frame ? geometryOf(frame)?.zoom : undefined;
      if (bandDoor !== null && press.on === 'node' && mode !== null) ps.marquee = { entry: bandDoor, mode, press };
      else if (FREE_DRAG !== null && press.on === 'node' && !press.root && zoom !== undefined && p.positionedNow()) {
        const moved = store.getState().selection[0] ?? null;
        ps.freeing = { start: ps.machine.start, zoom, applied: { x: 0, y: 0 }, node: moved, box: moved === null ? null : pageLayout.box(moved) };
      }
      else if (ELEMENT_DRAGS.length > 0 && press.on === 'node' && !press.root && plain) {
        // any other press on an element drags the selection's roots, which the press has just made that element
        const state = store.getState();
        const dragged = selectionRoots(state.document, state.selection).map((at) => at.node.id);
        if (dragged.length > 0) {
          ps.dragging = { dragged, inserting: null, base: null, takenAt: null, proposal: null, levels: 0, refusal: null, raw: null, redirect: null, side: null, fromRow: false, resting: null };
          liveDrag.begin(dragged);
          setDrag({ dragged, inserting: null, proposal: null, refusal: null, redirect: null, levels: 0, at: ps.pointerAt, side: null });
        }
      }
    } else if (effect === 'commit' || effect === 'cancel') {
      const closing = shared.open;
      const dropped = ps.dragging?.proposal ?? null;
      const dragged = ps.dragging !== null;
      const draggedIds = ps.dragging?.dragged ?? [];
      const side = ps.dragging?.side?.armed === true && ps.dragging.fromRow === false ? ps.dragging.side : null;
      const fromRow = ps.dragging?.fromRow === true;
      // a creation drag's doors: where it drops, and its side drop (a palette tile's only)
      const inserting = ps.dragging?.inserting ?? null;
      const dropDoorOf = inserting?.drop ?? null;
      const sideDoorOf = inserting === null ? null : sideTileFor(inserting);
      // the document before the release, to tell whether the drop placed anything
      const before = store.getState().document;
      p.stopDragTimers();
      const press = ps.pressed;
      shared.open = null;
      ps.dragging = null;
      ps.freeing = null;
      snapShown.set(null);
      liveDrag.end();
      ps.scrubbing = null;
      ps.stopping = null;
      ps.layering = null;
      ps.playheading = null;
      ps.keyframing = null;
      // a dragged panel: the release runs the door of the place the pointer is in, with the panel and that place as
      // its arguments (spec floating-panels); a cancelled one puts nothing anywhere, and the hint goes either way
      if (ps.panelling !== null) {
        const dragging = ps.panelling;
        ps.panelling = null;
        showPanelHint(null);
        if (effect === 'commit') {
          const place = panelDrop(panelHintAt(ps.pointerAt.x, ps.pointerAt.y, dragging.press.panel));
          if (place.door !== null) closing?.dispatch(place.door.command.id as CommandId, { ...place.door.door.args, panel: dragging.press.panel, ...place.args } as never);
        }
      }
      if (ps.exploring !== null && effect === 'commit' && ps.exploring.press.path !== '') {
        const into = ps.exploring.over;
        const exploringNow = ps.exploring.press;
        // a release over a folder moves the file there; a release anywhere else (a click) opens it in the code pane
        if (into !== null) closing?.dispatch(exploringNow.entry.command.id as CommandId, { ...exploringNow.entry.door.args, ...exploringNow.args, to: into } as never);
        else if (EXPLORER_OPEN !== null) closing?.dispatch(EXPLORER_OPEN.command.id as CommandId, { ...EXPLORER_OPEN.door.args, path: exploringNow.path } as never);
        document.querySelectorAll('[data-folder].is-over').forEach((el) => el.classList.remove('is-over'));
      }
      ps.exploring = null;
      // a column released over an element's part binds the part to its field; released anywhere else, nothing
      if (ps.columning !== null && effect === 'commit' && ps.columning.over !== null) closing?.dispatch(ps.columning.press.entry.command.id as CommandId, { ...ps.columning.press.entry.door.args, field: ps.columning.press.field, node: ps.columning.over.node, to: ps.columning.over.to } as never);
      if (ps.columning !== null) document.querySelectorAll('[data-data-target].is-over').forEach((el) => el.classList.remove('is-over'));
      ps.columning = null;
      ps.lighting = null;
      ps.gripping = null;
      ps.splitting = null;
      ps.pressed = null;
      setDrag(null);
      ps.marquee = null;
      ps.pressedAt = null;
      setBand(null);
      if (effect === 'commit' && press?.on === 'tile') {
        // a tile released below the threshold is its click (its door, at the selection); past it, the proposal drawn
        // last receives the tile's entry through the palette's canvas-drag door (its command refuses a parent that
        // does not accept it); with no proposal drawn (outside the page) nothing is inserted
        if (!dragged) closing?.dispatch(press.entry.command.id, { ...press.entry.door.args, ...press.args } as never);
        else if (side !== null && sideDoorOf !== null) closing?.dispatch(
          sideDoorOf.command.id,
          { ...sideDoorOf.door.args, ...press.args, target: side.offer.target, side: side.offer.side, wrapper: wrapped(side.offer.wrapper, ps.releaseModifier) } as never
        );
        else if (dropped !== null && dropDoorOf !== null) closing?.dispatch(dropDoorOf.command.id, { ...dropDoorOf.door.args, ...press.args, parent: dropped.parent, index: dropped.index } as never);
      } else if (effect === 'commit' && dragged && side !== null && SIDE_ELEMENT !== null) {
        // a confirmed side drop puts the dragged elements beside its target in a new wrapper
        closing?.dispatch(SIDE_ELEMENT.command.id, { ...SIDE_ELEMENT.door.args, target: side.offer.target, side: side.offer.side, wrapper: wrapped(side.offer.wrapper, ps.releaseModifier) } as never);
      } else if (effect === 'commit' && dropped !== null && !fromRow && DUPLICATE_DRAG !== null && ps.releaseModifier !== null && ps.releaseModifier === DUPLICATE_KEY) {
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
      const waiting = ps.deferredClick;
      ps.deferredClick = null;
      if (effect === 'commit' && !dragged && waiting !== null) closing?.dispatch(waiting.entry.command.id as CommandId, waiting.args as never);
      if (effect === 'commit') closing?.commit();
      else closing?.cancel();
      // what a drop placed flashes (spec drag-layout, row 10): the selection it left, when the document changed
      if (effect === 'commit' && dragged && store.getState().document !== before) setDropped(store.getState().selection);
      // the text the press left is kept whether the gesture ends or the browser takes the pointer away, and a press
      // that picked an interaction's target runs its command now
      const kept = ps.keeping;
      ps.keeping = null;
      if (kept) store.dispatch(kept.entry.command.id as CommandId, kept.args as never);
      const picked = ps.pickAfter;
      ps.pickAfter = null;
      if (picked) store.dispatch(picked.entry.command.id as CommandId, picked.args as never);
    }
  };
  const isRoot = (node: string) => locate(store.getState().document, node as NodeId)?.parent === null;
  const capture = (pointer: number) => {
    if (ps.captured === pointer) return;
    try {
      target.document.documentElement.setPointerCapture(pointer);
      ps.captured = pointer;
    } catch {
      // a pointer the browser no longer tracks (its button already up): there is nothing to hold
    }
  };
  const underPointer = (event: PointerEvent): EventTarget | null => (ps.captured === event.pointerId ? target.document.elementFromPoint(event.clientX, event.clientY) : event.target);
  // A press the pointer owner takes first takes the focus from a field of the editor (a Layers row's name being
  // renamed, spec rename-element: leaving the field keeps its name): the field keeps what it holds as it loses the
  // focus, before the press opens its gesture and runs its door, which would otherwise end the field's work first (a
  // selection elsewhere ends a rename) or find a gesture open. The text edited in place on the page is no field of the
  // editor: the frame holds that focus, and a press outside it keeps the text through its own door.
  const leaveField = () => {
    const focused = target.document.activeElement;
    if (focused instanceof HTMLElement && (focused.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName))) focused.blur();
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
      ps.marquee !== null || ps.scrubbing !== null || ps.stopping !== null || ps.lighting !== null || ps.gripping !== null || ps.exploring !== null || ps.columning !== null || ps.playheading !== null || ps.keyframing !== null || ps.panelling !== null
        ? 'cancel'
        : 'commit';
    p.stopDragTimers();
    if (ps.dragging?.inserting != null && ps.pressedAt !== null) setGhostReturn({ inserting: ps.dragging.inserting, from: ps.pointerAt, to: ps.pressedAt.screen });
    ps.dragging = null;
    ps.pressed = null;
    ps.machine = IDLE;
    p.run(effect);
  };
  return { factsOf, run, isRoot, capture, underPointer, leaveField, endCancelled };
}

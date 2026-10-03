// The window's pointer events, each turned into the machine's events (plan I.12): press, move, release, cancel, the
// lost capture, the browser's own gestures, the context menu and the double click.
import { locate, type NodeId } from '../../../core/document/model.ts';
import type { CommandId, DoorId } from '../../../generated/ids.ts';
import { manifest } from '../../../manifest/runtime.ts';
import { canvasFrame, geometryOf, nodeAt, nodeBox, pageLayout, resizeBasis, screenToPage } from '../../canvas/coordinates.ts';
import { snapShown } from '../../canvas/snapping.ts';
import { resizedBox } from '../../../core/geometry/resize.ts';
import { storedValue } from '../../../core/style/stored.ts';
import { guidesOf } from '../../../core/page/guides.ts';
import { elementPredicate } from '../../../core/style/applies.ts';
import { MODEL_RULES } from '../../store.ts';
import { toolPoint, toolPress } from '../pointer-tools.ts';
import { typedBand } from '../../canvas/band-typing.ts';
import { SHADOW_EDITS } from '../../canvas/handles.ts';
import { geometryAttributes, shapeResizeFrom } from '../../../core/elements/svg.ts';
import { editedNode } from '../../canvas/text-edit.ts';
import { DRAG_THRESHOLD, step } from './machine.ts';
import { argsFor, clickDoor, modifierOf } from './press.ts';
import { SHADOW_OFFSET, EDITOR_MENU_AREA, MENU_HOVER_SWITCH, MENU_HOVER_TOLERANCE, RESIZE_MIN, ROTATE_SNAP, GUIDE_CREATES, GUIDE_MOVE, GUIDE_DELETE, degreesOf, folded, ALL_SIDES_KEY, OPPOSITE_KEY, handleInPlace, chromeControl, panDrag, onStage, pressRegionOf, SIDES, MARGIN_ARGS, SLIDER_COMMITS, REPEATS, REPEAT_DELAY, REPEAT_INTERVAL, onTextToolbar, onOwnOption, pressAt, pickingOf } from './common.ts';
import type { PointerOwner } from './owner.ts';

export function pointerEvents(p: PointerOwner): Pick<PointerOwner, 'onDoubleClick' | 'onDown' | 'onMove' | 'onUp' | 'onCancel' | 'onLostCapture' | 'onNative' | 'onContextMenu' | 'onMouseDown'> {
  const { ps, shared, store } = p;
  const { pointerPressing, setPressing, setPressRegion, publishOutsidePress, setResizing, setPanView, setPressPoint, setGhostReturn, setMenuOver, setCanvasPointer, setBanding, setGuideOnRuler, setHovered, guideOverRuler } = p.views;
  // A double click is the browser's own (its dblclick, after the second release, by the system's double-click time;
  // Chrome's pointerdown carries no click count, so each press is a single click): the double-click door of what it
  // lands on runs as a gesture of its own.
  const onDoubleClick = (event: MouseEvent) => {
    if (ps.machine.phase !== 'idle' || shared.open !== null || event.button !== 0) return;
    const press = pressAt(event, p.isRoot);
    if (press === null || press === 'elsewhere') return;
    const entry = clickDoor(press, 'primary', 2, modifierOf(event), p.factsOf(press), pickingOf(store.getState().ui));
    if (!entry) return;
    const gesture = store.gesture();
    gesture.dispatch(entry.command.id as CommandId, argsFor(entry, press, pickingOf(store.getState().ui)) as never);
    gesture.commit();
  };
  const onDown = (event: PointerEvent) => {
    // a press or a gesture still open here lost its release: it ends before anything new begins
    if (pointerPressing() || ps.spacing !== null || ps.guiding !== null || ps.rotating !== null || ps.resizing !== null || shared.panning !== null || ps.pickingColor !== null || ps.sliding !== null || ps.tooling !== null) p.onCancel();
    setPressing(true);
    setPressRegion(pressRegionOf(event.target));
    publishOutsidePress(event.target);
    // a pointer tool (the Layout Composer's stage, the motion Timeline's drags): a primary press on its surface, Space
    // not held (a pan)
    const tool = event.button === 0 && ps.machine.phase === 'idle' && shared.open === null && !shared.spaceDown ? toolPress(toolPoint(event), event.target, store) : null;
    if (tool !== null) {
      event.preventDefault();
      p.leaveField();
      p.capture(event.pointerId);
      const gesture = store.gesture();
      shared.open = gesture;
      ps.tooling = { session: tool, pointer: event.pointerId, gesture, cancels: store.getState().ui.drag.cancels };
      return;
    }
    // a slider a field draws (A3.30): the pointer moves the thumb freely, and only the release writes
    const commit = event.button === 0 && event.target instanceof HTMLInputElement && event.target.type === 'range' ? (SLIDER_COMMITS.get(event.target) ?? null) : null;
    if (commit !== null && event.target instanceof HTMLInputElement) {
      ps.sliding = { element: event.target, commit, pointer: event.pointerId };
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
      ps.repeating = hold;
      hold.timer = window.setTimeout(() => {
        if (ps.repeating !== hold) return;
        repeat(held);
        hold.timer = window.setInterval(() => repeat(held), REPEAT_INTERVAL);
      }, REPEAT_DELAY);
      return;
    }
    // the colour picker's area, during its session: the colour it points at, then at every move while held
    const area = shared.session !== null && event.button === 0 && event.target instanceof Element ? event.target.closest<HTMLElement>('[data-color-area]') : null;
    if (area !== null) {
      event.preventDefault();
      ps.pickingColor = { area, pointer: event.pointerId };
      p.pickColor(area, event.clientX, event.clientY);
      return;
    }
    // a handle of the Edit on canvas mode, pressed with the primary button
    const bandEl = event.button === 0 && ps.machine.phase === 'idle' ? (chromeControl({ x: event.clientX, y: event.clientY }, '[data-canvas-overlay] [data-edit-handle]', event.target) as HTMLElement | null) : null;
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
      ps.spacing = {
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
    const guideEl = event.button === 0 && ps.machine.phase === 'idle' && event.target instanceof Element ? event.target.closest('[data-canvas-overlay] [data-guide]') : null;
    const rulerEl = event.button === 0 && ps.machine.phase === 'idle' && event.target instanceof Element ? event.target.closest('[data-ruler]') : null;
    if (guideEl instanceof HTMLElement && GUIDE_MOVE !== null) {
      event.preventDefault();
      guideEl.focus();
      ps.guiding = { kind: 'move', axis: guideEl.getAttribute('data-axis') ?? '', guide: guideEl.getAttribute('data-guide'), pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, gesture: null, cancels: 0 };
      return;
    }
    const rulerAxis = rulerEl?.getAttribute('data-ruler') ?? '';
    if (rulerEl && GUIDE_CREATES[rulerAxis]) {
      event.preventDefault();
      ps.guiding = { kind: 'create', axis: rulerAxis, guide: null, pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, gesture: null, cancels: 0 };
      return;
    }
    // the rotation handle of the selection, pressed with the primary button
    const rotator = event.button === 0 && ps.machine.phase === 'idle' ? chromeControl({ x: event.clientX, y: event.clientY }, '[data-canvas-overlay] [data-rotate-handle]', event.target) : null;
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
        ps.rotating = {
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
    const grabbable = event.button === 0 && ps.machine.phase === 'idle' ? chromeControl({ x: event.clientX, y: event.clientY }, '[data-canvas-overlay] [data-resize-handle]', event.target) : null;
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
      ps.resizing = { entry: handleEntry, handle: handle.getAttribute('data-resize-handle') ?? '', pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, basis, zoom, gesture: null, cancels: 0, node: resized, box: pageLayout.box(resized), media };
      return;
    }
    // a pan: the middle button, or the primary one with Space held, on the stage
    const source = onStage(event.target) && ps.machine.phase === 'idle' ? (event.button === 1 ? 'middle-button' : event.button === 0 && shared.spaceDown ? 'space-held' : null) : null;
    const panEntry = source !== null ? panDrag(source) : null;
    if (panEntry !== null) {
      event.preventDefault();
      shared.panning = { pointer: event.pointerId, last: { x: event.clientX, y: event.clientY }, moved: { x: 0, y: 0 }, entry: panEntry };
      setPanView('panning');
      return;
    }
    setPressPoint({ x: event.clientX, y: event.clientY });
    ps.keepFocus = false;
    setGhostReturn(null);
    const press = pressAt(event, p.isRoot);
    if (press === null || press === 'elsewhere') return;
    if (event.button !== 0 && event.button !== 2) return;
    // a palette tile, a Layers row and a field's label take the primary button only
    if (
      (press.on === 'tile' || press.on === 'row' || press.on === 'scrub' || press.on === 'stop' || press.on === 'pad' || press.on === 'grip' || press.on === 'splitter' || press.on === 'playhead' || press.on === 'keyframe' || press.on === 'panel') &&
      event.button !== 0
    )
      return;
    p.leaveField();
    ps.buttons = { button: event.button === 2 ? 'secondary' : 'primary', count: Math.min(Math.max(event.detail, 1), 2), modifier: modifierOf(event) };
    const at = { x: event.clientX, y: event.clientY };
    ps.pointerAt = at;
    const next = step(ps.machine, { type: 'down', pointer: event.pointerId, at, press });
    if (next.effect === 'press') ps.pressedAt = { screen: at, page: p.pagePoint(at) };
    ps.machine = next.machine;
    p.run(next.effect);
  };
  const onMove = (event: PointerEvent) => {
    // a repeating control stops once the pointer leaves it
    if (ps.repeating !== null && event.pointerId === ps.repeating.pointer && !(event.target instanceof Node && ps.repeating.element.contains(event.target))) p.stopRepeating();
    if (ps.tooling !== null) {
      if (event.pointerId !== ps.tooling.pointer) return;
      const step = ps.tooling.session.move(toolPoint(event));
      if (step !== null) {
        // the drag runs anew from the press: the page follows the pointer, and Escape puts everything back
        ps.tooling.gesture.cancel();
        const gesture = store.gesture();
        shared.open = gesture;
        ps.tooling.gesture = gesture;
        gesture.dispatch(step.command as never, step.args as never);
      }
      return;
    }
    if (ps.pickingColor !== null) {
      if (event.pointerId === ps.pickingColor.pointer) p.pickColor(ps.pickingColor.area, event.clientX, event.clientY);
      return;
    }
    const under = p.underPointer(event);
    // an application menu's button under the pointer (the open menu's backdrop covers the window: the buttons are
    // looked for by their boxes), for the menu bar's hover switch
    const menuButton = [...document.querySelectorAll<HTMLElement>('[data-region="top-bar"] [data-menu]')].find((b) => {
      const r = b.getBoundingClientRect();
      return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    });
    const menuUnder = menuButton?.getAttribute('data-menu') ?? null;
    const menuMoved = ps.menuRestPoint !== null && Math.hypot(event.clientX - ps.menuRestPoint.x, event.clientY - ps.menuRestPoint.y) > MENU_HOVER_TOLERANCE;
    if (menuUnder !== ps.menuResting || (menuUnder !== null && menuMoved)) {
      ps.menuResting = menuUnder;
      ps.menuRestPoint = menuUnder === null ? null : { x: event.clientX, y: event.clientY };
      if (ps.menuDwell !== null) clearTimeout(ps.menuDwell);
      ps.menuDwell = null;
      if (menuUnder === null) setMenuOver(null);
      else ps.menuDwell = setTimeout(() => setMenuOver(menuUnder), MENU_HOVER_SWITCH);
    }
    shared.overStage = onStage(under);
    setCanvasPointer(shared.overStage ? { x: event.clientX, y: event.clientY } : null);
    if (ps.spacing !== null) {
      if (event.pointerId !== ps.spacing.pointer) return;
      const dx = event.clientX - ps.spacing.from.x;
      const dy = event.clientY - ps.spacing.from.y;
      if (ps.spacing.gesture === null) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        ps.spacing.gesture = store.gesture();
        ps.spacing.cancels = store.getState().ui.drag.cancels;
        shared.open = ps.spacing.gesture;
        setBanding(ps.spacing.element.getAttribute('data-door'));
        p.capture(event.pointerId);
      }
      // a shadow handle: the first layer's X and Y follow the pointer, or its blur its horizontal travel
      if (ps.spacing.shadow !== null) {
        const { property, offset, x, y } = ps.spacing.shadow;
        const edit = offset ? { layer: 0, [SHADOW_EDITS.x]: `${Math.round(x + dx / ps.spacing.zoom)}px`, [SHADOW_EDITS.y]: `${Math.round(y + dy / ps.spacing.zoom)}px` } : { layer: 0, [SHADOW_EDITS.blur]: `${Math.max(0, Math.round(ps.spacing.start + dx / ps.spacing.zoom))}px` };
        ps.spacing.gesture.dispatch(ps.spacing.entry.command.id as CommandId, { ...ps.spacing.entry.door.args, property, edit, distance: dx } as never);
        return;
      }
      const held = modifierOf(event);
      // the new value in whole CSS px (a start the page computes with decimals included)
      const travel = (dx * ps.spacing.normal[0] + dy * ps.spacing.normal[1]) / ps.spacing.zoom;
      const bounded = (value: number) => (ps.spacing?.min === null || ps.spacing === null ? value : Math.max(ps.spacing.min, value));
      const value = bounded(Math.round(ps.spacing.start + travel));
      const all = held !== null && held === ALL_SIDES_KEY;
      // Shift and Alt act on a spacing band alone (the one that names its opposite side)
      const band = ps.spacing.opposite !== '';
      // Shift adds the same displacement to the four sides (A3.15): each keeps its own start, so the band's element
      // carries them (data-sides-start, in the composite's order)
      const starts = band && all ? ps.spacing.sidesStart : null;
      if (starts !== null && starts.length === 4 && starts.every((n) => Number.isFinite(n))) {
        const delta = value - ps.spacing.start;
        // the side the pointer holds is written last: the status names the side the drag is on, never another one
        const dragged = ps.spacing.args.sides ?? '';
        const order = [...SIDES.filter((side) => side !== dragged), ...SIDES.filter((side) => side === dragged)];
        for (const side of order) {
          ps.spacing.gesture.dispatch(ps.spacing.entry.command.id as CommandId, { ...ps.spacing.entry.door.args, ...ps.spacing.args, sides: side, [ps.spacing.valueArg]: `${bounded((starts[SIDES.indexOf(side)] ?? 0) + delta)}px` } as never);
        }
        return;
      }
      ps.spacing.gesture.dispatch(ps.spacing.entry.command.id as CommandId, { ...ps.spacing.entry.door.args, ...ps.spacing.args, [ps.spacing.valueArg]: `${value}px` } as never);
      if (band && !all && held !== null && held === OPPOSITE_KEY) {
        ps.spacing.gesture.dispatch(ps.spacing.entry.command.id as CommandId, { ...ps.spacing.entry.door.args, ...ps.spacing.args, sides: ps.spacing.opposite, [ps.spacing.valueArg]: `${bounded(Math.round(ps.spacing.oppositeStart + (value - ps.spacing.start)))}px` } as never);
      }
      return;
    }
    if (ps.guiding !== null) {
      if (event.pointerId !== ps.guiding.pointer) return;
      const frame = canvasFrame();
      const g = frame ? geometryOf(frame) : null;
      if (g === null) return;
      if (ps.guiding.gesture === null) {
        if (Math.hypot(event.clientX - ps.guiding.start.x, event.clientY - ps.guiding.start.y) < DRAG_THRESHOLD) return;
        ps.guiding.gesture = store.gesture();
        ps.guiding.cancels = store.getState().ui.drag.cancels;
        shared.open = ps.guiding.gesture;
        p.capture(event.pointerId);
      }
      // over its own ruler, or past it (the pointer carried out of the canvas beyond the ruler: the person throws the
      // guide away; it stuck at 0 before — the dogfooding pass)
      const ownRuler = document.querySelector(`[data-ruler="${ps.guiding.axis}"]`)?.getBoundingClientRect() ?? null;
      const pastRuler = ownRuler !== null && (ps.guiding.axis === 'horizontal' ? event.clientY <= ownRuler.bottom : event.clientX <= ownRuler.right);
      const onOwnRuler = pastRuler || document.elementFromPoint(event.clientX, event.clientY)?.closest(`[data-ruler="${ps.guiding.axis}"]`) != null;
      setGuideOnRuler(onOwnRuler ? ps.guiding.axis : null);
      if (onOwnRuler) return;
      const point = screenToPage({ x: event.clientX, y: event.clientY }, g);
      const at = Math.max(0, Math.round(ps.guiding.axis === 'horizontal' ? point.y : point.x));
      const create = GUIDE_CREATES[ps.guiding.axis];
      if (ps.guiding.guide === null && create) {
        ps.guiding.gesture.dispatch(create.command.id as CommandId, { ...create.door.args, axis: ps.guiding.axis, at } as never);
        ps.guiding.guide = [...guidesOf(store.getState().document)].reverse().find((guide) => guide.axis === ps.guiding?.axis)?.id ?? null;
      } else if (ps.guiding.guide !== null && GUIDE_MOVE !== null) ps.guiding.gesture.dispatch(GUIDE_MOVE.command.id as CommandId, { ...GUIDE_MOVE.door.args, guide: ps.guiding.guide, at } as never);
      return;
    }
    if (ps.rotating !== null) {
      if (event.pointerId !== ps.rotating.pointer) return;
      if (ps.rotating.gesture === null) {
        if (Math.hypot(event.clientX - ps.rotating.start.x, event.clientY - ps.rotating.start.y) < DRAG_THRESHOLD) return;
        ps.rotating.gesture = store.gesture();
        ps.rotating.cancels = store.getState().ui.drag.cancels;
        shared.open = ps.rotating.gesture;
        p.capture(event.pointerId);
      }
      const turned = folded(ps.rotating.base + ((Math.atan2(event.clientY - ps.rotating.centre.y, event.clientX - ps.rotating.centre.x) - ps.rotating.startAngle) * 180) / Math.PI);
      const angle = event.shiftKey ? Math.round(turned / ROTATE_SNAP) * ROTATE_SNAP : Math.round(turned);
      ps.rotating.gesture.dispatch(ps.rotating.entry.command.id as CommandId, { ...ps.rotating.entry.door.args, property: ps.rotating.property, value: `${angle}deg` } as never);
      return;
    }
    if (ps.resizing !== null) {
      if (event.pointerId !== ps.resizing.pointer) return;
      const dx = event.clientX - ps.resizing.start.x;
      const dy = event.clientY - ps.resizing.start.y;
      if (ps.resizing.gesture === null) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        ps.resizing.gesture = store.gesture();
        ps.resizing.cancels = store.getState().ui.drag.cancels;
        shared.open = ps.resizing.gesture;
        p.capture(event.pointerId);
      }
      const travel = p.snappedResize(ps.resizing, dx / ps.resizing.zoom, dy / ps.resizing.zoom, event.ctrlKey);
      const values = resizedBox(ps.resizing.basis, ps.resizing.handle, travel.x, travel.y, { aspect: ps.resizing.media ? !event.shiftKey : event.shiftKey, centre: event.altKey }, RESIZE_MIN);
      const { marginLeft, marginTop, ...rest } = values;
      const named: Record<string, string | undefined> = { ...rest };
      if (marginLeft !== undefined) named[MARGIN_ARGS.marginLeft] = marginLeft;
      if (marginTop !== undefined) named[MARGIN_ARGS.marginTop] = marginTop;
      const given = Object.fromEntries(Object.entries(named).filter(([, value]) => value !== undefined));
      ps.resizing.gesture.dispatch(ps.resizing.entry.command.id as CommandId, { ...ps.resizing.entry.door.args, ...given } as never);
      return;
    }
    if (shared.panning !== null) {
      if (event.pointerId !== shared.panning.pointer) return;
      const dx = event.clientX - shared.panning.last.x;
      const dy = event.clientY - shared.panning.last.y;
      shared.panning.last = { x: event.clientX, y: event.clientY };
      if (dx === 0 && dy === 0) return;
      p.capture(event.pointerId);
      shared.panning.moved = { x: shared.panning.moved.x + dx, y: shared.panning.moved.y + dy };
      p.dispatchPan(shared.panning.entry, { dx, dy });
      return;
    }
    const press = pressAt(event, p.isRoot, under);
    setHovered(ps.machine.phase === 'idle' && press !== null && press !== 'elsewhere' && press.on === 'node' ? press.node : null);
    const at = { x: event.clientX, y: event.clientY };
    const next = step(ps.machine, { type: 'move', pointer: event.pointerId, at });
    if (ps.machine.phase === 'idle' || event.pointerId === ps.machine.pointer) ps.pointerAt = at;
    ps.machine = next.machine;
    p.run(next.effect);
    // a scrub follows every move of its pointer, from the press on (no threshold)
    if (ps.scrubbing !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.scrub(at, modifierOf(event));
    // a gradient stop follows every move of its pointer, from the press on
    if (ps.stopping !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.moveStop(at);
    // the timeline's playhead and a keyframe's marker follow every move of their pointer (specs timeline-preview,
    // timeline-keyframes)
    if (ps.playheading !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.movePlayhead(at);
    if (ps.keyframing !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.moveKeyframe(at);
    // a shadow's light follows every move of its pointer, from the press on
    if (ps.lighting !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.moveLight(at);
    // a shadow's layer row follows the pointer too (A3.34)
    if (ps.layering !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.moveLayer(at);
    // a row of the Explorer's tree marks the folder the pointer is over (spec explorer-file-system)
    if (ps.exploring !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.moveExplorer(at);
    // a column of the Data panel marks the element's part the pointer is over (spec content-data)
    if (ps.columning !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.moveColumn(at);
    // the quick panel follows every move of its pointer, from the press on
    if (ps.gripping !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.moveGrip(at);
    // a splitter follows every move of its pointer, from the press on (no threshold)
    if (ps.splitting !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.resize(at);
    // a dragged panel's hint follows every move of its pointer (spec floating-panels)
    if (ps.panelling !== null && ps.machine.phase !== 'idle' && event.pointerId === ps.machine.pointer) p.movePanelHint(at);
    // the gesture's drag in progress, if any: the marquee's band, or the drop proposal of an element or a tile (over
    // the page: the canvas overlay is what the pointer is on)
    if (ps.machine.phase === 'dragging' && event.pointerId === ps.machine.pointer) {
      p.capture(event.pointerId);
      p.drawMarquee(at);
      p.moveFree(at, event.ctrlKey);
      p.over(at, press !== null && press !== 'elsewhere' && press.on === 'node');
    }
  };
  const onUp = (event: PointerEvent) => {
    setPressing(false);
    if (event.pointerId === ps.captured) ps.captured = null;
    // the key held at the release: the duplicate's (spec drag-duplicate)
    ps.releaseModifier = modifierOf(event);
    if (ps.repeating !== null && event.pointerId === ps.repeating.pointer) {
      p.stopRepeating();
      return;
    }
    // a slider's release: what it was left on, written once through the field's own commit (A3.30)
    if (ps.sliding !== null) {
      if (event.pointerId !== ps.sliding.pointer) return;
      const { element, commit } = ps.sliding;
      ps.sliding = null;
      if (element.isConnected) commit(element.value);
      return;
    }
    if (ps.pickingColor !== null) {
      if (event.pointerId === ps.pickingColor.pointer) ps.pickingColor = null;
      return;
    }
    // a pointer tool's release: what it means runs through the gesture open now, one undo step
    if (ps.tooling !== null) {
      if (event.pointerId !== ps.tooling.pointer) return;
      const { session, gesture } = ps.tooling;
      ps.tooling = null;
      if (shared.open === gesture) shared.open = null;
      session.release(toolPoint(event), gesture);
      gesture.commit();
      return;
    }
    if (ps.spacing !== null) {
      if (event.pointerId !== ps.spacing.pointer) return;
      const { gesture, entry, opposite, element } = ps.spacing;
      ps.spacing = null;
      setBanding(null);
      if (gesture !== null) {
        shared.open = null;
        gesture.commit();
        return;
      }
      // a band pressed and released without a drag: its typed field; any other handle: the focus, for its arrows
      if (opposite !== '') typedBand.open(entry.ref);
      else element.focus();
      return;
    }
    if (ps.guiding !== null) {
      if (event.pointerId !== ps.guiding.pointer) return;
      const { gesture, kind, guide } = ps.guiding;
      const dropped = guideOverRuler.get() !== null;
      ps.guiding = null;
      setGuideOnRuler(null);
      if (gesture === null) return;
      shared.open = null;
      // over its own ruler: a new guide is not made, a moved one is deleted
      if (dropped && kind === 'create') {
        gesture.cancel();
        return;
      }
      if (dropped && guide !== null && GUIDE_DELETE !== null) gesture.dispatch(GUIDE_DELETE.command.id as CommandId, { ...GUIDE_DELETE.door.args, guide } as never);
      gesture.commit();
      return;
    }
    if (ps.rotating !== null) {
      if (event.pointerId !== ps.rotating.pointer) return;
      const { gesture } = ps.rotating;
      ps.rotating = null;
      if (gesture !== null) {
        shared.open = null;
        gesture.commit();
      }
      return;
    }
    if (ps.resizing !== null) {
      if (event.pointerId !== ps.resizing.pointer) return;
      const { gesture, start } = ps.resizing;
      setResizing(null);
      ps.resizing = null;
      snapShown.set(null);
      if (gesture !== null) {
        shared.open = null;
        gesture.commit();
        return;
      }
      // a handle pressed and released without a drag is a click on what lies under it (a neighbour the handle, drawn
      // outside its element, covers): the press and the release run as they would have there
      const frame = canvasFrame();
      const hit = frame ? nodeAt(frame, start) : null;
      if (hit === null) return;
      p.leaveField();
      ps.buttons = { button: 'primary', count: 1, modifier: modifierOf(event) };
      ps.pointerAt = start;
      const down = step(ps.machine, { type: 'down', pointer: event.pointerId, at: start, press: { on: 'node', node: hit.node, root: hit.root } });
      if (down.effect === 'press') ps.pressedAt = { screen: start, page: p.pagePoint(start) };
      ps.machine = down.machine;
      p.run(down.effect);
      const up = step(ps.machine, { type: 'up', pointer: event.pointerId });
      ps.machine = up.machine;
      p.run(up.effect);
      return;
    }
    if (shared.panning !== null) {
      if (event.pointerId !== shared.panning.pointer) return;
      shared.panning = null;
      setPanView(shared.spaceDown ? 'armed' : 'idle');
      return;
    }
    const next = step(ps.machine, { type: 'up', pointer: event.pointerId });
    ps.machine = next.machine;
    p.run(next.effect);
  };
  const onCancel = () => {
    setPressing(false);
    ps.captured = null;
    ps.sliding = null;
    p.stopRepeating();
    p.dropHandleGestures();
    const next = step(ps.machine, { type: 'cancel' });
    ps.machine = next.machine;
    p.run(next.effect);
    setHovered(null);
  };
  // the capture lost while the button is still down (the pointer taken away): as a cancelled pointer
  const onLostCapture = (event: PointerEvent) => {
    if (event.pointerId !== ps.captured) return;
    ps.captured = null;
    if (pointerPressing()) p.onCancel();
  };
  // While a press on the canvas is held, the browser neither selects the editor's text nor starts its own drag and
  // drop of it: a native drag would take the pointer away (pointercancel) and end the gesture.
  const onNative = (event: Event) => {
    if (ps.machine.phase !== 'idle') event.preventDefault();
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
    const keep = ps.keepFocus;
    ps.keepFocus = false;
    const toolbar = editedNode(store.getState()) !== null && onTextToolbar(event.target);
    if (keep || toolbar || onOwnOption(event.target) || (event.button === 2 && event.target instanceof Element && event.target.closest(EDITOR_MENU_AREA))) event.preventDefault();
  };
  return { onDoubleClick, onDown, onMove, onUp, onCancel, onLostCapture, onNative, onContextMenu, onMouseDown };
}

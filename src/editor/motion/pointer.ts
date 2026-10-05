// The Timeline's drags, for the pointer owner (src/editor/input/pointer.ts; spec motion-timeline, Hit zones and
// thresholds): the one place that turns a pointer's travel over the track into the arguments of a motion command.
// The pointer owner keeps every listener: on a press on a control whose door is one of MOTION_DRAG_SOURCES it reads the
// control's data-args and the track's left edge (the closest [data-motion-track]) and calls motionPress; on every move
// it calls motionDragArgs with the pointer's x and dispatches the door's command with what comes back, in a gesture of
// its own opened anew at every move (so Escape puts everything back), as it does for the CSS animations' keyframes.
//  - A bar moves the selected bars with it when it is one of them; a keyframe, the selected keyframes.
//  - The dragged edge snaps to the timeline's start, the playhead, the other bars' edges, the other keyframes and the
//    markers within motion.snapDistance, else to motion.snapGrid; Alt held, or snapping turned off, moves it freely.
//  - The playhead follows the pointer along the ruler, snapping alike; a press with no travel puts it under the press.
import type { StoreState } from '../../core/store/store.ts';
import { findTimeline } from '../../core/motion/document.ts';
import type { MotionTimeline } from '../../core/motion/model.ts';
import { allKeyframes, actionEnd, type KeyframeRef } from '../../core/motion/timeline.ts';
import { snapTargets, snappedDelta, snapTime, xToTime } from '../../core/motion/view.ts';
import { numberConstant } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';
import { motionUiOf, shownTimeline, viewOf } from './state.ts';

// the panel-drag sources of manifest/commands/motion.json, the controls the pointer owner presses
const MOTION_DRAG_SOURCES = ['motion-bar', 'motion-bar-start', 'motion-bar-end', 'motion-keyframe', 'motion-marker', 'motion-playhead'] as const;
export type MotionDragSource = (typeof MOTION_DRAG_SOURCES)[number];
export const isMotionDragSource = (source: string): source is MotionDragSource => (MOTION_DRAG_SOURCES as readonly string[]).includes(source);

export interface MotionPress {
  readonly source: MotionDragSource;
  // the pressed control's own arguments (its data-args)
  readonly args: Readonly<Record<string, unknown>>;
  // the track's left edge and the pointer's x at the press, in the panel's css px
  readonly trackLeft: number;
  readonly startX: number;
}

export const motionPress = (source: MotionDragSource, args: Readonly<Record<string, unknown>>, trackLeft: number, startX: number): MotionPress => ({ source, args, trackLeft, startX });

const isRef = (value: unknown): value is KeyframeRef => value !== null && typeof value === 'object' && typeof (value as KeyframeRef).action === 'string' && typeof (value as KeyframeRef).track === 'string' && typeof (value as KeyframeRef).keyframe === 'string';
const sameRef = (a: KeyframeRef, b: KeyframeRef): boolean => a.action === b.action && a.track === b.track && a.keyframe === b.keyframe;

// The arguments the drag's command runs with at this x, or null when what was pressed is gone (another command
// removed it while the pointer was down). `free` is the Alt key: no snapping.
export function motionDragArgs(press: MotionPress, state: StoreState<EditorUi>, x: number, free: boolean): Readonly<Record<string, unknown>> | null {
  const motion = motionUiOf(state.ui);
  const view = viewOf(motion);
  const distance = x - press.startX;
  const snapping = !free && motion.snapOff !== true;
  const tolerance = snapping ? numberConstant('motion.snapDistance') : 0;
  const grid = snapping ? numberConstant('motion.snapGrid') : 0;
  if (press.source === 'motion-playhead') {
    const name = shownTimeline(state);
    const found = name === null ? null : findTimeline(state.document, name);
    const raw = xToTime(view, x - press.trackLeft);
    const time = found === null || !snapping ? raw : snapTime(raw, snapTargets(found.timeline, motion.time), view, tolerance, grid).time;
    return { ...press.args, time, distance };
  }
  const name = typeof press.args.timeline === 'string' ? press.args.timeline : null;
  const found = name === null ? null : findTimeline(state.document, name);
  if (found === null) return null;
  const timeline: MotionTimeline = found.timeline;
  const raw = Math.round((distance / view.pixelsPerSecond) * 1000);
  const action = timeline.actions.find((one) => one.id === press.args.action);
  switch (press.source) {
    case 'motion-bar': {
      if (action === undefined) return null;
      // the selected bars move together when the pressed one is among them
      const selected = motion.selectedActions ?? [];
      const ids = selected.includes(action.id) ? selected : [action.id];
      const moving = timeline.actions.filter((one) => ids.includes(one.id));
      const edge = Math.min(...moving.map((one) => one.start));
      const snapped = snappedDelta(edge, raw, snapTargets(timeline, motion.time, { actions: new Set(ids) }), view, tolerance, grid);
      return { timeline: timeline.name, actions: ids, delta: snapped.delta, distance };
    }
    case 'motion-bar-start':
    case 'motion-bar-end': {
      if (action === undefined) return null;
      const edge = press.source === 'motion-bar-start' ? action.start : actionEnd(action);
      const snapped = snappedDelta(edge, raw, snapTargets(timeline, motion.time, { actions: new Set([action.id]) }), view, tolerance, grid);
      return { timeline: timeline.name, action: action.id, edge: press.source === 'motion-bar-start' ? 'start' : 'end', delta: snapped.delta, distance };
    }
    case 'motion-keyframe': {
      const pressed = press.args.keyframe;
      if (!isRef(pressed)) return null;
      const selected = motion.selectedKeyframes ?? [];
      const refs = selected.some((one) => sameRef(one, pressed)) ? selected : [pressed];
      const at = allKeyframes(timeline).find((one) => sameRef(one.ref, pressed));
      if (at === undefined) return null;
      const snapped = snappedDelta(at.time, raw, snapTargets(timeline, motion.time, { keyframes: new Set(refs.map((one) => one.keyframe)) }), view, tolerance, grid);
      return { timeline: timeline.name, keyframes: refs, delta: snapped.delta, distance };
    }
    case 'motion-marker': {
      const marker = timeline.markers.find((one) => one.id === press.args.marker);
      if (marker === undefined) return null;
      const targets = snapTargets(timeline, motion.time).filter((target) => !(target.kind === 'marker' && target.time === marker.time));
      const snapped = snappedDelta(marker.time, raw, targets, view, tolerance, grid);
      return { timeline: timeline.name, marker: marker.id, delta: snapped.delta, distance };
    }
  }
}

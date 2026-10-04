// The edits of a timeline (spec motion-timeline): pure functions from one MotionTimeline to the next, which the
// commands (commands.ts) write as patches. Times are whole ms; an action's keyframes are timed from its own start.
//  - Sequence or parallel: a new action starts after everything already there ends (sequence), with the last action
//    added (parallel), or at a time the person chose (the playhead). What is stored is the start itself.
//  - A group of bars moves by one shared delta, clamped so none starts before 0; a bar resized from either edge keeps
//    its other edge and scales its keyframes with it.
//  - Keyframes move by one shared delta too, clamped so none leaves its action nor passes a keyframe that stays.
//  - Copied keyframes keep their spacing; pasted at a time they land relative to it, replacing a keyframe at the same
//    time of the same property, and the action grows to hold them.
import { EFFECTS } from './catalog.ts';
import type { Effect, Marker, MotionKeyframe, MotionTimeline, PropertyTrack, TimelineAction } from './model.ts';

// ---------------------------------------------------------------- durations

// the repeats an action plays; an infinite action is drawn and sequenced as one cycle
const cycles = (action: TimelineAction): number => (action.repeat === 'infinite' ? 1 : (action.repeat ?? 1));
export const actionEnd = (action: TimelineAction): number => action.start + action.duration * cycles(action);

// The length of a timeline: where its last action ends or its last marker sits (an empty timeline lasts 0).
export function timelineDuration(timeline: MotionTimeline): number {
  return Math.max(0, ...timeline.actions.map(actionEnd), ...timeline.markers.map((marker) => marker.time));
}

export type Placement = 'after' | 'with' | 'at';

// Where a new action starts: after the end of everything (sequence), at the start of the last action added
// (parallel), or at the time given (the playhead).
export function placementStart(timeline: MotionTimeline, placement: Placement, time: number): number {
  if (placement === 'at') return Math.max(0, Math.round(time));
  const last = timeline.actions[timeline.actions.length - 1];
  if (placement === 'with') return last?.start ?? 0;
  return Math.max(0, ...timeline.actions.map(actionEnd));
}

// ---------------------------------------------------------------- actions

const keyframesOf = (effect: Effect): readonly PropertyTrack[] | null => (effect.kind === 'animate' || effect.kind === 'split-text' ? effect.tracks : null);
const withTracks = (effect: Effect, tracks: readonly PropertyTrack[]): Effect => (effect.kind === 'animate' || effect.kind === 'split-text' ? { ...effect, tracks } : effect);

export const addAction = (timeline: MotionTimeline, action: TimelineAction): MotionTimeline => ({ ...timeline, actions: [...timeline.actions, action] });

export function removeActions(timeline: MotionTimeline, ids: ReadonlySet<string>): MotionTimeline {
  return { ...timeline, actions: timeline.actions.filter((action) => !ids.has(action.id)) };
}

export function replaceAction(timeline: MotionTimeline, id: string, change: (action: TimelineAction) => TimelineAction): MotionTimeline {
  return { ...timeline, actions: timeline.actions.map((action) => (action.id === id ? change(action) : action)) };
}

// The delta a group of actions moves by: the one asked, clamped so the earliest of them starts at 0 at the soonest.
export function clampActionDelta(timeline: MotionTimeline, ids: ReadonlySet<string>, delta: number): number {
  const moving = timeline.actions.filter((action) => ids.has(action.id));
  if (moving.length === 0) return 0;
  return Math.max(Math.round(delta), -Math.min(...moving.map((action) => action.start)));
}

export function moveActions(timeline: MotionTimeline, ids: ReadonlySet<string>, delta: number): MotionTimeline {
  const shared = clampActionDelta(timeline, ids, delta);
  if (shared === 0) return timeline;
  return { ...timeline, actions: timeline.actions.map((action) => (ids.has(action.id) ? { ...action, start: action.start + shared } : action)) };
}

// The keyframes of a track scaled from one duration to another, two that land on the same ms kept as the later one.
function scaleKeyframes(keyframes: readonly MotionKeyframe[], from: number, to: number): MotionKeyframe[] {
  const scaled = keyframes.map((keyframe) => ({ ...keyframe, time: from === 0 ? 0 : Math.round((keyframe.time * to) / from) }));
  return scaled.filter((keyframe, index) => scaled[index + 1]?.time !== keyframe.time);
}

// An action with a new duration, its keyframes scaled with it.
export function withDuration(action: TimelineAction, duration: number): TimelineAction {
  const next = Math.max(0, Math.round(duration));
  const tracks = keyframesOf(action.effect);
  if (tracks === null) return { ...action, duration: next };
  const scaled = tracks.map((track) => ({ ...track, keyframes: scaleKeyframes(track.keyframes, action.duration, next) }));
  return { ...action, duration: next, effect: withTracks(action.effect, scaled) };
}

// A bar resized by its start edge (its end stays) or its end edge (its start stays). The duration never falls under
// `minimum` (a timed action keeps a visible length), and an instant action has no length to change.
export function resizeAction(timeline: MotionTimeline, id: string, edge: 'start' | 'end', delta: number, minimum: number): MotionTimeline {
  return replaceAction(timeline, id, (action) => {
    if (!EFFECTS[action.effect.kind].timed) return action;
    const shift = Math.round(delta);
    if (edge === 'end') return withDuration(action, Math.max(minimum, action.duration + shift));
    const end = action.start + action.duration;
    const start = Math.min(Math.max(0, action.start + shift), Math.max(0, end - minimum));
    return { ...withDuration(action, end - start), start };
  });
}

// ---------------------------------------------------------------- keyframes

// A keyframe of a timeline, by its action, its track and its own id.
export interface KeyframeRef {
  readonly action: string;
  readonly track: string;
  readonly keyframe: string;
}

const refKey = (ref: KeyframeRef): string => `${ref.action}/${ref.track}/${ref.keyframe}`;

// A keyframe set on a property of an action at a time of that action: added in time order (and the track with it when
// the property has none), or the value and easing replaced when a keyframe sits at that time already.
export function setKeyframeAt(action: TimelineAction, property: string, time: number, value: string, easing: string | undefined, id: () => string): TimelineAction {
  const tracks = keyframesOf(action.effect);
  if (tracks === null) return action;
  const at = Math.min(action.duration, Math.max(0, Math.round(time)));
  const written = (keyframe: MotionKeyframe): MotionKeyframe => {
    const { easing: _old, ...rest } = keyframe;
    void _old;
    return easing === undefined ? { ...rest, value } : { ...rest, value, easing };
  };
  const track = tracks.find((one) => one.property === property);
  if (track === undefined) {
    const keyframe = written({ id: id(), time: at, value });
    return { ...action, effect: withTracks(action.effect, [...tracks, { id: id(), property, keyframes: [keyframe] }]) };
  }
  const existing = track.keyframes.find((keyframe) => keyframe.time === at);
  const keyframes = existing !== undefined ? track.keyframes.map((keyframe) => (keyframe === existing ? written(keyframe) : keyframe)) : [...track.keyframes, written({ id: id(), time: at, value })].sort((a, b) => a.time - b.time);
  return { ...action, effect: withTracks(action.effect, tracks.map((one) => (one === track ? { ...one, keyframes } : one))) };
}

// The value, easing or time of one keyframe changed. A time is clamped inside the action and between its neighbours.
export function editKeyframe(timeline: MotionTimeline, ref: KeyframeRef, change: { readonly value?: string; readonly easing?: string | null; readonly time?: number }): MotionTimeline {
  return replaceAction(timeline, ref.action, (action) => {
    const tracks = keyframesOf(action.effect);
    if (tracks === null) return action;
    return {
      ...action,
      effect: withTracks(
        action.effect,
        tracks.map((track) => {
          if (track.id !== ref.track) return track;
          const index = track.keyframes.findIndex((keyframe) => keyframe.id === ref.keyframe);
          const keyframe = track.keyframes[index];
          if (keyframe === undefined) return track;
          let next: MotionKeyframe = keyframe;
          if (change.value !== undefined) next = { ...next, value: change.value };
          if (change.easing === null) {
            const { easing: _dropped, ...rest } = next;
            void _dropped;
            next = rest;
          } else if (change.easing !== undefined) next = { ...next, easing: change.easing };
          if (change.time !== undefined) {
            const low = (track.keyframes[index - 1]?.time ?? -1) + 1;
            const high = (track.keyframes[index + 1]?.time ?? action.duration + 1) - 1;
            next = { ...next, time: Math.min(high, Math.max(low, Math.round(change.time))) };
          }
          return { ...track, keyframes: track.keyframes.map((one) => (one === keyframe ? next : one)) };
        }),
      ),
    };
  });
}

// The delta a group of keyframes moves by: the one asked, clamped so every moved keyframe stays inside its action and
// strictly between the keyframes of its track that do not move.
export function clampKeyframeDelta(timeline: MotionTimeline, refs: readonly KeyframeRef[], delta: number): number {
  const moving = new Set(refs.map(refKey));
  let low = -Infinity;
  let high = Infinity;
  for (const action of timeline.actions) {
    for (const track of keyframesOf(action.effect) ?? []) {
      track.keyframes.forEach((keyframe, index) => {
        if (!moving.has(refKey({ action: action.id, track: track.id, keyframe: keyframe.id }))) return;
        // the nearest keyframe before and after it that stays
        let before = -1;
        for (let at = index - 1; at >= 0; at -= 1) {
          const other = track.keyframes[at] as MotionKeyframe;
          if (!moving.has(refKey({ action: action.id, track: track.id, keyframe: other.id }))) {
            before = other.time;
            break;
          }
        }
        let after = action.duration + 1;
        for (let at = index + 1; at < track.keyframes.length; at += 1) {
          const other = track.keyframes[at] as MotionKeyframe;
          if (!moving.has(refKey({ action: action.id, track: track.id, keyframe: other.id }))) {
            after = other.time;
            break;
          }
        }
        low = Math.max(low, before + 1 - keyframe.time);
        high = Math.min(high, after - 1 - keyframe.time);
      });
    }
  }
  if (low === -Infinity) return 0;
  return Math.min(high, Math.max(low, Math.round(delta)));
}

export function moveKeyframes(timeline: MotionTimeline, refs: readonly KeyframeRef[], delta: number): MotionTimeline {
  const shared = clampKeyframeDelta(timeline, refs, delta);
  if (shared === 0) return timeline;
  const moving = new Set(refs.map(refKey));
  return {
    ...timeline,
    actions: timeline.actions.map((action) => {
      const tracks = keyframesOf(action.effect);
      if (tracks === null) return action;
      const moved = tracks.map((track) => ({
        ...track,
        keyframes: track.keyframes.map((keyframe) => (moving.has(refKey({ action: action.id, track: track.id, keyframe: keyframe.id })) ? { ...keyframe, time: keyframe.time + shared } : keyframe)),
      }));
      return { ...action, effect: withTracks(action.effect, moved) };
    }),
  };
}

// The keyframes deleted; a track left with no keyframe goes, so the animation keys that property no more.
export function deleteKeyframes(timeline: MotionTimeline, refs: readonly KeyframeRef[]): MotionTimeline {
  const going = new Set(refs.map(refKey));
  const actions = timeline.actions.map((action) => {
    const tracks = keyframesOf(action.effect);
    if (tracks === null) return action;
    const kept = tracks
      .map((track) => ({ ...track, keyframes: track.keyframes.filter((keyframe) => !going.has(refKey({ action: action.id, track: track.id, keyframe: keyframe.id }))) }))
      .filter((track) => track.keyframes.length > 0);
    return { ...action, effect: withTracks(action.effect, kept) };
  });
  return { ...timeline, actions };
}

// Copied keyframes (the editor's clipboard of the timeline): each keyframe's property, its time from the earliest
// copied one, its value and easing.
export interface CopiedKeyframe {
  readonly property: string;
  readonly offset: number;
  readonly value: string;
  readonly easing?: string;
}

export function copyKeyframes(timeline: MotionTimeline, refs: readonly KeyframeRef[]): CopiedKeyframe[] {
  const chosen = new Set(refs.map(refKey));
  const found: { property: string; time: number; keyframe: MotionKeyframe }[] = [];
  for (const action of timeline.actions) {
    for (const track of keyframesOf(action.effect) ?? []) {
      for (const keyframe of track.keyframes) {
        if (chosen.has(refKey({ action: action.id, track: track.id, keyframe: keyframe.id }))) found.push({ property: track.property, time: action.start + keyframe.time, keyframe });
      }
    }
  }
  if (found.length === 0) return [];
  const first = Math.min(...found.map((one) => one.time));
  return found
    .sort((a, b) => a.time - b.time)
    .map(({ property, time, keyframe }) => ({ property, offset: time - first, value: keyframe.value, ...(keyframe.easing === undefined ? {} : { easing: keyframe.easing }) }));
}

// Copied keyframes pasted into an action from a time of the timeline: each lands at that time plus its offset, the
// action's duration growing to hold the last one (a pasted keyframe before the action's start is refused: null).
export function pasteKeyframes(timeline: MotionTimeline, actionId: string, time: number, copied: readonly CopiedKeyframe[], id: () => string): MotionTimeline | null {
  const action = timeline.actions.find((one) => one.id === actionId);
  if (action === undefined || keyframesOf(action.effect) === null || copied.length === 0) return null;
  const local = Math.round(time) - action.start;
  if (local < 0) return null;
  const last = local + Math.max(...copied.map((one) => one.offset));
  let next = last > action.duration ? { ...action, duration: last } : action;
  for (const one of copied) next = setKeyframeAt(next, one.property, local + one.offset, one.value, one.easing, id);
  return replaceAction(timeline, actionId, () => next);
}

// ---------------------------------------------------------------- markers

export const addMarker = (timeline: MotionTimeline, marker: Marker): MotionTimeline => ({ ...timeline, markers: [...timeline.markers, marker].sort((a, b) => a.time - b.time) });

export function moveMarker(timeline: MotionTimeline, id: string, delta: number): MotionTimeline {
  return { ...timeline, markers: timeline.markers.map((marker) => (marker.id === id ? { ...marker, time: Math.max(0, marker.time + Math.round(delta)) } : marker)).sort((a, b) => a.time - b.time) };
}

export const renameMarker = (timeline: MotionTimeline, id: string, name: string): MotionTimeline => ({ ...timeline, markers: timeline.markers.map((marker) => (marker.id === id ? { ...marker, name } : marker)) });
export const removeMarker = (timeline: MotionTimeline, id: string): MotionTimeline => ({ ...timeline, markers: timeline.markers.filter((marker) => marker.id !== id) });

// ---------------------------------------------------------------- reading

// A keyframe's absolute time on the timeline.
export const absoluteTime = (action: TimelineAction, keyframe: MotionKeyframe): number => action.start + keyframe.time;

// Every keyframe of a timeline, with what it belongs to and where it sits.
export function allKeyframes(timeline: MotionTimeline): { readonly ref: KeyframeRef; readonly property: string; readonly time: number; readonly keyframe: MotionKeyframe }[] {
  const found: { ref: KeyframeRef; property: string; time: number; keyframe: MotionKeyframe }[] = [];
  for (const action of timeline.actions) {
    for (const track of keyframesOf(action.effect) ?? []) {
      for (const keyframe of track.keyframes) found.push({ ref: { action: action.id, track: track.id, keyframe: keyframe.id }, property: track.property, time: absoluteTime(action, keyframe), keyframe });
    }
  }
  return found;
}

export const tracksOf = keyframesOf;

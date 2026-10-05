// The timeline's subject and its playhead (INVENTORY.md, owners; specs timeline-keyframes and
// timeline-preview): `ui.timeline` — which animation of the selected element the panel shows, where the playhead sits
// (ms), whether it plays and whether it loops — with the two commands that move them (timeline.show, the playhead of
// the animation the panel has open; timeline.setPlayhead, where it sits) and the readers the panel, the keyframe style
// writes and the canvas preview ask. Both commands write editor state alone: no undo step, nothing of the document.
//  - The shown animation: the one `ui.timeline.shown` names on the primary selected element, else that element's first.
//  - The playhead's percent of the shown animation: time ÷ the animation's duration; the keyframe under it is the one
//    whose offset is that whole percent, and while it holds one the inspector edits the keyframe's values, not the
//    element's styles (core/style/set.ts: HandlerContext.keyframe).
//  - The track's geometry: interactions.json timeline.trackWidth (the track is this many css px wide, whatever the
//    panel's own width), timeline.snapPercent (a playhead moved from the ruler snaps to a keyframe within this many
//    percent) and timeline.playheadStep (else it rounds to this step of percent).
import { message, registerHandler, type KeyframeTarget } from '../../core/commands/registry.ts';
import { locate, type Animation, type DocNode, type Keyframe, type NodeId } from '../../core/document/model.ts';
import { animationsOf, durationMs } from '../../core/animation/animation.ts';
import { manifest, numberConstant, pairConstant, type DoorEntry } from '../../manifest/runtime.ts';
import type { StoreState } from '../../core/store/store.ts';
import type { EditorUi } from '../state.ts';

export interface TimelineState {
  // the animation the panel shows, by name; absent while it is the selected element's first
  readonly shown?: string | undefined;
  // where the playhead sits, in ms of the shown animation
  readonly time: number;
  // whether the shown animation plays on the canvas (spec timeline-preview)
  readonly playing?: true | undefined;
  // whether playing repeats it
  readonly loop?: true | undefined;
  // Whether the canvas draws the shown animation at the playhead: set by a scrub and by Play, cleared by Stop, so the
  // element shows its own styles until the timeline previews something and again after Stop.
  readonly live?: true | undefined;
}
const INITIAL_TIMELINE: TimelineState = { time: 0 };
export const timelineOf = (ui: EditorUi): TimelineState => ui.timeline ?? INITIAL_TIMELINE;

export const trackWidth = (): number => numberConstant('timeline.trackWidth');
const snapPercent = (): number => numberConstant('timeline.snapPercent');
const playheadStep = (): number => numberConstant('timeline.playheadStep');

// The animation the timeline shows: the one `shown` names on the element the selection is, else the element's first;
// null with nothing selected, or when the element holds no animation.
export interface Shown {
  readonly node: DocNode;
  readonly animation: Animation;
}
export function shownAnimation(state: StoreState<EditorUi>): Shown | null {
  const primary = state.selection[0];
  if (primary === undefined) return null;
  const found = locate(state.document, primary);
  if (found === null) return null;
  const held = animationsOf(found.node);
  const chosen = held.find((animation) => animation.name === timelineOf(state.ui).shown) ?? held[0];
  return chosen === undefined ? null : { node: found.node, animation: chosen };
}

// where the playhead sits along the shown animation, in percent (0 to 100)
export function playheadPercent(state: StoreState<EditorUi>): number {
  const shown = shownAnimation(state);
  if (shown === null) return 0;
  const duration = durationMs(shown.animation);
  return duration <= 0 ? 0 : Math.min(100, Math.max(0, (timelineOf(state.ui).time / duration) * 100));
}

// The keyframe the playhead sits on: the shown animation's keyframe whose offset is the playhead's whole percent; null
// while it sits between two keyframes (then the inspector edits the element's styles, as usual).
export function keyframeAtPlayhead(state: StoreState<EditorUi>): (Shown & { readonly keyframe: Keyframe }) | null {
  const shown = shownAnimation(state);
  if (shown === null) return null;
  const percent = Math.round(playheadPercent(state));
  const keyframe = shown.animation.keyframes.find((k) => k.offset === percent);
  return keyframe === undefined ? null : { ...shown, keyframe };
}

// What a style write lands on while the playhead sits on a keyframe (HandlerContext.keyframe: registry.ts): the
// element, the animation's name and the offset. Null while the selection is elsewhere or the playhead is between
// keyframes (then the inspector edits the element's styles, as usual).
export function keyframeTarget(state: StoreState<EditorUi>): KeyframeTarget | null {
  const at = keyframeAtPlayhead(state);
  return at === null ? null : { node: at.node.id as NodeId, animation: at.animation.name, keyframe: at.keyframe.offset };
}

// the time an offset of a shown animation sits at, in whole ms
function timeOfPercent(animation: Animation, percent: number): number {
  return Math.round((durationMs(animation) * Math.min(100, Math.max(0, percent))) / 100);
}

// Where a pointer at this x of the track lands as a keyframe offset (a whole percent, clamped to the manifest's
// timeline.offsetRange): a keyframe's drag follows the pointer exactly.
export function offsetFromTrackX(x: number): number {
  const [low, high] = pairConstant('timeline.offsetRange');
  const raw = (x / trackWidth()) * 100;
  return Math.min(high, Math.max(low, Math.round(raw)));
}
// where an offset is drawn along the track, in the track's own pixels
const trackXOfOffset = (offset: number): number => (offset / 100) * trackWidth();

// Where a pointer at this x of the ruler puts the playhead, in whole ms of the shown animation (spec timeline-preview:
// a scrub follows the pointer; a click lands on the keyframe it is nearest, within timeline.snapPercent, else on the
// nearest whole step of timeline.playheadStep).
export function playheadTimeFromTrackX(animation: Animation, x: number): number {
  const raw = Math.min(100, Math.max(0, (x / trackWidth()) * 100));
  const nearest = animation.keyframes.reduce<{ readonly offset: number; readonly distance: number } | null>((best, keyframe) => {
    const distance = Math.abs(keyframe.offset - raw);
    return best === null || distance < best.distance ? { offset: keyframe.offset, distance } : best;
  }, null);
  const step = playheadStep();
  const percent = nearest !== null && nearest.distance <= snapPercent() ? nearest.offset : Math.round(raw / step) * step;
  return timeOfPercent(animation, percent);
}

export const showAnimationCommand = registerHandler<'timeline.show', EditorUi>('timeline.show', ({ state }, { animation }) => {
  const shown = shownAnimation(state);
  if (shown === null || shown.animation.name === animation) return { kind: 'change' };
  return { kind: 'change', ui: { ...state.ui, timeline: { ...timelineOf(state.ui), shown: animation, time: 0 } }, message: message('status.timeline.shown', { name: animation }) };
});

export const setPlayheadCommand = registerHandler<'timeline.setPlayhead', EditorUi>('timeline.setPlayhead', ({ state }, { time }) => {
  // the time is what the ruler's click or drag produces (the manifest marks it optional: the gesture gives it)
  if (time === undefined) return { kind: 'change' };
  const shown = shownAnimation(state);
  const duration = shown === null ? 0 : durationMs(shown.animation);
  const clamped = Math.min(duration, Math.max(0, Math.round(time)));
  const timeline = timelineOf(state.ui);
  if (timeline.time === clamped && timeline.live === true) return { kind: 'change' };
  // a scrub draws the element at the playhead (spec timeline-preview); Stop is what takes the preview away again
  return { kind: 'change', ui: { ...state.ui, timeline: { ...timeline, time: clamped, live: true } } };
});

// The door the timeline's ruler stands for (the playhead's drag, spec timeline-preview): the panel draws it and the
// frame's playing loop names the command it runs.
export const PLAYHEAD_DOOR: DoorEntry | null = manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'playhead') ?? null;

// The keyframes of an animation drawn along the track: their offset and the x they sit at, in the track's pixels.
export const keyframeMarks = (animation: Animation): readonly { readonly offset: number; readonly x: number }[] =>
  animation.keyframes.map((keyframe) => ({ offset: keyframe.offset, x: trackXOfOffset(keyframe.offset) }));

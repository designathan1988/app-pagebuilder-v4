// The Timeline's editor state for motion (INVENTORY.md, owners; spec motion-timeline): `ui.motion` — the
// timeline the panel shows, where the playhead sits, the zoom and the scroll of the seconds axis, the bars and
// keyframes selected, the copied keyframes, whether it records, snaps, previews or runs the canvas — with the editor
// commands that change it. None of them changes the document or records an undo step: the document's own commands are
// core/motion/commands.ts, which the panel's doors run with what this state says (the playhead's time, the selection,
// the clipboard).
import { message, registerHandler } from '../../core/commands/registry.ts';
import type { StoreState } from '../../core/store/store.ts';
import { locate } from '../../core/document/model.ts';
import { findTimeline, motionsOf, timelinesOf } from '../../core/motion/document.ts';
import type { MotionEditorContext, MotionRecordTarget } from '../../core/motion/record.ts';
import { copyKeyframes, timelineDuration, type CopiedKeyframe, type KeyframeRef } from '../../core/motion/timeline.ts';
import { zoomAt, type TimelineView } from '../../core/motion/view.ts';
import { numberConstant, pairConstant } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';

export interface MotionUiState {
  // the timeline the panel shows, by name; absent: the first timeline the selected element plays, else the first one
  readonly timeline?: string | undefined;
  // the playhead, in ms
  readonly time: number;
  readonly pixelsPerSecond: number;
  // the time at the track's left edge, in ms
  readonly scroll: number;
  readonly selectedActions?: readonly string[] | undefined;
  readonly selectedKeyframes?: readonly KeyframeRef[] | undefined;
  readonly clipboard?: readonly CopiedKeyframe[] | undefined;
  readonly recording?: true | undefined;
  // snapping is on unless the person turned it off
  readonly snapOff?: true | undefined;
  // the canvas draws the timeline at the playhead (set by a scrub and by Play, cleared by Stop)
  readonly previewing?: true | undefined;
  readonly playing?: true | undefined;
  // the canvas runs the interactions (spec motion-run-in-editor)
  readonly running?: true | undefined;
  // the action whose target the next press on the canvas or a Layers row gives
  readonly picking?: { readonly timeline: string; readonly action: string } | undefined;
}

const initialMotionUi = (): MotionUiState => ({ time: 0, pixelsPerSecond: numberConstant('motion.pixelsPerSecond'), scroll: 0 });
export const motionUiOf = (ui: EditorUi): MotionUiState => ui.motion ?? initialMotionUi();
const withMotion = (ui: EditorUi, motion: MotionUiState): EditorUi => ({ ...ui, motion });

export const viewOf = (motion: MotionUiState): TimelineView => ({ pixelsPerSecond: motion.pixelsPerSecond, scroll: motion.scroll });

// The timeline the panel shows: the one it names, else the first the selected element plays, else the project's first.
export function shownTimeline(state: StoreState<EditorUi>): string | null {
  const motion = motionUiOf(state.ui);
  if (motion.timeline !== undefined && findTimeline(state.document, motion.timeline) !== null) return motion.timeline;
  const primary = state.selection[0];
  const node = primary === undefined ? null : (locate(state.document, primary)?.node ?? null);
  const played = node === null ? undefined : motionsOf(node)[0]?.timeline;
  if (played !== undefined && findTimeline(state.document, played) !== null) return played;
  return timelinesOf(state.document)[0]?.name ?? null;
}

// What the commands read of the Timeline (the store's `motion` option, HandlerContext.motion): the playhead, and what a
// style write records into while the Timeline records.
export function motionContext(state: StoreState<EditorUi>): MotionEditorContext {
  return { playhead: motionUiOf(state.ui).time, recording: recordTarget(state) };
}

// What a style write records into while the Timeline records (core/motion/record.ts).
export function recordTarget(state: StoreState<EditorUi>): MotionRecordTarget | null {
  const motion = motionUiOf(state.ui);
  const timeline = shownTimeline(state);
  if (motion.recording !== true || timeline === null) return null;
  return { timeline, time: motion.time, action: motion.selectedActions?.length === 1 ? (motion.selectedActions[0] ?? null) : null };
}

// ---------------------------------------------------------------- picking an action's target

export const motionPicking = (ui: EditorUi): { readonly timeline: string; readonly action: string } | null => ui.motion?.picking ?? null;
export const makeMotionPicking = (ui: EditorUi, picking: { readonly timeline: string; readonly action: string }): EditorUi => withMotion(ui, { ...motionUiOf(ui), picking });
export function makeMotionPicked(ui: EditorUi): EditorUi {
  if (ui.motion?.picking === undefined) return ui;
  const { picking: _dropped, ...rest } = ui.motion;
  void _dropped;
  return withMotion(ui, rest);
}

// ---------------------------------------------------------------- the editor commands

export const openTimelineCommand = registerHandler<'motion.openTimeline', EditorUi>('motion.openTimeline', ({ state }, { timeline }) => {
  if (findTimeline(state.document, timeline) === null) return { kind: 'refused', message: message('status.motion.notFound', { name: timeline }) };
  const motion = motionUiOf(state.ui);
  if (motion.timeline === timeline) return { kind: 'change' };
  // another timeline starts at 0, nothing of the last one selected
  const { selectedActions: _a, selectedKeyframes: _k, previewing: _p, playing: _q, ...rest } = motion;
  void _a;
  void _k;
  void _p;
  void _q;
  return { kind: 'change', ui: withMotion(state.ui, { ...rest, timeline, time: 0 }), message: message('status.motion.timelineOpened', { name: timeline }) };
});

// the furthest the playhead goes, in ms (ten minutes: far past any timeline a page plays)
const LONGEST_PLAYHEAD = 600_000;

// The playhead: the time a click or a drag on the ruler gives (the pointer owner reads it from the ruler's x), clamped
// to the timeline's length; the canvas then draws the timeline there.
export const setMotionPlayheadCommand = registerHandler<'motion.setPlayhead', EditorUi>('motion.setPlayhead', ({ state }, { time }) => {
  if (time === undefined) return { kind: 'change' };
  const motion = motionUiOf(state.ui);
  // past the end is a place too: where the next action may start
  const clamped = Math.min(LONGEST_PLAYHEAD, Math.max(0, Math.round(time)));
  if (motion.time === clamped && motion.previewing === true) return { kind: 'change' };
  return { kind: 'change', ui: withMotion(state.ui, { ...motion, time: clamped, previewing: true }) };
});

// Zoom, about the playhead (or the x the wheel turned at), within the panel's limits.
export const zoomTimelineCommand = registerHandler<'motion.zoomTimeline', EditorUi>('motion.zoomTimeline', ({ state }, { factor, anchor }) => {
  const motion = motionUiOf(state.ui);
  const [min, max] = pairConstant('motion.zoomRange');
  const view = viewOf(motion);
  const at = anchor ?? ((motion.time - motion.scroll) / 1000) * motion.pixelsPerSecond;
  const next = zoomAt(view, factor, at, { min, max });
  if (next.pixelsPerSecond === motion.pixelsPerSecond && next.scroll === motion.scroll) return { kind: 'change' };
  return { kind: 'change', ui: withMotion(state.ui, { ...motion, pixelsPerSecond: next.pixelsPerSecond, scroll: next.scroll }) };
});

const isRefs = (value: unknown): value is KeyframeRef[] =>
  Array.isArray(value) && value.every((one) => one !== null && typeof one === 'object' && typeof (one as KeyframeRef).action === 'string' && typeof (one as KeyframeRef).track === 'string' && typeof (one as KeyframeRef).keyframe === 'string');
const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every((one) => typeof one === 'string');

// The bars and keyframes selected: a press selects what it lands on, a press with Shift adds to (or takes from) what is
// selected.
export const selectMotionCommand = registerHandler<'motion.select', EditorUi>('motion.select', ({ state }, { actions, keyframes, timeline, at, property, keyframeAt, add }) => {
  const motion = motionUiOf(state.ui);
  // a bar or a keyframe named by its place (the panel's controls, a scenario): the action at that place of the
  // timeline, and the keyframe at that place of the property's track
  const found = timeline === undefined ? null : findTimeline(state.document, timeline);
  const action = found === null || at === undefined ? undefined : found.timeline.actions[at];
  const tracks = action === undefined || (action.effect.kind !== 'animate' && action.effect.kind !== 'split-text') ? [] : action.effect.tracks;
  const track = property === undefined ? undefined : tracks.find((one) => one.property === property);
  const keyframe = track === undefined ? undefined : track.keyframes[keyframeAt ?? 0];
  const placedKeyframe: KeyframeRef[] = action !== undefined && track !== undefined && keyframe !== undefined ? [{ action: action.id, track: track.id, keyframe: keyframe.id }] : [];
  const placedAction: string[] = action !== undefined && property === undefined ? [action.id] : [];
  const pickedActions = isIds(actions) ? actions : placedAction;
  const pickedKeyframes = isRefs(keyframes) ? keyframes : placedKeyframe;
  const same = (a: KeyframeRef, b: KeyframeRef) => a.action === b.action && a.track === b.track && a.keyframe === b.keyframe;
  const toggleIn = <T,>(held: readonly T[], picked: readonly T[], equal: (a: T, b: T) => boolean): T[] => {
    const kept = held.filter((one) => !picked.some((other) => equal(one, other)));
    return [...kept, ...picked.filter((one) => !held.some((other) => equal(one, other)))];
  };
  const nextActions = add === true ? toggleIn(motion.selectedActions ?? [], pickedActions, (a, b) => a === b) : pickedActions;
  const nextKeyframes = add === true ? toggleIn(motion.selectedKeyframes ?? [], pickedKeyframes, same) : pickedKeyframes;
  return { kind: 'change', ui: withMotion(state.ui, { ...motion, selectedActions: nextActions, selectedKeyframes: nextKeyframes }) };
});

export const copyMotionKeyframesCommand = registerHandler<'motion.copyKeyframes', EditorUi>('motion.copyKeyframes', ({ state }) => {
  const motion = motionUiOf(state.ui);
  const name = shownTimeline(state);
  const found = name === null ? null : findTimeline(state.document, name);
  if (found === null || (motion.selectedKeyframes ?? []).length === 0) return { kind: 'refused', message: message('status.motion.nothingSelected') };
  const clipboard = copyKeyframes(found.timeline, motion.selectedKeyframes ?? []);
  return { kind: 'change', ui: withMotion(state.ui, { ...motion, clipboard }), message: message('status.motion.copied', { count: clipboard.length }) };
});

const toggle = (motion: MotionUiState, key: 'recording' | 'snapOff' | 'running'): MotionUiState => {
  if (motion[key] === true) {
    return Object.fromEntries(Object.entries(motion).filter(([name]) => name !== key)) as unknown as MotionUiState;
  }
  return { ...motion, [key]: true };
};

export const toggleRecordCommand = registerHandler<'motion.toggleRecord', EditorUi>(
  'motion.toggleRecord',
  ({ state }) => {
    const motion = motionUiOf(state.ui);
    if (motion.recording !== true && shownTimeline(state) === null) return { kind: 'refused', message: message('status.motion.noTimeline') };
    const next = toggle(motion, 'recording');
    return { kind: 'change', ui: withMotion(state.ui, next), message: message(next.recording === true ? 'status.motion.recordOn' : 'status.motion.recordOff') };
  },
  (state) => motionUiOf(state.ui).recording === true,
);

export const toggleSnapCommand = registerHandler<'motion.toggleSnap', EditorUi>(
  'motion.toggleSnap',
  ({ state }) => {
    const next = toggle(motionUiOf(state.ui), 'snapOff');
    return { kind: 'change', ui: withMotion(state.ui, next), message: message(next.snapOff === true ? 'status.motion.snapOff' : 'status.motion.snapOn') };
  },
  (state) => motionUiOf(state.ui).snapOff !== true,
);

// The canvas previews the open timeline: Play walks the playhead (the canvas owner's loop, as timeline/preview.ts
// does), Pause holds it, Stop puts the playhead at 0 and the elements back to their own styles.
export const previewMotionCommand = registerHandler<'motion.preview', EditorUi>(
  'motion.preview',
  ({ state }, { operation }) => {
    const motion = motionUiOf(state.ui);
    const name = shownTimeline(state);
    if (name === null) return { kind: 'refused', message: message('status.motion.noTimeline') };
    if (operation === 'play') return { kind: 'change', ui: withMotion(state.ui, { ...motion, previewing: true, playing: true }), message: message('status.motion.previewPlaying', { name }) };
    const { playing: _playing, ...paused } = motion;
    void _playing;
    if (operation === 'pause') return motion.playing === true ? { kind: 'change', ui: withMotion(state.ui, paused) } : { kind: 'change' };
    const { previewing: _previewing, ...stopped } = paused;
    void _previewing;
    return { kind: 'change', ui: withMotion(state.ui, { ...stopped, time: 0 }), message: message('status.motion.previewStopped') };
  },
  (state, args) => args.operation === 'play' && motionUiOf(state.ui).playing === true,
);

// Run mode (plan: "Executar interações"): the canvas runs the interactions as the page does, until it is turned off.
export const toggleRunCommand = registerHandler<'motion.toggleRun', EditorUi>(
  'motion.toggleRun',
  ({ state }) => {
    const next = toggle(motionUiOf(state.ui), 'running');
    return { kind: 'change', ui: withMotion(state.ui, next), message: message(next.running === true ? 'status.motion.running' : 'status.motion.stopped') };
  },
  (state) => motionUiOf(state.ui).running === true,
);

// The walk of the playhead while the preview plays, by what has passed since the last frame; at the end it stops (the
// canvas owner calls it from its frame loop, as installPlayingLoop does for a CSS animation).
export function nextPreviewTime(state: StoreState<EditorUi>, elapsed: number): { readonly time: number; readonly ended: boolean } | null {
  const motion = motionUiOf(state.ui);
  const name = shownTimeline(state);
  const found = name === null ? null : findTimeline(state.document, name);
  if (motion.playing !== true || found === null) return null;
  const duration = timelineDuration(found.timeline);
  const time = motion.time + elapsed;
  return time >= duration ? { time: duration, ended: true } : { time: Math.round(time), ended: false };
}

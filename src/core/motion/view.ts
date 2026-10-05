// The geometry of the Timeline panel (spec motion-timeline): a seconds axis with zoom, the ruler's ticks, the
// playhead's readout, the lanes (one per target, then one per property the target's animations key: the canonical
// layout of tracks per element and per property), and snapping. Pure: the panel draws what these say and the pointer
// owner (src/editor/input/pointer.ts) asks them where a drag lands.
import { allKeyframes, actionEnd, timelineDuration } from './timeline.ts';
import type { MotionTarget, MotionTimeline, TimelineAction } from './model.ts';

export interface TimelineView {
  // how many css px one second takes
  readonly pixelsPerSecond: number;
  // the time at the track's left edge, in ms (the track scrolls)
  readonly scroll: number;
}

export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

export const timeToX = (view: TimelineView, ms: number): number => ((ms - view.scroll) / 1000) * view.pixelsPerSecond;
export const xToTime = (view: TimelineView, x: number): number => Math.max(0, Math.round(view.scroll + (x / view.pixelsPerSecond) * 1000));

// A zoom by a factor that keeps the time under the pointer where it is (the wheel and the zoom buttons, which zoom
// about the playhead), within the panel's limits.
export function zoomAt(view: TimelineView, factor: number, anchorX: number, limits: ZoomLimits): TimelineView {
  const pixelsPerSecond = Math.min(limits.max, Math.max(limits.min, view.pixelsPerSecond * factor));
  const anchored = view.scroll + (anchorX / view.pixelsPerSecond) * 1000;
  return { pixelsPerSecond, scroll: Math.max(0, anchored - (anchorX / pixelsPerSecond) * 1000) };
}

// The steps the ruler labels, in ms: the smallest whose labels stand `spacing` px apart at least.
const STEPS = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];

export interface Tick {
  readonly time: number;
  readonly x: number;
  readonly major: boolean;
  // the label of a major tick, in seconds ("0.5", "1", "1.25"); null for a minor one
  readonly label: string | null;
}

export function ticks(view: TimelineView, width: number, spacing: number): Tick[] {
  const major = STEPS.find((step) => (step / 1000) * view.pixelsPerSecond >= spacing) ?? (STEPS[STEPS.length - 1] as number);
  // four minor ticks between two labels, five for a step of five
  const minor = major / (String(major).startsWith('5') || String(major).startsWith('25') ? 5 : 4);
  const first = Math.floor(view.scroll / minor) * minor;
  const last = view.scroll + (width / view.pixelsPerSecond) * 1000;
  const found: Tick[] = [];
  for (let time = first; time <= last; time += minor) {
    const rounded = Math.round(time);
    if (rounded < 0) continue;
    const isMajor = rounded % major === 0;
    found.push({ time: rounded, x: timeToX(view, rounded), major: isMajor, label: isMajor ? seconds(rounded) : null });
  }
  return found;
}

// A time in seconds as the timeline writes it: up to two decimals, no trailing zeros ("0.48", "1.2", "3").
export const seconds = (ms: number): string => String(Number((ms / 1000).toFixed(2)));

// The playhead's readout (plan: "0.48 s / 1.20 s"): the time and the timeline's length, both with two decimals, for
// the catalogue's text (motion.timeline.readout) to place.
export function readout(time: number, timeline: MotionTimeline | null): { readonly time: string; readonly duration: string } {
  const duration = timeline === null ? 0 : timelineDuration(timeline);
  return { time: (time / 1000).toFixed(2), duration: (duration / 1000).toFixed(2) };
}

// ---------------------------------------------------------------- snapping

export interface SnapTarget {
  readonly time: number;
  readonly kind: 'zero' | 'playhead' | 'action-start' | 'action-end' | 'keyframe' | 'marker' | 'grid';
}

// What a dragged time may snap to: the timeline's start, the playhead, the edges of the actions and the keyframes that
// are not being dragged, and the markers.
export function snapTargets(timeline: MotionTimeline, playhead: number, dragging: { readonly actions?: ReadonlySet<string>; readonly keyframes?: ReadonlySet<string> } = {}): SnapTarget[] {
  const found: SnapTarget[] = [{ time: 0, kind: 'zero' }, { time: Math.round(playhead), kind: 'playhead' }];
  for (const action of timeline.actions) {
    if (dragging.actions?.has(action.id) === true) continue;
    found.push({ time: action.start, kind: 'action-start' }, { time: actionEnd(action), kind: 'action-end' });
  }
  for (const one of allKeyframes(timeline)) {
    if (dragging.keyframes?.has(one.keyframe.id) === true || dragging.actions?.has(one.ref.action) === true) continue;
    found.push({ time: one.time, kind: 'keyframe' });
  }
  for (const marker of timeline.markers) found.push({ time: marker.time, kind: 'marker' });
  return found;
}

// A time snapped to the nearest target within `tolerance` css px, else to the grid step (ms; 0 for none). The target it
// snapped to comes back too, so the panel can draw the snap line.
export function snapTime(time: number, targets: readonly SnapTarget[], view: TimelineView, tolerance: number, grid: number): { readonly time: number; readonly to: SnapTarget | null } {
  let best: SnapTarget | null = null;
  let distance = Infinity;
  for (const target of targets) {
    const pixels = Math.abs(((target.time - time) / 1000) * view.pixelsPerSecond);
    if (pixels <= tolerance && pixels < distance) {
      best = target;
      distance = pixels;
    }
  }
  if (best !== null) return { time: best.time, to: best };
  if (grid > 0) {
    const snapped = Math.max(0, Math.round(time / grid) * grid);
    return { time: snapped, to: { time: snapped, kind: 'grid' } };
  }
  return { time: Math.max(0, Math.round(time)), to: null };
}

// The delta a dragged group moves by once snapped: its leading edge (the earliest start of the group, or the dragged
// keyframe) is snapped, and the group follows it.
export function snappedDelta(edge: number, delta: number, targets: readonly SnapTarget[], view: TimelineView, tolerance: number, grid: number): { readonly delta: number; readonly to: SnapTarget | null } {
  const snapped = snapTime(edge + delta, targets, view, tolerance, grid);
  return { delta: snapped.time - edge, to: snapped.to };
}

// ---------------------------------------------------------------- lanes

// One row of the timeline: a target's row, which holds the bars of its actions, and under it one row per property its
// animations key, which holds that property's keyframes (plan: "trilhas por alvo e por propriedade").
export type Lane =
  | { readonly kind: 'target'; readonly key: string; readonly target: MotionTarget; readonly actions: readonly TimelineAction[] }
  | { readonly kind: 'property'; readonly key: string; readonly target: MotionTarget; readonly property: string; readonly keyframes: readonly { readonly action: string; readonly track: string; readonly id: string; readonly time: number; readonly value: string; readonly easing: string | null }[] };

// the identity of a target, so actions on the same target share a row
const targetKey = (target: MotionTarget): string => JSON.stringify(target);

export function lanes(timeline: MotionTimeline): Lane[] {
  const byTarget = new Map<string, { target: MotionTarget; actions: TimelineAction[] }>();
  for (const action of timeline.actions) {
    const key = targetKey(action.target);
    const held = byTarget.get(key) ?? { target: action.target, actions: [] };
    held.actions.push(action);
    byTarget.set(key, held);
  }
  const rows: Lane[] = [];
  for (const [key, { target, actions }] of byTarget) {
    rows.push({ kind: 'target', key, target, actions });
    const properties = new Map<string, { action: string; track: string; id: string; time: number; value: string; easing: string | null }[]>();
    for (const action of actions) {
      if (action.effect.kind !== 'animate' && action.effect.kind !== 'split-text') continue;
      for (const track of action.effect.tracks) {
        const held = properties.get(track.property) ?? [];
        for (const keyframe of track.keyframes) held.push({ action: action.id, track: track.id, id: keyframe.id, time: action.start + keyframe.time, value: keyframe.value, easing: keyframe.easing ?? null });
        properties.set(track.property, held);
      }
    }
    for (const [property, keyframes] of properties) rows.push({ kind: 'property', key: `${key}:${property}`, target, property, keyframes: keyframes.sort((a, b) => a.time - b.time) });
  }
  return rows;
}

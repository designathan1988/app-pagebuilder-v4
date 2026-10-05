// The motion model (plan stage 10; spec motion-interactions, motion-timeline): what the document stores of the
// interactions of a page and of the timelines they play. Plain data, never the DOM.
//
// Two parts, so a timeline is reusable by name:
//  - The project's timelines (`DocumentJson.motionTimelines`): each a name, unique in the project, a list of timed
//    actions (bars on a seconds axis, each with its own target, start, duration and effect) and markers. A timeline is
//    played by any number of interactions, on any element, of any page.
//  - The interactions of an element (`DocNode.motions`): each a trigger (what happens), the timeline it plays by name,
//    how it plays it (play, reverse, toggle, scrub...), and its options (once, delay, breakpoints, reduced motion,
//    the scroll range of a continuous trigger, the class it applies to).
//
// Every time is a whole number of milliseconds from the timeline's start; the editor shows seconds. A target relative
// to the trigger (self, children, siblings...) is resolved against the element the trigger fired on, which is what
// makes one timeline serve every element of a class.
import type { NodeId } from '../../generated/commands.ts';

// ---------------------------------------------------------------- targets

// What an action acts on. Relative kinds are read from the element whose trigger fired (the "source"); `element`
// names one node of the document (picked on the canvas or on a Layers row, never typed); `class` every element of the
// page holding that class; `component` the root of every instance of a component.
export type MotionTarget =
  | { readonly kind: 'self' }
  | { readonly kind: 'element'; readonly node: NodeId }
  | { readonly kind: 'class'; readonly className: string }
  | { readonly kind: 'children' }
  | { readonly kind: 'siblings' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'next' }
  | { readonly kind: 'previous' }
  | { readonly kind: 'descendants'; readonly className: string }
  | { readonly kind: 'ancestor'; readonly className: string }
  | { readonly kind: 'component'; readonly component: string };

export type MotionTargetKind = MotionTarget['kind'];

// ---------------------------------------------------------------- keyframes and tracks

// One keyframe of a property track: its time inside its action (0 to the action's duration), the CSS text the
// property holds there, and the easing of the segment that starts at it (absent: the action's own easing), as the
// Web Animations API reads a keyframe's easing.
export interface MotionKeyframe {
  readonly id: string;
  readonly time: number;
  readonly value: string;
  readonly easing?: string;
}

// The keyframes of one property of one action. A track whose first keyframe is not at 0 animates from the value the
// element holds when the action starts ("to"); one whose last is before the end holds its value ("from" ends there);
// both ends set is "from-to". `property` is a CSS property, a custom property (--name) or a transform part
// (TRANSFORM_PARTS), so a translation on x and a scale can be keyed apart.
export interface PropertyTrack {
  readonly id: string;
  readonly property: string;
  readonly keyframes: readonly MotionKeyframe[];
}

// The parts of a transform a track may key on its own (plan: "partes de transformação"). The runtime composes them
// through registered custom properties, so x and y keyed in different tracks interpolate independently.
export const TRANSFORM_PARTS = ['translate-x', 'translate-y', 'translate-z', 'scale-x', 'scale-y', 'rotate-z', 'rotate-x', 'rotate-y', 'skew-x', 'skew-y'] as const;

// ---------------------------------------------------------------- effects (the action catalogue)

export type Effect =
  // animate any animatable property, custom property or transform part through keyframes
  | { readonly kind: 'animate'; readonly tracks: readonly PropertyTrack[] }
  // instant sets
  | { readonly kind: 'class'; readonly operation: 'add' | 'remove' | 'toggle'; readonly className: string }
  | { readonly kind: 'attribute'; readonly name: string; readonly value: string | null }
  | { readonly kind: 'style'; readonly property: string; readonly value: string | null }
  | { readonly kind: 'text'; readonly value: string }
  // show, hide or toggle, with a transition while the action has a duration
  | { readonly kind: 'display'; readonly operation: 'show' | 'hide' | 'toggle'; readonly transition: DisplayTransition; readonly mode: 'hidden' | 'visibility' }
  // control another timeline of the project, or a CSS animation of an element (core/animation)
  | { readonly kind: 'timeline'; readonly operation: PlaybackOperation; readonly timeline: string; readonly time?: number }
  | { readonly kind: 'css-animation'; readonly operation: PlaybackOperation; readonly animation: string; readonly time?: number }
  | { readonly kind: 'scroll'; readonly to: 'target' | 'top' | 'bottom'; readonly offset: number; readonly smooth: boolean; readonly block: 'start' | 'center' | 'end' }
  | { readonly kind: 'dialog'; readonly operation: 'open' | 'open-modal' | 'close' | 'toggle' }
  | { readonly kind: 'details'; readonly operation: 'open' | 'close' | 'toggle' }
  | { readonly kind: 'tab'; readonly index: number }
  | { readonly kind: 'slide'; readonly operation: 'next' | 'previous' | 'go'; readonly index?: number }
  | { readonly kind: 'media'; readonly operation: 'play' | 'pause' | 'toggle' | 'restart' | 'mute' | 'unmute' | 'toggle-mute' }
  | { readonly kind: 'focus'; readonly operation: 'focus' | 'blur' }
  | { readonly kind: 'form'; readonly operation: 'submit' | 'reset' }
  | { readonly kind: 'navigate'; readonly to: 'url' | 'page' | 'back' | 'forward'; readonly address?: string; readonly newTab: boolean }
  | { readonly kind: 'clipboard'; readonly source: 'text' | 'target-text'; readonly text?: string }
  | { readonly kind: 'event'; readonly name: string; readonly detail?: string }
  | { readonly kind: 'variable'; readonly name: string; readonly value: string }
  | { readonly kind: 'theme'; readonly operation: 'toggle' | 'light' | 'dark' | 'system'; readonly remember: boolean }
  | { readonly kind: 'wait' }
  | { readonly kind: 'split-text'; readonly by: 'letter' | 'word' | 'line'; readonly tracks: readonly PropertyTrack[] }
  | { readonly kind: 'lottie'; readonly file: string; readonly operation: 'play' | 'pause' | 'stop' | 'seek' | 'segment'; readonly loop: boolean; readonly speed: number; readonly from?: number; readonly to?: number };

export type EffectKind = Effect['kind'];
export type PlaybackOperation = 'play' | 'pause' | 'restart' | 'reverse' | 'seek' | 'toggle';
type DisplayTransition = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'scale';

// ---------------------------------------------------------------- the timeline

// How an action's targets are offset one after the other (plan: "escalonar início/centro/fim/aleatório"): each next
// target starts `each` ms later, counted from the first, the middle, the last or a seeded shuffle of them.
export interface Stagger {
  readonly each: number;
  readonly from: 'start' | 'center' | 'end' | 'random';
}

// One bar of the timeline: an effect on a target, from `start` for `duration` ms (0 for an instant action), with its
// easing (CSS easing text, steps() or spring(); core/motion/easing.ts reads it), its repeat count, whether every other
// repeat runs backwards, and how its targets are staggered.
export interface TimelineAction {
  readonly id: string;
  readonly target: MotionTarget;
  readonly start: number;
  readonly duration: number;
  readonly effect: Effect;
  readonly easing?: string;
  readonly repeat?: number | 'infinite';
  readonly yoyo?: true;
  readonly stagger?: Stagger;
}

export interface Marker {
  readonly id: string;
  readonly name: string;
  readonly time: number;
}

export interface MotionTimeline {
  readonly id: string;
  // unique among the project's timelines; what an interaction and a timeline action name it by
  readonly name: string;
  readonly actions: readonly TimelineAction[];
  readonly markers: readonly Marker[];
}

// ---------------------------------------------------------------- triggers and interactions

// What fires an interaction, with what that trigger needs (core/motion/catalog.ts says which kind takes which).
export interface Trigger {
  readonly kind: string;
  // key: the key's value as KeyboardEvent.key names it ("Enter", "k", "ArrowDown"); empty for any key
  readonly key?: string;
  // scroll-into-view, scroll-out-of-view: the part of the element that must be visible, 0 to 1
  readonly threshold?: number;
  // timer, interval, idle, long-press: the time in ms
  readonly milliseconds?: number;
  // scroll-direction: the direction that plays; pointer-move: the axis whose position scrubs
  readonly direction?: 'up' | 'down';
  readonly axis?: 'x' | 'y';
  // breakpoint: the breakpoint entered
  readonly breakpoint?: string;
  // media-time: the media's time in seconds that fires it
  readonly seconds?: number;
  // visibility: the tab state that fires it
  readonly state?: 'visible' | 'hidden';
  // custom: the event's name
  readonly event?: string;
}

// How an interaction plays its timeline when its trigger fires.
export type Control = 'play' | 'restart' | 'reverse' | 'toggle' | 'pause' | 'stop' | 'scrub';
// What the other half of a paired trigger does (hover's leave, focus-within's leaving, while-visible's leaving, the
// other scroll direction): nothing, play the timeline backwards to its start, pause it, or reset it at once.
type Leave = 'none' | 'reverse' | 'pause' | 'reset';

export interface MotionInteraction {
  readonly id: string;
  readonly trigger: Trigger;
  // the name of the timeline it plays (MotionTimeline.name)
  readonly timeline: string;
  readonly control: Control;
  readonly leave?: Leave;
  // a class of the element: the interaction applies to every element of the page holding it ("every .card")
  readonly scope?: string;
  // fires the first time only
  readonly once?: true;
  // ms between the trigger and the timeline's start
  readonly delay?: number;
  // the breakpoints it applies at; absent: every breakpoint
  readonly breakpoints?: readonly string[];
  // respect (the default): with prefers-reduced-motion the timeline jumps to its end state, no movement; ignore:
  // the interaction plays as authored (an essential, non-vestibular effect)
  readonly reducedMotion?: 'respect' | 'ignore';
  // a continuous scroll trigger's range, in percent of its progress: where the timeline starts and ends
  readonly scrollStart?: number;
  readonly scrollEnd?: number;
}

// The behaviours an element can take that need a script (plan: comportamentos), each a small runtime of its own with
// no timeline. Sticky and scroll snap are behaviours too, but plain CSS: their command writes the declarations through
// the style owner (core/style/set.ts), so nothing of them is stored here.
export const RUNTIME_BEHAVIOURS = ['smooth-scroll', 'parallax', 'marquee', 'cursor-follow'] as const;
export const STYLE_BEHAVIOURS = ['sticky', 'scroll-snap'] as const;
export type RuntimeBehaviourKind = (typeof RUNTIME_BEHAVIOURS)[number];
export type BehaviourKind = RuntimeBehaviourKind | (typeof STYLE_BEHAVIOURS)[number];

export interface Behaviour {
  readonly kind: RuntimeBehaviourKind;
  // parallax: the speed factor (-1 to 1, 0.3 moves at 30 % of the scroll); marquee: px per second; cursor-follow:
  // the smoothing, 0 (none) to 0.95; smooth-scroll: unused (0)
  readonly amount: number;
  // marquee and parallax: the axis it moves along
  readonly axis?: 'x' | 'y';
  // marquee: runs the other way
  readonly reverse?: true;
}

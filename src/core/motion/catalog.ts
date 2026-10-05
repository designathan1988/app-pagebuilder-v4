// The catalogue of motion (plan stage 10): every trigger, action and target kind, with what each needs and where it
// applies. The manifest lists the same ids as the values its doors offer (manifest/commands/motion.json, the enums of
// motion.add, motion.update and motion.addAction); catalog.test.ts proves the two lists are the same, so a value is
// never offered that this file does not describe, nor described and never offered.
//  - A trigger belongs to a category (the inspector groups the list by it), says which of its parameters it reads,
//    whether it is continuous (its progress scrubs the timeline instead of starting it) or paired (it has a second
//    half, such as hover's leave, that the interaction's `leave` option answers), and on which tags it applies.
//  - An action kind says whether its duration means anything (a transition, a tween) and what it holds by default.
import type { NodeId } from '../../generated/commands.ts';
import type { DocNode } from '../document/model.ts';
import type { Effect, EffectKind, MotionTarget, MotionTargetKind, Trigger } from './model.ts';
import { DIRECTION, DISPLAY, OPACITY } from './words.ts';

export type TriggerCategory = 'element' | 'scroll' | 'page' | 'media' | 'component';
export type TriggerParameter = 'key' | 'threshold' | 'milliseconds' | 'direction' | 'axis' | 'breakpoint' | 'seconds' | 'state' | 'event';

export interface TriggerSpec {
  readonly category: TriggerCategory;
  readonly parameters: readonly TriggerParameter[];
  // its progress drives the timeline (scrub) rather than starting it
  readonly continuous: boolean;
  // it has a second half the interaction's `leave` option answers
  readonly paired: boolean;
  // the tags it applies on; null: every element
  readonly tags: readonly string[] | null;
}

const FIELD_TAGS = ['input', 'select', 'textarea', 'form'];
const MEDIA_TAGS = ['video', 'audio'];

const spec = (category: TriggerCategory, parameters: readonly TriggerParameter[] = [], options: Partial<Pick<TriggerSpec, 'continuous' | 'paired' | 'tags'>> = {}): TriggerSpec => ({
  category,
  parameters,
  continuous: options.continuous ?? false,
  paired: options.paired ?? false,
  tags: options.tags ?? null,
});

export const TRIGGERS = {
  // the element itself
  click: spec('element'),
  'double-click': spec('element'),
  'pointer-down': spec('element'),
  'pointer-up': spec('element'),
  'pointer-enter': spec('element'),
  'pointer-leave': spec('element'),
  hover: spec('element', [], { paired: true }),
  'pointer-move': spec('element', ['axis'], { continuous: true }),
  focus: spec('element'),
  blur: spec('element'),
  'focus-within': spec('element', [], { paired: true }),
  key: spec('element', ['key']),
  input: spec('element', [], { tags: FIELD_TAGS }),
  change: spec('element', [], { tags: FIELD_TAGS }),
  'form-submit': spec('element', [], { tags: ['form'] }),
  'form-invalid': spec('element', [], { tags: ['form', 'input', 'select', 'textarea'] }),
  'long-press': spec('element', ['milliseconds']),
  // scrolling
  'scroll-into-view': spec('scroll', ['threshold'], { paired: true }),
  'scroll-out-of-view': spec('scroll', ['threshold']),
  'while-visible': spec('scroll', [], { continuous: true }),
  'page-scroll': spec('scroll', [], { continuous: true }),
  'scroll-direction': spec('scroll', [DIRECTION], { paired: true }),
  // the page
  'page-load': spec('page'),
  'page-leave': spec('page'),
  visibility: spec('page', ['state']),
  resize: spec('page'),
  breakpoint: spec('page', ['breakpoint']),
  timer: spec('page', ['milliseconds']),
  interval: spec('page', ['milliseconds']),
  idle: spec('page', ['milliseconds']),
  // media
  'media-play': spec('media', [], { tags: MEDIA_TAGS }),
  'media-pause': spec('media', [], { tags: MEDIA_TAGS }),
  'media-end': spec('media', [], { tags: MEDIA_TAGS }),
  'media-time': spec('media', ['seconds'], { tags: MEDIA_TAGS }),
  // components, by the semantics the page's markup carries (spec motion-triggers: no component owner exists for a
  // dropdown, a carousel or a mobile menu, so the triggers read the ARIA state any of them writes)
  'dropdown-open': spec('component'),
  'dropdown-close': spec('component'),
  'tab-change': spec('component'),
  'slide-change': spec('component'),
  'dialog-open': spec('component', [], { tags: ['dialog'] }),
  'dialog-close': spec('component', [], { tags: ['dialog'] }),
  'details-open': spec('component', [], { tags: ['details'] }),
  'mobile-menu-open': spec('component'),
  custom: spec('component', ['event']),
} as const satisfies Record<string, TriggerSpec>;

export type TriggerKind = keyof typeof TRIGGERS;
export const TRIGGER_KINDS = Object.keys(TRIGGERS) as readonly TriggerKind[];
export const isTriggerKind = (value: string): value is TriggerKind => Object.hasOwn(TRIGGERS, value);

// What a parameter holds while the person has not set it: the trigger works as soon as it is chosen.
const TRIGGER_DEFAULTS: Readonly<Record<TriggerParameter, string | number>> = {
  key: 'Enter',
  threshold: 0.5,
  milliseconds: 1000,
  direction: 'down',
  axis: 'x',
  breakpoint: '',
  seconds: 0,
  state: 'hidden',
  event: 'custom-event',
};
// the time a long press waits by default (a timer's second is too long for a press)
const LONG_PRESS_MS = 500;

// A trigger of this kind with its parameters at their defaults (a breakpoint trigger names the first breakpoint).
export function defaultTrigger(kind: TriggerKind, firstBreakpoint: string): Trigger {
  const fields: Record<string, string | number> = { kind };
  for (const parameter of TRIGGERS[kind].parameters) {
    const fallback = parameter === 'breakpoint' ? firstBreakpoint : TRIGGER_DEFAULTS[parameter];
    fields[parameter] = kind === 'long-press' && parameter === 'milliseconds' ? LONG_PRESS_MS : fallback;
  }
  return fields as unknown as Trigger;
}

// Whether a trigger applies on an element (plan: a combination that cannot apply is not offered): its tag is one the
// trigger reads, or the trigger reads every element.
export function triggerApplies(kind: TriggerKind, node: Pick<DocNode, 'tag'>): boolean {
  const tags: readonly string[] | null = TRIGGERS[kind].tags;
  return tags === null || (node.tag !== null && tags.includes(node.tag));
}
export const applicableTriggers = (node: Pick<DocNode, 'tag'>): readonly TriggerKind[] => TRIGGER_KINDS.filter((kind) => triggerApplies(kind, node));

// ---------------------------------------------------------------- actions

export interface EffectSpec {
  // the action takes a duration: a tween, a transition, a wait. An instant action's bar is drawn as a tick.
  readonly timed: boolean;
  // the duration a new action of the kind starts with, in ms
  readonly duration: number;
}

export const EFFECTS = {
  animate: { timed: true, duration: 600 },
  class: { timed: false, duration: 0 },
  attribute: { timed: false, duration: 0 },
  style: { timed: false, duration: 0 },
  text: { timed: false, duration: 0 },
  display: { timed: true, duration: 300 },
  timeline: { timed: false, duration: 0 },
  'css-animation': { timed: false, duration: 0 },
  scroll: { timed: false, duration: 0 },
  dialog: { timed: false, duration: 0 },
  details: { timed: false, duration: 0 },
  tab: { timed: false, duration: 0 },
  slide: { timed: false, duration: 0 },
  media: { timed: false, duration: 0 },
  focus: { timed: false, duration: 0 },
  form: { timed: false, duration: 0 },
  navigate: { timed: false, duration: 0 },
  clipboard: { timed: false, duration: 0 },
  event: { timed: false, duration: 0 },
  variable: { timed: true, duration: 0 },
  theme: { timed: false, duration: 0 },
  wait: { timed: true, duration: 500 },
  'split-text': { timed: true, duration: 800 },
  lottie: { timed: true, duration: 0 },
} as const satisfies Record<EffectKind, EffectSpec>;

export const EFFECT_KINDS = Object.keys(EFFECTS) as readonly EffectKind[];
export const isEffectKind = (value: string): value is EffectKind => Object.hasOwn(EFFECTS, value);

// What a new action of a kind holds: the defaults of each option. An animation and split text start keying nothing,
// as a new CSS animation's keyframes hold nothing (core/animation/animation.ts): the person animates a property from
// the Timeline (motion.setKeyframe), or records one (core/motion/record.ts). Names a person must choose (the timeline
// to control, the Lottie file, the address) start empty; the runtime skips an action that names nothing.
export function defaultEffect(kind: EffectKind, id: () => string): Effect {
  void id;
  switch (kind) {
    case 'animate':
      return { kind, tracks: [] };
    case 'class':
      return { kind, operation: 'toggle', className: 'is-active' };
    case 'attribute':
      return { kind, name: 'aria-expanded', value: 'true' };
    case 'style':
      return { kind, property: OPACITY, value: '1' };
    case 'text':
      return { kind, value: '' };
    case DISPLAY:
      return { kind, operation: 'toggle', transition: 'fade', mode: 'hidden' };
    case 'timeline':
      return { kind, operation: 'play', timeline: '' };
    case 'css-animation':
      return { kind, operation: 'play', animation: '' };
    case 'scroll':
      return { kind, to: 'target', offset: 0, smooth: true, block: 'start' };
    case 'dialog':
      return { kind, operation: 'open-modal' };
    case 'details':
      return { kind, operation: 'toggle' };
    case 'tab':
      return { kind, index: 0 };
    case 'slide':
      return { kind, operation: 'next' };
    case 'media':
      return { kind, operation: 'toggle' };
    case 'focus':
      return { kind, operation: 'focus' };
    case 'form':
      return { kind, operation: 'submit' };
    case 'navigate':
      return { kind, to: 'url', address: '', newTab: false };
    case 'clipboard':
      return { kind, source: 'target-text' };
    case 'event':
      return { kind, name: 'custom-event' };
    case 'variable':
      return { kind, name: '--motion-value', value: '1' };
    case 'theme':
      return { kind, operation: 'toggle', remember: true };
    case 'wait':
      return { kind };
    case 'split-text':
      return { kind, by: 'word', tracks: [] };
    case 'lottie':
      return { kind, file: '', operation: 'play', loop: false, speed: 1 };
  }
}

// ---------------------------------------------------------------- targets

// The target kinds and what each names besides its kind.
export const TARGETS = {
  self: null,
  element: 'node',
  class: 'className',
  children: null,
  siblings: null,
  parent: null,
  next: null,
  previous: null,
  descendants: 'className',
  ancestor: 'className',
  component: 'component',
} as const satisfies Record<MotionTargetKind, 'node' | 'className' | 'component' | null>;

export const TARGET_KINDS = Object.keys(TARGETS) as readonly MotionTargetKind[];
export const isTargetKind = (value: string): value is MotionTargetKind => Object.hasOwn(TARGETS, value);

// A target of a kind from the value its field gave: the node picked, the class or component typed or chosen. Null
// when the kind needs a value and none was given.
export function targetOf(kind: MotionTargetKind, value: string | null): MotionTarget | null {
  const needs = TARGETS[kind];
  if (needs === null) return { kind } as MotionTarget;
  if (value === null || value.trim() === '') return null;
  if (needs === 'node') return { kind: 'element', node: value as NodeId };
  if (needs === 'component') return { kind: 'component', component: value.trim() };
  return { kind, className: value.trim() } as MotionTarget;
}

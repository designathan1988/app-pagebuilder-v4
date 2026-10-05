// The trust boundary of the motion model (spec motion-interactions, "Result in the document"): every timeline,
// interaction and behaviour the document holds is read here from unknown JSON â€” a file opened, a paste, an import, a
// command's own result â€” field by field, strictly (an unknown field is refused, as the manifest's schemas refuse
// one). The validator (core/document/validate.ts) asks it for every document the store would publish, and the commands
// ask it before they write, so a predictable invalid value is refused before any patch exists.
//
// What is not checked here is what another owner may change without telling motion: a class, a component, a
// breakpoint, a project file or a CSS animation named by an action. Those may disappear; the runtime then finds
// nothing and does nothing (spec motion-runtime, "A name that names nothing"). A timeline's name and a picked element
// are motion's own references and are checked by document.ts.
import type { NodeId } from '../../generated/commands.ts';
import { addressAllowed } from '../elements/address.ts';
import { EFFECTS, TARGETS, TRIGGERS, isEffectKind, isTargetKind, isTriggerKind, type TriggerParameter } from './catalog.ts';
import { createEasing } from './easing.ts';
import { RUNTIME_BEHAVIOURS, TRANSFORM_PARTS, type Behaviour, type Effect, type Marker, type MotionInteraction, type MotionKeyframe, type MotionTarget, type MotionTimeline, type PropertyTrack, type TimelineAction, type Trigger } from './model.ts';
import { BOTTOM, DIRECTION, DISPLAY, SCALE, TOP, VISIBILITY } from './words.ts';

interface Issue {
  // where, from the value read: "actions/2/effect/tracks/0/keyframes/1/time"
  readonly path: string;
  readonly reason: string;
}
export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly Issue[] };

// ---------------------------------------------------------------- grammars

// a CSS class name (core/design/classes.ts has the same grammar for the class bar)
export const CLASS_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
// a @keyframes name, the grammar core/animation/animation.ts reads
const ANIMATION_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
// a CSS property as the official data writes it, or a custom property
const CSS_PROPERTY = /^-?[a-z][a-z0-9-]*$/;
const CUSTOM_PROPERTY = /^--[A-Za-z_][A-Za-z0-9_-]*$/;
// a timeline's name: what a person reads in the inspector's lists, letters and digits first, at most 64 characters
export const TIMELINE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u;
// an event name a page's own code may listen to: a letter first, then letters, digits, ":", ".", "-" and "_"
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9:._-]{0,63}$/;
// an attribute an action may set: an HTML attribute name that does not run code nor load anything (onâ€¦, the address
// and markup carrying ones) nor take the style apart from the style owner
const ATTRIBUTE_NAME = /^[a-z][a-z0-9_.:-]*$/;
const UNSAFE_ATTRIBUTES = new Set(['style', 'srcdoc', 'src', 'href', 'action', 'formaction', 'xlink:href', 'data', 'srcset', 'poster', 'background']);
// a CSS value an action writes inline: nothing that ends the declaration or opens a block or markup
const UNSAFE_VALUE = /[;{}<>]|\/\*/;
// the longest text an action carries, so a page's runtime data stays small
const MAX_TEXT = 10000;
// the longest time anything waits or lasts: a day
const MAX_MS = 86_400_000;

const easing = createEasing();

// ---------------------------------------------------------------- a small reader

type Fields = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value);

// One reader per value: it collects every issue under its path and hands back what it read, so a caller sees every
// problem of a value at once (the status bar names the first).
class Reader {
  readonly issues: Issue[] = [];
  bad(path: string, reason: string): void {
    this.issues.push({ path, reason });
  }
  // the record at a path, refusing a field outside the ones named (strict, as the manifest's schemas are)
  record(value: unknown, path: string, fields: readonly string[]): Fields | null {
    if (!isRecord(value)) {
      this.bad(path, 'expected an object');
      return null;
    }
    for (const key of Object.keys(value)) if (!fields.includes(key)) this.bad(join(path, key), 'not a field of this value');
    return value;
  }
  string(value: unknown, path: string, test: (text: string) => boolean, reason: string): string {
    if (typeof value !== 'string' || !test(value)) {
      this.bad(path, reason);
      return '';
    }
    return value;
  }
  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.bad(path, `expected one of ${allowed.join(', ')}`);
      return allowed[0] as T;
    }
    return value as T;
  }
  // a whole number of ms from 0 to a day
  time(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_MS) {
      this.bad(path, 'expected a whole number of ms from 0');
      return 0;
    }
    return value;
  }
  number(value: unknown, path: string, low: number, high: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) {
      this.bad(path, `expected a number from ${low} to ${high}`);
      return low;
    }
    return value;
  }
  integer(value: unknown, path: string, low: number, high: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
      this.bad(path, `expected a whole number from ${low} to ${high}`);
      return low;
    }
    return value;
  }
  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
      this.bad(path, 'expected true or false');
      return false;
    }
    return value;
  }
  // a flag stored as true, absent while off
  flag(value: unknown, path: string): true | undefined {
    if (value === undefined) return undefined;
    if (value !== true) this.bad(path, 'true, or absent while off');
    return true;
  }
  id(value: unknown, path: string, taken: Set<string>): string {
    if (typeof value !== 'string' || value === '') {
      this.bad(path, 'an id is a non-empty string');
      return '';
    }
    if (taken.has(value)) this.bad(path, `the id ${value} is used twice`);
    taken.add(value);
    return value;
  }
  result<T>(value: T): Read<T> {
    return this.issues.length === 0 ? { ok: true, value } : { ok: false, issues: this.issues };
  }
}

const join = (path: string, key: string | number): string => (path === '' ? String(key) : `${path}/${key}`);
const safeValue = (text: string): boolean => text.trim() !== '' && text.length <= MAX_TEXT && !UNSAFE_VALUE.test(text);
const easingText = (text: string): boolean => easing.parse(text) !== null;

// ---------------------------------------------------------------- targets

function readTarget(reader: Reader, value: unknown, path: string): MotionTarget {
  if (!isRecord(value) || typeof value.kind !== 'string' || !isTargetKind(value.kind)) {
    reader.bad(path, 'a target names its kind');
    return { kind: 'self' };
  }
  const needs = TARGETS[value.kind];
  const held = reader.record(value, path, needs === null ? ['kind'] : ['kind', needs]);
  if (held === null || needs === null) return { kind: value.kind } as MotionTarget;
  if (needs === 'node') return { kind: 'element', node: reader.string(held.node, join(path, 'node'), (text) => text !== '', 'the element picked') as NodeId };
  if (needs === 'component') return { kind: 'component', component: reader.string(held.component, join(path, 'component'), (text) => text.trim() !== '', 'a component name') };
  return { kind: value.kind, className: reader.string(held.className, join(path, 'className'), (text) => CLASS_NAME.test(text), 'a class name') } as MotionTarget;
}

// ---------------------------------------------------------------- tracks

const isAnimatedProperty = (property: string): boolean => CUSTOM_PROPERTY.test(property) || CSS_PROPERTY.test(property) || (TRANSFORM_PARTS as readonly string[]).includes(property);

// The tracks of an animation: none while it keys nothing yet (a new animation, as a new CSS animation's keyframes hold
// nothing), each property once.
function readTracks(reader: Reader, value: unknown, path: string, duration: number, ids: Set<string>): PropertyTrack[] {
  if (!Array.isArray(value)) {
    reader.bad(path, 'the tracks are a list');
    return [];
  }
  const properties = new Set<string>();
  return value.map((one, index): PropertyTrack => {
    const at = join(path, index);
    const held = reader.record(one, at, ['id', 'property', 'keyframes']);
    if (held === null) return { id: '', property: '', keyframes: [] };
    const id = reader.id(held.id, join(at, 'id'), ids);
    const property = reader.string(held.property, join(at, 'property'), isAnimatedProperty, 'a CSS property, a custom property or a transform part');
    if (properties.has(property)) reader.bad(join(at, 'property'), `${property} is keyed by another track of this action`);
    properties.add(property);
    return { id, property, keyframes: readKeyframes(reader, held.keyframes, join(at, 'keyframes'), duration, ids) };
  });
}

function readKeyframes(reader: Reader, value: unknown, path: string, duration: number, ids: Set<string>): MotionKeyframe[] {
  if (!Array.isArray(value) || value.length === 0) {
    reader.bad(path, 'a track holds one keyframe at least');
    return [];
  }
  let previous = -1;
  return value.map((one, index): MotionKeyframe => {
    const at = join(path, index);
    const held = reader.record(one, at, ['id', 'time', 'value', 'easing']);
    if (held === null) return { id: '', time: 0, value: '' };
    const id = reader.id(held.id, join(at, 'id'), ids);
    const time = reader.time(held.time, join(at, 'time'));
    if (time > duration) reader.bad(join(at, 'time'), 'a keyframe lies inside its action');
    if (time <= previous) reader.bad(join(at, 'time'), 'keyframes are in time order, one per time');
    previous = time;
    const text = reader.string(held.value, join(at, 'value'), safeValue, 'a CSS value');
    const frame: MotionKeyframe = { id, time, value: text };
    if (held.easing === undefined) return frame;
    return { ...frame, easing: reader.string(held.easing, join(at, 'easing'), easingText, 'an easing') };
  });
}

// ---------------------------------------------------------------- effects

const EFFECT_FIELDS: Readonly<Record<Effect['kind'], readonly string[]>> = {
  animate: ['tracks'],
  class: ['operation', 'className'],
  attribute: ['name', 'value'],
  style: ['property', 'value'],
  text: ['value'],
  display: ['operation', 'transition', 'mode'],
  timeline: ['operation', 'timeline', 'time'],
  'css-animation': ['operation', 'animation', 'time'],
  scroll: ['to', 'offset', 'smooth', 'block'],
  dialog: ['operation'],
  details: ['operation'],
  tab: ['index'],
  slide: ['operation', 'index'],
  media: ['operation'],
  focus: ['operation'],
  form: ['operation'],
  navigate: ['to', 'address', 'newTab'],
  clipboard: ['source', 'text'],
  event: ['name', 'detail'],
  variable: ['name', 'value'],
  theme: ['operation', 'remember'],
  wait: [],
  'split-text': ['by', 'tracks'],
  lottie: ['file', 'operation', 'loop', 'speed', 'from', 'to'],
};

const PLAYBACK = ['play', 'pause', 'restart', 'reverse', 'seek', 'toggle'] as const;

function readEffect(reader: Reader, value: unknown, path: string, duration: number, ids: Set<string>): Effect {
  if (!isRecord(value) || typeof value.kind !== 'string' || !isEffectKind(value.kind)) {
    reader.bad(path, 'an effect names its kind');
    return { kind: 'wait' };
  }
  const kind = value.kind;
  const held = reader.record(value, path, ['kind', ...EFFECT_FIELDS[kind]]);
  if (held === null) return { kind: 'wait' };
  const at = (field: string): string => join(path, field);
  // an optional time a playback operation seeks to
  const time = (): { time?: number } => (held.time === undefined ? {} : { time: reader.time(held.time, at('time')) });
  switch (kind) {
    case 'animate':
      return { kind, tracks: readTracks(reader, held.tracks, at('tracks'), duration, ids) };
    case 'split-text':
      return { kind, by: reader.oneOf(held.by, at('by'), ['letter', 'word', 'line']), tracks: readTracks(reader, held.tracks, at('tracks'), duration, ids) };
    case 'class':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), ['add', 'remove', 'toggle']), className: reader.string(held.className, at('className'), (text) => CLASS_NAME.test(text), 'a class name') };
    case 'attribute': {
      const name = reader.string(held.name, at('name'), (text) => ATTRIBUTE_NAME.test(text) && !text.startsWith('on') && !UNSAFE_ATTRIBUTES.has(text), 'an attribute name that runs no code and loads nothing');
      const text = held.value === null ? null : reader.string(held.value, at('value'), (one) => one.length <= MAX_TEXT, 'a text, or null to remove the attribute');
      return { kind, name, value: text };
    }
    case 'style': {
      const property = reader.string(held.property, at('property'), (text) => CSS_PROPERTY.test(text) || CUSTOM_PROPERTY.test(text), 'a CSS property');
      const text = held.value === null ? null : reader.string(held.value, at('value'), safeValue, 'a CSS value, or null to remove it');
      return { kind, property, value: text };
    }
    case 'text':
      return { kind, value: reader.string(held.value, at('value'), (text) => text.length <= MAX_TEXT, `a text of at most ${MAX_TEXT} characters`) };
    case DISPLAY:
      return {
        kind,
        operation: reader.oneOf(held.operation, at('operation'), ['show', 'hide', 'toggle']),
        transition: reader.oneOf(held.transition, at('transition'), ['none', 'fade', 'slide-up', 'slide-down', SCALE]),
        mode: reader.oneOf(held.mode, at('mode'), ['hidden', VISIBILITY]),
      };
    case 'timeline':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), PLAYBACK), timeline: reader.string(held.timeline, at('timeline'), (text) => text === '' || TIMELINE_NAME.test(text), 'a timeline name'), ...time() };
    case 'css-animation':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), PLAYBACK), animation: reader.string(held.animation, at('animation'), (text) => text === '' || ANIMATION_NAME.test(text), 'an animation name'), ...time() };
    case 'scroll':
      return {
        kind,
        to: reader.oneOf(held.to, at('to'), ['target', TOP, BOTTOM]),
        offset: reader.number(held.offset, at('offset'), -100000, 100000),
        smooth: reader.boolean(held.smooth, at('smooth')),
        block: reader.oneOf(held.block, at('block'), ['start', 'center', 'end']),
      };
    case 'dialog':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), ['open', 'open-modal', 'close', 'toggle']) };
    case 'details':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), ['open', 'close', 'toggle']) };
    case 'tab':
      return { kind, index: reader.integer(held.index, at('index'), 0, 999) };
    case 'slide': {
      const operation = reader.oneOf(held.operation, at('operation'), ['next', 'previous', 'go']);
      if (operation !== 'go') {
        if (held.index !== undefined) reader.bad(at('index'), 'only going to a slide names its index');
        return { kind, operation };
      }
      return { kind, operation, index: reader.integer(held.index, at('index'), 0, 999) };
    }
    case 'media':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), ['play', 'pause', 'toggle', 'restart', 'mute', 'unmute', 'toggle-mute']) };
    case 'focus':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), ['focus', 'blur']) };
    case 'form':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), ['submit', 'reset']) };
    case 'navigate': {
      const to = reader.oneOf(held.to, at('to'), ['url', 'page', 'back', 'forward']);
      const newTab = reader.boolean(held.newTab, at('newTab'));
      if (to === 'back' || to === 'forward') {
        if (held.address !== undefined) reader.bad(at('address'), 'going back or forward names no address');
        return { kind, to, newTab };
      }
      const address = reader.string(held.address, at('address'), (text) => text === '' || addressAllowed(text), 'an address that runs no code');
      return { kind, to, address, newTab };
    }
    case 'clipboard': {
      const source = reader.oneOf(held.source, at('source'), ['text', 'target-text']);
      if (source === 'target-text') {
        if (held.text !== undefined) reader.bad(at('text'), "copying the target's text names no text of its own");
        return { kind, source };
      }
      return { kind, source, text: reader.string(held.text, at('text'), (text) => text.length <= MAX_TEXT, `a text of at most ${MAX_TEXT} characters`) };
    }
    case 'event': {
      const name = reader.string(held.name, at('name'), (text) => EVENT_NAME.test(text), 'an event name');
      if (held.detail === undefined) return { kind, name };
      return { kind, name, detail: reader.string(held.detail, at('detail'), (text) => text.length <= MAX_TEXT, 'a text') };
    }
    case 'variable':
      return { kind, name: reader.string(held.name, at('name'), (text) => CUSTOM_PROPERTY.test(text), 'a custom property (--name)'), value: reader.string(held.value, at('value'), safeValue, 'a CSS value') };
    case 'theme':
      return { kind, operation: reader.oneOf(held.operation, at('operation'), ['toggle', 'light', 'dark', 'system']), remember: reader.boolean(held.remember, at('remember')) };
    case 'wait':
      return { kind };
    case 'lottie': {
      const operation = reader.oneOf(held.operation, at('operation'), ['play', 'pause', 'stop', 'seek', 'segment']);
      const effect = {
        kind,
        // a Lottie animation exported as JSON (a .lottie archive would need an unzipper on the page)
        file: reader.string(held.file, at('file'), (text) => text === '' || (/\.json$/i.test(text) && !text.includes('..')), 'a Lottie JSON file of the project'),
        operation,
        loop: reader.boolean(held.loop, at('loop')),
        speed: reader.number(held.speed, at('speed'), 0.1, 10),
      };
      const from = held.from === undefined ? undefined : reader.integer(held.from, at('from'), 0, 100000);
      const to = held.to === undefined ? undefined : reader.integer(held.to, at('to'), 0, 100000);
      // a seek names its frame (from); a segment names both ends, in order
      if (operation === 'seek' && from === undefined) reader.bad(at('from'), 'a seek names the frame it goes to');
      if (operation === 'segment' && (from === undefined || to === undefined || to <= from)) reader.bad(at('to'), 'a segment names its first and last frames, in order');
      return { ...effect, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
    }
  }
}

// ---------------------------------------------------------------- actions and timelines

function readAction(reader: Reader, value: unknown, path: string, ids: Set<string>): TimelineAction {
  const held = reader.record(value, path, ['id', 'target', 'start', 'duration', 'effect', 'easing', 'repeat', 'yoyo', 'stagger']);
  if (held === null) return { id: '', target: { kind: 'self' }, start: 0, duration: 0, effect: { kind: 'wait' } };
  const at = (field: string): string => join(path, field);
  const id = reader.id(held.id, at('id'), ids);
  const target = readTarget(reader, held.target, at('target'));
  const start = reader.time(held.start, at('start'));
  const duration = reader.time(held.duration, at('duration'));
  const effect = readEffect(reader, held.effect, at('effect'), duration, ids);
  // an instant action has no duration to ease, repeat or reverse (the bar is a tick)
  if (!EFFECTS[effect.kind].timed && duration !== 0) reader.bad(at('duration'), 'an instant action lasts 0 ms');
  let action: TimelineAction = { id, target, start, duration, effect };
  if (held.easing !== undefined) action = { ...action, easing: reader.string(held.easing, at('easing'), easingText, 'an easing') };
  if (held.repeat !== undefined) action = { ...action, repeat: held.repeat === 'infinite' ? 'infinite' : reader.integer(held.repeat, at('repeat'), 1, 1000) };
  const yoyo = reader.flag(held.yoyo, at('yoyo'));
  if (yoyo !== undefined) action = { ...action, yoyo };
  if (held.stagger !== undefined) {
    const stagger = reader.record(held.stagger, at('stagger'), ['each', 'from']);
    if (stagger !== null) action = { ...action, stagger: { each: reader.time(stagger.each, join(at('stagger'), 'each')), from: reader.oneOf(stagger.from, join(at('stagger'), 'from'), ['start', 'center', 'end', 'random']) } };
  }
  return action;
}

function readMarkers(reader: Reader, value: unknown, path: string, ids: Set<string>): Marker[] {
  if (!Array.isArray(value)) {
    reader.bad(path, 'markers is a list');
    return [];
  }
  return value.map((one, index) => {
    const at = join(path, index);
    const held = reader.record(one, at, ['id', 'name', 'time']);
    if (held === null) return { id: '', name: '', time: 0 };
    return {
      id: reader.id(held.id, join(at, 'id'), ids),
      name: reader.string(held.name, join(at, 'name'), (text) => text.trim() !== '' && text.length <= 64, 'a name of at most 64 characters'),
      time: reader.time(held.time, join(at, 'time')),
    };
  });
}

export function readTimeline(value: unknown): Read<MotionTimeline> {
  const reader = new Reader();
  const held = reader.record(value, '', ['id', 'name', 'actions', 'markers']);
  if (held === null) return reader.result({ id: '', name: '', actions: [], markers: [] });
  const ids = new Set<string>();
  const id = reader.id(held.id, 'id', ids);
  const name = reader.string(held.name, 'name', (text) => TIMELINE_NAME.test(text), 'a name: letters or digits first, at most 64 characters');
  const actions = Array.isArray(held.actions) ? held.actions.map((one, index) => readAction(reader, one, join('actions', index), ids)) : (reader.bad('actions', 'actions is a list'), []);
  const markers = readMarkers(reader, held.markers, 'markers', ids);
  return reader.result({ id, name, actions, markers });
}

// ---------------------------------------------------------------- interactions

const PARAMETER_FIELDS: readonly TriggerParameter[] = ['key', 'threshold', 'milliseconds', DIRECTION, 'axis', 'breakpoint', 'seconds', 'state', 'event'];

function readTrigger(reader: Reader, value: unknown, path: string): Trigger {
  if (!isRecord(value) || typeof value.kind !== 'string' || !isTriggerKind(value.kind)) {
    reader.bad(path, 'a trigger names its kind');
    return { kind: 'click' };
  }
  const kind = value.kind;
  const takes: readonly TriggerParameter[] = TRIGGERS[kind].parameters;
  const held = reader.record(value, path, ['kind', ...takes]);
  if (held === null) return { kind };
  const fields: Record<string, unknown> = { kind };
  for (const parameter of PARAMETER_FIELDS) {
    if (!takes.includes(parameter)) continue;
    const at = join(path, parameter);
    const given = held[parameter];
    if (given === undefined) {
      reader.bad(at, `the ${kind} trigger names its ${parameter}`);
      continue;
    }
    if (parameter === 'key') fields.key = reader.string(given, at, (text) => text.length <= 32, 'a key name');
    if (parameter === 'threshold') fields.threshold = reader.number(given, at, 0, 1);
    if (parameter === 'milliseconds') fields.milliseconds = reader.integer(given, at, kind === 'interval' ? 16 : 0, MAX_MS);
    if (parameter === DIRECTION) fields.direction = reader.oneOf(given, at, ['up', 'down']);
    if (parameter === 'axis') fields.axis = reader.oneOf(given, at, ['x', 'y']);
    if (parameter === 'breakpoint') fields.breakpoint = reader.string(given, at, (text) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(text), 'a breakpoint');
    if (parameter === 'seconds') fields.seconds = reader.number(given, at, 0, MAX_MS / 1000);
    if (parameter === 'state') fields.state = reader.oneOf(given, at, ['visible', 'hidden']);
    if (parameter === 'event') fields.event = reader.string(given, at, (text) => EVENT_NAME.test(text), 'an event name');
  }
  return fields as unknown as Trigger;
}

export function readInteraction(value: unknown): Read<MotionInteraction> {
  const reader = new Reader();
  const held = reader.record(value, '', ['id', 'trigger', 'timeline', 'control', 'leave', 'scope', 'once', 'delay', 'breakpoints', 'reducedMotion', 'scrollStart', 'scrollEnd']);
  if (held === null) return reader.result({ id: '', trigger: { kind: 'click' }, timeline: '', control: 'play' });
  const id = reader.id(held.id, 'id', new Set());
  const trigger = readTrigger(reader, held.trigger, 'trigger');
  const spec = isTriggerKind(trigger.kind) ? TRIGGERS[trigger.kind] : null;
  const timeline = reader.string(held.timeline, 'timeline', (text) => TIMELINE_NAME.test(text), 'the name of the timeline it plays');
  const control = reader.oneOf(held.control, 'control', ['play', 'restart', 'reverse', 'toggle', 'pause', 'stop', 'scrub']);
  // a continuous trigger scrubs, and only a continuous one does: its progress is the timeline's
  if (spec !== null && spec.continuous !== (control === 'scrub')) reader.bad('control', spec.continuous ? 'a continuous trigger scrubs its timeline' : 'only a continuous trigger scrubs');
  let interaction: MotionInteraction = { id, trigger, timeline, control };
  if (held.leave !== undefined) {
    if (spec !== null && !spec.paired) reader.bad('leave', 'only a paired trigger has a leaving half');
    interaction = { ...interaction, leave: reader.oneOf(held.leave, 'leave', ['none', 'reverse', 'pause', 'reset']) };
  }
  if (held.scope !== undefined) interaction = { ...interaction, scope: reader.string(held.scope, 'scope', (text) => CLASS_NAME.test(text), 'a class name') };
  const once = reader.flag(held.once, 'once');
  if (once !== undefined) interaction = { ...interaction, once };
  if (held.delay !== undefined) interaction = { ...interaction, delay: reader.time(held.delay, 'delay') };
  if (held.breakpoints !== undefined) {
    const list = Array.isArray(held.breakpoints) ? held.breakpoints : null;
    if (list === null || list.length === 0 || new Set(list).size !== list.length || list.some((one) => typeof one !== 'string' || one === '')) reader.bad('breakpoints', 'a list of breakpoints, each once, absent for every breakpoint');
    else interaction = { ...interaction, breakpoints: list as string[] };
  }
  if (held.reducedMotion !== undefined) interaction = { ...interaction, reducedMotion: reader.oneOf(held.reducedMotion, 'reducedMotion', ['respect', 'ignore']) };
  if (held.scrollStart !== undefined || held.scrollEnd !== undefined) {
    if (trigger.kind !== 'while-visible' && trigger.kind !== 'page-scroll') reader.bad('scrollStart', 'only a scroll progress trigger has a scroll range');
    const start = reader.number(held.scrollStart ?? 0, 'scrollStart', 0, 100);
    const end = reader.number(held.scrollEnd ?? 100, 'scrollEnd', 0, 100);
    if (end <= start) reader.bad('scrollEnd', 'the range ends after it starts');
    interaction = { ...interaction, scrollStart: start, scrollEnd: end };
  }
  return reader.result(interaction);
}

export function readBehaviour(value: unknown): Read<Behaviour> {
  const reader = new Reader();
  const held = reader.record(value, '', ['kind', 'amount', 'axis', 'reverse']);
  if (held === null) return reader.result({ kind: 'parallax', amount: 0 });
  const kind = reader.oneOf(held.kind, 'kind', RUNTIME_BEHAVIOURS);
  const ranges: Readonly<Record<Behaviour['kind'], readonly [number, number]>> = { 'smooth-scroll': [0, 0], parallax: [-1, 1], marquee: [1, 2000], 'cursor-follow': [0, 0.95] };
  const [low, high] = ranges[kind];
  let behaviour: Behaviour = { kind, amount: reader.number(held.amount, 'amount', low, high) };
  if (held.axis !== undefined) behaviour = { ...behaviour, axis: reader.oneOf(held.axis, 'axis', ['x', 'y']) };
  const reverse = reader.flag(held.reverse, 'reverse');
  if (reverse !== undefined) behaviour = { ...behaviour, reverse };
  return reader.result(behaviour);
}

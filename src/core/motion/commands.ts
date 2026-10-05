// The commands of motion (INVENTORY.md, owners; plan stage 10; specs motion-interactions,
// motion-timeline, motion-behaviours): the interactions of an element (motion.add, motion.update, motion.remove), the
// project's timelines (create, rename, delete), their actions (add, update, remove, move, resize), keyframes (set,
// edit, move, delete, paste), markers, and the behaviours of an element. Every handler is pure: it reads the state and
// returns patches, and every value it writes is read by read.ts first, so a value the validator would refuse is
// refused here, before any patch exists.
//  - A text field hands its text (a time typed in seconds, "0.5" or "500ms"; a list typed "desktop, tablet"); a button
//    or a gesture hands the value itself (a time in ms, a list). `time` below reads both.
//  - The editing canvas never runs an interaction; the preview, the exported page and the canvas's run mode do
//    (src/editor/motion/runtime/).
import type { NodeId } from '../../generated/commands.ts';
import type { MessageId } from '../../generated/ids.ts';
import { message, registerHandler, type HandlerContext, type Message, type Outcome, type RegisteredHandler } from '../commands/registry.ts';
import { locate, type DocNode, type DocumentJson } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import { readAddress } from '../elements/address.ts';
import { readValue, writeStyle } from '../style/set.ts';
import { INITIAL_VALUES } from '../../generated/value-lists.ts';
import { manifest, numberConstant } from '../../manifest/runtime.ts';
import { EFFECTS, TRIGGERS, applicableTriggers, defaultEffect, defaultTrigger, isEffectKind, isTargetKind, isTriggerKind, targetOf, triggerApplies, type TriggerKind } from './catalog.ts';
import { behavioursOf, findTimeline, motionsOf, primaryNode, renameTimelinePatches, timelineUses, timelinesOf, uniqueTimelineName, writeBehaviours, writeMotions, writeTimeline, writeTimelines } from './document.ts';
import { CLASS_NAME, TIMELINE_NAME, readBehaviour, readInteraction, readTimeline } from './read.ts';
import {
  addAction,
  addMarker,
  clampActionDelta,
  deleteKeyframes,
  editKeyframe,
  moveActions,
  moveKeyframes,
  moveMarker,
  pasteKeyframes,
  placementStart,
  removeActions,
  removeMarker,
  renameMarker,
  replaceAction,
  resizeAction,
  setKeyframeAt,
  withDuration,
  type CopiedKeyframe,
  type KeyframeRef,
  type Placement,
} from './timeline.ts';
import type { Behaviour, Effect, MotionInteraction, MotionTimeline, TimelineAction, Trigger } from './model.ts';
import { RUNTIME_BEHAVIOURS, type BehaviourKind, type RuntimeBehaviourKind } from './model.ts';
import { DIRECTION } from './words.ts';

type Located = { readonly node: DocNode; readonly path: readonly (string | number)[] };

// ---------------------------------------------------------------- words

// a value as its catalogue key names it: a kebab value (double-click) with its camel case (doubleClick)
const camel = (value: string): string => value.replace(/-([a-z])/g, (_all, letter: string) => letter.toUpperCase());
const triggerLabel = (kind: string): MessageId => `motion.trigger.${camel(kind)}` as MessageId;
const effectLabel = (kind: string): MessageId => `motion.action.${camel(kind)}` as MessageId;
const targetLabel = (kind: string): MessageId => `motion.target.${camel(kind)}` as MessageId;
const behaviourLabel = (kind: string): MessageId => `motion.behaviour.${camel(kind)}` as MessageId;

// ---------------------------------------------------------------- reading what a door hands

// A time a field or a gesture hands: a number is ms (a gesture, a button); a text is a time as CSS writes it ("0.5s",
// "500ms"), a bare number in seconds, the unit the Timeline shows. Null for anything else.
export function readTime(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(ms|s)?\s*$/i.exec(value);
  if (match === null) return null;
  const amount = Number(match[1]);
  return Math.round(match[2]?.toLowerCase() === 'ms' ? amount : amount * 1000);
}
const readNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
};
const readBoolean = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : null);
const readList = (value: unknown): string[] | null => {
  if (Array.isArray(value)) return value.every((one) => typeof one === 'string') ? (value as string[]) : null;
  if (typeof value !== 'string') return null;
  return value.split(',').map((one) => one.trim()).filter((one) => one !== '');
};
const readText = (value: unknown): string | null => (typeof value === 'string' ? value.trim() : null);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => value !== null && typeof value === 'object' && !Array.isArray(value);

const invalid = (value: unknown): Outcome<never> => ({ kind: 'refused', message: message('status.motion.invalid', { value: typeof value === 'string' ? value : JSON.stringify(value ?? null) }) });
const lockedRefusal = <Ui>(context: HandlerContext<Ui>, node: DocNode): Message | null => firstLockRefusal(context.state.document, [node.id as NodeId], 'status.locked.edit');

// The timeline a command names, or the refusal that says none of the project holds that name.
function timelineNamed<Ui>(context: HandlerContext<Ui>, name: unknown): { readonly timeline: MotionTimeline; readonly index: number } | Outcome<never> {
  const found = typeof name === 'string' ? findTimeline(context.state.document, name) : null;
  return found ?? { kind: 'refused', message: message('status.motion.notFound', { name: typeof name === 'string' ? name : '' }) };
}
// the playhead of the editor's Timeline (HandlerContext.motion), where "at the playhead" lands; 0 without an editor
const playheadOf = <Ui>(context: HandlerContext<Ui>): number => context.motion?.playhead ?? 0;
const isOutcome = (value: unknown): value is Outcome<never> => isRecord(value) && typeof value.kind === 'string' && (value.kind === 'refused' || value.kind === 'change');

// A timeline written back once read.ts reads it: the change with its message, or the refusal of what is invalid.
function commitTimeline(index: number, next: MotionTimeline, said: Message, value: unknown = null): Outcome<never> {
  const read = readTimeline(next);
  if (!read.ok) return invalid(value ?? read.issues[0]?.path ?? '');
  return { kind: 'change', patches: [writeTimeline(index, read.value)], message: said };
}

// A name a new timeline takes from an element and its trigger ("Hero click"): the characters a timeline's name allows,
// "Timeline" when nothing of them is left.
function timelineNameFor(document: DocumentJson, node: DocNode, trigger: string): string {
  const base = `${node.name} ${trigger}`.replace(/[^\p{L}\p{N} _.-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const wanted = TIMELINE_NAME.test(base) ? base : 'Timeline';
  return uniqueTimelineName(document, wanted);
}

// ---------------------------------------------------------------- interactions

const continuousControl = (kind: TriggerKind): MotionInteraction['control'] => (TRIGGERS[kind].continuous ? 'scrub' : 'play');

// The first action a new timeline holds: the element fading in, so the interaction shows at once in the preview.
function firstAction<Ui>(context: HandlerContext<Ui>): TimelineAction {
  const id = () => context.ids.next();
  return { id: id(), target: { kind: 'self' }, start: 0, duration: EFFECTS.animate.duration, effect: defaultEffect('animate', id), easing: 'ease-out' };
}

export const addMotionCommand = registerHandler('motion.add', (context, { trigger, timeline }): Outcome<never> => {
  const found = primaryNode(context.state.document, context.state.selection);
  if (found === null) return { kind: 'change' };
  const kind = trigger ?? applicableTriggers(found.node)[0] ?? 'click';
  if (!isTriggerKind(kind) || !triggerApplies(kind, found.node)) return { kind: 'refused', message: message('status.motion.notApplicable', { name: { key: triggerLabel(kind) }, element: found.node.name }) };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const patches: Patch[] = [];
  let name: string;
  if (timeline !== undefined && timeline !== '') {
    // reusing a timeline by its name
    if (findTimeline(context.state.document, timeline) === null) return { kind: 'refused', message: message('status.motion.notFound', { name: timeline }) };
    name = timeline;
  } else {
    name = timelineNameFor(context.state.document, found.node, kind);
    const made: MotionTimeline = { id: context.ids.next(), name, actions: [firstAction(context)], markers: [] };
    patches.push(...writeTimelines(context.state.document, [...timelinesOf(context.state.document), made]));
  }
  const spec = TRIGGERS[kind];
  const interaction: MotionInteraction = {
    id: context.ids.next(),
    trigger: defaultTrigger(kind, context.rules.base.breakpoint),
    timeline: name,
    control: continuousControl(kind),
    ...(spec.paired ? { leave: 'reverse' as const } : {}),
  };
  const read = readInteraction(interaction);
  if (!read.ok) return invalid(kind);
  patches.push(...writeMotions(found.node, found.path, [...motionsOf(found.node), read.value]));
  return { kind: 'change', patches, message: message('status.motion.added', { name: { key: triggerLabel(kind) }, element: found.node.name, timeline: name }) };
});

// The parameter fields of a trigger, set through motion.update by their own names.
const TRIGGER_PARAMETERS = ['key', 'threshold', 'milliseconds', DIRECTION, 'axis', 'breakpoint', 'seconds', 'state', 'event'] as const;

// What one field's value makes of an interaction, or the refusal of a value that cannot be read.
function updatedInteraction<Ui>(context: HandlerContext<Ui>, node: DocNode, held: MotionInteraction, field: string, value: unknown): MotionInteraction | Outcome<never> {
  const without = <K extends keyof MotionInteraction>(interaction: MotionInteraction, key: K): MotionInteraction => {
    return Object.fromEntries(Object.entries(interaction).filter(([name]) => name !== key)) as unknown as MotionInteraction;
  };
  switch (field) {
    case 'trigger': {
      const kind = readText(value);
      if (kind === null || !isTriggerKind(kind) || !triggerApplies(kind, node)) return { kind: 'refused', message: message('status.motion.notApplicable', { name: kind === null ? '' : isTriggerKind(kind) ? { key: triggerLabel(kind) } : kind, element: node.name }) };
      const spec = TRIGGERS[kind];
      let next: MotionInteraction = { ...held, trigger: defaultTrigger(kind, context.rules.base.breakpoint), control: spec.continuous ? 'scrub' : held.control === 'scrub' ? 'play' : held.control };
      // the leaving half belongs to a paired trigger; the scroll range to a scroll progress one
      next = spec.paired ? { ...next, leave: held.leave ?? 'reverse' } : without(next, 'leave');
      if (kind !== 'while-visible' && kind !== 'page-scroll') next = without(without(next, 'scrollStart'), 'scrollEnd');
      return next;
    }
    case 'timeline': {
      const name = readText(value);
      if (name === null || findTimeline(context.state.document, name) === null) return { kind: 'refused', message: message('status.motion.notFound', { name: name ?? '' }) };
      return { ...held, timeline: name };
    }
    case 'control':
      return { ...held, control: readText(value) as MotionInteraction['control'] };
    case 'leave': {
      const leave = readText(value);
      return leave === 'none' || leave === '' ? without(held, 'leave') : { ...held, leave: leave as MotionInteraction['leave'] & string };
    }
    case 'scope': {
      const scope = readText(value);
      if (scope === null) return invalid(value);
      if (scope === '') return without(held, 'scope');
      return CLASS_NAME.test(scope) ? { ...held, scope } : invalid(value);
    }
    case 'once': {
      const once = readBoolean(value);
      if (once === null) return invalid(value);
      return once ? { ...held, once: true } : without(held, 'once');
    }
    case 'delay': {
      const delay = readTime(value);
      if (delay === null) return invalid(value);
      return delay === 0 ? without(held, 'delay') : { ...held, delay };
    }
    case 'breakpoints': {
      const list = readList(value);
      if (list === null || list.some((one) => !context.rules.breakpoints.has(one as never))) return invalid(value);
      return list.length === 0 ? without(held, 'breakpoints') : { ...held, breakpoints: [...new Set(list)] };
    }
    case 'reducedMotion': {
      const choice = readText(value);
      return choice === 'respect' ? without(held, 'reducedMotion') : { ...held, reducedMotion: choice as 'ignore' };
    }
    case 'scrollStart':
    case 'scrollEnd': {
      const percent = readNumber(typeof value === 'string' ? value.replace('%', '') : value);
      if (percent === null) return invalid(value);
      return { ...held, scrollStart: held.scrollStart ?? 0, scrollEnd: held.scrollEnd ?? 100, [field]: percent };
    }
    default: {
      if (!(TRIGGER_PARAMETERS as readonly string[]).includes(field)) return invalid(field);
      const kind = held.trigger.kind;
      if (!isTriggerKind(kind) || !(TRIGGERS[kind].parameters as readonly string[]).includes(field)) return invalid(field);
      const numeric = field === 'threshold' || field === 'seconds' ? readNumber(value) : field === 'milliseconds' ? readTime(value) : null;
      const text = readText(value);
      const read = numeric ?? (field === 'threshold' || field === 'seconds' || field === 'milliseconds' ? null : text);
      if (read === null) return invalid(value);
      return { ...held, trigger: { ...held.trigger, [field]: read } as Trigger };
    }
  }
}

export const updateMotionCommand = registerHandler('motion.update', (context, { interaction, field, value }): Outcome<never> => {
  const found = primaryNode(context.state.document, context.state.selection);
  if (found === null || interaction === undefined || field === undefined) return { kind: 'change' };
  const held = motionsOf(found.node)[interaction];
  if (held === undefined) return { kind: 'change' };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const next = updatedInteraction(context, found.node, held, field, value);
  if (isOutcome(next)) return next;
  const read = readInteraction(next);
  if (!read.ok) return invalid(value);
  if (JSON.stringify(read.value) === JSON.stringify(held)) return { kind: 'change' };
  const motions = motionsOf(found.node).map((one, index) => (index === interaction ? read.value : one));
  return { kind: 'change', patches: writeMotions(found.node, found.path, motions), message: message('status.motion.updated', { name: { key: triggerLabel(read.value.trigger.kind) }, element: found.node.name }) };
});

export const removeMotionCommand = registerHandler('motion.remove', (context, { interaction }): Outcome<never> => {
  const found = primaryNode(context.state.document, context.state.selection);
  if (found === null || interaction === undefined) return { kind: 'change' };
  const held = motionsOf(found.node)[interaction];
  if (held === undefined) return { kind: 'change' };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  // the timeline stays in the project's library, reusable by name
  const motions = motionsOf(found.node).filter((_one, index) => index !== interaction);
  return { kind: 'change', patches: writeMotions(found.node, found.path, motions), message: message('status.motion.removed', { name: { key: triggerLabel(held.trigger.kind) }, element: found.node.name }) };
});

// ---------------------------------------------------------------- timelines

export const createTimelineCommand = registerHandler('motion.createTimeline', (context, { name }): Outcome<never> => {
  const typed = (name ?? '').trim();
  const wanted = typed === '' ? uniqueTimelineName(context.state.document, context.words('motion.timeline.defaultName')) : typed;
  if (!TIMELINE_NAME.test(wanted)) return { kind: 'refused', message: message('status.motion.nameInvalid', { name: wanted }) };
  if (findTimeline(context.state.document, wanted) !== null) return { kind: 'refused', message: message('status.motion.nameTaken', { name: wanted }) };
  const timeline: MotionTimeline = { id: context.ids.next(), name: wanted, actions: [], markers: [] };
  return { kind: 'change', patches: writeTimelines(context.state.document, [...timelinesOf(context.state.document), timeline]), message: message('status.motion.timelineCreated', { name: wanted }) };
});

export const renameTimelineCommand = registerHandler('motion.renameTimeline', (context, { timeline, name }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const typed = name.trim();
  if (typed === found.timeline.name) return { kind: 'change' };
  if (!TIMELINE_NAME.test(typed)) return { kind: 'refused', message: message('status.motion.nameInvalid', { name: typed }) };
  if (findTimeline(context.state.document, typed) !== null) return { kind: 'refused', message: message('status.motion.nameTaken', { name: typed }) };
  return { kind: 'change', patches: renameTimelinePatches(context.state.document, found.timeline.name, typed), message: message('status.motion.timelineRenamed', { oldName: found.timeline.name, name: typed }) };
});

export const deleteTimelineCommand = registerHandler('motion.deleteTimeline', (context, { timeline }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  // a timeline something plays or controls stays: deleting it would leave that interaction playing nothing
  const uses = timelineUses(context.state.document, found.timeline.name);
  if (uses.interactions + uses.actions > 0) return { kind: 'refused', message: message('status.motion.timelineInUse', { name: found.timeline.name, count: uses.interactions + uses.actions }) };
  const kept = timelinesOf(context.state.document).filter((_one, index) => index !== found.index);
  return { kind: 'change', patches: writeTimelines(context.state.document, kept), message: message('status.motion.timelineDeleted', { name: found.timeline.name }) };
});

// ---------------------------------------------------------------- actions

// An action a door names: by its id (the panel's bar, a gesture) or by its place in the timeline (a scenario, which
// cannot know a generated id).
function actionOf(timeline: MotionTimeline, id: string | undefined, at: number | undefined): TimelineAction | null {
  if (id !== undefined) return timeline.actions.find((action) => action.id === id) ?? null;
  return at === undefined ? null : (timeline.actions[at] ?? null);
}

export const addActionCommand = registerHandler('motion.addAction', (context, { timeline, kind, placement }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  if (!isEffectKind(kind)) return invalid(kind);
  const id = () => context.ids.next();
  const action: TimelineAction = {
    id: id(),
    // the element whose trigger plays the timeline; the Target field picks another
    target: { kind: 'self' },
    start: placementStart(found.timeline, (placement ?? 'after') as Placement, playheadOf(context)),
    duration: EFFECTS[kind].duration,
    effect: defaultEffect(kind, id),
  };
  return commitTimeline(found.index, addAction(found.timeline, action), message('status.motion.actionAdded', { name: { key: effectLabel(kind) }, timeline: found.timeline.name }));
});

// The editor's maker of the picking state (spec motion-timeline: an action's target is picked on the canvas or on a
// Layers row, never typed), as interactions.update's is (core/events/interactions.ts PickMaking): the core never
// touches editor state itself.
export interface MotionPickMaking<Ui> {
  makePicking(ui: Ui, picking: { readonly timeline: string; readonly action: string }): Ui;
  makePicked(ui: Ui): Ui;
}

// What one field of an action's door makes of it.
function updatedAction<Ui>(context: HandlerContext<Ui>, action: TimelineAction, field: string, value: unknown): TimelineAction | Outcome<never> {
  const without = (key: keyof TimelineAction): TimelineAction => {
    return Object.fromEntries(Object.entries(action).filter(([name]) => name !== key)) as unknown as TimelineAction;
  };
  switch (field) {
    case 'kind': {
      const kind = readText(value);
      if (kind === null || !isEffectKind(kind)) return invalid(value);
      if (kind === action.effect.kind) return action;
      // another kind starts from that kind's own defaults; a timed one keeps the bar's length, its keyframes scaled to
      // it
      const id = () => context.ids.next();
      const changed: TimelineAction = { ...without('easing'), duration: EFFECTS[kind].duration, effect: defaultEffect(kind, id) };
      return EFFECTS[kind].timed && action.duration > 0 ? withDuration(changed, action.duration) : changed;
    }
    case 'target': {
      // a target named by its kind alone (self, children...), or by its kind and value: an object from a menu, the
      // node a pick gives
      if (isRecord(value) && typeof value.kind === 'string' && isTargetKind(value.kind)) {
        const given = value.kind === 'element' ? value.node : value.kind === 'component' ? value.component : value.className;
        const made = targetOf(value.kind, typeof given === 'string' ? given : null);
        if (made === null) return invalid(value);
        if (made.kind === 'element' && locate(context.state.document, made.node) === null) return invalid(made.node);
        return { ...action, target: made };
      }
      const kind = readText(value);
      if (kind === null || !isTargetKind(kind)) return invalid(value);
      // a kind that names a class keeps the class it had, else takes the selected element's first class; a component
      // kind takes the project's first component; the Target value field changes either
      const selected = primaryNode(context.state.document, context.state.selection)?.node.classes[0] ?? null;
      const held = 'className' in action.target ? action.target.className : selected;
      const given = kind === 'component' ? (context.state.document.components?.[0]?.name ?? null) : held;
      if (kind === 'element') return invalid(value);
      const made = targetOf(kind, given);
      if (made === null) return { kind: 'refused', message: message(kind === 'component' ? 'status.motion.needsComponent' : 'status.motion.needsClass', { name: { key: targetLabel(kind) } }) };
      return { ...action, target: made };
    }
    case 'targetValue': {
      const text = readText(value);
      const made = text === null ? null : targetOf(action.target.kind, text);
      if (made === null || made.kind === 'element') return invalid(value);
      return { ...action, target: made };
    }
    case 'start': {
      const start = readTime(value);
      return start === null ? invalid(value) : { ...action, start };
    }
    case 'duration': {
      const duration = readTime(value);
      if (duration === null || (!EFFECTS[action.effect.kind].timed && duration !== 0)) return invalid(value);
      return withDuration(action, duration);
    }
    case 'easing': {
      const easing = readText(value);
      if (easing === null) return invalid(value);
      return easing === '' ? without('easing') : { ...action, easing };
    }
    case 'repeat': {
      const text = typeof value === 'number' ? String(value) : readText(value);
      if (text === 'infinite') return { ...action, repeat: 'infinite' };
      const count = readNumber(text);
      if (count === null || !Number.isInteger(count) || count < 1) return invalid(value);
      return count === 1 ? without('repeat') : { ...action, repeat: count };
    }
    case 'yoyo': {
      const yoyo = readBoolean(value);
      if (yoyo === null) return invalid(value);
      return yoyo ? { ...action, yoyo: true } : without('yoyo');
    }
    case 'staggerEach': {
      const each = readTime(value);
      if (each === null) return invalid(value);
      return each === 0 ? without('stagger') : { ...action, stagger: { each, from: action.stagger?.from ?? 'start' } };
    }
    case 'staggerFrom': {
      const from = readText(value);
      return { ...action, stagger: { each: action.stagger?.each ?? DEFAULT_STAGGER, from: from as 'start' } };
    }
    default:
      return invalid(field);
  }
}

// the stagger a "from" set before any spacing takes, in ms
const DEFAULT_STAGGER = 50;

// motion.updateAction, for the editor state that holds the action whose target is being picked: a door of the Target
// field starts picking (ui alone), and any other door's write clears it.
export function updateActionCommand<Ui>(make: MotionPickMaking<Ui>): RegisteredHandler<'motion.updateAction', Ui> {
  return registerHandler<'motion.updateAction', Ui>('motion.updateAction', (context, { timeline, action, at, field, value }): Outcome<Ui> => {
    const found = timelineNamed(context, timeline);
    if (isOutcome(found)) return found;
    const held = actionOf(found.timeline, action, at);
    if (held === null) return { kind: 'change' };
    if (field === 'target' && isRecord(value) && value.pick === true) return { kind: 'change', ui: make.makePicking(make.makePicked(context.state.ui), { timeline: found.timeline.name, action: held.id }) };
    const next = updatedAction(context, held, field, value);
    if (isOutcome(next)) return next;
    const cleared = make.makePicked(context.state.ui);
    const ui = cleared === context.state.ui ? {} : { ui: cleared };
    if (JSON.stringify(next) === JSON.stringify(held)) return { kind: 'change', ...ui };
    const outcome = commitTimeline(found.index, replaceAction(found.timeline, held.id, () => next), message('status.motion.actionUpdated', { name: { key: effectLabel(next.effect.kind) }, timeline: found.timeline.name }), value);
    return outcome.kind === 'change' ? { ...outcome, ...ui } : outcome;
  });
}

// The booleans and numbers an effect holds, so a text field's text reaches them as what they are.
const EFFECT_BOOLEANS = new Set(['smooth', 'newTab', 'remember', 'loop']);
const EFFECT_NUMBERS = new Set(['offset', 'index', 'speed']);
// a Lottie action's frames are numbers; a navigate action's "to" is where it goes
const isNumber = (effect: Effect, option: string): boolean => EFFECT_NUMBERS.has(option) || (effect.kind === 'lottie' && (option === 'from' || option === 'to'));

// One option of an action's effect set (its operation, its class, its address...), from a field's text or a menu's
// value. The kind of the effect stays: motion.updateAction's `kind` changes it.
export const setEffectOptionCommand = registerHandler('motion.setEffectOption', (context, { timeline, action, at, option, value }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const held = actionOf(found.timeline, action, at);
  if (held === null) return { kind: 'change' };
  if (!(option in held.effect) && !OPTIONAL_OPTIONS.has(option)) return { kind: 'refused', message: message('status.motion.notAnOption', { name: { key: effectLabel(held.effect.kind) } }) };
  let read: unknown = value;
  if (EFFECT_BOOLEANS.has(option)) read = readBoolean(value);
  else if (isNumber(held.effect, option)) read = value === '' ? undefined : readNumber(value);
  else if (option === 'time') read = value === '' ? undefined : readTime(value);
  // emptying an attribute's or a style's value removes it from the target
  else if (option === 'value' && (held.effect.kind === 'attribute' || held.effect.kind === 'style') && value === '') read = null;
  else if (typeof value === 'string') read = value.trim();
  if (read === null && option !== 'value') return invalid(value);
  // an option read as nothing is taken away from the effect
  const effect: Record<string, unknown> = read === undefined ? Object.fromEntries(Object.entries(held.effect).filter(([name]) => name !== option)) : { ...held.effect, [option]: read };
  // a timeline it controls is one of the project's, never itself
  if (effect.kind === 'timeline' && typeof effect.timeline === 'string' && effect.timeline !== '') {
    if (effect.timeline === found.timeline.name || findTimeline(context.state.document, effect.timeline) === null) return { kind: 'refused', message: message('status.motion.notFound', { name: effect.timeline }) };
  }
  // an address goes through the one rule of an address (core/elements/address.ts)
  if (effect.kind === 'navigate' && typeof effect.address === 'string') {
    const address = readAddress(effect.address);
    if (!address.ok) return { kind: 'refused', message: address.refusal };
    effect.address = address.value;
  }
  // going back or forward names no address; copying the target's text names no text
  if (effect.kind === 'navigate' && (effect.to === 'back' || effect.to === 'forward')) delete effect.address;
  if (effect.kind === 'navigate' && (effect.to === 'url' || effect.to === 'page') && effect.address === undefined) effect.address = '';
  if (effect.kind === 'clipboard' && effect.source === 'target-text') delete effect.text;
  if (effect.kind === 'clipboard' && effect.source === 'text' && effect.text === undefined) effect.text = '';
  if (effect.kind === 'slide' && effect.operation !== 'go') delete effect.index;
  if (effect.kind === 'slide' && effect.operation === 'go' && effect.index === undefined) effect.index = 0;
  const next: TimelineAction = { ...held, effect: effect as unknown as Effect };
  if (JSON.stringify(next) === JSON.stringify(held)) return { kind: 'change' };
  return commitTimeline(found.index, replaceAction(found.timeline, held.id, () => next), message('status.motion.actionUpdated', { name: { key: effectLabel(held.effect.kind) }, timeline: found.timeline.name }), value);
});

// options an effect holds only in some of its forms (a seek's time, a segment's frames, a custom event's detail)
const OPTIONAL_OPTIONS = new Set(['time', 'index', 'address', 'text', 'detail', 'from', 'to']);

const idList = (value: unknown): ReadonlySet<string> | null => (Array.isArray(value) && value.every((one) => typeof one === 'string') ? new Set(value as string[]) : null);
// the actions a door names: a list of ids (the selection), else the one at a place
function actionIds(timeline: MotionTimeline, ids: unknown, at: number | undefined): ReadonlySet<string> | null {
  if (ids !== undefined) return idList(ids);
  const one = at === undefined ? undefined : timeline.actions[at];
  return one === undefined ? null : new Set([one.id]);
}

export const removeActionsCommand = registerHandler('motion.removeActions', (context, { timeline, actions, at }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const ids = actionIds(found.timeline, actions, at);
  if (ids === null) return { kind: 'change' };
  const next = removeActions(found.timeline, ids);
  if (next.actions.length === found.timeline.actions.length) return { kind: 'change' };
  return commitTimeline(found.index, next, message('status.motion.actionsRemoved', { timeline: found.timeline.name }));
});

// A drag's delta: the ms the pointer owner measured (snapped), else the travel in px read at the panel's zoom.
const deltaOf = (delta: number | undefined, distance: number | undefined, pixelsPerSecond: number): number | null =>
  delta !== undefined ? Math.round(delta) : distance !== undefined ? Math.round((distance / pixelsPerSecond) * 1000) : null;
// the zoom a drag's travel is read at when no delta comes with it: the panel's first zoom (interactions.json)
const dragPixelsPerSecond = (): number => numberConstant('motion.pixelsPerSecond');

export const moveActionsCommand = registerHandler('motion.moveActions', (context, { timeline, actions, at, delta, distance }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const ids = actionIds(found.timeline, actions, at);
  const moved = deltaOf(delta, distance, dragPixelsPerSecond());
  if (ids === null || moved === null) return { kind: 'change' };
  const shared = clampActionDelta(found.timeline, ids, moved);
  if (shared === 0) return { kind: 'change' };
  return commitTimeline(found.index, moveActions(found.timeline, ids, shared), message('status.motion.actionsMoved', { timeline: found.timeline.name, delta: (shared / 1000).toFixed(2) }));
});

// the shortest a timed bar is resized to, in ms (a bar always keeps a length a pointer can grab again)
const MINIMUM_DURATION = 10;

export const resizeActionCommand = registerHandler('motion.resizeAction', (context, { timeline, action, at, edge, delta, distance }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const held = actionOf(found.timeline, action, at);
  const moved = deltaOf(delta, distance, dragPixelsPerSecond());
  if (held === null || moved === null) return { kind: 'change' };
  if (!EFFECTS[held.effect.kind].timed) return { kind: 'refused', message: message('status.motion.instant', { name: { key: effectLabel(held.effect.kind) } }) };
  const next = resizeAction(found.timeline, held.id, edge, moved, MINIMUM_DURATION);
  const resized = next.actions.find((one) => one.id === held.id);
  if (resized === undefined || (resized.start === held.start && resized.duration === held.duration)) return { kind: 'change' };
  return commitTimeline(found.index, next, message('status.motion.actionResized', { name: { key: effectLabel(held.effect.kind) }, duration: (resized.duration / 1000).toFixed(2) }));
});

// ---------------------------------------------------------------- keyframes

const readRefs = (value: unknown): KeyframeRef[] | null => {
  if (!Array.isArray(value)) return null;
  const refs: KeyframeRef[] = [];
  for (const one of value) {
    if (!isRecord(one) || typeof one.action !== 'string' || typeof one.track !== 'string' || typeof one.keyframe !== 'string') return null;
    refs.push({ action: one.action, track: one.track, keyframe: one.keyframe });
  }
  return refs;
};

// The keyframes a door names: a list of references (the selection, a gesture), else the one at a place — the action's
// place in the timeline, the property's track, the keyframe's place in that track (a scenario's way).
function keyframeRefs(timeline: MotionTimeline, given: { readonly keyframes?: unknown; readonly at?: number | undefined; readonly property?: string | undefined; readonly keyframeAt?: number | undefined }): KeyframeRef[] | null {
  if (given.keyframes !== undefined) return readRefs(given.keyframes);
  const action = given.at === undefined ? undefined : timeline.actions[given.at];
  if (action === undefined || (action.effect.kind !== 'animate' && action.effect.kind !== 'split-text')) return null;
  const track = action.effect.tracks.find((one) => one.property === given.property);
  const keyframe = track?.keyframes[given.keyframeAt ?? 0];
  return track === undefined || keyframe === undefined ? null : [{ action: action.id, track: track.id, keyframe: keyframe.id }];
}

// What a new keyframe of a property holds when no value is given: what the property holds at the nearest keyframe
// before the time, else its first keyframe, else the property's own initial value (a transform part's identity).
function startingValue(action: TimelineAction, property: string, local: number): string | null {
  const tracks = action.effect.kind === 'animate' || action.effect.kind === 'split-text' ? action.effect.tracks : [];
  const track = tracks.find((one) => one.property === property);
  const nearest = track?.keyframes.filter((keyframe) => keyframe.time <= local).at(-1) ?? track?.keyframes[0];
  if (nearest !== undefined) return nearest.value;
  const part = PART_IDENTITY[property];
  if (part !== undefined) return part;
  return INITIAL_VALUES[property] ?? null;
}
// a transform part's identity, the value a new keyframe of it starts from
const PART_IDENTITY: Readonly<Record<string, string>> = {
  'translate-x': '0px',
  'translate-y': '0px',
  'translate-z': '0px',
  'scale-x': '1',
  'scale-y': '1',
  'rotate-x': '0deg',
  'rotate-y': '0deg',
  'rotate-z': '0deg',
  'skew-x': '0deg',
  'skew-y': '0deg',
};

export const setKeyframeCommand = registerHandler('motion.setKeyframe', (context, { timeline, action, at, property, value }): Outcome<never> => {
  // at the playhead of the editor's Timeline
  const time = playheadOf(context);
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const held = actionOf(found.timeline, action, at);
  if (held === null) return { kind: 'change' };
  if (held.effect.kind !== 'animate' && held.effect.kind !== 'split-text') return { kind: 'refused', message: message('status.motion.notKeyed', { name: { key: effectLabel(held.effect.kind) } }) };
  const named = property.trim();
  const local = Math.round(time) - held.start;
  if (local < 0) return { kind: 'refused', message: message('status.motion.recordBeforeAction', { time: (time / 1000).toFixed(2) }) };
  const text = value === undefined || value.trim() === '' ? startingValue(held, named, local) : value.trim();
  if (text === null || named === '') return invalid(property);
  // a keyframe past the action's end makes the action longer, so it lies inside it
  const grown = local > held.duration ? { ...held, duration: local } : held;
  const next = setKeyframeAt(grown, named, local, text, undefined, () => context.ids.next());
  return commitTimeline(found.index, replaceAction(found.timeline, held.id, () => next), message('status.motion.keyframeSet', { property: named, time: (time / 1000).toFixed(2) }), value ?? property);
});

export const editKeyframeCommand = registerHandler('motion.editKeyframe', (context, { timeline, keyframe, at, property, keyframeAt, field, value }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const [ref] = keyframeRefs(found.timeline, { keyframes: keyframe === undefined ? undefined : [keyframe], at, property, keyframeAt }) ?? [];
  if (ref === undefined) return { kind: 'change' };
  let next: MotionTimeline;
  if (field === 'value') {
    const text = readText(value);
    if (text === null || text === '') return invalid(value);
    next = editKeyframe(found.timeline, ref, { value: text });
  } else if (field === 'easing') {
    // the easing of the segment that starts at the keyframe (plan: "aceleração por trecho")
    const text = readText(value);
    if (text === null) return invalid(value);
    next = editKeyframe(found.timeline, ref, { easing: text === '' ? null : text });
  } else if (field === 'time') {
    // the time typed is the timeline's; the keyframe is timed from its action's start
    const time = readTime(value);
    const owner = found.timeline.actions.find((one) => one.id === ref.action);
    if (time === null || owner === undefined) return invalid(value);
    next = editKeyframe(found.timeline, ref, { time: time - owner.start });
  } else {
    // the track's property renamed (an animation of opacity becomes one of scale)
    const renamed = readText(value);
    if (renamed === null || renamed === '') return invalid(value);
    next = replaceAction(found.timeline, ref.action, (owner) =>
      owner.effect.kind === 'animate' || owner.effect.kind === 'split-text'
        ? { ...owner, effect: { ...owner.effect, tracks: owner.effect.tracks.map((track) => (track.id === ref.track ? { ...track, property: renamed } : track)) } }
        : owner,
    );
  }
  if (JSON.stringify(next) === JSON.stringify(found.timeline)) return { kind: 'change' };
  return commitTimeline(found.index, next, message('status.motion.keyframeEdited', { timeline: found.timeline.name }), value);
});

export const moveKeyframesCommand = registerHandler('motion.moveKeyframes', (context, { timeline, keyframes, at, property, keyframeAt, delta, distance }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const refs = keyframeRefs(found.timeline, { keyframes, at, property, keyframeAt });
  const moved = deltaOf(delta, distance, dragPixelsPerSecond());
  if (refs === null || moved === null) return { kind: 'change' };
  const next = moveKeyframes(found.timeline, refs, moved);
  if (next === found.timeline) return { kind: 'change' };
  return commitTimeline(found.index, next, message('status.motion.keyframesMoved', { timeline: found.timeline.name }));
});

export const deleteKeyframesCommand = registerHandler('motion.deleteKeyframes', (context, { timeline, keyframes, at, property, keyframeAt }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const refs = keyframeRefs(found.timeline, { keyframes, at, property, keyframeAt });
  if (refs === null || refs.length === 0) return { kind: 'change' };
  const next = deleteKeyframes(found.timeline, refs);
  return commitTimeline(found.index, next, message('status.motion.keyframesDeleted', { timeline: found.timeline.name }));
});

const readCopied = (value: unknown): CopiedKeyframe[] | null => {
  if (!Array.isArray(value)) return null;
  const copied: CopiedKeyframe[] = [];
  for (const one of value) {
    if (!isRecord(one) || typeof one.property !== 'string' || typeof one.offset !== 'number' || typeof one.value !== 'string') return null;
    copied.push({ property: one.property, offset: one.offset, value: one.value, ...(typeof one.easing === 'string' ? { easing: one.easing } : {}) });
  }
  return copied;
};

export const pasteKeyframesCommand = registerHandler('motion.pasteKeyframes', (context, { timeline, action, at, keyframes }): Outcome<never> => {
  // at the playhead of the editor's Timeline
  const time = playheadOf(context);
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const held = actionOf(found.timeline, action, at);
  const copied = readCopied(keyframes);
  if (copied === null || copied.length === 0) return { kind: 'refused', message: message('status.motion.nothingCopied') };
  if (held === null) return { kind: 'change' };
  const next = pasteKeyframes(found.timeline, held.id, time, copied, () => context.ids.next());
  if (next === null) return { kind: 'refused', message: message('status.motion.recordBeforeAction', { time: (time / 1000).toFixed(2) }) };
  return commitTimeline(found.index, next, message('status.motion.keyframesPasted', { timeline: found.timeline.name }));
});

// ---------------------------------------------------------------- markers

// A marker a door names: by its id, or by its place on the timeline (markers are kept in time order).
function markerOf(timeline: MotionTimeline, id: string | undefined, at: number | undefined) {
  if (id !== undefined) return timeline.markers.find((marker) => marker.id === id) ?? null;
  return at === undefined ? null : (timeline.markers[at] ?? null);
}

export const addMarkerCommand = registerHandler('motion.addMarker', (context, { timeline, name }): Outcome<never> => {
  // at the playhead of the editor's Timeline
  const time = playheadOf(context);
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const typed = (name ?? '').trim() || context.words('motion.marker.defaultName', { number: found.timeline.markers.length + 1 });
  return commitTimeline(found.index, addMarker(found.timeline, { id: context.ids.next(), name: typed, time: Math.max(0, Math.round(time)) }), message('status.motion.markerAdded', { name: typed, time: (time / 1000).toFixed(2) }), name ?? '');
});

export const moveMarkerCommand = registerHandler('motion.moveMarker', (context, { timeline, marker, markerAt, delta, distance }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const held = markerOf(found.timeline, marker, markerAt);
  const moved = deltaOf(delta, distance, dragPixelsPerSecond());
  if (held === null || moved === null) return { kind: 'change' };
  const next = moveMarker(found.timeline, held.id, moved);
  if (next.markers.find((one) => one.id === held.id)?.time === held.time) return { kind: 'change' };
  return commitTimeline(found.index, next, message('status.motion.markerMoved', { name: held.name }));
});

export const renameMarkerCommand = registerHandler('motion.renameMarker', (context, { timeline, marker, markerAt, name }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const held = markerOf(found.timeline, marker, markerAt);
  if (held === null || name.trim() === held.name) return { kind: 'change' };
  return commitTimeline(found.index, renameMarker(found.timeline, held.id, name.trim()), message('status.motion.markerRenamed', { name: name.trim() }), name);
});

export const removeMarkerCommand = registerHandler('motion.removeMarker', (context, { timeline, marker, markerAt }): Outcome<never> => {
  const found = timelineNamed(context, timeline);
  if (isOutcome(found)) return found;
  const held = markerOf(found.timeline, marker, markerAt);
  if (held === null) return { kind: 'change' };
  return commitTimeline(found.index, removeMarker(found.timeline, held.id), message('status.motion.markerRemoved', { name: held.name }));
});

// ---------------------------------------------------------------- behaviours

// What a behaviour holds while the person has not set its amount (spec motion-behaviours).
const BEHAVIOUR_DEFAULTS: Readonly<Record<RuntimeBehaviourKind, Behaviour>> = {
  'smooth-scroll': { kind: 'smooth-scroll', amount: 0 },
  parallax: { kind: 'parallax', amount: 0.3, axis: 'y' },
  marquee: { kind: 'marquee', amount: 60, axis: 'x' },
  'cursor-follow': { kind: 'cursor-follow', amount: 0.85 },
};

// The axis a behaviour runs on: the one it holds, else its kind's own (parallax y, marquee x), the one the runtime
// reads too (editor/motion/runtime/behaviours.ts). The inspector draws and edits that axis (the audit's BA1).
export const behaviourAxis = (behaviour: Behaviour): 'x' | 'y' =>
  behaviour.axis ?? (isRuntimeBehaviour(behaviour.kind) ? BEHAVIOUR_DEFAULTS[behaviour.kind].axis : undefined) ?? 'y';

const isRuntimeBehaviour = (kind: string): kind is RuntimeBehaviourKind => (RUNTIME_BEHAVIOURS as readonly string[]).includes(kind);

// The properties a style behaviour writes, in the order its door's adapter lists them (manifest/commands/motion.json:
// the sticky door writes position then top; the scroll snap door the container's snap type, its overflow along x and
// along y, then the children's alignment), so no property is named here by hand.
function writesOf(door: string): readonly string[] {
  return manifest.doors.find((entry) => entry.door.id === door)?.door.adapter.writes ?? [];
}

// Sticky and scroll snap are plain CSS: written through the style owner (core/style/set.ts writeStyle), each value
// read by the property's own codec, never recorded into a timeline.
function styleBehaviour<Ui>(context: HandlerContext<Ui>, found: Located, kind: 'sticky' | 'scroll-snap', amount: number | undefined, axis: 'x' | 'y' | undefined): Outcome<Ui> {
  const plain: HandlerContext<Ui> = { ...context, keyframe: null, motion: context.motion === undefined || context.motion === null ? null : { ...context.motion, recording: null } };
  const read = (property: string | undefined, text: string): { readonly property: string; readonly css: string } | null => {
    const css = property === undefined ? null : (readValue(plain, property, text)?.css ?? null);
    return property === undefined || css === null ? null : { property, css };
  };
  const said = message('status.motion.behaviourSet', { name: { key: behaviourLabel(kind) }, element: found.node.name });
  if (kind === 'sticky') {
    const [positionProperty, insetProperty] = writesOf('inspector-motion-behaviour-sticky');
    const position = read(positionProperty, 'sticky');
    const inset = read(insetProperty, `${Math.round(amount ?? 0)}px`);
    if (position === null || inset === null) return invalid(amount ?? 0);
    const written = writeStyle(plain, position.property, position.css, { [position.property]: position.css, [inset.property]: inset.css });
    return written.kind === 'change' ? { ...written, message: said } : written;
  }
  const along = axis ?? 'x';
  const [snapProperty, overflowX, overflowY, alignProperty] = writesOf('inspector-motion-behaviour-scroll-snap');
  const snapType = read(snapProperty, `${along} mandatory`);
  const overflow = read(along === 'x' ? overflowX : overflowY, 'auto');
  const align = read(alignProperty, 'start');
  if (snapType === null || overflow === null || align === null) return invalid(along);
  const container = writeStyle(plain, snapType.property, snapType.css, { [snapType.property]: snapType.css, [overflow.property]: overflow.css });
  if (container.kind !== 'change') return container;
  // each child snaps at its start: the same write, with the children as the selection
  const children = found.node.children.map((child) => child.id as NodeId);
  if (children.length === 0) return { ...container, message: said };
  const items = writeStyle({ ...plain, state: { ...plain.state, selection: children } }, align.property, align.css);
  if (items.kind !== 'change') return items;
  return { kind: 'change', patches: [...(container.patches ?? []), ...(items.patches ?? [])], message: said };
}

export const setBehaviourCommand = registerHandler('motion.setBehaviour', (context, { behaviour, amount: given, axis }): Outcome<never> => {
  // a field hands its text, a button its number
  const amount = given === undefined ? undefined : (readNumber(given) ?? Number.NaN);
  const found = primaryNode(context.state.document, context.state.selection);
  if (found === null) return { kind: 'change' };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const kind = behaviour as BehaviourKind;
  if (kind === 'sticky' || kind === 'scroll-snap') return styleBehaviour(context, found, kind, amount, axis);
  if (!isRuntimeBehaviour(kind)) return invalid(behaviour);
  const base = behavioursOf(found.node).find((one) => one.kind === kind) ?? BEHAVIOUR_DEFAULTS[kind];
  const wanted: Behaviour = { ...base, ...(amount === undefined ? {} : { amount }), ...(axis === undefined ? {} : { axis }) };
  const read = readBehaviour(wanted);
  if (!read.ok) return invalid(amount ?? behaviour);
  const others = behavioursOf(found.node).filter((one) => one.kind !== kind);
  const next = [...others, read.value];
  if (JSON.stringify(next) === JSON.stringify(behavioursOf(found.node))) return { kind: 'change' };
  return { kind: 'change', patches: writeBehaviours(found.node, found.path, next), message: message('status.motion.behaviourSet', { name: { key: behaviourLabel(kind) }, element: found.node.name }) };
});

export const removeBehaviourCommand = registerHandler('motion.removeBehaviour', (context, { behaviour }): Outcome<never> => {
  const found = primaryNode(context.state.document, context.state.selection);
  if (found === null) return { kind: 'change' };
  if (!behavioursOf(found.node).some((one) => one.kind === behaviour)) return { kind: 'change' };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const next = behavioursOf(found.node).filter((one) => one.kind !== behaviour);
  return { kind: 'change', patches: writeBehaviours(found.node, found.path, next), message: message('status.motion.behaviourRemoved', { name: { key: behaviourLabel(behaviour) }, element: found.node.name }) };
});

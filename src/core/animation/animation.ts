// The animations of an element (INVENTORY.md, owners; group 18): the document's `animations` (model.ts) and
// every command over them — animation.create, rename, delete, addKeyframe, moveKeyframe, setKeyframeEasing,
// deleteKeyframe, setSettings — with the one writer of their CSS text (the @keyframes rule and the animation
// properties), which the canvas (render.ts), the export (output.ts, export.ts) and the timeline preview
// (src/editor/timeline/preview.ts) all read.
//  - A name is a @keyframes name (a CSS identifier), unique in the whole document: one stylesheet holds every
//    animation, so two elements may not share one. A taken name is refused (status.animation.nameTaken), a text that is
//    no name too (status.animation.nameInvalid).
//  - A new animation holds a 1 s duration, no delay, one iteration, direction normal, fill mode both, a linear timing
//    function and play state running (linear, so what the timeline scrubs is what the keyframes say), with a keyframe
//    at 0% and one at 100%, both holding nothing until a value is set.
//  - An offset is a whole percent from 0 to 100 (interactions.json timeline.offsetRange); the keyframes are kept in
//    offset order and no two share one (status.animation.keyframeTaken, status.animation.offsetOutOfRange).
//  - A setting's value is read by the property's codec (the one reader of a typed style value) against what the
//    setting's door offers (its adapter.offers names the CSS property; the generated list of that property gives the
//    keywords and units) and refused with status.animation.invalidSetting naming the setting and the text.
import { message, registerHandler, type HandlerContext, type Outcome } from '../commands/registry.ts';
import { locate, type Animation, type DocNode, type DocumentJson, type Keyframe, type NodeId } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { firstLockRefusal } from '../nodes/flags.ts';
import { readValue } from '../style/set.ts';
import { GENERATED_VALUES } from '../../generated/value-lists.ts';
import { declarationLines, type OutputModel } from '../render/output.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { MessageId } from '../../generated/ids.ts';

const NONE: readonly Animation[] = [];
export const animationsOf = (node: DocNode): readonly Animation[] => node.animations ?? NONE;

// a @keyframes name and a CSS identifier alike (a class name's grammar)
const ANIMATION_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

// The doors that set an animation's properties, in the order the Timeline panel draws them (the manifest's placement),
// and the setting each stands for (its own `setting` argument): the manifest's own list, never re-listed here.
// the manifest's door of a command the animations own (used for the entries the module needs, never a hand-written id)
type DoorRef = (typeof manifest.doors)[number];
const orderOf = (entry: DoorRef): number => (typeof entry.door.placement === 'object' ? entry.door.placement.order : 0);
const SETTING_DOORS: readonly { readonly setting: string; readonly entry: DoorRef }[] = manifest.doors
  .filter((d) => d.door.kind === 'panel-control' && d.door.panel === 'timeline' && d.door.control.startsWith('setting-'))
  .sort((a, b) => orderOf(a) - orderOf(b))
  .flatMap((entry) => {
    const setting = (entry.door.args as { setting?: unknown }).setting;
    return typeof setting === 'string' ? [{ setting, entry }] : [];
  });

export const SETTINGS: readonly string[] = SETTING_DOORS.map(({ setting }) => setting);

// The CSS property a setting writes: the property the setting's own door offers (manifest/commands/animation.json
// adapter.offers), the one place that pair is written. Null for a setting no door offers.
export function settingProperty(setting: string): string | null {
  return SETTING_DOORS.find((door) => door.setting === setting)?.entry.door.adapter?.offers?.property ?? null;
}

// The CSS property a panel field of the timeline edits, by the control its door draws: the property the door offers
// (the keyframe's easing, whose field is no setting of the animation's settings).
// the CSS property a keyframe's easing is written with (the timeline's easing field offers it)
export const keyframeEasingProperty = (): string | null => offeredProperty(EASING_CONTROL);

function offeredProperty(control: string): string | null {
  return manifest.doors.find((d) => d.door.kind === 'panel-control' && d.door.panel === 'timeline' && d.door.control === control)?.door.adapter?.offers?.property ?? null;
}
// the control the keyframe's easing field is drawn as (manifest/commands/animation.json)
const EASING_CONTROL = 'keyframe-easing';

function findAnimation(node: DocNode, name: string): Animation | null {
  return animationsOf(node).find((animation) => animation.name === name) ?? null;
}

// every @keyframes name the document holds, of every page
function allAnimationNames(document: DocumentJson): Set<string> {
  const names = new Set<string>();
  for (const page of document.pages) {
    const walk = (node: DocNode): void => {
      for (const animation of animationsOf(node)) names.add(animation.name);
      for (const child of node.children) walk(child);
    };
    walk(page.tree);
  }
  return names;
}


// the keyframes of an animation the CSS is written for: the ones that hold something, in offset order (a keyframe added
// and not filled yet writes nothing)
const writtenKeyframes = (animation: Animation): readonly Keyframe[] => animation.keyframes.filter((k) => Object.keys(k.declarations).length > 0);

// The duration of an animation in whole ms, read from its stored CSS text ("1s", "800ms", "1.5s"); 0 while it holds a
// duration that is no time (the timeline then has no length to draw).
export function durationMs(animation: Animation): number {
  const held = animation.settings[DURATION_SETTING] ?? '';
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|s)$/.exec(held.trim().toLowerCase());
  if (match === null) return 0;
  const value = Number(match[1]);
  return match[2] === 's' ? Math.round(value * 1000) : Math.round(value);
}
// the setting a time is stored under: the one whose door's drawing names the duration (manifest/commands/animation.json
// controls the timeline's fields)
const controlNameOf = (entry: DoorRef): string | null => (entry.door.kind === 'panel-control' ? entry.door.control : null);
const DURATION_SETTING = SETTING_DOORS.find(({ entry }) => controlNameOf(entry) === 'setting-duration')?.setting ?? '';

// The @keyframes rule of an animation (the export's stylesheet and the canvas's own keyframes sheet): one block per
// keyframe that holds something, its offset in percent and its declarations, in offset order; '' when nothing would be
// written. `layout` is the export's laid-out form or the canvas's one line per rule.
export function keyframesCss(animation: Animation, model: OutputModel, layout: 'line' | 'block' = 'block'): string {
  const blocks = writtenKeyframes(animation).map((keyframe) => {
    const lines = declarationLines(keyframe.declarations, model, layout);
    if (lines.length === 0) return '';
    const head = `${keyframe.offset}%`;
    return layout === 'line' ? `${head} { ${lines.join(' ')} }` : `${head} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`;
  });
  const written = blocks.filter((b) => b !== '');
  if (written.length === 0) return '';
  return layout === 'line' ? `@keyframes ${animation.name} { ${written.join(' ')} }` : `@keyframes ${animation.name} {\n${written.join('\n')}\n}`;
}

// The animation properties of an animation as CSS declarations, one per setting, in the settings' order: what the
// export writes on the element's own rule (an animation nothing plays by an event). The values are the stored CSS text.
function animationDeclarations(animation: Animation, overrides: Readonly<Record<string, string>> = {}): readonly string[] {
  return [
    // the @keyframes it plays, then the settings (the name is no setting of the animation: it is the animation)
    `animation-name: ${animation.name};`,
    ...SETTINGS.flatMap((setting) => {
      const property = settingProperty(setting);
      const value = overrides[setting] ?? animation.settings[setting];
      return property === null || value === undefined || value === '' ? [] : [`${property}: ${value};`];
    }),
  ];
}

// The animation properties of an element's own animations together (AN3: each animation wrote its own set into the
// one rule, and the last one won): one animation as animationDeclarations writes it, several as each property's list
// in the animations' order, a setting an animation leaves empty taking its default, as CSS lists them.
export function animationListDeclarations(animations: readonly Animation[]): readonly string[] {
  if (animations.length <= 1) return animations.flatMap((animation) => animationDeclarations(animation));
  return [
    `animation-name: ${animations.map((animation) => animation.name).join(', ')};`,
    ...SETTINGS.flatMap((setting) => {
      const property = settingProperty(setting);
      if (property === null) return [];
      const values = animations.map((animation) => animation.settings[setting] || defaultSetting(setting));
      return values.every((value) => value === '') ? [] : [`${property}: ${values.join(', ')};`];
    }),
  ];
}

// The class the export writes an animation played by an event with, its @keyframes next to it
// (spec export-events-js): the script adds the class when the event fires (core/events/script.ts).
export const playedClassName = (name: string): string => `anim-${name}`;
export const playedClassDeclarations = (animation: Animation): readonly string[] => animationDeclarations(animation);

// What the canvas draws an animation previewed at the playhead with (spec timeline-preview): the animation properties
// with the playhead as a negative delay, the fill mode the animation's own (the element keeps what the keyframes say
// before the first one and after the last) and the play state the preview holds. Editor-only, never exported.
export function previewDeclarations(animation: Animation, time: number, playing: boolean, loop: boolean): readonly string[] {
  const controlOf = (control: string): string | null => SETTING_DOORS.find(({ entry }) => controlNameOf(entry) === control)?.setting ?? null;
  const delay = controlOf('setting-delay');
  const iterations = controlOf('setting-iterations');
  const fill = controlOf('setting-fill');
  const playState = controlOf('setting-play-state');
  const overrides: Record<string, string> = {};
  if (delay !== null) overrides[delay] = `${-Math.round(time)}ms`;
  if (iterations !== null) overrides[iterations] = loop ? 'infinite' : '1';
  if (fill !== null) overrides[fill] = 'both';
  if (playState !== null) overrides[playState] = playing ? 'running' : 'paused';
  return animationDeclarations(animation, overrides);
}

// the animation a name refers to on a node, refused when the node holds none of that name
function named(node: DocNode, name: string): Animation | null {
  return findAnimation(node, name) ?? null;
}

// What a new animation's settings hold (spec timeline-animations: a 1 s duration): each setting's own default — the
// first value a manifest list offers where the door offers one (a direction, a fill mode), else the value written here
// (a time, a count, a timing function and the play state; an animation starts Linear so what the timeline scrubs is
// what the keyframes say).
const DEFAULTS: Readonly<Record<string, string>> = { duration: '1s', delay: '0s', iterations: '1', timing: 'linear', 'play-state': 'running' };
export function defaultSetting(setting: string): string {
  const offered = GENERATED_VALUES[settingProperty(setting) as never] as { readonly keywords: readonly string[] } | undefined;
  return DEFAULTS[setting] ?? offered?.keywords[0] ?? '';
}
export const defaultSettings = (): Readonly<Record<string, string>> => Object.fromEntries(SETTINGS.map((setting) => [setting, defaultSetting(setting)]));

// the two ends a new animation holds, in offset order
const startKeyframes = (): readonly Keyframe[] => [
  { offset: 0, easing: '', declarations: {} },
  { offset: 100, easing: '', declarations: {} },
];

const insertKeyframe = (keyframes: readonly Keyframe[], keyframe: Keyframe): readonly Keyframe[] => [...keyframes, keyframe].sort((a, b) => a.offset - b.offset);

// the whole node with an animation replaced, added or taken away: a node that holds none carries no `animations`
function withAnimations(node: DocNode, animations: readonly Animation[]): DocNode {
  const { animations: _dropped, ...rest } = node;
  void _dropped;
  return animations.length === 0 ? rest : { ...rest, animations };
}
const replaceAnimation = (node: DocNode, name: string, next: Animation | null): readonly Animation[] =>
  animationsOf(node).flatMap((animation) => (animation.name !== name ? [animation] : next === null ? [] : [next]));

// The one node an animation command acts on: the single selected element (the manifest's `singleSelection` for create;
// the others act on the element that holds the animation the door names, through the selection). A locked element, or
// one inside a locked element, is refused.
function targetNode<Ui>(context: HandlerContext<Ui>): { readonly node: DocNode; readonly path: readonly (string | number)[] } | null {
  const primary = context.state.selection[0];
  if (primary === undefined) return null;
  const found = locate(context.state.document, primary);
  return found === null ? null : { node: found.node, path: found.path };
}
const lockedRefusal = <Ui>(context: HandlerContext<Ui>, node: DocNode) => firstLockRefusal(context.state.document, [node.id as NodeId], 'status.locked.edit');

// the node's value written whole, with its animations replaced (the write of every command here: a node is small and
// its animations are its own, so one patch keeps the document's shape)
const writeAnimations = (found: { readonly node: DocNode; readonly path: readonly (string | number)[] }, animations: readonly Animation[]): Patch[] => [
  { op: 'replace', path: [...found.path], value: withAnimations(found.node, animations) },
];

export const createAnimationCommand = registerHandler('animation.create', (context, { name }): Outcome<never> => {
  const found = targetNode(context);
  if (found === null) return { kind: 'change' };
  const typed = name.trim();
  if (!ANIMATION_NAME.test(typed)) return { kind: 'refused', message: message('status.animation.nameInvalid', { name: typed }) };
  // one stylesheet holds every animation of the document, so a name is taken once
  if (allAnimationNames(context.state.document).has(typed)) return { kind: 'refused', message: message('status.animation.nameTaken', { name: typed }) };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const animation: Animation = { name: typed, settings: defaultSettings(), keyframes: startKeyframes() };
  const patch = writeAnimations(found, [...animationsOf(found.node), animation]);
  return { kind: 'change', patches: patch, message: message('status.animation.created', { name: typed, element: found.node.name }) };
});

export const renameAnimationCommand = registerHandler('animation.rename', (context, { animation, name }): Outcome<never> => {
  const found = targetNode(context);
  const held = found === null ? null : named(found.node, animation);
  if (found === null || held === null) return { kind: 'change' };
  const typed = name.trim();
  if (typed === animation) return { kind: 'change' };
  if (!ANIMATION_NAME.test(typed)) return { kind: 'refused', message: message('status.animation.nameInvalid', { name: typed }) };
  // a name another animation holds (of this element or of any other) is taken: one stylesheet holds them all
  if (allAnimationNames(context.state.document).has(typed)) return { kind: 'refused', message: message('status.animation.nameTaken', { name: typed }) };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const renamed: Animation = { ...held, name: typed };
  // an interaction that plays the animation follows its name (the action names the @keyframes name)
  const interactions = (found.node.interactions ?? []).map((each) => (each.animation === animation ? { ...each, animation: typed } : each));
  const node = { ...withAnimations(found.node, replaceAnimation(found.node, animation, renamed)) };
  const written = interactions.length > 0 ? { ...node, interactions } : node;
  return { kind: 'change', patches: [{ op: 'replace', path: [...found.path], value: written }], message: message('status.animation.renamed', { oldName: animation, name: typed }) };
});

export const deleteAnimationCommand = registerHandler('animation.delete', (context, { animation }): Outcome<never> => {
  const found = targetNode(context);
  if (found === null || named(found.node, animation) === null) return { kind: 'change' };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const next = animationsOf(found.node).filter((each) => each.name !== animation);
  // an interaction that played it goes with it, as one that acts on a deleted element does: it would play nothing
  // (an element plays its own animations: core/events/interactions.ts; the audit's RF1)
  const playing = (found.node.interactions ?? []).filter((each) => !(each.action === 'play-animation' && each.animation === animation));
  const without = withAnimations(found.node, next);
  const { interactions: _held, ...rest } = without;
  void _held;
  const written = playing.length === (found.node.interactions ?? []).length ? without : playing.length === 0 ? rest : { ...without, interactions: playing };
  return { kind: 'change', patches: [{ op: 'replace', path: [...found.path], value: written }], message: message('status.animation.deleted', { name: animation }) };
});

export const addKeyframeCommand = registerHandler('animation.addKeyframe', (context, { animation, offset }): Outcome<never> => {
  const found = targetNode(context);
  const held = found === null ? null : named(found.node, animation);
  if (found === null || held === null) return { kind: 'change' };
  const [low, high] = offsetRange();
  if (!Number.isInteger(offset) || offset < low || offset > high) return { kind: 'refused', message: message('status.animation.offsetOutOfRange', { offset: String(offset) }) };
  if (held.keyframes.some((k) => k.offset === offset)) return { kind: 'refused', message: message('status.animation.keyframeTaken', { offset: String(offset) }) };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const next: Animation = { ...held, keyframes: insertKeyframe(held.keyframes, { offset, easing: '', declarations: {} }) };
  return { kind: 'change', patches: writeAnimations(found, replaceAnimation(found.node, animation, next)), message: message('status.animation.keyframeAdded', { name: animation, offset: String(offset) }) };
});

export const moveKeyframeCommand = registerHandler('animation.moveKeyframe', (context, { animation, keyframe, offset }): Outcome<never> => {
  const found = targetNode(context);
  const held = found === null ? null : named(found.node, animation);
  if (found === null || held === null) return { kind: 'change' };
  const moving = held.keyframes.find((k) => k.offset === keyframe);
  // the offset is what the drag produces (the manifest marks it optional: the gesture gives it, a step leaves it out)
  if (moving === undefined || offset === undefined || offset === keyframe) return { kind: 'change' };
  const [low, high] = offsetRange();
  if (!Number.isInteger(offset) || offset < low || offset > high) return { kind: 'refused', message: message('status.animation.offsetOutOfRange', { offset: String(offset) }) };
  if (held.keyframes.some((k) => k.offset === offset)) return { kind: 'refused', message: message('status.animation.keyframeTaken', { offset: String(offset) }) };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const keyframes = held.keyframes.map((k) => (k.offset === keyframe ? { ...k, offset } : k)).sort((a, b) => a.offset - b.offset);
  return { kind: 'change', patches: writeAnimations(found, replaceAnimation(found.node, animation, { ...held, keyframes })), message: message('status.animation.keyframeMoved', { name: animation, offset: String(offset) }) };
});

export const setKeyframeEasingCommand = registerHandler('animation.setKeyframeEasing', (context, { animation, keyframe, easing }): Outcome<never> => {
  const found = targetNode(context);
  const held = found === null ? null : named(found.node, animation);
  if (found === null || held === null) return { kind: 'change' };
  const key = held.keyframes.find((k) => k.offset === keyframe);
  if (key === undefined) return { kind: 'change' };
  const property = offeredProperty(EASING_CONTROL);
  const typed = easing.trim();
  const read = typed === '' || property === null ? null : readValue(context, property, typed);
  if (typed !== '' && read === null) return { kind: 'refused', message: message('status.animation.invalidSetting', { setting: { key: 'timeline.setting.timing' }, value: typed }) };
  const value = read === null ? '' : read.css;
  if (value === key.easing) return { kind: 'change' };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const keyframes = held.keyframes.map((k) => (k.offset === keyframe ? { ...k, easing: value } : k));
  return { kind: 'change', patches: writeAnimations(found, replaceAnimation(found.node, animation, { ...held, keyframes })), message: message('status.animation.easingSet', { name: animation, offset: String(keyframe), value: value === '' ? { key: 'timeline.easingDefault' } : value }) };
});

export const deleteKeyframeCommand = registerHandler('animation.deleteKeyframe', (context, { animation, keyframe }): Outcome<never> => {
  const found = targetNode(context);
  const held = found === null ? null : named(found.node, animation);
  if (found === null || held === null) return { kind: 'change' };
  if (!held.keyframes.some((k) => k.offset === keyframe)) return { kind: 'change' };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const keyframes = held.keyframes.filter((k) => k.offset !== keyframe);
  return { kind: 'change', patches: writeAnimations(found, replaceAnimation(found.node, animation, { ...held, keyframes })), message: message('status.animation.keyframeDeleted', { name: animation, offset: String(keyframe) }) };
});

// The offsets an animation takes: interactions.json timeline.offsetRange, the range the dragged keyframe's offset is
// clamped to as well.
function offsetRange(): readonly [number, number] {
  const found = manifest.interactions.constants.find((c) => c.id === 'timeline.offsetRange')?.value;
  return Array.isArray(found) && typeof found[0] === 'number' && typeof found[1] === 'number' ? [found[0], found[1]] : [0, 100];
}

export const setAnimationSettingsCommand = registerHandler('animation.setSettings', (context, { animation, setting, value }): Outcome<never> => {
  const found = targetNode(context);
  const held = found === null ? null : named(found.node, animation);
  if (found === null || held === null) return { kind: 'change' };
  const property = settingProperty(setting);
  if (property === null || !(SETTINGS as readonly string[]).includes(setting)) return { kind: 'refused', message: message('status.animation.invalidSetting', { setting: setting as MessageId, value }) };
  const read = readValue(context, property, value);
  if (read === null) return { kind: 'refused', message: message('status.animation.invalidSetting', { setting: { key: settingLabel(setting) }, value: value.trim() }) };
  if (held.settings[setting] === read.css) return { kind: 'change' };
  const locked = lockedRefusal(context, found.node);
  if (locked !== null) return { kind: 'refused', message: locked };
  const next: Animation = { ...held, settings: { ...held.settings, [setting]: read.css } };
  return { kind: 'change', patches: writeAnimations(found, replaceAnimation(found.node, animation, next)), message: message('status.animation.settingSet', { setting: { key: settingLabel(setting) }, name: animation, value: read.css }) };
});

// The catalogue key a setting's label is read by: the door's own labelKey (manifest/commands/animation.json), so a
// message names a setting as the field does.
export function settingLabel(setting: string): MessageId {
  return (SETTING_DOORS.find((door) => door.setting === setting)?.entry.door.labelKey ?? setting) as MessageId;
}

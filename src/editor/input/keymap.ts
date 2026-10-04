// The keymap (PRODUCT.md §5): the one owner of keys. It runs the shortcut doors
// of the manifest in their key contexts; there is no other key table. A context inherits the bindings of the contexts
// interactions.json names (text editing, menus, the palette, dialogs and fields inherit nothing, so they keep their
// own keys). A bound chord's browser default is prevented, whether or not its door runs yet (archive/DESIGN.md
// "Keyboard model"); a door runs when shortcut-rule.ts says so (archive/DESIGN.md "Build order"). While the hand holds
// an element (core/structure/hand.ts) the canvas's keys are the hand context's, and they act at the hand's aim. A
// command that takes what the system clipboard holds runs once the clipboard is read (src/editor/clipboard.ts). A door
// whose gesture gives a held key a meaning (a number field's Shift+ArrowUp) runs with that key held and hands it on.
import { previewing } from '../view/preview.ts';
import type { CommandId, DoorId, FeatureId, KeyContextId, MessageId } from '../../generated/ids.ts';
import { normaliseChord } from '../../manifest/chord.ts';
import { keyContextChain, manifest, numberConstant, type DoorEntry } from '../../manifest/runtime.ts';
import type { CommandSequence, DispatchResult } from '../../core/store/store.ts';
import { isBuilt, message, isFeatureBuilt } from '../../core/commands/registry.ts';
import { redoCommand, undoCommand } from '../../core/history/history.ts';
import { DRAFT_KEPT, hasDraftRedo, type DraftField } from './drafts.ts';
import { aimArgs, heldHand } from '../../core/structure/hand.ts';
import { wiring } from '../wiring.ts';
import { TEXT_EDITING, editArgs } from '../canvas/text-edit.ts';
import { readClipboard } from '../clipboard.ts';
import type { EditorStore } from '../store.ts';
import { cancelPan, holdSpace, modifierOf, openGesture } from './pointer.ts';
import { holdLetter, releaseLetters, toolKeyContext } from './pointer-tools.ts';
import { pointerViews } from './pointer/views.ts';
import { shortcutRuns } from './shortcut-rule.ts';
import { keyContextIn } from '../canvas/edit-mode.ts';

// The key of an event as the manifest writes it: a letter or a digit by its physical key (so Ctrl+Alt+B is B on any
// layout), the other printable keys by the character they type, named keys by name.
function keyOf(event: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (event.key === ' ') return 'Space';
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

export function chordOf(event: KeyboardEvent): string {
  const mods = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter((m): m is string => typeof m === 'string');
  const key = keyOf(event);
  // a shifted punctuation key types its own character ("+" is Shift+=): the character carries the Shift
  const shiftInKey = event.shiftKey && key.length === 1 && !/[A-Z0-9]/.test(key);
  return [...mods.filter((m) => !(shiftInKey && m === 'Shift')), key].join('+');
}

const shortcuts = manifest.doors.filter((d) => d.door.kind === 'shortcut');

// The keymap as the Keyboard shortcuts panel lists it (spec shortcuts-panel): every binding the manifest declares, by
// the context it acts in, in the order interactions.json declares the contexts — the panel is generated from this
// table and no other list, so a binding added to the manifest appears there without another edit, and a unit test
// hands it a binding of its own. A binding whose command the editor has not built yet is marked, not hidden: the
// panel says what the keymap holds.
export interface BindingRow {
  readonly ref: DoorId;
  readonly chord: string;
  // the command's label in the catalogue: what the key does
  readonly labelKey: MessageId;
  readonly ready: boolean;
}
export interface BindingGroup {
  readonly context: KeyContextId;
  readonly labelKey: MessageId;
  readonly bindings: readonly BindingRow[];
}

export function bindingGroups(doors: readonly DoorEntry[] = shortcuts): readonly BindingGroup[] {
  const contexts = manifest.interactions.keyContexts as readonly { readonly id: string; readonly labelKey: string }[];
  return contexts.flatMap((context) => {
    const bindings = doors
      .filter((entry) => entry.door.kind === 'shortcut' && entry.door.context === context.id)
      .map((entry): BindingRow => {
        const door = entry.door as { readonly chord: string; readonly labelKey: string };
        return { ref: entry.ref, chord: door.chord, labelKey: door.labelKey as MessageId, ready: isBuilt(wiring().commands[entry.command.id]) };
      });
    return bindings.length === 0 ? [] : [{ context: context.id as KeyContextId, labelKey: context.labelKey as MessageId, bindings }];
  });
}

// The binding of a chord in a context: its own shortcut first, then the contexts it inherits from.
export function bindingIn(chain: readonly KeyContextId[], chord: string): DoorEntry | null {
  for (const c of chain) {
    const found = shortcuts.find((d) => d.door.kind === 'shortcut' && d.door.context === c && normaliseChord(d.door.chord) === chord);
    if (found) return found;
  }
  return null;
}

export function bindingFor(context: KeyContextId, chord: string): DoorEntry | null {
  return bindingIn(keyContextChain(context), chord);
}

// The chord shown next to a command's label: its first shortcut in the context the control acts in, else in a context
// that one inherits; the global context by default. The context menu acts on the canvas's selection, so its items
// show the canvas's keys (Alt+ArrowUp for Move up; spec context-menu, Problems in Pager 2).
// (each answer kept: the manifest's shortcuts never change, and every door asks at every render; the audit's AUD-36)
const HINTS = new Map<string, string | null>();
export function chordHint(command: CommandId, context: KeyContextId = 'global'): string | null {
  const key = `${command} ${context}`;
  const known = HINTS.get(key);
  if (known !== undefined) return known;
  let found: string | null = null;
  for (const c of keyContextChain(context)) {
    const door = shortcuts.find((d) => d.command.id === command && d.door.kind === 'shortcut' && d.door.context === c);
    if (door && door.door.kind === 'shortcut') {
      found = door.door.chord;
      break;
    }
  }
  HINTS.set(key, found);
  return found;
}

// a chord as its key cap shows it (key-caps.ts)
export { chordCap } from './key-caps.ts';

// An HTML element of any window: the editor's, or the canvas frame's, whose elements are not instances of the
// editor's HTMLElement.
function htmlElement(target: EventTarget | null): HTMLElement | null {
  const view = typeof target === 'object' && target !== null && 'ownerDocument' in target ? (target as Node).ownerDocument?.defaultView : null;
  return view && target instanceof view.HTMLElement ? target : null;
}

// The key context of the element that has focus: the text edited in place on the canvas names its own context (the
// renderer marks it with data-key-context), and so may a field (the inspector's text field names
// element-text-field, which inherits the field's); any other field keeps its keys; a region names its context with
// data-key-context; the page body, where the focus rests after a press on the canvas (its overlay takes no focus),
// is the canvas's, which inherits the global context; everything else is the global context.
export function contextOf(event: EventTarget | null): KeyContextId {
  const target = htmlElement(event);
  if (target) {
    if (target === target.ownerDocument.body) return 'canvas';
    const field = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    const own = field ? target.getAttribute('data-key-context') : null;
    if (own && (manifest.interactions.keyContexts as readonly { id: string }[]).some((k) => k.id === own)) return own as KeyContextId;
    if (field) return 'field';
    const region = target.closest('[data-key-context]');
    const named = region?.getAttribute('data-key-context');
    if (named && (manifest.interactions.keyContexts as readonly { id: string }[]).some((k) => k.id === named)) return named as KeyContextId;
  }
  return 'global';
}

// The contexts a key of this focus is looked up in, in order: a field inside a region whose context absorbs fields
// (interactions.json absorbsFields; the quick panel) runs the region's context first and keeps the field's own context
// and its ancestors after it, so Escape closes the panel from any of its fields while Enter and the arrows stay the
// field's. Any other focus is the context's own chain.
export function focusChain(target: EventTarget | null, context: KeyContextId): readonly KeyContextId[] {
  const element = htmlElement(target);
  const field = element !== null && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) ? element : null;
  // the region above the field, never the field itself (a number field names its own context on its own input)
  const named = field?.parentElement?.closest('[data-key-context]')?.getAttribute('data-key-context') ?? null;
  const absorbs = named !== null && manifest.interactions.keyContexts.some((k) => k.id === named && k.absorbsFields === true);
  return absorbs && named !== null ? [named as KeyContextId, ...keyContextChain(context)] : keyContextChain(context);
}

// Whether a shortcut door runs now (shortcut-rule.ts, the rule the door census reads too): its command is built and
// its feature introduces the command or has all its commands built.
export function shortcutRunsNow(entry: DoorEntry): boolean {
  return shortcutRuns({ command: entry.command.id, introducedBy: entry.command.introducedBy, feature: entry.door.feature }, (command) => isBuilt(wiring().commands[command as CommandId]), (feature) => isFeatureBuilt(feature as FeatureId));
}

// What a shortcut acts on when the focus is on a control of the same command drawn once per item (a palette tile):
// the arguments that control stands for (its data-args, written by the door's drawing), or null when that control is
// not available (a tile whose entry a later feature brings), so the key does nothing, as a click would. A field that
// names its own key context (the inspector's text field, a number field) stands for its control's arguments for every
// key of that context too, those the key's command takes (a number field's property, for its arrows and its Escape).
// A text field of such a control adds the text it holds as the command's one text argument the control and the door
// do not give (`content` for text.set, `value` for style.set and field.step): Enter keeps what was typed, an arrow
// steps it. Any other focus adds nothing.
// the argument a canvas handle's key takes the handle in (handle.step; canvas/handles.ts)
const HANDLE_ARG = 'handle';
export function focusedArgs(target: EventTarget | null, entry: DoorEntry): Readonly<Record<string, unknown>> | null {
  const control = target instanceof Element ? target.closest('[data-door]') : null;
  const drawn = manifest.doorByRef.get((control?.getAttribute('data-door') ?? '') as DoorId);
  const field = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target : null;
  const ownContext = field?.getAttribute('data-key-context') ?? null;
  const keyOfField = entry.door.kind === 'shortcut' && ownContext !== null && entry.door.context === ownContext;
  const sameCommand = drawn?.command.id === entry.command.id;
  if (!control || !drawn) return {};
  if (!(sameCommand || keyOfField)) {
    // a control of another command that stands for a node (a Layers row, its name) hands that node to a command that
    // takes one (the row's ArrowRight and ArrowLeft act on the focused row, spec layers-keyboard-navigation), and a
    // canvas handle hands itself to the command that takes a handle (its arrows: handle.step)
    const standsFor: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
    const stands = standsFor !== null && typeof standsFor === 'object' ? (standsFor as Record<string, unknown>) : {};
    // a control that is the key context its key waits in (a focused guide: Delete, L, spec guides-manual) hands what it
    // stands for that the key's command takes
    if (entry.door.kind === 'shortcut' && control.getAttribute('data-key-context') === entry.door.context) return Object.fromEntries(Object.entries(stands).filter(([name]) => name in entry.command.args));
    const node = stands.target;
    const handed = typeof node === 'string' && entry.command.args.target?.type === 'node' ? { target: node } : {};
    return typeof stands[HANDLE_ARG] === 'string' && HANDLE_ARG in entry.command.args ? { ...handed, [HANDLE_ARG]: stands[HANDLE_ARG] } : handed;
  }
  if (control.getAttribute('aria-disabled') === 'true') return null;
  const parsed: unknown = JSON.parse(control.getAttribute('data-args') ?? '{}');
  const args = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const takes = entry.command.args;
  const own = sameCommand ? args : Object.fromEntries(Object.entries(args).filter(([name]) => name in takes));
  const text = Object.entries(takes).filter(([name, arg]) => (arg.type === 'string' || arg.type === 'json') && !(name in own) && !(name in entry.door.args));
  const into = text.length === 1 ? text[0]?.[0] : undefined;
  return field !== null && into !== undefined ? { ...own, [into]: field.value } : own;
}

// A shortcut door whose gesture says what a held key means (a number field's arrows: Shift ×10, Alt ×0.1, the gesture
// number-field-keys of interactions.json) runs with that key held too, when no door binds the chord itself: its door,
// and the key, which the command takes as its `modifier`.
export function heldKeyBindingIn(chain: readonly KeyContextId[], event: KeyboardEvent): { readonly entry: DoorEntry; readonly modifier: string } | null {
  const modifier = modifierOf(event);
  if (modifier === null || modifier === 'several') return null;
  const entry = bindingIn(chain, keyOf(event));
  if (!entry || entry.door.kind !== 'shortcut' || entry.door.gesture === null) return null;
  const gesture = manifest.interactions.gestures.find((g) => entry.door.kind === 'shortcut' && g.id === entry.door.gesture);
  return gesture?.modifiers.some((m) => m.key === modifier) === true ? { entry, modifier } : null;
}

export function heldKeyBinding(context: KeyContextId, event: KeyboardEvent): { readonly entry: DoorEntry; readonly modifier: string } | null {
  return heldKeyBindingIn(keyContextChain(context), event);
}

// the key context of the keyboard's hand (interactions.json), which replaces the canvas's while it holds an element,
// and the Layers tree's too: an element is taken into the hand from either (M on the canvas, the context menu of a
// canvas element or of a Layers row, which gives the focus back to its row), and the hand's keys act wherever it was
// taken from
const ROVING_CONTEXT = 'roving-group';
const HAND: KeyContextId = 'hand';
// the key context of the preview (interactions.json): its keys while the editor previews (spec preview-mode)
const PREVIEW: KeyContextId = 'preview';
// the key that measures distances on the canvas while it is held (spec hover-measure)
const ALT = 'Alt';
// The nudge keys (spec absolute-nudge): the arrows of the canvas-positioned context, which the canvas's keys are while
// every selected element is absolute or fixed (their command's predicate holds) and their feature is built; each moves
// the selection nudge.step px, nudge.shiftStep with Shift held (interactions.json)
const NUDGE_GESTURE = 'nudge-keys';
const NUDGE_DOORS = shortcuts.filter((d) => d.door.kind === 'shortcut' && d.door.gesture === NUDGE_GESTURE);
// The stepped keys: a door of such a gesture carries its direction (±1), which the held key's step multiplies:
// nudge.step, nudge.shiftStep with Shift (absolute-nudge's dx and dy); guides.keyStep, guides.keyShiftStep (a focused
// guide's delta, spec guides-manual)
const STEPPED: Readonly<Record<string, { readonly step: number; readonly shiftStep: number; readonly args: readonly string[] }>> = {
  [NUDGE_GESTURE]: { step: numberConstant('nudge.step'), shiftStep: numberConstant('nudge.shiftStep'), args: ['dx', 'dy'] },
  'guide-keys': { step: numberConstant('guides.keyStep'), shiftStep: numberConstant('guides.keyShiftStep'), args: ['delta'] },
};
const SHIFT = 'Shift';
// how soon after a letter another letter is typing rather than a shortcut (interactions.json)
const TYPING_BURST = numberConstant('keys.typingBurst');
// the contexts whose typed keys wait for the person to choose them (jornada03 J2), and the focus contexts they arrive
// in
const CANVAS_CONTEXT = 'canvas' as KeyContextId;
const LAYERS_CONTEXT = 'layers-tree' as KeyContextId;
const CHOSEN_CONTEXTS: ReadonlySet<string> = new Set([CANVAS_CONTEXT, LAYERS_CONTEXT]);
const FIELD_CONTEXT: KeyContextId = 'field';
const GLOBAL_CONTEXT: KeyContextId = 'global';
const TOOLBAR_CONTEXT: KeyContextId = 'toolbar';
const keptField = (target: EventTarget | null): target is DraftField =>
  (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.dataset.draft === DRAFT_KEPT && target.value === target.dataset.shown;
const CANVAS: KeyContextId = 'canvas';
function positionedContext(store: EditorStore, context: KeyContextId): KeyContextId {
  const nudge = NUDGE_DOORS[0];
  if (context !== CANVAS || nudge === undefined || nudge.door.kind !== 'shortcut' || !isFeatureBuilt(nudge.door.feature as FeatureId)) return context;
  const why = store.refusal(nudge.command.id as CommandId, { ...nudge.door.args } as never);
  return why === null || why.key !== nudge.command.availability.refusalKey ? (nudge.door.context as KeyContextId) : context;
}
// a stepped key's travel: its door's direction times the step the held key gives
function stepped(gesture: string, args: Readonly<Record<string, unknown>>, modifier: string | null): Record<string, unknown> {
  const rule = STEPPED[gesture];
  if (rule === undefined) return { ...args };
  const step = modifier === SHIFT ? rule.shiftStep : rule.step;
  return { ...args, ...Object.fromEntries(rule.args.filter((name) => typeof args[name] === 'number').map((name) => [name, (args[name] as number) * step])) };
}
const HAND_FROM: readonly KeyContextId[] = ['canvas', 'layers-tree'];
// the contexts whose Space types: a field and the text edited in place (and the contexts that inherit the field's)
const FIELDS: readonly KeyContextId[] = (manifest.interactions.keyContexts as readonly { id: KeyContextId; inherits: string | null }[]).filter((k) => k.id === 'field' || k.id === TEXT_EDITING || k.inherits === 'field').map((k) => k.id);
// a field that names a context of its own (the command bar's search field: its arrows and Enter are its list's) still
// types Space
const TEXT_INPUTS = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
function typesText(target: EventTarget | null): boolean {
  const element = htmlElement(target);
  if (element === null) return false;
  if (element.isContentEditable || element.tagName === 'TEXTAREA') return true;
  return element.tagName === 'INPUT' && TEXT_INPUTS.includes((element as HTMLInputElement).type);
}

// Whether Space belongs to the focused control rather than to the pan (spec zoom-wheel-pan, Problems in Pager 2): a
// control the keyboard focused (reached with Tab or the arrows, never one a click left focused: `pointerFocused`, the
// element that took the focus during a pointer press) whose key context has a Space door that runs now (a palette
// tile: key-space-in-palette). :focus-visible cannot tell: a key pressed on a clicked control turns it on.
const SPACE_DOORS = manifest.doors.filter((d) => d.door.kind === 'shortcut' && d.door.chord === 'Space');
function spaceIsTheControls(target: EventTarget | null, context: KeyContextId, pointerFocused: EventTarget | null): boolean {
  const element = htmlElement(target);
  return element !== null && element !== pointerFocused && SPACE_DOORS.some((d) => d.door.kind === 'shortcut' && d.door.context === context && shortcutRunsNow(d));
}

// The arguments a key runs its command with: those the focused control stands for, then the door's own over them; an
// object argument both give is one object, the door's keys over the control's (a gradient stop stands for
// { edit: { stop: 2 } }, its ArrowLeft door gives { edit: { nudge: -1 } }: the key nudges that stop).
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function withDoorArgs(own: Readonly<Record<string, unknown>>, door: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...own };
  for (const [name, value] of Object.entries(door)) {
    const held = out[name];
    out[name] = isObject(held) && isObject(value) ? { ...held, ...value } : value;
  }
  return out;
}

// the arrows that move a slider, and which way
const SLIDER_KEYS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

export function installKeymap(store: EditorStore, target: Window = window): () => void {
  const views = pointerViews(store);
  let pointerFocused: EventTarget | null = null;
  // A group whose controls rove (the alignment matrix, a segmented group: A3.24) holds one Tab stop, so the arrows
  // move the focus among its controls, wrapping; Home and End reach the ends. It happens before the bindings.
  const moveInRovingGroup = (target: EventTarget | null, key: string): boolean => {
    const marker = `[data-key-context="${ROVING_CONTEXT}"]`;
    const cell = target instanceof Element ? target.closest(marker) : null;
    const group = cell === null ? null : cell.parentElement;
    if (cell === null || group === null) return false;
    const controls = [...group.querySelectorAll<HTMLElement>(`${marker}:not([disabled]):not([aria-disabled="true"])`)];
    const at = controls.indexOf(cell as HTMLElement);
    if (at < 0 || controls.length === 0) return false;
    // a group laid out in rows (the alignment matrix: data-columns) moves down and up a row with the vertical arrows
    const columns = Number(group.getAttribute('data-columns') ?? '0');
    const down = columns > 1 ? columns : 1;
    const step = key === 'ArrowRight' ? 1 : key === 'ArrowDown' ? down : key === 'ArrowLeft' ? -1 : key === 'ArrowUp' ? -down : 0;
    const next = key === 'Home' ? 0 : key === 'End' ? controls.length - 1 : step === 0 ? null : (at + step + controls.length) % controls.length;
    if (next === null) return false;
    controls[next]?.focus();
    return true;
  };

  // Words typed on the canvas are not shortcuts (the dogfooding pass: a title typed outside the text ran a wrap, a
  // move, a grid… one letter at a time). Letters pressed within keys.typingBurst of each other are a burst; once a
  // letter of the burst binds nothing (a vowel: the person is typing words), the single-letter shortcuts of the rest of
  // the burst do not run. Shortcuts pressed in a row (R then S) still run; a click ends the burst.
  let lastLetterAt = Number.NEGATIVE_INFINITY;
  let typing = false;
  // The canvas's typed keys (its letters, digits and signs, with or without Shift) act only where the person chose the
  // canvas or the Layers (jornada03 J2: a press in the image picker, the picker closing, the focus left on the page
  // body, and "Grãos de café" ran G and R: the image wrapped in a grid and a row, its direction flipped). Chosen by a
  // press on the canvas or a Layers row, by the keyboard reaching a Layers row, by F6 onto the canvas, and by Escape on
  // it; unchosen by a press anywhere else and by a focus lost to nowhere (a panel or a picker closing under it).
  let lettersChosen = true;
  let seenPresses = views.pressCount();
  let seenChoices = views.canvasChosenCount();
  const readChoice = () => {
    if (views.pressCount() !== seenPresses || views.canvasChosenCount() !== seenChoices) {
      seenPresses = views.pressCount();
      seenChoices = views.canvasChosenCount();
      lettersChosen = seenChoices > seenPresses || views.pressRegion() !== 'elsewhere';
    }
  };
  // The store holds the reversible sequence; the keymap never keeps document or selection snapshots.
  let burstSequence: CommandSequence | null = null;
  let burstTimer: number | undefined;
  let burstKeys = '';
  let told = false;
  const endBurst = () => {
    target.clearTimeout(burstTimer);
    burstSequence?.commit();
    burstSequence = null;
    lastLetterAt = Number.NEGATIVE_INFINITY;
    typing = false;
    burstKeys = '';
    told = false;
  };
  const takeBackBurst = () => {
    if (burstSequence?.cancel() === true) store.notice(message('status.keys.typedNotShortcuts', { keys: burstKeys }));
    burstSequence = null;
    burstKeys = '';
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const letter = event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
    // a letter held outside a field: a pointer tool may read it through a drag (pointer-tools.ts)
    if (letter && !typesText(event.target)) holdLetter(event.key, true);
    if ((!letter && event.key !== SHIFT) || (letter && event.timeStamp - lastLetterAt >= TYPING_BURST)) {
      endBurst();
    }
    const inBurst = letter && typing;
    if (letter) {
      lastLetterAt = event.timeStamp;
      target.clearTimeout(burstTimer);
      burstTimer = target.setTimeout(endBurst, TYPING_BURST);
    }
    // A modal owns Escape even when a press on its shield has left focus on the page body. Resolve its manifest door
    // before the canvas/global context can clear the selection, and do not let another key listener see that Escape.
    if (event.key === 'Escape' && store.getState().ui.dialog !== undefined && store.getState().confirmation === null) {
      const modal = bindingFor('dialog', chordOf(event));
      if (modal !== null) {
        event.preventDefault();
        event.stopPropagation();
        if (shortcutRunsNow(modal)) store.dispatch(modal.command.id, withDoorArgs({}, modal.door.args));
        return;
      }
    }
    // Alt held: the canvas measures distances while it is (spec hover-measure); it binds nothing alone
    if (event.key === ALT) views.holdAlt(true);
    // during a pointer gesture the keys are the gesture's (pointer.ts)
    const gesture = openGesture(store);
    const focused = contextOf(event.target);
    // the arrows of a roving group move the focus in it (A3.24); every other key is the bindings'
    if (moveInRovingGroup(event.target, event.key)) {
      event.preventDefault();
      return;
    }
    // Native buttons consume Space even when contenteditable. Insert it in the edited element's own document;
    // iframe elements do not inherit the editor window's Node constructor (htmlElement handles both realms).
    const editedElement = focused === TEXT_EDITING ? htmlElement(event.target) : null;
    if (event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && editedElement !== null) {
      event.preventDefault();
      editedElement.ownerDocument.execCommand('insertText', false, ' ');
      return;
    }
    // Space held over the canvas arms the pan, whatever has the focus but a field, the text edited in place or a
    // control the keyboard focused that takes Space (spec zoom-wheel-pan, Problems in Pager 2); Escape during a pan
    // puts the view back (the pointer owner's)
    if (event.code === 'Space' && !FIELDS.includes(focused) && !typesText(event.target) && !spaceIsTheControls(event.target, focused, pointerFocused) && holdSpace(store, true)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && cancelPan(store)) {
      event.preventDefault();
      return;
    }
    // a slider (the colour picker's): Shift with an arrow moves it ten steps (spec color-picker, Problems in Pager 4);
    // its arrows alone are the browser's, one step
    const slider = event.target instanceof HTMLInputElement && event.target.type === 'range' ? event.target : null;
    const along = SLIDER_KEYS[event.key];
    if (slider !== null && along !== undefined && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (along > 0) slider.stepUp(10);
      else slider.stepDown(10);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // while the hand holds an element, the canvas's and the Layers tree's keys are the hand's (spec hand-keyboard-move,
    // "Trigger")
    const hand = gesture === null && HAND_FROM.includes(focused) ? heldHand(store.getState()) : null;
    // while an Edit on canvas mode is on, the canvas's keys are its mode's (canvas/edit-mode.ts)
    // while every selected element is absolute or fixed, the canvas's arrows nudge them (canvas-positioned)
    // while previewing, the keys are the preview's, wherever the focus is in the editor (spec preview-mode)
    // A tool's stage takes focus after it is measured; Escape still leaves that tool while its toolbar button holds
    // focus between the command and the stage's first focus. Other toolbar keys keep their own context.
    const toolEscape = event.key === 'Escape' && focused === TOOLBAR_CONTEXT ? toolKeyContext(store.getState().ui) : null;
    const context = gesture?.context ?? (previewing(store.getState().ui) ? PREVIEW : hand !== null ? HAND : toolEscape ?? positionedContext(store, keyContextIn(store.getState().ui, focused)));
    // a session's context (a gesture, the hand, the preview) replaces the focused one; otherwise a field inside a
    // region that absorbs fields (the quick panel) runs the region's keys before its own (focusChain)
    const chain = gesture !== null || hand !== null || previewing(store.getState().ui) ? keyContextChain(context) : focusChain(event.target, context);
    // Confirmed fields, including inherited number/text contexts, use document history. Native undo remains with
    // pending typing; an unrelated field without the draft contract (such as search) never forwards these keys.
    if (gesture === null && keyContextChain(focused).includes(FIELD_CONTEXT) && keptField(event.target)) {
      const history = bindingIn(keyContextChain(GLOBAL_CONTEXT), chordOf(event));
      if (history !== null && (history.command.id === undoCommand.command || history.command.id === redoCommand.command) && shortcutRunsNow(history)) {
        if (history.command.id === redoCommand.command && hasDraftRedo(event.target)) return;
        event.preventDefault();
        (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(history.command.id, withDoorArgs({}, history.door.args));
        return;
      }
    }
    const held = bindingIn(chain, chordOf(event)) === null ? heldKeyBindingIn(chain, event) : null;
    const binding = held?.entry ?? bindingIn(chain, chordOf(event));
    // a letter that binds nothing outside a field marks the burst as typing, and takes back the shortcuts the burst ran
    if (!binding && letter && !FIELDS.includes(focused) && context !== TEXT_EDITING) {
      typing = true;
      takeBackBurst();
    }
    // Escape on the canvas chooses it (the person is back on the canvas, whatever closed under the focus)
    if (event.key === 'Escape' && focused === CANVAS_CONTEXT && gesture === null) {
      readChoice();
      lettersChosen = true;
    }
    if (!binding) return;
    // a typed key of the canvas or the Layers acts only where the person chose them; elsewhere it does nothing and says
    // why, once per burst
    const typedKey = letter && binding.door.kind === 'shortcut' && CHOSEN_CONTEXTS.has(binding.door.context) && (focused === CANVAS_CONTEXT || focused === LAYERS_CONTEXT) && gesture === null;
    if (typedKey) {
      readChoice();
      if (!lettersChosen) {
        typing = true;
        if (!told) store.notice(message('status.keys.notChosen'));
        told = true;
        return;
      }
    }
    // a bound chord is the editor's whether or not its door runs yet (archive/DESIGN.md "Keyboard model")
    event.preventDefault();
    // a letter inside a burst of letters is typing: its single-letter shortcut does not run (outside a field and the
    // text edited in place, where letters are text already)
    if (inBurst && binding.door.kind === 'shortcut' && !FIELDS.includes(focused) && context !== TEXT_EDITING) return;
    if (!shortcutRunsNow(binding)) return;
    // a key of the text edited in place acts on the edit: its node and the text it holds (text-edit.ts); a key of the
    // hand acts at its aim (hand.ts)
    const own = gesture
      ? {}
      : hand !== null
        ? aimArgs(hand, Object.keys(binding.command.args))
        : context === TEXT_EDITING
          ? editArgs(store.getState(), binding.command)
          : focusedArgs(event.target, binding);
    if (own === null) return;
    // the key held with a door whose gesture gives it a meaning, for a command that takes it
    const modifier = held !== null && 'modifier' in binding.command.args ? { modifier: held.modifier } : {};
    if (typedKey) {
      if (burstSequence?.active() !== true) {
        burstSequence = store.sequence();
        burstKeys = '';
      }
      burstKeys += event.key.toUpperCase();
    }
    const dispatch = (gesture?.gesture.dispatch ?? (typedKey ? burstSequence?.dispatch : undefined) ?? store.dispatch) as (id: CommandId, args: unknown) => DispatchResult;
    const given = withDoorArgs({ ...own, ...modifier }, binding.door.args);
    const args = binding.door.kind === 'shortcut' && binding.door.gesture !== null ? stepped(binding.door.gesture, given, held?.modifier ?? null) : given;
    // a command that takes what the system clipboard holds (an argument of type clipboard: text.paste) runs once the
    // clipboard is read (src/editor/clipboard.ts); a key held during a gesture never waits for it
    const clipboard = Object.entries(binding.command.args).find(([name, arg]) => arg.type === 'clipboard' && !(name in args))?.[0];
    if (clipboard === undefined) dispatch(binding.command.id, args);
    else if (gesture === null) void readClipboard().then((content) => dispatch(binding.command.id, { ...args, [clipboard]: content }));
  };
  const onKeyUp = (event: KeyboardEvent) => {
    holdLetter(event.key, false);
    if (event.code === 'Space') holdSpace(store, false);
    // Alt let go: the canvas stops measuring distances (spec hover-measure)
    if (event.key === ALT) views.holdAlt(false);
  };
  const onBlur = () => {
    endBurst();
    releaseLetters();
    holdSpace(store, false);
    views.holdAlt(false);
  };
  // the element that took the focus during a pointer press (a clicked tile: the pointer owner says a button is down),
  // for Space (spaceIsTheControls); a focus that arrives otherwise (Tab, the arrows, a script after a key) clears it
  const onFocusIn = (event: FocusEvent) => {
    pointerFocused = views.pointerPressing() ? event.target : null;
    if (!CHOSEN_CONTEXTS.has(contextOf(event.target))) endBurst();
    // the keyboard reached a Layers row: its keys are chosen
    if (!views.pointerPressing() && contextOf(event.target) === LAYERS_CONTEXT) {
      readChoice();
      lettersChosen = true;
    }
  };
  // a focus lost to nowhere (a picker or a panel closed under it, no press, no key moving it) unchooses the canvas's
  // typed keys: the focus rests on the page body without the person choosing the canvas
  const onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget !== null || views.pointerPressing()) return;
    const from = contextOf(event.target);
    if (from === CANVAS_CONTEXT || from === LAYERS_CONTEXT) return;
    readChoice();
    lettersChosen = false;
  };
  // a click between two letters ends the burst: the person is not typing
  const onClick = endBurst;
  target.addEventListener('focusin', onFocusIn, true);
  target.addEventListener('focusout', onFocusOut, true);
  target.addEventListener('click', onClick, true);
  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  return () => {
    endBurst();
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('click', onClick, true);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('focusin', onFocusIn, true);
    target.removeEventListener('focusout', onFocusOut, true);
  };
}

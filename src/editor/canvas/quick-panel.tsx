// The quick panel on the canvas (spec quick-panel; the rules are
// src/editor/quick-panel/quick-panel.ts): near the primary selected element, over the stage, a chip that opens the
// panel. The panel holds the doors the manifest places in the quick-panel region, in their order: each field is the
// inspector's own field component (field.tsx) on that door, so it runs the same command with the same arguments as
// the matching inspector field and shows the same value; a field shows only when its property applies to the element.
// A door whose feature is not registered as built is drawn disabled, "not available yet" (the feature table). Its grip
// is the drag door of quickPanel.setOffset (the pointer owner runs the drag); More actions opens the element's context
// menu at the button.
//
// Opening the panel with its chip is not a command (PRODUCT.md §5.3: data-local): the chip's state is this component's.
// Hidden while a drag runs and while a text is edited in place (the text toolbar replaces it).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { installChipFit } from './chip-fit.ts';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { locate, type DocNode } from '../../core/document/model.ts';
import { functionArgument, functionOfControl, functionsOf, translateAxis, translateWith, withBareUnit } from '../../core/style/functions.ts';
import type { AttributeId, CommandId, FeatureId, KeyContextId } from '../../generated/ids.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { DoorControl, Icon, appliesNow, isDoorBuilt, useDoor } from '../doors/door.tsx';
import { GLYPHS, doorSlots } from '../doors/placement.ts';
import { attributeApplies } from '../../core/elements/inputs.ts';
import { shownForContext, type ElementContext } from '../../core/style/applies.ts';
import { ATTRIBUTES } from '../inspector/attributes.ts';
import { styleClassOf } from '../inspector/style-target.ts';
import { BASE_STATE, activeState } from '../view/style-state.ts';
import { activeBreakpoint } from '../view/breakpoints.ts';
import { appliesTo, offsetOf, placeQuickPanel, quickPanelOffsets, quickPanelOpen, type Box, type Offset } from '../quick-panel/quick-panel.ts';
import { TextStyleField, keptByFieldEnter, type FieldPart, KeptTextField, TextField, keptTextOf, useSelectionContext } from '../shell/field.tsx';
import { EDIT_MODES, modeBuilt, modeRefusal, type EditMode } from './edit-mode.ts';
import { MODEL_RULES, useEditorState, useStore } from '../store.ts';
import type { MessageId } from '../../generated/ids.ts';
import { useT } from '../text.ts';
import { canvasFrame, nodeBox } from './coordinates.ts';
import { breakpointWords, wordsOf } from '../../core/document/breakpoints.ts';
import { usePointerValue } from '../input/pointer/use-views.ts';

const REGION = 'quick-panel';
// the panel's chip: the control of the panel that opens and closes it (a panel-control door of its own region; its
// press runs quickPanel.setOpen with the value the manifest declares). Every other door of the region is a field.
const CHIP_DOOR = doorSlots(REGION).find((entry) => entry.door.kind === 'panel-control' && entry.door.control === 'chip') ?? null;
const FIELDS = doorSlots(REGION).filter((entry) => entry !== CHIP_DOOR);
// the key context the panel names (interactions.json): Escape in it closes the panel, wherever its focus is — the
// context absorbs the fields inside it (keymap.ts focusChain)
const PANEL_KEYS = manifest.interactions.keyContexts.find((k) => k.absorbsFields)?.id as KeyContextId | undefined;
// the grip: the panel drag door of the quick panel's command pressed on it
const GRIP = manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'quick-panel-grip') ?? null;
// the attribute that is an element's HTML tag (elements.json), which the Tag field keeps
const TAG_VALUE = 'tag';
const TAG = (manifest.elements.attributes.find((a) => a.valueType === TAG_VALUE)?.id ?? null) as AttributeId | null;
// the properties drawn as a colour field (a swatch that opens the colour picker)
const COLOUR = new Set(manifest.properties.properties.filter((p) => p.control === 'color-field').map((p) => p.id));
// the inspector's fields of one function of a filter or a transform (filter-blur, transform-skew-x), by their control
const FUNCTION_DOORS = manifest.doors.filter((d) => d.door.kind === 'inspector-field' && d.door.property !== null && d.door.control.startsWith(`${d.door.property}-`) && Object.entries(d.command.args).some(([name, arg]) => name !== 'property' && arg.type === 'json'));
const FUNCTION_CONTROLS = new Set(FUNCTION_DOORS.map((d) => (d.door.kind === 'inspector-field' ? d.door.control : '')));
// the properties whose value is a list of functions those fields edit (filter, transform)
const FUNCTION_PROPERTIES = new Set(FUNCTION_DOORS.map((d) => (d.door.kind === 'inspector-field' ? d.door.property : null)));
const CHIP = { width: 24, height: 24 };
// the canvas's pan, the wheel's command: what moves an out-of-sight label into view when the panel opens (DEC-70)
// for how many frames after its opening the panel's settling height still moves the canvas to fit it (chip-fit's few
// frames, counted by the placing loop, which runs once a frame)
const FIT_FRAMES = 36;
// the share of the window's height the open panel takes at most (canvas-editing.css's max-height, 75vh)
const TALLEST_SHARE = 0.75;
const PAN = manifest.doors.find((d) => d.door.kind === 'canvas-wheel' && 'dx' in d.command.args);

// The panel's groups, in the order it draws them, each under its name: layout.json's quickPanelGroups, which each
// quick-panel door names (its `group`; the audit's U-044: they were ranges of placement orders here). The manifest
// supplies each field and its order within its group.
const QUICK_GROUPS = manifest.layout.quickPanelGroups;
// the groups laid out in one column (their fields are the element's attributes, with their labels beside them); Paint
// is two to a line as in the canonical panel (design/final), a long value whole in its tooltip and while it is edited
const ONE_COLUMN: ReadonlySet<string> = new Set(['settings']);
const inQuickGroup = (entry: DoorEntry, group: (typeof QUICK_GROUPS)[number]): boolean => entry.door.kind === 'quick-panel' && entry.door.group === group.id;

// What an Effects field typed means for style.setFilter's functions: none for nothing, every function typed set and
// every one held but not typed taken away; a text that is no list of functions goes as it is, which the command
// refuses — but a bare number is the field's guided form, a blur radius in px (`2` is blur(2px); the user's real-use
// audit, item 6.4), through the same bare-unit rule the per-function fields use.
const BARE_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
function functionsTyped(text: string, held: string | undefined): unknown {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'none') return 'none';
  if (BARE_NUMBER.test(trimmed)) return { blur: withBareUnit('blur', trimmed) };
  const typed = functionsOf(trimmed);
  if (typed === null || typed.length === 0) return trimmed;
  const gone = (functionsOf(held) ?? []).filter((f) => !typed.some((t) => t.name === f.name)).map((f) => [f.name, ''] as const);
  return Object.fromEntries([...gone, ...typed.map((f) => [f.name, f.argument] as const)]);
}

// The part of a value a quick panel field edits, by its control: a translate axis (Move X), one function of a filter
// or a transform (Skew X: the function of the inspector field of the same control), or a filter's whole list
// (Effects); null for a field of the whole value.
function partOf(entry: DoorEntry, property: string): FieldPart | null {
  const control = entry.door.kind === 'quick-panel' ? entry.door.control : '';
  const axis = [`${property}-x`, `${property}-y`].indexOf(control);
  if (axis >= 0 && 'value' in entry.command.args) return { show: (held) => translateAxis(held, axis), args: (text, held) => ({ property, value: translateWith(held, axis, text) }) };
  const list = Object.entries(entry.command.args).find(([name, arg]) => name !== 'property' && arg.type === 'json')?.[0];
  if (list === undefined || !FUNCTION_PROPERTIES.has(property)) return null;
  const inspectorControl = `${property}-${control}`;
  if (FUNCTION_CONTROLS.has(inspectorControl)) {
    const name = functionOfControl(inspectorControl);
    return { show: (held) => functionArgument(held, name), args: (text) => ({ property, [list]: { [name]: text } }) };
  }
  return { show: (held) => held ?? '', args: (text, held) => ({ property, [list]: functionsTyped(text, held) }) };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
// the Tag field; a door drawn as a button of the panel's bar: a command on the element itself (More actions) or one
// that writes no property (align, distribute, the Edit on canvas modes)
const isTag = (entry: DoorEntry) => TAG !== null && TAG in entry.command.args;
// an attribute field (an image's source, a link's address) is a field, whatever its command writes: its adapter
// writes no property, which alone would make it an action
const isAction = (entry: DoorEntry) =>
  !(entry.door.kind === 'quick-panel' && entry.door.attribute !== null) && !isTag(entry) && (entry.command.args.target?.type === 'node' || entry.door.adapter.writes.length === 0);
// a door whose command's one choice it leaves open (Edit on canvas): it opens the list of its values, which say
// themselves whether each applies (ChoiceItem)
const opensChoice = (entry: DoorEntry): boolean => {
  const args = Object.entries(entry.command.args);
  return args.length === 1 && args.every(([name, arg]) => arg.type === 'enum' && !(name in entry.door.args));
};

// A door whose command takes one choice the door leaves open (Edit on canvas: canvas.setEditMode's mode): a button that
// opens the list of its values, each an item of the door standing for its value, pressed when it is the one in force.
// A value whose handles are not built is not available yet (canvas/edit-mode.ts modeBuilt).
function ChoiceItem({ entry, name, value, node, context, onDone }: { readonly entry: DoorEntry; readonly name: string; readonly value: EditMode; readonly node: DocNode; readonly context: ElementContext | null; readonly onDone: () => void }) {
  const t = useT();
  const args = { [name]: value };
  const door = useDoor(entry, args, t(`canvas.editMode.${value}` as MessageId), isFeatureBuilt(entry.door.feature as FeatureId) && modeBuilt(value));
  // a mode with nothing to edit on the element (a shadow mode on an element with no shadow, the gap on a container
  // that is not flex or grid): disabled, with the reason the mode itself gives (A3.15)
  const refusal = modeRefusal(value, node, MODEL_RULES, context);
  const available = door.available && refusal === null;
  // the reason the control reads out: the mode's own, and the door's own when the door is the one that cannot run
  const reason = refusal ?? 'canvas.editMode.nothingToEdit';
  return (
    <button
      type="button"
      role="option"
      aria-selected={door.current}
      className={`quick-panel__option${available ? '' : ' is-unavailable'}${door.current ? ' is-current' : ''}`}
      data-door={entry.ref}
      data-args={JSON.stringify(args)}
      title={door.available && refusal !== null ? t('common.disabledTitle', { label: door.label, reason: { key: reason } }) : door.title}
      aria-disabled={available ? undefined : true}
      onClick={() => {
        if (!available) return;
        door.run();
        onDone();
      }}
    >
      {door.label}
    </button>
  );
}
function ChoiceMenu({ entry, name, node, context }: { readonly entry: DoorEntry; readonly name: string; readonly node: DocNode; readonly context: ElementContext | null }) {
  const [open, setOpen] = useState(false);
  const door = useDoor(entry, {}, undefined, isFeatureBuilt(entry.door.feature as FeatureId));
  return (
    <span className="quick-panel__menu">
      <button
        type="button"
        className={`door door--button${door.available ? '' : ' is-unavailable'}`}
        data-door={entry.ref}
        data-args="{}"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={door.title}
        aria-disabled={door.available ? undefined : true}
        onClick={() => (door.available ? setOpen((was) => !was) : undefined)}
      >
        <span className="door__label">{door.label}</span>
        <Icon name={GLYPHS.dropdown} size="xs" />
      </button>
      {open ? (
        <span className="quick-panel__options" role="listbox" aria-label={door.label}>
          {EDIT_MODES.map((value) => (
            <ChoiceItem key={value} entry={entry} name={name} value={value} node={node} context={context} onDone={() => setOpen(false)} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

// Every quick field says what it is inside itself (the canonical .qp-f's key; the audit's U-008: the Effects, Text,
// Transform and Layout fields had no visible name): its door's short face label, else its label; a field that shows its
// door's icon shows that instead, and a colour field in a two-column group its swatch.
function keyOf(t: (key: MessageId) => string, entry: DoorEntry, swatchIsKey: boolean): string | null {
  if (entry.door.icon !== null || swatchIsKey) return null;
  return t((entry.door.faceLabelKey ?? entry.door.labelKey) as MessageId);
}

function QuickField({ entry, node, context, twoColumn }: { readonly entry: DoorEntry; readonly node: DocNode; readonly context: ElementContext | null; readonly twoColumn: boolean }) {
  const store = useStore();
  const t = useT();
  const ready = isFeatureBuilt(entry.door.feature as FeatureId);
  const door = useDoor(entry, {}, undefined, ready);
  const args = entry.command.args;
  const writes = entry.door.adapter.writes;
  // an attribute field (an image's source and alternative text, a link's address, a button's type): the kept field the
  // Settings tab draws, kept by the command that writes the attribute
  if (entry.door.kind === 'quick-panel' && entry.door.attribute !== null) {
    // the element's text (a button's label): the inspector's text field
    if ('content' in entry.command.args && entry.command.args.content.type === 'json') return <TextField key={`${entry.ref}@${node.id}`} entry={entry} node={node} label={door.label} keepOnLeave={false} />;
    const attribute = entry.door.attribute as AttributeId;
    const facts = ATTRIBUTES.get(attribute);
    if (facts === undefined) return null;
    // a boolean attribute (a link's new tab): a switch, kept by its command with the value turned over
    if (facts.valueType === 'boolean') {
      const arg = Object.entries(args).find(([, written]) => written.type === 'boolean')?.[0];
      if (arg === undefined) return null;
      const on = node.attributes[attribute] === true || node.attributes[attribute] === 'true';
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={`quick-panel__option${on ? ' is-current' : ''}`}
          data-door={entry.ref}
          data-args={JSON.stringify({ ...entry.door.args, [arg]: !on })}
          title={door.title}
          aria-disabled={door.available ? undefined : true}
          onClick={() => {
            if (door.available) (store.dispatch as (id: CommandId, args: unknown) => unknown)(entry.command.id, { ...entry.door.args, target: node.id, [arg]: !on });
          }}
        >
          {door.label}
        </button>
      );
    }
    const kept = keptTextOf(entry, attribute, facts.valueType, node);
    return kept === null ? null : <KeptTextField key={`${node.id}-${attribute}`} entry={entry} node={node} kept={kept} label={door.label} keepOnLeave={false} />;
  }
  // the element's HTML tag, kept with element.setTag, suggesting its equivalent tags (the inspector's Tag field)
  if (TAG !== null && isTag(entry)) {
    const kept = keptTextOf(entry, TAG, TAG_VALUE, node);
    return kept === null ? null : <KeptTextField key={node.id} entry={entry} node={node} kept={kept} label={door.label} keepOnLeave={false} />;
  }
  // a command whose one choice the door leaves open: its menu
  const choices = Object.entries(args).filter(([name, arg]) => arg.type === 'enum' && !(name in entry.door.args));
  const [choice] = choices;
  if (choices.length === 1 && choice !== undefined && Object.keys(args).length === 1) return <ChoiceMenu entry={entry} name={choice[0]} node={node} context={context} />;
  // a command on the element itself (More actions: its context menu), or one that writes no property: its button
  if (isAction(entry)) return <DoorControl entry={entry} args={args.target?.type === 'node' ? { target: node.id } : {}} ready={ready} className="quick-panel__action" />;
  // a composite of every longhand the door writes (Border): its own command, every side
  const composite = manifest.properties.composites.find((c) => sameList(c.longhands, writes));
  if (composite !== undefined) {
    const side = args.sides?.values[0];
    return <TextStyleField entry={entry} door={door} property={composite.id} longhands={composite.longhands} label={door.label} ownCommand extra={side === undefined ? {} : { sides: side }} keepOnLeave={false} prefix={keyOf(t, entry, false)} />;
  }
  if (!('property' in args)) return null;
  const property = writes[0] ?? '';
  const part = partOf(entry, property);
  if (part !== null) return <TextStyleField entry={entry} door={door} property={property} longhands={null} label={door.label} part={part} keepOnLeave={false} prefix={keyOf(t, entry, false)} />;
  // a command of its own that takes the value (Gradient: style.setBackgroundImage) keeps it with its own form
  return <TextStyleField entry={entry} door={door} property={property} longhands={null} label={door.label} colour={COLOUR.has(property)} ownCommand={!keptByFieldEnter(entry)} keepOnLeave={false} prefix={keyOf(
    t,
    entry,
    twoColumn && COLOUR.has(property)
  )} />;
}

// The chip: the panel's own control (manifest, the region's chip door). Collapsed it stands beside the selection's
// label; open it is the panel's close button. Its press runs quickPanel.setOpen, the command the shortcut and Escape
// inside the panel run too (keymap.ts). One control with two drawings: only the collapsed chip carries the door's
// marker (the open panel's own close button is drawn by the panel it closes), so the door is drawn once at a time.
function Chip({ entry, open, at, measuring, buttonRef }: { readonly entry: DoorEntry; readonly open: boolean; readonly at?: CSSProperties | undefined; readonly measuring: string; readonly buttonRef: RefObject<HTMLButtonElement | null> }) {
  const door = useDoor(entry, {}, undefined, isFeatureBuilt(entry.door.feature as FeatureId));
  const icon = entry.door.icon === null ? null : <Icon name={entry.door.icon} size="sm" />;
  const press = () => {
    if (door.available) door.run();
  };
  const shared = {
    ref: buttonRef,
    type: 'button' as const,
    'data-quick-panel-chip': true,
    'aria-label': door.label,
    title: door.title,
    'aria-disabled': door.available ? undefined : true,
    onClick: press,
  };
  if (open) {
    return (
      <button {...shared} className="quick-panel__close" aria-expanded={true}>
        {icon}
      </button>
    );
  }
  return (
    <button {...shared} className={`quick-panel-chip${measuring}`} style={at} data-region={REGION} data-door={entry.ref} data-args={JSON.stringify(entry.door.args)} aria-expanded={false}>
      {icon}
    </button>
  );
}

// The grip: pressed and moved, it drags the panel (the pointer owner runs quickPanel.setOffset from the offset the
// panel is drawn at now); it stands for the element.
function Grip({ entry, node, offset }: { readonly entry: DoorEntry; readonly node: DocNode; readonly offset: Offset | null }) {
  const args = { target: node.id };
  const door = useDoor(entry, args, undefined, isFeatureBuilt(entry.door.feature as FeatureId));
  return (
    <span
      className={`quick-panel__grip${door.available ? '' : ' is-unavailable'}`}
      data-door={entry.ref}
      data-args={JSON.stringify(args)}
      data-offset={offset === null ? undefined : JSON.stringify(offset)}
      aria-disabled={door.available ? undefined : true}
      role="button"
      tabIndex={-1}
      aria-label={door.label}
      title={door.title}
    >
      <Icon name={GLYPHS.grip} size="sm" />
    </span>
  );
}

interface Placed {
  // the element it was placed for, and whether open: a placing for another element, or the chip's for the panel, is
  // none
  readonly id: string;
  readonly open: boolean;
  readonly box: Box;
  readonly element: Box;
  // the widest the panel may be: the stage less its inset on both sides
  readonly widest: number;
  // the tallest it may be: down to the window's bottom less the inset, from where it stands beside the label (DEC-70),
  // what it holds scrolled inside it (it reached past the window: the audit of 2026-10-05)
  readonly tallest: number;
}

const token = (element: Element, name: string) => parseFloat(getComputedStyle(element).getPropertyValue(name)) || 0;

export function QuickPanel({ stage }: { readonly stage: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const store = useStore();
  // the bar's actions drawn: those built that apply to the selection now (align and distribute take several positioned
  // elements); an action that cannot act is not drawn at all (the user's real-use audit, item 1.4)
  const applicable = useEditorState((s) => {
    const first = s.selection[0];
    // nothing selected: no quick panel, no action
    if (first === undefined) return '';
    return FIELDS.filter(isAction)
      .filter((entry) => isDoorBuilt(entry) && (opensChoice(entry) || appliesNow(entry, entry.command.args.target?.type === 'node' ? { target: first } : {}, store)))
      .map((entry) => entry.ref)
      .join(' ');
  });
  // the layout context (spec props-element-specific): a field of a flex container or an item shows only where the
  // page lays it out so (6.1), the rule the Style tab draws its fields by
  const context = useSelectionContext();
  const contextTarget = useEditorState((s) => styleClassOf(s));
  const contextState = useEditorState((s) => {
    const state = activeState(s.ui);
    return state.id === BASE_STATE.id ? null : state.labelKey;
  });
  const contextBreakpoint = useEditorState((s) => {
    const breakpoint = activeBreakpoint(s);
    return breakpoint.base === true ? null : JSON.stringify(breakpointWords(breakpoint));
  });
  const node = useEditorState((s) => {
    const at = s.selection[0] === undefined ? null : locate(s.document, s.selection[0]);
    // the page root has no quick panel
    return at === null || at.parent === null ? null : at.node;
  });
  const editing = useEditorState((s) => s.ui.textEdit.node !== null);
  const offsets = useEditorState((s) => quickPanelOffsets(s.ui));
  const open = useEditorState((s) => quickPanelOpen(s.ui));
  const dragging = usePointerValue('drag');
  const [placed, setPlaced] = useState<Placed | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  // the element and the zoom for which the canvas was moved to show the label: once per opening, and once more for each
  // zoom the person sets while it is open (DEC-75: at 200 % the label of the element it stands for left the view, and
  // the panel with it); a scroll is the person's own move away, never undone
  const revealed = useRef<string | null>(null);
  // whether the panel was open at the last placing; the frames left in which the opening fits it whole below its
  // label, and the label's top when the canvas was last moved for it
  const wasPlacedOpen = useRef(false);
  const fitFrames = useRef(0);
  const fitFrom = useRef<number | null>(null);
  const shown = node !== null && !editing && dragging === null;
  const id = node?.id ?? null;
  const offset: Offset | null = id === null ? null : (offsets[id] ?? null);

  // a field whose value does not fit its half takes the group's whole row (chip-fit.ts)
  useEffect(() => (shown && open && panel.current !== null ? installChipFit(panel.current) : undefined), [shown, open, id]);

  // placed at every frame (the element moves with the page's layout, a scroll, a zoom), set only when it moves
  useEffect(() => {
    if (!shown || id === null) return;
    let request = 0;
    const measure = () => {
      const area = stage.current;
      const frame = canvasFrame();
      const drawn = open ? panel.current : chip.current;
      const box = frame ? nodeBox(frame, id) : null;
      if (area && box && drawn) {
        // in the window's pixels: the chip and the panel are fixed (canvas-editing.css), so the stage's clip never cuts
        // them and the panel beside a label near the stage's edge lies over the inspector or the dock, whole, its close
        // within reach (DEC-70)
        const stageBox = area.getBoundingClientRect();
        const element = { x: box.x, y: box.y, width: box.width, height: box.height };
        const size = open ? { width: drawn.offsetWidth, height: drawn.offsetHeight } : CHIP;
        const label = area.querySelector('[data-chrome="label"]:not(.is-measuring)');
        const inset = token(area, '--space-8');
        // a panel the person dragged is held inside the stage, as before it was fixed in the window
        const whole = { x: stageBox.x, y: stageBox.y, width: stageBox.width, height: stageBox.height };
        // the chip and the open panel stand on the right of the selection's label, touching it (DEC-70): both wait for
        // the label to be placed, so neither is drawn anywhere else first; while the label is out of the stage's
        // view (the page scrolled it away, cut by the stage's edge) neither is drawn, since it follows the label
        const at = label?.getBoundingClientRect();
        const seen = at !== undefined && at.left >= stageBox.left - 0.5 && at.top >= stageBox.top - 0.5 && at.right <= stageBox.right + 0.5 && at.bottom <= stageBox.bottom + 0.5;
        // just opened (not a new selection with the panel open, so a press on the canvas never sees the page move
        // under it), and not dragged by the person: for the opening's first moments the panel must fit below its
        // label — its height settles over a few frames (a field too wide for its half takes the row, chip-fit.ts)
        if (open && !wasPlacedOpen.current) fitFrames.current = offset === null ? FIT_FRAMES : 0;
        else if (fitFrames.current > 0) fitFrames.current -= 1;
        wasPlacedOpen.current = open;
        // opened while the label is out of sight (its shortcut; a wide element's start left of the canvas at 100 %),
        // or so near the window's bottom that the panel beside it would be cut short (one field in sight, the pairing
        // of 2026-10-05): the canvas moves, the label into view and the whole panel below it (DEC-70)
        const shownFor = `${id} ${frame?.currentCSSZoom ?? 1}`;
        const reveal = !seen && revealed.current !== shownFor;
        // after a move, nothing more is asked until the label has moved (a canvas at the page's end never does)
        if (at !== undefined && fitFrom.current !== null && Math.abs(at.top - fitFrom.current) >= 0.5) fitFrom.current = null;
        const fitting = seen && fitFrames.current > 0 && fitFrom.current === null;
        if (open && at !== undefined && (reveal || fitting)) {
          if (reveal) revealed.current = shownFor;
          const view = document.querySelector('.frame__view')?.getBoundingClientRect();
          const top = Math.max(stageBox.top, view?.top ?? stageBox.top);
          const dx = at.left < stageBox.left || at.right > stageBox.right ? stageBox.left + inset - at.left : 0;
          let dy = at.top < top ? top + inset - at.top : at.bottom > stageBox.bottom ? stageBox.bottom - inset - at.bottom : 0;
          // what the panel holds, scrolled or not, with its borders (its height counts them), at most its share of the
          // window
          const tall = Math.min(drawn.scrollHeight + drawn.offsetHeight - drawn.clientHeight, window.innerHeight * TALLEST_SHARE);
          const over = Math.ceil(at.top + dy + tall - (window.innerHeight - inset));
          // moved up no further than leaves the label at the top of the view
          if (fitFrames.current > 0 && over > 0) dy = Math.max(dy - over, top + inset - at.top);
          if (Math.round(dx) !== 0 || Math.round(dy) !== 0) {
            fitFrom.current = at.top;
            if (PAN !== undefined) (store.dispatch as (command: CommandId, args: unknown) => unknown)(PAN.command.id, { dx: Math.round(dx), dy: Math.round(dy) });
          }
        }
        if (!open) revealed.current = null;
        const placedBox = at === undefined || !seen ? null : placeQuickPanel({ x: at.x, y: at.y, width: at.width, height: at.height }, element, size, open, whole, inset, offset);
        const next = placedBox === null ? null : { id, open, box: placedBox, element, widest: Math.max(0, window.innerWidth - 2 * inset), tallest: Math.max(0, window.innerHeight - placedBox.y - inset) };
        setPlaced((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
      }
      request = requestAnimationFrame(measure);
    };
    request = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(request);
  }, [shown, id, open, offset, stage, store]);

  // a placing made for the element and state drawn now: until one is made the panel is drawn hidden while it is
  // measured (`.is-measuring`), and a hidden element can take no focus, so the focus below waits for the placing
  const current = placed !== null && node !== null && placed.id === node.id && placed.open === open ? placed : null;
  const at = current === null ? undefined : { left: current.box.x, top: current.box.y };
  const measuring = current === null ? ' is-measuring' : '';
  const wasOpen = useRef(open);
  const focusDue = useRef(false);
  // Opened, the focus goes into its first field, so a person types at once and Tab walks the fields; closed, back to
  // the chip, on the canvas (spec quick-panel, Problems in Pager 4: Escape returns the focus to the canvas). Both wait
  // for the placing of what they focus: a panel or chip still being measured is drawn hidden and takes no focus.
  useLayoutEffect(() => {
    if (wasOpen.current !== open) {
      wasOpen.current = open;
      focusDue.current = true;
    }
    if (!focusDue.current || measuring !== '') return;
    focusDue.current = false;
    if (!open) {
      chip.current?.focus();
      return;
    }
    const fields = panel.current?.querySelectorAll<HTMLElement>('.quick-panel__fields input:not(:disabled), .quick-panel__fields textarea:not(:disabled)');
    const first = fields?.item(0) ?? panel.current?.querySelector<HTMLElement>('input:not(:disabled), button:not([aria-disabled="true"])');
    first?.focus();
  }, [open, measuring]);
  if (!shown || node === null) return null;
  if (!open) {
    return CHIP_DOOR === null ? null : <Chip entry={CHIP_DOOR} open={false} at={at} measuring={measuring} buttonRef={chip} />;
  }
  // the context of the writes (A3.8): the class the style target names, the state and the breakpoint in view
  const contextLabel = [contextTarget === null ? null : `.${contextTarget}`, contextState === null ? null : t(contextState as MessageId), contextBreakpoint === null ? null : wordsOf(JSON.parse(contextBreakpoint) as ReturnType<typeof breakpointWords>, t)].filter((part) => part !== null).join(' · ');
  const actions = FIELDS.filter((entry) => isAction(entry) && applicable.split(' ').includes(entry.ref));
  const fields = FIELDS.filter((entry) => {
    if (isAction(entry)) return false;
    // an attribute field shows where the element takes the attribute; the others, where their properties apply (6.1)
    if (entry.door.kind === 'quick-panel' && entry.door.attribute !== null) {
      const facts = ATTRIBUTES.get(entry.door.attribute);
      // the attribute lists the element kinds it applies to (elements.json); an input type narrows it further
      const kinds = facts?.elements;
      return kinds !== undefined && (kinds === 'all' || kinds.includes(node.type)) && attributeApplies(node, entry.door.attribute);
    }
    return isTag(entry) || (appliesTo(entry.door.adapter.writes, node, MODEL_RULES) && shownForContext(entry.door.adapter.writes, context, MODEL_RULES));
  });
  const tag = fields.find(isTag);
  const grouped = QUICK_GROUPS.map((group) => ({
    id: group.id,
    name: group.labelKey,
    fields: fields.filter((entry) => !isTag(entry) && inQuickGroup(entry, group)),
  })).filter((group) => group.fields.length > 0);
  const other = fields.filter((entry) => !isTag(entry) && !QUICK_GROUPS.some((group) => inQuickGroup(entry, group)));
  return (
    <div
      ref={panel}
      className={`quick-panel${measuring}`}
      style={{ ...at, maxWidth: current?.widest, maxHeight: current === null ? undefined : `min(${TALLEST_SHARE * 100}vh, ${current.tallest}px)` }}
      data-region={REGION}
      data-key-context={PANEL_KEYS}
      role="dialog"
      aria-label={t('quickPanel.open')}
    >
      <div className="quick-panel__bar">
        {GRIP !== null ? <Grip entry={GRIP} node={node} offset={current === null ? null : offsetOf(current.box, current.element)} /> : null}
        <strong className="quick-panel__name" title={node.name}>{node.name}</strong>
        {/* the context the writes land in (A3.8): the class target, the state and the breakpoint, when they differ from
            the plain element at Base */}
        {contextLabel === '' ? null : <span className="quick-panel__context" title={contextLabel}>{contextLabel}</span>}
        {tag === undefined ? null : <span className="quick-panel__tag"><QuickField entry={tag} node={node} context={context} twoColumn={false} /></span>}
        <div className="quick-panel__actions">
          {actions.map((entry) => (
            <QuickField key={entry.ref} entry={entry} node={node} context={context} twoColumn={false} />
          ))}
        </div>
        {CHIP_DOOR === null ? null : <Chip entry={CHIP_DOOR} open={true} measuring={measuring} buttonRef={chip} />}
      </div>
      <div className="quick-panel__fields">
        {grouped.map((group) => (
          <section className="quick-panel__group" data-quick-group={group.name} key={group.name}>
            <h3>{t(group.name as MessageId)}</h3>
            <div className="quick-panel__group-fields">
              {group.fields.map((entry) => <QuickField key={entry.ref} entry={entry} node={node} context={context} twoColumn={!ONE_COLUMN.has(group.id)} />)}
            </div>
          </section>
        ))}
        {other.length > 0 ? <section className="quick-panel__group" data-quick-group="inspector.group.more">
          <h3>{t('inspector.group.more')}</h3>
          <div className="quick-panel__group-fields">
            {other.map((entry) => <QuickField key={entry.ref} entry={entry} node={node} context={context} twoColumn />)}
          </div>
        </section> : null}
      </div>
    </div>
  );
}

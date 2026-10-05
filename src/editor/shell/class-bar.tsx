// The selector bar's class controls (archive/DESIGN.md "Inspector", Style tab 1; spec shared-style-classes), each a
// door of the inspector-selector-bar region:
//  - the target chips (inspector.setStyleTarget): Element, then each class every selected element lists, the target
//    pressed; each class chip holds its × (classes.detach), which removes the class from the selected elements;
//  - + Class (classes.apply): it opens the list of the project's classes the selected elements do not all list, then a
//    field where a new name is typed; choosing a class, or Enter in the field, applies it;
//  - Save the styles as a class (classes.create): it opens a name field; Enter keeps the name, leaving the field closes
//    it;
//  - below them, while a class is the target, how many elements the edit reaches (".card affects 3 elements").
// The lists and fields are the doors' own popups: opening one is not a command (archive/DESIGN.md "What is not a
// command").
import { useRef, type FormEvent, type ReactNode } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { classesOf, usesOfClass } from '../../core/design/classes.ts';
import { locate } from '../../core/document/model.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId, MessageId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { DoorControl, Icon, appliesNow, useDoor } from '../doors/door.tsx';
import { doorSlots, drawnAsOf, partOf } from '../doors/placement.ts';
import { afterGesture } from '../input/pointer.ts';
import { styleClassOf } from '../inspector/style-target.ts';
import { BASE_STATE, activeState } from '../view/style-state.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { Popover, usePopover } from './popover.tsx';

const DOORS = doorSlots('inspector-selector-bar');
// the target chip, the × drawn inside a class chip, + Class and Save the styles as a class (their commands' arguments)
const CHIP = DOORS.find((d) => drawnAsOf(d) === 'item' && 'target' in d.command.args);
const REMOVE = CHIP ? partOf('inspector-selector-bar', CHIP) : null;
const APPLY = DOORS.find((d) => drawnAsOf(d) === 'button' && 'className' in d.command.args);
const SAVE = DOORS.find((d) => drawnAsOf(d) === 'icon-button' && 'name' in d.command.args);
// under the "affects" line while a class is the target (spec class-moves): move the element's styles into it, apply it
// to every element of the element's type
const MOVE_INTO = DOORS.find((d) => d.door.kind === 'panel-control' && d.door.control === 'class-move-into');
// apply the class to similar elements, one door per scope (this page, the project; the audit's AUD-19)
const APPLY_SIMILAR = DOORS.filter((d) => d.door.kind === 'panel-control' && d.door.control === 'class-apply-similar');
// the scope that reaches past the page: drawn only where the project has another page
const PROJECT_WIDE = (entry: DoorEntry): boolean => entry.door.args.scope === entry.command.args.scope?.values.at(-1);
const ELEMENT = 'element';
const CLASS = 'class';
const SEPARATOR = '\n';

const ready = (entry: DoorEntry) => isFeatureBuilt(entry.door.feature as FeatureId);

// the classes every selected element lists, in the first element's order, as one text so the hook's answer is stable
function useSharedClasses(): readonly string[] {
  const text = useEditorState((s) => {
    const nodes = s.selection.map((id) => locate(s.document, id)?.node);
    const first = nodes[0];
    if (first === undefined || nodes.some((n) => n === undefined)) return '';
    return first.classes.filter((c) => nodes.every((n) => n?.classes.includes(c))).join(SEPARATOR);
  });
  return text === '' ? [] : text.split(SEPARATOR);
}

// A command run with a typed argument, once no gesture is open.
function useTyped(entry: DoorEntry | undefined, arg: string): (text: string) => void {
  const store = useStore();
  return (text) => {
    if (entry === undefined) return;
    afterGesture(store, () => (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, [arg]: text }));
  };
}

export function TargetChips() {
  const t = useT();
  const shared = useSharedClasses();
  const none = useEditorState((s) => s.selection.length === 0);
  if (CHIP === undefined || none) return null;
  return (
    <>
      <DoorControl entry={CHIP} args={{ target: ELEMENT }} label={t('inspector.element')} className="target-chip target-chip--element" ready={ready(CHIP)} />
      {shared.map((name) => (
        <span key={name} className="target-chip-group">
          <DoorControl entry={CHIP} args={{ target: CLASS, className: name }} label={`.${name}`} className="target-chip target-chip--class" ready={ready(CHIP)} />
          {REMOVE !== null ? <DoorControl entry={REMOVE} args={{ className: name }} className="target-chip__remove" ready={ready(REMOVE)} /> : null}
        </span>
      ))}
    </>
  );
}

// + Class: the list of the classes to apply and the field of a new name
function ApplyClass() {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const { open, setOpen } = usePopover(trigger);
  const run = useTyped(APPLY, 'className');
  const shared = useSharedClasses();
  const offered = useEditorState((s) => classesOf(s.document).map((c) => c.name).filter((name) => !shared.includes(name)).join(SEPARATOR));
  const door = useDoor(APPLY ?? (DOORS[0] as DoorEntry), {}, undefined, APPLY !== undefined && ready(APPLY));
  if (APPLY === undefined) return null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem('name') as HTMLInputElement | null;
    run(field?.value ?? '');
    setOpen(false);
  };
  return (
    <span className="class-popup">
      <button
        ref={trigger}
        type="button"
        className={`door door--button target-chip target-chip--add${door.available ? '' : ' is-unavailable'}`}
        data-door={APPLY.ref}
        data-args="{}"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={door.label}
        title={door.title}
        aria-disabled={door.available ? undefined : true}
        onClick={() => (door.available ? setOpen((was) => !was) : undefined)}
      >
        <span className="door__label">{door.face}</span>
      </button>
      {open ? (
        // the popover: under the chip, inside the window, closed by a choice, the backdrop or Escape (popover.tsx)
        <Popover onDismiss={() => setOpen(false)} anchor={trigger} className="class-popup__panel" label={door.label}>
          {offered === ''
            ? null
            : offered.split(SEPARATOR).map((name) => (
                <button key={name} type="button" className="class-popup__item" data-door={APPLY.ref} data-args={JSON.stringify({ className: name })} onClick={() => {
                    run(name);
                    setOpen(false);
                  }}>
                  .{name}
                </button>
              ))}
          <form className="class-popup__form" onSubmit={submit}>
            {/* the field takes the focus as the list opens: the person types a new name at once */}
            <input className="input" name="name" data-autofocus spellCheck={false} placeholder={t('inspector.className')} aria-label={t('inspector.className')} data-local="class-name" data-key-context="dialog" />
          </form>
        </Popover>
      ) : null}
    </span>
  );
}

// Save the styles as a class: the name field
function SaveAsClass() {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const { open, setOpen } = usePopover(trigger);
  const run = useTyped(SAVE, 'name');
  const door = useDoor(SAVE ?? (DOORS[0] as DoorEntry), {}, undefined, SAVE !== undefined && ready(SAVE));
  if (SAVE === undefined) return null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem('name') as HTMLInputElement | null;
    run(field?.value ?? '');
    setOpen(false);
  };
  return (
    <span className="class-popup">
      <button
        ref={trigger}
        type="button"
        className={`door door--icon-button door--sm${door.available ? '' : ' is-unavailable'}`}
        data-door={SAVE.ref}
        data-args="{}"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={door.label}
        title={door.title}
        aria-disabled={door.available ? undefined : true}
        onClick={() => (door.available ? setOpen((was) => !was) : undefined)}
      >
        {SAVE.door.icon !== null ? <Icon name={SAVE.door.icon} size="sm" /> : null}
      </button>
      {open ? (
        <Popover onDismiss={() => setOpen(false)} anchor={trigger} className="class-popup__panel" label={door.label}>
          <form className="class-popup__form" onSubmit={submit}>
            <input className="input" name="name" data-autofocus spellCheck={false} placeholder={t('inspector.className')} aria-label={t('inspector.className')} data-local="class-name" data-key-context="dialog" />
          </form>
        </Popover>
      ) : null}
    </span>
  );
}

// how many elements the class that is the style target reaches; nothing with the Element target
export function Affects() {
  const t = useT();
  const target = useEditorState((s) => styleClassOf(s));
  const count = useEditorState((s) => (target === null ? 0 : usesOfClass(s.document, target)));
  const several = useEditorState((s) => s.selection.length > 1);
  // several elements written at once: their fields say Mixed where their values differ (the canonical note)
  // the state edited, as its selector writes it: the rule the writes land in (the canonical ".btn:hover affects 3")
  const pseudo = useEditorState((s) => (activeState(s.ui).id === BASE_STATE.id ? '' : (activeState(s.ui).pseudo ?? '')));
  if (target === null) return several ? <div className="affects">{t('inspector.mixed')}</div> : null;
  const selector = `.${target}${pseudo}`;
  return (
    <div className="affects">
      <span>{count === 1 ? t('inspector.affects.one', { selector }) : t('inspector.affects.other', { selector, count })}</span>
      <ClassMoves target={target} selector={`.${target}`} />
    </div>
  );
}

// Move this element's styles into the class, while it has styles of its own; apply the class to every element of its
// type on this page or in the project, while one lacks it (each drawn only while it can act: the door's command can
// run; the project's only while the project has another page)
function ClassMoves({ target, selector }: { readonly target: string; readonly selector: string }) {
  const t = useT();
  const primary = useEditorState((s) => (s.selection[0] === undefined ? null : (locate(s.document, s.selection[0])?.node ?? null)));
  const store = useStore();
  useEditorState((s) => s.document);
  const pages = useEditorState((s) => s.document.pages.length);
  if (primary === null) return null;
  const element = t(`element.${primary.type}.label` as MessageId);
  const args = { className: target };
  return (
    <span className="affects__actions">
      {MOVE_INTO !== undefined && appliesNow(MOVE_INTO, args, store) ? <DoorControl entry={MOVE_INTO} args={args} label={t(MOVE_INTO.door.labelKey as MessageId, { selector })} ready={ready(MOVE_INTO)} /> : null}
      {APPLY_SIMILAR.filter((entry) => (pages > 1 || !PROJECT_WIDE(entry)) && appliesNow(entry, args, store)).map((entry) => (
        <DoorControl key={entry.ref} entry={entry} args={args} label={t(entry.door.labelKey as MessageId, { selector, element: element.toLowerCase() })} ready={ready(entry)} />
      ))}
    </span>
  );
}

// the control the selector bar draws for + Class and Save the styles as a class; undefined for any other door
export function classBarControl(entry: DoorEntry): ReactNode | undefined {
  if (entry === APPLY) return <ApplyClass key={entry.ref} />;
  if (entry === SAVE) return <SaveAsClass key={entry.ref} />;
  // drawn under the "affects" line (ClassMoves), never in the bar's row
  if (entry === MOVE_INTO || APPLY_SIMILAR.includes(entry)) return null;
  return undefined;
}

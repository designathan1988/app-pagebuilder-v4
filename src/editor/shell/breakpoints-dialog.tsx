// The Breakpoints dialog (breakpoints-dialog; spec project-breakpoints), open while the
// editor state says so (ui.dialog; View ▸ Breakpoints…): one row per breakpoint of the project's table, widest first,
// with its name and the widest screen it holds, then the width of the screen the canvas shows (viewport-width.tsx).
// Enter or leaving a field keeps what was typed (breakpoints.rename, breakpoints.setWidth: one undo step each); the
// trash removes the breakpoint (breakpoints.remove; the base has none); Add makes one at the width the canvas shows
// (breakpoints.add). A refused value goes back to what the table holds, and the status bar says why.
import { useEffect, useRef } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { breakpointName, breakpointsOf, type ProjectBreakpoint } from '../../core/document/breakpoints.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { DoorControl, Icon, useDoor } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { viewportWidth } from '../view/breakpoints.ts';
import { DIALOG_KEYS, ModalDialog } from './dialog.tsx';
import { ViewportWidth } from './viewport-width.tsx';
import { Popover, usePopover } from './popover.tsx';

const REGION = 'breakpoints-dialog';
const DIALOG = 'breakpoints';
// the width of the screen the canvas shows, a control of its own (view.setViewportWidth); the table's doors are the
// others
const SHOWN = doorSlots(REGION).find((d) => d.door.kind === 'panel-control' && d.door.control === 'viewport-width');
const DOORS = doorSlots(REGION).filter((d) => d !== SHOWN);
// the fields: the argument each keeps besides the breakpoint, a text (the name) or a number (the width)
const keptArg = (entry: DoorEntry): string => Object.keys(entry.command.args).find((name) => entry.command.args[name]?.type !== 'breakpoint') ?? '';
const isNumber = (entry: DoorEntry): boolean => entry.command.args[keptArg(entry)]?.type === 'number';
const FIELDS = DOORS.filter((d) => d.door.kind === 'panel-control' && d.door.drawnAs === 'field');
const NAME = FIELDS.find((d) => !isNumber(d));
const WIDTH = FIELDS.find(isNumber);
// the trash: the door that takes the breakpoint and a choice; Add: the one that takes nothing it must have
const REMOVE = DOORS.find((d) => Object.values(d.command.args).some((a) => a.type === 'enum') && Object.values(d.command.args).some((a) => a.type === 'breakpoint'));
const ADD = DOORS.find((d) => Object.values(d.command.args).every((a) => a.optional));

const built = (entry: DoorEntry | undefined): boolean => entry !== undefined && isFeatureBuilt(entry.door.feature as FeatureId);

export function BreakpointsDialog() {
  const open = useEditorState((s) => s.ui.dialog === DIALOG);
  return open ? <OpenBreakpoints /> : null;
}

function OpenBreakpoints() {
  const t = useT();
  const table = useEditorState((s) => breakpointsOf(s.document));
  const width = useEditorState((s) => viewportWidth(s));
  return (
    <ModalDialog region={REGION} titleKey="breakpoints.title" className="breakpoints-dialog">
      <div className="dialog__body">
        <p className="breakpoints-dialog__hint">{t('breakpoints.hint')}</p>
        <div className="breakpoints-dialog__table" role="table" aria-label={t('breakpoints.title')}>
          <div className="breakpoints-dialog__row breakpoints-dialog__row--head" role="row">
            <span role="columnheader">{t('breakpoints.name')}</span>
            <span role="columnheader">{t('breakpoints.width')}</span>
            <span role="columnheader" />
          </div>
          {table.map((breakpoint) => (
            <BreakpointRow key={breakpoint.id} breakpoint={breakpoint} />
          ))}
        </div>
        {SHOWN === undefined ? null : (
          <label className="breakpoints-dialog__shown">
            <span>{t('command.setViewportWidth')}</span>
            <ViewportWidth entry={SHOWN} />
          </label>
        )}
        <footer className="dialog__footer">
          {ADD === undefined ? null : (
            <DoorControl entry={ADD} ready={built(ADD)} title={t('command.breakpoints.add')}>
              <span className="door__label">{t('breakpoints.addAt', { width })}</span>
            </DoorControl>
          )}
        </footer>
      </div>
    </ModalDialog>
  );
}

function BreakpointRow({ breakpoint }: { readonly breakpoint: ProjectBreakpoint }) {
  const t = useT();
  const name = breakpointName(breakpoint, t);
  return (
    <div className="breakpoints-dialog__row" role="row" data-breakpoint={breakpoint.id}>
      {NAME === undefined ? <span /> : <TableField entry={NAME} breakpoint={breakpoint} shown={name} label={`${t('breakpoints.name')}: ${name}`} />}
      {WIDTH === undefined ? <span /> : <TableField entry={WIDTH} breakpoint={breakpoint} shown={String(breakpoint.width)} label={`${t('breakpoints.width')}: ${name}`} />}
      {breakpoint.base ? (
        <span className="breakpoints-dialog__base">{t('breakpoints.base')}</span>
      ) : REMOVE === undefined ? (
        <span />
      ) : (
        <RemoveMenu entry={REMOVE} breakpoint={breakpoint} />
      )}
    </div>
  );
}

// The trash of a row: a menu of where the breakpoint's styles go — into the next wider breakpoint, into the next
// narrower one (which keeps its own look: it inherited them), or nowhere — each the remove door with that choice.
function RemoveMenu({ entry, breakpoint }: { readonly entry: DoorEntry; readonly breakpoint: ProjectBreakpoint }) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const { open, setOpen } = usePopover(trigger);
  const table = useEditorState((s) => breakpointsOf(s.document));
  const door = useDoor(entry, { breakpoint: breakpoint.id }, undefined, built(entry));
  const at = table.findIndex((b) => b.id === breakpoint.id);
  const wider = table[at - 1];
  const narrower = table[at + 1];
  const name = breakpointName(breakpoint, t);
  const choices: readonly { readonly styles: string; readonly label: string }[] = [
    ...(narrower === undefined ? [] : [{ styles: 'narrower', label: t('breakpoints.removeInto', { name: breakpointName(narrower, t) }) }]),
    ...(wider === undefined ? [] : [{ styles: 'wider', label: t('breakpoints.removeInto', { name: breakpointName(wider, t) }) }]),
    { styles: 'discard', label: t('breakpoints.removeDiscard') },
  ];
  return (
    <span className="breakpoints-dialog__remove">
      <button
        ref={trigger}
        type="button"
        className={`door door--icon-button${door.available ? '' : ' is-unavailable'}`}
        data-door={entry.ref}
        data-args={JSON.stringify({ breakpoint: breakpoint.id })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('breakpoints.removeMenu', { name })}
        title={t('breakpoints.removeMenu', { name })}
        aria-disabled={door.available ? undefined : true}
        data-key-context={DIALOG_KEYS}
        onClick={() => door.available && setOpen((was) => !was)}
      >
        {entry.door.icon === null ? null : <Icon name={entry.door.icon} size="md" />}
      </button>
      {open ? (
        <Popover onDismiss={() => setOpen(false)} anchor={trigger} className="menu breakpoints-dialog__menu" role="menu" label={t('breakpoints.removeMenu', { name })} keyContext={DIALOG_KEYS}>
          {choices.map((choice) => (
            <RemoveChoice key={choice.styles} entry={entry} args={{ breakpoint: breakpoint.id, styles: choice.styles }} label={choice.label} onDone={() => setOpen(false)} />
          ))}
        </Popover>
      ) : null}
    </span>
  );
}

// One choice of the trash's menu: an item of the menu, the remove door with its choice
function RemoveChoice({ entry, args, label, onDone }: { readonly entry: DoorEntry; readonly args: Readonly<Record<string, unknown>>; readonly label: string; readonly onDone: () => void }) {
  const door = useDoor(entry, args, label, built(entry));
  return (
    <button
      type="button"
      role="menuitem"
      className={['menu__item', door.available ? '' : 'is-unavailable'].filter((c) => c !== '').join(' ')}
      data-door={entry.ref}
      data-args={JSON.stringify(args)}
      title={door.title}
      aria-disabled={door.available ? undefined : true}
      onClick={() => {
        if (!door.available) return;
        // the menu closes first, then the choice runs (as a menu's item does: doors/menu.tsx)
        onDone();
        door.run();
      }}
    >
      <span className="menu__label">{label}</span>
    </button>
  );
}

// A field of a row: what the table holds, again after a refusal or an undo; Enter or leaving it keeps what was typed
function TableField({ entry, breakpoint, shown, label }: { readonly entry: DoorEntry; readonly breakpoint: ProjectBreakpoint; readonly shown: string; readonly label: string }) {
  const arg = keptArg(entry);
  const numeric = isNumber(entry);
  const store = useStore();
  const field = useDoor(entry, { breakpoint: breakpoint.id }, undefined, built(entry));
  const input = useRef<HTMLInputElement>(null);
  // after a value was kept (or refused), the field shows what the table holds, even while it keeps the focus
  const kept = useRef(false);
  const said = useEditorState((s) => s.message);
  useEffect(() => {
    if (input.current !== null && (kept.current || document.activeElement !== input.current)) input.current.value = shown;
    kept.current = false;
  }, [shown, said]);
  const keep = (typed: string) => {
    if (!field.available || typed.trim() === shown) return;
    const value = numeric ? (typed.trim() === '' ? Number.NaN : Number(typed)) : typed;
    kept.current = true;
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, breakpoint: breakpoint.id, [arg]: value });
  };
  return (
    <form
      className="breakpoints-dialog__cell"
      role="cell"
      onSubmit={(event) => {
        event.preventDefault();
        keep(input.current?.value ?? '');
      }}
    >
      <input
        ref={input}
        className="input"
        type="text"
        defaultValue={shown}
        inputMode={numeric ? 'numeric' : undefined}
        disabled={!field.available}
        aria-label={label}
        title={field.title}
        spellCheck={false}
        autoComplete="off"
        data-door={entry.ref}
        data-args={JSON.stringify({ breakpoint: breakpoint.id })}
        data-key-context={DIALOG_KEYS}
        onBlur={(event) => keep(event.currentTarget.value)}
      />
    </form>
  );
}

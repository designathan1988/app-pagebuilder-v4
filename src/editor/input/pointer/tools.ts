// The canvas tools a module adds, the colour picker's session and the pan (plan I.12).
import type { DispatchResult } from '../../../core/store/store.ts';
import type { CommandId } from '../../../generated/ids.ts';
import type { DoorEntry } from '../../../manifest/runtime.ts';
import { WHEEL_DOORS, WHEEL_FACTOR, WHEEL_LINE, onStage, CANCEL_PICKER, finishPickerSession } from './common.ts';
import type { PointerOwner } from './owner.ts';

export function pointerTools(p: PointerOwner): Pick<PointerOwner, 'dropTool' | 'followPicker' | 'dispatchPan' | 'onWheel'> {
  const { ps, shared, store, target } = p;
  const dropTool = () => {
    if (ps.tooling === null) return;
    const { session, gesture } = ps.tooling;
    ps.tooling = null;
    if (shared.open === gesture) shared.open = null;
    session.cancel();
    gesture.cancel();
  };
  const followPicker = () => {
    const ui = store.getState().ui;
    if (ui.colorPicker !== null && shared.session === null && shared.open === null) {
      shared.session = store.gesture();
      shared.open = shared.session;
      ps.pickerCancels = ui.drag.cancels;
      ps.pickerClosings = ui.colorPickerClosed.count;
      return;
    }
    if (shared.session === null) return;
    const ended = ui.colorPickerClosed.count !== ps.pickerClosings;
    const escaped = ui.drag.cancels !== ps.pickerCancels;
    if (!ended && !escaped) return;
    ps.pickerClosings = ui.colorPickerClosed.count;
    const closing = shared.session;
    shared.session = null;
    shared.open = null;
    const applied = ended && ui.colorPickerClosed.applied;
    shared.pendingPickerEnd = () => {
      // Escape ended the session: the picker closes too, inside it, so that nothing opens a session again
      if (escaped && store.getState().ui.colorPicker !== null) closing.dispatch(CANCEL_PICKER as never, {} as never);
      if (applied) closing.commit();
      else closing.cancel();
    };
    queueMicrotask(() => finishPickerSession(shared));
  };
  // the pan's and the wheel's doors, run through the store
  const dispatchPan = (entry: DoorEntry, args: Readonly<Record<string, unknown>>) => {
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id as CommandId, { ...entry.door.args, ...args });
  };
  const onWheel = (event: WheelEvent) => {
    if (!onStage(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey ? 'Ctrl' : event.shiftKey ? 'Shift' : null;
    const entry = WHEEL_DOORS.find((d) => d.door.kind === 'canvas-wheel' && d.door.modifier === modifier);
    if (!entry) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? target.innerHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    if ('factor' in entry.command.args) p.dispatchPan(entry, { factor: Math.exp(-dy * WHEEL_FACTOR), point: { x: event.clientX, y: event.clientY } });
    else if (modifier === 'Shift') p.dispatchPan(entry, { dx: -(dx !== 0 ? dx : dy), dy: 0 });
    else p.dispatchPan(entry, { dx: -dx, dy: -dy });
  };
  return { dropTool, followPicker, dispatchPan, onWheel };
}

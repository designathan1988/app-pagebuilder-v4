// The Snap settings dialog (snap-settings-dialog; spec snap-toggle-settings), open while
// the editor state says so (ui.dialog; the Snap menu's Snap settings…): a checkbox per snap target snap.setSettings
// offers and the snap distance, showing the settings in force when it opens (src/editor/view/snap.ts). What is ticked
// and typed is the dialog's own until Apply (the door of its region) keeps it; the close button and Escape (Cancel)
// close it and drop it. Ticking a box or typing is not a command.
import type { FormEvent } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId, MessageId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { useDoor } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { afterGesture } from '../input/pointer.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { SNAP_TARGETS, snapSettingsOf } from '../view/snap.ts';
import { DIALOG_KEYS, ModalDialog } from './dialog.tsx';

const REGION = 'snap-settings-dialog';
const DIALOG = 'snap-settings';
// Apply: the door that takes the targets and the distance
const APPLY = doorSlots(REGION).find((d) => 'targets' in d.command.args && 'distance' in d.command.args);
const TARGETS = 'targets';
const DISTANCE = 'distance';

export function SnapSettingsDialog() {
  const open = useEditorState((s) => s.ui.dialog === DIALOG);
  return open && APPLY !== undefined ? <OpenSnapSettings apply={APPLY} /> : null;
}

function OpenSnapSettings({ apply }: { readonly apply: DoorEntry }) {
  const t = useT();
  const store = useStore();
  // the settings in force when the dialog opens: what its boxes and its field show first
  const inForce = useEditorState((s) => JSON.stringify(snapSettingsOf(s.ui)));
  const { targets, distance } = JSON.parse(inForce) as { targets: string[]; distance: number };
  const door = useDoor(apply, {}, undefined, isFeatureBuilt(apply.door.feature as FeatureId));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!door.available) return;
    const form = new FormData(event.currentTarget);
    const ticked = form.getAll(TARGETS).filter((v): v is string => typeof v === 'string');
    const typed = String(form.get(DISTANCE) ?? '').trim();
    const args = { ...apply.door.args, targets: ticked, distance: typed === '' ? Number.NaN : Number(typed) };
    afterGesture(store, () => (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(apply.command.id as CommandId, args));
  };
  return (
    <ModalDialog region={REGION} titleKey="snapSettings.title" className="snap-settings">
      <form className="dialog__body" onSubmit={submit}>
        <fieldset className="snap-settings__targets">
          <legend className="guides-grids__title" title={t('snapSettings.targetsHint')}>
            {t('snapSettings.targets')}
          </legend>
          {SNAP_TARGETS.map((target) => (
            <label key={target} className="snap-settings__target">
              <input type="checkbox" name={TARGETS} value={target} defaultChecked={targets.includes(target)} data-key-context={DIALOG_KEYS} />
              {t(`snapSettings.target.${target}` as MessageId)}
            </label>
          ))}
        </fieldset>
        <label className="guides-grids__field" title={t('snapSettings.distanceHint')}>
          <span className="guides-grids__label">{t('snapSettings.distance')}</span>
          <input className="input" name={DISTANCE} inputMode="decimal" spellCheck={false} defaultValue={String(distance)} data-key-context={DIALOG_KEYS} />
        </label>
        <footer className="dialog__footer">
          <button type="submit" className={`door door--button${door.available ? '' : ' is-unavailable'}`} data-door={apply.ref} title={door.title} aria-disabled={door.available ? undefined : true}>
            <span className="door__label">{door.face}</span>
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}

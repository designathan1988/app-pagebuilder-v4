// The recovery dialog (recovery-dialog; spec autosave-corruption-recovery): open at start
// when the saved work could not be read (ui.dialog `recovery`, with the saved versions in ui.recovery), while autosave
// still waits for a recovery. It lists the versions, the newest first, each with the time it was saved and the region's
// door, Restore (project.restoreVersion, the version by its revision); with none, it says so. Closing it changes
// nothing of the recovery: the status bar keeps reading Recovery required until a version is restored or another
// project replaces the document.
import { useSyncExternalStore } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { FeatureId } from '../../generated/ids.ts';
import { DoorControl } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { saveState } from '../persistence/autosave.ts';
import { useEditorState } from '../store.ts';
import { useLocale, useT } from '../text.ts';
import { ModalDialog } from './dialog.tsx';

const REGION = 'recovery-dialog';
const DIALOG = 'recovery';
const RESTORE = doorSlots(REGION)[0];

export function RecoveryDialog() {
  const t = useT();
  const locale = useLocale();
  const open = useEditorState((s) => s.ui.dialog === DIALOG);
  const versions = useEditorState((s) => s.ui.recovery);
  const waiting = useSyncExternalStore(saveState.subscribe, saveState.get) === 'recoveryRequired';
  if (!open || !waiting || RESTORE === undefined) return null;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });
  return (
    <ModalDialog region={REGION} titleKey="recovery.title" className="recovery">
      <div className="dialog__body">
        <p className="recovery__hint">{t('recovery.hint')}</p>
        {versions === undefined || versions.length === 0 ? (
          <p className="guides-grids__none">{t('recovery.none')}</p>
        ) : (
          <ul className="guides-grids__guides">
            {versions.map((v) => (
              <li key={v.revision} className="guides-grids__guide">
                <span>{t('recovery.savedAt', { time: when.format(v.time) })}</span>
                <DoorControl entry={RESTORE} args={{ version: String(v.revision) }} ready={isFeatureBuilt(RESTORE.door.feature as FeatureId)} className="recovery__restore" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalDialog>
  );
}

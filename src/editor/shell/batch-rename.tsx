// The batch rename dialog (batch-rename-dialog; spec batch-rename), open while the editor
// state says so (ui.dialog; the context menu's Rename the selected…): the pattern the selected elements are named by
// ({name} each one's name, {n} its number) and the first number, the names it will give shown as they are typed, and
// Rename them (element.renameMany, the door of its region), which closes the dialog once it renamed. Typing is the
// dialog's own until then.
import { useState, type FormEvent } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { locate } from '../../core/document/model.ts';
import { batchNames } from '../../core/export/names.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { useDoor } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { afterGesture } from '../input/pointer.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { DIALOG_KEYS, ModalDialog } from './dialog.tsx';

const REGION = 'batch-rename-dialog';
const DIALOG = 'batch-rename';
const APPLY = doorSlots(REGION)[0];
// the dialogs' close door (its ×), run once the renaming is done
const CLOSE = doorSlots('dialog').find((d) => d.door.kind === 'panel-control' && d.door.control === 'close');
// the pattern a dialog starts with: each name, numbered
const START_PATTERN = '{name} {n}';

export function BatchRenameDialog() {
  const open = useEditorState((s) => s.ui.dialog === DIALOG);
  return open && APPLY !== undefined ? <OpenBatchRename apply={APPLY} /> : null;
}

function OpenBatchRename({ apply }: { readonly apply: DoorEntry }) {
  const t = useT();
  const store = useStore();
  const door = useDoor(apply, {}, undefined, isFeatureBuilt(apply.door.feature as FeatureId));
  const names = useEditorState((s) => s.selection.map((id) => locate(s.document, id)?.node.name ?? '').join('\n'));
  const [pattern, setPattern] = useState(START_PATTERN);
  const [start, setStart] = useState('1');
  const preview = (() => {
    try {
      return batchNames(names === '' ? [] : names.split('\n'), pattern, Number(start)).join(', ');
    } catch {
      return '';
    }
  })();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!door.available) return;
    const form = new FormData(event.currentTarget);
    const typed = String(form.get('start') ?? '').trim();
    const args = { ...apply.door.args, pattern: String(form.get('pattern') ?? ''), start: typed === '' ? Number.NaN : Number(typed) };
    afterGesture(store, () => {
      const outcome = (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(apply.command.id as CommandId, args);
      if (outcome.status === 'done' && CLOSE !== undefined) (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(CLOSE.command.id as CommandId, CLOSE.door.args);
    });
  };
  return (
    <ModalDialog region={REGION} titleKey="batchRename.title" className="batch-rename">
      <form className="dialog__body" onSubmit={submit}>
        <label className="guides-grids__field" title={t('batchRename.patternHint', { name: '{name}', n: '{n}' })}>
          <span className="guides-grids__label">{t('batchRename.pattern')}</span>
          <input className="input" name="pattern" spellCheck={false} value={pattern} data-autofocus data-key-context={DIALOG_KEYS} onChange={(event) => setPattern(event.target.value)} />
        </label>
        <p className="batch-rename__hint">{t('batchRename.patternHint', { name: '{name}', n: '{n}' })}</p>
        <label className="guides-grids__field">
          <span className="guides-grids__label">{t('batchRename.start')}</span>
          <input className="input" name="start" inputMode="numeric" value={start} data-key-context={DIALOG_KEYS} onChange={(event) => setStart(event.target.value)} />
        </label>
        {preview === '' ? null : <p className="batch-rename__preview">{t('batchRename.preview', { names: preview })}</p>}
        <footer className="dialog__footer">
          <button type="submit" className={`door door--button${door.available ? '' : ' is-unavailable'}`} data-door={apply.ref} title={door.title} aria-disabled={door.available ? undefined : true}>
            <span className="door__label">{door.face}</span>
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}

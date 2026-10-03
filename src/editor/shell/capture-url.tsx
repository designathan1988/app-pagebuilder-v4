// The Open a web address dialog (spec capture-url; File › Open a web address…), open while the editor state says so:
// the address, a reminder that what is captured belongs to its authors, how the Companion is started, and Capture
// (project.captureUrl, the door of its region), which closes the dialog and sends the request (import/capture.ts).
import { useState, type FormEvent } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { CommandId, FeatureId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { useDoor } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { afterGesture } from '../input/pointer.ts';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { DIALOG_KEYS, ModalDialog } from './dialog.tsx';

const REGION = 'capture-url-dialog';
const DIALOG = 'capture-url';
const RUN = doorSlots(REGION)[0];

export function CaptureUrlDialog() {
  const open = useEditorState((s) => s.ui.dialog === DIALOG);
  return open && RUN !== undefined ? <OpenCaptureUrl run={RUN} /> : null;
}

function OpenCaptureUrl({ run }: { readonly run: DoorEntry }) {
  const t = useT();
  const store = useStore();
  const door = useDoor(run, {}, undefined, isFeatureBuilt(run.door.feature as FeatureId));
  const [url, setUrl] = useState('');
  const [pages, setPages] = useState('1');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!door.available) return;
    const form = new FormData(event.currentTarget);
    const typed = String(form.get('url') ?? '');
    const count = String(form.get('pages') ?? '').trim();
    afterGesture(() => (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(run.command.id as CommandId, { ...run.door.args, url: typed, pages: count === '' ? 1 : Number(count) }));
  };
  return (
    <ModalDialog region={REGION} titleKey="capture.title" className="capture-url">
      <form className="dialog__body" onSubmit={submit}>
        <label className="guides-grids__field">
          <span className="guides-grids__label">{t('capture.url')}</span>
          <input className="input" name="url" type="text" inputMode="url" placeholder={t('capture.placeholder')} spellCheck={false} value={url} data-autofocus data-key-context={DIALOG_KEYS} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="guides-grids__field" title={t('capture.pagesHint')}>
          <span className="guides-grids__label">{t('capture.pages')}</span>
          <input className="input" name="pages" inputMode="numeric" value={pages} data-key-context={DIALOG_KEYS} onChange={(event) => setPages(event.target.value)} />
        </label>
        <p className="capture-url__hint">{t('capture.pagesHint')}</p>
        <p className="capture-url__notice">{t('capture.notice')}</p>
        <p className="capture-url__hint">{t('capture.companionHint')}</p>
        <footer className="dialog__footer">
          <button type="submit" className={`door door--button${door.available ? '' : ' is-unavailable'}`} data-door={run.ref} title={door.title} aria-disabled={door.available ? undefined : true}>
            <span className="door__label">{door.face}</span>
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}

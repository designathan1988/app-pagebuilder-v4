// The toast (region toast): the notice that follows a delete, with its text and the
// region's doors (Undo). It shows while the state follows a delete (src/core/structure/remove.ts, followsDelete): one
// at most, a new delete replaces it, and the next message takes it away. It is not a live region: the status bar
// already says the same message aloud.
import { followsDelete } from '../../core/structure/remove.ts';
import { useEditorState } from '../store.ts';
import { messageText, useLocale } from '../text.ts';
import { Slots } from './slots.tsx';

export function Toast() {
  const locale = useLocale();
  const shown = useEditorState((s) => (followsDelete(s) ? s.message : null));
  if (shown === null) return null;
  return (
    <div className="toast" data-region="toast">
      <span className="toast__message">{messageText(locale, shown)}</span>
      <Slots region="toast" />
    </div>
  );
}

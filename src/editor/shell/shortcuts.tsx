// The Keyboard shortcuts panel (spec shortcuts-panel): a bottom-dock tab
// listing every binding the keymap holds, grouped by the context it acts in, each row its keys and what they do. It is
// drawn from the keymap itself (input/keymap.ts bindingGroups), never from a list of its own, so Help › Keyboard
// shortcuts shows whatever the manifest declares — including a binding whose command the editor has not built yet,
// marked as not available.
import type { MessageId } from '../../generated/ids.ts';
import { bindingGroups, chordCap } from '../input/keymap.ts';
import { useT } from '../text.ts';

export function Shortcuts() {
  const t = useT();
  const groups = bindingGroups();
  return (
    <div className="shortcuts" data-region="shortcuts">
      {groups.map((group) => (
        <section key={group.context} className="shortcuts__group" aria-label={t(group.labelKey)}>
          <h3 className="shortcuts__title">
            {t('shortcuts.group', { context: { key: group.labelKey }, count: group.bindings.length })}
          </h3>
          <ul className="shortcuts__list">
            {group.bindings.map((binding) => (
              <li key={binding.ref} className={binding.ready ? 'shortcuts__row' : 'shortcuts__row is-unavailable'} data-shortcut={binding.ref}>
                <kbd className="shortcuts__keys">{chordCap(binding.chord)}</kbd>
                {/* a label with a placeholder the panel cannot fill from the state (the palette's tile) is filled with
                    the word for it: the row says what the key does in the context it is listed under */}
                <span className="shortcuts__label">{t(binding.labelKey as MessageId, { element: { key: 'palette.tile' } })}</span>
                {binding.ready ? null : <span className="shortcuts__reason">{t('common.notAvailableYet')}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

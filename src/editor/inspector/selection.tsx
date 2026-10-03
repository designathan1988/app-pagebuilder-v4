// What the inspector's tabs ask about the selection, and the hint list they both draw with nothing selected.
import { locate } from '../../core/document/model.ts';
import { useEditorState } from '../store.ts';
import { panelName } from '../workspace/panel-catalogue.ts';
import { useT } from '../text.ts';

// the one selected element, or null with none or several selected
export const useSingleNode = () => useEditorState((s) => (s.selection.length === 1 && s.selection[0] !== undefined ? (locate(s.document, s.selection[0])?.node ?? null) : null));

// With nothing selected, what the inspector suggests (spec inspector-panel, "Nothing selected"): add an element from
// the Insert panel, select one, edit a text.
export function Hints() {
  const t = useT();
  return (
    <ul className="inspector-hints">
      <li>{t('inspector.hint.insert', { panel: { key: panelName('elements') } })}</li>
      <li>{t('inspector.hint.select')}</li>
      <li>{t('inspector.hint.editText')}</li>
    </ul>
  );
}

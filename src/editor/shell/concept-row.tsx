// A concept row of the Style tab (src/editor/inspector/concept-rows.ts; spec inspector-panel, "Concept rows"): its
// disclosure in the section's gutter, its head — the fields that name the concept, or for a row with no head its label
// and what its details hold — and, while open, its details in a group under it. The disclosure is the door
// inspector.toggleRow#inspector-row-disclosure; a native button, so Enter and Space open and close it.
import { useId, useMemo, type ReactNode } from 'react';
import { storedLayers, storedValue } from '../../core/style/stored.ts';
import { shadowCss } from '../../core/style/shadows.ts';
import { doorSlots } from '../doors/placement.ts';
import { DoorControl } from '../doors/door.tsx';
import { detailProperties, type ConceptRow } from '../inspector/concept-rows.ts';
import { styleSource } from '../inspector/style-target.ts';
import { layeredRules, useEditorState } from '../store.ts';
import { useT } from '../text.ts';

const TOGGLE = doorSlots('inspector-style').find((d) => d.door.kind === 'panel-control' && d.door.control === 'row-disclosure');

export function ConceptRowView({ row, head, details, open }: { readonly row: ConceptRow; readonly head: readonly ReactNode[]; readonly details: readonly ReactNode[]; readonly open: boolean }) {
  const t = useT();
  const id = useId();
  const label = row.labelKey === null ? '' : t(row.labelKey);
  const summary = useRowSummary(row);
  return (
    <div className={`concept-row${open ? ' is-open' : ''}`} data-concept-row={row.id}>
      <div className="concept-row__head">
        {TOGGLE !== undefined && details.length > 0 ? (
          <DoorControl entry={TOGGLE} args={{ row: row.id }} expanded={open} className="concept-row__toggle" label={t('inspector.row.details', { row: label })}>
            {null}
          </DoorControl>
        ) : null}
        {head.length > 0 ? (
          head
        ) : (
          // a summary head: the row's label, then what its details hold in the code face
          <div className="field-row concept-row__summary">
            <span className="field-row__label">{label}</span>
            {/* a long value (a shadow's layers) ends in an ellipsis: the whole of it in its tooltip, as a field's
                face */}
            <span className="concept-row__values" title={summary === '' ? undefined : summary}>{summary === '' ? t('inspector.row.none') : summary}</span>
          </div>
        )}
      </div>
      {open && details.length > 0 ? (
        <div className="concept-row__details" role="group" id={`${id}-details`} aria-label={label}>
          {details}
        </div>
      ) : null}
    </div>
  );
}

// what the edit target holds of the properties a row's details edit, at the edited breakpoint and state, as CSS text
function useRowSummary(row: ConceptRow): string {
  const properties = useMemo(() => detailProperties(row), [row]);
  return useEditorState((s) => {
    // the element, or the class while a class is the target (style-target.ts)
    const node = styleSource(s);
    if (node === null) return '';
    const rules = layeredRules(s);
    // a structured value (a shadow's layers) is read as its layers and written as the CSS they make (J19: the Shadow
    // row said none while the element held a shadow)
    return properties
      .map((property) => {
        if (!rules.structures.has(property)) return storedValue(node, property, rules);
        const layers = storedLayers(node, property, rules);
        return layers.length === 0 ? undefined : shadowCss(layers, property, rules);
      })
      .filter((value): value is string => value !== undefined && value !== '')
      .join(', ');
  });
}

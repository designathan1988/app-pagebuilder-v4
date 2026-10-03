// The alignment matrix (INVENTORY.md, owners; spec props-flex-container): style.setAlignment writes where
// the children of a flex or grid container sit, as the cell a person pressed is drawn (x across: start, center, end;
// y down), through the composite alignment-matrix: its longhands, justify-content from x and align-items from y
// (flex-start, center, flex-end), one undo step. The direction is the couplings' (properties.json): a reversed axis
// mirrors its value, a column direction swaps the two (src/core/style/couplings.ts). Available on a flex or grid
// container only (flexOrGridContainer, properties.json valuePredicates); a locked element refuses it.
import { message, registerHandler, registerPredicate } from '../commands/registry.ts';
import { locate } from '../document/model.ts';
import { coupled, valuePredicateHolds } from './couplings.ts';
import { writeStyle } from './set.ts';
import { storedValue } from './stored.ts';

// the composite the matrix writes
const MATRIX = 'alignment-matrix';
// the value each end of the matrix stands for
const PLACE = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

export const flexOrGridContainer = registerPredicate('flexOrGridContainer', (state, rules) => {
  const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
  return primary !== null && valuePredicateHolds(primary.node, 'flexOrGridContainer', rules, state.document.classes);
});

export const setAlignmentCommand = registerHandler(
  'style.setAlignment',
  (context, { x, y }) => {
    const { state, rules } = context;
    const matrix = rules.compositeFacts.get(MATRIX);
    const [justify, align] = matrix?.longhands ?? [];
    if (justify === undefined || align === undefined) throw new Error('properties.json: the alignment matrix writes justify-content and align-items');
    const values = { [justify]: PLACE[x], [align]: PLACE[y] };
    const outcome = writeStyle(context, MATRIX, `${PLACE[x]} ${PLACE[y]}`, values);
    const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
    if (outcome.kind !== 'change' || primary === null) return outcome;
    // the status bar says what the primary element holds now, after the couplings
    const written = coupled(primary.node, primary.parent, values, MATRIX, rules);
    return { ...outcome, message: message('status.alignment.set', { name: primary.node.name, justify: written[justify] ?? '', align: written[align] ?? '' }) };
  },
  // the cell that stands for what the primary element holds is pressed (its values once the couplings ran)
  (state, args, rules) => {
    const primary = state.selection[0] === undefined ? null : locate(state.document, state.selection[0]);
    const matrix = rules?.compositeFacts.get(MATRIX);
    const [justify, align] = matrix?.longhands ?? [];
    const x = PLACE[args.x as keyof typeof PLACE] as string | undefined;
    const y = PLACE[args.y as keyof typeof PLACE] as string | undefined;
    if (primary === null || rules === undefined || justify === undefined || align === undefined || x === undefined || y === undefined) return false;
    const values = { [justify]: x, [align]: y };
    const written = coupled(primary.node, primary.parent, values, MATRIX, rules);
    return storedValue(primary.node, justify, rules) === written[justify] && storedValue(primary.node, align, rules) === written[align];
  },
);

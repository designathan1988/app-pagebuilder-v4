// The concept rows of the Style tab (plan item 2.D; jornada02 G-S1; spec inspector-panel, "Concept rows"): one row per
// concept — a border, a radius, an item's place in its parent, a filter — whose head is drawn always and whose details
// open in place under it. properties.json declares them (conceptRows): each names its head's and its details' items,
// a Style door ("<command>#<door>") or a pair row ("pair:<id>"); a row with no head draws a summary head, its label
// and what its details hold.
//
// inspector.toggleRow opens or closes one row's details. Like a section (sections.ts), a row nobody has touched opens
// by itself only when a detail holds a value its head does not show — a detail edits a property the element holds that
// no door of the head edits (a border's colour differing per side is still the border's; its sides' own rows are
// not) — and the user's own opening or closing wins, the same for every element, kept in the preferences. Toggling
// records nothing in the history and never touches the document.
import { registerHandler } from '../../core/commands/registry.ts';
import { manifest } from '../../manifest/runtime.ts';
import type { MessageId } from '../../generated/ids.ts';
import type { EditorUi } from '../state.ts';
import { authoredProperties, editedProperties, editedPropertiesByDoor } from './sections.ts';
import { registerReferenceKind } from '../../core/store/references.ts';

export interface ConceptRow {
  readonly id: string;
  readonly section: string;
  readonly labelKey: MessageId | null;
  readonly head: readonly string[];
  readonly details: readonly string[];
  readonly shortLabels: Readonly<Record<string, MessageId>>;
}

export const CONCEPT_ROWS: readonly ConceptRow[] = manifest.properties.conceptRows.map((r) => ({ ...r, labelKey: r.labelKey as MessageId | null, shortLabels: (r.shortLabels ?? {}) as Readonly<Record<string, MessageId>> }));
// the shorter name a detail takes under its row (properties.json shortLabels), or null
export const shortLabelOf = (item: string): MessageId | null => {
  const found = ROW_OF_ITEM(item);
  return found === null ? null : (found.row.shortLabels[item] ?? null);
};
const CONCEPT_ROW_IDS: readonly string[] = CONCEPT_ROWS.map((r) => r.id);
const ROW_OF = new Map<string, { readonly row: ConceptRow; readonly part: 'head' | 'details' }>();
for (const row of CONCEPT_ROWS) {
  for (const item of row.head) ROW_OF.set(item, { row, part: 'head' });
  for (const item of row.details) ROW_OF.set(item, { row, part: 'details' });
}

const ROW_OF_ITEM = (item: string) => ROW_OF.get(item) ?? null;
// the row an item of the panel stands in (a door ref, or "pair:<id>"), and whether in its head or its details
export const rowOfItem = (item: string): { readonly row: ConceptRow; readonly part: 'head' | 'details' } | null => ROW_OF.get(item) ?? null;
export const pairItem = (pairId: string): string => `pair:${pairId}`;

// the properties an item edits: a door's (its target's longhands), a pair row's two fields'
const PAIR_TARGETS = new Map(manifest.properties.rows.map((r) => [r.id, r.fields.map((f) => f.target)] as const));
const TARGET_OF_DOOR = new Map(
  manifest.doors.map((d) => {
    const door = d.door as { readonly property?: string | null; readonly composite?: string | null; readonly recipe?: string | null };
    return [d.ref as string, door.property ?? door.composite ?? door.recipe ?? null] as const;
  }),
);
// A recipe's own parameters (properties.json recipes: the declarations it takes a value for, Line clamp's
// -webkit-line-clamp): what a row reads it by. Its fixed declarations (display, overflow) are other rows' properties
// too, and a grid section's More text read "grid" from them (the user's review of 2026-10-05, LR2).
const RECIPE_PARAMETERS = new Map(manifest.properties.recipes.map((recipe) => [recipe.id, recipe.declarations.filter((d) => d.value === null).map((d) => d.property)] as const));

function itemProperties(item: string): readonly string[] {
  if (item.startsWith('pair:')) return (PAIR_TARGETS.get(item.slice('pair:'.length)) ?? []).flatMap((t) => editedProperties(t));
  const target = TARGET_OF_DOOR.get(item) ?? null;
  const parameters = target === null ? undefined : RECIPE_PARAMETERS.get(target);
  if (parameters !== undefined) return parameters;
  return [...(target === null ? [] : editedProperties(target)), ...(editedPropertiesByDoor(item) ?? [])];
}

// Whether a row's details hold a value its head does not show: a detail edits a property the element holds that no
// item of the head edits.
export function detailsHoldMore(row: ConceptRow, held: ReadonlySet<string>): boolean {
  const shown = new Set(row.head.flatMap(itemProperties));
  return row.details.some((item) => itemProperties(item).some((p) => held.has(p) && !shown.has(p)));
}

// the properties a row's details edit, which a summary head reads
export const detailProperties = (row: ConceptRow): readonly string[] => [...new Set(row.details.flatMap(itemProperties))];

const NONE: readonly string[] = [];
const collapsedRows = (ui: EditorUi): readonly string[] => ui.preferences.collapsedRows ?? NONE;
const openedRows = (ui: EditorUi): readonly string[] => ui.preferences.expandedRows ?? NONE;

// Whether a row is drawn closed: what the user said, else closed unless its details hold more than its head shows.
export function rowClosed(ui: EditorUi, row: ConceptRow, held: ReadonlySet<string>): boolean {
  if (collapsedRows(ui).includes(row.id)) return true;
  if (openedRows(ui).includes(row.id)) return false;
  return !detailsHoldMore(row, held);
}

export const toggleRow = registerHandler<'inspector.toggleRow', EditorUi>('inspector.toggleRow', ({ state }, { row }) => {
  // the disclosure of a row names it; anything else is a defect of the door
  const found = CONCEPT_ROWS.find((r) => r.id === row);
  if (found === undefined) throw new Error(`inspector.toggleRow: the Style tab has no concept row ${row}`);
  // the click does to a row what its chevron shows: opens a closed one, closes an open one, and the choice stays
  const closed = rowClosed(state.ui, found, authoredProperties(state));
  const drop = (list: readonly string[]) => list.filter((r) => r !== row);
  const add = (list: readonly string[]) => CONCEPT_ROW_IDS.filter((r) => r === row || list.includes(r));
  const { collapsedRows: wasClosed, expandedRows: wasOpen, ...rest } = state.ui.preferences;
  void wasClosed;
  void wasOpen;
  const collapsed = closed ? drop(collapsedRows(state.ui)) : add(collapsedRows(state.ui));
  const expanded = closed ? add(openedRows(state.ui)) : drop(openedRows(state.ui));
  return {
    kind: 'change',
    ui: { ...state.ui, preferences: { ...rest, collapsedRows: collapsed.length > 0 ? collapsed : undefined, expandedRows: expanded.length > 0 ? expanded : undefined } },
  };
});

// a concept row of the Style tab an argument names (manifest refers: concept-row)
registerReferenceKind('concept-row', (_document, row) => CONCEPT_ROW_IDS.includes(row));

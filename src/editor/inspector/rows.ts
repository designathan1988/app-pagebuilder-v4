// The Style tab's layout data (archive/DESIGN.md "Inspector"; spec inspector-advanced-mode): the pair rows — two
// properties or composites read together, drawn side by side under the first one's label — and the order of fields in a
// section.
//
// Both are declared in properties.json (its `rows` and a section's `groups`) and read here, never named in the panel:
// the panel asks this module which field shares its line, under which label and with which short prefix, and which
// group a field belongs to. Nothing here draws anything, and nothing here reads the document.
import type { MessageId } from '../../generated/ids.ts';
import { manifest } from '../../manifest/runtime.ts';

// one field of a pair row: the property or composite, and the short prefix its value carries (the height's H, the
// gap's axis marks); null when the value reads on its own
interface PairField {
  readonly target: string;
  readonly prefixKey: MessageId | null;
}

// a pair row: the two fields, in the order they are drawn, and the label the row carries — its own when the design
// names the concept both fields serve (the gap's two axes read "Gap"), else the first field's own
export interface PairRow {
  readonly id: string;
  readonly section: string;
  readonly labelKey: MessageId;
  readonly fields: readonly PairField[];
}

// the label of a property or composite of properties.json (its labelKey), or null for a name it does not hold
const LABELS = new Map<string, MessageId>([
  ...manifest.properties.properties.map((p) => [p.id, p.labelKey as MessageId] as const),
  ...manifest.properties.composites.map((c) => [c.id, c.labelKey as MessageId] as const),
]);

export const PAIR_ROWS: readonly PairRow[] = manifest.properties.rows.map((row) => {
  const first = LABELS.get(row.fields[0]?.target ?? '');
  if (first === undefined) throw new Error(`properties.json: the row ${row.id} names ${row.fields[0]?.target ?? ''}, which is no property or composite`);
  return {
    id: row.id,
    section: row.section,
    labelKey: (row.labelKey ?? first) as MessageId,
    fields: row.fields.map((field) => ({ target: field.target, prefixKey: (field.prefixKey ?? null) as MessageId | null })),
  };
});

// the row a target stands in, or null when it keeps a line of its own
export const pairRowOf = (target: string): PairRow | null => PAIR_ROWS.find((row) => row.fields.some((f) => f.target === target)) ?? null;
// the label and the prefix a row's field carries: the row's own label for the first field, and the field's prefix for
// any of them (a prefix marks the value whose property the row's label does not name)
export const rowPrefixKey = (row: PairRow, target: string): MessageId | null => row.fields.find((f) => f.target === target)?.prefixKey ?? null;

// ---------------------------------------------------------------- groups

// The groups order the fields; design/final does not draw extra headings between those fields.
const GROUPS = new Map<string, readonly { readonly id: string; readonly labelKey: MessageId }[]>(
  manifest.properties.sections.map((s) => [s.id, s.groups.map((g) => ({ id: g.id, labelKey: g.labelKey as MessageId }))] as const),
);

export const groupsOf = (section: string): readonly { readonly id: string; readonly labelKey: MessageId }[] => GROUPS.get(section) ?? [];


// the group a property, composite or recipe belongs to (properties.json), or null for a name it does not hold
const MEMBERS = new Map<string, string>([
  ...manifest.properties.properties.map((p) => [p.id, p.group] as const),
  ...manifest.properties.composites.map((c) => [c.id, c.group] as const),
  ...manifest.properties.recipes.map((r) => [r.id, r.group] as const),
]);

export const groupOf = (target: string): string | null => MEMBERS.get(target) ?? null;

// the group of an editor control (the alignment matrix, the spacing box, the custom declarations): the group of the
// first property, composite or recipe whose doors list it (properties.json)
const BY_DOOR = new Map<string, string>();
for (const entry of [...manifest.properties.properties, ...manifest.properties.composites, ...manifest.properties.recipes]) {
  for (const ref of entry.doors) if (!BY_DOOR.has(ref)) BY_DOOR.set(ref, entry.group);
}
export const groupOfDoor = (ref: string): string | null => BY_DOOR.get(ref) ?? null;

// The order a section draws its fields in (archive/DESIGN.md "Inspector"): its groups as the section declares them, and
// inside a group the order the manifest places the doors in. A control that edits no property name of its own takes
// the group of the field before it, so it stays where the manifest places it.
export function orderByGroup<T extends { readonly ref: string }>(section: string, entries: readonly T[]): readonly T[] {
  const groups = groupsOf(section);
  if (groups.length < 2) return entries;
  const index = new Map(groups.map((g, i) => [g.id, i] as const));
  let carried = 0;
  const placed = entries.map((entry, i) => {
    const target = (entry as { readonly target?: string }).target;
    const own = (target !== undefined ? groupOf(target) : null) ?? groupOfDoor(entry.ref);
    if (own !== null && index.has(own)) carried = index.get(own) as number;
    return { entry, i, group: carried };
  });
  return placed.sort((a, b) => (a.group === b.group ? a.i - b.i : a.group - b.group)).map((p) => p.entry);
}

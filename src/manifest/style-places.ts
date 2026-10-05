// Where a door of the Style tab is drawn (the audit's S-013 and S-023; plan item 2.C): the section of the property,
// composite or recipe its field edits; else the section properties.json's `controls` gives a control (the spacing
// link, the custom declarations, the anchor control), or none for a control drawn above the sections (the modes, Find
// a property); else the section of the entry of properties.json whose doors list it first (the grid's track editor,
// filed under grid-template-columns). One answer for the panel (src/editor/shell/inspector.tsx), the
// manifest's check (a Style door with no answer is refused) and the browser tests (tests/e2e/door.ts): a control is
// never drawn "in the section of the field before it" by an accident of the placement order.
//
// Pure: it reads the manifest's data it is handed, so the browser tests hand it the JSON they read themselves.

interface PlacedEntry {
  readonly id: string;
  readonly section: string;
  readonly doors: readonly string[];
}

export interface StylePlacesData {
  readonly properties: readonly PlacedEntry[];
  readonly composites: readonly PlacedEntry[];
  readonly recipes: readonly PlacedEntry[];
  readonly controls: readonly { readonly door: string; readonly section: string | null }[];
}

// what a door's field edits: its property, composite or recipe, else the property its arguments name (a part of a
// field: its unit menu, its reset)
export interface StyleDoor {
  readonly property?: string | null;
  readonly composite?: string | null;
  readonly recipe?: string | null;
  readonly args?: Readonly<Record<string, unknown>>;
}

// The section of each Style door: a section id, null for a control drawn above the sections, undefined for a door
// the manifest gives no place (manifest:check refuses it).
export function styleSections(data: StylePlacesData): (ref: string, door: StyleDoor) => string | null | undefined {
  const entries = [...data.properties, ...data.composites, ...data.recipes];
  const ofTarget = new Map(entries.map((e) => [e.id, e.section] as const));
  const listed = new Map<string, string>();
  for (const e of entries) for (const ref of e.doors) if (!listed.has(ref)) listed.set(ref, e.section);
  const controls = new Map(data.controls.map((c) => [c.door, c.section] as const));
  return (ref, door) => {
    const named = typeof door.args?.property === 'string' ? door.args.property : null;
    const target = door.property ?? door.composite ?? door.recipe ?? named;
    const own = target === null ? undefined : ofTarget.get(target);
    if (own !== undefined) return own;
    // a control given a section (the anchor control, which several entries list for the insets and sizes it writes,
    // the first of them a margin) takes it before the first entry that lists it
    if (controls.has(ref)) return controls.get(ref) ?? null;
    return listed.get(ref);
  };
}

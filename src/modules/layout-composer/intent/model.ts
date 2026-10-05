// The Layout Intent Graph (LIG): what the person means by a layout, not where boxes happen to sit. Freeform is an
// authoring mechanism, not the runtime layout model: this graph lives only while a container is composed (and as the
// container's inert provenance afterwards); the page itself is always the ordinary document the compiler writes
// (compiler/compile.ts → host/materialize.ts). Every coordinate here is in the composed container's own CSS pixels,
// from its top-left corner, so zoom, pan and the container's place on the page never change what the graph means.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box extends Point {
  readonly width: number;
  readonly height: number;
}

export type Axis = 'x' | 'y';

// How a region takes its size along one axis (spec "Modos de sizing"): a fixed length, a share of what its group
// holds (fluid, proportional), whatever is left (fill-available), or its content's own size (hug). The compiler
// decides the CSS; the inspector shows these words.
export type Sizing = 'fixed' | 'fluid' | 'fill-available' | 'hug' | 'proportional';
export const SIZINGS: readonly Sizing[] = ['fixed', 'fluid', 'fill-available', 'hug', 'proportional'];

// The structure a group of siblings compiles to when the person chose one (the Ambiguity Engine's confirmed
// interpretation); 'auto' lets the compiler's cost function decide.
export type LayoutStrategy = 'auto' | 'grid' | 'flex' | 'fixed' | 'proportional' | 'masonry';

export type Semantic = 'div' | 'section' | 'header' | 'footer' | 'aside' | 'main' | 'nav' | 'article';
export const SEMANTICS: readonly Semantic[] = ['div', 'section', 'header', 'footer', 'aside', 'main', 'nav', 'article'];

// A length the person typed, or the name of a layout variable that holds one ("cardGap"): changing the variable
// changes every place that names it (spec "Layout Variables").
export type LayoutValue = number | string;

export interface Dimension {
  readonly mode: Sizing;
  readonly min?: number;
  readonly max?: number;
  // a proportional region's share among its siblings; its drawn length when absent
  readonly weight?: number;
}

export type Alignment = 'start' | 'center' | 'end' | 'stretch';
export const ALIGNMENTS: readonly Alignment[] = ['start', 'center', 'end', 'stretch'];
export type Distribution = 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
export const DISTRIBUTIONS: readonly Distribution[] = ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'];

// What a region asks of its own children: the room inside its edges and how they sit. The space between them is a gap
// constraint over them (constraints/solve.ts), so it is one relation whether it was painted on the canvas or typed.
export interface RegionLayout {
  readonly padding?: LayoutValue;
  readonly alignment?: Alignment;
  readonly distribution?: Distribution;
}

export interface Region {
  readonly id: string;
  readonly parent: string | null;
  readonly name: string;
  readonly box: Box;
  readonly width: Dimension;
  readonly height: Dimension;
  readonly semantic: Semantic;
  // 'content': the region is an element the page already holds (a heading, an image, a form) placed by the layout;
  // it is never a wrapper, so it cannot hold regions, be split or be merged. Absent: a structural region.
  readonly kind?: 'content';
  // an arbitrary outline (spec "Shapes"), in the same coordinates as the box, which is then its bounds
  readonly polygon?: readonly Point[];
  readonly holes?: readonly (readonly Point[])[];
  readonly radius?: number;
  // the person asked for it to overlap its siblings: the compiler stacks it in one grid cell, never positions it
  readonly overlap?: true;
  // the gesture operations it came from, oldest first (spec "Structural Provenance")
  readonly provenance: readonly string[];
  readonly layout?: RegionLayout;
  // the person gave it its name or its meaning: the layout never infers one for it (intent/meaning.ts)
  readonly chosen?: true;
}

export type Constraint =
  | { readonly id: string; readonly kind: 'equal-size'; readonly axis: Axis; readonly regions: readonly string[] }
  | { readonly id: string; readonly kind: 'gap'; readonly axis: Axis; readonly regions: readonly string[]; readonly value: LayoutValue }
  | { readonly id: string; readonly kind: 'ratio'; readonly regions: readonly string[]; readonly value: number }
  | { readonly id: string; readonly kind: 'align'; readonly axis: Axis; readonly regions: readonly string[]; readonly edge: 'start' | 'center' | 'end' }
  | { readonly id: string; readonly kind: 'size'; readonly axis: Axis; readonly regions: readonly string[]; readonly dimension: Dimension; readonly value?: LayoutValue };

// What changes at and below a width (spec "Responsive Continuum"): a behaviour recorded where the person changed it,
// compiled to the project breakpoint that holds that width. Absent fields keep the wider layout's choice.
export interface ResponsiveRule {
  readonly id: string;
  readonly maxWidth: number;
  // the columns the top-level regions flow in (1: stacked); absent keeps their structure
  readonly columns?: number;
  // the top-level regions that take a whole row while the others flow in those columns (a header over cards)
  readonly wide?: readonly string[];
  readonly gap?: number;
  readonly hidden: readonly string[];
  readonly order?: readonly string[];
  readonly sizes?: Readonly<Record<string, { readonly width?: number; readonly mode?: Sizing }>>;
  // the columns of a nested group, by its preference key (preferenceKey below)
  readonly groups?: Readonly<Record<string, { readonly columns: number; readonly gap?: number; readonly wide?: readonly string[] }>>;
  // the groups the person keeps as drawn here (by preference key): no automatic reflow applies to them at this width
  readonly kept?: readonly string[];
}

export type MorphProperty = 'gap' | 'padding' | 'width' | 'height';

// A value that changes continuously with the width (spec "Responsive Morphing": sidebar 280 → 220, gap 32 → 16): the
// compiler writes clamp() between each pair of control points.
export interface Morph {
  readonly id: string;
  readonly region: string | null;
  readonly property: MorphProperty;
  readonly points: readonly { readonly width: number; readonly value: number }[];
}

// An image under the composition to trace a design from (spec, bet F); a project file, never stored here.
export interface ReferenceImage {
  readonly file: string;
  readonly box: Box;
  readonly opacity: number;
  readonly locked: boolean;
}

export interface LayoutIntent {
  readonly version: 1;
  // the composed container's own box at authoring time: the width the drawing was made at
  readonly viewport: Box;
  readonly regions: readonly Region[];
  readonly constraints: readonly Constraint[];
  readonly responsive: readonly ResponsiveRule[];
  readonly variables: Readonly<Record<string, number>>;
  readonly preferences?: Readonly<Record<string, LayoutStrategy>>;
  readonly morphs?: readonly Morph[];
  readonly reference?: ReferenceImage;
  // how many operations the graph has taken: the deterministic source of operation ids, so the same gestures on the
  // same graph always produce the same graph (undo, redo, a scenario replayed)
  readonly revision: number;
}

// The key a group's preference and responsive columns are stored under: the composition's top level, or the region
// that holds the group. A region named "root" can never collide with the top level.
export const ROOT_KEY = '$root';
export const preferenceKey = (parent: string | null): string => (parent === null ? ROOT_KEY : `region:${parent}`);

export const emptyIntent = (width: number, height: number): LayoutIntent => ({
  version: 1,
  viewport: { x: 0, y: 0, width, height },
  regions: [],
  constraints: [],
  responsive: [],
  variables: {},
  revision: 0,
});

// A new structural region: fluid across, and down at least as tall as it was drawn while growing with its content, as
// an ordinary section of a page does (an empty region keeps the space the person gave it).
export const region = (id: string, box: Box, name: string = id): Region => ({
  id,
  parent: null,
  name,
  box,
  width: { mode: 'fluid' },
  height: { mode: 'fluid' },
  semantic: 'div',
  provenance: [],
});

export function findRegion(graph: LayoutIntent, id: string): Region | undefined {
  return graph.regions.find((r) => r.id === id);
}

export function childrenOf(graph: LayoutIntent, parent: string | null): Region[] {
  return graph.regions.filter((r) => r.parent === parent);
}

// The region and every region inside it, at any depth.
export function descendants(graph: LayoutIntent, ids: readonly string[]): Set<string> {
  const all = new Set(ids);
  let added = true;
  while (added) {
    added = false;
    for (const r of graph.regions)
      if (r.parent !== null && all.has(r.parent) && !all.has(r.id)) {
        all.add(r.id);
        added = true;
      }
  }
  return all;
}

// How deep a region sits: 0 for a top-level region.
export function depthOf(graph: LayoutIntent, id: string): number {
  let depth = 0;
  const seen = new Set<string>();
  for (let at = findRegion(graph, id)?.parent ?? null; at !== null && !seen.has(at); at = findRegion(graph, at)?.parent ?? null) {
    seen.add(at);
    depth += 1;
  }
  return depth;
}

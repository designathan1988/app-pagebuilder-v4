// The document JSON: the source of truth of a project. Plain data, never the DOM. Its vocabulary comes from the
// manifest through the generated ids: element types (elements.json), attributes, edited properties, breakpoints
// and states (properties.json). src/core/document/validate.ts checks a whole document against it on every commit.
import type { NodeId } from '../../generated/commands.ts';
import type { AttributeId, BreakpointId, ElementType, PropertyId, StateId } from '../../generated/ids.ts';
import type { IdGenerator } from '../ports/ids.ts';
import type { InlineRun } from '../text/inline.ts';
import type { Bound, Collection, DataItem, DataList, SharedRegion } from '../data/model.ts';
import type { Behaviour, MotionInteraction, MotionTimeline } from '../motion/model.ts';
import type { Authoring } from './authoring.ts';
import type { ProjectBreakpoint } from './breakpoint-rules.ts';

export type { NodeId };

// The version of the saved format; it is carried from the first save (autosave-restore).
export const DOCUMENT_VERSION = 1;

// One layer of a structured value (a shadow): its typed fields, by the ids of its structure (properties.json
// structures: a length or a colour as CSS text, a flag as a boolean).
export type StructuredLayer = { readonly [field: string]: string | boolean };
// What a node stores for a property: its CSS text, or the layers of a structured value (first painted on top), which
// only the output turns into CSS (a hidden layer stays in the document, out of the CSS).
export type StoredValue = string | readonly StructuredLayer[];
// property → what it stores
export type Declarations = { readonly [P in PropertyId]?: StoredValue };
// breakpoint → state → declarations: a value belongs to one breakpoint and one state
export type Styles = { readonly [B in BreakpointId]?: { readonly [S in StateId]?: Declarations } };
export type AttributeValue = string | number | boolean;

export interface DocNode {
  readonly id: NodeId;
  readonly type: ElementType;
  // the name the user sees in Layers and the export derives BEM classes from
  readonly name: string;
  // the element's tag, or one of its alternative tags; null only for an element that writes verbatim markup
  readonly tag: string | null;
  readonly attributes: { readonly [A in AttributeId]?: AttributeValue };
  readonly classes: readonly string[];
  readonly styles: Styles;
  // the text of a text element or the markup of a markup element; null for the others
  readonly text: string | null;
  // the marks of a text element's text (bold, italic, links; src/core/text/inline.ts): its canonical tree of runs,
  // whose plain text is `text`; absent while nothing in the text is marked (spec text-inline-formatting)
  readonly inline?: readonly InlineRun[];
  readonly children: readonly DocNode[];
  // hidden on the canvas with its whole subtree, still in the document and in Layers (element.toggleHidden, spec
  // hide-element): true, absent while the element shows. A page's root is never hidden.
  readonly hidden?: true;
  // locked with its whole subtree (element.toggleLock, spec lock-element): no command moves, deletes or edits it or
  // anything inside it, adds to it, or toggles a flag inside it; it can still be selected. True, absent while it is
  // unlocked. A page's root is never locked.
  readonly locked?: true;
  // the person's own attributes (feature element-attributes-aria: aria-*, data-*, role…), name → value, written as
  // they are; absent while there are none. Never an event handler (on…) nor an attribute of the editor's own.
  readonly customAttributes?: { readonly [name: string]: string };
  // the root of an instance of a component names its component (core/design/components.ts, spec reusable-components);
  // absent on any other element
  readonly component?: string;
  // every element of an instance: the place of the definition element it comes from, the child indexes from the
  // definition's root ([] for the root); absent on any other element
  readonly componentPart?: readonly number[];
  // a page's root only: the page's manual guides (core/page/guides.ts, spec guides-manual), each named by its axis and
  // a number, at a page px position, locked or not; absent while the page has none. Never exported.
  readonly guides?: readonly Guide[];
  // a page's root only: the settings of its layout grids set in Guides & Grids (core/page/grid.ts, spec
  // workspace-settings-dialog), each grid's settings a person set; a setting absent takes its default of
  // interactions.json; absent while none is set. Never exported.
  readonly grid?: GridSettings;
  // a page's root only: the label colour of the page's elements (core/nodes/flags.ts, spec layers-row-colours), by
  // the element's id; a Layers row is tinted with it and the canvas draws the element's selection in it; absent
  // while none is set. Never exported.
  readonly layerColors?: readonly LayerColor[];

  // what the element shows of an item of a collection (core/data/bindings.ts, spec content-data): a field and the part
  // it fills (the text, an image's source or alternative text, a link's address); absent while it shows none
  readonly bind?: readonly Bound[];
  // the element whose children repeat the items of a collection (core/data/materialize.ts): the collection, the
  // component of the repeated items and the query; absent on any other element
  readonly dataList?: DataList;
  // a page's root only: the item of a collection the page was made for (core/data/commands.ts pages.fromCollection);
  // absent on any other page
  readonly dataItem?: DataItem;
  // the animations of the element (core/animation/animation.ts, group 18), in the order they were made; absent while it
  // has none
  readonly animations?: readonly Animation[];
  // the interactions of the element (core/events/interactions.ts, group 18), in the order they were made; absent while
  // it has none. The editing canvas never runs them; the preview and the exported page do.
  readonly interactions?: readonly Interaction[];
  // the element's motion interactions (core/motion, spec motion-interactions): each a trigger playing a timeline of the
  // project by name, in the order they were made; absent while it has none
  readonly motions?: readonly MotionInteraction[];
  // the element's behaviours that run from the motion script (spec motion-behaviours); absent while it has none
  readonly behaviours?: readonly Behaviour[];
  // the authoring data of removable modules (core/document/authoring.ts): a tool's record by its namespace, inert for
  // everything else (never rendered, exported or shown); absent while no module keeps anything on the element
  readonly authoring?: Authoring;
}

export interface LayerColor {
  readonly node: NodeId;
  readonly colour: string;
}

// One keyframe of an animation (core/animation/animation.ts): its offset in percent of the animation's duration, the
// easing that leads into it ('' while it takes the animation's own timing function), and what the element holds there —
// the same declarations a style layer holds (a property's CSS text, or the typed layers of a structured value).
export interface Keyframe {
  readonly offset: number;
  readonly easing: string;
  readonly declarations: Declarations;
}

// An animation of an element: its @keyframes name, unique in the document (the name the export writes and an
// interaction's play-animation action names), one CSS text per setting (the settings are the manifest's own list —
// animation.setSettings' `setting` enum — each writing the CSS property its door offers), and its keyframes in offset
// order.
export interface Animation {
  readonly name: string;
  readonly settings: { readonly [setting: string]: string };
  readonly keyframes: readonly Keyframe[];
}

// One interaction of an element (core/events/interactions.ts): the event that fires it, the action it runs, the element
// an action that needs one acts on (show, hide, toggle-class, scroll-to, play-animation), and what the action needs of
// it: the class it toggles, the animation it plays, the address it opens and whether that address opens in a new tab.
// `scope` names one of the element's classes the interaction applies to every element of instead ("every element with
// .btn"): absent while it applies to the element itself.
export interface Interaction {
  readonly trigger: string;
  readonly action: string;
  readonly target?: NodeId;
  readonly className?: string;
  readonly animation?: string;
  readonly address?: string;
  readonly newTab?: true;
  readonly scope?: string;
  // whether it fires only the first time (the canonical card's Options); absent, its trigger's own way: entering the
  // screen and the page's load fire once, a click, a hover and a submit every time
  readonly once?: boolean;
  // the milliseconds between the trigger and the action; absent for none
  readonly delay?: number;
}

export interface GridSettings {
  readonly columns?: { readonly count?: number; readonly width?: number; readonly gutter?: number; readonly margin?: number };
  readonly rows?: { readonly height?: number; readonly gutter?: number };
  readonly dots?: { readonly spacing?: number };
}

export interface Guide {
  readonly id: string;
  readonly axis: 'horizontal' | 'vertical';
  readonly at: number;
  readonly locked?: true;
}

export interface Page {
  readonly id: string;
  readonly name: string;
  // the page's file in the project tree ("index.html", "about/index.html")
  readonly file: string;
  readonly tree: DocNode;
}

export interface DocumentJson {
  // the project's own breakpoints, widest first (core/document/breakpoints.ts, spec project-breakpoints); absent while
  // the project uses the default table of properties.json
  readonly breakpoints?: readonly ProjectBreakpoint[];
  readonly language?: string;
  readonly codeLanguage?: string;
  readonly version: typeof DOCUMENT_VERSION;
  readonly pages: readonly Page[];
  // the colours saved with the project, in the order they were saved (core/design/colors.ts); absent while none is
  readonly swatches?: readonly string[];
  // the project's design tokens, CSS variables named var(--name) in styles (core/design/tokens.ts); absent while none
  // is
  readonly tokens?: readonly { readonly name: string; readonly kind: string; readonly value: string }[];
  // the project's style classes, in the order they were made: a name an element lists in its classes and the styles
  // every element with it takes (core/design/classes.ts); absent while none is
  readonly classes?: readonly StyleClass[];
  // the project's components, in the order they were made: a unique name and its definition, a tree of elements whose
  // instances are placed in pages (core/design/components.ts); absent while none is
  readonly components?: readonly ComponentDefinition[];
  // the project's uploaded files, at their path in the project (core/project/files.ts; spec explorer-assets); absent
  // while none is
  readonly files?: readonly ProjectFile[];
  // The project's folders, at their path in the tree ('js', 'img/icons'), in the order they were made: a folder is
  // stored, not implied, so an empty one exists. The folder of a path is every folder it stands under
  // (core/files/tree.ts folds the stored ones and the ones a path implies into the tree). Absent while the project
  // holds no folder.
  readonly folders?: readonly string[];
  // The project's motion timelines (core/motion, spec motion-timeline): named, reusable timelines of actions that the
  // elements' interactions play by name. Absent while the project holds none.
  readonly motionTimelines?: readonly MotionTimeline[];
  // the project's collections, in the order they were made: typed fields and items, which bound lists and item pages
  // show (core/data/collections.ts, spec content-data); absent while none is
  readonly collections?: readonly Collection[];
}

// An uploaded file (spec explorer-assets): its bytes as base64 at its path in the project ("img/logo.png"), the MIME
// type the upload declared, and, for an image, the intrinsic size read at the upload (spec explorer-assets-use).
export interface ProjectFile {
  readonly path: string;
  readonly type: string;
  readonly bytes: string;
  readonly width?: number;
  readonly height?: number;
}

// the project's files, in the tree's order
export function filesOf(document: DocumentJson): readonly ProjectFile[] {
  return document.files ?? [];
}

export interface ComponentDefinition {
  readonly name: string;
  readonly tree: DocNode;
  // a shared region (core/data/regions.ts, spec shared-regions): its instances hold the same content on every page,
  // and the pages made later receive it when it says so; absent on any other component
  readonly shared?: SharedRegion;
}

export interface StyleClass {
  readonly name: string;
  readonly styles: Styles;
}

// The selected nodes, the primary first. Empty when nothing is selected.
export type Selection = readonly NodeId[];

export interface EmptyProjectNames {
  readonly language?: string;
  // the home page's name and its root element's name, in the UI language of the person who creates it
  readonly page: string;
  readonly root: string;
}

// A project with one empty home page, index.html, whose root is the root element the manifest gives (validate.ts
// ModelRules.root: the element whose tag is <body>).
export function createEmptyDocument(ids: IdGenerator, names: EmptyProjectNames, root: { readonly type: ElementType; readonly tag: string }): DocumentJson {
  return {
    version: DOCUMENT_VERSION,
    language: names.language ?? 'en',
    codeLanguage: 'en',
    pages: [
      {
        id: ids.next(),
        name: names.page,
        file: 'index.html',
        tree: { id: ids.next(), type: root.type, name: names.root, tag: root.tag, attributes: {}, classes: [], styles: {}, text: null, children: [] },
      },
    ],
  };
}

// Whether a document is the empty project, whatever its names and ids: one page whose root holds no element and
// carries no attribute, class or style. Replacing it loses nothing (File › Open asks no confirmation over it).
export function isEmptyProject(doc: DocumentJson): boolean {
  const [page, ...others] = doc.pages;
  if (page === undefined || others.length > 0) return false;
  const root = page.tree;
  return root.children.length === 0 && Object.keys(root.attributes).length === 0 && root.classes.length === 0 && Object.keys(root.styles).length === 0;
}

// Every node of a tree, the root first, in document order.
export function* walk(node: DocNode): Generator<DocNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

// Every node of every page.
export function* allNodes(doc: DocumentJson): Generator<DocNode> {
  for (const page of doc.pages) yield* walk(page.tree);
}

// Where a node sits: its page, its parent (null for a page root), its index among the parent's children, and
// the JSON path of the node inside the document (for patches).
export interface Location {
  readonly node: DocNode;
  readonly page: number;
  readonly parent: DocNode | null;
  readonly index: number;
  readonly path: readonly (string | number)[];
}

export function locate(doc: DocumentJson, id: NodeId): Location | null {
  for (const [page, p] of doc.pages.entries()) {
    const found = indexOf(p.tree, page).get(id);
    if (found !== undefined) return found;
  }
  return null;
}

// Every node of a page's tree by its id, built once per tree (the plan's stage 4: locate walked the tree, building a
// path for every node it passed, many times per change). A tree is never changed in place — a change makes a new root
// (applyPatches) — so its index stays true for as long as the tree lives; a tree read at another page's place is
// indexed again. The first node of an id wins, as the walk found it.
const INDEX = new WeakMap<DocNode, { readonly page: number; readonly at: ReadonlyMap<string, Location> }>();
function indexOf(tree: DocNode, page: number): ReadonlyMap<string, Location> {
  const held = INDEX.get(tree);
  if (held !== undefined && held.page === page) return held.at;
  const at = new Map<string, Location>();
  const visit = (node: DocNode, parent: DocNode | null, index: number, path: readonly (string | number)[]) => {
    if (!at.has(node.id)) at.set(node.id, { node, page, parent, index, path });
    node.children.forEach((child, i) => visit(child, node, i, [...path, 'children', i]));
  };
  visit(tree, null, 0, ['pages', page, 'tree']);
  INDEX.set(tree, { page, at });
  return at;
}

// The node and every ancestor of it, the page root first; empty when the document has no such node.
export function lineage(doc: DocumentJson, id: NodeId): DocNode[] {
  const chain: DocNode[] = [];
  for (let at = locate(doc, id); at !== null; at = at.parent === null ? null : locate(doc, at.parent.id)) chain.unshift(at.node);
  return chain;
}


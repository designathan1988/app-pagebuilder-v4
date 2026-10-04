// The Layout Composer's commands (manifest/commands/layout-composer.json; spec layout-composer). Each change of the
// layout is one command and one undo step: the stroke is read again here by the same reader the canvas previewed it
// with (gestures/recognize.ts readStroke), so what is committed is what the person saw; the new intent is compiled and
// written into the container at once (host/materialize.ts), so the page is always the ordinary structure the layout
// means — there is no separate "apply" that could leave the two apart.
import { activeBreakpoint, BASE_BREAKPOINT, breakpointWords, firstLockRefusal, hidePanel, imageFiles, isPanelOpen, leavingNames, locate, manifest, message, nodeMaker, numberConstant, pageShown, registerHandler, registerPredicate, releaseReferencesPatch, showPanel, tracksToValue, walk, withoutReferencesTo, zoomOf } from '../../../editor/host.ts';
import type { DocNode, EditorUi, HandlerContext, Message, MessageId, NodeId, Outcome, Shown } from '../../../editor/host.ts';
import { propertyVocabulary } from '../adapters/properties.ts';
import { compile, type CompilerPorts } from '../compiler/compile.ts';
import { execute, type Naming, type Operation, type RegionValues } from '../gestures/operations.ts';
import { handleOf, readPlace, readStroke, type PlaceEdges, type StrokeMode } from '../gestures/recognize.ts';
import { acceptSuggestion, nextSelection, paintConstraint, type SelectionMode } from '../gestures/structural.ts';
import { suggestions, type Suggestion } from '../intent/analysis.ts';
import { builtInTemplate, placeTemplate, type BuiltInTemplate } from '../intent/templates.ts';
import { traceBlocks, traceRegions, type Luminance } from '../adapters/reference.ts';
import { nextRegionId } from '../intent/ids.ts';
import { ALIGNMENTS, DISTRIBUTIONS, SEMANTICS, SIZINGS, childrenOf, emptyIntent, findRegion, region as newRegion, type LayoutIntent, type LayoutStrategy, type Point, type Region } from '../intent/model.ts';
import { LayoutRefusal, problemKey, type LayoutProblem } from '../intent/problems.ts';
import { adaptationFor, mapBreakpoints, responsiveEdit, withAdaptation, type ResponsiveEdit } from '../responsive/continuum.ts';
import { validateIntent } from '../topology/topology.ts';
import { inferMeaning } from '../intent/meaning.ts';
import { HEIGHT, WIDTH } from '../geometry/keys.ts';
import { materialize } from './materialize.ts';
import { NAMESPACE, markerOf, recordOf, withAuthoring, type ContainerRecord } from './record.ts';
import { composerOf, withComposer, type ComposerState } from './state.ts';

// the sidebar view the tool's options are drawn in while it is the canvas tool, and the one it gives back
const PANEL = 'layout-composer';
const BACK = 'explorer';
// the section the tool folds while it is on, for its panel to take the column
const LAYERS = 'layers';

type Context = HandlerContext<EditorUi>;

// how near an edge or a handle a press counts as on it, in screen px (interactions.json layout.hitRadius)
const HIT_RADIUS = numberConstant('layout.hitRadius');
// the height an empty container is composed in (interactions.json layout.emptyHeight)
const EMPTY_HEIGHT = numberConstant('layout.emptyHeight');
// how strongly a reference image shows under the regions when it is chosen (interactions.json layout.referenceOpacity)
const REFERENCE_OPACITY = numberConstant('layout.referenceOpacity');

const COMPILER: CompilerPorts = {
  tracks: tracksToValue,
  properties: propertyVocabulary([...manifest.properties.properties, ...manifest.properties.composites]),
};

// the element type new regions are made of: the container that can carry every meaning a region takes
const REGION_TYPE = 'div';

// A problem of the engine said through the catalogue (layout.problem.<code>), its values as they are.
const said = (problem: LayoutProblem): Message => message(problemKey(problem) as MessageId, problem.params);
const refusedWith = (problems: readonly LayoutProblem[]): Outcome<EditorUi> => ({ kind: 'refused', message: problems[0] === undefined ? message('layout.refused') : said(problems[0]) });

// Whether a container is being composed: the predicate of every command but layout.enter.
export const layoutComposing = registerPredicate<EditorUi>(
  'layoutComposing',
  (state) => composerOf(state.ui) !== null,
  () => message('layout.inactive'),
);

// New regions are named in the person's language: "Region 3", "Header 2" (a split's second part).
// The canvas previews a stroke with the same naming, through the editor's own words (interaction/tool.ts).
// A part of a region named by its number alone ("Region 2") is a region of its own number ("Region 3"), not "Region 2
// 2"; a part of a region the person named keeps the name with the part's number ("Header 2").
// Whether a name is still a region's number ("Region 3"), in the person's language.
export const numberedWith = (words: (key: MessageId, params: Readonly<Record<string, number>>) => string): ((name: string) => boolean) => {
  const [before = '', after = ''] = words('layout.label.region' as MessageId, { n: 0 }).split('0');
  return (name) => name.startsWith(before) && name.endsWith(after) && /^\d+$/.test(name.slice(before.length, name.length - after.length));
};

export const namingWith = (words: (key: MessageId, params: Readonly<Record<string, number>>) => string): Naming => {
  const generic = (n: number) => words('layout.label.region' as MessageId, { n });
  const numbered = numberedWith(words);
  return { named: (base, n) => (base === null || numbered(base) ? generic(n) : `${base} ${n}`) };
};
const naming = (context: Context): Naming => namingWith(context.words);

// The container being composed, and its record.
function composed(context: Context): { readonly state: ComposerState; readonly container: DocNode; readonly path: readonly (string | number)[]; readonly record: ContainerRecord } {
  const state = composerOf(context.state.ui);
  if (state === null) throw new LayoutRefusal('container');
  const at = locate(context.state.document, state.target);
  if (at === null) throw new LayoutRefusal('container');
  const record = recordOf(at.node);
  if (record === null) throw new LayoutRefusal('container');
  return { state, container: at.node, path: at.path, record: { ...record, intent: namesFromElements(at.node, record.intent) } };
}

// A region the composer made is the element the Layers name: a name given there since (a rename) is the region's
// name too, so the next change keeps it rather than writing the region's old name back.
function namesFromElements(container: DocNode, intent: LayoutIntent): LayoutIntent {
  const names = new Map<string, string>();
  const visit = (node: DocNode) => {
    for (const child of node.children) {
      const marker = markerOf(child);
      if (marker?.kind !== 'structural') continue;
      names.set(marker.key, child.name);
      visit(child);
    }
  };
  visit(container);
  if (!intent.regions.some((r) => names.has(r.id) && names.get(r.id) !== r.name)) return intent;
  return { ...intent, regions: intent.regions.map((r) => (names.has(r.id) && names.get(r.id) !== r.name ? { ...r, name: names.get(r.id) as string } : r)) };
}

// The project's breakpoints as the composer maps its rules to them.
const projectBreakpoints = () => manifest.properties.breakpoints.map((b) => ({ id: b.id, maxWidth: b.width, base: b.base }));

// The intent as the page lays it out: what the person chose, with the automatic reflow at narrower screens wherever
// they chose nothing (responsive/continuum.ts withAdaptation). The compiler writes it and the widths check measures it.
export const laidOut = (graph: LayoutIntent): LayoutIntent => withAdaptation(graph, adaptationFor(projectBreakpoints()));

// The regions whose element holds something the person put inside it (an element the composer did not write): their
// content sets their height (compiler/compile.ts filled).
function filledRegions(container: DocNode): Set<string> {
  const filled = new Set<string>();
  const visit = (node: DocNode) => {
    for (const child of node.children) {
      const marker = markerOf(child);
      if (marker?.kind !== 'structural') continue;
      if (child.children.some((inner) => markerOf(inner) === null)) filled.add(marker.key);
      visit(child);
    }
  };
  visit(container);
  return filled;
}

// The intent's changed graph written into the container: compiled and materialized in this one command. A fresh
// compilation keeps nothing of the structure the page holds (a new arrangement chosen), so no wrapper of the old one
// stays behind.
function written(context: Context, graph: LayoutIntent, selection: readonly string[], fresh = false): Outcome<EditorUi> {
  const { state, container, path, record } = composed(context);
  const built = structured(context, container, record, graph, fresh);
  const kept = selection.filter((id) => findRegion(graph, id) !== undefined);
  // the elements the composed container no longer holds leave, and whatever pointed at them lets go of them in the same
  // undo step, as a delete releases it (the audit's RF1: deleting a region a link pointed into was refused)
  // a locked element inside the container keeps what it holds and where it stands (spec lock-element; the audit's LK1:
  // the composer asked about the container alone)
  const now = new Map([...walk(built)].map((inner) => [inner.id, JSON.stringify(inner)] as const));
  const lockedInside = [...walk(container)].find((inner) => inner.locked === true && now.get(inner.id) !== JSON.stringify(inner));
  if (lockedInside !== undefined) return { kind: 'refused', message: firstLockRefusal(context.state.document, [lockedInside.id as NodeId], 'status.locked.edit') ?? message('status.locked.edit', { name: lockedInside.name }) };
  const staying = new Set([...walk(built)].map((inner) => inner.id));
  const leaving = new Set([...walk(container)].map((inner) => inner.id as NodeId).filter((id) => !staying.has(id)));
  const names = leavingNames(context.state.document, leaving);
  const next = leaving.size === 0 ? built : withoutReferencesTo(built, names);
  const released = leaving.size === 0 ? [] : releaseReferencesPatch(context.state.document, leaving, names).filter((patch) => !path.every((key, i) => patch.path[i] === key));
  return {
    kind: 'change',
    patches: [...released, { op: 'replace', path: [...path], value: next }],
    ui: withComposer(context.state.ui, { ...state, selection: kept }),
    message: message('layout.status.changed'),
  };
}

// The container with the structure the intent compiles to written into it.
function structured(context: Context, container: DocNode, record: ContainerRecord, drawn: LayoutIntent, fresh: boolean): DocNode {
  const graph = withRoom(drawn);
  const keys = new Set<string>();
  const visit = (node: DocNode) => {
    for (const child of node.children) {
      const marker = markerOf(child);
      if (marker !== null) keys.add(marker.key);
      visit(child);
    }
  };
  visit(container);
  const shown = laidOut(graph);
  const compiled = compile(shown, COMPILER, { previous: fresh ? new Set() : keys, filled: filledRegions(container) });
  // the container keeps what the person chose; the automatic reflow is derived again every time
  const compilation = { ...compiled, intent: { ...compiled.intent, responsive: graph.responsive } };
  const breakpoints = mapBreakpoints(shown, projectBreakpoints());
  const make = nodeMaker(context.state.document, context.rules, context.ids, context.words);
  return materialize(context, withAuthoring(container, { ...record, intent: graph }), compilation, { make, regionType: REGION_TYPE, breakpoints });
}

// A region placed past the bottom of the drawing (a footer dragged down with the Select tool) makes the drawing taller:
// the container grows to hold it, keeping below its last region the room the drawing keeps above its first.
function withRoom(graph: LayoutIntent): LayoutIntent {
  const top = graph.regions.filter((r) => r.parent === null);
  if (top.length === 0) return graph;
  const bottom = Math.max(...top.map((r) => r.box.y + r.box.height));
  if (bottom <= graph.viewport.height) return graph;
  const above = Math.min(...top.map((r) => r.box.y));
  return { ...graph, viewport: { ...graph.viewport, height: Math.round(bottom + above) } };
}

// The regions where the page lays them out at the width the canvas shows, in the container's own px: the view a
// stroke at a narrower width is read on. A region the page does not draw there (hidden) stays where it was drawn.
function laidOutAt(context: Context, container: DocNode, intent: LayoutIntent): LayoutIntent | null {
  const origin = context.layout.box(container.id);
  if (origin === null) return null;
  const elements = new Map<string, DocNode>();
  const visit = (node: DocNode) => {
    for (const child of node.children) {
      const marker = markerOf(child);
      if (marker === null) continue;
      if (!elements.has(marker.key)) elements.set(marker.key, child);
      if (marker.kind === 'structural') visit(child);
    }
  };
  visit(container);
  const regions = intent.regions.map((r) => {
    const element = elements.get(r.id);
    const b = element === undefined ? null : context.layout.box(element.id);
    return b === null || !(b.width > 0) ? r : { ...r, box: { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height } };
  });
  return { ...intent, viewport: { x: 0, y: 0, width: origin.width, height: Math.max(origin.height, intent.viewport.height) }, regions };
}

// the sizes a person can declare on an element that the layout owns once it is a region (the Select tool's handles
// write them): read back as the region's box, then taken off for the layout to write them its own way
const SIZE_ROLES = [WIDTH, HEIGHT, 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'];

// A region's element without the sizes the person declared on it at the base layer (the Select tool's handles write
// them), which the layout owns once the element is a region; null when it declares none.
function withoutDeclaredSizes(context: Context, node: DocNode): DocNode | null {
  const properties = SIZE_ROLES.map((role) => COMPILER.properties[role]).filter((id): id is string => id !== undefined);
  const { breakpoint: base, state: baseState } = context.rules.baseLayer;
  const owned = new Set(markerOf(node)?.owns?.[base] ?? []);
  const layer = (node.styles as Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>)[base]?.[baseState] ?? {};
  const declared = properties.filter((property) => layer[property] !== undefined && !owned.has(property));
  if (declared.length === 0) return null;
  // the layer without them; a state or a breakpoint left with nothing is no layer at all
  const kept = Object.fromEntries(Object.entries(layer).filter(([property]) => !declared.includes(property)));
  const all = node.styles as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  const states = Object.fromEntries(Object.entries({ ...all[base], [baseState]: kept }).filter(([, value]) => Object.keys(value as object).length > 0));
  const styles = Object.fromEntries(Object.entries({ ...all, [base]: states }).filter(([, value]) => Object.keys(value).length > 0));
  return { ...node, styles: styles as unknown as DocNode['styles'] };
}

// Every region's element of a container without the sizes the person declared on it.
function releasedSizes(context: Context, container: DocNode): DocNode {
  const visit = (node: DocNode): DocNode => {
    const own = markerOf(node) === null ? node : (withoutDeclaredSizes(context, node) ?? node);
    const children = own.children.map(visit);
    return children.every((c, i) => c === own.children[i]) ? own : { ...own, children };
  };
  return { ...container, children: container.children.map(visit) };
}

// What the page holds now, read back into the intent when the tool comes on again: between two compositions the page
// changes by other means (the Select tool, the Layers, the inspector). A region whose element is gone goes, with what
// it holds; an element moved into another region's element takes that region as its parent; at the drawing's width,
// an element the page lays out elsewhere or at another size takes that box, and the sizes the person declared on it are
// taken back by the layout. A reading the layout cannot hold (regions that would overlap) keeps the intent as it was,
// but for the regions that are gone.
function readBack(context: Context, container: DocNode, intent: LayoutIntent): { readonly intent: LayoutIntent; readonly container: DocNode; readonly changed: boolean } {
  const found = new Map<string, { readonly node: DocNode; readonly parent: string | null }>();
  const visit = (node: DocNode, parent: string | null) => {
    for (const child of node.children) {
      const marker = markerOf(child);
      if (marker === null) continue;
      if (!found.has(marker.key)) found.set(marker.key, { node: child, parent });
      if (marker.kind === 'structural') visit(child, findRegion(intent, marker.key) === undefined ? parent : marker.key);
    }
  };
  visit(container, null);
  const gone = intent.regions.filter((r) => !found.has(r.id)).map((r) => r.id);
  let graph = intent;
  if (gone.length > 0) {
    const result = execute(graph, { kind: 'delete', ids: gone }, naming(context));
    if (result.ok) graph = result.graph;
  }
  const afterGone = graph;
  // where the page lays the regions out: only at the drawing's width, where the boxes mean what the intent means
  const origin = context.layout.box(container.id);
  const measured = activeBreakpoint(context.state).base && origin !== null;
  const released = new Map<string, DocNode>();
  graph = {
    ...graph,
    regions: graph.regions.map((r) => {
      const at = found.get(r.id);
      if (at === undefined) return r;
      let next: Region = at.parent !== r.parent ? { ...r, parent: at.parent } : r;
      if (measured) {
        const b = context.layout.box(at.node.id);
        if (b !== null && b.width > 0 && b.height > 0) {
          const box = { x: Math.round(b.x - (origin as { x: number }).x), y: Math.round(b.y - (origin as { y: number }).y), width: Math.round(b.width), height: Math.round(b.height) };
          const moved = Math.abs(box.x - r.box.x) > 8 || Math.abs(box.y - r.box.y) > 8 || Math.abs(box.width - r.box.width) > 8 || Math.abs(box.height - r.box.height) > 8;
          if (moved) next = { ...next, box };
        }
        // the sizes the person declared there, which the layout writes its own way from now on
        const without = withoutDeclaredSizes(context, at.node);
        if (without !== null) released.set(at.node.id, without);
      }
      return next;
    }),
  };
  if (validateIntent(graph).length > 0) graph = afterGone;
  const replace = (node: DocNode): DocNode => {
    const own = released.get(node.id) ?? node;
    return own.children.length === 0 ? own : { ...own, children: own.children.map(replace) };
  };
  const next = released.size === 0 ? container : replace(container);
  // changed only when a region was read back other than the intent holds it (gone, moved, re-parented) or a size taken
  // back: a container entered as the page holds it is not written again, whatever compiler wrote it
  const read = graph.regions.length !== intent.regions.length || graph.regions.some((r, i) => r !== intent.regions[i]);
  return { intent: read ? graph : intent, container: next, changed: read || released.size > 0 };
}

// An operation of the gesture algebra on the composed intent, refused with the engine's own problem when it cannot be.
function operate(context: Context, operation: Operation, selection?: readonly string[], fresh = false): Outcome<EditorUi> {
  const { state, record } = composed(context);
  const result = execute(record.intent, operation, naming(context));
  if (!result.ok) return refusedWith(result.problems);
  return written(context, result.graph, selection ?? state.selection, fresh);
}

// What a gesture did, in words (spec: every change says what it changed): the regions it made, cut, merged, moved,
// nested, deleted; a rule painted; items added or taken by the repeat handle.
function gestureSaid(mode: string, before: LayoutIntent, after: LayoutIntent, affected: readonly string[]): Message {
  const nameIn = (graph: LayoutIntent, id: string) => findRegion(graph, id)?.name ?? id;
  const made = affected.filter((id) => findRegion(before, id) === undefined && findRegion(after, id) !== undefined);
  const kept = affected.filter((id) => findRegion(after, id) !== undefined);
  const names = (ids: readonly string[], graph: LayoutIntent) => ids.map((id) => nameIn(graph, id)).join(', ');
  switch (mode) {
    case 'draw':
      return message('layout.status.drew', { names: names(made, after) });
    case 'cut':
      return message('layout.status.cut', { names: names(kept, after) });
    case 'merge':
      return message('layout.status.merged', { name: names(kept.slice(0, 1), after) });
    case 'subtract':
      return message('layout.status.subtracted', { names: names(kept, after) });
    case 'move':
      return message('layout.status.moved', { names: names(kept, after) });
    case 'nest': {
      const moved = kept[0];
      const parent = moved === undefined ? undefined : findRegion(after, moved)?.parent;
      return parent === null || parent === undefined ? message('layout.status.extracted', { name: names(kept, after) }) : message('layout.status.nested', { name: names(kept, after), parent: nameIn(after, parent) });
    }
    case 'group':
      return message('layout.status.grouped', { name: names(made, after) });
    case 'relate':
      return message('layout.status.related');
    case 'repeat':
    {
      // the row or column the repeat changed, as many items as it holds now
      const parent = kept[0] === undefined ? null : (findRegion(after, kept[0])?.parent ?? null);
      return message('layout.status.repeated', { count: childrenOf(after, parent).length });
    }
    default:
      return message('layout.status.changed');
  }
}

// Runs a command body, turning a refusal of the engine (a LayoutRefusal) into the command's refusal: an invalid
// operation changes nothing and says why (spec "Error recovery").
function guarded(context: Context, body: () => Outcome<EditorUi>): Outcome<EditorUi> {
  try {
    const locked = composerOf(context.state.ui) === null ? null : firstLockRefusal(context.state.document, [composerOf(context.state.ui)?.target as NodeId], 'status.locked.edit');
    if (locked !== null) return { kind: 'refused', message: locked };
    return body();
  } catch (error) {
    if (error instanceof LayoutRefusal) return refusedWith([error.problem]);
    throw error;
  }
}

// The elements a container already holds, as the regions the layout places: each keeps its id, its styles and its
// children; it is measured where the canvas draws it, in the container's own coordinates, and marked so the composer
// finds it again (record.ts).
function adopt(context: Context, container: DocNode, graph: LayoutIntent): { readonly graph: LayoutIntent; readonly container: DocNode } {
  const origin = context.layout.box(container.id);
  if (origin === null) throw new LayoutRefusal('container');
  let next = graph;
  const children = container.children.map((child) => {
    if (markerOf(child) !== null) return child;
    const box = context.layout.box(child.id);
    if (box === null) return child;
    const id = nextRegionId(next);
    const placed: Region = { ...newRegion(id, { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }, child.name), kind: 'content' };
    const tried = { ...next, regions: [...next.regions, placed] };
    // an element the layout cannot place as a region of its own (drawn with no width or height, or over another one)
    // stays where it is, unplaced: the structure keeps it after the regions (materialize.ts), never loses it
    if (validateIntent(tried).length > 0) return child;
    next = tried;
    return withAuthoring(child, { role: 'node', key: id, owns: {} });
  });
  return { graph: next, container: { ...container, children } };
}

// layout.enter: compose a container (the selected one, else the page's root). The first time, its elements become the
// regions the layout places, where they stand; afterwards it reopens with the intent it keeps, and elements added since
// join it as placed regions (spec "Reedição"). Nothing about the page's look changes until the first gesture.
export const enterLayout = registerHandler<'layout.enter', EditorUi>('layout.enter', (context, { target }) => {
  try {
    const id = target ?? context.state.selection[0] ?? pageShown(context.state)?.tree.id;
    const at = id === undefined ? null : locate(context.state.document, id);
    if (at === null || id === undefined || context.rules.elements.get(at.node.type)?.content !== 'children') return { kind: 'refused', message: message('layout.noContainer') };
    const locked = firstLockRefusal(context.state.document, [id], 'status.locked.edit');
    if (locked !== null) return { kind: 'refused', message: locked };
    const box = context.layout.box(id);
    if (box === null) return { kind: 'refused', message: message('layout.noContainer') };
    if (!(box.width > 0)) return refusedWith([{ code: 'viewport', params: {} }]);
    const held = recordOf(at.node);
    // the height composed in: the container's own, else room to draw — the screen's for the page's root, the empty
    // height for any other container (interactions.json layout.emptyHeight)
    const room = at.parent === null ? activeBreakpoint(context.state).height : EMPTY_HEIGHT;
    const start: LayoutIntent = held === null ? emptyIntent(box.width, Math.max(box.height, room)) : namesFromElements(at.node, held.intent);
    // a container composed before: what the page holds now is read back first (the Select tool may have changed it)
    const back = held === null ? { intent: start, container: at.node, changed: false } : readBack(context, at.node, start);
    const adopted = adopt(context, back.container, back.intent);
    const record: ContainerRecord = { role: 'container', version: 1, intent: adopted.graph, owns: held?.owns ?? {} };
    const entered = back.changed ? structured(context, withAuthoring(adopted.container, record), record, adopted.graph, false) : withAuthoring(adopted.container, record);
    return {
      kind: 'change',
      patches: [{ op: 'replace', path: [...at.path], value: entered }],
      ui: (() => {
        const layers = composerOf(context.state.ui)?.layers ?? isPanelOpen(context.state.ui, LAYERS);
        // the view the sidebar showed before the tool (kept when the tool comes on again over itself)
        const before = composerOf(context.state.ui)?.back ?? context.state.ui.panels.sidebarView;
        const back = before === PANEL ? BACK : before;
        return hidePanel(showPanel(withComposer(context.state.ui, { target: id, selection: [], lens: 'spatial', tool: 'auto', shows: PANEL, back, ...(layers ? { layers } : {}) }), PANEL), LAYERS);
      })(),
      message: message('layout.status.entered', { name: at.node.name }),
    };
  } catch (error) {
    if (error instanceof LayoutRefusal) return refusedWith([error.problem]);
    throw error;
  }
  // the Layout tool is the canvas tool while a container is composed
}, (state) => composerOf(state.ui) !== null);

// layout.leave: the composer closes; the page keeps the structure it was compiled to, and the container its intent.
export const leaveLayout = registerHandler<'layout.leave', EditorUi>('layout.leave', ({ state }) => {
  const composer = composerOf(state.ui);
  const folded = composer?.layers === true;
  const left = withComposer(state.ui, null);
  const ui = folded ? showPanel(left, LAYERS) : left;
  // the sidebar gives back the view it showed before the tool when it was showing the tool's options (AV2: the
  // Assistant whose turn used the tool), else the Explorer
  return { kind: 'change', ui: ui.panels.sidebarView === PANEL ? showPanel(ui, (composer?.back ?? BACK) as typeof BACK) : ui, message: message('layout.status.closed') };
});

// The hit radius in the container's px: the screen radius over the zoom the person set (the fitted view: 1). The
// canvas previews a stroke with the same radius (interaction/tool.ts), so the preview and the command read it alike.
// the hit radius in the page's px at the zoom the canvas shows (the chosen one, or Fit's)
export const hitRadius = (state: Shown): number => HIT_RADIUS / zoomOf(state);

const drawAtBase = (): Outcome<EditorUi> => ({ kind: 'refused', message: message('layout.respond.drawAtBase', { breakpoint: breakpointWords(BASE_BREAKPOINT) }) });

const isPoint = (p: unknown): p is Point => typeof p === 'object' && p !== null && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);

// layout.stroke: one gesture on the canvas, in the container's coordinates, read by the one tool (or the tool chosen,
// or the key held): a new region, a split or a cut, a merge, a subtraction, a move, a nest, a boundary or handle drag,
// a marquee that selects, constraints painted, a lasso that groups.
export const strokeLayout = registerHandler<'layout.stroke', EditorUi>('layout.stroke', (context, { mode, points, handle }) =>
  guarded(context, () => {
    const { record, state, container } = composed(context);
    if (!Array.isArray(points) || !points.every(isPoint)) throw new Error('layout.stroke: a door hands the stroke as points');
    // narrower than the drawing, a stroke says what changes there (spec "Responsive editing"): a region dragged among
    // its siblings sets their order at that width, a divider dragged the two regions' widths; the regions are read
    // where the page lays them out there, and any other change of structure belongs to the drawing's width
    const breakpoint = activeBreakpoint(context.state);
    if (!breakpoint.base) {
      const view = laidOutAt(context, container, record.intent);
      if (view === null) return drawAtBase();
      const narrow = readStroke(record.intent, { points, mode: 'auto', handle: null, radius: hitRadius(context.state), responsive: { maxWidth: breakpoint.width, view } }, naming(context));
      if (narrow.operation === null || narrow.result === null || !narrow.result.ok) return drawAtBase();
      const outcome = written(context, narrow.result.graph, state.selection);
      return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.responded', { breakpoint: breakpointWords(breakpoint) }) } : outcome;
    }
    const reading = readStroke(record.intent, { points, mode: mode as StrokeMode, handle: handle === undefined ? null : handleOf(handle), radius: hitRadius(context.state), selected: state.selection }, naming(context));
    // a marquee picks the regions it holds whole: they follow a drag of their body
    if (reading.selection !== null) {
      const names = reading.selection.map((id) => findRegion(record.intent, id)?.name ?? id).join(', ');
      return { kind: 'change', ui: withComposer(context.state.ui, { ...state, selection: reading.selection }), message: reading.selection.length === 0 ? message('layout.status.noSelection') : message('layout.status.selected', { names }) };
    }
    // the regions are drawn at the base screen size; a narrower one says what changes there (layout.respond)
    if (!activeBreakpoint(context.state).base) return drawAtBase();
    if (reading.operation === null || reading.result === null) return refusedWith(reading.problems);
    if (!reading.result.ok) return refusedWith(reading.result.problems);
    // composing the page itself, what its regions plainly mean is read from where they stand (intent/meaning.ts)
    const page = pageShown(context.state)?.tree.id === state.target;
    const graph = inferMeaning(reading.result.graph, { name: (key) => context.words(`layout.template.part.${key}` as MessageId), numbered: (n) => context.words('layout.label.region' as MessageId, { n }), generic: numberedWith(context.words) }, page);
    const made = reading.result.affected.filter((id) => findRegion(record.intent, id) === undefined && findRegion(graph, id) !== undefined);
    const result = written(context, graph, made.length > 0 ? made : moving(reading, state.selection));
    const outcome = result.kind === 'change' ? { ...result, message: gestureSaid(reading.mode, record.intent, graph, reading.result.affected) } : result;
    // a structural handle dragged (a boundary, a corner, a gap; a repeat adds items instead) says the sizes it gave the
    // regions it moved a boundary, a corner, a gap or an edge dragged says the sizes it gave; a label dragged moved its
    // region instead
    const dragged = (handle !== undefined && reading.mode !== 'move' && reading.mode !== 'nest') || reading.mode === 'boundary' || reading.mode === 'edge';
    if (outcome.kind !== 'change' || !dragged || reading.mode === 'repeat') return outcome;
    const sizes = reading.result.affected
      .map((id) => findRegion(graph, id))
      .filter((r): r is Region => r !== undefined)
      .map((r) => context.words('layout.status.size' as MessageId, { name: r.name, width: Math.round(r.box.width), height: Math.round(r.box.height) }))
      .join(', ');
    return sizes === '' ? outcome : { ...outcome, message: message('layout.status.resized', { sizes }) };
  }),
);

// After a move the regions moved are the selection (a region dragged without a click first is selected by it).
function moving(reading: { readonly mode: string; readonly visited: readonly string[] }, selection: readonly string[]): readonly string[] {
  return reading.mode === 'move' || reading.mode === 'nest' ? reading.visited : selection;
}

// The composed container a page element is a region of, and that region: the nearest container above it whose layout
// names the element's marker. Null for any other element (the Select tool's drags then do what they do anywhere).
export function regionOf(tree: DocNode, id: string): { readonly container: DocNode; readonly region: string } | null {
  const walk = (node: DocNode, holders: readonly DocNode[]): { readonly container: DocNode; readonly region: string } | null | undefined => {
    if (node.id === id) {
      const marker = markerOf(node);
      if (marker === null) return null;
      for (const holder of [...holders].reverse()) {
        const record = recordOf(holder);
        if (record !== null && findRegion(record.intent, marker.key) !== undefined) return { container: holder, region: marker.key };
      }
      return null;
    }
    for (const child of node.children) {
      const found = walk(child, [...holders, node]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(tree, []) ?? null;
}

const PLACE_EDGES: readonly PlaceEdges[] = ['move', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

// layout.place: the selected region, dragged with the Select tool by its body or by a resize handle (spec "Select
// tool"): its box in the layout moves or resizes, snapped as the Layout tool snaps, and the page is laid out again from
// it, so the region goes where it was put whatever grid holds it. Refused for an element that is no region.
export const placeLayout = registerHandler<'layout.place', EditorUi>('layout.place', (context, { target: named, dx, dy, edges }) =>
  guarded(context, () => {
    if (!activeBreakpoint(context.state).base) return drawAtBase();
    const tree = pageShown(context.state)?.tree;
    // the region named (the Select tool's drag of an element not selected yet), else the one selected
    const target = typeof named === 'string' ? named : context.state.selection.length === 1 ? context.state.selection[0] : undefined;
    const owner = tree === undefined || target === undefined ? null : regionOf(tree, target);
    const at = owner === null ? null : locate(context.state.document, owner.container.id);
    const held = owner === null ? null : recordOf(owner.container);
    if (owner === null || at === null || held === null || tree === undefined) return refusedWith([{ code: 'not-a-region', params: {} }]);
    if (typeof dx !== 'number' || typeof dy !== 'number' || !PLACE_EDGES.includes(edges as PlaceEdges)) throw new Error('layout.place: a door hands a travel and the edges it moves');
    // what the page holds now first (a region whose element the Select tool deleted is gone from the layout too)
    const back = readBack(context, owner.container, namesFromElements(owner.container, held.intent));
    if (findRegion(back.intent, owner.region) === undefined) return refusedWith([{ code: 'not-a-region', params: {} }]);
    const record: ContainerRecord = { ...held, intent: back.intent };
    // the travel in the page's px, in the container's own px (the drawing may be narrower or wider than the page)
    const measured = context.layout.box(owner.container.id);
    const scale = measured === null || !(measured.width > 0) ? 1 : record.intent.viewport.width / measured.width;
    const reading = readPlace(record.intent, owner.region, edges as PlaceEdges, dx * scale, dy * scale, hitRadius(context.state), naming(context));
    if (reading.operation === null || reading.result === null) return refusedWith(reading.problems);
    if (!reading.result.ok) return refusedWith(reading.result.problems);
    const graph = inferMeaning(reading.result.graph, { name: (key) => context.words(`layout.template.part.${key}` as MessageId), numbered: (n) => context.words('layout.label.region' as MessageId, { n }), generic: numberedWith(context.words) }, tree.id === owner.container.id);
    // a width or a height the Select tool wrote on a region before would hold it where it was: the layout owns its size
    const next = structured(context, releasedSizes(context, back.container), record, graph, false);
    const placed = findRegion(graph, owner.region);
    const said = reading.mode === 'edge' && placed !== undefined ? message('layout.status.resized', { sizes: context.words('layout.status.size' as MessageId, { name: placed.name, width: Math.round(placed.box.width), height: Math.round(placed.box.height) }) }) : gestureSaid(reading.mode, record.intent, graph, reading.result.affected);
    return { kind: 'change', patches: [{ op: 'replace', path: [...at.path], value: next }], message: said };
  }),
);

// layout.select: the regions a click picks (replace, add, toggle, or the next one under the same point).
export const selectLayout = registerHandler<'layout.select', EditorUi>('layout.select', (context, { regions, mode }) =>
  guarded(context, () => {
    const { record, state } = composed(context);
    if (!Array.isArray(regions) || !regions.every((r) => typeof r === 'string' && findRegion(record.intent, r) !== undefined)) return refusedWith([{ code: 'unknown-region', params: {} }]);
    const selection = nextSelection(state.selection, regions as string[], mode as SelectionMode);
    const names = selection.map((id) => findRegion(record.intent, id)?.name ?? id).join(', ');
    return { kind: 'change', ui: withComposer(context.state.ui, { ...state, selection }), message: selection.length === 0 ? message('layout.status.noSelection') : message('layout.status.selected', { names }) };
  }),
);

// layout.delete: the selected regions go, with what they hold (spec "Delete"); undo brings them back.
export const deleteLayout = registerHandler<'layout.delete', EditorUi>('layout.delete', (context) =>
  guarded(context, () => {
    const { state } = composed(context);
    if (state.selection.length === 0) return refusedWith([{ code: 'nothing-selected', params: {} }]);
    if (!activeBreakpoint(context.state).base) return drawAtBase();
    const { record } = composed(context);
    const names = state.selection.map((id) => findRegion(record.intent, id)?.name ?? id).join(', ');
    const outcome = operate(context, { kind: 'delete', ids: state.selection }, []);
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.deleted', { names }) } : outcome;
  }),
);

// layout.merge: the selected regions become one over the box they span, apart as they may stand (spec "Merge");
// refused when that box would take in another region. Undo brings them back.
export const mergeLayout = registerHandler<'layout.merge', EditorUi>('layout.merge', (context) =>
  guarded(context, () => {
    const { state, record } = composed(context);
    if (state.selection.length < 2) return refusedWith([{ code: 'merge-selection', params: {} }]);
    if (!activeBreakpoint(context.state).base) return drawAtBase();
    const ids = state.selection.filter((id) => findRegion(record.intent, id) !== undefined);
    const outcome = operate(context, { kind: 'merge', ids, span: true }, ids.slice(0, 1));
    if (outcome.kind !== 'change') return outcome;
    return { ...outcome, message: message('layout.status.merged', { name: findRegion(record.intent, ids[0] as string)?.name ?? '' }) };
  }),
);

// The regions a property or a screen-size change applies to: the selected ones.
function selected(context: Context): { readonly state: ComposerState; readonly record: ContainerRecord; readonly regions: readonly Region[] } {
  const { state, record } = composed(context);
  const regions = state.selection.map((id) => findRegion(record.intent, id)).filter((r): r is Region => r !== undefined);
  if (regions.length === 0) throw new LayoutRefusal('nothing-selected');
  return { state, record, regions };
}

const oneOf = <T extends string>(values: readonly T[], value: string, property: string): T => {
  if (!(values as readonly string[]).includes(value)) throw new LayoutRefusal('value', { value, property });
  return value as T;
};

// a length in px as the person types it: "24" or "24px"
const PX = /^\s*\d+(\.\d+)?\s*(px)?\s*$/;

// What a property's value means for one region (refused when it is not one of the property's values, named in the
// person's words).
function valuesOf(region: Region, field: string, value: string, property: string): RegionValues {
  switch (field) {
    case 'name':
      if (value.trim() === '') throw new LayoutRefusal('value', { value, property });
      return { name: value.trim(), chosen: true };
    case 'semantic':
      if (region.kind === 'content') throw new LayoutRefusal('content-semantic');
      return { semantic: oneOf(SEMANTICS, value, property), chosen: true };
    case WIDTH:
    case HEIGHT:
      return { [field]: { ...region[field], mode: oneOf(SIZINGS, value, property) } };
    case 'padding':
      if (!PX.test(value)) throw new LayoutRefusal('value', { value, property });
      return { layout: { ...region.layout, padding: Number.parseFloat(value) } };
    case 'alignment':
      return { layout: { ...region.layout, alignment: oneOf(ALIGNMENTS, value, property) } };
    case 'distribution':
      return { layout: { ...region.layout, distribution: oneOf(DISTRIBUTIONS, value, property) } };
    default:
      throw new LayoutRefusal('value', { value, property });
  }
}

// layout.configure: a property of every selected region (spec "Intent Inspector"): its name, its meaning (the tag it
// compiles to), how its width and height behave, the room inside it and how its children sit there.
export const configureLayout = registerHandler<'layout.configure', EditorUi>('layout.configure', (context, { field, value }) =>
  guarded(context, () => {
    // sizes, spacing and alignment belong to the drawing's width; a narrower one changes only what the screen-size
    // section offers (a name and a meaning are the region's at every width)
    const breakpoint = activeBreakpoint(context.state);
    if (!breakpoint.base && field !== 'name' && field !== 'semantic') return { kind: 'refused', message: message('layout.respond.configureAtBase', { breakpoint: breakpointWords(BASE_BREAKPOINT) }) };
    const { state, record, regions } = selected(context);
    if (field === EQUALIZE) return equalized(context, record.intent, regions, value);
    if (field === SPACING) {
      if (!PX.test(value)) throw new LayoutRefusal('value', { value, property: context.words('layout.field.spacing' as MessageId) });
      return equalized(context, record.intent, regions, 'gap', Math.round(Number.parseFloat(value)));
    }
    if (field === REPEAT) return repeated(context, record.intent, regions, value);
    const property = context.words(`layout.field.${field}` as MessageId);
    const operations: Operation[] = regions.map((r) => ({ kind: 'configure', id: r.id, values: valuesOf(r, field, value, property) }));
    const result = execute(record.intent, operations.length === 1 ? (operations[0] as Operation) : { kind: 'compose', operations }, naming(context));
    if (!result.ok) return refusedWith(result.problems);
    const outcome = written(context, result.graph, state.selection);
    const names = regions.map((r) => (field === 'name' ? value.trim() : r.name)).join(', ');
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.configured', { names, property: context.words(`layout.field.${field}` as MessageId) }) } : outcome;
  }),
);

// Equal sizes or one gap for the selected regions (the panel's Equal widths and Equal gaps): a rule the layout keeps
// between them, listed with the others and removed by its own door. Siblings side by side are equalized across, a
// column of them down.
const EQUALIZE = 'equalize';
const PAINTED = ['equal-size', 'gap'] as const;
function equalized(context: Context, graph: LayoutIntent, regions: readonly Region[], value: string, spacing?: number): Outcome<EditorUi> {
  const kind = PAINTED.find((one) => one === value);
  if (kind === undefined) throw new LayoutRefusal('value', { value, property: context.words(`layout.field.${EQUALIZE}` as MessageId) });
  if (regions.length < 2) throw new LayoutRefusal('distribute-count');
  const across = regions.some((a, i) => regions.some((b, j) => j > i && Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y) > 0));
  const axis = across ? 'x' : 'y';
  const size = axis === 'x' ? WIDTH : HEIGHT;
  // in their order along the axis, within the span they take now: equal widths share that span after the gaps they
  // keep; one gap keeps their widths and the span's two ends, and shares what is left between them
  const ordered = [...regions].sort((a, b) => a.box[axis] - b.box[axis]);
  const first = ordered[0] as Region;
  const last = ordered[ordered.length - 1] as Region;
  const span = last.box[axis] + last.box[size] - first.box[axis];
  const gaps = ordered.slice(1).map((r, i) => r.box[axis] - ((ordered[i] as Region).box[axis] + (ordered[i] as Region).box[size]));
  const lengths = ordered.map((r) => r.box[size]);
  // one gap: the spacing typed, else the span's room shared evenly
  const gap = spacing ?? (span - lengths.reduce((s, l) => s + l, 0)) / (ordered.length - 1);
  const each = (span - gaps.reduce((s, g) => s + g, 0)) / ordered.length;
  let at = first.box[axis];
  const placed: Operation[] = ordered.map((r, i) => {
    const length = kind === 'gap' ? r.box[size] : Math.round(each);
    const box = { ...r.box, [axis]: Math.round(at), [size]: length };
    at += length + (kind === 'gap' ? gap : (gaps[i] ?? 0));
    return { kind: 'resize-region', id: r.id, box };
  });
  const rule = paintConstraint(graph, kind, ordered.map((r) => r.id), axis, kind === 'gap' ? Math.round(gap) : undefined);
  const outcome = operate(context, { kind: 'compose', operations: [...placed, rule] });
  return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.equalized', { names: regions.map((r) => r.name).join(', ') }) } : outcome;
}

// The panel's Spacing: one gap, typed in px, between the selected regions (equalized() with that gap); Repeat: the
// one selected region repeated to a count of items along its row (down its column when it takes most of its parent's
// width), each as wide as it, narrowed to fit its parent when they would run past it, a spacing of REPEAT_GAP apart.
const SPACING = 'spacing';
const REPEAT = 'repeat';
const REPEAT_GAP = 24;
const REPEAT_MOST = 100;

function repeated(context: Context, graph: LayoutIntent, regions: readonly Region[], value: string): Outcome<EditorUi> {
  const count = Number(value.trim());
  if (!Number.isInteger(count) || count < 2 || count > REPEAT_MOST) throw new LayoutRefusal('repeat-count');
  if (regions.length !== 1) throw new LayoutRefusal('repeat-one');
  const one = regions[0] as Region;
  const parent = one.parent === null ? graph.viewport : (findRegion(graph, one.parent)?.box ?? graph.viewport);
  const axis = one.box.width > parent.width / 2 ? 'y' : 'x';
  const size = axis === 'x' ? WIDTH : HEIGHT;
  const room = parent[axis] + parent[size] - one.box[axis];
  const fits = Math.floor((room - REPEAT_GAP * (count - 1)) / count);
  const length = Math.min(one.box[size], fits);
  if (!(length > 0)) throw new LayoutRefusal('repeat-room');
  const operations: Operation[] = [
    ...(length < one.box[size] ? [{ kind: 'resize-region' as const, id: one.id, box: { ...one.box, [size]: length } }] : []),
    { kind: 'repeat', id: one.id, count, axis, gap: REPEAT_GAP },
  ];
  const outcome = operate(context, { kind: 'compose', operations });
  return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.repeated', { name: one.name, count }) } : outcome;
}

// The group an arrangement or a screen-size change is about: the one selected region's children when it holds some,
// else the group the selection sits in, else the container's top level.
function groupOf(context: Context): { readonly parent: string | null; readonly record: ContainerRecord } {
  const { state, record } = composed(context);
  const first = state.selection.length === 0 ? undefined : findRegion(record.intent, state.selection[0] as string);
  if (first === undefined) return { parent: null, record };
  if (state.selection.length === 1 && childrenOf(record.intent, first.id).length > 0) return { parent: first.id, record };
  return { parent: first.parent, record };
}

// layout.interpret: how a group's regions are arranged when the drawing reads more than one way (spec "Ambiguity
// Engine"): a grid, rows and columns, fixed or proportional sizes, masonry, or the compiler's own choice.
export const interpretLayout = registerHandler<'layout.interpret', EditorUi>('layout.interpret', (context, { strategy }) =>
  guarded(context, () => {
    const { parent } = groupOf(context);
    // a new arrangement is compiled afresh: nothing of the old one's wrappers stays behind
    const outcome = operate(context, { kind: 'interpret', parent, strategy: strategy as LayoutStrategy }, undefined, true);
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.interpreted', { strategy: context.words(`layout.strategy.${strategy}` as MessageId) }) } : outcome;
  }),
);

// layout.respond: what changes at the screen size the canvas shows and every narrower one (spec "Responsive
// Continuum"): the group stacks, keeps its drawn arrangement, flows in a number of columns, or the selected regions
// hide or show. The drawing itself belongs to the base screen size, where nothing of this applies.
export const respondLayout = registerHandler<'layout.respond', EditorUi>('layout.respond', (context, { edit, value }) =>
  guarded(context, () => {
    const breakpoint = activeBreakpoint(context.state);
    if (breakpoint.base) return { kind: 'refused', message: message('layout.respond.base') };
    const { parent, record } = groupOf(context);
    let change: ResponsiveEdit;
    if (edit === 'stack') change = { kind: 'stack', parent };
    else if (edit === 'unstack') change = { kind: 'unstack', parent };
    else if (edit === 'hide' || edit === 'show') change = { kind: edit, ids: selected(context).regions.map((r) => r.id) };
    else {
      const columns = Number(value);
      if (!Number.isInteger(columns) || columns < 1 || columns > 12) throw new LayoutRefusal('value', { value: value ?? '', property: context.words('layout.door.columns' as MessageId) });
      change = { kind: 'columns', parent, columns };
    }
    const outcome = operate(context, responsiveEdit(record.intent, breakpoint.width, change));
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.responded', { breakpoint: breakpointWords(breakpoint) }) } : outcome;
  }),
);

// layout.unrelate: a rule between regions goes (spec "Constraint Painting"); the regions keep where they are.
export const unrelateLayout = registerHandler<'layout.unrelate', EditorUi>('layout.unrelate', (context, { constraint }) =>
  guarded(context, () => {
    const { record } = composed(context);
    if (!record.intent.constraints.some((c) => c.id === constraint)) throw new LayoutRefusal('orphan-constraint', { constraint });
    const outcome = operate(context, { kind: 'remove-constraint', id: constraint });
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.unrelated') } : outcome;
  }),
);

// The suggestions worth offering (spec "Structural Suggestions": only on strong evidence): those whose acceptance
// changes what the page is. One that compiles to the very structure the page has says nothing new.
export function usefulSuggestions(graph: LayoutIntent): Suggestion[] {
  const plain: Naming = { named: (base, n) => base ?? String(n) };
  const fingerprint = (one: LayoutIntent): string | null => {
    try {
      return compile(laidOut(one), COMPILER).fingerprint;
    } catch (error) {
      if (error instanceof LayoutRefusal) return null;
      throw error;
    }
  };
  const now = fingerprint(graph);
  return suggestions(graph).filter((s) => {
    const result = execute(graph, acceptSuggestion(graph, s), plain);
    if (!result.ok) return false;
    const next = fingerprint(result.graph);
    return next !== null && next !== now;
  });
}

// layout.suggest: a suggestion the layout offers on strong evidence (spec "Structural Suggestions"), accepted.
export const suggestLayout = registerHandler<'layout.suggest', EditorUi>('layout.suggest', (context, { suggestion }) =>
  guarded(context, () => {
    const { record } = composed(context);
    const found = usefulSuggestions(record.intent).find((s) => s.id === suggestion);
    if (found === undefined) throw new LayoutRefusal('unknown-region', { region: suggestion });
    const outcome = operate(context, acceptSuggestion(record.intent, found));
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.suggested') } : outcome;
  }),
);

// layout.template: a built-in structure placed (spec "Layout templates"): inside the one selected region that holds
// nothing, else over the whole container while it holds no region; it is scaled to that box.
export const templateLayout = registerHandler<'layout.template', EditorUi>('layout.template', (context, { template }) =>
  guarded(context, () => {
    const { state, record } = composed(context);
    const words = (key: string) => context.words(key as MessageId);
    const made = builtInTemplate(template as BuiltInTemplate, words);
    const one = state.selection.length === 1 ? findRegion(record.intent, state.selection[0] as string) : undefined;
    const target =
      one !== undefined && one.kind !== 'content' && childrenOf(record.intent, one.id).length === 0
        ? { parent: one.id, box: one.box }
        : record.intent.regions.length === 0
          ? { parent: null, box: record.intent.viewport }
          : null;
    if (target === null) throw new LayoutRefusal('template', { name: made.name });
    const outcome = operate(context, placeTemplate(record.intent, made, target, {}, naming(context)), []);
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.templated', { template: made.name }) } : outcome;
  }),
);

// layout.reference: an image of the project under the composition to trace a design from (spec, bet F), at an
// opacity; an empty file takes it away. The image stays a project file: the layout keeps its path.
export const referenceLayout = registerHandler<'layout.reference', EditorUi>('layout.reference', (context, { file, opacity }) =>
  guarded(context, () => {
    const { record } = composed(context);
    const held = record.intent.reference;
    if (file === '') {
      if (held === undefined) throw new LayoutRefusal('no-reference');
      const outcome = operate(context, { kind: 'reference', reference: null });
      return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.unreferenced') } : outcome;
    }
    const path = file ?? held?.file;
    if (path === undefined) throw new LayoutRefusal('no-reference');
    if (!imageFiles(context.state.document).some((f) => f.path === path)) throw new LayoutRefusal('reference');
    let alpha = held?.opacity ?? REFERENCE_OPACITY;
    if (opacity !== undefined) {
      const percent = Number(opacity);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new LayoutRefusal('value', { value: opacity, property: context.words('layout.door.referenceOpacity' as MessageId) });
      alpha = percent / 100;
    }
    const outcome = operate(context, { kind: 'reference', reference: { file: path, box: held?.box ?? record.intent.viewport, opacity: alpha, locked: true } });
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.referenced', { file: path }) } : outcome;
  }),
);

const isLuminance = (value: unknown): value is Luminance => {
  if (typeof value !== 'object' || value === null) return false;
  const { width, height, values } = value as Luminance;
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && Array.isArray(values) && values.length === width * height && values.every((v) => typeof v === 'number' && v >= 0 && v <= 1);
};

// layout.trace: the blocks of the reference image drawn as regions over it (spec, bet F). The panel hands the image's
// luminance, read where the editor can decode it; the blocks and the regions are the engine's.
export const traceLayout = registerHandler<'layout.trace', EditorUi>('layout.trace', (context, { luminance }) =>
  guarded(context, () => {
    const { record } = composed(context);
    const held = record.intent.reference;
    if (held === undefined) throw new LayoutRefusal('no-reference');
    if (!isLuminance(luminance)) throw new LayoutRefusal('trace-reading');
    const blocks = traceBlocks(luminance);
    const operation = traceRegions(record.intent, blocks, luminance, held.box, naming(context));
    const outcome = operate(context, operation, []);
    return outcome.kind === 'change' ? { ...outcome, message: message('layout.status.traced', { count: blocks.length }) } : outcome;
  }),
);

export { NAMESPACE };

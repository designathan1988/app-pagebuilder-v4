// The motion data of a whole document (spec motion-interactions): the project's timelines, every element's
// interactions and behaviours, the references between them, and the rules a document's motion data meets — the
// validator's part (core/document/validate.ts calls motionProblems), the tree kernel's part (core/document/tree.ts
// releases a picked element that leaves), and the export's part (which elements a script addresses).
//  - A timeline's name is unique in the project; an interaction plays a timeline by its name, and a timeline action may
//    control another timeline by its name. Renaming a timeline renames every reference in the same patches.
//  - A picked element (a target of kind `element`) names a node of the document; when that node leaves, every action
//    acting on it leaves too (its script would select nothing), as an interaction's target does
//    (tree.ts releaseReferencesPatch).
import type { NodeId } from '../../generated/commands.ts';
import { locate, walk, type DocNode, type DocumentJson } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { readBehaviour, readInteraction, readTimeline } from './read.ts';
import type { Behaviour, MotionInteraction, MotionTimeline, TimelineAction } from './model.ts';

const NO_TIMELINES: readonly MotionTimeline[] = [];
const NO_MOTIONS: readonly MotionInteraction[] = [];
const NO_BEHAVIOURS: readonly Behaviour[] = [];

export const timelinesOf = (document: DocumentJson): readonly MotionTimeline[] => document.motionTimelines ?? NO_TIMELINES;
export const motionsOf = (node: DocNode): readonly MotionInteraction[] => node.motions ?? NO_MOTIONS;
export const behavioursOf = (node: DocNode): readonly Behaviour[] => node.behaviours ?? NO_BEHAVIOURS;

export function findTimeline(document: DocumentJson, name: string): { readonly timeline: MotionTimeline; readonly index: number } | null {
  const index = timelinesOf(document).findIndex((timeline) => timeline.name === name);
  const timeline = timelinesOf(document)[index];
  return timeline === undefined ? null : { timeline, index };
}

// Every node of the document that can hold motion: the pages' trees and the components' definitions (an instance
// carries what its definition holds).
function* motionHolders(document: DocumentJson): Generator<{ readonly node: DocNode; readonly path: readonly (string | number)[] }> {
  for (const [pageIndex, page] of document.pages.entries()) yield* withPaths(page.tree, ['pages', pageIndex, 'tree']);
  for (const [index, component] of (document.components ?? []).entries()) yield* withPaths(component.tree, ['components', index, 'tree']);
}
function* withPaths(node: DocNode, path: readonly (string | number)[]): Generator<{ readonly node: DocNode; readonly path: readonly (string | number)[] }> {
  yield { node, path };
  for (const [index, child] of node.children.entries()) yield* withPaths(child, [...path, 'children', index]);
}

// A timeline name not used yet, from a wanted one: the name itself, else the name followed by 2, 3…
export function uniqueTimelineName(document: DocumentJson, wanted: string): string {
  const taken = new Set(timelinesOf(document).map((timeline) => timeline.name));
  const base = wanted.trim().slice(0, 60) || 'Timeline';
  if (!taken.has(base)) return base;
  for (let number = 2; ; number += 1) {
    const candidate = `${base} ${number}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// What plays or controls a timeline: the interactions that play it and the actions of other timelines that control it.
export interface TimelineUses {
  readonly interactions: number;
  readonly actions: number;
}
export function timelineUses(document: DocumentJson, name: string): TimelineUses {
  let interactions = 0;
  for (const { node } of motionHolders(document)) interactions += motionsOf(node).filter((motion) => motion.timeline === name).length;
  let actions = 0;
  for (const timeline of timelinesOf(document)) actions += timeline.actions.filter((action) => action.effect.kind === 'timeline' && action.effect.timeline === name).length;
  return { interactions, actions };
}

// The patches that write the project's timelines whole (a new list, or none at all when it is empty: the document
// carries no motionTimelines while it holds none).
export function writeTimelines(document: DocumentJson, timelines: readonly MotionTimeline[]): Patch[] {
  if (timelines.length === 0) return document.motionTimelines === undefined ? [] : [{ op: 'remove', path: ['motionTimelines'] }];
  return [{ op: document.motionTimelines === undefined ? 'add' : 'replace', path: ['motionTimelines'], value: timelines }];
}

// The patch that writes one timeline in place.
export const writeTimeline = (index: number, timeline: MotionTimeline): Patch => ({ op: 'replace', path: ['motionTimelines', index], value: timeline });

// The patches that write a node's interactions (none: the field goes).
export function writeMotions(node: DocNode, path: readonly (string | number)[], motions: readonly MotionInteraction[]): Patch[] {
  if (motions.length === 0) return node.motions === undefined ? [] : [{ op: 'remove', path: [...path, 'motions'] }];
  return [{ op: node.motions === undefined ? 'add' : 'replace', path: [...path, 'motions'], value: motions }];
}
export function writeBehaviours(node: DocNode, path: readonly (string | number)[], behaviours: readonly Behaviour[]): Patch[] {
  if (behaviours.length === 0) return node.behaviours === undefined ? [] : [{ op: 'remove', path: [...path, 'behaviours'] }];
  return [{ op: node.behaviours === undefined ? 'add' : 'replace', path: [...path, 'behaviours'], value: behaviours }];
}

// The patches that rename a timeline and every reference to it: the interactions that play it and the timeline
// actions that control it.
export function renameTimelinePatches(document: DocumentJson, from: string, to: string): Patch[] {
  const timelines = timelinesOf(document).map((timeline) => ({
    ...(timeline.name === from ? { ...timeline, name: to } : timeline),
    actions: timeline.actions.map((action) => (action.effect.kind === 'timeline' && action.effect.timeline === from ? { ...action, effect: { ...action.effect, timeline: to } } : action)),
  }));
  const patches: Patch[] = writeTimelines(document, timelines);
  for (const { node, path } of motionHolders(document)) {
    if (!motionsOf(node).some((motion) => motion.timeline === from)) continue;
    patches.push(...writeMotions(node, path, motionsOf(node).map((motion) => (motion.timeline === from ? { ...motion, timeline: to } : motion))));
  }
  return patches;
}

// The patches that release every picked element that is leaving (tree.ts releaseReferencesPatch adds them): an action
// whose target is a leaving node leaves its timeline.
export function releaseMotionTargets(document: DocumentJson, leaving: ReadonlySet<NodeId>): Patch[] {
  const acting = (action: TimelineAction): boolean => !(action.target.kind === 'element' && leaving.has(action.target.node));
  const timelines = timelinesOf(document);
  if (!timelines.some((timeline) => timeline.actions.some((action) => !acting(action)))) return [];
  return writeTimelines(document, timelines.map((timeline) => ({ ...timeline, actions: timeline.actions.filter(acting) })));
}

// The elements the motion script addresses (the export gives each a class of its own: spec export-motion-js): every
// element holding an interaction or a behaviour, and every element an action picked.
export function addressedMotionNodes(document: DocumentJson): ReadonlySet<NodeId> {
  const found = new Set<NodeId>();
  for (const page of document.pages) {
    for (const node of walk(page.tree)) if (motionsOf(node).length > 0 || behavioursOf(node).length > 0) found.add(node.id as NodeId);
  }
  for (const timeline of timelinesOf(document)) for (const action of timeline.actions) if (action.target.kind === 'element') found.add(action.target.node);
  return found;
}

// Whether a page's tree runs the motion script: one of its elements holds an interaction or a behaviour.
export const treeUsesMotion = (tree: DocNode): boolean => [...walk(tree)].some((node) => motionsOf(node).length > 0 || behavioursOf(node).length > 0);

// ---------------------------------------------------------------- the validator's part

export interface MotionProblem {
  readonly path: string;
  readonly message: string;
}

// Every problem of a document's motion data, by its JSON path: each timeline, interaction and behaviour as read.ts
// reads it, the timeline names unique, every timeline an interaction plays or an action controls held by the project,
// and every picked element a node of the document.
export function motionProblems(document: DocumentJson): MotionProblem[] {
  const problems: MotionProblem[] = [];
  const bad = (path: string, message: string) => problems.push({ path, message });
  const nodes = new Set<string>();
  for (const { node } of motionHolders(document)) nodes.add(node.id);
  const held: unknown = (document as { readonly motionTimelines?: unknown }).motionTimelines;
  const names = new Set<string>();
  if (held !== undefined) {
    if (!Array.isArray(held) || held.length === 0) bad('/motionTimelines', 'the timelines are a list, absent while there is none');
    else
      held.forEach((value, index) => {
        const read = readTimeline(value);
        if (!read.ok) {
          for (const issue of read.issues) bad(`/motionTimelines/${index}/${issue.path}`, issue.reason);
          return;
        }
        if (names.has(read.value.name)) bad(`/motionTimelines/${index}/name`, `the timeline ${read.value.name} is made twice`);
        names.add(read.value.name);
      });
  }
  for (const [index, timeline] of (Array.isArray(held) ? (held as MotionTimeline[]) : []).entries()) {
    for (const [at, action] of (Array.isArray(timeline.actions) ? timeline.actions : []).entries()) {
      const path = `/motionTimelines/${index}/actions/${at}`;
      if (action.target?.kind === 'element' && !nodes.has(action.target.node)) bad(`${path}/target`, `the element ${action.target.node} is no element of the document`);
      if (action.effect?.kind === 'timeline' && action.effect.timeline !== '' && !names.has(action.effect.timeline)) bad(`${path}/effect/timeline`, `${action.effect.timeline} is no timeline of the project`);
    }
  }
  for (const { node, path } of motionHolders(document)) {
    const at = `/${path.join('/')}`;
    const motions: unknown = (node as { readonly motions?: unknown }).motions;
    if (motions !== undefined) {
      if (!Array.isArray(motions) || motions.length === 0) bad(`${at}/motions`, 'the interactions are a list, absent while there is none');
      else {
        const ids = new Set<string>();
        motions.forEach((value, index) => {
          const read = readInteraction(value);
          if (!read.ok) {
            for (const issue of read.issues) bad(`${at}/motions/${index}/${issue.path}`, issue.reason);
            return;
          }
          if (ids.has(read.value.id)) bad(`${at}/motions/${index}/id`, `the id ${read.value.id} is used twice`);
          ids.add(read.value.id);
          if (!names.has(read.value.timeline)) bad(`${at}/motions/${index}/timeline`, `${read.value.timeline} is no timeline of the project`);
        });
      }
    }
    const behaviours: unknown = (node as { readonly behaviours?: unknown }).behaviours;
    if (behaviours !== undefined) {
      if (!Array.isArray(behaviours) || behaviours.length === 0) bad(`${at}/behaviours`, 'the behaviours are a list, absent while there is none');
      else {
        const kinds = new Set<string>();
        behaviours.forEach((value, index) => {
          const read = readBehaviour(value);
          if (!read.ok) for (const issue of read.issues) bad(`${at}/behaviours/${index}/${issue.path}`, issue.reason);
          else if (kinds.has(read.value.kind)) bad(`${at}/behaviours/${index}/kind`, `the behaviour ${read.value.kind} is set twice`);
          else kinds.add(read.value.kind);
        });
      }
    }
  }
  return problems;
}

// The stand-ins a scenario's expected document takes before it is checked as a document (src/manifest/scenario.ts
// withStandInIds): a scenario never names a generated id, so every motion object written without one takes a
// stand-in, and an element an action picked, named by its node path ("@/Page/Hero/Intro"), takes that node's id, as
// the editor stores it. The document is the expectation's own clone, changed in place.
export function motionStandIns(document: Record<string, unknown>, next: () => string, nodeId: (path: string) => string | null): void {
  const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const identify = (value: unknown): void => {
    if (isObject(value) && !('id' in value)) value.id = next();
  };
  const each = (list: unknown, visit: (item: Record<string, unknown>) => void): void => {
    if (Array.isArray(list)) for (const item of list) if (isObject(item)) visit(item);
  };
  each(document.motionTimelines, (timeline) => {
    identify(timeline);
    each(timeline.markers, identify);
    each(timeline.actions, (action) => {
      identify(action);
      const target = action.target;
      if (isObject(target) && typeof target.node === 'string' && target.node.startsWith('@/')) target.node = nodeId(target.node.slice(1)) ?? target.node;
      const effect = action.effect;
      if (!isObject(effect)) return;
      each(effect.tracks, (track) => {
        identify(track);
        each(track.keyframes, identify);
      });
    });
  });
  const visitNode = (node: unknown): void => {
    if (!isObject(node)) return;
    each(node.motions, identify);
    if (Array.isArray(node.children)) for (const child of node.children) visitNode(child);
  };
  each(document.pages, (page) => visitNode(page.tree));
  each(document.components, (component) => visitNode(component.tree));
}

// The node an interaction command acts on, with its path: the primary selected element.
export function primaryNode(document: DocumentJson, selection: readonly NodeId[]): { readonly node: DocNode; readonly path: readonly (string | number)[] } | null {
  const primary = selection[0];
  if (primary === undefined) return null;
  const found = locate(document, primary);
  return found === null ? null : { node: found.node, path: found.path };
}

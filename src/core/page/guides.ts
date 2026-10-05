// Manual guides (INVENTORY.md, owners; spec guides-manual): lines across the page at a page px position,
// horizontal or vertical, kept on the page's root (its `guides`), never exported. Each is named by its axis and the
// first number no guide of the page has (horizontal-1), so a person, a scenario and the keys name the same guide.
//  - guides.create: a guide on an axis at a place (from 0, whole px).
//  - guides.move: to a place, or by a step along the axis a key moves (`delta`, `along`: a horizontal guide moves up
//    and down, a vertical one left and right; the keymap has made Shift's step the larger one); a locked guide refuses
//    (status.guides.locked).
//  - guides.delete, guides.toggleLock. One undo step each (a drag's creation, moves and delete are one gesture).
// The guides of the page the canvas shows (openedPage, its one owner: the audit's PG2, every guide went to the first
// page whichever page was open, and the first page's guides showed on every page).
import { message, registerHandler, type Outcome } from '../commands/registry.ts';
import type { DocumentJson, Guide } from '../document/model.ts';
import type { Patch } from '../history/transaction.ts';
import { openedPage } from '../project/pages.ts';
import { registerReferenceKind } from '../store/references.ts';

const NONE: readonly Guide[] = [];
// the guides of a page, by its index (the open one: openedPage)
export const guidesOf = (document: DocumentJson, page: number): readonly Guide[] => document.pages[page]?.tree.guides ?? NONE;
const place = (at: number) => Math.max(0, Math.round(at));

// the patch that makes the page's guides these (none: the field goes)
function guidesPatch(document: DocumentJson, page: number, next: readonly Guide[]): Patch {
  const root: readonly (string | number)[] = ['pages', page, 'tree'];
  const held = document.pages[page]?.tree.guides;
  if (next.length === 0) return { op: 'remove', path: [...root, 'guides'] };
  return held === undefined ? { op: 'add', path: [...root, 'guides'], value: next } : { op: 'replace', path: [...root, 'guides'], value: next };
}

// the name of a new guide on an axis: the axis and the first free number
function nextGuideId(document: DocumentJson, axis: Guide['axis'], page: number): string {
  const taken = new Set(guidesOf(document, page).map((g) => g.id));
  let n = 1;
  while (taken.has(`${axis}-${n}`)) n += 1;
  return `${axis}-${n}`;
}

// the guide a door names on the open page, or null (one of another page: its door went stale with the page)
function found(document: DocumentJson, page: number, id: string): Guide | null {
  return guidesOf(document, page).find((g) => g.id === id) ?? null;
}
const stale: Outcome<never> = { kind: 'refused', message: message('status.stale') };

export const createGuideCommand = registerHandler('guides.create', ({ state }, { axis, at }): Outcome<never> => {
  // a guide stands somewhere on its ruler (the audit's AUD-03: one created with no position was a guide the model
  // refuses)
  if (typeof at !== 'number' || !Number.isFinite(at)) return { kind: 'refused', message: message('status.guides.noPosition') };
  const page = openedPage(state);
  const guide: Guide = { id: nextGuideId(state.document, axis, page), axis, at: place(at) };
  return { kind: 'change', patches: [guidesPatch(state.document, page, [...guidesOf(state.document, page), guide])], message: message('status.guides.at', { at: guide.at }) };
});

// the axis a guide moves along: a horizontal line up and down, a vertical one left and right
const alongOf = (guide: Guide): Guide['axis'] => (guide.axis === 'horizontal' ? 'vertical' : 'horizontal');

export const moveGuideCommand = registerHandler('guides.move', ({ state }, { guide, at, delta, along }): Outcome<never> => {
  const page = openedPage(state);
  const held = found(state.document, page, guide);
  if (held === null) return stale;
  // a key that moves along the other axis moves nothing
  if (at === undefined && (delta === undefined || (along !== undefined && along !== alongOf(held)))) return { kind: 'change' };
  if (held.locked === true) return { kind: 'refused', message: message('status.guides.locked') };
  const next = place(at ?? held.at + (delta ?? 0));
  const said = message('status.guides.at', { at: next });
  if (next === held.at) return { kind: 'change', message: said };
  const list = guidesOf(state.document, page).map((g) => (g.id === guide ? { ...g, at: next } : g));
  return { kind: 'change', patches: [guidesPatch(state.document, page, list)], message: said };
});

export const deleteGuideCommand = registerHandler('guides.delete', ({ state }, { guide }): Outcome<never> => {
  const page = openedPage(state);
  if (found(state.document, page, guide) === null) return stale;
  return { kind: 'change', patches: [guidesPatch(state.document, page, guidesOf(state.document, page).filter((g) => g.id !== guide))], message: message('status.guides.deleted') };
});

export const toggleGuideLockCommand = registerHandler('guides.toggleLock', ({ state }, { guide }): Outcome<never> => {
  const page = openedPage(state);
  const held = found(state.document, page, guide);
  if (held === null) return stale;
  const list = guidesOf(state.document, page).map((g): Guide => {
    if (g.id !== guide) return g;
    if (held.locked === true) {
      const { locked: _dropped, ...rest } = g;
      void _dropped;
      return rest;
    }
    return { ...g, locked: true };
  });
  return { kind: 'change', patches: [guidesPatch(state.document, page, list)], message: message(held.locked === true ? 'status.guides.unlocked' : 'status.guides.lockedNow') };
});

// a guide an argument names (manifest refers: guide), by its id on a page of the project (the commands read the open
// page's: a guide of another page is a stale door there)
registerReferenceKind('guide', (document, id) => document.pages.some((_page, index) => guidesOf(document, index).some((guide) => guide.id === id)));

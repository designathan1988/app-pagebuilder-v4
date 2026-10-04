// The drop proposal (spec drag-reorder-canvas, "Hit zones and thresholds") on measured boxes given by hand.
import { describe, expect, it } from 'vitest';
import type { DocNode, DocumentJson, NodeId } from '../../core/document/model.ts';
import { DROP_ZONES, edgeBand, escapeBand, proposeDrop, slotAt, type Axis, type Box, type DropSpace } from './drop.ts';

const node = (id: string, type: string, children: DocNode[] = []): DocNode => ({ id: id as NodeId, type: type as DocNode['type'], name: id, tag: null, attributes: {}, classes: [], styles: {}, text: null, children });
const DOC: DocumentJson = {
  version: 2,
  pages: [
    {
      id: 'p',
      name: 'Home',
      file: 'index.html',
      tree: node('Page', 'page', [
        node('Hero', 'section', [node('Title', 'heading'), node('Intro', 'paragraph'), node('Actions', 'div')]),
        node('Grid', 'div', [node('CardA', 'article', [node('CardATitle', 'heading')]), node('CardB', 'article')]),
        node('Row', 'div', [node('Left', 'paragraph'), node('Right', 'paragraph')]),
      ]),
    },
  ],
};
const CONTAINERS = new Set(['page', 'section', 'div', 'article']);
const isContainer = (type: string) => CONTAINERS.has(type);

// screen boxes at zoom 0.5: Hero padded; the Grid's first card and its title share their top edge with the Grid
const BOXES: Record<string, Box> = {
  Hero: { x: 0, y: 0, width: 400, height: 150 },
  Title: { x: 20, y: 40, width: 360, height: 20 },
  Intro: { x: 20, y: 70, width: 360, height: 10 },
  Actions: { x: 20, y: 90, width: 360, height: 40 },
  Grid: { x: 0, y: 200, width: 400, height: 60 },
  CardA: { x: 0, y: 200, width: 400, height: 11 },
  CardATitle: { x: 0, y: 200, width: 400, height: 11 },
  CardB: { x: 0, y: 220, width: 400, height: 20 },
  Row: { x: 0, y: 300, width: 400, height: 20 },
  Left: { x: 0, y: 300, width: 100, height: 20 },
  Right: { x: 100, y: 300, width: 100, height: 20 },
};
const space = (axes: Record<string, Axis> = { Row: 'x' }, laysOut: readonly string[] = []): DropSpace => ({ zoom: 0.5, box: (id) => BOXES[id] ?? null, axis: (id) => axes[id] ?? 'y', laysOut: (id) => laysOut.includes(id) });
const propose = (dragged: string[], under: string[], x: number, y: number) => proposeDrop(DOC, isContainer, dragged as NodeId[], under, { x, y }, space());

describe('the drop proposal (src/editor/drag/drop.ts)', () => {
  it('a leaf splits in halves along its parent\'s flow; the index counts the siblings without the dragged node', () => {
    expect(propose(['Intro'], ['Title', 'Hero', 'Page'], 50, 49)).toEqual({ parent: 'Hero', index: 0, placement: 'before', reference: 'Title', refused: false });
    expect(propose(['Intro'], ['Title', 'Hero', 'Page'], 50, 51)).toEqual({ parent: 'Hero', index: 1, placement: 'after', reference: 'Title', refused: false });
    expect(propose(['Title'], ['Actions', 'Hero', 'Page'], 50, 125)).toEqual({ parent: 'Hero', index: 2, placement: 'after', reference: 'Actions', refused: false });
  });

  it('a row flex splits along x', () => {
    expect(propose(['Title'], ['Right', 'Row', 'Page'], 140, 310)).toMatchObject({ parent: 'Row', index: 1, placement: 'before', reference: 'Right' });
    expect(propose(['Title'], ['Right', 'Row', 'Page'], 160, 310)).toMatchObject({ parent: 'Row', index: 2, placement: 'after', reference: 'Right' });
  });

  it('over the dragged node or its descendants: the place it already holds, so the release leaves everything as it is', () => {
    expect(propose(['Intro'], ['Intro', 'Hero', 'Page'], 50, 75)).toEqual({ parent: 'Hero', index: 1, placement: 'inside', reference: 'Hero', refused: false });
    expect(propose(['Hero'], ['Title', 'Hero', 'Page'], 50, 50)).toEqual({ parent: 'Page', index: 0, placement: 'inside', reference: 'Page', refused: false });
  });

  it('a container is before or after in its edge bands and inside between them, at the slot of the pointer', () => {
    // the empty Actions, 40 screen px tall: min(8, 0.25 × 40) = 8 screen px at each end, inside between
    expect(edgeBand(40, true, DROP_ZONES)).toBe(8);
    expect(propose(['Title'], ['Actions', 'Hero', 'Page'], 50, 93)).toMatchObject({ placement: 'before', reference: 'Actions' });
    expect(propose(['Title'], ['Actions', 'Hero', 'Page'], 50, 100)).toEqual({ parent: 'Actions', index: 0, placement: 'inside', reference: 'Actions', refused: false });
    // Hero's padding, past its band: the slot counts the children whose centre is before the pointer, without the
    // dragged ones
    expect(propose(['Actions'], ['Hero', 'Page'], 50, 35)).toMatchObject({ parent: 'Hero', index: 0, placement: 'inside' });
    expect(propose(['Title'], ['Hero', 'Page'], 50, 85)).toMatchObject({ parent: 'Hero', index: 1, placement: 'inside' });
    // the page root's own background: inside it, after the children above the pointer
    expect(propose(['Title'], ['Page'], 50, 500)).toEqual({ parent: 'Page', index: 3, placement: 'inside', reference: 'Page', refused: false });
  });

  it('near the edge an ancestor shares with a leaf, the innermost ancestor is the level; never narrower than the floor', () => {
    // CardA is 22 CSS px tall: min(12, 5.5 − 8) is below zero, the floor keeps 6, plus the slop, capped at a third
    expect(escapeBand(11, 0.5, DROP_ZONES)).toBeCloseTo(11 / 3);
    expect(propose(['CardB'], ['CardATitle', 'CardA', 'Grid', 'Page'], 50, 202)).toEqual({ parent: 'Grid', index: 0, placement: 'before', reference: 'CardA', refused: false });
    // a card below the floor's length keeps only the slop; near the card's lower edge, after it
    expect(escapeBand(11, 2, DROP_ZONES)).toBe(2);
    expect(propose(['CardB'], ['CardATitle', 'CardA', 'Grid', 'Page'], 50, 209)).toEqual({ parent: 'Grid', index: 1, placement: 'after', reference: 'CardA', refused: false });
  });
});

// small targets (spec drag-reorder-canvas, Problems in Pager 6; drag-drop-inside, Problems in Pager 5; the user's
// real-use audit, item 2.2)
describe('small targets', () => {
  it('a container keeps its bands in screen pixels at any zoom', () => {
    expect(edgeBand(150, false, DROP_ZONES)).toBe(32);
    // at 25 % the Hero's 20th screen pixel is still in its 32 px band, not inside it
    const zoomed = { ...space(), zoom: 0.25 };
    expect(proposeDrop(DOC, isContainer, ['Actions'] as NodeId[], ['Hero', 'Page'], { x: 50, y: 20 }, zoomed)).toMatchObject({ parent: 'Page', placement: 'before', reference: 'Hero' });
  });

  it('an escape band is at most a third of its ancestor', () => {
    expect(escapeBand(9, 0.5, DROP_ZONES)).toBe(3);
    expect(escapeBand(90, 0.5, DROP_ZONES)).toBe(14);
  });

  it("over a child of a flex the drop stays in the flex, by the child's halves, even at the flex's edge", () => {
    const inFlex = space({ Row: 'x' }, ['Row']);
    expect(proposeDrop(DOC, isContainer, ['Title'] as NodeId[], ['Right', 'Row', 'Page'], { x: 160, y: 301 }, inFlex)).toEqual({ parent: 'Row', index: 2, placement: 'after', reference: 'Right', refused: false });
    // not laid out by the Row: its escape band there puts the drop before it
    expect(propose(['Title'], ['Right', 'Row', 'Page'], 160, 301)).toMatchObject({ parent: 'Page', placement: 'before', reference: 'Row' });
  });

  it('where an ancestor shares an edge with the one inside it, its band there is never wider: the innermost wins', () => {
    // CardA (11 px) and the Grid (60 px) share their top edge: past CardA's band (11/3 px), inside the Grid's own
    // 14 px band, the drop stays in the card, before its title, not before the Grid
    expect(propose(['CardB'], ['CardATitle', 'CardA', 'Grid', 'Page'], 50, 204.5)).toMatchObject({ parent: 'CardA', placement: 'before', reference: 'CardATitle' });
  });

  it('an empty container shorter than the aim is aimed at through a box of the aim around its centre', () => {
    // CardB is 20 screen px tall, from 220: its aim runs from 210 to 250, 8 px bands at each end
    expect(propose(['Title'], ['Grid', 'Page'], 50, 241)).toEqual({ parent: 'CardB', index: 0, placement: 'inside', reference: 'CardB', refused: false });
    expect(propose(['Title'], ['Grid', 'Page'], 50, 245)).toMatchObject({ parent: 'Grid', placement: 'after', reference: 'CardB' });
    // over another element the aim does not reach
    expect(propose(['Title'], ['CardATitle', 'CardA', 'Grid', 'Page'], 50, 209)).toMatchObject({ reference: 'CardA' });
  });
});

// the slot in two dimensions (spec drag-reorder-canvas, Problems in Pager 5): a grid of 3 columns of 100 px with 20 px
// gaps, cards 0-2 on the first row and 3 on the second
describe('slotAt', () => {
  const laid = [0, 1, 2, 3].map((order) => ({ id: `c${order}` as NodeId, order, box: { x: (order % 3) * 120, y: order < 3 ? 0 : 60, width: 100, height: 50 } }));
  it('is between two cards of a row for a point in the gap between them', () => {
    expect(slotAt(laid, { x: 110, y: 25 }, 'x', false)).toBe(1);
  });
  it('is after the last card of a row for a point in the empty cell after it, on the second row', () => {
    expect(slotAt(laid, { x: 200, y: 85 }, 'x', false)).toBe(4);
  });
  it('takes the nearest row for a point in the row gap, never the first card', () => {
    expect(slotAt(laid, { x: 250, y: 53 }, 'x', false)).toBe(2);
    expect(slotAt(laid, { x: 250, y: 57 }, 'x', false)).toBe(4);
  });
  it('turns before as shown into after in the document in a reversed row', () => {
    const reversed = [0, 1, 2].map((order) => ({ id: `r${order}` as NodeId, order, box: { x: 240 - order * 120, y: 0, width: 100, height: 50 } }));
    expect(slotAt(reversed, { x: 350, y: 25 }, 'x', true)).toBe(0);
    expect(slotAt(reversed, { x: 230, y: 25 }, 'x', true)).toBe(1);
    expect(slotAt(reversed, { x: 10, y: 25 }, 'x', true)).toBe(3);
  });
});

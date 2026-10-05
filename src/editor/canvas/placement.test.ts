// The label rules (src/editor/canvas/placement.ts). The selection's label has one place (the user's rule of 2026-10-05,
// DEC-70): above its element, touching the frame's line, at the frame's left edge, whatever lies there; over page text
// it says so, and then takes no press, so a press meant for the text under it reaches the text (jornada03 J16: a
// button's label over a card's price selected the button). A drop label takes the first free place around its element,
// and where none is free it covers the least it can and says so.
import { describe, expect, it } from 'vitest';
import { placeLabel, selectionLabelBox, turnedFrame, type Box } from './placement.ts';

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const CANVAS = box(0, 0, 1000, 1000);
const SIZE = { width: 80, height: 16 };
const BUTTON = box(100, 200, 60, 30);

describe("the selection's label", () => {
  it('stands above its element, its bottom on the frame line and its start at the frame line, covering nothing', () => {
    const placed = selectionLabelBox(BUTTON, SIZE, 2, []);
    expect(placed.placement).toBe('above');
    expect(placed.covers).toBe(false);
    expect(placed.box).toEqual(box(98, 182, 80, 16));
  });

  // the old rule moved it below, inside or a handle's room away when text or a control was in the way (QA 375); the
  // user's rule of 2026-10-05 keeps it in its one place and only says it covers the text
  it('keeps its place over the text above, and says it covers it', () => {
    const price = box(90, 170, 200, 26);
    const placed = selectionLabelBox(BUTTON, SIZE, 2, [price]);
    expect(placed.box).toEqual(box(98, 182, 80, 16));
    expect(placed.covers).toBe(true);
  });

  it('keeps its place for an element narrower than itself, at the top of the canvas or past its right edge', () => {
    expect(selectionLabelBox(box(10, 0, 12, 12), SIZE, 2, []).box).toEqual(box(8, -18, 80, 16));
    expect(selectionLabelBox(box(990, 300, 40, 20), SIZE, 1, []).box).toEqual(box(989, 283, 80, 16));
  });

  it('does not count text it meets by less than a pixel, the rounding of a fractional layout', () => {
    const above = box(0, 150, 400, 32.6);
    expect(selectionLabelBox(BUTTON, SIZE, 2, [above]).covers).toBe(false);
  });
});

describe('a drop label', () => {
  it('sits above the element where that space is free, and covers nothing', () => {
    const placed = placeLabel(BUTTON, SIZE, 4, [], CANVAS);
    expect(placed.placement).toBe('above');
    expect(placed.covers).toBe(false);
    expect(placed.box).toEqual(box(100, 180, 80, 16));
  });

  it('goes below when the text above takes the space, still covering nothing', () => {
    const price = box(90, 170, 200, 26);
    const placed = placeLabel(BUTTON, SIZE, 4, [price], CANVAS);
    expect(placed.placement).toBe('below');
    expect(placed.covers).toBe(false);
  });

  it('says it covers content when text surrounds the element on every side', () => {
    const above = box(0, 150, 400, 48);
    const below = box(0, 232, 400, 48);
    const placed = placeLabel(BUTTON, SIZE, 4, [above, below], CANVAS);
    expect(placed.covers).toBe(true);
  });
});

describe('a turned frame', () => {
  it('gives the box whose line drawn outside it is the turned frame line upright bounding box', () => {
    expect(turnedFrame(box(0, 0, 100, 20), 0, 2)).toEqual(box(0, 0, 100, 20));
    // a quarter turn about its centre (50, 10): the line 104 x 24 turned is 24 x 104, from (38, -42)
    const turned = turnedFrame(box(0, 0, 100, 20), 90, 2);
    expect(turned.x).toBeCloseTo(40);
    expect(turned.y).toBeCloseTo(-40);
    expect(turned.width).toBeCloseTo(20);
    expect(turned.height).toBeCloseTo(100);
    expect(selectionLabelBox(turned, SIZE, 2, []).box.y).toBeCloseTo(-58);
  });
});

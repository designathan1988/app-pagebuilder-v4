// Where the quick panel's chip and the open panel go (src/editor/quick-panel/quick-panel.ts placeQuickPanel): on the
// right of the selection's label, touching it, on its line (the user's rule of 2026-10-05, DEC-70), whatever lies
// there and wherever the stage ends; a panel the person dragged stays where it was left, held inside the stage.
import { describe, expect, it } from 'vitest';
import { placeQuickPanel } from './quick-panel.ts';

const STAGE = { x: 0, y: 0, width: 900, height: 700 };
const INSET = 20;
const PANEL = { width: 216, height: 560 };
const CHIP = { width: 24, height: 24 };
const ELEMENT = { x: 100, y: 80, width: 200, height: 40 };
const LABEL = { x: 98, y: 62, width: 90, height: 16 };

describe('placeQuickPanel (src/editor/quick-panel/quick-panel.ts)', () => {
  it('puts the chip on the right of the label, touching it, their bottoms level on the frame', () => {
    expect(placeQuickPanel(LABEL, ELEMENT, CHIP, false, STAGE, INSET, null)).toEqual({ x: 188, y: 54, ...CHIP });
  });

  it('puts the open panel on the right of the label, touching it, its top level with the label', () => {
    expect(placeQuickPanel(LABEL, ELEMENT, PANEL, true, STAGE, INSET, null)).toEqual({ x: 188, y: 62, ...PANEL });
  });

  // the old rule held the chip inside the stage and moved it to the label's left near the stage's right edge
  it('keeps the chip beside the label past the edge of the stage', () => {
    const far = { x: 860, y: 2, width: 90, height: 16 };
    expect(placeQuickPanel(far, ELEMENT, CHIP, false, STAGE, INSET, null)).toEqual({ x: 950, y: -6, ...CHIP });
  });

  it("keeps the person's own offset, held inside the stage", () => {
    expect(placeQuickPanel(LABEL, ELEMENT, PANEL, true, STAGE, INSET, { x: 10, y: 20 })).toEqual({ x: 110, y: 100, ...PANEL });
    expect(placeQuickPanel(LABEL, ELEMENT, PANEL, true, STAGE, INSET, { x: 900, y: 0 })).toEqual({ x: 664, y: 80, ...PANEL });
  });
});

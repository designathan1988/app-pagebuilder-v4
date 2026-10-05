import { describe, expect, it } from 'vitest';
import { floatBelow, floatBeside, pointAnchor } from './float.ts';

const VIEW = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 100 };

describe('floatBelow', () => {
  it('opens under the anchor, from its start edge', () => {
    expect(floatBelow({ left: 100, top: 50, right: 180, bottom: 74 }, SIZE, VIEW, 8)).toEqual({ left: 100, top: 74 });
  });
  it('keeps a gap between the anchor and the layer', () => {
    expect(floatBelow({ left: 100, top: 50, right: 180, bottom: 74 }, SIZE, VIEW, 8, 4)).toEqual({ left: 100, top: 78 });
  });
  it('ends at the anchor end edge when it would leave the window on the right', () => {
    expect(floatBelow({ left: 900, top: 50, right: 980, bottom: 74 }, SIZE, VIEW, 8)).toEqual({ left: 780, top: 74 });
  });
  it('stays inside the window when neither edge fits (the inspector at the window edge)', () => {
    expect(floatBelow({ left: 950, top: 50, right: 1000, bottom: 74 }, { width: 300, height: 100 }, VIEW, 8)).toEqual({ left: 692, top: 74 });
    expect(floatBelow({ left: 0, top: 50, right: 20, bottom: 74 }, SIZE, VIEW, 8)).toEqual({ left: 8, top: 74 });
  });
  it('opens above the anchor when there is no room below (a status bar menu)', () => {
    expect(floatBelow({ left: 100, top: 760, right: 180, bottom: 784 }, SIZE, VIEW, 8)).toEqual({ left: 100, top: 660 });
  });
  it('never leaves the window at the top, even taller than the room above', () => {
    expect(floatBelow({ left: 100, top: 60, right: 180, bottom: 740 }, { width: 200, height: 700 }, VIEW, 8)).toEqual({ left: 100, top: 8 });
  });
  it('opens at a point as at an anchor of no size (the context menu)', () => {
    expect(floatBelow(pointAnchor(990, 790), SIZE, VIEW, 8)).toEqual({ left: 790, top: 690 });
  });
  // A layer taller than the window (the View menu's thirty items in a 1280 × 720 window, the user's review of
  // 2026-10-05, LR2) opens on the side with more room, as tall as that room, and scrolls (VS Code's menus: maxHeight is
  // the window's height under the menu's top)
  it('limits a layer taller than the window to the room on the side with more of it', () => {
    expect(floatBelow({ left: 100, top: 10, right: 180, bottom: 40 }, { width: 200, height: 900 }, VIEW, 8)).toEqual({ left: 100, top: 40, maxHeight: 752 });
    expect(floatBelow({ left: 100, top: 760, right: 180, bottom: 784 }, { width: 200, height: 900 }, VIEW, 8)).toEqual({ left: 100, top: 8, maxHeight: 752 });
  });
});

describe('floatBeside', () => {
  const ITEM = { left: 100, top: 300, right: 340, bottom: 326 };
  it('opens a submenu beside its item, its first item level with it', () => {
    expect(floatBeside(ITEM, SIZE, VIEW, 8, 4)).toEqual({ left: 340, top: 296 });
  });
  it("opens on the item's other side when the window ends on the right", () => {
    expect(floatBeside({ left: 700, top: 300, right: 940, bottom: 326 }, SIZE, VIEW, 8, 4)).toEqual({ left: 500, top: 296 });
  });
  it('rises to stay inside the window at the bottom', () => {
    expect(floatBeside({ left: 100, top: 760, right: 340, bottom: 786 }, SIZE, VIEW, 8, 4)).toEqual({ left: 340, top: 692 });
  });
  it('limits a submenu taller than the window to the window', () => {
    expect(floatBeside(ITEM, { width: 200, height: 900 }, VIEW, 8, 4)).toEqual({ left: 340, top: 8, maxHeight: 784 });
  });
});

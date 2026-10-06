// The arrangement of the canvas controls (DEC-75; the root-cause study of 2026-10-06, CR3): every control drawn about
// the selection has one layer, and one rule decides which gives way where two want the same place. Before it, each
// control had its own rule of place, the stacking was bare numbers, and nothing decided between two controls: the
// north-east rotation zone lay over the quick panel's chip beside a narrow element (AU6-20), the spacing bands of an
// element with no padding lay wholly under its edge grips and handles, drawn where no press could reach them.
//
// The layers, bottom to top, are CANVAS_LAYERS; the stylesheets take each one's z-index from the token of the same
// name (z.canvas-* in design/final/tokens.json, in the same order: arrangement.test.ts). A control takes a press where
// a person presses it at three or more of five points along it (its centre and four more along its length) — the rule
// the screen guard checks after every browser test (tests/support/screen-guard.ts, DEC-74), so the arrangement and its
// check never disagree.
// - Fixed controls keep their place whatever lies there: the label and its companions (DEC-70: the label above its
//   element at its left, the chip or the open panel on its right, the text toolbar above it) and the controls tied to
//   the element's geometry (the resize handles, the edge grips, the anchor tabs).
// - A rotation zone is movable: it takes the first of its places (rotationPlaces) where it and every control it must
//   leave pressable (the chip, the panel, the text toolbar, the resize handles, the anchor tabs, the zones placed
//   before it) all still take a press, keeping clear of the label while one place does; with none, it is not drawn —
//   the other corners still turn the element.
// - An optional control — a spacing band no mode pins, an edge grip, a resize handle — is drawn only where it takes a
//   press under the controls above it (a higher layer, or the same layer drawn after it): the band of an element with
//   no padding lies wholly under its edge grip, the handle at an edge an anchor pins under the anchor's tab (which
//   takes that press on purpose).
import type { Box } from './placement.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

// the layers of the canvas controls, bottom to top
export const CANVAS_LAYERS = ['band', 'edge', 'direct', 'label', 'chip', 'handle', 'rotation', 'anchor', 'panel'] as const;
export type CanvasLayer = (typeof CANVAS_LAYERS)[number];

// the five points a press is tried at, along the control's longer side, and how many must reach it
const SAMPLES = [0.2, 0.35, 0.5, 0.65, 0.8];
const TAKES_PRESS = 3;

const holds = (p: Point, b: Box): boolean => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
const meets = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function samplePoints(box: Box): readonly Point[] {
  const wide = box.width >= box.height;
  return SAMPLES.map((f) => (wide ? { x: box.x + box.width * f, y: box.y + box.height / 2 } : { x: box.x + box.width / 2, y: box.y + box.height * f }));
}

// Whether a control at `box` takes a press with these drawn over it.
export function takesPress(box: Box, over: readonly Box[]): boolean {
  return samplePoints(box).filter((p) => !over.some((o) => holds(p, o))).length >= TAKES_PRESS;
}

// whether two controls drawn over each other both still take a press, whichever is on top
const bothPressable = (a: Box, b: Box): boolean => takesPress(a, [b]) && takesPress(b, [a]);

// the corners of the selection's zones, in the manifest's own handle order
export const ROTATION_SIDES: readonly string[] = ['nw', 'ne', 'se', 'sw'];

// The places a rotation zone tries, in order (spec rotation-handle), in the chrome layer's pixels: first a fixed screen
// distance outside its corner, held inside the canvas — inside the corner on a side where outside would leave the
// canvas, at the canvas's edge when even the corner lies beyond it; then outside the corner beside its vertical side,
// then beside its horizontal side, then inside the corner. Each place turns with the element about its centre (the
// zone is round: turning it is moving it) and is held inside the canvas.
export function rotationPlaces(element: Box, area: { readonly width: number; readonly height: number }, size: number, gap: number, side: string, rotation: number): readonly Point[] {
  const west = side.includes('w');
  const north = side.includes('n');
  const outside = { x: west ? element.x - gap - size : element.x + element.width + gap, y: north ? element.y - gap - size : element.y + element.height + gap };
  const insideX = west ? element.x + gap : element.x + element.width - gap - size;
  const insideY = north ? element.y + gap : element.y + element.height - gap - size;
  const first = {
    x: west ? (outside.x >= 0 ? outside.x : insideX) : outside.x + size <= area.width ? outside.x : insideX,
    y: north ? (outside.y >= 0 ? outside.y : insideY) : outside.y + size <= area.height ? outside.y : insideY,
  };
  const cornerX = west ? element.x : element.x + element.width - size;
  const cornerY = north ? element.y : element.y + element.height - size;
  const places: Point[] = [first, { x: outside.x, y: cornerY }, { x: cornerX, y: outside.y }, { x: insideX, y: insideY }];
  const held = (spot: Point): Point => ({ x: Math.min(Math.max(spot.x, 0), area.width - size), y: Math.min(Math.max(spot.y, 0), area.height - size) });
  const turned = (spot: Point): Point => {
    if (rotation === 0) return spot;
    const radians = (rotation * Math.PI) / 180;
    const centre = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
    const at = { x: spot.x + size / 2 - centre.x, y: spot.y + size / 2 - centre.y };
    return { x: centre.x + at.x * Math.cos(radians) - at.y * Math.sin(radians) - size / 2, y: centre.y + at.x * Math.sin(radians) + at.y * Math.cos(radians) - size / 2 };
  };
  return places.map((spot) => held(turned(held(spot))));
}

// The place a movable control of `size` takes among its `places`: the first where it and every one of `keep` still
// take a press, and clear of all of `rather` while one such place is; null when none leaves `keep` pressable.
export function placeMovable(places: readonly Point[], size: number, keep: readonly Box[], rather: readonly Box[]): Point | null {
  const boxOf = (p: Point): Box => ({ x: p.x, y: p.y, width: size, height: size });
  const free = places.filter((p) => keep.every((b) => bothPressable(boxOf(p), b)));
  return free.find((p) => !rather.some((b) => meets(boxOf(p), b))) ?? free[0] ?? null;
}

// The four zones of the one selected element, in ROTATION_SIDES order: each placed in turn, the zones placed before it
// among the controls it leaves pressable.
export function placeRotationZones(element: Box, area: { readonly width: number; readonly height: number }, size: number, gap: number, rotation: number, keep: readonly Box[], rather: readonly Box[]): readonly (Point | null)[] {
  const placed: Box[] = [];
  return ROTATION_SIDES.map((side) => {
    const spot = placeMovable(rotationPlaces(element, area, size, gap, side, rotation), size, [...keep, ...placed], rather);
    if (spot !== null) placed.push({ x: spot.x, y: spot.y, width: size, height: size });
    return spot;
  });
}

// The controls the chrome reads where they are drawn, each with its layer and whether it may give way; an element takes
// the first rule it matches, and `data-arrange-key` names an optional control to the component that draws it.
export const ARRANGED: readonly { readonly selector: string; readonly layer: CanvasLayer; readonly optional: boolean }[] = [
  { selector: '.chrome__band--auto[data-arrange-key]', layer: 'band', optional: true },
  { selector: '.chrome__band', layer: 'band', optional: false },
  { selector: '[data-chrome="edge"][data-arrange-key]', layer: 'edge', optional: true },
  { selector: '.chrome__direct', layer: 'direct', optional: false },
  { selector: '[data-chrome="label"]:not(.is-measuring), [data-chrome="text-toolbar"]:not(.is-measuring)', layer: 'label', optional: false },
  { selector: '.quick-panel-chip:not(.is-measuring)', layer: 'chip', optional: false },
  { selector: '[data-resize-handle][data-arrange-key]', layer: 'handle', optional: true },
  { selector: '[data-rotate-zone]', layer: 'rotation', optional: false },
  { selector: '.anchor-tab-place', layer: 'anchor', optional: false },
  { selector: '.quick-panel:not(.is-measuring)', layer: 'panel', optional: false },
];
export const ARRANGED_SELECTOR = ARRANGED.map((rule) => rule.selector).join(', ');

export interface Arranged {
  readonly key: string;
  readonly layer: CanvasLayer;
  readonly box: Box;
  readonly optional: boolean;
}

// The optional controls that give way, given every control in drawing order (within one layer, a control drawn later
// lies above one drawn before): from the top down, an optional control that takes no press under the controls kept
// above it gives way, and one that gave way covers nothing below it.
export function yielding(controls: readonly Arranged[]): ReadonlySet<string> {
  const rank = (layer: CanvasLayer) => CANVAS_LAYERS.indexOf(layer);
  const order = controls.map((control, at) => ({ control, at })).sort((a, b) => rank(b.control.layer) - rank(a.control.layer) || b.at - a.at);
  const kept: Box[] = [];
  const out = new Set<string>();
  for (const { control } of order) {
    if (control.optional && !takesPress(control.box, kept)) out.add(control.key);
    else kept.push(control.box);
  }
  return out;
}

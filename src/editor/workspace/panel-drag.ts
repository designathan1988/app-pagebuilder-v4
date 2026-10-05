// The panel drag (specs floating-panels and panel-combine-tabs): where a dragged panel would land, and what that
// place means. The pointer owner (src/editor/input/pointer.ts) runs it — a press on a panel's header
// ([data-panel-header]) opens it, its moves ask `panelHintAt`, its release runs `panelDrop` — and the layer
// (windows.tsx) draws the hint this module publishes. The place comes from where the pointer is: within
// `panels.dockEdgeZone` of the window's left or right edge it docks to that side, over another panel's area it
// combines (the upper `panels.combineTabsFraction` of it as one more tab, the rest stacked under it), anywhere else
// it floats at the drop point. Each place is a door of the manifest, its own arguments naming the place it stands
// for; this module only reads them.
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { PANELS, type Panel } from './panel-catalogue.ts';

const zoneDoor = (zone: string): DoorEntry | null => manifest.doors.find((d) => d.door.kind === 'panel-drag' && (d.door.zone ?? null) === zone && d.door.source === 'panel-header') ?? null;
const ZONE_DOORS: Readonly<Record<string, DoorEntry | null>> = {
  canvas: zoneDoor('canvas'),
  'left-edge': zoneDoor('left-edge'),
  'right-edge': zoneDoor('right-edge'),
  'panel-upper-part': zoneDoor('panel-upper-part'),
  'panel-lower-part': zoneDoor('panel-lower-part'),
};

function constant(id: string): number {
  const value = manifest.interactions.constants.find((c) => c.id === id)?.value;
  if (typeof value !== 'number') throw new Error(`interactions.json has no number ${id}`);
  return value;
}
function range(id: string): readonly [number, number] {
  const value = manifest.interactions.constants.find((c) => c.id === id)?.value;
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number') throw new Error(`interactions.json has no range ${id}`);
  return [value[0], value[1]];
}
const EDGE = constant('panels.dockEdgeZone');
const TABS_FRACTION = constant('panels.combineTabsFraction');
const WINDOW_WIDTH = range('floating.width')[0];
const WINDOW_HEIGHT = range('floating.height')[0];
const MIN_TOP = constant('floating.minTop');

// where a release would land, and the panel it lands on for the two combining places
type PanelZone = 'canvas' | 'left-edge' | 'right-edge' | 'panel-upper-part' | 'panel-lower-part';
export interface PanelHint {
  readonly zone: PanelZone;
  readonly host: Panel | null;
  readonly at: { readonly x: number; readonly y: number };
  // what the hint covers: the strip of the edge, the panel's box, or nothing for a float
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
}

const boxOf = (element: Element): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

// Where a dragged panel would land, from where the pointer is now.
export function panelHintAt(x: number, y: number, dragged: Panel): PanelHint {
  const at = { x, y };
  if (x <= EDGE) return { zone: 'left-edge', host: null, at, box: { x: 0, y: 0, width: EDGE, height: window.innerHeight } };
  if (x >= window.innerWidth - EDGE) return { zone: 'right-edge', host: null, at, box: { x: window.innerWidth - EDGE, y: 0, width: EDGE, height: window.innerHeight } };
  const under = document.elementFromPoint(x, y);
  const area = under?.closest('[data-panel-area]') ?? null;
  const host = area?.getAttribute('data-panel-area') ?? null;
  if (area !== null && host !== null && host !== dragged && host in PANELS) {
    const box = boxOf(area);
    const zone: PanelZone = y < box.y + box.height * TABS_FRACTION ? 'panel-upper-part' : 'panel-lower-part';
    return { zone, host: host as Panel, at, box };
  }
  return { zone: 'canvas', host: null, at, box: null };
}

// Where a floating window is kept: inside the window, its width and a row of its height from the right and the
// bottom, never above the top bar (floating.minTop).
export const keptInside = (point: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } => ({
  x: Math.min(Math.max(0, Math.round(point.x)), Math.max(0, window.innerWidth - WINDOW_WIDTH)),
  y: Math.min(Math.max(MIN_TOP, Math.round(point.y)), Math.max(MIN_TOP, window.innerHeight - WINDOW_HEIGHT)),
});

// the door the release runs, and the arguments its place adds to the command
export const panelDrop = (hint: PanelHint): { readonly door: DoorEntry | null; readonly args: Readonly<Record<string, unknown>> } => {
  const door = ZONE_DOORS[hint.zone] ?? null;
  if (door === null) return { door: null, args: {} };
  if (hint.zone === 'canvas') return { door, args: { at: keptInside(hint.at) } };
  if (hint.zone === 'panel-upper-part' || hint.zone === 'panel-lower-part') return { door, args: hint.host === null ? {} : { host: hint.host } };
  return { door, args: {} };
};

// what the layer draws now, or null while no panel is dragged. View state of the gesture, like the pointer owner's
// drag view: the editor state changes only at the release.
let shown: PanelHint | null = null;
const listeners = new Set<() => void>();
export const panelHint = {
  get: (): PanelHint | null => shown,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function showPanelHint(hint: PanelHint | null): void {
  if (hint === shown) return;
  shown = hint;
  for (const listener of listeners) listener();
}

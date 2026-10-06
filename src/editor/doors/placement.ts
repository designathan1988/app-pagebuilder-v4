// Door placement (PRODUCT.md §5): what a region of PRODUCT.md §5.3 draws and in which order: the doors the manifest
// places there and the buttons of the menus anchored there (layout.json). No list of buttons is written anywhere else.
import type { MenuId, RegionId } from '../../generated/ids.ts';
import type { LayoutFile } from '../../manifest/schema.ts';
import { doorsIn, manifest, type DoorEntry } from '../../manifest/runtime.ts';

export type Anchor = LayoutFile['menus'][number]['anchors'][number];

export type Slot =
  | { readonly kind: 'door'; readonly order: number; readonly entry: DoorEntry }
  | { readonly kind: 'menu'; readonly order: number; readonly menu: MenuId; readonly anchor: Anchor };

const cache = new Map<string, readonly Slot[]>();

// The doors and menu buttons of a region, in their order there.
export function slotsIn(region: RegionId | `menu:${MenuId}`): readonly Slot[] {
  const cached = cache.get(region);
  if (cached) return cached;
  const doors: Slot[] = doorsIn(region as RegionId).map((entry) => ({ kind: 'door', order: typeof entry.door.placement === 'object' ? entry.door.placement.order : 0, entry }));
  const menus: Slot[] = manifest.layout.menus.flatMap((m) => m.anchors.filter((a) => a.region === region).map((anchor) => ({ kind: 'menu' as const, order: anchor.order, menu: m.id as MenuId, anchor })));
  const slots = [...doors, ...menus].sort((a, b) => a.order - b.order);
  cache.set(region, slots);
  return slots;
}

// The doors of a region only, in order.
export function doorSlots(region: RegionId): readonly DoorEntry[] {
  return slotsIn(region).flatMap((s) => (s.kind === 'door' ? [s.entry] : []));
}

// the orders before which a region draws a separator between groups of its controls (layout.json)
export function breaksIn(region: RegionId): readonly number[] {
  return manifest.layout.regions.find((r) => r.id === region)?.breaks ?? [];
}

// how a toolbar or panel control is drawn (the door's drawnAs), null for the other door kinds
export function drawnAsOf(entry: DoorEntry): string | null {
  return entry.door.kind === 'toolbar' || entry.door.kind === 'panel-control' ? entry.door.drawnAs : null;
}

// The control drawn inside an item of a region (a tab's close button, a class chip's ×): the icon button placed right
// after the item (each tab is its name then its close button).
export function partOf(region: RegionId, item: DoorEntry): DoorEntry | null {
  const doors = doorSlots(region);
  const next = doors[doors.indexOf(item) + 1];
  return next !== undefined && drawnAsOf(item) === 'item' && drawnAsOf(next) === 'icon-button' ? next : null;
}

export function menuOf(menu: MenuId): LayoutFile['menus'][number] {
  const found = manifest.layout.menus.find((m) => m.id === menu);
  if (!found) throw new Error(`unknown menu ${menu}`);
  return found;
}

// the icons every control or item of a kind draws (layout.json glyphs)
export const GLYPHS = manifest.layout.glyphs;

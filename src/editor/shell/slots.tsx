// A region's controls in their order: every door as its DoorControl and every menu button as its MenuButton, unless
// the region renders a slot itself (an item with its data, a menu button showing a value).
import { createContext, useContext, type ReactNode } from 'react';
import type { RegionId } from '../../generated/ids.ts';
import { DoorControl } from '../doors/door.tsx';
import { MenuButton } from '../doors/menu.tsx';
import { slotsIn, type Slot } from '../doors/placement.ts';

export function Slots({ region, render, from = 1, to = Number.POSITIVE_INFINITY }: { readonly region: RegionId; readonly render?: (slot: Slot) => ReactNode | undefined; readonly from?: number; readonly to?: number }) {
  return (
    <>
      {slotsIn(region)
        .filter((slot) => slot.order >= from && slot.order <= to)
        .map((slot) => {
          const own = render?.(slot);
          if (own !== undefined) return own;
          return slot.kind === 'door' ? <DoorControl key={slot.entry.ref} entry={slot.entry} /> : <MenuButton key={`${slot.menu}@${slot.anchor.region}`} menu={slot.menu} anchor={slot.anchor} />;
        })}
    </>
  );
}

// The zoom that fits the base breakpoint's width in the stage: a measure of the layout, shared by the frame, the
// canvas toolbar's zoom button and the status bar (the camera and its commands arrive with the canvas). The shell
// holds it; the canvas column measures the stage and reports it.
export const FitZoom = createContext<number>(1);
export const ReportFitZoom = createContext<(zoom: number) => void>(() => undefined);

export function useFitZoom(): number {
  return useContext(FitZoom);
}

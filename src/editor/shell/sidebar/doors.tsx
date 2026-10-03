// What the sidebar's views share (plan I.12: sidebar.tsx split into one file per view): how a door is drawn, the
// door a view requires of its region, and a section's title with the region's controls before its first item.
import type { ReactNode } from 'react';
import type { RegionId } from '../../../generated/ids.ts';
import type { DoorEntry } from '../../../manifest/runtime.ts';
import { doorSlots } from '../../doors/placement.ts';
import { Slots } from '../slots.tsx';

export const drawnAs = (entry: DoorEntry): string | null => (entry.door.kind === 'toolbar' || entry.door.kind === 'panel-control' ? entry.door.drawnAs : null);

export const orderOf = (entry: DoorEntry): number => (typeof entry.door.placement === 'object' ? entry.door.placement.order : 0);

export function requireDoor(region: RegionId, test: (entry: DoorEntry) => boolean): DoorEntry {
  const found = doorSlots(region).find(test);
  if (!found) throw new Error(`region ${region} has no such door`);
  return found;
}

// the order of a region's first item or field: the controls before it are the section's actions
// The order of the region's first door that is drawn as one of its items or fields: the title above draws the doors
// that come before it. A door the caller draws elsewhere (the makers, whose paths are typed into the rows) is not one
// of them: it is skipped here too, or every door between it and the next item would never be drawn.
function itemOrder(region: RegionId, skip?: (entry: DoorEntry) => boolean): number {
  const item = doorSlots(region).find((d) => (drawnAs(d) === 'item' || drawnAs(d) === 'field') && !(skip !== undefined && skip(d)));
  return item ? orderOf(item) : Number.POSITIVE_INFINITY;
}

export function SectionTitle({ title, region, skip, children }: { readonly title: string; readonly region: RegionId; readonly skip?: (entry: DoorEntry) => boolean; readonly children?: ReactNode }) {
  return (
    <div className="section-title">
      <span className="section-title__text">{title}</span>
      <span className="section-title__actions">
        {children}
        <Slots region={region} to={itemOrder(region, skip) - 1} render={(slot) => (skip !== undefined && slot.kind === 'door' && skip(slot.entry) ? null : undefined)} />
      </span>
    </div>
  );
}

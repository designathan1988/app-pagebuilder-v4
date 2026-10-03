// The tab guard's notice (archive/DESIGN.md "Regions": tab-guard; spec multi-tab-guard): while this tab only reads the
// project, a bar across the top of the window says why (another tab edits it, or took it over) and holds the region's
// door, Take over editing (project.takeOverEditing).
import { useSyncExternalStore } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { FeatureId } from '../../generated/ids.ts';
import { DoorControl } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { tabRole } from '../persistence/tab-guard.ts';
import { useT } from '../text.ts';

const TAKE_OVER = doorSlots('tab-guard')[0];

export function TabGuardNotice() {
  const t = useT();
  const role = useSyncExternalStore(tabRole.subscribe, tabRole.get);
  if (role === 'editing') return null;
  return (
    <div className="tab-guard" data-region="tab-guard" role="alert">
      <span className="tab-guard__message">{t(role === 'lost' ? 'tabGuard.lostNotice' : 'tabGuard.readOnlyNotice')}</span>
      {TAKE_OVER !== undefined ? <DoorControl entry={TAKE_OVER} ready={isFeatureBuilt(TAKE_OVER.door.feature as FeatureId)} className="door--primary" /> : null}
    </div>
  );
}

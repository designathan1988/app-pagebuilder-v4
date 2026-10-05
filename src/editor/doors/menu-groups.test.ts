// A menu's items stand in groups of one kind, a line between groups (Microsoft, "Menu flyout and menu bar": a
// separator visually separates menu items; its View menu example puts a line between each set of options). The
// user's review of 2026-10-05 (LR2) found the View menu's last group holding fifteen items of six kinds — Theme,
// Language, the Motion panel, Breakpoints, Side by side, Run interactions, six resizes and the Layout panel — with the
// Motion and Layout panels far from the others, and its Code item the only one wearing an icon where its peers wear a
// check mark.
import { describe, expect, it } from 'vitest';
import type { MenuId } from '../../generated/ids.ts';
import { manifest } from '../../manifest/runtime.ts';
import { slotsIn, type Slot } from './placement.ts';

const MENUS = manifest.layout.menus.map((m) => m.id as MenuId);
const breaksOf = (menu: MenuId): readonly number[] => manifest.layout.menus.find((m) => m.id === menu)?.breaks ?? [];

// a menu's items, group by group, as drawn (a line before each order its breaks name)
function groupsOf(menu: MenuId): Slot[][] {
  const groups: Slot[][] = [];
  for (const slot of slotsIn(`menu:${menu}`)) {
    if (groups.length === 0 || breaksOf(menu).includes(slot.order)) groups.push([]);
    groups.at(-1)?.push(slot);
  }
  return groups;
}
const kindOf = (slot: Slot): string => (slot.kind === 'door' ? slot.entry.command.id : 'submenu');

describe('the groups of the menus', () => {
  it('keeps every View item that shows or hides a panel in one group, with nothing else in it', () => {
    const panels = groupsOf('view').filter((group) => group.some((slot) => kindOf(slot) === 'workspace.setPanelOpen'));
    expect(panels).toHaveLength(1);
    expect(panels[0]?.map(kindOf).every((kind) => kind === 'workspace.setPanelOpen')).toBe(true);
  });

  it('holds no group of more than ten items unless it is one choice among many (the states, the zooms)', () => {
    for (const menu of MENUS) {
      for (const group of groupsOf(menu)) {
        if (group.length <= 10) continue;
        expect(new Set(group.map(kindOf)).size, `${menu}: a group of ${group.length} mixes kinds`).toBe(1);
      }
    }
  });

  it('draws the Code view as a choice, checked while it is the view, as the toolbar presses its segment', () => {
    const code = slotsIn('menu:view').find((slot) => slot.kind === 'door' && slot.entry.command.id === 'view.setEditorView');
    expect(code?.kind === 'door' ? code.entry.door : null).toMatchObject({ kind: 'menu', checked: 'radio' });
  });
});

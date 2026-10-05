// Snap (INVENTORY.md, owners; spec snap-toggle-settings): whether snapping is on, the targets a moved or
// resized edge is pulled to and the distance within which it is, all workspace preferences in the one preferences store
// (Problems in Pager 3), restored after a reload, never in the document nor the history.
//  - snap.setEnabled: the Snap button toggles it (Problems in Pager 1: one click), the Snap menu's On and Off set it;
//    the status bar says which. Off by default.
//  - snap.setSettings: Apply in Snap settings keeps the targets ticked and the distance typed, and closes the dialog;
//    it leaves snap on or off as it was (Problems in Pager 2). A distance out of snap.distanceMin–snap.distanceMax is
//    refused (status.snap.distanceRange) and the dialog stays open.
// The targets are those snap.setSettings offers (manifest), every one ticked by default; the distance is snap.distance
// by default. snapSettingsOf gives what is in force, for the snapping gestures and the dialog.
import { message, registerHandler } from '../../core/commands/registry.ts';
import { commandOf, numberConstant } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';

const SNAP_DISTANCE = numberConstant('snap.distance');
const DISTANCE_MIN = numberConstant('snap.distanceMin');
const DISTANCE_MAX = numberConstant('snap.distanceMax');

export interface SnapSettings {
  readonly targets: readonly string[];
  readonly distance: number;
}
export interface SnapInForce extends SnapSettings {
  readonly on: boolean;
}

const withinRange = (distance: number) => Number.isFinite(distance) && distance >= DISTANCE_MIN && distance <= DISTANCE_MAX;
// the targets a list names, in the manifest's order
const targetsIn = (list: readonly unknown[]): readonly string[] => SNAP_TARGETS.filter((t) => list.includes(t));

export function snapSettingsOf(ui: EditorUi): SnapInForce {
  const kept = ui.preferences.snapSettings;
  return { on: ui.preferences.snap === true, targets: kept?.targets ?? SNAP_TARGETS, distance: kept?.distance ?? SNAP_DISTANCE };
}

// The stored snap settings when they are ones Snap settings keeps: targets it offers, a distance within its range;
// undefined otherwise (the defaults).
export function readSnapSettings(stored: unknown): SnapSettings | undefined {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
  const { targets, distance } = stored as Record<string, unknown>;
  if (!Array.isArray(targets) || typeof distance !== 'number' || !withinRange(distance)) return undefined;
  return { targets: targetsIn(targets), distance };
}

export const setSnapEnabled = registerHandler<'snap.setEnabled', EditorUi>(
  'snap.setEnabled',
  ({ state }, { enabled }) => {
    const was = state.ui.preferences.snap === true;
    const on = enabled === 'toggle' ? !was : enabled === 'on';
    const said = message(on ? 'status.snap.on' : 'status.snap.off');
    if (on === was) return { kind: 'change', message: said };
    const { snap: _was, ...rest } = state.ui.preferences;
    void _was;
    return { kind: 'change', ui: { ...state.ui, preferences: on ? { ...rest, snap: true } : rest }, message: said };
  },
  // the Snap button stands for snap being on, each menu item for its own state
  (state, args) => (args.enabled === 'off' ? state.ui.preferences.snap !== true : state.ui.preferences.snap === true),
);

export const setSnapSettings = registerHandler<'snap.setSettings', EditorUi>('snap.setSettings', ({ state }, { targets, distance }) => {
  if (!Array.isArray(targets) || targets.some((t) => typeof t !== 'string' || !SNAP_TARGETS.includes(t))) throw new Error(`snap.setSettings: targets is a list of ${SNAP_TARGETS.join(', ')}`);
  if (!withinRange(distance)) return { kind: 'refused', message: message('status.snap.distanceRange') };
  const kept = targetsIn(targets);
  const byDefault = distance === SNAP_DISTANCE && kept.length === SNAP_TARGETS.length;
  const { dialog: _closed, ...ui } = state.ui;
  void _closed;
  const { snapSettings: _stored, ...preferences } = state.ui.preferences;
  void _stored;
  return { kind: 'change', ui: { ...ui, preferences: byDefault ? preferences : { ...preferences, snapSettings: { targets: kept, distance } } }, message: message('status.snap.settingsKept') };
});

// the targets Snap settings offers, those snap.setSettings takes (manifest)
export const SNAP_TARGETS: readonly string[] = commandOf(setSnapSettings.command).args.targets?.values ?? [];

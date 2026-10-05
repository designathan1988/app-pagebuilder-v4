// The doors the motion surfaces draw, read from the manifest's own data (manifest/commands/motion.json): every button,
// field, row and handle of the Interactions tab's motion cards and of the Timeline is the control of one of these, so
// nothing is drawn that the manifest does not declare, and a door whose feature is not built is drawn unavailable by
// the controls themselves (PanelField, PanelButton: src/editor/shell/panel-field.tsx).
import type { DoorEntry } from '../../../manifest/runtime.ts';
import { manifest } from '../../../manifest/runtime.ts';

// the door an entry point of a motion command stands for, by the door's own id (unique among the manifest's doors:
// doors.test.ts proves it), so no command or door reference is written here by hand
export function motionDoor(id: string): DoorEntry {
  const found = manifest.doors.find((door) => door.door.id === id);
  if (found === undefined) throw new Error(`motion: the manifest has no door ${id}`);
  return found;
}

const kebab = (field: string): string => field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// The motion doors by their ids (manifest/commands/motion.json entryPoints), a function where the id carries what the
// control stands for (a field, a placement, a behaviour).
export const MOTION_DOORS = {
  add: 'inspector-motion-add',
  remove: 'inspector-motion-remove',
  field: (field: string) => `inspector-motion-${kebab(field)}`,
  once: 'inspector-motion-once',
  newTimeline: 'timeline-motion-new-timeline',
  timelineName: 'timeline-motion-timeline-name',
  timelineDelete: 'timeline-motion-timeline-delete',
  timelineRow: 'timeline-motion-timeline-row',
  addAction: (placement: 'after' | 'with' | 'at') => `timeline-motion-add-action-${placement}`,
  actionField: (field: string) => `timeline-motion-action-${kebab(field)}`,
  actionYoyo: 'timeline-motion-action-yoyo',
  actionPick: 'timeline-motion-action-pick',
  canvasPick: 'canvas-click-pick-motion-target',
  layersPick: 'layers-row-pick-motion-target',
  effectOption: 'timeline-motion-effect-option',
  actionsDelete: 'timeline-motion-actions-delete',
  barDrag: 'panel-drag-motion-bar',
  barStart: 'panel-drag-motion-bar-start',
  barEnd: 'panel-drag-motion-bar-end',
  barSelect: 'timeline-motion-bar',
  barSelectAdd: 'timeline-motion-bar-add',
  keyframeSelect: 'timeline-motion-keyframe',
  keyframeSelectAdd: 'timeline-motion-keyframe-add',
  playhead: 'panel-drag-motion-playhead',
  zoomIn: 'timeline-motion-zoom-in',
  zoomOut: 'timeline-motion-zoom-out',
  snap: 'timeline-motion-snap',
  addMarker: 'timeline-motion-add-marker',
  markerDrag: 'panel-drag-motion-marker',
  markerName: 'timeline-motion-marker-name',
  markerRemove: 'timeline-motion-marker-remove',
  addKeyframe: 'timeline-motion-add-keyframe',
  addProperty: 'timeline-motion-add-property',
  keyframeField: (field: 'value' | 'easing' | 'time' | 'property') => `timeline-motion-keyframe-${field}`,
  keyframeDrag: 'panel-drag-motion-keyframe',
  keyframesDelete: 'timeline-motion-keyframes-delete',
  keyframesCopy: 'timeline-motion-keyframes-copy',
  keyframesPaste: 'timeline-motion-keyframes-paste',
  record: 'timeline-motion-record',
  preview: (operation: 'play' | 'pause' | 'stop') => `timeline-motion-${operation}`,
  run: 'menu-view-run-interactions',
  behaviour: (kind: string) => `inspector-motion-behaviour-${kind}`,
  behaviourAmount: 'inspector-motion-behaviour-amount',
  behaviourAxis: (axis: 'x' | 'y') => `inspector-motion-behaviour-axis-${axis}`,
  behaviourRemove: 'inspector-motion-behaviour-remove',
} as const;

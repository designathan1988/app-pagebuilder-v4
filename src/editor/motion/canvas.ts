// Motion on the editor's canvas (plan stage 10, "Rodar no editor"; spec motion-run-in-editor and motion-timeline,
// Preview): the same runtime as the page, started by the canvas owner (src/editor/canvas/frame.tsx) inside the canvas's
// iframe, with every element addressed by the canvas's own mark (data-node) instead of the export's classes.
//  - Run mode: the canvas runs the interactions as the page would (the trigger's events reach the page because the
//    pointer owner lets presses through while the canvas runs: spec motion-run-in-editor). Navigation and form
//    submission never leave the editor (the runtime's canvas mode).
//  - Preview: while the Timeline's playhead moves, the open timeline is drawn at the playhead on every element that
//    plays it (or on the selected element when nothing plays it yet); nothing is bound.
// The canvas re-renders a node when the document changes: the owner disposes the controller before it renders and
// starts a new one after, so the runtime never holds an element the canvas replaced.
import type { NodeId } from '../../generated/commands.ts';
import { playedClassName } from '../../core/animation/animation.ts';
import type { DocumentJson } from '../../core/document/model.ts';
import type { ModelRules } from '../../core/document/validate.ts';
import { motionConfig, type RuntimeConfig } from '../../core/motion/export.ts';
import type { RuntimeProblem } from './runtime/kit.ts';
import { startOn } from './runtime/compose.ts';
import type { MotionController } from './runtime/start.ts';
import { rulesForDocument } from '../../core/document/breakpoints.ts';

// the canvas's own mark of a rendered node (editor/canvas/render/render.ts writes data-node on every element it draws)
export const canvasSelector = (node: NodeId): string => `[data-node="${node.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;

function canvasMotionConfig(document: DocumentJson, rules: ModelRules, everyTimeline = false): RuntimeConfig | null {
  return motionConfig(document, { selectorOf: canvasSelector, breakpoints: rulesForDocument(rules, document).output.breakpoints.map(({ id, width, base }) => ({ id, width, base })), playedClassName, everyTimeline });
}

// Run mode: every interaction bound on the canvas's page. Null when the document holds none.
export function runOnCanvas(frame: Window, document: DocumentJson, rules: ModelRules, report: (problem: RuntimeProblem) => void): MotionController | null {
  const config = canvasMotionConfig(document, rules);
  return config === null ? null : startOn(frame, config, { mode: 'canvas', report });
}

// Preview: nothing bound, the open timeline drawn where the playhead is.
export function previewOnCanvas(frame: Window, document: DocumentJson, rules: ModelRules, report: (problem: RuntimeProblem) => void): MotionController | null {
  // a library timeline nothing plays still previews (on the selected element): every timeline is written
  const config = canvasMotionConfig(document, rules, true);
  return config === null ? null : startOn(frame, config, { mode: 'canvas', report, triggers: false });
}

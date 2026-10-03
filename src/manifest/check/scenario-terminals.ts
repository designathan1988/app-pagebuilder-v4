// Every scenario ends on a terminal: the screen, storage after a reload, or the exported file.
import type { CheckContext } from './context.ts';

export function scenarioTerminalsRules(ctx: CheckContext) {
  const { report, features } = ctx;
  // ---- scenario-terminal: a scenario ends on the screen, in storage after a reload, or in the exported files
  for (const f of features) {
    for (const [si, s] of f.feature.scenarios.entries()) {
      const render = s.expect.render;
      const renders = render !== null && render.computed.length + render.geometry.length + render.feedback.length > 0;
      const editor = s.expect.editor;
      const measuresEditor = (editor !== null && editor.regions.length + editor.computed.length > 0) || s.expect.hover !== undefined;
      const persistence = s.expect.persistence;
      const persists = persistence !== null && (persistence.document !== null || persistence.preferences !== null || (persistence.selection ?? null) !== null || (persistence.workspace ?? null) !== null);
      if (!renders && !measuresEditor && !persists && s.expect.export === null) {
        report('scenario-terminal', f.file, `${f.path}.scenarios[${si}].expect`, `scenario ${s.id} has no end terminal: expect render, the editor, persistence (of the document, the preferences, the selection or the workspace) or export`);
      }
    }
  }
}

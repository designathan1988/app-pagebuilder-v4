// The composer's editor state, kept in the editor's own store under the module's namespace (EditorUi.modules): which
// container is composed, which regions are selected, the lens and the tool. It is never document state: leaving the
// composer, or removing the module, leaves nothing behind but the document the composer wrote.
import type { EditorUi, NodeId } from '../../../editor/host.ts';
import type { StrokeMode } from '../gestures/recognize.ts';
import type { Lens } from '../ui/scene.ts';
import { NAMESPACE } from './record.ts';

export interface ComposerState {
  readonly target: NodeId;
  readonly selection: readonly string[];
  readonly lens: Lens;
  readonly tool: StrokeMode;
  // the Layers were open when the tool came on and folded to give its panel the column: putting the tool away (Done,
  // Escape, the Select tool) opens them again
  readonly layers?: boolean;
  // the sidebar view its options are drawn in: putting the tool away gives the sidebar back to the view it showed
  // before the tool came on (`back`: the Assistant whose turn used the tool, AV2), else to the Explorer
  readonly shows?: string;
  readonly back?: string;
}

export const composerOf = (ui: EditorUi): ComposerState | null => (ui.modules?.[NAMESPACE] as ComposerState | undefined) ?? null;

export function withComposer(ui: EditorUi, value: ComposerState | null): EditorUi {
  const { [NAMESPACE]: _dropped, ...others } = ui.modules ?? {};
  void _dropped;
  const modules = value === null ? others : { ...others, [NAMESPACE]: value };
  const { modules: _old, ...rest } = ui;
  void _old;
  return Object.keys(modules).length === 0 ? rest : { ...rest, modules };
}

import { message, registerHandler } from '../../core/commands/registry.ts';
import { findCaptured } from '../../core/capture/edits.ts';
import type { EditorUi } from '../state.ts';

// Captured content shares the document store but has a distinct editing vocabulary. Keeping its
// selected id in editor UI avoids dispatching authored-element commands on an arbitrary HTML node.
export const selectCapturedCommand = registerHandler<'capture.select', EditorUi>('capture.select', ({ state }, { target }) => {
  const found = findCaptured(state.document, target);
  if (found === null) return { kind: 'refused', message: message('status.capture.nodeMissing') };
  const name = found.node.kind === 'element' ? found.node.tag : found.node.kind;
  return { kind: 'change', ui: { ...state.ui, capturedNode: target }, selection: [], message: message('status.selected', { name }) };
});

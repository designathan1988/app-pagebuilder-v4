// Whether a door stands for the current state (a checked menu item, a pressed toggle), read from the editor state
// the store holds by its command's owner (the `current` it registers beside its handler). Only a built command has a
// state to show: a door whose command is not built yet stands for nothing (useDoor asks only for built ones), so no
// tab, segment or item looks selected before its command exists.
import { isBuilt, type RegisteredHandler } from '../../core/commands/registry.ts';
import type { CommandId } from '../../generated/ids.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import type { EditorUi } from '../state.ts';
import { MODEL_RULES, type EditorState } from '../store.ts';
import { wiring } from '../wiring.ts';

// The words a door's label fills in for the state now (the handler's labelParams), empty when it fills in none.
export function labelParamsOf(entry: DoorEntry, state: EditorState): Readonly<Record<string, string>> {
  const handler = wiring().commands[entry.command.id];
  if (!isBuilt(handler)) return {};
  return (handler as RegisteredHandler<CommandId, EditorUi>).labelParams?.(state, MODEL_RULES) ?? {};
}

export function isCurrent(entry: DoorEntry, state: EditorState, args: Readonly<Record<string, unknown>> = {}): boolean {
  const handler = wiring().commands[entry.command.id];
  if (!isBuilt(handler)) return false;
  const current = (handler as RegisteredHandler<CommandId, EditorUi>).current;
  return current?.(state, { ...entry.door.args, ...args }, MODEL_RULES) ?? false;
}

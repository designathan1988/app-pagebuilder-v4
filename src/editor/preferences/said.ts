// What a preference change says in the status bar (PRODUCT.md §5; the audit's
// A3.41:
// every preference change reports). The preference is named by its command's label and the value chosen by the label
// of the door that stands for it, both the manifest's: "Theme: Dark.", "Outlines: on.", "What each row shows: ID on.".
import { message, type Message } from '../../core/commands/registry.ts';
import type { CommandId, MessageId } from '../../generated/ids.ts';
import { commandOf, manifest } from '../../manifest/runtime.ts';

// the label of the preference: its command's
const preference = (command: CommandId) => ({ key: commandOf(command).labelKey as MessageId });

// the label of the value chosen: the door of the command whose arguments are these
function valueLabel(command: CommandId, args: Readonly<Record<string, unknown>>): { readonly key: MessageId } {
  const door = manifest.doors.find((d) => d.command.id === command && Object.entries(args).every(([name, value]) => (d.door.args as Record<string, unknown>)[name] === value));
  if (door === undefined) throw new Error(`${command}: no door stands for ${JSON.stringify(args)}`);
  return { key: door.door.labelKey as MessageId };
}

// a preference set to one of its values (the theme, the language, the Elements view, the inspector's mode)
export function chosen(command: CommandId, args: Readonly<Record<string, unknown>>): Message {
  return message('status.preference.chosen', { preference: preference(command), value: valueLabel(command, args) });
}

// a switch turned on or off (Outlines, Zones, the rulers, the manual guides, smart guides, equal spacing)
export function switched(command: CommandId, on: boolean): Message {
  return message(on ? 'status.preference.on' : 'status.preference.off', { preference: preference(command) });
}

// one item of a list preference turned on or off (what each Layers row shows)
export function itemSwitched(command: CommandId, args: Readonly<Record<string, unknown>>, on: boolean): Message {
  return message(on ? 'status.preference.itemOn' : 'status.preference.itemOff', { preference: preference(command), value: valueLabel(command, args) });
}

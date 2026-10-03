// Ready-made values with a preview (the plan's stage 3, "valores dinâmicos com prévia"; spec value-presets): a
// property or composite of properties.json may offer presets, each a name and the CSS text it writes. They are drawn
// under the property's first field as thumbnails of themselves — a square wearing the shadow, the radius, the
// opacity — and a click writes the value (style.set, or a shadow's own command), one undo step, on every selected
// element, as typing it would.
import type { CSSProperties } from 'react';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import type { FeatureId, MessageId } from '../../generated/ids.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { useDoor } from '../doors/door.tsx';
import { doorSlots } from '../doors/placement.ts';
import { useT } from '../text.ts';

// the doors a preset runs (the field region's value-preset controls): the one whose command names the target among the
// properties it edits (a shadow: style.setShadows, which takes the whole value as its CSS text, as the shadow editor's
// CSS row does), else the one that writes any property (style.set)
const PRESETS = doorSlots('field').filter((d) => d.door.kind === 'panel-control' && d.door.control === 'value-preset');
const OWN = (target: string) => PRESETS.find((d) => d.command.args.property?.values.includes(target) === true);
const ANY = PRESETS.find((d) => d.command.args.property?.type === 'property');
const doorOf = (target: string): DoorEntry | undefined => OWN(target) ?? ANY;
// what the door runs with: the property and the value, or (a command of its own) the value as its whole CSS text
const argsOf = (entry: DoorEntry, target: string, value: string): Readonly<Record<string, unknown>> => (entry === OWN(target) ? { property: target, edit: { css: value } } : { property: target, value });

interface Preset {
  readonly id: string;
  readonly labelKey: string;
  readonly value: string;
}

const BY_TARGET = new Map<string, readonly Preset[]>([...manifest.properties.properties, ...manifest.properties.composites].flatMap((target) => (target.presets === undefined ? [] : [[target.id, target.presets] as const])));

// the presets a property or composite offers (none for most)
export const valuePresetsOf = (target: string): readonly Preset[] => BY_TARGET.get(target) ?? [];

export function ValuePresets({ target, label }: { readonly target: string; readonly label: string }) {
  const t = useT();
  const presets = valuePresetsOf(target);
  const entry = doorOf(target);
  if (entry === undefined || presets.length === 0) return null;
  return (
    <div className="value-presets" role="group" aria-label={t('preset.list', { property: label })} data-presets={target}>
      {presets.map((preset) => (
        <PresetThumb key={preset.id} entry={entry} target={target} preset={preset} />
      ))}
    </div>
  );
}

function PresetThumb({ entry, target, preset }: { readonly entry: DoorEntry; readonly target: string; readonly preset: Preset }) {
  const t = useT();
  const args = argsOf(entry, target, preset.value);
  const name = t(preset.labelKey as MessageId);
  const said = t('preset.use', { name, value: preset.value });
  const door = useDoor(entry, args, said, isFeatureBuilt(entry.door.feature as FeatureId));
  return (
    <button
      type="button"
      className={`value-preset door${door.available ? '' : ' is-unavailable'}`}
      data-door={entry.ref}
      data-args={JSON.stringify(args)}
      data-preset-of={target}
      title={door.available ? said : door.title}
      aria-label={said}
      aria-disabled={door.available ? undefined : true}
      style={{ '--preset-value': preset.value } as CSSProperties}
      onClick={door.run}
    >
      <span className="value-preset__thumb" aria-hidden />
      <span className="value-preset__name">{name}</span>
    </button>
  );
}

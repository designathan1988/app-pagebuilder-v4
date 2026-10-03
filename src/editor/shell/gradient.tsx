// The gradient editor (spec gradient-editor): the controls of the background image's gradient, each a door of
// style.setBackgroundImage placed in the Style tab (the command's `edit`, core/style/gradient.ts):
//  - Add a gradient and Remove the gradient; Reverse the stops, Distribute evenly and Add a stop (at 50 %, in the
//    colour the gradient has there): buttons whose door gives their edit;
//  - Linear, Radial, Conic: one button per type, the angle the editor kept for that type with it (Problems in Pager 3);
//  - the bar: the gradient over a checkerboard with its stops under it; a click on the bar adds a stop there; a stop
//    pressed is chosen and dragged along the bar (the pointer owner's drag, src/editor/input/pointer.ts); a focused
//    stop moves with the arrows and goes with Delete or Backspace (the keymap's gradient-stop keys);
//  - Stop colour, Stop position and Angle: text fields; Remove this stop removes the chosen stop.
// The stop the fields edit and the angles kept are the editor's view (src/editor/inspector/gradient-view.ts).
import { useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import type { CommandId, MessageId } from '../../generated/ids.ts';
import { styleSource } from '../inspector/style-target.ts';
import { MIN_STOPS, gradientLayer, parseGradient, writeGradient, type Gradient, type GradientType } from '../../core/style/gradient.ts';
import { storedValue } from '../../core/style/stored.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { Icon, type DoorState } from '../doors/door.tsx';
import { gradientView } from '../inspector/gradient-view.ts';
import { layeredRules, useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { propertyWord, TextStyleField } from './field.tsx';
import { useFieldAppearance } from './field-face.tsx';

const TYPES: readonly GradientType[] = ['linear', 'radial', 'conic'];
// the stop drag's door: each stop under the bar is drawn by it
const STOP_DRAG = manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === 'gradient-stop');
// the key context of a focused stop (interactions.json)
const STOP_CONTEXT = 'gradient-stop';

// the gradient controls, by their door's control
export function isGradientControl(entry: DoorEntry): boolean {
  return entry.door.kind === 'inspector-field' && entry.door.control.startsWith('gradient-');
}

function useGradient(property: string): { readonly gradient: Gradient | null; readonly selected: boolean } {
  const held = useEditorState((s) => {
    const node = styleSource(s);
    return node ? storedValue(node, property, layeredRules(s)) : undefined;
  });
  const selected = useEditorState((s) => s.selection.length > 0);
  // the gradient layer of the value (an image under it stays: A3.34)
  return { gradient: parseGradient(gradientLayer(held) ?? undefined), selected };
}

const useChosenStop = (): number => useSyncExternalStore(gradientView.subscribe, gradientView.stop);

// a button of the editor: its row stands for the edit it runs (the door's own, or the one it computes)
function EditButton({ entry, door, property, edit, ready }: { readonly entry: DoorEntry; readonly door: DoorState; readonly property: string; readonly edit: Record<string, unknown>; readonly ready: boolean }) {
  const store = useStore();
  const t = useT();
  const named = entry.door.kind === 'inspector-field' && entry.door.control === 'gradient-add' ? entry.door.composite : null;
  const appearance = useFieldAppearance([property]);
  const args = { ...entry.door.args, property, edit };
  return (
    <div className={`field-row${ready ? '' : ' is-unavailable'}`} data-origin={appearance.kind} data-door={entry.ref} data-args={JSON.stringify(args)} title={door.title}>
      <span className="field-row__label">{named === null ? '' : propertyWord(t, named)}</span>
      <button
        type="button"
        className={`door door--button${ready ? '' : ' is-unavailable'}`}
        aria-disabled={ready ? undefined : true}
        onClick={() => (ready ? (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, args) : undefined)}
      >
        {entry.door.icon !== null ? <Icon name={entry.door.icon} size="sm" /> : null}
        <span className="door__label">{door.face}</span>
      </button>
    </div>
  );
}

function TypeButtons({ entry, door, property, gradient, ready }: { readonly entry: DoorEntry; readonly door: DoorState; readonly property: string; readonly gradient: Gradient | null; readonly ready: boolean }) {
  const t = useT();
  const store = useStore();
  const appearance = useFieldAppearance([property]);
  useSyncExternalStore(gradientView.subscribe, gradientView.stop);
  return (
    <div className={`field-row${ready ? '' : ' is-unavailable'}`} data-origin={appearance.kind} title={door.title}>
      <span className="field-row__label">{door.label}</span>
      <span className="segmented segmented--wide" role="group" aria-label={door.label}>
        {TYPES.map((type) => {
          const angle = gradient === null ? 0 : gradientView.angleFor(type, gradient.angle);
          const args = { property, edit: { type, angle } };
          const current = gradient?.type === type;
          return (
            <button
              key={type}
              type="button"
              className={`door door--segment${ready ? '' : ' is-unavailable'}${current ? ' is-current' : ''}`}
              data-door={entry.ref}
              data-args={JSON.stringify(args)}
              aria-pressed={current}
              aria-disabled={ready ? undefined : true}
              onClick={() => {
                if (!ready || gradient === null || current) return;
                // the angle the type leaves is kept for it, and the one kept for the type chosen comes back
                gradientView.keepAngle(gradient.type, gradient.angle);
                (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, args);
              }}
            >
              <span className="door__label">{t(`inspector.gradient.${type}` as MessageId)}</span>
            </button>
          );
        })}
      </span>
    </div>
  );
}

function Bar({ entry, door, property, gradient, ready }: { readonly entry: DoorEntry; readonly door: DoorState; readonly property: string; readonly gradient: Gradient | null; readonly ready: boolean }) {
  const t = useT();
  const store = useStore();
  const chosen = useChosenStop();
  // a click on the bar itself (not on a stop) adds a stop there, a whole per cent from its left edge
  const addHere = (event: MouseEvent<HTMLDivElement>) => {
    if (!ready || gradient === null || event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
    const result = (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, { property, edit: { addStopAt: at } });
    if (result.status === 'done') gradientView.chooseStop(gradient.stops.filter((s) => s.position <= at).length);
  };
  const preview = gradient === null ? null : writeGradient({ ...gradient, type: 'linear', angle: 90 });
  return (
    <div className={`field-row field-row--wide${ready ? '' : ' is-unavailable'}`} title={door.title}>
      <span className="field-row__label">{gradient === null ? t('inspector.gradient.none') : ''}</span>
      <div className="gradient__track">
        {/* the bar: a click adds a stop where it lands (its door stands for the property it edits) */}
        {/* Add a stop is the keyboard's way to add one: the bar itself is not a control of the Tab order */}
        <div
          className="gradient__bar"
          data-door={entry.ref}
          data-args={JSON.stringify({ property })}
          data-gradient-bar=""
          aria-label={door.label}
          aria-disabled={ready ? undefined : true}
          style={{ '--gradient-preview': preview ?? 'none' } as CSSProperties}
          onClick={addHere}
        >
          {gradient !== null && STOP_DRAG !== undefined
            ? gradient.stops.map((stop, i) => (
                <button
                  key={`${i}-${stop.position}`}
                  type="button"
                  className={`gradient__stop${i === chosen ? ' is-current' : ''}`}
                  data-door={STOP_DRAG.ref}
                  data-args={JSON.stringify({ property, edit: { stop: i } })}
                  data-key-context={STOP_CONTEXT}
                  aria-pressed={i === chosen}
                  aria-label={t('inspector.gradient.stop', { n: i + 1, position: Math.round(stop.position) })}
                  style={{ '--stop-at': `${stop.position}%`, '--stop-colour': stop.color } as CSSProperties}
                  onFocus={() => gradientView.chooseStop(i)}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}

export function GradientControl({ entry, door }: { readonly entry: DoorEntry; readonly door: DoorState }) {
  const property = typeof entry.door.args.property === 'string' ? entry.door.args.property : entry.door.kind === 'inspector-field' ? (entry.door.property ?? '') : '';
  const { gradient, selected } = useGradient(property);
  const chosen = useChosenStop();
  const stop = gradient === null ? 0 : Math.min(chosen, gradient.stops.length - 1);
  const control = entry.door.kind === 'inspector-field' ? entry.door.control : '';
  const editing = door.available && selected && gradient !== null;
  // The controls of a layer are drawn only while the value holds one (A3.34, the shadow editor's rule): with no
  // gradient the editor draws Add a gradient alone, never a dead type button, bar, stop field or Remove the gradient.
  if (gradient === null && control !== 'gradient-add') return null;
  switch (control) {
    case 'gradient-add':
      return <EditButton entry={entry} door={door} property={property} edit={{ add: true }} ready={door.available && selected && gradient === null} />;
    case 'gradient-type':
      return <TypeButtons entry={entry} door={door} property={property} gradient={gradient} ready={editing} />;
    case 'gradient-bar':
      return <Bar entry={entry} door={door} property={property} gradient={gradient} ready={editing} />;
    case 'gradient-remove-stop':
      return <EditButton entry={entry} door={door} property={property} edit={{ stop, removeStop: true }} ready={editing && gradient.stops.length > MIN_STOPS} />;
    case 'gradient-stop-colour':
    case 'gradient-stop-position':
    case 'gradient-angle': {
      const part = {
        show: () => (gradient === null ? '' : control === 'gradient-angle' ? `${gradient.angle}deg` : control === 'gradient-stop-colour' ? (gradient.stops[stop]?.color ?? '') : `${gradient.stops[stop]?.position ?? ''}`),
        args: (text: string) => ({ property, edit: control === 'gradient-angle' ? { angle: text } : control === 'gradient-stop-colour' ? { stop, color: text } : { stop, position: text } }),
      };
      // the stop's colour is a part of the gradient value: shown as a sample (A3.29)
      return <TextStyleField entry={entry} door={{ ...door, available: editing }} property={property} longhands={null} label={door.label} part={part} sample={control === 'gradient-stop-colour'} />;
    }
    default: {
      const edit = entry.door.args.edit;
      return <EditButton entry={entry} door={door} property={property} edit={edit !== null && typeof edit === 'object' ? (edit as Record<string, unknown>) : {}} ready={control === 'gradient-reset' ? door.available && selected && gradient !== null : editing} />;
    }
  }
}

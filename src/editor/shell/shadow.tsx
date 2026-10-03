// The shadow editor (spec shadow-editor): the controls of a box shadow or a text shadow, each a door of
// style.setShadows placed in the Style tab (the command's `edit`, core/style/shadows.ts):
//  - Add a shadow (a layer appended and chosen) with the rows of the layers under it: a row per layer, its values
//    written, dimmed while hidden; a click on a row chooses the layer the fields edit;
//  - the light pad, above X: a press puts the light where it lands (X and Y the pointer's offset from the pad's centre,
//    the pointer owner's drag, src/editor/input/pointer.ts) and the drag moves it; focused, the arrows move it 1 px,
//    Shift 10 px (the keymap's shadow-pad keys), the focus staying on the pad (Problems in Pager 3);
//  - X, Y, Blur, Spread and the colour: text fields of the chosen layer; Inset and Show or hide: toggles of it; Remove
//    this shadow and Remove every shadow: buttons.
// The layer chosen is the editor's view (src/editor/inspector/shadow-view.ts).
import { useSyncExternalStore, type CSSProperties } from 'react';
import type { CommandId, DoorId } from '../../generated/ids.ts';
import type { StructuredLayer } from '../../core/document/model.ts';
import { styleSource } from '../inspector/style-target.ts';
import { shadowCss } from '../../core/style/shadows.ts';
import { storedLayers } from '../../core/style/stored.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import { manifest, type DoorEntry } from '../../manifest/runtime.ts';
import { Icon, type DoorState } from '../doors/door.tsx';
import { shadowView } from '../inspector/shadow-view.ts';
import { MODEL_RULES, useEditorState, useStore, layeredRules } from '../store.ts';
import { useT } from '../text.ts';
import { propertyWord, TextStyleField } from './field.tsx';
import { useFieldAppearance } from './field-face.tsx';

// the key context of the light pad (interactions.json)
const PAD_CONTEXT = 'shadow-pad';
// the fields a text field of the editor sets, by its door's control
const TEXT_OF: Readonly<Record<string, { readonly edit: string; readonly field: string }>> = {
  'shadow-x': { edit: 'x', field: 'offsetX' },
  'shadow-y': { edit: 'y', field: 'offsetY' },
  'shadow-blur': { edit: 'blur', field: 'blur' },
  'shadow-spread': { edit: 'spread', field: 'spread' },
};

export function isShadowControl(entry: DoorEntry): boolean {
  return entry.door.kind === 'inspector-field' && entry.door.control.startsWith('shadow-');
}

// the light pad's drag of a shadow property: its panel drag, pressed on the pad
const padOf = (property: string): DoorEntry | undefined => manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === `${property}-pad`);
// the drag of a row among the layers (A3.34): its panel drag, pressed on the row
const layerDragOf = (property: string): DoorEntry | undefined => manifest.doors.find((d) => d.door.kind === 'panel-drag' && d.door.source === `${property}-row`);

function useLayers(property: string): { readonly layers: readonly StructuredLayer[]; readonly selected: boolean } {
  const layers = useEditorState((s) => {
    const node = styleSource(s);
    return node ? storedLayers(node, property, layeredRules(s)) : null;
  });
  return { layers: layers ?? [], selected: layers !== null };
}

function run(store: ReturnType<typeof useStore>, entry: DoorEntry, args: Record<string, unknown>): DispatchResult {
  return (store.dispatch as (id: CommandId, a: unknown) => DispatchResult)(entry.command.id as CommandId, args);
}

// a button of the editor: its row stands for the edit it runs
function EditButton({ entry, door, args, ready, pressed = null, onDone }: {
  readonly entry: DoorEntry;
  readonly door: DoorState;
  readonly args: Record<string,
  unknown>;
  readonly ready: boolean;
  readonly pressed?: boolean | null;
  readonly onDone?: () => void
}) {
  const store = useStore();
  const appearance = useFieldAppearance(typeof args.property === 'string' ? [args.property] : []);
  return (
    <div className={`field-row${ready ? '' : ' is-unavailable'}`} data-origin={appearance.kind} data-door={entry.ref} data-args={JSON.stringify(args)} title={door.title}>
      <span className="field-row__label">{pressed === null ? '' : door.label}</span>
      <button
        type="button"
        className={`door ${pressed === null ? 'door--button' : 'door--toggle'}${ready ? '' : ' is-unavailable'}${pressed === true ? ' is-current' : ''}`}
        aria-disabled={ready ? undefined : true}
        aria-pressed={pressed === null ? undefined : pressed}
        onClick={() => {
          if (!ready) return;
          if (run(store, entry, args).status === 'done') onDone?.();
        }}
      >
        {entry.door.icon !== null ? <Icon name={entry.door.icon} size="sm" /> : null}
        <span className="door__label">{door.face}</span>
      </button>
    </div>
  );
}

// The editor's head row: the property's name, "No shadow yet." while it holds none, and Add a shadow as the small +
// at the row's end — one row for an empty editor (the audit's S-025: Add, the note in the label column and a disabled
// Remove every shadow took three)
function AddRow({ entry, door, property, empty, ready, onDone }: { readonly entry: DoorEntry; readonly door: DoorState; readonly property: string; readonly empty: boolean; readonly ready: boolean; readonly onDone: () => void }) {
  const t = useT();
  const store = useStore();
  const args = { property, edit: entry.door.args.edit };
  const appearance = useFieldAppearance([property]);
  return (
    <div className={`field-row shadow__head${ready ? '' : ' is-unavailable'}`} data-origin={appearance.kind}>
      <span className="field-row__label">{propertyWord(t, property)}</span>
      <span className="shadow__add">
        {empty ? <span className="shadow__none">{t('inspector.shadow.none')}</span> : null}
        <button
          type="button"
          className={`door door--icon-button door--sm${ready ? '' : ' is-unavailable'}`}
          data-door={entry.ref}
          data-args={JSON.stringify(args)}
          aria-disabled={ready ? undefined : true}
          // each editor's + names its property: the box's and the text's shared "Add a shadow"
          aria-label={t('inspector.shadow.addTo', { property: propertyWord(t, property) })}
          title={door.title}
          onClick={() => {
            if (ready && run(store, entry, args).status === 'done') onDone();
          }}
        >
          {entry.door.icon !== null ? <Icon name={entry.door.icon} size="sm" /> : <span className="door__label">{door.face}</span>}
        </button>
      </span>
    </div>
  );
}

// A layer's row (the user's real-use audit, item A3.34): its colour as a swatch and what it is in words ("0px, 4px ·
// blur 12px · rgba(15, 23, 42, 0.24)"), never the raw CSS; Inset and hidden are said beside it. The row carries the
// drag (the pointer owner moves the layer among the others, properties.json's door).
function Rows({ property, layers, chosen }: { readonly property: string; readonly layers: readonly StructuredLayer[]; readonly chosen: number }) {
  const t = useT();
  const drag = layerDragOf(property);
  if (layers.length === 0) return null;
  return (
    <ul className="shadow__rows" data-shadow-rows="">
      {layers.map((layer, i) => {
        const colour = typeof layer.colour === 'string' ? layer.colour : '';
        const text = (field: string, fallback: string) => (typeof layer[field] === 'string' ? (layer[field] as string) : fallback);
        const summary = t('inspector.shadow.summary', { x: text('offsetX', '0px'), y: text('offsetY', '0px'), blur: text('blur', '0px'), colour });
        return (
          <li key={i}>
            <button
              type="button"
              className={`shadow__row${i === chosen ? ' is-current' : ''}${layer.hidden === true ? ' is-hidden' : ''}`}
              aria-pressed={i === chosen}
              data-shadow-row=""
              data-door={drag?.ref}
              data-args={drag === undefined ? undefined : JSON.stringify({ property, edit: { move: { from: i } } })}
              onClick={() => shadowView.chooseLayer(property, i)}
              title={summary}
            >
              <span className="shadow__swatch" style={{ '--swatch-colour': colour } as CSSProperties} />
              <span className="shadow__summary">{summary}</span>
              {layer.inset === true ? <span className="shadow__tag">{t('inspector.shadow.inset')}</span> : null}
              {layer.hidden === true ? <span className="shadow__tag">{t('inspector.shadow.hide')}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Pad({ property, layer, chosen, ready }: { readonly property: string; readonly layer: StructuredLayer | undefined; readonly chosen: number; readonly ready: boolean }) {
  const t = useT();
  const pad = padOf(property);
  if (pad === undefined) return null;
  const px = (v: unknown) => (typeof v === 'string' ? parseFloat(v) || 0 : 0);
  // the handle is drawn within the pad (the values go on past its edges)
  const x = Math.max(-46, Math.min(46, px(layer?.offsetX)));
  const y = Math.max(-34, Math.min(34, px(layer?.offsetY)));
  return (
    <div
      className={`shadow__pad${ready ? '' : ' is-unavailable'}`}
      data-door={pad.ref as DoorId}
      data-args={JSON.stringify({ property, edit: { layer: chosen } })}
      data-shadow-pad=""
      data-key-context={PAD_CONTEXT}
      tabIndex={ready ? 0 : -1}
      role="group"
      aria-label={t('inspector.shadow.lightPad')}
      aria-disabled={ready ? undefined : true}
    >
      <span className="shadow__handle" style={{ '--light-x': `${x}px`, '--light-y': `${y}px` } as CSSProperties} />
    </div>
  );
}

export function ShadowControl({ entry, door }: { readonly entry: DoorEntry; readonly door: DoorState }) {
  const t = useT();
  const property = typeof entry.door.args.property === 'string' ? entry.door.args.property : '';
  const { layers, selected } = useLayers(property);
  useSyncExternalStore(shadowView.subscribe, shadowView.version);
  const chosen = Math.min(shadowView.layer(property), Math.max(0, layers.length - 1));
  const layer = layers[chosen];
  const control = entry.door.kind === 'inspector-field' ? entry.door.control : '';
  const editing = door.available && selected && layer !== undefined;
  const fixedEdit = entry.door.args.edit;
  // the controls of a layer are drawn only while the value holds one (A3.34), and Remove every shadow only while there
  // is one to remove: with no shadow the editor is its head row (Add a shadow, "No shadow yet.") and the CSS field
  if (layer === undefined && control !== 'shadow-add' && control !== 'shadow-css') return null;
  switch (control) {
    case 'shadow-add':
      return (
        <>
          <AddRow entry={entry} door={door} property={property} empty={layers.length === 0} ready={door.available && selected} onDone={() => shadowView.chooseLayer(property, layers.length)} />
          {selected ? <Rows property={property} layers={layers} chosen={chosen} /> : null}
        </>
      );
    case 'shadow-reset':
      return <EditButton entry={entry} door={door} args={{ property, edit: fixedEdit }} ready={door.available && selected && layers.length > 0} />;
    case 'shadow-css': {
      // every layer as CSS text (spec shadow-editor, Problems in Pager 4): what the rows show, typed back as one value
      const part = { show: () => (layers.length === 0 ? '' : shadowCss(layers, property, MODEL_RULES)), args: (typed: string) => ({ property, edit: { css: typed } }) };
      return <TextStyleField entry={entry} door={{ ...door, available: door.available && selected }} property={property} longhands={null} label={t('codePanel.pane.css')} part={part} />;
    }
    case 'shadow-remove':
      return <EditButton entry={entry} door={door} args={{ property, edit: { layer: chosen, remove: true } }} ready={editing} />;
    case 'shadow-inset':
      return <EditButton entry={entry} door={door} args={{ property, edit: { layer: chosen, inset: layer?.inset !== true } }} ready={editing} pressed={layer?.inset === true} />;
    case 'shadow-visibility':
      return <EditButton entry={entry} door={door} args={{ property, edit: { layer: chosen, hidden: layer?.hidden !== true } }} ready={editing} pressed={layer?.hidden !== true} />;
    default: {
      const text = TEXT_OF[control];
      const isColour = control === 'shadow-colour';
      const part = {
        show: () => {
          if (layer === undefined) return '';
          const v = isColour ? Object.entries(layer).find(([k, value]) => typeof value === 'string' && !Object.values(TEXT_OF).some((f) => f.field === k))?.[1] : text === undefined ? undefined : layer[text.field];
          return typeof v === 'string' ? v : '';
        },
        args: (typed: string) => ({ property, edit: isColour ? { layer: chosen, color: typed } : { layer: chosen, [text?.edit ?? 'x']: typed } }),
      };
      return (
        <>
          {control === 'shadow-x' ? <Pad property={property} layer={layer} chosen={chosen} ready={editing} /> : null}
          <TextStyleField entry={entry} door={{ ...door, available: editing }} property={property} longhands={null} label={door.label} part={part} sample={isColour} />
        </>
      );
    }
  }
}

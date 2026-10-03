import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import type { DocNode } from '../../core/document/model.ts';
import { walk } from '../../core/document/model.ts';
import { acceptsTextMask } from '../../core/elements/inputs.ts';
import { readFieldConfig, readFormConfig } from '../../core/forms/config.ts';
import type { FieldConfig, FormConfig } from '../../core/forms/types.ts';
import type { CommandId, MessageId } from '../../generated/ids.ts';
import type { FeatureId } from '../../generated/ids.ts';
import { isFeatureBuilt } from '../../core/commands/registry.ts';
import { LOCALES } from '../../generated/ids.ts';
import type { DispatchResult } from '../../core/store/store.ts';
import type { DoorEntry } from '../../manifest/runtime.ts';
import { doorSlots } from '../doors/placement.ts';
import { DoorControl, useDoor } from '../doors/door.tsx';
import { useEditorState, useStore } from '../store.ts';
import { useT } from '../text.ts';
import { markFieldKept, recordFieldInput } from '../input/drafts.ts';
import { keepAfterGesture } from '../shell/field.tsx';
import { FieldFormSettings, FormSubmissionSettings, type FormsSettingsPorts } from './settings.tsx';

const entries = doorSlots('inspector-settings').filter(entry => entry.door.kind === 'inspector-field' && entry.door.control.startsWith('forms-'));
type FieldControl = Parameters<FormsSettingsPorts['field']>[0];
const entryFor = (key: string) => entries.find(entry => entry.door.labelKey === key);
// the one-click switch of a field that cannot take a mask to a text field: its own door (manifest elements.json)
const textForMasksDoor = doorSlots('inspector-settings').find(entry => entry.door.kind === 'inspector-field' && entry.door.control === 'forms-text-for-masks');

function ConfigurationField({ control, entry }: { readonly control: FieldControl; readonly entry: DoorEntry }): ReactNode {
  const store = useStore();
  const t = useT();
  const id = useId();
  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const message = useEditorState(s => s.message);
  const label = t(control.labelKey as MessageId);
  const door = useDoor(entry, {}, label, isFeatureBuilt(entry.door.feature as FeatureId));
  const shown = control.options?.find(option => option.value === String(control.value))?.label ?? String(control.value);
  useEffect(() => {
    if (field.current !== null) {
      field.current.value = shown;
      markFieldKept(field.current, shown);
    }
  }, [shown, message]);
  const keep = () => {
    const input = field.current;
    if (input === null || input.value === shown || !door.available) return;
    const choice = control.options?.find(option => option.label === input.value || option.value === input.value);
    if (control.options !== undefined && choice === undefined) {
      input.value = shown;
      markFieldKept(input, shown);
      return;
    }
    const value = choice?.value ?? input.value;
    keepAfterGesture(store, () => control.onChange(value));
    markFieldKept(input, input.value);
  };
  const argsFor = (value: string) => {
    const next = control.configurationFor?.(value);
    return next === undefined || entry.door.kind !== 'inspector-field' ? {} : { attribute: entry.door.attribute, value: JSON.stringify(next) };
  };
  if (control.kind === 'boolean') return <div className="field-row">
    <span className="field-row__label">{label}</span>
    <span className="segmented segmented--values field-toggle" role="group" aria-label={label}>
      {[false, true].map(value => <button key={String(value)} type="button" data-door={entry.ref} data-args={JSON.stringify(argsFor(String(value)))} className={`door door--segment${control.value === value ? ' is-current' : ''}`} aria-pressed={control.value === value} aria-disabled={!door.available || undefined} title={door.title} data-key-context="roving-group" tabIndex={control.value === value ? undefined : -1} onClick={() => { if (door.available) control.onChange(String(value)); }}>
        <span className="door__label">{t(value ? 'field.toggle.on' : 'field.toggle.off')}</span>
      </button>)}
    </span>
  </div>;
  const common = {
    id, className: 'input', 'aria-label': label, 'data-key-context': 'command-field',
    defaultValue: shown, spellCheck: false, onBlur: keep, disabled: !door.available, title: door.title,
    onInput: (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      recordFieldInput(event.currentTarget, event.nativeEvent);
      if (control.door === 'forms.preview.input') control.onChange(event.currentTarget.value);
    },
  };
  return <form className="field-row" data-door={entry.ref} onSubmit={event => {
    event.preventDefault();
    keep();
  }}>
    <label className="field-row__label" htmlFor={id}>{label}</label>
    {control.kind === 'textarea'
      ? <textarea {...common} ref={field as React.RefObject<HTMLTextAreaElement>} />
      : <input {...common} ref={field as React.RefObject<HTMLInputElement>} inputMode={control.kind === 'number' ? 'decimal' : undefined} list={control.options ? `${id}-options` : undefined} />}
    {control.options && <datalist id={`${id}-options`}>{control.options.map(option => <option key={option.value} value={option.label} />)}</datalist>}
  </form>;
}

function ConfigurationButton({ control, entry }: { readonly control: Parameters<FormsSettingsPorts['button']>[0]; readonly entry: DoorEntry }): ReactNode {
  const t = useT();
  const args = control.configuration === undefined || entry.door.kind !== 'inspector-field' ? {} : { attribute: entry.door.attribute, value: JSON.stringify(control.configuration) };
  const door = useDoor(entry, args, t(control.labelKey as MessageId), isFeatureBuilt(entry.door.feature as FeatureId));
  return <button className="door door--button" type="button" data-door={entry.ref} data-args={JSON.stringify(args)} aria-disabled={!door.available || undefined} title={door.title} onClick={() => {
    if (door.available) control.onClick();
  }}>{t(control.labelKey as MessageId)}</button>;
}

/** All edits pass through the existing attribute handler, validator and undo history. */
export function FormsInspector({ node }: { readonly node: DocNode }): ReactNode {
  const t = useT();
  const store = useStore();
  const document = useEditorState(s => s.document);
  const choices = useMemo(() => {
    const page = document.pages.find(page => [...walk(page.tree)].some(one => one.id === node.id));
    const nodes = page ? [...walk(page.tree)] : [];
    return {
      fields: nodes.filter(one => ['input', 'textarea', 'select'].includes(one.tag ?? '') && typeof one.attributes.name === 'string').map(one => ({ value: String(one.attributes.name), label: `${one.name} · ${String(one.attributes.name)}` })),
      elements: nodes.filter(one => typeof one.attributes.id === 'string' && one.attributes.id !== '').map(one => ({ value: String(one.attributes.id), label: `${one.name} · ${String(one.attributes.id)}` })),
    };
  }, [document, node.id]);
  const form = node.tag === 'form';
  if (!form && !['input', 'textarea', 'select'].includes(node.tag ?? '')) return null;
  const ports: FormsSettingsPorts = {
    t: key => t(key as MessageId), ...choices, locales: LOCALES,
    field: control => {
      const entry = entryFor(control.door);
      if (entry === undefined) throw new Error(`Missing forms control: ${control.door}`);
      return <ConfigurationField control={control} entry={entry} />;
    },
    button: control => {
      const entry = entryFor(control.door);
      if (entry === undefined) throw new Error(`Missing forms control: ${control.door}`);
      return <ConfigurationButton control={control} entry={entry} />;
    },
  };
  const attribute = form ? 'formSubmit' : 'formField';
  const write = (next: FieldConfig | FormConfig) => {
    const entry = entries.find(one => one.door.kind === 'inspector-field' && one.door.attribute === attribute);
    if (entry === undefined) throw new Error(`Missing forms attribute: ${attribute}`);
    (store.dispatch as (id: CommandId, args: unknown) => DispatchResult)(entry.command.id, { target: node.id, attribute, value: JSON.stringify(next) });
  };
  return <section className="settings-section" data-region="forms-settings" aria-label={t(form ? 'forms.submission.title' : 'forms.title')}>
    <div className="settings-section__header"><h3>{t(form ? 'forms.submission.title' : 'forms.title')}</h3></div>
    {!form && node.tag === 'input' && !acceptsTextMask(node) && textForMasksDoor && <DoorControl entry={textForMasksDoor} />}
    {form
      ? <FormSubmissionSettings key={node.id} config={readFormConfig(node.attributes.formSubmit) ?? { destination: 'native' }} onChange={write} ports={ports} />
      : <FieldFormSettings key={node.id} config={readFieldConfig(node.attributes.formField) ?? {}} onChange={write} ports={ports} maskAllowed={acceptsTextMask(node)} />}
  </section>;
}

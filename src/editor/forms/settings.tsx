import { useState, type ReactNode } from 'react';
import { systemClock } from '../../core/ports/clock.ts';
import { presetCatalogue, validationMessageKeys } from '../../core/forms/catalog.ts';
import { createFormsEngine } from '../../core/forms/engine.ts';
import type { FieldConfig, FormConfig, MaskConfig, RuleCode, ValidationRules } from '../../core/forms/types.ts';

/** The host resolves every control through its manifest door and dispatches the existing attribute command. */
export interface FormsSettingsPorts {
  readonly t: (key: string) => string;
  readonly fields: readonly { readonly value: string; readonly label: string }[];
  readonly elements: readonly { readonly value: string; readonly label: string }[];
  readonly locales: readonly string[];
  readonly field: (control: {
    readonly door: string;
    readonly labelKey: string;
    readonly kind: 'text' | 'number' | 'boolean' | 'select' | 'textarea';
    readonly value: string | number | boolean;
    readonly options?: readonly { readonly value: string; readonly label: string }[];
    // what the field shows while empty: what it takes (a format), or what applies when it is left empty (a message)
    readonly placeholder?: string;
    readonly configurationFor?: (value: string) => FieldConfig | FormConfig | undefined;
    readonly onChange: (value: string) => void;
  }) => ReactNode;
  // the message a rule shows in a language when none is written (the forms runtime's own catalogue)
  readonly defaultMessage: (locale: string, code: RuleCode) => string;
  readonly button: (control: { readonly door: string; readonly labelKey: string; readonly configuration?: FieldConfig | FormConfig; readonly onClick: () => void }) => ReactNode;
}
type Values = Readonly<Record<string, unknown>>;
const withoutEmpty = (value: Values): Values => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''));
const strings = (value: string): string[] => value.split('\n').map((item) => item.trim()).filter(Boolean);
const choiceValues = (ports: FormsSettingsPorts, stem: string, values: readonly string[]) => values.map((value) => ({ value, label: ports.t(`${stem}.${value}`) }));

export function FieldFormSettings({ config, onChange: commit, ports, maskAllowed = true }: {
  readonly config: FieldConfig;
  readonly onChange: (next: FieldConfig) => void;
  readonly ports: FormsSettingsPorts;
  readonly maskAllowed?: boolean
}): ReactNode {
  const onChange = (next: FieldConfig): FieldConfig => next;
  const [trial, setTrial] = useState('');
  const [locale, setLocale] = useState(ports.locales[0] ?? 'en');
  const [blockName, setBlockName] = useState('');
  const [addressKey, setAddressKey] = useState('');
  const mask = config.mask ?? { kind: 'none' };
  const chooseMask = (kind: MaskConfig['kind']): MaskConfig => {
    if (kind === 'preset') return { kind, preset: 'cpf' };
    if (kind === 'fixed' || kind === 'custom') return { kind, pattern: '0000' };
    if (kind === 'regex') return { kind, pattern: '.*' };
    if (kind === 'dynamic') return { kind, alternatives: [{ pattern: '0000', maxLength: 4 }] };
    return { kind };
  };
  const rules = config.rules ?? {};
  const address = config.address;
  const changeMask = (patch: Values) => onChange({ ...config, mask: withoutEmpty({ ...mask, ...patch }) as unknown as MaskConfig });
  const changeRules = (patch: Values) => onChange({ ...config, rules: withoutEmpty({ ...rules, ...patch }) as ValidationRules });
  const field = (path: string, kind: 'text' | 'number' | 'boolean' | 'select' | 'textarea', value: string | number | boolean | undefined, changed: ((value: string) => FieldConfig | undefined) | ((value: string) => void), options?: readonly { readonly value: string; readonly label: string }[], placeholder?: string) => {
    const local = ['preview.input', 'messages.locale', 'mask.block.name', 'address.key'].includes(path);
    return ports.field({ door: `forms.${path}`, labelKey: `forms.${path}`, kind, value: value ?? '',
      onChange: value => { const next = changed(value);
        if (next !== undefined) commit(next);
      },
      ...(!local ? { configurationFor: (value: string) => changed(value) ?? undefined } : {}), ...(options ? { options } : {}), ...(placeholder === undefined ? {} : { placeholder }),
    });
  };
  const button = (door: string, labelKey: string, next: FieldConfig, after?: () => void) => ports.button({ door, labelKey, configuration: next, onClick: () => {
    commit(next);
    after?.();
  } });
  const numberMask = (property: 'precision' | 'minimum' | 'maximum') => field(`mask.${property}`, 'number', mask[property], (value) => changeMask({ [property]: value === '' ? undefined : Number(value) }));
  const numberRule = (property: 'minLength' | 'maxLength' | 'minimum' | 'maximum' | 'step') => field(`rules.${property}`, 'number', rules[property], (value) => changeRules({ [property]: value === '' ? undefined : Number(value) }));
  let preview: string;
  try {
    const result = createFormsEngine(systemClock.now).mask(trial, mask);
    preview = `${result.formatted} · ${ports.t('forms.preview.raw')}: ${result.raw} · ${ports.t(result.valid ? 'forms.preview.valid' : 'forms.preview.invalid')}`;
  }
  catch { preview = ports.t('forms.validation.configuration'); }
  return <section className="inspector-section" aria-label={ports.t('forms.title')}>
    {maskAllowed && <>
    {field('mask.kind', 'select', mask.kind, (kind) => onChange({ ...config, mask: chooseMask(kind as MaskConfig['kind']) }), choiceValues(ports, 'forms.mask.kind', ['none', 'preset', 'fixed', 'dynamic', 'custom', 'number', 'currency', 'percent', 'date', 'time', 'regex', 'uppercase', 'lowercase']))}
    {mask.kind === 'preset' && field('mask.preset', 'select', mask.preset, (preset) => { const found = presetCatalogue.find((one) => one.id === preset);
      if (found) return onChange({ ...config, mask: { ...found.mask, ...(mask.submit ? { submit: mask.submit } : {}) } });
    }, presetCatalogue.map((one) => ({ value: one.id, label: ports.t(`forms.preset.${one.id}`) })))}
    {['fixed', 'custom', 'regex'].includes(mask.kind) && field('mask.pattern', 'text', mask.pattern, (pattern) => changeMask({ pattern }))}
    {mask.kind === 'dynamic' && <div>
      {(mask.alternatives ?? []).map((alternative, index) => <div key={index}>
        {field('mask.alternative.pattern', 'text', alternative.pattern, (pattern) => changeMask({ alternatives: mask.alternatives?.map((one, at) => at === index ? { ...one, pattern } : one) }))}
        {field('mask.alternative.maxLength', 'number', alternative.maxLength, (value) => changeMask({ alternatives: mask.alternatives?.map((one, at) => at === index ? { ...one, maxLength: Number(value) } : one) }))}
        {button('forms.mask.alternative.remove', 'forms.remove', changeMask({ alternatives: mask.alternatives?.filter((_one, at) => at !== index) }))}
      </div>)}
      {button('forms.mask.alternative.add', 'forms.add', changeMask({ alternatives: [...(mask.alternatives ?? []), { pattern: '0000', maxLength: 4 }] }))}
    </div>}
    {mask.kind === 'custom' && <div>
      {Object.entries(mask.blocks ?? {}).map(([name, pattern]) => <div key={name}>
        <span>{name}</span>{field('mask.block.pattern', 'text', pattern, (value) => changeMask({ blocks: { ...mask.blocks, [name]: value } }))}
        {button('forms.mask.block.remove', 'forms.remove', changeMask({ blocks: Object.fromEntries(Object.entries(mask.blocks ?? {}).filter(([key]) => key !== name)) }))}
      </div>)}
      {field('mask.block.name', 'text', blockName, setBlockName)}
      {button('forms.mask.block.add', 'forms.add', changeMask({ blocks: { ...mask.blocks, [blockName]: '00' } }), () => setBlockName(''))}
    </div>}
    {field('mask.locale', 'text', mask.locale, (value) => changeMask({ locale: value }))}
    {(['number', 'currency', 'percent'].includes(mask.kind) || (mask.kind === 'preset' && ['currency', 'measurement'].includes(mask.preset ?? ''))) && <div>
      {field('mask.currency', 'text', mask.currency, (value) => changeMask({ currency: value.toUpperCase() }))}
      {numberMask('precision')}{numberMask('minimum')}{numberMask('maximum')}
      {field('mask.negative', 'boolean', mask.negative ?? true, (value) => changeMask({ negative: value === 'true' }))}
      {field('mask.suffix', 'text', mask.suffix, (value) => changeMask({ suffix: value }))}
    </div>}
    {(['date', 'time'].includes(mask.kind) || (mask.kind === 'preset' && ['date-br', 'time', 'expiry'].includes(mask.preset ?? ''))) && <div>
      {field('mask.format', 'select', mask.format, (value) => changeMask({ format: value }), ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD.MM.YYYY', 'HH:mm', 'HH:mm:ss'].map((value) => ({ value, label: value })))}
      {field('mask.autocorrect', 'boolean', mask.autocorrect ?? false, (value) => changeMask({ autocorrect: value === 'true' }))}
    </div>}
    {field('mask.submit', 'select', mask.submit ?? 'formatted', (value) => changeMask({ submit: value }), choiceValues(ports, 'forms.mask.submit', ['raw', 'formatted']))}
    {field('preview.input', 'text', trial, setTrial)}{/* a preview, not a status: the status bar is the editor's one status region */}<span className="forms-preview">{preview}</span>
    </>}
    {field('when', 'select', config.when ?? 'blur', (value) => onChange({ ...config, when: value as NonNullable<FieldConfig['when']> }), choiceValues(ports, 'forms.when', ['input', 'blur', 'submit']))}
    {field('rules.required', 'boolean', rules.required ?? false, (value) => changeRules({ required: value === 'true' }))}
    {field('rules.type', 'select', rules.type, (value) => changeRules({ type: value }), [{ value: '', label: ports.t('forms.none') }, ...choiceValues(ports, 'forms.rules.type', ['email', 'url', 'number'])])}
    {field('rules.pattern', 'text', rules.pattern, (value) => changeRules({ pattern: value }))}
    {numberRule('minLength')}{numberRule('maxLength')}{numberRule('minimum')}{numberRule('maximum')}{numberRule('step')}
    {field('rules.equalTo', 'select', rules.equalTo, (value) => changeRules({ equalTo: value }), [{ value: '', label: ports.t('forms.none') }, ...ports.fields])}
    {field('rules.allowed', 'textarea', rules.allowed?.join('\n'), (value) => changeRules({ allowed: value ? strings(value) : undefined }), undefined, ports.t('forms.rules.onePerLine'))}
    {field('rules.password.enabled', 'boolean', rules.password !== undefined, (value) => changeRules({ password: value === 'true' ? { minLength: 8 } : undefined }))}
    {rules.password && <div>
      {field('rules.password.minLength', 'number', rules.password.minLength, (value) => changeRules({ password: { ...rules.password, minLength: Number(value) } }))}
      {(['uppercase', 'lowercase', 'digit', 'symbol'] as const).map((key) => <div key={key}>{field(`rules.password.${key}`, 'boolean', rules.password?.[key] ?? false, (value) => changeRules({ password: { ...rules.password, [key]: value === 'true' } }))}</div>)}
    </div>}
    {field('rules.dateMinimum', 'text', rules.dateMinimum, (value) => changeRules({ dateMinimum: value }), undefined, ports.t('forms.rules.dateFormat'))}
    {field('rules.dateMaximum', 'text', rules.dateMaximum, (value) => changeRules({ dateMaximum: value }), undefined, ports.t('forms.rules.dateFormat'))}
    {field('rules.file.accept', 'textarea', rules.file?.accept?.join('\n'), (value) => changeRules({ file: withoutEmpty({ ...rules.file, accept: value ? strings(value) : undefined }) }), undefined, ports.t('forms.rules.fileTypesFormat'))}
    {(['maxBytes', 'maxTotalBytes'] as const).map((key) => <div key={key}>{field(`rules.file.${key}`, 'number', rules.file?.[key], (value) => changeRules({ file: withoutEmpty({ ...rules.file, [key]: value === '' ? undefined : Number(value) }) }))}</div>)}
    {field('errorId', 'select', config.errorId, (value) => onChange(withoutEmpty({ ...config, errorId: value }) as FieldConfig), [{ value: '', label: ports.t('forms.error.automatic') }, ...ports.elements])}
    {field('messages.locale', 'select', locale, setLocale, ports.locales.map((value) => ({ value, label: value })))}
    {/* each message named by when it shows, the message it shows when left empty its placeholder, in the language
        the messages are in (the user's review of 2026-10-05, LR2: each name was "Message: " and that whole message) */}
    {(Object.keys(validationMessageKeys) as RuleCode[]).map((code) => <div key={code}>{field(`messages.${code}`, 'text', config.messages?.[locale]?.[code], (value) => onChange({ ...config, messages: { ...config.messages, [locale]: withoutEmpty({ ...config.messages?.[locale], [code]: value }) } }), undefined, ports.defaultMessage(locale, code))}</div>)}
    {field('address.enabled', 'boolean', config.address !== undefined, (value) => onChange(withoutEmpty({ ...config, address: value === 'true' ? { endpoint: 'https://viacep.com.br/ws/{cep}/json/', fields: {} } : undefined }) as FieldConfig))}
    {address && <div>
      {field('address.endpoint', 'text', address.endpoint, (endpoint) => onChange({ ...config, address: { ...address, endpoint } }))}
      {Object.entries(address.fields).map(([key, name]) => <div key={key}><span>{key}</span>
        {field('address.field', 'select', name, (value) => onChange({ ...config, address: { ...address, fields: { ...address.fields, [key]: value } } }), ports.fields)}
        {button('forms.address.remove', 'forms.remove', { ...config, address: { ...address, fields: Object.fromEntries(Object.entries(address.fields).filter(([one]) => one !== key)) } })}
      </div>)}
      {field('address.key', 'text', addressKey, setAddressKey)}
      {button('forms.address.add', 'forms.add', { ...config, address: { ...address, fields: { ...address.fields, [addressKey]: ports.fields[0]?.value ?? '' } } }, () => setAddressKey(''))}
    </div>}
  </section>;
}

export function FormSubmissionSettings({ config, onChange, ports }: { readonly config: FormConfig; readonly onChange: (next: FormConfig) => void; readonly ports: FormsSettingsPorts }): ReactNode {
  const write = (key: keyof FormConfig, value: string) => withoutEmpty({ ...config, [key]: value }) as unknown as FormConfig;
  const field = (key: keyof FormConfig, options?: readonly { readonly value: string; readonly label: string }[]) => ports.field({ door: `forms.submission.${key}`, labelKey: `forms.submission.${key}`, kind: options ? 'select' : 'text', value: config[key] ?? '', configurationFor: value => write(key, value), onChange: value => onChange(write(key, value)), ...(options ? { options } : {}) });
  return <section className="inspector-section" aria-label={ports.t('forms.submission.title')}>
    {field('destination', choiceValues(ports, 'forms.submission.destination', ['native', 'endpoint', 'email-service', 'webhook']))}
    {field('endpoint')}
    {field('method', ['GET', 'POST'].map((value) => ({ value, label: value })))}
    {field('encoding', choiceValues(ports, 'forms.submission.encoding', ['form', 'json']))}
    {field('successId', [{ value: '', label: ports.t('forms.none') }, ...ports.elements])}
    {field('errorId', [{ value: '', label: ports.t('forms.none') }, ...ports.elements])}
    {field('honeypot')}{field('redirect')}
  </section>;
}

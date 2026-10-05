import { z } from 'zod';
import { createFormsEngine } from './engine.ts';
import type { FieldConfig, FormConfig, MaskConfig } from './types.ts';

const presetIds = ['cpf', 'cnpj', 'cpf-cnpj', 'cep', 'phone-br', 'phone-international', 'rg', 'pis', 'voter', 'plate', 'card', 'expiry', 'cvv', 'email', 'url', 'date-br', 'time', 'currency', 'measurement'] as const;
const ruleIds = ['required', 'type', 'pattern', 'tooShort', 'tooLong', 'minimum', 'maximum', 'step', 'preset', 'equalTo', 'password', 'allowed', 'dateMinimum', 'dateMaximum', 'fileType', 'fileSize', 'configuration'] as const;
const finite = z.number().finite();
const length = z.number().int().min(0).max(1000000);
const pattern = z.string().max(2048).refine((value) => {
  try {
    new RegExp(`^(?:${value})$`, 'u');
    return true;
  } catch {
    return false;
  }
}, 'Invalid regular expression');
const dateBoundary = z.string().regex(/^(?:\d{4}-\d{2}-\d{2}|today(?:[+-]\d{1,5}d)?)$/);
const address = z.string().max(2048).refine((value) => {
  try {
    const url = new URL(value, 'https://builder.invalid/');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'Use an HTTP or HTTPS destination without embedded credentials');
export const maskSchema = z.strictObject({
  kind: z.enum(['none', 'fixed', 'dynamic', 'number', 'currency', 'percent', 'date', 'time', 'regex', 'uppercase', 'lowercase', 'custom', 'preset']),
  preset: z.enum(presetIds).optional(), pattern: z.string().max(2048).optional(),
  alternatives: z.array(z.strictObject({ pattern: z.string().max(2048), maxLength: z.number().int().positive().max(256) })).min(1).max(32).optional(),
  blocks: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), z.string().max(256)).optional(),
  locale: z.string().max(64).refine((value) => { try {
      return Intl.NumberFormat.supportedLocalesOf([value]).length === 1;
    } catch {
      return false;
    }
  }).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), precision: z.number().int().min(0).max(20).optional(),
  minimum: finite.optional(), maximum: finite.optional(), negative: z.boolean().optional(),
  format: z.string().max(64).optional(), autocorrect: z.boolean().optional(), suffix: z.string().max(32).optional(), submit: z.enum(['raw', 'formatted']).optional(),
}).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.minimum !== undefined && value.maximum !== undefined && value.minimum > value.maximum) issue('Minimum exceeds maximum');
  if (value.kind === 'preset' && !value.preset) issue('Choose a preset');
  if (['fixed', 'custom', 'regex'].includes(value.kind) && !value.pattern) issue('Enter a mask pattern');
  if (value.kind === 'dynamic' && !value.alternatives?.length) issue('Provide dynamic alternatives');
  if (value.kind === 'date' && value.format && !/^(?:DD\/MM\/YYYY|MM\/DD\/YYYY|YYYY-MM-DD|DD\.MM\.YYYY)$/.test(value.format)) issue('Unsupported date format');
  if (value.kind === 'time' && value.format && !/^(?:HH:mm|HH:mm:ss)$/.test(value.format)) issue('Unsupported time format');
  try {
    // Schema parsing checks the grammar only; runtime calendar checks use the site's clock.
    const engine = createFormsEngine(() => 0);
    engine.mask('', value as MaskConfig);
    for (const option of value.alternatives ?? []) engine.mask('', { kind: 'fixed', pattern: option.pattern });
  } catch { issue('Invalid mask configuration'); }
});
const rulesSchema = z.strictObject({
  required: z.boolean().optional(), type: z.enum(['email', 'url', 'number']).optional(), pattern: pattern.optional(),
  minLength: length.optional(), maxLength: length.optional(), minimum: finite.optional(), maximum: finite.optional(), step: finite.positive().optional(),
  equalTo: z.string().min(1).max(256).optional(),
  password: z.strictObject({ minLength: length, uppercase: z.boolean().optional(), lowercase: z.boolean().optional(), digit: z.boolean().optional(), symbol: z.boolean().optional() }).optional(),
  allowed: z.array(z.string().max(10000)).max(10000).optional(), dateMinimum: dateBoundary.optional(), dateMaximum: dateBoundary.optional(),
  file: z.strictObject({ accept: z.array(z.string().regex(/^(?:\.[a-zA-Z0-9]+|[\w.+-]+\/(?:[\w.+-]+|\*))$/)).optional(), maxBytes: finite.nonnegative().optional(), maxTotalBytes: finite.nonnegative().optional() }).optional(),
}).superRefine((value, context) => {
  if (value.minLength !== undefined && value.maxLength !== undefined && value.minLength > value.maxLength || value.minimum !== undefined && value.maximum !== undefined && value.minimum > value.maximum) context.addIssue({ code: 'custom', message: 'Minimum exceeds maximum' });
});
export const fieldConfigSchema = z.strictObject({
  mask: maskSchema.optional(), rules: rulesSchema.optional(), when: z.enum(['input', 'blur', 'submit']).optional(),
  messages: z.record(z.string().min(1), z.partialRecord(z.enum(ruleIds), z.string().min(1).max(2048))).optional(),
  errorId: z.string().min(1).max(256).optional(),
  address: z.strictObject({ endpoint: address, fields: z.record(z.string().min(1), z.string().min(1)) }).optional(),
});
export const formConfigSchema = z.strictObject({
  destination: z.enum(['native', 'endpoint', 'email-service', 'webhook']), endpoint: address.optional(), method: z.enum(['GET', 'POST']).optional(), encoding: z.enum(['form', 'json']).optional(),
  successId: z.string().min(1).max(256).optional(), errorId: z.string().min(1).max(256).optional(), honeypot: z.string().min(1).max(256).optional(), redirect: address.optional(),
}).superRefine((value, context) => {
  if (value.destination !== 'native' && !value.endpoint) context.addIssue({ code: 'custom', message: 'Configure the form service endpoint' });
});

export function readFieldConfig(value: unknown): FieldConfig | null {
  if (typeof value !== 'string' || value.length > 100000) return null;
  try {
    const result = fieldConfigSchema.safeParse(JSON.parse(value));
    return result.success ? result.data as FieldConfig : null;
  } catch {
    return null;
  }
}
export function readFormConfig(value: unknown): FormConfig | null {
  if (typeof value !== 'string' || value.length > 100000) return null;
  try {
    const result = formConfigSchema.safeParse(JSON.parse(value));
    return result.success ? result.data as FormConfig : null;
  } catch {
    return null;
  }
}

/** Reuse attributes.set's patches/history; these are its pre-patch guards and import validators. */
export function formAttributeIssue(attribute: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (attribute === 'formField' && readFieldConfig(value) === null) return 'Invalid field mask or validation configuration';
  if (attribute === 'formSubmit' && readFormConfig(value) === null) return 'Invalid form submission configuration';
  return null;
}

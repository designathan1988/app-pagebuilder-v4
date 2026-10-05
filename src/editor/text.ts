// UI text in the language the person chose (preferences), through the i18n runtime (src/i18n/index.ts).
import { useCallback } from 'react';
import type { Message, MessageParam } from '../core/commands/registry.ts';
import type { Locale, MessageId } from '../generated/ids.ts';
import { hasText, pluralForm, translate } from '../i18n/index.ts';
import { useEditorState } from './store.ts';

export type Translate = (key: MessageId, params?: Readonly<Record<string, MessageParam>>) => string;

function resolve(locale: Locale, params: Readonly<Record<string, MessageParam>>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'object') out[name] = value;
    else if ('plural' in value) out[name] = translate(locale, `${value.plural}.${pluralForm(locale, value.count)}` as MessageId, { count: value.count });
    else out[name] = translate(locale, value.key, resolve(locale, value.params ?? {}));
  }
  return out;
}

export function textOf(locale: Locale, key: MessageId, params: Readonly<Record<string, MessageParam>> = {}): string {
  const held = params.count;
  const count = typeof held === 'number' ? held : typeof held === 'object' && held !== null && 'plural' in held ? held.count : null;
  const form = count === null ? null : `${key}.${pluralForm(locale, count)}`;
  return translate(locale, form !== null && hasText(locale, form) ? form as MessageId : key, resolve(locale, params));
}

export function messageText(locale: Locale, message: Message): string {
  return textOf(locale, message.key, message.params);
}

// The name a value shows with in a menu when the catalogue has one (the font weights: "Thin 100"), else the value
// itself: a keyword is its own name, as CSS writes it, in every language (DEC-65).
export function useValueLabel(): (property: string, value: string) => string {
  const locale = useLocale();
  return useCallback(
    (property, value) => {
      const key = `value.${property}.${value}`;
      return hasText(locale, key) ? textOf(locale, key as MessageId) : value;
    },
    [locale],
  );
}

export function useLocale(): Locale {
  return useEditorState((s) => s.ui.preferences.locale);
}

export function useT(): Translate {
  const locale = useLocale();
  return useCallback((key, params = {}) => textOf(locale, key, params), [locale]);
}

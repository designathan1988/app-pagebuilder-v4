// The i18n runtime (PRODUCT.md §5): every UI text is a MessageId looked up in the catalogue of a locale.
// English (en.json) is the source catalogue and the default UI language; Brazilian Portuguese (pt-BR.json) is the
// other locale. The catalogues are JSON so that manifest:check can prove every key the manifest names exists in both
// locales with the same placeholders. This module is plain TypeScript and holds no state: the UI language is a
// preference in the store (src/editor/preferences/preferences.ts), and the editor translates with translate(locale, …)
// for the locale the store holds (src/editor/text.ts).
//
// Fallback rule: there is none. Both catalogues are typed by the keys of en.json (a key missing from pt-BR.json is a
// type error below) and manifest:check proves they have the same keys and placeholders, so a missing text or a
// placeholder without a value is a bug: it throws, naming the key and the locale, and English is never shown in
// place of a missing Portuguese text.
import { LOCALES, type Locale, type MessageId } from '../generated/ids.ts';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

export type { Locale, MessageId };
export type MessageParams = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageId, params?: MessageParams) => string;

type Catalogue = Readonly<Record<MessageId, string>>;

const CATALOGUES: Readonly<Record<Locale, Catalogue>> = { en, 'pt-BR': ptBR };

// Placeholders are written as {name}. A placeholder without a value is a bug, so it throws.
export function formatMessage(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (_placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing parameter "${name}" in "${template}".`);
    }
    return String(value);
  });
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

// Whether the catalogue holds a text for a key (a value's own name: the font weights), without throwing:
// the UI then shows the value itself (a keyword is its own name).
export function hasText(locale: Locale, key: string): boolean {
  return Object.hasOwn(CATALOGUES[locale], key);
}

// The text of a key in a locale, with its placeholders filled.
export function translate(locale: Locale, key: MessageId, params: MessageParams = {}): string {
  const form = typeof params.count === 'number' ? (`${key}.${pluralForm(locale, params.count)}` as MessageId) : null;
  const text = (form === null ? undefined : CATALOGUES[locale][form]) ?? CATALOGUES[locale][key] as string | undefined;
  if (text === undefined) {
    throw new Error(`The ${locale} catalogue has no text for "${key}".`);
  }
  return formatMessage(text, params);
}

// The text of a key in a locale with each placeholder shown by its name ("Place <component>"): a description of the
// text itself, for readers that fill no values (the assistant's tool catalogue).
export function describeText(locale: Locale, key: MessageId): string {
  return translate(locale, key, new Proxy({}, { get: (_, name) => `<${String(name)}>`, has: () => true }) as MessageParams);
}

// Which of a key's plural forms (key.one, key.other) a count takes in a locale, by the locale's plural rules — except
// zero, which every catalogue writes with the plural ("0 elementos", "0 tracks"): Portuguese's rules file 0 under
// "one", which read "1 trilha" for a grid with no track.
export function pluralForm(locale: Locale, count: number): 'one' | 'other' {
  if (count === 0) return 'other';
  return new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other';
}

// A translate function bound to one locale.
export function translator(locale: Locale): Translate {
  return (key, params) => translate(locale, key, params);
}

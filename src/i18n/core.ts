import { en } from './en';
import { de } from './de';

export type Language = 'en' | 'de';
export type LanguagePreference = 'system' | Language;
export type MessageKey = keyof typeof en;
type PluralMessage = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
export type Messages = { [K in MessageKey]: (typeof en)[K] extends string ? string : PluralMessage };
export type MessageParams = Record<string, string | number>;

const catalogues: Record<Language, Messages> = { en, de };

// English and German cardinal counts use "one" only for the integer 1
// (including -1). Keep the rules explicit: some Expo Go runtimes do not
// provide Intl.PluralRules. Adding a language must also supply its own rule.
const oneOrOther = (count: number): Intl.LDMLPluralRule => Math.abs(count) === 1 ? 'one' : 'other';
const pluralRules: Record<Language, (count: number) => Intl.LDMLPluralRule> = {
  en: oneOrOther,
  de: oneOrOther,
};

export function resolveLanguage(preference: LanguagePreference, deviceLanguages: readonly string[]): Language {
  if (preference !== 'system') return preference;
  for (const tag of deviceLanguages) {
    const code = tag.toLowerCase().split(/[-_]/)[0];
    if (code === 'en' || code === 'de') return code;
  }
  return 'en';
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'en' || value === 'de';
}

export function translate(language: Language, key: MessageKey, params: MessageParams = {}): string {
  const message = catalogues[language]?.[key] ?? en[key];
  const template = typeof message === 'string'
    ? message
    : message[pluralRules[language](Number(params.count ?? 0)) as keyof typeof message] ?? message.other;
  return template.replace(/\{(\w+)\}/g, (token, name: string) => String(params[name] ?? token));
}

export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}

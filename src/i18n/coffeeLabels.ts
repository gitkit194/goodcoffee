import { getLanguage } from './index';
import { translate, type Language, type MessageKey } from './core';

// Display aliases only: source records and product names are never rewritten.
const COUNTRIES = [
  ['KE', 'Kenya', 'Kenia'], ['CO', 'Colombia', 'Kolumbien'], ['GT', 'Guatemala', 'Guatemala'],
  ['ET', 'Ethiopia', 'Äthiopien'], ['CR', 'Costa Rica', 'Costa Rica'], ['PE', 'Peru', 'Peru'],
  ['ID', 'Indonesia', 'Indonesien'], ['BR', 'Brazil', 'Brasilien'], ['HN', 'Honduras', 'Honduras'],
  ['IN', 'India', 'Indien'], ['SV', 'El Salvador', 'El Salvador'], ['BO', 'Bolivia', 'Bolivien'],
  ['PA', 'Panama', 'Panama'], ['UG', 'Uganda', 'Uganda'], ['RW', 'Rwanda', 'Ruanda'],
  ['BI', 'Burundi', 'Burundi'], ['MX', 'Mexico', 'Mexiko'], ['NI', 'Nicaragua', 'Nicaragua'],
  ['TZ', 'Tanzania', 'Tansania'], ['EC', 'Ecuador', 'Ecuador'], ['YE', 'Yemen', 'Jemen'],
  ['DE', 'Germany', 'Deutschland'],
] as const;

export function originLabel(value: string | null | undefined, language: Language = getLanguage()): string {
  return (value ?? '').split(',').map((part) => {
    const raw = part.trim();
    const country = COUNTRIES.find((row) => row.some((name) => name.toLowerCase() === raw.toLowerCase()));
    return country ? country[language === 'de' ? 2 : 1] : raw;
  }).join(', ');
}

const PROCESSES: Record<string, MessageKey> = {
  washed: 'Washed', natural: 'Natural', honey: 'Honey process', anaerob: 'Anaerobic', anaerobic: 'Anaerobic',
};
export function processLabel(value: string | null | undefined, language: Language = getLanguage()): string {
  if (!value) return '';
  const key = PROCESSES[value.toLowerCase()];
  return key ? translate(language, key) : catalogText(value, language);
}

// German words roasters use inside free-text catalog fields (process, region, producer, variety).
// Only the English view rewrites them; the German view shows the roaster's text as it is.
const NOT_LETTER = '(?<![\\p{L}])';
const END = '(?![\\p{L}])';
const GERMAN_PHRASES: [RegExp, string][] = [
  [new RegExp(`${NOT_LETTER}([\\p{L}]+)- und ([\\p{L}]+)-Anteil${END}`, 'gu'), '$1 and $2 portions'],
  [new RegExp(`${NOT_LETTER}([\\p{L}]+)-Anteil${END}`, 'gu'), '$1 portion'],
  [new RegExp(`${NOT_LETTER}mit Hopfen co-fermentiert${END}`, 'gu'), 'co-fermented with hops'],
  [new RegExp(`${NOT_LETTER}verschiedene Regionen${END}`, 'gu'), 'various regions'],
  [new RegExp(`${NOT_LETTER}verschiedene Kleinbauern${END}`, 'gu'), 'various smallholders'],
  [new RegExp(`${NOT_LETTER}Kleinstfarmer aus ganz${END}`, 'gu'), 'smallholders from all over'],
  [new RegExp(`${NOT_LETTER}Hochland Kenias${END}`, 'gu'), 'Kenyan highlands'],
  [new RegExp(`${NOT_LETTER}entkoffeiniert${END}`, 'gu'), 'decaf'],
  [new RegExp(`${NOT_LETTER}anaerob${END}`, 'gu'), 'anaerobic'],
  [new RegExp(`${NOT_LETTER}Ethylacetat${END}`, 'gu'), 'ethyl acetate'],
  [new RegExp(`${NOT_LETTER}bis (?=\\d)`, 'gu'), 'up to '],
  [new RegExp(`${NOT_LETTER}ca\\. (?=\\d)`, 'gu'), 'approx. '],
  [new RegExp(`${NOT_LETTER}und${END}`, 'gu'), 'and'],
  // German thousands separator in altitudes: 1.750 m -> 1,750 m
  [/(\d)\.(\d{3})(?!\d)/g, '$1,$2'],
];

/** A roaster's free-text catalog value in the user's language: German fragments and country names are
 *  rewritten for English; product names are never passed through here. */
export function catalogText(value: string | null | undefined, language: Language = getLanguage()): string {
  if (!value) return '';
  if (language === 'de') return value;
  let out = value;
  for (const [pattern, replacement] of GERMAN_PHRASES) out = out.replace(pattern, replacement);
  for (const [, en, de] of COUNTRIES) {
    if (en !== de) out = out.replace(new RegExp(`${NOT_LETTER}${de}${END}`, 'gu'), en);
  }
  return out;
}

import type { Language } from './core';

export const formatLocale = (language: Language) => language === 'de' ? 'de-DE' : 'en-GB';

export function formatNumber(n: number, digits: number, language: Language): string {
  return new Intl.NumberFormat(formatLocale(language), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(n);
}

export function formatDate(value: Date, options: Intl.DateTimeFormatOptions, language: Language): string {
  return new Intl.DateTimeFormat(formatLocale(language), options).format(value);
}

/** Dates are stored as calendar dates, never converted through UTC. */
export function parseInputDate(text: string, now = new Date()): string | null {
  const input = text.trim();
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = input.match(/^(\d{1,2})([./])\s*(\d{1,2})(?:\2\s*(\d{2}|\d{4}))?\.?$/);
  if (!iso && !local) return null;
  const day = Number(iso ? iso[3] : local![1]);
  const month = Number(iso ? iso[2] : local![3]);
  let year = iso ? Number(iso[1]) : local![4] ? Number(local![4]) : now.getFullYear();
  if (year < 100 && !iso) year += 2000;
  if (year < 1000 || year > 9999) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Why a typed roast date can't be used, or null when it is empty or fine. A bag can't be roasted after
 *  today, so a date in the future is almost always a typo (or a best-before date). */
export function roastDateProblem(text: string, now = new Date()): 'invalid' | 'future' | null {
  if (!text.trim()) return null;
  const iso = parseInputDate(text, now);
  if (!iso) return 'invalid';
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return iso > today ? 'future' : null;
}

export function formatInputDate(iso: string | null | undefined, language: Language): string {
  if (!iso || !parseInputDate(iso)) return '';
  const [year, month, day] = iso.split('-');
  return [day, month, year].join(language === 'de' ? '.' : '/');
}

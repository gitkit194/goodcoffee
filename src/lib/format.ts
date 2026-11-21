import { getLanguage, t } from '../i18n';
import { formatDate, formatInputDate, formatNumber, parseInputDate, roastDateProblem } from '../i18n/formatting';

export function num(n: number, digits = 1): string {
  return formatNumber(n, digits, getLanguage());
}
export function short(n: number): string { return num(n, Number.isInteger(n) ? 0 : 1); }
export function ratio(dose: number, out: number): string { return dose > 0 ? '1 : ' + num(out / dose, 1) : '–'; }
export function recipeLine(c: { grind: number; dose_g: number; yield_g: number; time_s: number }): string {
  return t('Grind') + ' ' + short(c.grind) + ' · ' + short(c.dose_g) + ' → ' + short(c.yield_g) + ' g · ' + c.time_s + ' s';
}
function startOfDay(d: Date): number { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
export function daysAgo(iso: string, now = new Date()): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86400000);
}
export function time(iso: string): string {
  return formatDate(new Date(iso), { hour: '2-digit', minute: '2-digit' }, getLanguage());
}
export function dayLabel(iso: string, now = new Date()): string {
  const n = daysAgo(iso, now);
  if (n === 0) return t('Today');
  if (n === 1) return t('Yesterday');
  return formatDate(new Date(iso), n > 1 && n < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'short' }, getLanguage());
}
/** Day and short month, e.g. "28. Okt.". */
export function shortDay(iso: string): string {
  return formatDate(new Date(iso), { day: 'numeric', month: 'short' }, getLanguage());
}
export function longDate(d = new Date()): string {
  return formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' }, getLanguage());
}
export function monthName(d = new Date()): string { return formatDate(d, { month: 'long' }, getLanguage()); }
export function monthYear(iso: string): string { return formatDate(new Date(iso), { month: 'long', year: 'numeric' }, getLanguage()); }
export function roastDate(iso: string | null | undefined): string | null {
  if (!iso || !parseInputDate(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return formatDate(new Date(year, month - 1, day), { day: 'numeric', month: 'short' }, getLanguage());
}
export const parseDate = parseInputDate;
export { roastDateProblem };
/** The message to show under a roast date field, or null. */
export function roastDateMessage(text: string): string | null {
  const problem = roastDateProblem(text);
  return problem === 'invalid' ? t('Enter a valid date, e.g. 08/10/2026') : problem === 'future' ? t('The roast date is in the future.') : null;
}
export function dateInput(iso: string | null | undefined): string { return formatInputDate(iso, getLanguage()); }
export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 11 ? t('Good morning') : h < 17 ? t('Hello') : t('Good evening');
}

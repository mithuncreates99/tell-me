import type { ISODate, Weekday } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of an ISO date. */
export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export const todayISO = (now: Date = new Date()): ISODate => toISODate(now);

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export const weekdayOf = (s: ISODate): Weekday => parseISODate(s).getDay() as Weekday;

/** Whole days from a to b (b - a), immune to DST shifts. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000);
}

export function startOfWeek(s: ISODate, weekStartsOn: 0 | 1): ISODate {
  const diff = (weekdayOf(s) - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}

/** Inclusive list of dates from `from` to `to`. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** A local Date for `date` plus `minutes` after midnight (may roll into the next day). */
export function atMinutes(date: ISODate, minutes: number): Date {
  const d = parseISODate(date);
  d.setMinutes(minutes);
  return d;
}

/** Weekdays ordered for display, e.g. Mon..Sun when the week starts on Monday. */
export const orderedWeekdays = (weekStartsOn: 0 | 1): Weekday[] =>
  [0, 1, 2, 3, 4, 5, 6].map((i) => ((i + weekStartsOn) % 7) as Weekday);

const locale = () => (typeof navigator !== 'undefined' ? navigator.language : 'en-GB');

export function weekdayName(d: Weekday, style: 'long' | 'short' | 'narrow' = 'short'): string {
  // 2026-10-04 is a Sunday
  return new Intl.DateTimeFormat(locale(), { weekday: style }).format(new Date(2026, 9, 4 + d));
}

export function formatDate(s: ISODate, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat(locale(), opts).format(parseISODate(s));
}

export function formatTime(hhmmValue: string): string {
  const [h, m] = hhmmValue.split(':').map(Number);
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 0, 1, h, m));
}

/** "Today", "Yesterday", "Tomorrow" or a short date. */
export function relativeDay(date: ISODate, today: ISODate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return formatDate(date);
}

export function weekLabel(weekStart: ISODate): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.slice(0, 7) === end.slice(0, 7);
  const a = formatDate(weekStart, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const b = formatDate(end, { day: 'numeric', month: 'short' });
  return `${a} – ${b}`;
}

import { addDays, atMinutes, minutesOf, todayISO, weekdayOf } from './dates';
import type { Checkin, Habit, ISODate, Settings } from './types';

export const checkinKey = (habitId: string, date: ISODate) => `${habitId}:${date}`;

export type CheckinMap = Map<string, Checkin>;

export function toCheckinMap(checkins: Iterable<Checkin>): CheckinMap {
  const map: CheckinMap = new Map();
  for (const c of checkins) map.set(c.id, c);
  return map;
}

export function isActiveOn(habit: Habit, date: ISODate): boolean {
  return date >= habit.createdAt && (!habit.archivedAt || date < habit.archivedAt);
}

export function isScheduledOn(habit: Habit, date: ISODate): boolean {
  return isActiveOn(habit, date) && habit.days.includes(weekdayOf(date));
}

/** Minutes after midnight when we ask "Did you show up?" (can exceed 24h for late habits). */
export function askMinutes(habit: Habit, settings: Pick<Settings, 'defaultAskTime'>): number {
  return habit.time ? minutesOf(habit.time) + habit.askAfterMin : minutesOf(settings.defaultAskTime);
}

export const askAt = (habit: Habit, date: ISODate, settings: Pick<Settings, 'defaultAskTime'>): Date =>
  atMinutes(date, askMinutes(habit, settings));

/**
 * yes / no      – answered
 * pending       – the ask time has passed and there's no answer yet
 * upcoming      – later today (you can still answer early)
 */
export type OccurrenceState = 'yes' | 'no' | 'pending' | 'upcoming';

export interface Occurrence {
  habit: Habit;
  date: ISODate;
  askAt: Date;
  checkin?: Checkin;
  state: OccurrenceState;
}

export function occurrence(
  habit: Habit,
  date: ISODate,
  checkins: CheckinMap,
  settings: Pick<Settings, 'defaultAskTime'>,
  now: Date,
): Occurrence {
  const checkin = checkins.get(checkinKey(habit.id, date));
  const at = askAt(habit, date, settings);
  const state: OccurrenceState = checkin ? checkin.answer : now >= at ? 'pending' : 'upcoming';
  return { habit, date, askAt: at, checkin, state };
}

const byTime = (a: Occurrence, b: Occurrence) =>
  (a.habit.time ? minutesOf(a.habit.time) : 24 * 60) - (b.habit.time ? minutesOf(b.habit.time) : 24 * 60) ||
  a.habit.order - b.habit.order;

/** Everything planned for a day, sorted by planned time ("any time" habits last). */
export function occurrencesOn(
  habits: Habit[],
  date: ISODate,
  checkins: CheckinMap,
  settings: Pick<Settings, 'defaultAskTime'>,
  now: Date,
): Occurrence[] {
  return habits
    .filter((h) => isScheduledOn(h, date))
    .map((h) => occurrence(h, date, checkins, settings, now))
    .sort(byTime);
}

/** Past occurrences (before today) that still need a Yes/No, newest first. */
export function pendingBeforeToday(
  habits: Habit[],
  checkins: CheckinMap,
  settings: Pick<Settings, 'defaultAskTime'>,
  now: Date,
  lookbackDays = 7,
): Occurrence[] {
  const today = todayISO(now);
  const out: Occurrence[] = [];
  for (let i = 1; i <= lookbackDays; i++) {
    const date = addDays(today, -i);
    for (const o of occurrencesOn(habits, date, checkins, settings, now)) if (o.state === 'pending') out.push(o);
  }
  return out;
}

/** Calls fn for every scheduled occurrence in [from, to]. */
export function forEachOccurrence(
  habits: Habit[],
  from: ISODate,
  to: ISODate,
  fn: (habit: Habit, date: ISODate) => void,
): void {
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    for (const h of habits) if (h.days.includes(wd) && isActiveOn(h, date)) fn(h, date);
  }
}

/** Short human summary: "Mon, Wed, Fri at 18:00", "Every day", "Weekdays at 07:30". */
export function scheduleSummary(habit: Pick<Habit, 'days' | 'time'>, weekdayShort: (d: number) => string, formatTime: (t: string) => string): string {
  const days = [...habit.days].sort();
  const key = days.join('');
  let label: string;
  if (key === '0123456') label = 'Every day';
  else if (key === '12345') label = 'Weekdays';
  else if (key === '06') label = 'Weekends';
  else {
    // Monday-first for display
    const mondayFirst = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    label = mondayFirst.map(weekdayShort).join(', ');
  }
  return habit.time ? `${label} at ${formatTime(habit.time)}` : `${label} · any time`;
}

import { addDays, minutesOf, startOfWeek, todayISO, weekdayOf } from './dates';
import { askAt, checkinKey, forEachOccurrence, type CheckinMap } from './schedule';
import type { Habit, ISODate, MissReason, Settings, Weekday } from './types';

type AskSettings = Pick<Settings, 'defaultAskTime'>;

/**
 * due        – occurrences that have been answered, or whose ask time has passed
 * unanswered – due but never answered (counts as "didn't show up" in the rate)
 */
export interface Tally {
  due: number;
  yes: number;
  no: number;
  unanswered: number;
}

export const emptyTally = (): Tally => ({ due: 0, yes: 0, no: 0, unanswered: 0 });

/** Share of due occurrences answered "yes", or null when nothing was due. */
export const rateOf = (t: Tally): number | null => (t.due > 0 ? t.yes / t.due : null);

export const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`);

function add(t: Tally, outcome: 'yes' | 'no' | 'unanswered') {
  t.due++;
  t[outcome]++;
}

export interface RangeStats {
  total: Tally;
  byHabit: Map<string, Tally>;
  byDate: Map<ISODate, Tally>;
}

/** Tallies every due occurrence in [from, to] (days after today are ignored). */
export function tallyRange(
  habits: Habit[],
  checkins: CheckinMap,
  from: ISODate,
  to: ISODate,
  settings: AskSettings,
  now: Date,
): RangeStats {
  const today = todayISO(now);
  const end = to < today ? to : today;
  const total = emptyTally();
  const byHabit = new Map<string, Tally>();
  const byDate = new Map<ISODate, Tally>();
  if (from > end) return { total, byHabit, byDate };

  forEachOccurrence(habits, from, end, (habit, date) => {
    const c = checkins.get(checkinKey(habit.id, date));
    let outcome: 'yes' | 'no' | 'unanswered' | null = null;
    if (c) outcome = c.answer;
    else if (askAt(habit, date, settings) <= now) outcome = 'unanswered';
    if (!outcome) return;
    add(total, outcome);
    if (!byHabit.has(habit.id)) byHabit.set(habit.id, emptyTally());
    add(byHabit.get(habit.id)!, outcome);
    if (!byDate.has(date)) byDate.set(date, emptyTally());
    add(byDate.get(date)!, outcome);
  });
  return { total, byHabit, byDate };
}

export interface WeekStats extends RangeStats {
  weekStart: ISODate;
}

export function weekStats(
  habits: Habit[],
  checkins: CheckinMap,
  weekStart: ISODate,
  settings: AskSettings,
  now: Date,
): WeekStats {
  return { weekStart, ...tallyRange(habits, checkins, weekStart, addDays(weekStart, 6), settings, now) };
}

/**
 * This week vs last week, fairly: while a week is still in progress it is compared with
 * last week *up to the same moment* (e.g. Mon–Wed 19:00 vs last Mon–Wed 19:00).
 */
export function compareWithLastWeek(
  habits: Habit[],
  checkins: CheckinMap,
  weekStart: ISODate,
  settings: AskSettings,
  now: Date,
): { current: Tally; previous: Tally; partial: boolean } {
  const today = todayISO(now);
  const weekEnd = addDays(weekStart, 6);
  const partial = today >= weekStart && today <= weekEnd;
  const current = tallyRange(habits, checkins, weekStart, weekEnd, settings, now).total;
  const prevStart = addDays(weekStart, -7);
  const previous = partial
    ? tallyRange(habits, checkins, prevStart, addDays(today, -7), settings, new Date(now.getTime() - 7 * 86_400_000)).total
    : tallyRange(habits, checkins, prevStart, addDays(prevStart, 6), settings, now).total;
  return { current, previous, partial };
}

/** The last `weeks` weeks, oldest first, ending with the week containing `endWeekStart`. */
export function weeklySeries(
  habits: Habit[],
  checkins: CheckinMap,
  endWeekStart: ISODate,
  settings: AskSettings,
  now: Date,
  weeks = 8,
): WeekStats[] {
  const out: WeekStats[] = [];
  for (let i = weeks - 1; i >= 0; i--) out.push(weekStats(habits, checkins, addDays(endWeekStart, -7 * i), settings, now));
  return out;
}

/** Completion by weekday over the last `days` days. */
export function weekdayTallies(
  habits: Habit[],
  checkins: CheckinMap,
  settings: AskSettings,
  now: Date,
  days = 56,
): Map<Weekday, Tally> {
  const today = todayISO(now);
  const { byDate } = tallyRange(habits, checkins, addDays(today, -(days - 1)), today, settings, now);
  const out = new Map<Weekday, Tally>();
  for (let d = 0; d < 7; d++) out.set(d as Weekday, emptyTally());
  for (const [date, t] of byDate) {
    const acc = out.get(weekdayOf(date))!;
    acc.due += t.due;
    acc.yes += t.yes;
    acc.no += t.no;
    acc.unanswered += t.unanswered;
  }
  return out;
}

export interface Streak {
  current: number;
  best: number;
}

/**
 * Consecutive scheduled occurrences answered "yes". Today's occurrence never breaks a streak
 * until it's answered; a missed or unanswered past occurrence does.
 */
export function streakFor(habit: Habit, checkins: CheckinMap, settings: AskSettings, now: Date): Streak {
  const today = todayISO(now);
  let run = 0;
  let best = 0;
  forEachOccurrence([habit], habit.createdAt, today, (h, date) => {
    const c = checkins.get(checkinKey(h.id, date));
    if (c?.answer === 'yes') {
      run++;
      best = Math.max(best, run);
    } else if (c?.answer === 'no') {
      run = 0;
    } else if (date !== today && askAt(h, date, settings) <= now) {
      run = 0; // unanswered in the past
    }
  });
  return { current: run, best };
}

export function reasonCounts(
  habits: Habit[],
  checkins: CheckinMap,
  from: ISODate,
  to: ISODate,
): { counts: Map<MissReason, number>; withoutReason: number; misses: number } {
  const ids = new Set(habits.map((h) => h.id));
  const counts = new Map<MissReason, number>();
  let withoutReason = 0;
  let misses = 0;
  for (const c of checkins.values()) {
    if (c.answer !== 'no' || c.date < from || c.date > to || !ids.has(c.habitId)) continue;
    misses++;
    if (c.reason) counts.set(c.reason, (counts.get(c.reason) ?? 0) + 1);
    else withoutReason++;
  }
  return { counts, withoutReason, misses };
}

export interface HeatCell {
  date: ISODate;
  due: number;
  yes: number;
  future: boolean;
}

/** `weeks` columns of 7 days (oldest first), each starting on the configured weekday. */
export function heatmapWeeks(
  habits: Habit[],
  checkins: CheckinMap,
  settings: AskSettings & Pick<Settings, 'weekStartsOn'>,
  now: Date,
  weeks = 16,
): HeatCell[][] {
  const today = todayISO(now);
  const first = addDays(startOfWeek(today, settings.weekStartsOn), -7 * (weeks - 1));
  const { byDate } = tallyRange(habits, checkins, first, today, settings, now);
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(first, w * 7 + d);
      const t = byDate.get(date);
      col.push({ date, due: t?.due ?? 0, yes: t?.yes ?? 0, future: date > today });
    }
    cols.push(col);
  }
  return cols;
}

export type DayPart = 'morning' | 'afternoon' | 'evening';

export function dayPartOf(time: string | null): DayPart | null {
  if (!time) return null;
  const m = minutesOf(time);
  return m < 12 * 60 ? 'morning' : m < 17 * 60 ? 'afternoon' : 'evening';
}

export function dayPartTallies(
  habits: Habit[],
  checkins: CheckinMap,
  settings: AskSettings,
  now: Date,
  days = 56,
): Record<DayPart, Tally> {
  const today = todayISO(now);
  const { byHabit } = tallyRange(habits, checkins, addDays(today, -(days - 1)), today, settings, now);
  const out: Record<DayPart, Tally> = { morning: emptyTally(), afternoon: emptyTally(), evening: emptyTally() };
  for (const h of habits) {
    const part = dayPartOf(h.time);
    const t = byHabit.get(h.id);
    if (!part || !t) continue;
    out[part].due += t.due;
    out[part].yes += t.yes;
    out[part].no += t.no;
    out[part].unanswered += t.unanswered;
  }
  return out;
}

/** Highest number of "yes" answers in any complete week before `beforeWeekStart`. */
export function bestPastWeekYes(
  habits: Habit[],
  checkins: CheckinMap,
  beforeWeekStart: ISODate,
  settings: AskSettings,
  now: Date,
): { yes: number; weeks: number } {
  const earliest = habits.reduce<ISODate | null>((min, h) => (min === null || h.createdAt < min ? h.createdAt : min), null);
  if (!earliest) return { yes: 0, weeks: 0 };
  let best = 0;
  let weeks = 0;
  for (let ws = addDays(beforeWeekStart, -7); ws >= addDays(earliest, -6); ws = addDays(ws, -7)) {
    const { total } = tallyRange(habits, checkins, ws, addDays(ws, 6), settings, now);
    if (total.due === 0) continue;
    weeks++;
    best = Math.max(best, total.yes);
  }
  return { yes: best, weeks };
}

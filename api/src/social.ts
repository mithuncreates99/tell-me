/**
 * Pure logic for the social features (no I/O), so it can be unit-tested directly.
 */
import { getZonedParts, localDate } from './tz';

// ---------- dates (ISO "YYYY-MM-DD", calendar arithmetic in UTC so DST never matters) ----------

const toUtc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y!, m! - 1, day!);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number): string => fromUtc(toUtc(d) + n * 86_400_000);
export const daysBetween = (a: string, b: string): number => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
export const weekdayOf = (d: string): number => new Date(toUtc(d)).getUTCDay();
export const startOfWeek = (d: string, weekStartsOn: number): string => addDays(d, -((weekdayOf(d) - weekStartsOn + 7) % 7));

// ---------- ids and friend codes ----------

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
/** No I, L, O, 0 or 1, so a code read out loud or typed from a screenshot can't be misread. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomId(length = 16): string {
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(length))) out += ID_ALPHABET[b & 63];
  return out;
}

/** Uniform random code (rejection sampling avoids modulo bias). */
export function randomFriendCode(length = 8): string {
  let out = '';
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** "k7p2-9xqm " -> "K7P29XQM", or null if it can't be a valid code. */
export function normalizeFriendCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

// ---------- shared habits ----------

export const REACTIONS = ['🔥', '👏', '💪', '🎉', '❤️'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** Y yes · N no · M missed (due, never answered) · P due today · F due later this week · . not planned */
export type WeekChar = 'Y' | 'N' | 'M' | 'P' | 'F' | '.';
export type TodayStatus = 'yes' | 'no' | 'pending' | 'upcoming' | 'rest';

export interface SharedHabitRow {
  user_id: string;
  habit_id: string;
  name: string;
  emoji: string;
  color: string;
  days: number;
  time: string | null;
  ask_min: number;
  date: string;
  week_start: string;
  week: string;
  streak: number;
  best: number;
  position: number;
  updated_at: number;
}

export interface SharedHabitView {
  id: string;
  name: string;
  emoji: string;
  color: string;
  days: number[];
  time: string | null;
  /** The owner's local date right now. */
  date: string;
  /** Status in the owner's own "today". */
  today: TodayStatus;
  /** Owner's current week, starting on `weekStart`. */
  week: string;
  weekStart: string;
  streak: number;
  best: number;
  updatedAt: number;
}

const isDue = (days: number, date: string) => (days & (1 << weekdayOf(date))) !== 0;

function freshChar(days: number, date: string, today: string): WeekChar {
  if (!isDue(days, date)) return '.';
  return date < today ? 'M' : date === today ? 'P' : 'F';
}

/**
 * A snapshot is published whenever the owner's app is used. If they haven't opened it since,
 * we move it forward to their current day: due days that passed without an answer become
 * "missed" (which also ends the streak), and a new week starts empty.
 */
export function normalizeSharedHabit(row: SharedHabitRow, timeZone: string, now: number): SharedHabitView {
  const today = localDate(now, timeZone);
  const { hour, minute } = getZonedParts(now, timeZone);
  let weekStart = row.week_start;
  let week = row.week.split('') as WeekChar[];
  let streak = row.streak;

  if (row.date < today) {
    const weekStartsOn = weekdayOf(row.week_start);
    const currentWeekStart = startOfWeek(today, weekStartsOn);
    // Any due day from the snapshot day (if it was still unanswered) up to yesterday was missed.
    // A week covers every weekday, so looking further back can't change the answer.
    const gap = daysBetween(row.date, today);
    for (let i = 0; i < Math.min(gap, 8); i++) {
      const d = addDays(row.date, i);
      if (!isDue(row.days, d)) continue;
      const ch = i === 0 ? row.week[daysBetween(row.week_start, d)] : undefined;
      if (ch !== 'Y' && ch !== 'N') {
        streak = 0;
        break;
      }
    }
    if (currentWeekStart !== row.week_start) {
      weekStart = currentWeekStart;
      week = Array.from({ length: 7 }, (_, i) => freshChar(row.days, addDays(currentWeekStart, i), today));
    } else {
      week = week.map((ch, i) => {
        const d = addDays(weekStart, i);
        if (d < row.date) return ch;
        if (d === row.date && (ch === 'Y' || ch === 'N')) return ch;
        return freshChar(row.days, d, today);
      });
    }
  }

  const idx = daysBetween(weekStart, today);
  const ch = idx >= 0 && idx < 7 ? week[idx] : '.';
  const nowMin = hour * 60 + minute;
  const status: TodayStatus =
    ch === 'Y' ? 'yes' : ch === 'N' ? 'no' : ch === 'P' ? (nowMin >= row.ask_min ? 'pending' : 'upcoming') : 'rest';

  return {
    id: row.habit_id,
    name: row.name,
    emoji: row.emoji,
    color: row.color,
    days: [0, 1, 2, 3, 4, 5, 6].filter((d) => row.days & (1 << d)),
    time: row.time,
    date: today,
    today: status,
    week: week.join(''),
    weekStart,
    streak,
    best: row.best,
    updatedAt: row.updated_at,
  };
}

export interface WeekSummary {
  yes: number;
  /** Answered, missed, or due today with the check-in time passed. */
  due: number;
}

export function weekSummary(habits: readonly SharedHabitView[]): WeekSummary {
  let yes = 0;
  let due = 0;
  for (const h of habits) {
    for (const ch of h.week) {
      if (ch === 'Y') yes++;
      if (ch === 'Y' || ch === 'N' || ch === 'M') due++;
    }
    if (h.today === 'pending') due++;
  }
  return { yes, due };
}

export const yesThisWeek = (h: SharedHabitView | null | undefined): number => (h ? [...h.week].filter((c) => c === 'Y').length : 0);

/** Short, safe text for notifications. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

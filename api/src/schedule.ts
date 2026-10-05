import { getZonedParts, isoDateFromUtcDate, zonedTimeToUtc } from './tz';

export interface ReminderSchedule {
  /** Bitmask of weekdays: bit 0 = Sunday ... bit 6 = Saturday. */
  days: number;
  /** Planned local time, "HH:MM". */
  time: string;
  /** Minutes after the planned time to send the "Did you go?" push. */
  offsetMin: number;
  /** Local dates (YYYY-MM-DD) the user already answered, so no push is needed. */
  skipDates?: readonly string[];
}

export interface NextFire {
  /** When to send the push (unix ms, UTC). */
  fireAt: number;
  /** The local date of the occurrence this push asks about. */
  date: string;
}

export const daysToMask = (days: readonly number[]): number =>
  days.reduce((mask, d) => mask | (1 << d), 0);

export const maskToDays = (mask: number): number[] =>
  [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d));

/**
 * Finds the first occurrence whose push time is strictly after `after`.
 * Works in the user's own time zone, so "Mon 18:00 Europe/Paris" stays 18:00 across DST changes.
 */
export function computeNextFire(
  schedule: ReminderSchedule,
  timeZone: string,
  after: number,
): NextFire | null {
  if (!schedule.days) return null;
  const [hh = 0, mm = 0] = schedule.time.split(':').map(Number);
  const offset = schedule.offsetMin * 60_000;
  const skip = new Set(schedule.skipDates ?? []);

  // Start from the local date of (after - offset): an occurrence planned yesterday evening
  // can still have its push due after midnight.
  const start = getZonedParts(after - offset, timeZone);
  for (let i = 0; i <= 14; i++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    if (!(schedule.days & (1 << day.getUTCDay()))) continue;
    const date = isoDateFromUtcDate(day);
    if (skip.has(date)) continue;
    const planned = zonedTimeToUtc(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hh,
      mm,
      timeZone,
    );
    const fireAt = planned + offset;
    if (fireAt > after) return { fireAt, date };
  }
  return null;
}

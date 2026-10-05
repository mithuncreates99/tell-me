/**
 * Small, dependency-free time zone helpers built on Intl.
 * Workers run in UTC, so every "local" time has to be converted explicitly.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday ... 6 = Saturday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant as seen in `timeZone`. */
export function getZonedParts(instant: number, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(instant))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24; // some engines print midnight as "24"
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (e.g. +7_200_000 for Paris in summer). */
export function offsetMs(instant: number, timeZone: string): number {
  const p = getZonedParts(instant, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant.
 * Times that do not exist (inside a spring-forward gap) resolve to one hour later;
 * ambiguous times (fall-back) resolve to the second occurrence. Both are fine for reminders.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMs(wallAsUtc, timeZone);
  const candidate = wallAsUtc - first;
  const second = offsetMs(candidate, timeZone);
  return second === first ? candidate : wallAsUtc - second;
}

/** "YYYY-MM-DD" for a UTC-based calendar date object. */
export function isoDateFromUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function localDate(instant: number, timeZone: string): string {
  const p = getZonedParts(instant, timeZone);
  return isoDateFromUtcDate(new Date(Date.UTC(p.year, p.month - 1, p.day)));
}

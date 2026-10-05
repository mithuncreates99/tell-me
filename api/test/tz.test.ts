import { describe, expect, it } from 'vitest';
import { getZonedParts, isValidTimeZone, localDate, zonedTimeToUtc } from '../src/tz';

const iso = (ms: number) => new Date(ms).toISOString();

describe('time zones', () => {
  it('reads wall-clock parts in a zone', () => {
    const p = getZonedParts(Date.parse('2026-10-05T16:30:00Z'), 'Europe/Paris');
    expect(p).toMatchObject({ year: 2026, month: 10, day: 5, hour: 18, minute: 30, weekday: 1 });
  });

  it('converts local wall time to UTC in summer and winter (Paris)', () => {
    expect(iso(zonedTimeToUtc(2026, 10, 6, 18, 0, 'Europe/Paris'))).toBe('2026-10-06T16:00:00.000Z');
    expect(iso(zonedTimeToUtc(2026, 11, 3, 18, 0, 'Europe/Paris'))).toBe('2026-11-03T17:00:00.000Z');
  });

  it('handles half-hour offsets (India)', () => {
    expect(iso(zonedTimeToUtc(2026, 10, 6, 7, 0, 'Asia/Kolkata'))).toBe('2026-10-06T01:30:00.000Z');
  });

  it('handles DST edges', () => {
    // 02:30 does not exist in Paris on 29 Mar 2026 -> one hour later (03:30 CEST)
    expect(iso(zonedTimeToUtc(2026, 3, 29, 2, 30, 'Europe/Paris'))).toBe('2026-03-29T01:30:00.000Z');
    // 02:30 happens twice on 25 Oct 2026 -> second occurrence (CET)
    expect(iso(zonedTimeToUtc(2026, 10, 25, 2, 30, 'Europe/Paris'))).toBe('2026-10-25T01:30:00.000Z');
    // New York spring forward
    expect(iso(zonedTimeToUtc(2026, 3, 8, 9, 0, 'America/New_York'))).toBe('2026-03-08T13:00:00.000Z');
  });

  it('gives the local date of an instant', () => {
    expect(localDate(Date.parse('2026-10-05T22:30:00Z'), 'Europe/Paris')).toBe('2026-10-06');
    expect(localDate(Date.parse('2026-10-05T22:30:00Z'), 'America/New_York')).toBe('2026-10-05');
  });

  it('validates zone names', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

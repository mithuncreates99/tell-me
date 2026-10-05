import { describe, expect, it } from 'vitest';
import { computeNextFire, daysToMask, maskToDays } from '../src/schedule';

const PARIS = 'Europe/Paris';
const MWF = daysToMask([1, 3, 5]); // Mon, Wed, Fri
const at = (s: string) => Date.parse(s);
const iso = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());

describe('weekday masks', () => {
  it('round-trips', () => {
    expect(MWF).toBe(0b0101010);
    expect(maskToDays(MWF)).toEqual([1, 3, 5]);
  });
});

describe('computeNextFire', () => {
  it('asks one hour after a Mon/Wed/Fri 18:00 gym session', () => {
    // Monday 5 Oct 2026, 10:00 in Paris
    const next = computeNextFire({ days: MWF, time: '18:00', offsetMin: 60 }, PARIS, at('2026-10-05T08:00:00Z'));
    expect(next?.date).toBe('2026-10-05');
    expect(iso(next?.fireAt)).toBe('2026-10-05T17:00:00.000Z'); // 19:00 Paris
  });

  it('moves to the next scheduled day once today has passed', () => {
    const next = computeNextFire({ days: MWF, time: '18:00', offsetMin: 60 }, PARIS, at('2026-10-05T17:00:00Z'));
    expect(next?.date).toBe('2026-10-07'); // Wednesday
  });

  it('keeps asking about yesterday when the push lands after midnight', () => {
    // 23:30 + 60 min -> 00:30 the next day, but the question is about the 23:30 occurrence
    const next = computeNextFire(
      { days: daysToMask([1]), time: '23:30', offsetMin: 60 },
      PARIS,
      at('2026-10-05T21:45:00Z'), // Mon 23:45 Paris
    );
    expect(next?.date).toBe('2026-10-05');
    expect(iso(next?.fireAt)).toBe('2026-10-05T22:30:00.000Z'); // Tue 00:30 Paris
  });

  it('skips dates the user already answered', () => {
    const next = computeNextFire(
      { days: MWF, time: '18:00', offsetMin: 60, skipDates: ['2026-10-05'] },
      PARIS,
      at('2026-10-05T08:00:00Z'),
    );
    expect(next?.date).toBe('2026-10-07');
  });

  it('can skip a whole week for weekly habits', () => {
    const next = computeNextFire(
      { days: daysToMask([6]), time: '08:00', offsetMin: 0, skipDates: ['2026-10-10'] },
      PARIS,
      at('2026-10-05T08:00:00Z'),
    );
    expect(next?.date).toBe('2026-10-17');
  });

  it('stays at local time across the October DST change', () => {
    // Sunday 25 Oct 2026 is the switch to CET; Monday 26 Oct 19:00 Paris = 18:00 UTC
    const next = computeNextFire({ days: MWF, time: '18:00', offsetMin: 60 }, PARIS, at('2026-10-24T12:00:00Z'));
    expect(next?.date).toBe('2026-10-26');
    expect(iso(next?.fireAt)).toBe('2026-10-26T18:00:00.000Z');
  });

  it('works in other zones', () => {
    const next = computeNextFire(
      { days: daysToMask([0, 1, 2, 3, 4, 5, 6]), time: '07:00', offsetMin: 0 },
      'Asia/Kolkata',
      at('2026-10-05T02:00:00Z'), // 07:30 IST
    );
    expect(next?.date).toBe('2026-10-06');
    expect(iso(next?.fireAt)).toBe('2026-10-06T01:30:00.000Z');
  });

  it('is strictly after the reference time', () => {
    const fire = at('2026-10-05T17:00:00Z');
    const next = computeNextFire({ days: MWF, time: '18:00', offsetMin: 60 }, PARIS, fire);
    expect(next?.date).toBe('2026-10-07');
  });

  it('returns null without any days', () => {
    expect(computeNextFire({ days: 0, time: '18:00', offsetMin: 0 }, PARIS, Date.now())).toBeNull();
  });
});

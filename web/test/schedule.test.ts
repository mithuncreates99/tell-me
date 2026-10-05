import { describe, expect, it } from 'vitest';
import { occurrencesOn, pendingBeforeToday, scheduleSummary, isScheduledOn } from '../src/lib/schedule';
import { at, checkin, habit, map, settings } from './helpers';

const gym = habit();
const read = habit({ id: 'read', name: 'Read', days: [0, 1, 2, 3, 4, 5, 6], time: null, order: 1 });

describe('schedule', () => {
  it('respects created / archived dates', () => {
    expect(isScheduledOn(gym, '2026-08-28')).toBe(false); // Friday before createdAt
    expect(isScheduledOn(gym, '2026-09-02')).toBe(true);
    const archived = habit({ archivedAt: '2026-10-01' });
    expect(isScheduledOn(archived, '2026-09-30')).toBe(true);
    expect(isScheduledOn(archived, '2026-10-02')).toBe(false);
  });

  it('marks occurrences upcoming, pending or answered', () => {
    const day = '2026-10-05'; // Monday
    const before = occurrencesOn([gym, read], day, map([]), settings, at('2026-10-05T12:00:00+02:00'));
    expect(before.map((o) => [o.habit.id, o.state])).toEqual([['gym', 'upcoming'], ['read', 'upcoming']]);
    // gym is asked at 19:00 (18:00 + 60 min), "any time" habits at 21:00
    const after = occurrencesOn([gym, read], day, map([]), settings, at('2026-10-05T19:30:00+02:00'));
    expect(after.map((o) => o.state)).toEqual(['pending', 'upcoming']);
    const answered = occurrencesOn([gym, read], day, map([checkin('gym', day, 'yes')]), settings, at('2026-10-05T19:30:00+02:00'));
    expect(answered[0]!.state).toBe('yes');
  });

  it('collects unanswered past occurrences, newest first', () => {
    const now = at('2026-10-07T09:00:00+02:00'); // Wednesday morning
    const pending = pendingBeforeToday([gym, read], map([checkin('read', '2026-10-06', 'yes')]), settings, now, 3);
    expect(pending.map((o) => `${o.habit.id}@${o.date}`)).toEqual(['gym@2026-10-05', 'read@2026-10-05', 'read@2026-10-04']);
  });

  it('summarises schedules', () => {
    const short = (d: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]!;
    const t = (x: string) => x;
    expect(scheduleSummary(gym, short, t)).toBe('Mon, Wed, Fri at 18:00');
    expect(scheduleSummary({ days: [0, 6], time: null }, short, t)).toBe('Weekends · any time');
    expect(scheduleSummary({ days: [0, 1, 2, 3, 4, 5, 6], time: '07:00' }, short, t)).toBe('Every day at 07:00');
    expect(scheduleSummary({ days: [0, 1], time: '07:00' }, short, t)).toBe('Mon, Sun at 07:00');
  });
});

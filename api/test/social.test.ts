import { describe, expect, it } from 'vitest';
import {
  addDays,
  CODE_ALPHABET,
  normalizeFriendCode,
  normalizeSharedHabit,
  randomFriendCode,
  startOfWeek,
  weekSummary,
  yesThisWeek,
  type SharedHabitRow,
} from '../src/social';
import { addFriendSchema, shareSchema, syncPushSchema } from '../src/validation';

const MON = 1 << 1;
const WED = 1 << 3;
const THU = 1 << 4;
const FRI = 1 << 5;
const paris = (iso: string) => Date.parse(`${iso}+02:00`);

function row(patch: Partial<SharedHabitRow>): SharedHabitRow {
  return {
    user_id: 'u',
    habit_id: 'gym',
    name: 'Gym',
    emoji: '🏋️',
    color: 'blue',
    days: MON | WED | FRI,
    time: '18:00',
    ask_min: 19 * 60,
    date: '2026-10-05',
    week_start: '2026-10-05',
    week: 'Y.F.F..',
    streak: 3,
    best: 5,
    position: 0,
    updated_at: 0,
    ...patch,
  };
}

describe('friend codes', () => {
  it('generates 8 unambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = randomFriendCode();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('normalizes what people type or paste', () => {
    expect(normalizeFriendCode(' k7p2-9xqm ')).toBe('K7P29XQM');
    expect(normalizeFriendCode('K7P2 9XQM')).toBe('K7P29XQM');
    expect(normalizeFriendCode('K7P29XQ')).toBeNull(); // too short
    expect(normalizeFriendCode('K7P29XQO')).toBeNull(); // O is not in the alphabet
    expect(addFriendSchema.safeParse({ code: 'abcd-efgh' }).success).toBe(true);
    expect(addFriendSchema.safeParse({ code: 'nope' }).success).toBe(false);
  });
});

describe('dates', () => {
  it('does calendar arithmetic', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(startOfWeek('2026-10-08', 1)).toBe('2026-10-05');
    expect(startOfWeek('2026-10-08', 0)).toBe('2026-10-04');
  });
});

describe('normalizeSharedHabit', () => {
  it('returns a fresh snapshot as is, with today pending or upcoming by the check-in time', () => {
    const r = row({ days: MON | THU, date: '2026-10-08', week: 'Y..P...' });
    expect(normalizeSharedHabit(r, 'Europe/Paris', paris('2026-10-08T12:00:00')).today).toBe('upcoming');
    const later = normalizeSharedHabit(r, 'Europe/Paris', paris('2026-10-08T20:00:00'));
    expect(later.today).toBe('pending');
    expect(later.week).toBe('Y..P...');
    expect(later.streak).toBe(3);
    expect(later.days).toEqual([1, 4]);
  });

  it('marks due days that passed unanswered as missed and ends the streak', () => {
    const v = normalizeSharedHabit(row({}), 'Europe/Paris', paris('2026-10-08T12:00:00'));
    expect(v.week).toBe('Y.M.F..');
    expect(v.streak).toBe(0);
    expect(v.today).toBe('rest');
    expect(weekSummary([v])).toEqual({ yes: 1, due: 2 });
  });

  it('keeps the streak when no due day was skipped', () => {
    const v = normalizeSharedHabit(row({ days: MON | THU, week: 'Y..F...' }), 'Europe/Paris', paris('2026-10-07T12:00:00'));
    expect(v.streak).toBe(3);
    expect(v.week).toBe('Y..F...');
    const thursday = normalizeSharedHabit(row({ days: MON | THU, week: 'Y..F...' }), 'Europe/Paris', paris('2026-10-08T20:00:00'));
    expect(thursday.week).toBe('Y..P...');
    expect(thursday.today).toBe('pending');
  });

  it("treats the snapshot day's own unanswered check-in as missed the next day", () => {
    const v = normalizeSharedHabit(row({ week: 'P.F.F..' }), 'Europe/Paris', paris('2026-10-06T09:00:00'));
    expect(v.week).toBe('M.F.F..');
    expect(v.streak).toBe(0);
  });

  it('starts a new, empty week', () => {
    const v = normalizeSharedHabit(row({}), 'Europe/Paris', paris('2026-10-13T09:00:00'));
    expect(v.weekStart).toBe('2026-10-12');
    expect(v.week).toBe('M.F.F..');
    expect(yesThisWeek(v)).toBe(0);
  });

  it("uses the owner's time zone", () => {
    // 20:00 in Paris on Monday is already Tuesday 00:30 in India.
    const r = row({ date: '2026-10-05', week: 'Y.F.F..', days: MON | WED | FRI });
    const v = normalizeSharedHabit(r, 'Asia/Kolkata', paris('2026-10-05T21:00:00'));
    expect(v.today).toBe('rest'); // Tuesday there, nothing planned
    expect(v.streak).toBe(3);
  });
});

describe('sync and share validation', () => {
  it('accepts encrypted records and rejects duplicates', () => {
    const rec = { k: 'h', id: 'AAAAAAAAAAAAAAAAAAAAAA', u: 1, d: 0, x: 'b'.repeat(40) };
    expect(syncPushSchema.safeParse({ records: [rec] }).success).toBe(true);
    expect(syncPushSchema.safeParse({ records: [rec, rec] }).success).toBe(false);
    expect(syncPushSchema.safeParse({ records: [] }).success).toBe(false);
    expect(syncPushSchema.safeParse({ answered: [{ habitId: 'gym', date: '2026-10-05' }] }).success).toBe(true);
  });

  it('validates shared habit snapshots', () => {
    const habit = { id: 'gym', name: 'Gym', emoji: '🏋️', color: 'blue', days: [1, 3, 5], time: '18:00', askMin: 1140, week: 'Y.F.F..', streak: 3, best: 5 };
    const body = { timeZone: 'Europe/Paris', date: '2026-10-05', weekStart: '2026-10-05', habits: [habit] };
    expect(shareSchema.safeParse(body).success).toBe(true);
    expect(shareSchema.safeParse({ ...body, habits: [{ ...habit, week: 'YES' }] }).success).toBe(false);
    expect(shareSchema.safeParse({ ...body, timeZone: 'Mars/Base' }).success).toBe(false);
  });
});

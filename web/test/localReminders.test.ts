import { describe, expect, it } from 'vitest';
import { interpretAction, MAX_PENDING, notificationId, planLocalNotifications } from '../src/lib/localReminders';
import { at, checkin, habit, map } from './helpers';

const s = { defaultAskTime: '21:00', weeklyReport: { enabled: true, day: 0 as const, time: '19:00' } };

describe('iPhone local reminders plan', () => {
  const now = at('2026-10-05T12:00:00+02:00'); // Monday noon

  it('schedules one Yes/No notification per upcoming, unanswered occurrence', () => {
    const plan = planLocalNotifications([habit()], map([]), s, now, 7);
    const checkins = plan.filter((p) => p.extra.kind === 'checkin');
    // Mon 5, Wed 7, Fri 9, Mon 12 (gym asked at 19:00)
    expect(checkins.map((p) => (p.extra as { date: string }).date)).toEqual(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12']);
    expect(checkins[0]).toMatchObject({ title: '🏋️ Gym: did you show up?', actionTypeId: 'CHECKIN' });
    expect(checkins[0]!.at.toISOString()).toBe('2026-10-05T17:00:00.000Z');
    expect(checkins[0]!.body).toContain('Press and hold');
  });

  it('skips answered days, past times, archived habits and habits with reminders off', () => {
    const plan = planLocalNotifications(
      [habit(), habit({ id: 'off', remind: false }), habit({ id: 'old', archivedAt: '2026-10-01' })],
      map([checkin('gym', '2026-10-05', 'yes')]),
      s,
      at('2026-10-07T20:00:00+02:00'), // Wednesday, after the 19:00 question
      3,
    );
    expect(plan.filter((p) => p.extra.kind === 'checkin').map((p) => (p.extra as { date: string }).date)).toEqual(['2026-10-09']);
  });

  it('adds the weekly report and stays under the iOS limit of 64 pending notifications', () => {
    const many = Array.from({ length: 12 }, (_, i) => habit({ id: `h${i}`, days: [0, 1, 2, 3, 4, 5, 6] }));
    const plan = planLocalNotifications(many, map([]), s, now);
    expect(plan.length).toBe(MAX_PENDING);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.at >= plan[i - 1]!.at).toBe(true);
    const weekly = planLocalNotifications([], map([]), s, now, 10);
    expect(weekly.map((p) => p.extra.kind)).toEqual(['weekly']); // Sun 11 Oct 19:00
  });

  it('uses stable ids that fit in a 32-bit int', () => {
    const id = notificationId('gym|2026-10-05');
    expect(id).toBe(notificationId('gym|2026-10-05'));
    expect(id).not.toBe(notificationId('gym|2026-10-07'));
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
  });
});

describe('notification taps and buttons', () => {
  const extra = { kind: 'checkin', habitId: 'gym', date: '2026-10-05' };
  it('maps buttons to answers and taps to screens', () => {
    expect(interpretAction('yes', extra)).toEqual({ kind: 'answer', habitId: 'gym', date: '2026-10-05', answer: 'yes' });
    expect(interpretAction('no', extra)).toMatchObject({ kind: 'answer', answer: 'no' });
    expect(interpretAction('tap', extra)).toEqual({ kind: 'open-checkin', habitId: 'gym', date: '2026-10-05' });
    expect(interpretAction('tap', { kind: 'weekly' })).toEqual({ kind: 'open-report' });
    expect(interpretAction('yes', { kind: 'test' })).toEqual({ kind: 'none' });
    expect(interpretAction('yes', null)).toEqual({ kind: 'none' });
  });
});

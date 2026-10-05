import { describe, expect, it } from 'vitest';
import { checkinNotification, parsePushPayload, weeklyNotification } from '../src/lib/notify';
import { checkin, habit } from './helpers';

const payload = { type: 'checkin' as const, habitId: 'gym', date: '2026-10-05', title: 'Gym', emoji: '🏋️', time: '18:00' };

describe('notifications', () => {
  it('validates push payloads', () => {
    expect(parsePushPayload(payload)).toEqual(payload);
    expect(parsePushPayload({ type: 'weekly', date: '2026-10-04' })).toEqual({ type: 'weekly', date: '2026-10-04' });
    expect(parsePushPayload({ type: 'evil' })).toBeNull();
    expect(parsePushPayload(null)).toBeNull();
  });

  it('asks the Yes/No question with action buttons and a streak nudge', () => {
    const n = checkinNotification(payload, { habit: habit(), streak: 4, today: '2026-10-05', canShowActions: true });
    expect(n.title).toBe('🏋️ Gym: did you show up?');
    expect(n.options.body).toContain('🔥 4 in a row');
    expect(n.options.actions?.map((a) => a.action)).toEqual(['yes', 'no']);
    expect(n.options.data).toMatchObject({ kind: 'checkin', habitId: 'gym', date: '2026-10-05', path: '#/checkin/gym/2026-10-05' });
  });

  it('tells platforms without buttons to tap, and handles already-answered', () => {
    expect(checkinNotification(payload, { streak: 0, today: '2026-10-05', canShowActions: false }).options.body).toMatch(/Tap to answer\.$/);
    const done = checkinNotification(payload, { existing: checkin('gym', '2026-10-05', 'yes'), streak: 0, today: '2026-10-05', canShowActions: true });
    expect(done.options.body).toContain('Already logged as Yes');
    expect(done.options.actions).toEqual([]);
  });

  it('summarises the week', () => {
    expect(weeklyNotification({ due: 12, yes: 9, prevRate: 0.5 }).title).toBe('📊 Your week: 9 of 12 (75%)');
    expect(weeklyNotification({ due: 12, yes: 9, prevRate: 0.5 }).options.body).toContain('Up 25 points');
    expect(weeklyNotification({ due: 0, yes: 0, prevRate: null }).title).toBe('📊 Your weekly report is ready');
  });
});

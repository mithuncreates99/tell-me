import { describe, expect, it } from 'vitest';
import type { DueRow } from '../src/repo';
import { nextAfter, payloadFor } from '../src/tick';

const row = (patch: Partial<DueRow> = {}): DueRow => ({
  device_id: 'device-1',
  id: 'water-morning',
  kind: 'checkin',
  title: 'Drink 1 L of water (morning)',
  emoji: '💧',
  days: 0b1111111,
  time: '09:00',
  offset_min: 0,
  skip_dates: '',
  follow_up_min: 0,
  next_fire_at: Date.parse('2026-10-12T07:00:00Z'),
  next_date: '2026-10-12',
  next_follow_up: 0,
  endpoint: 'https://push.example/1',
  p256dh: 'p',
  auth: 'a',
  time_zone: 'Europe/Paris',
  ...patch,
});

describe('check-in push payload', () => {
  it('is unchanged for ordinary reminders', () => {
    expect(payloadFor(row())).toEqual({
      type: 'checkin',
      habitId: 'water-morning',
      date: '2026-10-12',
      title: 'Drink 1 L of water (morning)',
      emoji: '💧',
      time: '09:00',
    });
  });

  it('asks the notification to stay on screen for a stronger reminder', () => {
    expect(payloadFor(row({ follow_up_min: 30 }))).toMatchObject({ insist: true });
    expect(payloadFor(row({ follow_up_min: 30 }))).not.toHaveProperty('followUp');
  });

  it('marks the second ask', () => {
    expect(payloadFor(row({ follow_up_min: 30, next_follow_up: 1 }))).toMatchObject({ insist: true, followUp: true });
  });
});

describe('after a push is sent', () => {
  it('schedules the second ask for the same occurrence', () => {
    const next = nextAfter(row({ follow_up_min: 30 }), Date.parse('2026-10-12T07:00:20Z'));
    expect(next).toEqual({ fireAt: Date.parse('2026-10-12T07:30:00Z'), date: '2026-10-12', followUp: true });
  });

  it('then moves on to the next day', () => {
    const sentSecond = row({ follow_up_min: 30, next_fire_at: Date.parse('2026-10-12T07:30:00Z'), next_follow_up: 1 });
    expect(nextAfter(sentSecond, Date.parse('2026-10-12T07:30:05Z'))).toEqual({
      fireAt: Date.parse('2026-10-13T07:00:00Z'),
      date: '2026-10-13',
      followUp: false,
    });
  });
});

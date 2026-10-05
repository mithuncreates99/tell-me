import { checkinKey, toCheckinMap } from '../src/lib/schedule';
import type { Answer, Checkin, Habit, MissReason, Weekday } from '../src/lib/types';

export const settings = { defaultAskTime: '21:00', weekStartsOn: 1 as const };

export function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'gym',
    name: 'Gym',
    emoji: '🏋️',
    color: 'blue',
    days: [1, 3, 5] as Weekday[],
    time: '18:00',
    askAfterMin: 60,
    remind: true,
    createdAt: '2026-08-31',
    archivedAt: null,
    order: 0,
    ...overrides,
  };
}

export function checkin(habitId: string, date: string, answer: Answer, reason?: MissReason): Checkin {
  return { id: checkinKey(habitId, date), habitId, date, answer, reason, answeredAt: `${date}T20:00:00.000Z`, via: 'app' };
}

export const map = (list: Checkin[]) => toCheckinMap(list);

/** Local time in Europe/Paris (the test zone). */
export const at = (iso: string) => new Date(iso);

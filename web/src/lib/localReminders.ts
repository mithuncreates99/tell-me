import { addDays, atMinutes, formatTime, todayISO, weekdayOf } from './dates';
import { askAt, checkinKey, isScheduledOn, type CheckinMap } from './schedule';
import type { Habit, ISODate, Settings } from './types';

/**
 * iPhone app (native) reminders: instead of a server, the phone schedules its own
 * local notifications for the next few days. This file only *plans* them (pure, testable);
 * nativeReminders.ts hands the plan to iOS.
 */
export interface PlannedNotification {
  /** Stable 31-bit id, so re-planning replaces the same notification. */
  id: number;
  at: Date;
  title: string;
  body: string;
  actionTypeId?: 'CHECKIN';
  extra: { kind: 'checkin'; habitId: string; date: ISODate } | { kind: 'weekly' };
}

/** iOS keeps at most 64 pending local notifications per app; stay under it. */
export const MAX_PENDING = 60;
/** How far ahead to schedule. Opening the app (daily) rolls the window forward. */
export const HORIZON_DAYS = 10;

export function notificationId(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff || 1;
}

export function planLocalNotifications(
  habits: Habit[],
  checkins: CheckinMap,
  settings: Pick<Settings, 'defaultAskTime' | 'weeklyReport'>,
  now: Date,
  horizonDays = HORIZON_DAYS,
  max = MAX_PENDING,
): PlannedNotification[] {
  const today = todayISO(now);
  const plan: PlannedNotification[] = [];

  // Start yesterday: a late habit's question can land after midnight.
  for (let i = -1; i <= horizonDays; i++) {
    const date = addDays(today, i);
    for (const habit of habits) {
      if (!habit.remind || habit.archivedAt || !isScheduledOn(habit, date)) continue;
      if (checkins.has(checkinKey(habit.id, date))) continue; // already answered
      const at = askAt(habit, date, settings);
      if (at <= now) continue;
      plan.push({
        id: notificationId(`${habit.id}|${date}`),
        at,
        title: `${habit.emoji} ${habit.name}: did you show up?`,
        body: `${habit.time ? `Planned at ${formatTime(habit.time)}. ` : ''}Press and hold to answer Yes or No.`,
        actionTypeId: 'CHECKIN',
        extra: { kind: 'checkin', habitId: habit.id, date },
      });
    }
  }

  if (settings.weeklyReport.enabled) {
    const [h, m] = settings.weeklyReport.time.split(':').map(Number);
    for (let i = 0; i <= horizonDays; i++) {
      const date = addDays(today, i);
      if (weekdayOf(date) !== settings.weeklyReport.day) continue;
      const at = atMinutes(date, h! * 60 + m!);
      if (at <= now) continue;
      plan.push({
        id: notificationId(`weekly|${date}`),
        at,
        title: '📊 Your weekly report is ready',
        body: 'See how your week went and what to change next week.',
        extra: { kind: 'weekly' },
      });
    }
  }

  return plan.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, max);
}

export type NotificationTap =
  | { kind: 'answer'; habitId: string; date: string; answer: 'yes' | 'no' }
  | { kind: 'open-checkin'; habitId: string; date: string }
  | { kind: 'open-report' }
  | { kind: 'none' };

/** Turns a notification tap or button press into something the app can act on. */
export function interpretAction(actionId: string, extra: unknown): NotificationTap {
  const e = (extra ?? {}) as { kind?: string; habitId?: string; date?: string };
  if (e.kind === 'weekly') return { kind: 'open-report' };
  if (e.kind !== 'checkin' || !e.habitId || !e.date) return { kind: 'none' };
  if (actionId === 'yes' || actionId === 'no') return { kind: 'answer', habitId: e.habitId, date: e.date, answer: actionId };
  return { kind: 'open-checkin', habitId: e.habitId, date: e.date };
}

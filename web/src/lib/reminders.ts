import type { ReminderInput } from './api';
import { addDays, todayISO } from './dates';
import { checkinKey, type CheckinMap } from './schedule';
import type { Habit, Settings } from './types';

/**
 * The complete reminder schedule the server should hold for this device.
 * Only names, emoji and times leave the phone; answers never do. Dates already answered
 * (e.g. you logged the gym before the reminder) are sent as skipDates so no push goes out.
 */
export function buildReminders(
  habits: Habit[],
  checkins: CheckinMap,
  settings: Pick<Settings, 'defaultAskTime' | 'weeklyReport'>,
  now: Date,
): ReminderInput[] {
  const today = todayISO(now);
  const reminders: ReminderInput[] = habits
    .filter((h) => !h.archivedAt && h.remind && h.days.length > 0)
    .map((h) => {
      const skipDates: string[] = [];
      for (let i = -1; i <= 7; i++) {
        const d = addDays(today, i);
        if (checkins.has(checkinKey(h.id, d))) skipDates.push(d);
      }
      return {
        id: h.id,
        kind: 'checkin' as const,
        title: h.name.slice(0, 80),
        emoji: h.emoji,
        days: [...h.days].sort(),
        time: h.time ?? settings.defaultAskTime,
        offsetMin: h.time ? h.askAfterMin : 0,
        skipDates,
      };
    });
  if (settings.weeklyReport.enabled) {
    reminders.push({
      id: 'weekly-report',
      kind: 'weekly',
      title: 'Weekly report',
      emoji: '📊',
      days: [settings.weeklyReport.day],
      time: settings.weeklyReport.time,
      offsetMin: 0,
      skipDates: [],
    });
  }
  return reminders;
}

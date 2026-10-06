import type { ShareBody } from './api';
import { addDays, startOfWeek, todayISO } from './dates';
import { isDemoHabitId } from './db';
import { askMinutes, checkinKey, isScheduledOn, type CheckinMap } from './schedule';
import { streakFor } from './stats';
import type { Habit, Settings } from './types';

/**
 * What friends see: only habits marked "shared", and for each one this week's Yes/No pattern
 * and the streak. Reasons, notes and every other habit stay private (and encrypted).
 *
 * Week string, one char per day from weekStart:
 *   Y yes · N no · M missed (past, never answered) · P due today · F due later · . not planned
 */
export function weekPattern(habit: Habit, checkins: CheckinMap, weekStart: string, today: string): string {
  let out = '';
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    if (!isScheduledOn(habit, date)) {
      out += '.';
      continue;
    }
    const c = checkins.get(checkinKey(habit.id, date));
    out += c ? (c.answer === 'yes' ? 'Y' : 'N') : date < today ? 'M' : date === today ? 'P' : 'F';
  }
  return out;
}

export const MAX_SHARED = 20;

export function buildShare(
  habits: Habit[],
  checkins: CheckinMap,
  settings: Pick<Settings, 'defaultAskTime' | 'weekStartsOn'>,
  now: Date,
  event?: ShareBody['event'],
): ShareBody {
  const today = todayISO(now);
  const weekStart = startOfWeek(today, settings.weekStartsOn);
  const shared = habits
    .filter((h) => h.shared && !h.archivedAt && !isDemoHabitId(h.id))
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_SHARED);
  const body: ShareBody = {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    date: today,
    weekStart,
    habits: shared.map((h) => {
      const streak = streakFor(h, checkins, settings, now);
      return {
        id: h.id,
        name: h.name.slice(0, 60),
        emoji: h.emoji,
        color: h.color,
        days: [...h.days].sort(),
        time: h.time,
        askMin: Math.min(askMinutes(h, settings), 2880),
        week: weekPattern(h, checkins, weekStart, today),
        streak: streak.current,
        best: streak.best,
      };
    }),
  };
  if (event && shared.some((h) => h.id === event.habitId)) body.event = event;
  return body;
}

/** FNV-1a over the snapshot without the event, so unchanged states aren't re-sent. */
export function shareFingerprint(body: ShareBody): string {
  const text = JSON.stringify({ ...body, event: undefined });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

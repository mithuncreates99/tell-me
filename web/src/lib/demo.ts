import { addDays, todayISO, weekdayOf } from './dates';
import { askAt, checkinKey } from './schedule';
import type { Checkin, Habit, MissReason, Settings, Weekday } from './types';

/** Deterministic pseudo-random number in [0, 1) for a key, so each demo day always looks the same. */
function random(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface DemoHabit {
  habit: Omit<Habit, 'createdAt' | 'order' | 'archivedAt'>;
  /** Probability of "yes", by weekday, before the improving trend. */
  chance: (weekday: Weekday) => number;
  /** Improvement per week (shows a nice upward trend). */
  trend: number;
  reasons: MissReason[];
}

const DEMO: DemoHabit[] = [
  {
    habit: { id: 'demo-gym', name: 'Gym', emoji: '🏋️', color: 'blue', days: [1, 3, 5], time: '18:00', askAfterMin: 90, remind: true },
    chance: (d) => (d === 5 ? 0.35 : 0.85),
    trend: 0.02,
    reasons: ['tired', 'tired', 'busy', 'tired', 'other'],
  },
  {
    habit: { id: 'demo-meditate', name: 'Meditate', emoji: '🧘', color: 'orange', days: [1, 2, 3, 4, 5], time: '07:30', askAfterMin: 30, remind: true },
    chance: () => 0.9,
    trend: 0,
    reasons: ['forgot', 'forgot', 'busy'],
  },
  {
    habit: { id: 'demo-french', name: 'French practice', emoji: '🇫🇷', color: 'aqua', days: [2, 4], time: '19:00', askAfterMin: 60, remind: true },
    chance: () => 0.75,
    trend: 0.02,
    reasons: ['busy', 'tired', 'forgot'],
  },
  {
    habit: { id: 'demo-read', name: 'Read 20 pages', emoji: '📚', color: 'violet', days: [0, 1, 2, 3, 4, 5, 6], time: '22:00', askAfterMin: 30, remind: true },
    chance: (d) => (d === 5 ? 0.3 : d === 0 || d === 6 ? 0.6 : 0.5),
    trend: -0.015,
    reasons: ['tired', 'forgot', 'tired', 'busy'],
  },
  {
    habit: { id: 'demo-run', name: 'Long run', emoji: '🏃', color: 'green', days: [6], time: '09:00', askAfterMin: 90, remind: true },
    chance: () => 0.8,
    trend: 0,
    reasons: ['rest', 'sick'],
  },
];

export const DEMO_WEEKS = 8;

/** Eight weeks of realistic history: weak Fridays, strong mornings, a slipping late-evening habit, "tired" as the top excuse. */
export function buildDemoData(settings: Pick<Settings, 'defaultAskTime'>, now = new Date()): { habits: Habit[]; checkins: Checkin[] } {
  const today = todayISO(now);
  const start = addDays(today, -DEMO_WEEKS * 7);
  const habits: Habit[] = DEMO.map((d, i) => ({ ...d.habit, createdAt: start, archivedAt: null, order: i }));
  const checkins: Checkin[] = [];

  for (let date = start; date < today; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    const week = Math.floor((DEMO_WEEKS * 7 - (Date.parse(today) - Date.parse(date)) / 86_400_000) / 7);
    DEMO.forEach((d, i) => {
      const habit = habits[i]!;
      if (!habit.days.includes(wd)) return;
      // Leave a couple of recent ones unanswered so the "Catch up" prompt has something to show.
      if (date === addDays(today, -1) && habit.id === 'demo-read') return;
      const p = Math.min(0.97, Math.max(0.05, d.chance(wd) + d.trend * week));
      const roll = (salt: string) => random(`${habit.id}|${date}|${salt}`);
      const yes = roll('answer') < p;
      const at = askAt(habit, date, settings);
      const c: Checkin = {
        id: checkinKey(habit.id, date),
        habitId: habit.id,
        date,
        answer: yes ? 'yes' : 'no',
        answeredAt: new Date(at.getTime() + roll('delay') * 3_600_000).toISOString(),
        via: roll('via') < 0.7 ? 'notification' : 'app',
      };
      if (!yes && roll('reason?') < 0.85) c.reason = d.reasons[Math.floor(roll('reason') * d.reasons.length)];
      checkins.push(c);
    });
  }

  // Today: answer the things that already happened this morning.
  for (const habit of habits) {
    if (!habit.days.includes(weekdayOf(today))) continue;
    if (askAt(habit, today, settings) <= now && habit.time && habit.time < '12:00') {
      checkins.push({
        id: checkinKey(habit.id, today),
        habitId: habit.id,
        date: today,
        answer: 'yes',
        answeredAt: now.toISOString(),
        via: 'notification',
      });
    }
  }
  return { habits, checkins };
}

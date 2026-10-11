import { isDemoHabitId } from './db';
import type { Habit, ISODate, Settings, Weekday } from './types';

/**
 * Starter habits: three water check-ins that add up to 4 litres a day, added once to every
 * device's habit list (existing users and new ones). People can change or delete them like any
 * other habit, and a deleted one is never added back.
 */

/** Bump when a new set of starter habits should reach everyone once. */
export const STARTER_VERSION = 1;

/**
 * The sync timestamp the starter habits are written with (the day they were introduced). Every
 * device writes the same ids with this same timestamp, so two devices can't duplicate them, and
 * any real edit or deletion (always newer) beats a device that adds them later.
 */
export const STARTER_STAMP = Date.UTC(2026, 9, 11);

/** Off only in the browser-test builds, which count habits exactly. */
export const STARTER_ENABLED = import.meta.env.VITE_STARTER_HABITS !== 'off';

const EVERY_DAY: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export const STARTER_HABITS = [
  { id: 'water-morning', name: 'Drink 1 L of water (morning)', time: '09:00' },
  { id: 'water-noon', name: 'Drink 1.5 L of water (noon)', time: '13:00' },
  { id: 'water-evening', name: 'Drink 1.5 L of water (evening)', time: '18:00' },
] as const;

export const STARTER_IDS: readonly string[] = STARTER_HABITS.map((h) => h.id);

/**
 * Whether this device still has to offer the starter habits. Not before a new user's first habit
 * (the welcome screen comes first), never into the sample data, and only once per device.
 */
export function starterDue(habits: readonly Habit[], settings: Pick<Settings, 'starter'>): boolean {
  if ((settings.starter ?? 0) >= STARTER_VERSION) return false;
  if (habits.length === 0) return false;
  return !habits.some((h) => isDemoHabitId(h.id));
}

/** The starter habits this device doesn't have yet, placed after the existing ones. */
export function starterHabitsToAdd(habits: readonly Habit[], today: ISODate): Habit[] {
  const have = new Set(habits.map((h) => h.id));
  let order = habits.reduce((max, h) => Math.max(max, h.order), -1);
  return STARTER_HABITS.filter((s) => !have.has(s.id)).map((s) => ({
    id: s.id,
    name: s.name,
    emoji: '💧',
    color: 'blue',
    days: EVERY_DAY,
    time: s.time,
    askAfterMin: 0,
    remind: true,
    strongReminder: true,
    createdAt: today,
    archivedAt: null,
    order: ++order,
  }));
}

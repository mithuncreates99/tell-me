import { HABIT_COLORS, type HabitColor, type Habit } from './types';

/** Validated categorical palette (light / dark steps). Identity is never color-alone: habits always show emoji + name. */
export const HABIT_COLOR_HEX: Record<HabitColor, { light: string; dark: string }> = {
  blue: { light: '#2a78d6', dark: '#3987e5' },
  orange: { light: '#eb6834', dark: '#d95926' },
  aqua: { light: '#1baf7a', dark: '#199e70' },
  yellow: { light: '#eda100', dark: '#c98500' },
  magenta: { light: '#e87ba4', dark: '#d55181' },
  green: { light: '#008300', dark: '#008300' },
  violet: { light: '#4a3aa7', dark: '#9085e9' },
  red: { light: '#e34948', dark: '#e66767' },
};

/** CSS custom property set by index.css for the current theme. */
export const habitColorVar = (c: HabitColor) => `var(--habit-${c})`;

/** Next unused color in fixed palette order (never cycled randomly). */
export function nextColor(habits: Pick<Habit, 'color' | 'archivedAt'>[]): HabitColor {
  const used = new Set(habits.filter((h) => !h.archivedAt).map((h) => h.color));
  return HABIT_COLORS.find((c) => !used.has(c)) ?? HABIT_COLORS[habits.length % HABIT_COLORS.length]!;
}

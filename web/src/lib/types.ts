/** Local calendar date, "YYYY-MM-DD" (always in the device's own time zone). */
export type ISODate = string;

/** 0 = Sunday ... 6 = Saturday (same as Date#getDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const HABIT_COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'] as const;
export type HabitColor = (typeof HABIT_COLORS)[number];

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  color: HabitColor;
  /** Weekdays this habit is planned for. */
  days: Weekday[];
  /** Planned local time "HH:MM", or null for "any time today". */
  time: string | null;
  /** How long after the planned time to ask "Did you show up?" (minutes). */
  askAfterMin: number;
  /** Send push reminders for this habit. */
  remind: boolean;
  /** First day the habit counts (earlier days are never "missed"). */
  createdAt: ISODate;
  /** From this day on the habit is paused/archived (history is kept). */
  archivedAt: ISODate | null;
  order: number;
}

export type Answer = 'yes' | 'no';
export const MISS_REASONS = ['tired', 'busy', 'sick', 'forgot', 'rest', 'other'] as const;
export type MissReason = (typeof MISS_REASONS)[number];

export interface Checkin {
  /** `${habitId}:${date}` — one answer per habit per day. */
  id: string;
  habitId: string;
  date: ISODate;
  answer: Answer;
  reason?: MissReason;
  note?: string;
  /** ISO timestamp. */
  answeredAt: string;
  via: 'app' | 'notification';
}

export interface PushState {
  enabled: boolean;
  deviceId?: string;
  token?: string;
  endpoint?: string;
  lastSyncAt?: string;
  lastSyncHash?: string;
  lastError?: string | null;
}

export interface Settings {
  name: string;
  weekStartsOn: 0 | 1;
  /** When to ask about "any time" habits. */
  defaultAskTime: string;
  weeklyReport: { enabled: boolean; day: Weekday; time: string };
  theme: 'system' | 'light' | 'dark';
  push: PushState;
  /** iPhone app: reminders scheduled on the device as local notifications. */
  localReminders: boolean;
  onboarded: boolean;
  dismissedPushPromo?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  weekStartsOn: 1,
  defaultAskTime: '21:00',
  weeklyReport: { enabled: true, day: 0, time: '19:00' },
  theme: 'system',
  push: { enabled: false },
  localReminders: false,
  onboarded: false,
};

export interface AppData {
  habits: Habit[];
  checkins: Checkin[];
  settings: Settings;
}

/** File format for backups (Settings → Export). */
export interface BackupFile {
  app: 'tell-me';
  version: 1;
  exportedAt: string;
  habits: Habit[];
  checkins: Checkin[];
  settings: Omit<Settings, 'push'>;
}

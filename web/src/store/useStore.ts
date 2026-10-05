import { create } from 'zustand';
import { nextColor } from '../lib/colors';
import { todayISO } from '../lib/dates';
import * as db from '../lib/db';
import { buildDemoData } from '../lib/demo';
import { newId } from '../lib/ids';
import { checkinKey, toCheckinMap, type CheckinMap } from '../lib/schedule';
import {
  DEFAULT_SETTINGS,
  type Answer,
  type BackupFile,
  type Checkin,
  type Habit,
  type HabitColor,
  type MissReason,
  type Settings,
  type Weekday,
} from '../lib/types';

export interface Toast {
  id: number;
  message: string;
  tone?: 'default' | 'good' | 'bad';
  action?: { label: string; run: () => void };
}

export interface NewHabit {
  name: string;
  emoji: string;
  days: Weekday[];
  time: string | null;
  color?: HabitColor;
  askAfterMin?: number;
  remind?: boolean;
}

interface State {
  ready: boolean;
  habits: Habit[];
  checkins: CheckinMap;
  settings: Settings;
  /** Re-rendered every 30 s so "upcoming" becomes "pending" on time. */
  now: Date;
  toast: Toast | null;
  /** The "What got in the way?" sheet after answering No. */
  reasonFor: { habitId: string; date: string } | null;
  /** iPhone app: how many local reminders are scheduled right now (null = unknown). */
  localScheduled: number | null;
}

interface Actions {
  init(): Promise<void>;
  reloadFromDisk(): Promise<void>;
  tick(): void;
  addHabits(input: NewHabit[]): Promise<Habit[]>;
  saveHabit(habit: Habit): Promise<void>;
  deleteHabit(id: string): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  moveHabit(id: string, direction: -1 | 1): Promise<void>;
  answer(habitId: string, date: string, answer: Answer, extra?: { reason?: MissReason; note?: string }): Promise<void>;
  setReason(habitId: string, date: string, reason: MissReason | undefined, note?: string): Promise<void>;
  clearAnswer(habitId: string, date: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  loadDemo(): Promise<void>;
  exportBackup(): BackupFile;
  importBackup(file: unknown): Promise<number>;
  resetAll(): Promise<void>;
  showToast(message: string, opts?: Omit<Toast, 'id' | 'message'>): void;
  dismissToast(): void;
  askReason(target: { habitId: string; date: string } | null): void;
  setLocalScheduled(n: number | null): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State & Actions>()((set, get) => ({
  ready: false,
  habits: [],
  checkins: new Map(),
  settings: DEFAULT_SETTINGS,
  now: new Date(),
  toast: null,
  reasonFor: null,
  localScheduled: null,

  async init() {
    try {
      const data = await db.loadAll();
      set({ habits: data.habits, checkins: toCheckinMap(data.checkins), settings: data.settings, ready: true, now: new Date() });
    } catch (err) {
      // Private browsing modes can block IndexedDB: still start, and say why nothing will be saved.
      console.warn('Storage unavailable', err);
      set({ ready: true, now: new Date() });
      get().showToast("This browser is blocking storage, so changes won't be saved.", { tone: 'bad' });
    }
  },

  /** Another tab or the service worker (a notification answer) changed the data. */
  async reloadFromDisk() {
    const data = await db.loadAll();
    set({ habits: data.habits, checkins: toCheckinMap(data.checkins), settings: data.settings, now: new Date() });
  },

  tick() {
    set({ now: new Date() });
  },

  async addHabits(input) {
    const { habits } = get();
    const today = todayISO();
    const created: Habit[] = [];
    let all = [...habits];
    let order = habits.reduce((max, h) => Math.max(max, h.order), -1);
    for (const h of input) {
      const habit: Habit = {
        id: newId(),
        name: h.name.trim().slice(0, 60),
        emoji: h.emoji || '✅',
        color: h.color ?? nextColor(all),
        days: [...h.days].sort() as Weekday[],
        time: h.time,
        askAfterMin: h.askAfterMin ?? (h.time ? 60 : 0),
        remind: h.remind ?? true,
        createdAt: today,
        archivedAt: null,
        order: ++order,
      };
      created.push(habit);
      all = [...all, habit];
    }
    await db.putHabits(created);
    set({ habits: all, settings: { ...get().settings } });
    if (!get().settings.onboarded) await get().updateSettings({ onboarded: true });
    db.announceChange();
    return created;
  },

  async saveHabit(habit) {
    await db.putHabit(habit);
    set({ habits: get().habits.map((h) => (h.id === habit.id ? habit : h)) });
    db.announceChange();
  },

  async deleteHabit(id) {
    await db.deleteHabit(id);
    const checkins = new Map(get().checkins);
    for (const [key, c] of checkins) if (c.habitId === id) checkins.delete(key);
    set({ habits: get().habits.filter((h) => h.id !== id), checkins });
    db.announceChange();
  },

  async setArchived(id, archived) {
    const habit = get().habits.find((h) => h.id === id);
    if (!habit) return;
    await get().saveHabit({ ...habit, archivedAt: archived ? todayISO() : null });
  },

  async moveHabit(id, direction) {
    const list = [...get().habits].sort((a, b) => a.order - b.order);
    const i = list.findIndex((h) => h.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    const reordered = list.map((h, order) => ({ ...h, order }));
    await db.putHabits(reordered);
    set({ habits: reordered });
    db.announceChange();
  },

  async answer(habitId, date, answer, extra) {
    const checkin: Checkin = {
      id: checkinKey(habitId, date),
      habitId,
      date,
      answer,
      answeredAt: new Date().toISOString(),
      via: 'app',
      ...(answer === 'no' && extra?.reason ? { reason: extra.reason } : {}),
      ...(extra?.note ? { note: extra.note.slice(0, 200) } : {}),
    };
    await db.putCheckin(checkin);
    const checkins = new Map(get().checkins);
    checkins.set(checkin.id, checkin);
    set({ checkins, now: new Date() });
    db.announceChange();
  },

  async setReason(habitId, date, reason, note) {
    const existing = get().checkins.get(checkinKey(habitId, date));
    if (!existing) return;
    const updated: Checkin = { ...existing, reason, note: note?.slice(0, 200) || undefined };
    await db.putCheckin(updated);
    const checkins = new Map(get().checkins);
    checkins.set(updated.id, updated);
    set({ checkins });
    db.announceChange();
  },

  async clearAnswer(habitId, date) {
    const id = checkinKey(habitId, date);
    await db.deleteCheckin(id);
    const checkins = new Map(get().checkins);
    checkins.delete(id);
    set({ checkins });
    db.announceChange();
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    await db.saveSettings(settings);
    set({ settings });
    db.announceChange();
  },

  async loadDemo() {
    const { settings } = get();
    const demo = buildDemoData(settings);
    const next = { ...settings, onboarded: true };
    await db.replaceAll({ ...demo, settings: next });
    set({ habits: demo.habits, checkins: toCheckinMap(demo.checkins), settings: next, now: new Date() });
    db.announceChange();
  },

  exportBackup() {
    const { habits, checkins, settings } = get();
    const { push: _push, ...rest } = settings;
    return {
      app: 'tell-me',
      version: 1,
      exportedAt: new Date().toISOString(),
      habits,
      checkins: [...checkins.values()],
      settings: rest,
    };
  },

  async importBackup(file) {
    const data = file as Partial<BackupFile>;
    if (!data || data.app !== 'tell-me' || !Array.isArray(data.habits) || !Array.isArray(data.checkins)) {
      throw new Error("That file isn't a Tell Me backup.");
    }
    const habits = data.habits.filter((h) => h && typeof h.id === 'string' && typeof h.name === 'string' && Array.isArray(h.days));
    const ids = new Set(habits.map((h) => h.id));
    const checkins = data.checkins.filter((c) => c && ids.has(c.habitId) && (c.answer === 'yes' || c.answer === 'no'));
    const settings = { ...get().settings, ...(data.settings ?? {}), push: get().settings.push, onboarded: true };
    await db.replaceAll({ habits, checkins, settings });
    set({ habits: habits.sort((a, b) => a.order - b.order), checkins: toCheckinMap(checkins), settings });
    db.announceChange();
    return habits.length;
  },

  async resetAll() {
    await db.clearAll();
    set({ habits: [], checkins: new Map(), settings: { ...DEFAULT_SETTINGS, push: get().settings.push } });
    await db.saveSettings(get().settings);
    db.announceChange();
  },

  showToast(message, opts) {
    clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), message, ...opts } });
    toastTimer = setTimeout(() => set({ toast: null }), opts?.action ? 6000 : 3200);
  },

  dismissToast() {
    clearTimeout(toastTimer);
    set({ toast: null });
  },

  askReason(target) {
    set({ reasonFor: target });
  },

  setLocalScheduled(n) {
    set({ localScheduled: n });
  },
}));

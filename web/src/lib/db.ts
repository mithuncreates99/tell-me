import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type AppData, type Checkin, type Habit, type Settings } from './types';

/**
 * Local-first storage in IndexedDB. The page and the service worker share this database,
 * so tapping "Yes" on a notification is recorded even when the app is closed.
 */
interface TellMeDB extends DBSchema {
  habits: { key: string; value: Habit };
  checkins: { key: string; value: Checkin; indexes: { byHabit: string; byDate: string } };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'tell-me';
let dbPromise: Promise<IDBPDatabase<TellMeDB>> | null = null;

export function db(): Promise<IDBPDatabase<TellMeDB>> {
  dbPromise ??= openDB<TellMeDB>(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore('habits', { keyPath: 'id' });
      const checkins = database.createObjectStore('checkins', { keyPath: 'id' });
      checkins.createIndex('byHabit', 'habitId');
      checkins.createIndex('byDate', 'date');
      database.createObjectStore('kv');
    },
  });
  return dbPromise;
}

/** For tests. */
export async function closeDB(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export function withDefaults(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    weeklyReport: { ...DEFAULT_SETTINGS.weeklyReport, ...s?.weeklyReport },
    push: { ...DEFAULT_SETTINGS.push, ...s?.push },
  };
}

export async function loadAll(): Promise<AppData> {
  const d = await db();
  const [habits, checkins, settings] = await Promise.all([
    d.getAll('habits'),
    d.getAll('checkins'),
    d.get('kv', 'settings') as Promise<Partial<Settings> | undefined>,
  ]);
  return { habits: habits.sort((a, b) => a.order - b.order), checkins, settings: withDefaults(settings) };
}

export async function loadCheckins(): Promise<Checkin[]> {
  return (await db()).getAll('checkins');
}

export async function getHabit(id: string): Promise<Habit | undefined> {
  return (await db()).get('habits', id);
}

export async function putHabit(habit: Habit): Promise<void> {
  await (await db()).put('habits', habit);
}

export async function putHabits(habits: Habit[]): Promise<void> {
  const tx = (await db()).transaction('habits', 'readwrite');
  await Promise.all([...habits.map((h) => tx.store.put(h)), tx.done]);
}

/** Deletes a habit and its whole history. */
export async function deleteHabit(id: string): Promise<void> {
  const tx = (await db()).transaction(['habits', 'checkins'], 'readwrite');
  const keys = await tx.objectStore('checkins').index('byHabit').getAllKeys(id);
  await Promise.all([
    tx.objectStore('habits').delete(id),
    ...keys.map((k) => tx.objectStore('checkins').delete(k)),
    tx.done,
  ]);
}

export async function putCheckin(checkin: Checkin): Promise<void> {
  await (await db()).put('checkins', checkin);
}

export async function deleteCheckin(id: string): Promise<void> {
  await (await db()).delete('checkins', id);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await (await db()).put('kv', settings, 'settings');
}

export async function loadSettings(): Promise<Settings> {
  return withDefaults((await (await db()).get('kv', 'settings')) as Partial<Settings> | undefined);
}

/** Replaces habits and check-ins (import / demo). Settings are kept unless given. */
export async function replaceAll(data: { habits: Habit[]; checkins: Checkin[]; settings?: Settings }): Promise<void> {
  const tx = (await db()).transaction(['habits', 'checkins', 'kv'], 'readwrite');
  await tx.objectStore('habits').clear();
  await tx.objectStore('checkins').clear();
  await Promise.all([
    ...data.habits.map((h) => tx.objectStore('habits').put(h)),
    ...data.checkins.map((c) => tx.objectStore('checkins').put(c)),
    ...(data.settings ? [tx.objectStore('kv').put(data.settings, 'settings')] : []),
    tx.done,
  ]);
}

export async function clearAll(): Promise<void> {
  const tx = (await db()).transaction(['habits', 'checkins', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('habits').clear(),
    tx.objectStore('checkins').clear(),
    tx.objectStore('kv').clear(),
    tx.done,
  ]);
}

/** Tells other tabs and the service worker that data changed. */
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tell-me') : null;

export function announceChange(): void {
  channel?.postMessage({ type: 'data-changed' });
}

export function onExternalChange(fn: () => void): () => void {
  if (!channel) return () => {};
  const handler = (e: MessageEvent) => {
    if (e.data?.type === 'data-changed') fn();
  };
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}

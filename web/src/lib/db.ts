import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import { DEFAULT_SETTINGS, type AppData, type Checkin, type Habit, type Settings } from './types';

/**
 * Local-first storage in IndexedDB. The page and the service worker share this database,
 * so tapping "Yes" on a notification is recorded even when the app is closed.
 *
 * When the user has an account, every local change also leaves an entry in the `outbox`, and the
 * sync engine (sync.ts) uploads it end-to-end encrypted. Changes that arrive from other devices
 * are written with `applyRemote`, which never touches the outbox.
 */
export type RecordKind = 'h' | 'c';

export interface OutboxEntry {
  /** `${kind}:${id}` */
  key: string;
  kind: RecordKind;
  id: string;
  updatedAt: number;
  deleted: boolean;
}

interface TellMeDB extends DBSchema {
  habits: { key: string; value: Habit };
  checkins: { key: string; value: Checkin; indexes: { byHabit: string; byDate: string } };
  kv: { key: string; value: unknown };
  outbox: { key: string; value: OutboxEntry };
}

type Stores = StoreNames<TellMeDB>;
type Tx<S extends Stores[]> = IDBPTransaction<TellMeDB, S, 'readwrite'>;

let dbName = 'tell-me';
let dbPromise: Promise<IDBPDatabase<TellMeDB>> | null = null;
let onBlocked: (() => void) | null = null;

/** Called when an update to the database has to wait for an older Tell Me tab to close. */
export function onUpgradeBlocked(fn: (() => void) | null): void {
  onBlocked = fn;
}

export function db(): Promise<IDBPDatabase<TellMeDB>> {
  dbPromise ??= openDB<TellMeDB>(dbName, 2, {
    // An older tab or service worker still has the previous version open: tell the user.
    blocked() {
      onBlocked?.();
    },
    // Something else needs the database: step aside. The next call to db() reopens it.
    blocking(_currentVersion, blockedVersion) {
      const current = dbPromise;
      dbPromise = null;
      void current?.then((d) => d.close());
      // A newer version of the app is upgrading it: pages reload into that version, the service
      // worker just lets go. (A null version means the database is being deleted, not upgraded.)
      if (blockedVersion === null) return;
      const page = globalThis as unknown as { document?: unknown; location?: { reload?: () => void } };
      if (page.document) page.location?.reload?.();
    },
    terminated() {
      dbPromise = null;
    },
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('habits', { keyPath: 'id' });
        const checkins = database.createObjectStore('checkins', { keyPath: 'id' });
        checkins.createIndex('byHabit', 'habitId');
        checkins.createIndex('byDate', 'date');
        database.createObjectStore('kv');
      }
      if (oldVersion < 2) database.createObjectStore('outbox', { keyPath: 'key' });
    },
  });
  return dbPromise;
}

/** For tests. */
export async function closeDB(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

/** For tests: simulate a second device by switching to another database. */
export async function useDatabase(name: string): Promise<void> {
  await closeDB();
  dbName = name;
}

export function withDefaults(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    weeklyReport: { ...DEFAULT_SETTINGS.weeklyReport, ...s?.weeklyReport },
    push: { ...DEFAULT_SETTINGS.push, ...s?.push },
  };
}

// ---------- sync helpers ----------

/** Sample data never leaves the device. */
export const isDemoHabitId = (id: string) => id.startsWith('demo-');

/** Records saved before sync existed have no timestamp: treat them as old. */
export const habitStamp = (h: Habit) => h.updatedAt ?? 1;
export const checkinStamp = (c: Checkin) => c.updatedAt ?? (Date.parse(c.answeredAt) || 1);

const SYNC_STORES = ['habits', 'checkins', 'kv', 'outbox'] as const;
type SyncTx = Tx<['habits', 'checkins', 'kv', 'outbox']>;

async function syncing(tx: SyncTx): Promise<boolean> {
  return (await tx.objectStore('kv').get('account')) != null;
}

/**
 * Timestamps only move forward: an edit is always newer than the version it was made on, even if
 * this device's clock is behind the one that wrote that version (so last-writer-wins can't drop it).
 */
const stampAfter = (previous: number | undefined, now: number) => Math.max(now, (previous ?? 0) + 1);

function enqueue(tx: SyncTx, kind: RecordKind, id: string, updatedAt: number, deleted: boolean) {
  return tx.objectStore('outbox').put({ key: `${kind}:${id}`, kind, id, updatedAt, deleted });
}

async function writeTx(fn: (tx: SyncTx, sync: boolean) => Promise<unknown>): Promise<void> {
  const tx = (await db()).transaction([...SYNC_STORES], 'readwrite');
  const sync = await syncing(tx);
  await fn(tx, sync);
  await tx.done;
}

// ---------- reads ----------

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

// ---------- local writes (stamped, and queued for sync when signed in) ----------

export async function putHabit(habit: Habit): Promise<void> {
  await putHabits([habit]);
}

export async function putHabits(habits: Habit[]): Promise<void> {
  const now = Date.now();
  await writeTx(async (tx, sync) => {
    const store = tx.objectStore('habits');
    for (const h of habits) {
      const stamp = stampAfter((await store.get(h.id))?.updatedAt, now);
      await store.put({ ...h, updatedAt: stamp });
      if (sync && !isDemoHabitId(h.id)) await enqueue(tx, 'h', h.id, stamp, false);
    }
  });
}

/** Deletes a habit and its whole history (on every device, when signed in). */
export async function deleteHabit(id: string): Promise<void> {
  const now = Date.now();
  await writeTx(async (tx, sync) => {
    const habit = await tx.objectStore('habits').get(id);
    const checkins = await tx.objectStore('checkins').index('byHabit').getAll(id);
    const queue = sync && !isDemoHabitId(id);
    await Promise.all([
      tx.objectStore('habits').delete(id),
      ...(queue ? [enqueue(tx, 'h', id, stampAfter(habit?.updatedAt, now), true)] : []),
      ...checkins.flatMap((c) => [
        tx.objectStore('checkins').delete(c.id),
        ...(queue ? [enqueue(tx, 'c', c.id, stampAfter(c.updatedAt, now), true)] : []),
      ]),
    ]);
  });
}

export async function putCheckin(checkin: Checkin): Promise<void> {
  const now = Date.now();
  await writeTx(async (tx, sync) => {
    const store = tx.objectStore('checkins');
    const stamp = stampAfter((await store.get(checkin.id))?.updatedAt, now);
    await store.put({ ...checkin, updatedAt: stamp });
    if (sync && !isDemoHabitId(checkin.habitId)) await enqueue(tx, 'c', checkin.id, stamp, false);
  });
}

export async function deleteCheckin(id: string): Promise<void> {
  const now = Date.now();
  await writeTx(async (tx, sync) => {
    const store = tx.objectStore('checkins');
    const existing = await store.get(id);
    await store.delete(id);
    if (sync && !isDemoHabitId(id)) await enqueue(tx, 'c', id, stampAfter(existing?.updatedAt, now), true);
  });
}

export async function saveSettings(settings: Settings): Promise<void> {
  await (await db()).put('kv', settings, 'settings');
}

export async function loadSettings(): Promise<Settings> {
  return withDefaults((await (await db()).get('kv', 'settings')) as Partial<Settings> | undefined);
}

/**
 * Replaces habits and check-ins (restore a backup / load the demo). Settings are kept unless given.
 * When signed in, records that disappear are deleted on the other devices too.
 */
export async function replaceAll(data: { habits: Habit[]; checkins: Checkin[]; settings?: Settings }): Promise<void> {
  const now = Date.now();
  await writeTx(async (tx, sync) => {
    const habits = tx.objectStore('habits');
    const checkins = tx.objectStore('checkins');
    const [oldHabits, oldCheckins] = await Promise.all([habits.getAll(), checkins.getAll()]);
    const oldH = new Map(oldHabits.map((h) => [h.id, h.updatedAt]));
    const oldC = new Map(oldCheckins.map((c) => [c.id, c.updatedAt]));
    await Promise.all([habits.clear(), checkins.clear()]);
    const keepH = new Set(data.habits.map((h) => h.id));
    const keepC = new Set(data.checkins.map((c) => c.id));
    const ops: Promise<unknown>[] = [...(data.settings ? [tx.objectStore('kv').put(data.settings, 'settings')] : [])];
    for (const h of data.habits) {
      const stamp = stampAfter(oldH.get(h.id), now);
      ops.push(habits.put({ ...h, updatedAt: stamp }));
      if (sync && !isDemoHabitId(h.id)) ops.push(enqueue(tx, 'h', h.id, stamp, false));
    }
    for (const c of data.checkins) {
      const stamp = stampAfter(oldC.get(c.id), now);
      ops.push(checkins.put({ ...c, updatedAt: stamp }));
      if (sync && !isDemoHabitId(c.habitId)) ops.push(enqueue(tx, 'c', c.id, stamp, false));
    }
    if (sync) {
      for (const [id, at] of oldH) if (!keepH.has(id) && !isDemoHabitId(id)) ops.push(enqueue(tx, 'h', id, stampAfter(at, now), true));
      for (const [id, at] of oldC) if (!keepC.has(id) && !isDemoHabitId(id)) ops.push(enqueue(tx, 'c', id, stampAfter(at, now), true));
    }
    await Promise.all(ops);
  });
}

/** Deletes every habit and check-in (everywhere, when signed in) but keeps settings and the account. */
export async function eraseData(): Promise<void> {
  await replaceAll({ habits: [], checkins: [] });
}

/** Wipes the whole database on this device: data, settings, account and sync state. */
export async function clearAll(): Promise<void> {
  const tx = (await db()).transaction([...SYNC_STORES], 'readwrite');
  await Promise.all([...SYNC_STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
}

// ---------- used by the sync engine ----------

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

export async function deleteKV(...keys: string[]): Promise<void> {
  const tx = (await db()).transaction('kv', 'readwrite');
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}

export async function listOutbox(limit = 200): Promise<OutboxEntry[]> {
  return (await db()).getAll('outbox', undefined, limit);
}

export async function outboxSize(): Promise<number> {
  return (await db()).count('outbox');
}

/** Removes uploaded entries, unless the record changed again in the meantime. */
export async function removeFromOutbox(sent: OutboxEntry[]): Promise<void> {
  const tx = (await db()).transaction('outbox', 'readwrite');
  await Promise.all([
    ...sent.map(async (e) => {
      const current = await tx.store.get(e.key);
      if (current && current.updatedAt === e.updatedAt && current.deleted === e.deleted) await tx.store.delete(e.key);
    }),
    tx.done,
  ]);
}

export async function clearOutbox(): Promise<void> {
  await (await db()).clear('outbox');
}

export async function getRecord(kind: RecordKind, id: string): Promise<Habit | Checkin | undefined> {
  const d = await db();
  return kind === 'h' ? d.get('habits', id) : d.get('checkins', id);
}

/** Queues every habit and check-in on this device for upload (first sign-in on a device). */
export async function queueEverything(): Promise<number> {
  let n = 0;
  await writeTx(async (tx) => {
    const [habits, checkins] = await Promise.all([tx.objectStore('habits').getAll(), tx.objectStore('checkins').getAll()]);
    const ops: Promise<unknown>[] = [];
    for (const h of habits) if (!isDemoHabitId(h.id)) ops.push(enqueue(tx, 'h', h.id, habitStamp(h), false));
    for (const c of checkins) if (!isDemoHabitId(c.habitId)) ops.push(enqueue(tx, 'c', c.id, checkinStamp(c), false));
    n = ops.length;
    await Promise.all(ops);
  });
  return n;
}

export interface RemoteChange {
  kind: RecordKind;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data?: Habit | Checkin;
}

/**
 * Applies changes from other devices. Last writer wins: a change is skipped when this device
 * holds a newer version, either saved or still waiting in the outbox.
 */
export async function applyRemote(changes: RemoteChange[]): Promise<number> {
  let applied = 0;
  await writeTx(async (tx) => {
    const outbox = tx.objectStore('outbox');
    for (const ch of changes) {
      const pending = await outbox.get(`${ch.kind}:${ch.id}`);
      if (pending && pending.updatedAt >= ch.updatedAt) continue;
      if (ch.kind === 'h') {
        const store = tx.objectStore('habits');
        const local = await store.get(ch.id);
        if (local && habitStamp(local) >= ch.updatedAt) continue;
        if (ch.deleted || !ch.data) {
          if (!local) continue;
          await store.delete(ch.id);
          const keys = await tx.objectStore('checkins').index('byHabit').getAllKeys(ch.id);
          await Promise.all(keys.map((k) => tx.objectStore('checkins').delete(k)));
        } else {
          await store.put({ ...(ch.data as Habit), updatedAt: ch.updatedAt });
        }
      } else {
        const store = tx.objectStore('checkins');
        const local = await store.get(ch.id);
        if (local && checkinStamp(local) >= ch.updatedAt) continue;
        if (ch.deleted || !ch.data) {
          if (!local) continue;
          await store.delete(ch.id);
        } else {
          await store.put({ ...(ch.data as Checkin), updatedAt: ch.updatedAt });
        }
      }
      if (pending) await outbox.delete(pending.key); // the remote version is newer: drop our stale edit
      applied++;
    }
  });
  return applied;
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

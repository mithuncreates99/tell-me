/**
 * The sync engine. Runs in the page and in the service worker (a Yes tapped on a notification
 * syncs straight away), so it only uses fetch, WebCrypto and IndexedDB.
 *
 *   1. push: every outbox entry is encrypted (AES-GCM, opaque HMAC id) and uploaded
 *   2. pull: everything other devices uploaded since our last sequence number is decrypted and
 *      merged, newest edit wins (db.applyRemote)
 *   3. share: the snapshot of habits shared with friends is re-published if it changed
 */
import { deriveKeys, loadAccount, open, opaqueId, seal, type AccountKeys } from './account';
import { API_URL, ApiError, cloud, type ShareBody, type SyncRecord } from './api';
import * as db from './db';
import { toCheckinMap } from './schedule';
import { buildShare, shareFingerprint } from './share';
import type { Answer, Checkin, Habit } from './types';

export interface SyncState {
  lastSeq: number;
  lastSyncAt?: string;
  lastError?: string | null;
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  applied: number;
  error?: string;
  /** The server no longer knows this account (deleted from another device). */
  accountGone?: boolean;
}

/** Everything the server must not be able to change is inside the ciphertext, the timestamp included. */
interface Payload {
  kind: db.RecordKind;
  id: string;
  u: number;
  deleted?: true;
  data?: Habit | Checkin;
}

export const loadSyncState = async (): Promise<SyncState> => (await db.getKV<SyncState>('sync')) ?? { lastSeq: 0 };

// ---------- answers waiting to be announced ----------

interface AnswerNote {
  habitId: string;
  date: string;
  answer: Answer;
}
let notes: AnswerNote[] = [];

/** Remember a fresh answer: other devices skip its reminder, friends get a live "checked in". */
export function noteAnswer(habitId: string, date: string, answer: Answer): void {
  if (db.isDemoHabitId(habitId)) return;
  notes = [...notes.filter((n) => !(n.habitId === habitId && n.date === date)), { habitId, date, answer }].slice(-20);
}

// ---------- encode / decode ----------

async function encode(keys: AccountKeys, entry: db.OutboxEntry): Promise<SyncRecord> {
  const opaque = await opaqueId(keys, entry.kind, entry.id);
  const record = entry.deleted ? undefined : await db.getRecord(entry.kind, entry.id);
  const base = { kind: entry.kind, id: entry.id, u: entry.updatedAt };
  const payload: Payload = record ? { ...base, data: record } : { ...base, deleted: true };
  return { k: entry.kind, id: opaque, u: entry.updatedAt, d: record ? 0 : 1, x: await seal(keys, entry.kind, opaque, payload) };
}

async function decode(keys: AccountKeys, r: SyncRecord): Promise<db.RemoteChange | null> {
  try {
    const p = await open<Payload>(keys, r.k, r.id, r.x);
    // A record whose timestamp doesn't match its sealed one was tampered with (e.g. replayed).
    if (p.kind !== r.k || typeof p.id !== 'string' || p.u !== r.u) return null;
    return { kind: p.kind, id: p.id, updatedAt: p.u, deleted: p.deleted === true, data: p.data };
  } catch {
    console.warn('Skipping a record that could not be decrypted');
    return null;
  }
}

// ---------- the sync run ----------

let running: Promise<SyncResult> | null = null;
let rerun: Promise<SyncResult> | null = null;

/**
 * Runs a sync. Calls made while one is running share a single follow-up run (so a change made
 * mid-sync is never missed, and a burst of calls never turns into a burst of requests).
 */
export function syncNow(): Promise<SyncResult> {
  if (!running) {
    running = run().finally(() => {
      running = null;
    });
    return running;
  }
  rerun ??= running.then(() => {
    rerun = null;
    return syncNow();
  });
  return rerun;
}

const BATCH = 200;

async function run(): Promise<SyncResult> {
  const result: SyncResult = { ok: false, pushed: 0, pulled: 0, applied: 0 };
  if (!API_URL) return { ...result, error: 'No server configured.' };
  const account = await loadAccount();
  if (!account) return { ...result, error: 'Not signed in.' };
  const keys = await deriveKeys(account.key);
  const state = await loadSyncState();
  const pendingNotes = notes;
  notes = [];
  const answered = pendingNotes.map(({ habitId, date }) => ({ habitId, date }));

  try {
    // 1. push
    for (let round = 0; round < 100; round++) {
      const entries = await db.listOutbox(BATCH);
      if (entries.length === 0) break;
      const records = await Promise.all(entries.map((e) => encode(keys, e)));
      await cloud.push(keys.auth, { records, ...(round === 0 && answered.length ? { answered } : {}) });
      if (round === 0) answered.length = 0;
      await db.removeFromOutbox(entries);
      result.pushed += records.length;
      if (entries.length < BATCH) break;
    }
    if (answered.length) await cloud.push(keys.auth, { records: [], answered });

    // 2. pull
    let since = state.lastSeq;
    for (let round = 0; round < 200; round++) {
      const page = await cloud.pull(keys.auth, since);
      const changes = (await Promise.all(page.records.map((r) => decode(keys, r)))).filter((c): c is db.RemoteChange => c !== null);
      result.applied += await db.applyRemote(changes);
      result.pulled += page.records.length;
      since = page.seq;
      await db.setKV('sync', { ...state, lastSeq: since } satisfies SyncState);
      if (!page.more) break;
    }

    // 3. share with friends
    const event = [...pendingNotes].reverse()[0];
    await publishShare(keys.auth, event ? { habitId: event.habitId, answer: event.answer } : undefined);

    await db.setKV('sync', { lastSeq: since, lastSyncAt: new Date().toISOString(), lastError: null } satisfies SyncState);
    if (result.applied > 0) db.announceChange();
    return { ...result, ok: true };
  } catch (err) {
    notes = [...pendingNotes, ...notes].slice(-20); // announce them next time
    if (err instanceof ApiError && err.status === 401) return { ...result, error: err.message, accountGone: true };
    const message = err instanceof Error ? err.message : 'Sync failed';
    await db.setKV('sync', { ...(await loadSyncState()), lastError: message } satisfies SyncState);
    if (result.applied > 0) db.announceChange();
    return { ...result, error: message };
  }
}

interface ShareState {
  hash: string;
  at: string;
}

/** Re-publishes the shared-habits snapshot when it changed (or to announce a check-in). */
export async function publishShare(auth: string, event?: ShareBody['event'], now = new Date()): Promise<boolean> {
  const { habits, checkins, settings } = await db.loadAll();
  const body = buildShare(habits, toCheckinMap(checkins), settings, now, event);
  const hash = shareFingerprint(body);
  const last = await db.getKV<ShareState>('share');
  if (last?.hash === hash && !body.event) return false;
  await cloud.share(auth, body);
  await db.setKV('share', { hash, at: now.toISOString() } satisfies ShareState);
  return true;
}

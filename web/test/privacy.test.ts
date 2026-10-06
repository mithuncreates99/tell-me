/**
 * The app's side of privacy: what leaves the device for friends, what goes over the network at
 * all, what signing out leaves behind, and how the live connection carries credentials.
 * (The server's side runs against the real worker in api/scripts/privacy-test.mjs.)
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.VITE_API_URL = 'http://api.test';
});

import { deriveKeys, forgetAccount, formatKey, loadAccount, saveAccount, type AccountRecord } from '../src/lib/account';
import * as db from '../src/lib/db';
import { connectLive, type LiveEvent } from '../src/lib/live';
import { buildShare, MAX_SHARED, shareFingerprint } from '../src/lib/share';
import { noteAnswer, syncNow } from '../src/lib/sync';
import { checkin, habit, map, settings } from './helpers';

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const account: AccountRecord = {
  key: KEY,
  profile: { id: 'user-aaaaaaaaaaa', name: 'Mithun', emoji: '🦊', friendCode: 'K7P29XQM', timeZone: 'Europe/Paris', createdAt: 0 },
};
const NOW = new Date('2026-10-07T19:40:00+02:00'); // a Wednesday

// Things that must never leave the device in a readable form.
const PRIVATE = { name: 'Therapy', id: 'therapy-xk2', note: 'hangover after the party', other: 'Diary', otherId: 'diary-q9z' };

function myHabits() {
  return [
    habit({ id: 'gym', name: 'Gym', shared: true, days: [1, 3, 5], order: 0 }),
    habit({ id: PRIVATE.id, name: PRIVATE.name, emoji: '🛋️', days: [3], order: 1 }),
    habit({ id: PRIVATE.otherId, name: PRIVATE.other, emoji: '📓', days: [0, 1, 2, 3, 4, 5, 6], order: 2 }),
  ];
}
function myCheckins() {
  return [
    checkin('gym', '2026-10-05', 'yes'),
    { ...checkin('gym', '2026-10-07', 'no', 'sick'), note: PRIVATE.note },
    { ...checkin(PRIVATE.id, '2026-10-07', 'no', 'busy'), note: PRIVATE.note },
    { ...checkin(PRIVATE.otherId, '2026-10-07', 'yes'), note: 'felt awful' },
  ];
}

describe('what the app shares with friends', () => {
  it('only habits marked shared, never archived or sample ones', () => {
    const body = buildShare(
      [...myHabits(), habit({ id: 'old', name: 'Old', shared: true, archivedAt: '2026-09-01' }), habit({ id: 'demo-gym', name: 'Demo', shared: true })],
      map(myCheckins()),
      settings,
      NOW,
    );
    expect(body.habits.map((h) => h.id)).toEqual(['gym']);
  });

  it('each shared habit carries exactly what friends are shown', () => {
    const body = buildShare(myHabits(), map(myCheckins()), settings, NOW);
    expect(Object.keys(body).sort()).toEqual(['date', 'habits', 'timeZone', 'weekStart']);
    expect(Object.keys(body.habits[0]!).sort()).toEqual(['askMin', 'color', 'days', 'emoji', 'id', 'name', 'streak', 'time', 'week']);
  });

  it('reasons and notes never go into a snapshot, not even for a shared habit', () => {
    const text = JSON.stringify(buildShare(myHabits(), map(myCheckins()), settings, NOW, { habitId: 'gym', answer: 'no' }));
    for (const secret of [PRIVATE.note, 'felt awful', 'sick', 'busy', PRIVATE.name, PRIVATE.id, PRIVATE.other, PRIVATE.otherId]) {
      expect(text).not.toContain(secret);
    }
  });

  it("only this week's answers are in it (no history)", () => {
    const lastWeek = [checkin('gym', '2026-09-28', 'yes'), checkin('gym', '2026-09-30', 'no', 'tired')];
    const withHistory = buildShare(myHabits(), map([...myCheckins(), ...lastWeek]), settings, NOW);
    const without = buildShare(myHabits(), map(myCheckins()), settings, NOW);
    expect(withHistory.habits[0]!.week).toBe(without.habits[0]!.week);
    expect(withHistory.habits[0]!.week).toHaveLength(7);
  });

  it('an answer to a private habit is never announced', () => {
    expect(buildShare(myHabits(), map(myCheckins()), settings, NOW, { habitId: PRIVATE.id, answer: 'no' }).event).toBeUndefined();
    expect(buildShare(myHabits(), map(myCheckins()), settings, NOW, { habitId: 'gym', answer: 'yes' }).event).toEqual({ habitId: 'gym', answer: 'yes' });
  });

  it("answering a private habit changes nothing friends could notice (so nothing is sent)", () => {
    const before = buildShare(myHabits(), map(myCheckins()), settings, NOW);
    const after = buildShare(myHabits(), map([...myCheckins(), checkin(PRIVATE.otherId, '2026-10-06', 'no', 'forgot')]), settings, NOW);
    expect(shareFingerprint(after)).toBe(shareFingerprint(before));
  });

  it(`shares at most ${MAX_SHARED} habits, with names cut to 60 characters`, () => {
    const many = Array.from({ length: 25 }, (_, i) => habit({ id: `h${i}`, name: 'x'.repeat(80), shared: true, order: i }));
    const body = buildShare(many, map([]), settings, NOW);
    expect(body.habits).toHaveLength(MAX_SHARED);
    expect(body.habits.every((h) => h.name.length === 60)).toBe(true);
  });
});

/** Stands in for the server and keeps every request the app makes. */
class RecordingServer {
  requests: Array<{ method: string; url: string; headers: Record<string, string>; body: string }> = [];
  records = new Map<string, { k: string; id: string; s: number; u: number; d: number; x: string }>();
  seq = 0;
  /** Whether a device of the account has push reminders (the server tells the app on every pull). */
  reminders = false;

  fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? String(init.body) : '';
    this.requests.push({ method, url, headers, body });
    const path = new URL(url).pathname;
    if (path === '/api/sync' && method === 'POST') {
      for (const r of JSON.parse(body).records) this.records.set(`${r.k}:${r.id}`, { ...r, s: ++this.seq });
      return Response.json({ ok: true, seq: this.seq, applied: 1 });
    }
    if (path === '/api/sync') return Response.json({ records: [], seq: this.seq, more: false, reminders: this.reminders });
    if (path === '/api/share') return Response.json({ ok: true, changed: true });
    return Response.json({ error: 'not found' }, { status: 404 });
  };

  /** Everything readable that was sent: URLs, headers and bodies, with ciphertext blanked out. */
  readable(): string {
    return JSON.stringify(
      this.requests.map((r) => {
        const body = r.body ? JSON.parse(r.body) : null;
        if (body?.records) for (const rec of body.records) rec.x = '<ciphertext>';
        return { ...r, body };
      }),
    );
  }

  /** The ciphertexts, as raw bytes (to check no plaintext slipped into them). */
  ciphertextBytes(): string {
    return [...this.records.values()].map((r) => Buffer.from(r.x, 'base64url').toString('latin1')).join('');
  }
}

describe('what goes over the network', () => {
  let server: RecordingServer;
  let auth: string;

  beforeEach(async () => {
    server = new RecordingServer();
    auth = (await deriveKeys(KEY)).auth;
    vi.stubGlobal('fetch', vi.fn(server.fetch));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await db.useDatabase('privacy-phone');
    await saveAccount(account);
    await db.putHabits(myHabits());
    for (const c of myCheckins()) await db.putCheckin(c);
    noteAnswer(PRIVATE.id, '2026-10-07', 'no');
    noteAnswer('gym', '2026-10-07', 'no');
  });

  afterEach(async () => {
    await db.clearAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('private habits, notes and reasons never leave the device unencrypted', async () => {
    expect(await syncNow()).toMatchObject({ ok: true, pushed: 7 });
    const sent = server.readable();
    for (const secret of [PRIVATE.name, PRIVATE.id, PRIVATE.other, PRIVATE.otherId, PRIVATE.note, 'felt awful', '"sick"', '"busy"']) {
      expect(sent).not.toContain(secret);
    }
    const ciphertext = server.ciphertextBytes();
    for (const secret of [PRIVATE.name, PRIVATE.other, PRIVATE.note, 'felt awful']) expect(ciphertext).not.toContain(secret);
  });

  it('the shared habit is readable only in the snapshot for friends', async () => {
    await syncNow();
    const readable = server.requests.filter((r) => r.body.includes('"Gym"'));
    expect(readable.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(['PUT /api/share']);
  });

  it('the account key never leaves the device; the derived secret goes only in the Authorization header', async () => {
    await syncNow();
    const everything = JSON.stringify(server.requests);
    for (const form of [KEY, formatKey(KEY), KEY.toLowerCase()]) expect(everything).not.toContain(form);
    for (const r of server.requests) {
      expect(r.headers.Authorization).toBe(`Bearer ${auth}`);
      expect(r.url).not.toContain(auth);
      expect(r.body).not.toContain(auth);
    }
  });

  it('answered check-ins are only announced to accounts with push reminders, as habit + date, separately', async () => {
    await syncNow();
    expect(server.requests.some((r) => r.body.includes('answered'))).toBe(false);

    server.reminders = true; // now a device of this account has push reminders to cancel
    noteAnswer('gym', '2026-10-07', 'yes');
    await db.putCheckin(checkin('gym', '2026-10-07', 'yes'));
    await syncNow();
    const hints = server.requests.filter((r) => r.body.includes('answered'));
    expect(hints).toHaveLength(1);
    expect(JSON.parse(hints[0]!.body)).toEqual({ records: [], answered: [{ habitId: 'gym', date: '2026-10-07' }] });
  });

  it("isn't re-sent to friends when only private habits changed", async () => {
    await syncNow();
    const shares = () => server.requests.filter((r) => new URL(r.url).pathname === '/api/share').length;
    expect(shares()).toBe(1);
    await db.putCheckin({ ...checkin(PRIVATE.otherId, '2026-10-06', 'no', 'forgot'), note: 'nope' });
    noteAnswer(PRIVATE.otherId, '2026-10-06', 'no');
    await syncNow();
    expect(shares()).toBe(1);
  });
});

describe('signing out', () => {
  afterEach(async () => {
    await db.clearAll();
  });

  it('forgets the key, the sync position and what was shared', async () => {
    await db.useDatabase('privacy-signout');
    await saveAccount(account);
    await db.setKV('sync', { lastSeq: 12 });
    await db.setKV('share', { hash: 'abc', at: '2026-10-07' });
    await forgetAccount();
    expect(await loadAccount()).toBeFalsy();
    expect(await db.getKV('sync')).toBeUndefined();
    expect(await db.getKV('share')).toBeUndefined();
  });

  it("leaves nothing waiting to upload, and wiping this device's copy doesn't delete the account's data", async () => {
    await db.useDatabase('privacy-signout');
    await saveAccount(account);
    await db.putHabits([habit()]);
    expect(await db.outboxSize()).toBeGreaterThan(0);
    await forgetAccount();
    await db.clearOutbox();
    await db.replaceAll({ habits: [], checkins: [] });
    expect(await db.outboxSize()).toBe(0); // no deletions queued for the server
    expect((await db.loadAll()).habits).toEqual([]);
  });
});

/** A WebSocket stand-in that records how it was opened and lets the test close it. */
class FakeSocket {
  static opened: FakeSocket[] = [];
  readyState = 0;
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    FakeSocket.opened.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send() {}
  close() {}
  emit(type: string, e: unknown = {}) {
    for (const fn of this.listeners[type] ?? []) fn(e);
  }
}

describe('the live connection', () => {
  beforeEach(() => {
    FakeSocket.opened = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('sends the credentials as a subprotocol, never in the URL', () => {
    const stop = connectLive('the-auth-secret', () => {}, () => {}, FakeSocket as unknown as typeof WebSocket);
    const [ws] = FakeSocket.opened;
    expect(ws!.url).toBe('ws://api.test/api/live');
    expect(ws!.protocols).toEqual(['tell-me.v1', 'auth.the-auth-secret']);
    stop();
  });

  it('stops for good when the server says the account was deleted', () => {
    const events: LiveEvent[] = [];
    connectLive('secret', (e) => events.push(e), () => {}, FakeSocket as unknown as typeof WebSocket);
    FakeSocket.opened[0]!.emit('close', { code: 4001 });
    vi.advanceTimersByTime(120_000);
    expect(events).toEqual([{ t: 'gone' }]);
    expect(FakeSocket.opened).toHaveLength(1);
  });

  it('stops at once when the server says the account is gone, before the connection even closes', () => {
    const events: LiveEvent[] = [];
    const statuses: string[] = [];
    connectLive('secret', (e) => events.push(e), (s) => statuses.push(s), FakeSocket as unknown as typeof WebSocket);
    const ws = FakeSocket.opened[0]!;
    ws.emit('message', { data: JSON.stringify({ t: 'gone' }) });
    expect(events).toEqual([{ t: 'gone' }]);
    expect(statuses.at(-1)).toBe('closed');
    ws.emit('close', { code: 4001 }); // the close arriving later changes nothing
    vi.advanceTimersByTime(120_000);
    expect(events).toEqual([{ t: 'gone' }]);
    expect(FakeSocket.opened).toHaveLength(1);
  });

  it('reconnects after an ordinary drop', () => {
    const stop = connectLive('secret', () => {}, () => {}, FakeSocket as unknown as typeof WebSocket);
    FakeSocket.opened[0]!.emit('close', { code: 1006 });
    vi.advanceTimersByTime(2_000);
    expect(FakeSocket.opened).toHaveLength(2);
    stop();
  });
});

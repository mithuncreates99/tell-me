import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.VITE_API_URL = 'http://api.test';
});

import { deriveKeys, saveAccount, type AccountRecord } from '../src/lib/account';
import * as db from '../src/lib/db';
import { noteAnswer, syncNow } from '../src/lib/sync';
import { checkin, habit } from './helpers';

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const account: AccountRecord = {
  key: KEY,
  profile: { id: 'user-aaaaaaaaaaa', name: 'Mithun', emoji: '🦊', friendCode: 'K7P29XQM', timeZone: 'Europe/Paris', createdAt: 0 },
};

/** In-memory stand-in for the server's /api/sync and /api/share (same rules: seq + last writer wins). */
class FakeServer {
  records = new Map<string, { k: string; id: string; s: number; u: number; d: number; x: string }>();
  seq = 0;
  shares: Array<Record<string, unknown>> = [];
  answered: Array<{ habitId: string; date: string }> = [];
  auth = '';

  fetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const headers = init.headers as Record<string, string>;
    if (headers.Authorization !== `Bearer ${this.auth}`) return Response.json({ error: 'nope' }, { status: 401 });
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (u.pathname === '/api/sync' && init.method === 'POST') {
      let applied = 0;
      for (const r of body.records) {
        const key = `${r.k}:${r.id}`;
        const old = this.records.get(key);
        if (old && old.u >= r.u) continue;
        this.records.set(key, { ...r, s: ++this.seq });
        applied++;
      }
      this.answered.push(...(body.answered ?? []));
      return Response.json({ ok: true, seq: this.seq, applied });
    }
    if (u.pathname === '/api/sync') {
      const since = Number(u.searchParams.get('since'));
      const records = [...this.records.values()].filter((r) => r.s > since).sort((a, b) => a.s - b.s);
      // A device of this account has push reminders, so the app says which check-ins were answered.
      return Response.json({ records, seq: records.length ? records[records.length - 1]!.s : since, more: false, reminders: true });
    }
    if (u.pathname === '/api/share') {
      this.shares.push(body);
      return Response.json({ ok: true, changed: true });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  };
}

let server: FakeServer;

async function device(name: string, signedIn = true) {
  await db.useDatabase(name);
  if (signedIn) await saveAccount(account);
}

beforeEach(async () => {
  server = new FakeServer();
  server.auth = (await deriveKeys(KEY)).auth;
  vi.stubGlobal('fetch', vi.fn(server.fetch));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T19:40:00+02:00'));
});

afterEach(async () => {
  for (const name of ['phone', 'laptop']) {
    await db.useDatabase(name);
    await db.clearAll();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sync engine', () => {
  it('only queues changes when signed in, and never sample data', async () => {
    await device('phone', false);
    await db.putHabits([habit()]);
    expect(await db.outboxSize()).toBe(0);
    await saveAccount(account);
    await db.putHabits([habit({ id: 'demo-gym' })]);
    await db.putCheckin(checkin('demo-gym', '2026-10-05', 'yes'));
    expect(await db.outboxSize()).toBe(0);
    await db.putCheckin(checkin('gym', '2026-10-05', 'yes'));
    expect(await db.outboxSize()).toBe(1);
  });

  it('uploads encrypted records and a second device downloads the same data', async () => {
    await device('phone');
    await db.putHabits([habit({ shared: true })]);
    await db.putCheckin(checkin('gym', '2026-10-05', 'yes'));
    const result = await syncNow();
    expect(result).toMatchObject({ ok: true, pushed: 2 });
    expect(await db.outboxSize()).toBe(0);
    // Names, ids and dates are all hidden: the payload bytes are ciphertext and the ids are HMACs.
    const stored = [...server.records.values()];
    const bytes = stored.map((r) => Buffer.from(r.x, 'base64url').toString('latin1')).join('');
    expect(bytes).not.toContain('Gym');
    expect(bytes).not.toContain('2026-10-05');
    expect(stored.map((r) => r.id)).not.toContain('gym');
    expect(stored.map((r) => r.id)).not.toContain('gym:2026-10-05');

    await device('laptop');
    expect(await syncNow()).toMatchObject({ ok: true, applied: 2 });
    const data = await db.loadAll();
    expect(data.habits.map((h) => [h.id, h.name, h.shared])).toEqual([['gym', 'Gym', true]]);
    expect(data.checkins.map((c) => [c.id, c.answer])).toEqual([['gym:2026-10-05', 'yes']]);
  });

  it('resolves conflicting edits: the newest one wins on every device', async () => {
    await device('phone');
    await db.putHabits([habit()]);
    await syncNow();
    await device('laptop');
    await syncNow();

    vi.setSystemTime(new Date('2026-10-05T20:00:00+02:00'));
    await device('phone');
    await db.putHabit({ ...habit(), name: 'Gym (phone)' });
    vi.setSystemTime(new Date('2026-10-05T20:05:00+02:00'));
    await device('laptop');
    await db.putHabit({ ...habit(), name: 'Gym (laptop)' });

    await device('phone');
    await syncNow(); // phone uploads its older edit
    await device('laptop');
    await syncNow(); // laptop uploads the newer one, and ignores the phone's older version
    await device('phone');
    await syncNow();

    for (const name of ['phone', 'laptop']) {
      await device(name);
      expect((await db.loadAll()).habits[0]!.name).toBe('Gym (laptop)');
    }
  });

  it("doesn't lose an edit made on a device whose clock is behind", async () => {
    vi.setSystemTime(new Date('2026-10-05T12:00:00+02:00'));
    await device('phone');
    await db.putHabits([habit({ name: 'Gym' })]);
    await syncNow();
    await device('laptop');
    await syncNow();
    vi.setSystemTime(new Date('2026-10-05T11:58:00+02:00')); // the laptop's clock is 2 minutes slow
    await db.putHabit({ ...habit(), name: 'Gym (laptop)' });
    await syncNow();
    await device('phone');
    await syncNow();
    expect((await db.loadAll()).habits[0]!.name).toBe('Gym (laptop)');
  });

  it('ignores records whose timestamp was changed on the server', async () => {
    await device('phone');
    await db.putHabits([habit({ name: 'Gym' })]);
    await syncNow();
    const [key, original] = [...server.records.entries()].find(([k]) => k.startsWith('h:'))!;
    await device('laptop');
    await syncNow();
    vi.setSystemTime(new Date('2026-10-05T21:00:00+02:00'));
    await db.putHabit({ ...habit(), name: 'Renamed' });
    await syncNow();
    // A malicious server replays the old ciphertext under a newer timestamp to roll the edit back.
    server.records.set(key, { ...original, u: Date.now() + 60_000, s: ++server.seq });
    await syncNow();
    expect((await db.loadAll()).habits[0]!.name).toBe('Renamed');
  });

  it('keeps an unsynced local edit that is newer than what arrives', async () => {
    await device('phone');
    await db.putHabits([habit()]);
    await syncNow();
    await device('laptop');
    await syncNow();
    vi.setSystemTime(new Date('2026-10-05T20:00:00+02:00'));
    await db.putHabit({ ...habit(), name: 'Old edit' });
    await syncNow();
    vi.setSystemTime(new Date('2026-10-05T20:10:00+02:00'));
    await device('phone');
    await db.putHabit({ ...habit(), name: 'New edit' }); // not uploaded yet
    const pulled = await db.applyRemote([]); // nothing yet
    expect(pulled).toBe(0);
    await syncNow(); // pushes first, then pulls the laptop's older edit and ignores it
    expect((await db.loadAll()).habits[0]!.name).toBe('New edit');
  });

  it('deleting a habit removes it and its history everywhere', async () => {
    await device('phone');
    await db.putHabits([habit(), habit({ id: 'read', name: 'Read' })]);
    await db.putCheckin(checkin('gym', '2026-10-05', 'yes'));
    await syncNow();
    await device('laptop');
    await syncNow();
    vi.setSystemTime(new Date('2026-10-05T21:00:00+02:00'));
    await db.deleteHabit('gym');
    await syncNow();
    await device('phone');
    await syncNow();
    const data = await db.loadAll();
    expect(data.habits.map((h) => h.id)).toEqual(['read']);
    expect(data.checkins).toHaveLength(0);
  });

  it('shares only shared habits, with a live event, and skips unchanged snapshots', async () => {
    await device('phone');
    await db.putHabits([habit({ shared: true, days: [0, 1, 2, 3, 4, 5, 6] }), habit({ id: 'diary', name: 'Diary', order: 1 })]);
    await db.putCheckin(checkin('gym', '2026-10-05', 'yes'));
    noteAnswer('gym', '2026-10-05', 'yes');
    await syncNow();
    expect(server.shares).toHaveLength(1);
    const share = server.shares[0] as { habits: Array<{ id: string; week: string }>; event: unknown; weekStart: string };
    expect(share.habits.map((h) => h.id)).toEqual(['gym']); // the private habit isn't shared
    expect(share.habits[0]!.week).toBe('YFFFFFF');
    expect(share.weekStart).toBe('2026-10-05');
    expect(share.event).toEqual({ habitId: 'gym', answer: 'yes' });
    expect(server.answered).toEqual([{ habitId: 'gym', date: '2026-10-05' }]);
    await syncNow();
    expect(server.shares).toHaveLength(1);
  });

  it('folds a burst of sync calls into at most one extra run', async () => {
    await device('phone');
    await db.putHabits([habit()]);
    const calls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls;
    const before = calls.length;
    const results = await Promise.all([syncNow(), syncNow(), syncNow(), syncNow()]);
    expect(results.every((r) => r.ok)).toBe(true);
    // run 1: push + pull + share; run 2: pull only (nothing left to push or share)
    expect(calls.length - before).toBe(4);
  });

  it('reports a deleted account', async () => {
    await device('phone');
    server.auth = 'something-else';
    await db.putHabits([habit()]);
    expect(await syncNow()).toMatchObject({ ok: false, accountGone: true });
    expect(await db.outboxSize()).toBe(1); // nothing lost
  });
});

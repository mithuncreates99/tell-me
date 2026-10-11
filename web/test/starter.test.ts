import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.VITE_API_URL = 'http://api.test';
});

import { deriveKeys, saveAccount, type AccountRecord } from '../src/lib/account';
import * as db from '../src/lib/db';
import { STARTER_IDS, STARTER_STAMP, STARTER_VERSION, starterDue, starterHabitsToAdd } from '../src/lib/starter';
import { syncNow } from '../src/lib/sync';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import { useStore } from '../src/store/useStore';
import { habit } from './helpers';

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const account: AccountRecord = {
  key: KEY,
  profile: { id: 'user-aaaaaaaaaaa', name: 'Mithun', emoji: '🦊', friendCode: 'K7P29XQM', timeZone: 'Europe/Paris', createdAt: 0 },
};

/** In-memory /api/sync with the server's rules (last writer wins), plus /api/sync/has. */
class FakeServer {
  records = new Map<string, { k: string; id: string; s: number; u: number; d: number; x: string }>();
  seq = 0;
  auth = '';
  offline = false;

  fetch = async (url: string, init: RequestInit = {}) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const headers = init.headers as Record<string, string>;
    if (headers.Authorization !== `Bearer ${this.auth}`) return Response.json({ error: 'nope' }, { status: 401 });
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (u.pathname === '/api/sync/has') {
      return Response.json({ found: body.ids.filter((id: string) => this.records.has(`h:${id}`)) });
    }
    if (u.pathname === '/api/sync' && init.method === 'POST') {
      for (const r of body.records) {
        const old = this.records.get(`${r.k}:${r.id}`);
        if (old && old.u >= r.u) continue;
        this.records.set(`${r.k}:${r.id}`, { ...r, s: ++this.seq });
      }
      return Response.json({ ok: true, seq: this.seq, applied: 0 });
    }
    if (u.pathname === '/api/sync') {
      const since = Number(u.searchParams.get('since'));
      const records = [...this.records.values()].filter((r) => r.s > since).sort((a, b) => a.s - b.s);
      return Response.json({ records, seq: records.length ? records[records.length - 1]!.s : since, more: false });
    }
    if (u.pathname === '/api/share') return Response.json({ ok: true });
    return Response.json({ error: 'not found' }, { status: 404 });
  };
}

let server: FakeServer;

/** Switches to a device's own database and starts the app there. */
async function openApp(name: string, opts: { signedIn?: boolean; habits?: ReturnType<typeof habit>[] } = {}) {
  await db.useDatabase(name);
  if (opts.signedIn) await saveAccount(account);
  if (opts.habits) await db.putHabits(opts.habits);
  useStore.setState({ ready: false, habits: [], checkins: new Map(), settings: DEFAULT_SETTINGS, toast: null });
  await useStore.getState().init();
  await useStore.getState().ensureStarterHabits();
  return useStore.getState();
}

const ids = () => useStore.getState().habits.map((h) => h.id);

beforeEach(async () => {
  server = new FakeServer();
  server.auth = (await deriveKeys(KEY)).auth;
  vi.stubGlobal('fetch', vi.fn(server.fetch));
});

afterEach(async () => {
  for (const name of ['phone', 'laptop']) {
    await db.useDatabase(name);
    await db.clearAll();
  }
  vi.unstubAllGlobals();
});

describe('starter habits: the rules', () => {
  it('are three water check-ins that add up to 4 litres, asked with a stronger reminder', () => {
    const added = starterHabitsToAdd([habit({ order: 4 })], '2026-10-11');
    expect(added.map((h) => [h.id, h.name, h.time])).toEqual([
      ['water-morning', 'Drink 1 L of water (morning)', '09:00'],
      ['water-noon', 'Drink 1.5 L of water (noon)', '13:00'],
      ['water-evening', 'Drink 1.5 L of water (evening)', '18:00'],
    ]);
    for (const h of added) {
      expect(h).toMatchObject({ emoji: '💧', days: [0, 1, 2, 3, 4, 5, 6], askAfterMin: 0, remind: true, strongReminder: true, archivedAt: null });
      expect(h).not.toHaveProperty('shared');
    }
    expect(added.map((h) => h.order)).toEqual([5, 6, 7]);
  });

  it('only fill in the ones that are missing', () => {
    expect(starterHabitsToAdd([habit(), habit({ id: 'water-noon' })], '2026-10-11').map((h) => h.id)).toEqual(['water-morning', 'water-evening']);
  });

  it('wait for a first habit, skip sample data, and are offered once', () => {
    expect(starterDue([], {})).toBe(false);
    expect(starterDue([habit({ id: 'demo-gym' })], {})).toBe(false);
    expect(starterDue([habit()], { starter: STARTER_VERSION })).toBe(false);
    expect(starterDue([habit()], {})).toBe(true);
  });
});

describe('starter habits on a device', () => {
  it('are added for an existing user, once, with the shared timestamp', async () => {
    const app = await openApp('phone', { habits: [habit()] });
    expect(ids()).toEqual(['gym', ...STARTER_IDS]);
    expect(app.settings.starter).toBe(STARTER_VERSION);
    expect(app.toast?.message).toContain('4 L a day');
    const stored = await db.loadAll();
    expect(stored.habits.filter((h) => h.id.startsWith('water-')).map((h) => h.updatedAt)).toEqual([STARTER_STAMP, STARTER_STAMP, STARTER_STAMP]);
  });

  it('are not added back after being deleted', async () => {
    await openApp('phone', { habits: [habit()] });
    await useStore.getState().deleteHabit('water-noon');
    await useStore.getState().ensureStarterHabits();
    expect(ids()).toEqual(['gym', 'water-morning', 'water-evening']);
    await openApp('phone'); // the next app start
    expect(ids()).toEqual(['gym', 'water-morning', 'water-evening']);
  });

  it('wait for a new user to add a first habit', async () => {
    await openApp('phone');
    expect(ids()).toEqual([]); // the welcome screen stays first
    await useStore.getState().addHabits([{ name: 'Gym', emoji: '🏋️', days: [1, 3, 5], time: '18:00' }]);
    await useStore.getState().ensureStarterHabits();
    expect(ids().slice(1)).toEqual([...STARTER_IDS]);
  });

  it('stay out of the sample data', async () => {
    await openApp('phone');
    await useStore.getState().loadDemo();
    await useStore.getState().ensureStarterHabits();
    expect(ids().every((id) => id.startsWith('demo-'))).toBe(true);
  });
});

describe('starter habits across devices', () => {
  it('reach the other devices once, and a deletion is never undone by another device', async () => {
    // Phone: adds them, and the account gets them on the next sync.
    await openApp('phone', { signedIn: true, habits: [habit()] });
    expect(ids()).toEqual(['gym', ...STARTER_IDS]);
    await syncNow();
    // The user deletes one on the phone.
    await useStore.getState().deleteHabit('water-noon');
    await syncNow();

    // Laptop: signed in to the same account, starting the new version for the first time.
    await openApp('laptop', { signedIn: true, habits: [habit({ id: 'read' })] });
    expect(ids()).toEqual(['read']); // the account already has them: nothing added here
    expect(useStore.getState().settings.starter).toBe(STARTER_VERSION);
    await syncNow();
    expect((await db.loadAll()).habits.map((h) => h.id).sort()).toEqual(['gym', 'read', 'water-evening', 'water-morning']);
  });

  it('a device that already pulled a deletion on the old version does not bring it back', async () => {
    await openApp('phone', { signedIn: true, habits: [habit()] });
    await syncNow();
    await useStore.getState().deleteHabit('water-evening');
    await syncNow();
    // The laptop syncs on the old version first, so it has already seen the deletion...
    await db.useDatabase('laptop');
    await saveAccount(account);
    await syncNow();
    // ...then reloads into the new version, which offers the starter habits.
    await openApp('laptop');
    expect(ids().sort()).toEqual(['gym', 'water-morning', 'water-noon']);
  });

  it('two devices adding them at once still end up with one set', async () => {
    await openApp('phone', { signedIn: true, habits: [habit()] });
    await openApp('laptop', { signedIn: true, habits: [habit({ id: 'read' })] }); // before the phone synced
    expect(ids()).toEqual(['read', ...STARTER_IDS]);
    await syncNow();
    await db.useDatabase('phone');
    await syncNow();
    expect((await db.loadAll()).habits.map((h) => h.id).sort()).toEqual(['gym', 'read', ...[...STARTER_IDS].sort()]);
  });

  it('a signed-out device that added them follows the account once it signs in', async () => {
    await openApp('phone', { signedIn: true, habits: [habit()] });
    await syncNow();
    await useStore.getState().deleteHabit('water-morning');
    await syncNow();
    // The laptop added them while signed out, then signs in.
    await openApp('laptop', { habits: [habit({ id: 'read' })] });
    expect(ids()).toEqual(['read', ...STARTER_IDS]);
    await saveAccount(account);
    await db.queueEverything();
    await syncNow();
    expect((await db.loadAll()).habits.map((h) => h.id).sort()).toEqual(['gym', 'read', 'water-evening', 'water-noon']);
  });

  it('waits when the server cannot be asked', async () => {
    server.offline = true;
    await openApp('phone', { signedIn: true, habits: [habit()] });
    expect(ids()).toEqual(['gym']);
    expect(useStore.getState().settings.starter).toBeUndefined();
    server.offline = false;
    await useStore.getState().ensureStarterHabits();
    expect(ids()).toEqual(['gym', ...STARTER_IDS]);
  });
});

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../src/lib/db';
import { checkin, habit } from './helpers';

afterEach(async () => {
  await db.clearAll();
});

describe('IndexedDB storage', () => {
  it('round-trips habits, check-ins and settings with defaults', async () => {
    await db.putHabits([habit(), habit({ id: 'read', order: 1 })]);
    await db.putCheckin(checkin('gym', '2026-10-05', 'yes'));
    await db.saveSettings({ ...(await db.loadSettings()), name: 'Mithun' });
    const data = await db.loadAll();
    expect(data.habits.map((h) => h.id)).toEqual(['gym', 'read']);
    expect(data.checkins).toHaveLength(1);
    expect(data.settings).toMatchObject({ name: 'Mithun', weekStartsOn: 1, weeklyReport: { enabled: true } });
  });

  it('deleting a habit deletes its history', async () => {
    await db.putHabits([habit(), habit({ id: 'read' })]);
    await db.putCheckin(checkin('gym', '2026-10-05', 'yes'));
    await db.putCheckin(checkin('read', '2026-10-05', 'no'));
    await db.deleteHabit('gym');
    const data = await db.loadAll();
    expect(data.habits.map((h) => h.id)).toEqual(['read']);
    expect(data.checkins.map((c) => c.habitId)).toEqual(['read']);
  });

  it('replaceAll swaps the dataset atomically', async () => {
    await db.putHabits([habit({ id: 'old' })]);
    await db.replaceAll({ habits: [habit()], checkins: [checkin('gym', '2026-10-02', 'yes')] });
    const data = await db.loadAll();
    expect(data.habits.map((h) => h.id)).toEqual(['gym']);
    expect(data.checkins).toHaveLength(1);
  });

  it('reports an upgrade that has to wait for an older open tab, then continues', async () => {
    await db.useDatabase('blocked-test');
    const old = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('blocked-test', 1);
      req.onsuccess = () => resolve(req.result);
    });
    let blocked = false;
    db.onUpgradeBlocked(() => (blocked = true));
    const opening = db.db();
    await new Promise((r) => setTimeout(r, 50));
    expect(blocked).toBe(true);
    old.close(); // the old tab goes away
    expect((await opening).version).toBe(2);
    db.onUpgradeBlocked(null);
    await db.useDatabase('tell-me');
  });

  describe('when another tab needs the database', () => {
    const reload = vi.fn();
    beforeEach(() => {
      reload.mockReset();
      vi.stubGlobal('document', {});
      vi.stubGlobal('location', { reload });
    });
    afterEach(async () => {
      vi.unstubAllGlobals();
      await db.useDatabase('tell-me');
    });

    it('reloads into a newer version of the app that upgrades it', async () => {
      await db.useDatabase('upgrade-test');
      await db.putHabits([habit()]);
      const newer = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('upgrade-test', 3);
        req.onsuccess = () => resolve(req.result);
      });
      expect(reload).toHaveBeenCalledTimes(1);
      newer.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('upgrade-test');
        req.onsuccess = () => resolve();
      });
    });

    it("steps aside without reloading when it's deleted, then starts fresh", async () => {
      await db.useDatabase('delete-test');
      await db.putHabits([habit()]);
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('delete-test');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      expect(reload).not.toHaveBeenCalled();
      expect((await db.loadAll()).habits).toEqual([]);
      await db.clearAll();
    });
  });
});

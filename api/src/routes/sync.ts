import { Hono } from 'hono';
import { notifyUsers } from '../notify';
import { computeNextFire } from '../schedule';
import { addDays } from '../social';
import { localDate } from '../tz';
import { requireUser, spendWrites, type AppEnv } from '../users';
import { syncPullSchema, syncPushSchema } from '../validation';

/**
 * End-to-end encrypted sync. The server stores opaque records (HMAC ids, AES-GCM payloads) and
 * hands out a per-account sequence number on every write, so a device can ask for "everything
 * that changed since N". Conflicts are resolved per record: the newest client timestamp wins.
 */
export const sync = new Hono<AppEnv>();

/** Generous: years of daily use fit in a fraction of this. */
export const MAX_RECORDS_PER_ACCOUNT = 50_000;
sync.use('/sync', requireUser);

interface RecordRow {
  kind: 'h' | 'c';
  id: string;
  seq: number;
  updated_at: number;
  deleted: number;
  data: string;
}

sync.get('/sync', async (c) => {
  const user = c.get('user');
  const q = syncPullSchema.safeParse({ since: c.req.query('since'), limit: c.req.query('limit') });
  if (!q.success) return c.json({ error: 'Invalid query' }, 400);
  const [{ results }, reminder] = await Promise.all([
    c.env.DB.prepare('SELECT kind, id, seq, updated_at, deleted, data FROM sync_records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .bind(user.id, q.data.since, q.data.limit)
      .all<RecordRow>(),
    c.env.DB.prepare("SELECT 1 AS ok FROM devices d JOIN reminders r ON r.device_id = d.id WHERE d.user_id = ? AND r.kind = 'checkin' LIMIT 1")
      .bind(user.id)
      .first(),
  ]);
  return c.json({
    records: results.map((r) => ({ k: r.kind, id: r.id, s: r.seq, u: r.updated_at, d: r.deleted, x: r.data })),
    seq: results.length ? results[results.length - 1]!.seq : q.data.since,
    more: results.length === q.data.limit,
    // Only when a device of this account has push reminders does the app say which check-ins
    // were answered (so those reminders are skipped). Other accounts never reveal it.
    reminders: reminder !== null,
  });
});

sync.post('/sync', async (c) => {
  const user = c.get('user');
  const body = syncPushSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid sync request', issues: body.error.issues.slice(0, 3) }, 400);
  const { records, answered } = body.data;
  const db = c.env.DB;
  let seq = user.sync_seq;
  let applied = 0;

  if (records.length) {
    if (!(await spendWrites(db, user.id, records.length))) {
      return c.json({ error: 'Daily sync limit reached. It resets at midnight UTC.' }, 429);
    }
    // Every 1,000 writes, make sure the account stays within its storage cap.
    if (Math.floor((user.sync_seq + records.length) / 1000) > Math.floor(user.sync_seq / 1000)) {
      const count = await db.prepare('SELECT COUNT(*) AS n FROM sync_records WHERE user_id = ?').bind(user.id).first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_RECORDS_PER_ACCOUNT) return c.json({ error: 'This account is full.' }, 413);
    }
    // One batch = one transaction: reserving the sequence numbers and writing the records can't
    // interleave with another device's push, so a reader never skips a lower number.
    const n = records.length;
    const results = await db.batch([
      db.prepare('UPDATE users SET sync_seq = sync_seq + ? WHERE id = ?').bind(n, user.id),
      ...records.map((r, i) =>
        db
          .prepare(
            `INSERT INTO sync_records (user_id, kind, id, seq, updated_at, deleted, data)
             VALUES (?1, ?2, ?3, (SELECT sync_seq FROM users WHERE id = ?1) - ?4, ?5, ?6, ?7)
             ON CONFLICT (user_id, kind, id) DO UPDATE SET
               seq = excluded.seq, updated_at = excluded.updated_at, deleted = excluded.deleted, data = excluded.data
             WHERE excluded.updated_at > sync_records.updated_at`,
          )
          .bind(user.id, r.k, r.id, n - 1 - i, r.u, r.d, r.x),
      ),
      db.prepare('SELECT sync_seq FROM users WHERE id = ?').bind(user.id),
    ]);
    applied = results.slice(1, -1).reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
    seq = (results[results.length - 1]!.results[0] as { sync_seq: number }).sync_seq;
  }

  if (answered.length) await skipAnsweredReminders(db, user.id, answered);

  if (applied > 0) c.executionCtx.waitUntil(notifyUsers(c.env, [user.id], { t: 'sync', seq }));
  return c.json({ ok: true, seq, applied });
});

/**
 * Answered on one device: the account's other devices shouldn't still ask "Did you show up?".
 * Reminder ids are habit ids, so we can add the date to each device's skip list. (Only the
 * fact that a check-in happened is shared here, never the answer.)
 */
async function skipAnsweredReminders(db: D1Database, userId: string, answered: Array<{ habitId: string; date: string }>) {
  const ids = [...new Set(answered.map((a) => a.habitId))].slice(0, 40);
  const placeholders = ids.map((_, i) => `?${i + 2}`).join(', ');
  const { results } = await db
    .prepare(
      `SELECT r.device_id, r.id, r.days, r.time, r.offset_min, r.skip_dates, d.time_zone
       FROM reminders r JOIN devices d ON d.id = r.device_id
       WHERE d.user_id = ?1 AND r.kind = 'checkin' AND r.id IN (${placeholders})`,
    )
    .bind(userId, ...ids)
    .all<{ device_id: string; id: string; days: number; time: string; offset_min: number; skip_dates: string; time_zone: string }>();
  if (!results.length) return;
  const now = Date.now();
  const updates = results.map((row) => {
    const today = localDate(now, row.time_zone);
    const skip = new Set(row.skip_dates ? row.skip_dates.split(',') : []);
    for (const a of answered) if (a.habitId === row.id) skip.add(a.date);
    const kept = [...skip].filter((d) => d >= addDays(today, -2)).sort().slice(-14);
    const next = computeNextFire({ days: row.days, time: row.time, offsetMin: row.offset_min, skipDates: kept }, row.time_zone, now);
    return db
      .prepare('UPDATE reminders SET skip_dates = ?, next_fire_at = ?, next_date = ? WHERE device_id = ? AND id = ?')
      .bind(kept.join(','), next?.fireAt ?? null, next?.date ?? null, row.device_id, row.id);
  });
  await db.batch(updates);
}

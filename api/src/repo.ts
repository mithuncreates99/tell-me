/** All D1 (SQLite) access lives here. */

export interface DeviceRow {
  id: string;
  token_hash: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  time_zone: string;
  created_at: number;
  updated_at: number;
  last_push_at: number | null;
  failures: number;
}

export interface ReminderRow {
  device_id: string;
  id: string;
  kind: 'checkin' | 'weekly';
  title: string;
  emoji: string;
  days: number;
  time: string;
  offset_min: number;
  skip_dates: string;
  next_fire_at: number | null;
  next_date: string | null;
}

/** A due reminder joined with the device it belongs to. */
export interface DueRow extends ReminderRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  time_zone: string;
}

export function getDevice(db: D1Database, id: string): Promise<DeviceRow | null> {
  return db.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first<DeviceRow>();
}

export function upsertDevice(
  db: D1Database,
  d: Pick<DeviceRow, 'id' | 'token_hash' | 'endpoint' | 'p256dh' | 'auth' | 'time_zone'>,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO devices (id, token_hash, endpoint, p256dh, auth, time_zone, created_at, updated_at, failures)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0)
       ON CONFLICT (id) DO UPDATE SET
         endpoint = excluded.endpoint,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         time_zone = excluded.time_zone,
         updated_at = excluded.updated_at,
         failures = 0`,
    )
    .bind(d.id, d.token_hash, d.endpoint, d.p256dh, d.auth, d.time_zone, now);
}

export function deleteReminders(db: D1Database, deviceId: string): D1PreparedStatement {
  return db.prepare('DELETE FROM reminders WHERE device_id = ?').bind(deviceId);
}

export function insertReminder(db: D1Database, r: ReminderRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO reminders (device_id, id, kind, title, emoji, days, time, offset_min, skip_dates, next_fire_at, next_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      r.device_id,
      r.id,
      r.kind,
      r.title,
      r.emoji,
      r.days,
      r.time,
      r.offset_min,
      r.skip_dates,
      r.next_fire_at,
      r.next_date,
    );
}

export function deleteDevice(db: D1Database, deviceId: string): D1PreparedStatement[] {
  return [deleteReminders(db, deviceId), db.prepare('DELETE FROM devices WHERE id = ?').bind(deviceId)];
}

export async function dueReminders(db: D1Database, now: number, limit: number): Promise<DueRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, d.endpoint, d.p256dh, d.auth, d.time_zone
       FROM reminders r JOIN devices d ON d.id = r.device_id
       WHERE r.next_fire_at IS NOT NULL AND r.next_fire_at <= ?
       ORDER BY r.next_fire_at
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<DueRow>();
  return results;
}

export function setNextFire(
  db: D1Database,
  deviceId: string,
  id: string,
  next: { fireAt: number; date: string } | null,
): D1PreparedStatement {
  return db
    .prepare('UPDATE reminders SET next_fire_at = ?, next_date = ? WHERE device_id = ? AND id = ?')
    .bind(next?.fireAt ?? null, next?.date ?? null, deviceId, id);
}

export function markPushOk(db: D1Database, deviceId: string, now: number): D1PreparedStatement {
  return db.prepare('UPDATE devices SET last_push_at = ?, failures = 0 WHERE id = ?').bind(now, deviceId);
}

export function markPushFailed(db: D1Database, deviceId: string): D1PreparedStatement {
  return db.prepare('UPDATE devices SET failures = failures + 1 WHERE id = ?').bind(deviceId);
}

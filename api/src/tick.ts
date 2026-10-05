import type { Env } from './env';
import { sendPush, type PushPayload } from './push';
import { deleteDevice, dueReminders, markPushFailed, markPushOk, setNextFire, type DueRow } from './repo';
import { computeNextFire } from './schedule';

/**
 * Workers Free allows ~10 ms of CPU per cron run and each push costs ~1 ms of crypto,
 * so we send at most this many per minute (the rest go out on the next tick).
 * On Workers Paid you can raise it with the MAX_PUSHES_PER_TICK variable.
 */
export const DEFAULT_MAX_PUSHES_PER_TICK = 8;
/** Temporary push-service errors are retried on the next ticks for this long. */
export const RETRY_WINDOW_MS = 15 * 60_000;
/** A reminder this late (e.g. after an outage) is skipped instead of sent. */
export const STALE_AFTER_MS = 3 * 60 * 60_000;
/** Devices that keep failing are dropped. */
export const MAX_FAILURES = 20;

export interface TickStats {
  due: number;
  sent: number;
  gone: number;
  retrying: number;
  failed: number;
  skipped: number;
}

export function payloadFor(row: DueRow): PushPayload {
  if (row.kind === 'weekly') return { type: 'weekly', date: row.next_date ?? '' };
  return {
    type: 'checkin',
    habitId: row.id,
    date: row.next_date ?? '',
    title: row.title,
    emoji: row.emoji,
    time: row.time,
  };
}

export function nextAfter(row: DueRow, now: number) {
  return computeNextFire(
    {
      days: row.days,
      time: row.time,
      offsetMin: row.offset_min,
      skipDates: row.skip_dates ? row.skip_dates.split(',') : [],
    },
    row.time_zone,
    Math.max(row.next_fire_at ?? now, now),
  );
}

export async function runTick(env: Env, now = Date.now()): Promise<TickStats> {
  const limit = Number(env.MAX_PUSHES_PER_TICK) || DEFAULT_MAX_PUSHES_PER_TICK;
  const due = await dueReminders(env.DB, now, limit);
  const stats: TickStats = { due: due.length, sent: 0, gone: 0, retrying: 0, failed: 0, skipped: 0 };
  if (due.length === 0) return stats;

  const writes: D1PreparedStatement[] = [];
  const goneDevices = new Set<string>();
  const failures = new Map<string, number>();

  await Promise.all(
    due.map(async (row) => {
      const lateness = now - (row.next_fire_at ?? now);
      const advance = () => writes.push(setNextFire(env.DB, row.device_id, row.id, nextAfter(row, now)));

      if (lateness > STALE_AFTER_MS) {
        stats.skipped++;
        advance();
        return;
      }

      const result = await sendPush(env, row, payloadFor(row));
      switch (result.outcome) {
        case 'ok':
          stats.sent++;
          advance();
          writes.push(markPushOk(env.DB, row.device_id, now));
          break;
        case 'gone':
          stats.gone++;
          goneDevices.add(row.device_id);
          break;
        case 'retry':
          stats.retrying++;
          if (lateness >= RETRY_WINDOW_MS) advance(); // give up on this one, keep the schedule
          failures.set(row.device_id, (failures.get(row.device_id) ?? 0) + 1);
          break;
        case 'error':
          stats.failed++;
          advance();
          failures.set(row.device_id, (failures.get(row.device_id) ?? 0) + 1);
          console.warn(`push rejected (${result.status}) for device ${row.device_id}: ${result.detail}`);
          break;
      }
    }),
  );

  for (const deviceId of failures.keys()) {
    if (goneDevices.has(deviceId)) continue;
    writes.push(
      markPushFailed(env.DB, deviceId),
      // Drop devices that have failed too many times in a row (primary-key lookups only).
      env.DB.prepare(
        'DELETE FROM reminders WHERE device_id = ?1 AND (SELECT failures FROM devices WHERE id = ?1) >= ?2',
      ).bind(deviceId, MAX_FAILURES),
      env.DB.prepare('DELETE FROM devices WHERE id = ? AND failures >= ?').bind(deviceId, MAX_FAILURES),
    );
  }
  for (const deviceId of goneDevices) writes.push(...deleteDevice(env.DB, deviceId));

  if (writes.length) await env.DB.batch(writes);
  return stats;
}

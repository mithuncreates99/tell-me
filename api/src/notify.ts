import type { Env } from './env';
import { sendPush, type PushPayload } from './push';
import { deleteDevice } from './repo';

/** An open app touches last_seen_at at least every 15 minutes (API calls, live connection). */
const ACTIVE_WINDOW_MS = 30 * 60_000;

/** Only accounts with an app open recently can have a live connection: don't wake the others' hubs. */
async function recentlyActive(env: Env, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE last_seen_at > ? AND id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(Date.now() - ACTIVE_WINDOW_MS, ...chunk)
      .all<{ id: string }>();
    out.push(...results.map((r) => r.id));
  }
  return out;
}

/** Live event to every open app of these accounts (via their LiveHub Durable Objects). */
export async function notifyUsers(env: Env, userIds: Iterable<string>, event: Record<string, unknown>): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  await Promise.all(
    (await recentlyActive(env, ids)).map(async (id) => {
      try {
        await env.HUB.get(env.HUB.idFromName(id)).notify(event);
      } catch (err) {
        console.warn('live notify failed', err);
      }
    }),
  );
}

/** Web Push to every device of an account that has reminders turned on. */
export async function pushToUser(env: Env, userId: string, payload: PushPayload): Promise<number> {
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM devices WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  let delivered = 0;
  await Promise.all(
    results.slice(0, 5).map(async (device) => {
      const result = await sendPush(env, device, payload);
      if (result.outcome === 'ok') delivered++;
      if (result.outcome === 'gone') await env.DB.batch(deleteDevice(env.DB, device.id));
    }),
  );
  return delivered;
}

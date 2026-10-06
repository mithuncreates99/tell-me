import { Hono } from 'hono';
import { bearerToken, sha256Hex, timingSafeEqual } from '../auth';
import { notifyUsers } from '../notify';
import { getDevice } from '../repo';
import { randomFriendCode, randomId } from '../social';
import { friendIds, hourWindow, profileOf, requireUser, underLimit, userByAuthHash, type AppEnv } from '../users';
import { authSecretSchema, createAccountSchema, deviceIdSchema, linkDeviceSchema, updateProfileSchema } from '../validation';

export const account = new Hono<AppEnv>();

const isUniqueViolation = (err: unknown) => String(err).includes('UNIQUE');

/**
 * Create an account. The device generated the account key and sends only the derived auth
 * secret. Idempotent: retrying with the same secret returns the same account.
 */
account.post('/account', async (c) => {
  const secret = authSecretSchema.safeParse(bearerToken(c.req.header('Authorization')));
  if (!secret.success) return c.json({ error: 'Missing credentials' }, 401);
  const body = createAccountSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Pick a name (up to 30 characters) and an emoji.', issues: body.error.issues.slice(0, 3) }, 400);

  const hash = await sha256Hex(secret.data);
  const existing = await userByAuthHash(c.env.DB, hash);
  if (existing) return c.json({ profile: profileOf(existing) });

  const now = Date.now();
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  if (!(await underLimit(c.env.DB, `signup:${ip}`, hourWindow(now), 10))) {
    return c.json({ error: 'Too many new accounts from this network. Try again in an hour.' }, 429);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomId(16);
    try {
      await c.env.DB.prepare(
        `INSERT INTO users (id, auth_hash, name, emoji, friend_code, time_zone, created_at, updated_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7)`,
      )
        .bind(id, hash, body.data.name, body.data.emoji, randomFriendCode(), body.data.timeZone ?? 'UTC', now)
        .run();
      const created = await userByAuthHash(c.env.DB, hash);
      return c.json({ profile: profileOf(created!) }, 201);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await userByAuthHash(c.env.DB, hash); // two taps on "Create"
      if (raced) return c.json({ profile: profileOf(raced) });
      // otherwise a friend code collided: try another one
    }
  }
  return c.json({ error: 'Could not create the account, please try again.' }, 500);
});

account.use('/me/*', requireUser); // also matches /me itself

account.get('/me', (c) => c.json({ profile: profileOf(c.get('user')) }));

account.patch('/me', async (c) => {
  const user = c.get('user');
  const body = updateProfileSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid profile', issues: body.error.issues.slice(0, 3) }, 400);
  const next = {
    name: body.data.name ?? user.name,
    emoji: body.data.emoji ?? user.emoji,
    time_zone: body.data.timeZone ?? user.time_zone,
  };
  await c.env.DB.prepare('UPDATE users SET name = ?, emoji = ?, time_zone = ?, updated_at = ? WHERE id = ?')
    .bind(next.name, next.emoji, next.time_zone, Date.now(), user.id)
    .run();
  if (next.name !== user.name || next.emoji !== user.emoji) {
    c.executionCtx.waitUntil(friendIds(c.env.DB, user.id).then((ids) => notifyUsers(c.env, ids, { t: 'friends', from: user.id })));
  }
  return c.json({ profile: profileOf({ ...user, ...next }) });
});

/** New friend code: old invite links stop working. */
account.post('/me/friend-code', async (c) => {
  const user = c.get('user');
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomFriendCode();
    try {
      await c.env.DB.prepare('UPDATE users SET friend_code = ?, updated_at = ? WHERE id = ?').bind(code, Date.now(), user.id).run();
      return c.json({ profile: profileOf({ ...user, friend_code: code }) });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return c.json({ error: 'Please try again.' }, 500);
});

/** Delete the account and everything stored about it: afterwards its id appears nowhere. */
account.delete('/me', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const friends = await friendIds(db, user.id);
  const { results: memberships } = await db
    .prepare('SELECT DISTINCT challenge_id FROM challenge_members WHERE user_id = ?1 UNION SELECT id FROM challenges WHERE owner_id = ?1')
    .bind(user.id)
    .all<{ challenge_id: string }>();
  const challengeIds = memberships.map((m) => m.challenge_id);
  const { results: coMembers } = challengeIds.length
    ? await db
        .prepare(`SELECT DISTINCT user_id FROM challenge_members WHERE user_id != ? AND challenge_id IN (${challengeIds.map(() => '?').join(',')})`)
        .bind(user.id, ...challengeIds)
        .all<{ user_id: string }>()
    : { results: [] as Array<{ user_id: string }> };
  await db.batch([
    db.prepare('DELETE FROM sync_records WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM shared_habits WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM friendships WHERE user_id = ?1 OR friend_id = ?1').bind(user.id),
    db.prepare('DELETE FROM reactions WHERE from_id = ?1 OR to_id = ?1').bind(user.id),
    db.prepare('DELETE FROM nudges WHERE from_id = ?1 OR to_id = ?1').bind(user.id),
    db.prepare('DELETE FROM challenge_members WHERE user_id = ?').bind(user.id),
    // Invites they sent and nobody accepted go too; challenges others joined carry on without an organiser.
    db.prepare('DELETE FROM challenge_members WHERE joined_at IS NULL AND challenge_id IN (SELECT id FROM challenges WHERE owner_id = ?)').bind(user.id),
    db.prepare('UPDATE challenge_members SET invited_by = NULL WHERE invited_by = ?').bind(user.id),
    db.prepare("UPDATE challenges SET owner_id = '' WHERE owner_id = ?").bind(user.id),
    ...challengeIds.flatMap((id) => removeIfEmpty(db, id)),
    db.prepare('UPDATE devices SET user_id = NULL WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(`codes:${user.id}`),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  c.executionCtx.waitUntil(
    Promise.all([
      notifyUsers(c.env, friends, { t: 'friends', from: user.id }),
      notifyUsers(c.env, coMembers.map((m) => m.user_id), { t: 'challenges' }),
      // Signed-in apps of this account lose their live connection now, not whenever they next reconnect.
      c.env.HUB.get(c.env.HUB.idFromName(user.id)).disconnect(),
    ]),
  );
  return c.json({ ok: true });
});

/** Deletes a challenge (and its pending invites) once nobody has joined it any more. */
export function removeIfEmpty(db: D1Database, challengeId: string): D1PreparedStatement[] {
  const empty = 'NOT EXISTS (SELECT 1 FROM challenge_members WHERE challenge_id = ?1 AND joined_at IS NOT NULL)';
  return [
    db.prepare(`DELETE FROM challenge_members WHERE challenge_id = ?1 AND ${empty}`).bind(challengeId),
    db.prepare(`DELETE FROM challenges WHERE id = ?1 AND ${empty}`).bind(challengeId),
  ];
}

/** Link a device that has push reminders on, so friends' nudges and reactions reach it. */
account.post('/me/devices/:id', async (c) => {
  const user = c.get('user');
  const id = deviceIdSchema.safeParse(c.req.param('id'));
  const body = linkDeviceSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !body.success) return c.json({ error: 'Invalid request' }, 400);
  const device = await getDevice(c.env.DB, id.data);
  if (!device) return c.json({ error: 'Unknown device' }, 404);
  if (!timingSafeEqual(device.token_hash, await sha256Hex(body.data.token))) return c.json({ error: 'Forbidden' }, 403);
  await c.env.DB.prepare('UPDATE devices SET user_id = ? WHERE id = ?').bind(user.id, id.data).run();
  return c.json({ ok: true });
});

account.delete('/me/devices/:id', async (c) => {
  const user = c.get('user');
  const id = deviceIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'Invalid device id' }, 400);
  await c.env.DB.prepare('UPDATE devices SET user_id = NULL WHERE id = ? AND user_id = ?').bind(id.data, user.id).run();
  return c.json({ ok: true });
});

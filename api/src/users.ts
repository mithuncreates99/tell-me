import type { Context, MiddlewareHandler } from 'hono';
import { bearerToken, sha256Hex } from './auth';
import type { Env } from './env';
import { authSecretSchema } from './validation';

export interface UserRow {
  id: string;
  auth_hash: string;
  name: string;
  emoji: string;
  friend_code: string;
  time_zone: string;
  sync_seq: number;
  share_hash: string | null;
  quota_day: string;
  quota_used: number;
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
}

export type AppEnv = { Bindings: Env; Variables: { user: UserRow } };
export type AppContext = Context<AppEnv>;

export interface Profile {
  id: string;
  name: string;
  emoji: string;
  friendCode: string;
  timeZone: string;
  createdAt: number;
}

export const profileOf = (u: UserRow): Profile => ({
  id: u.id,
  name: u.name,
  emoji: u.emoji,
  friendCode: u.friend_code,
  timeZone: u.time_zone,
  createdAt: u.created_at,
});

export const userByAuthHash = (db: D1Database, hash: string) =>
  db.prepare('SELECT * FROM users WHERE auth_hash = ?').bind(hash).first<UserRow>();

export const userById = (db: D1Database, id: string) => db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();

export const areFriends = async (db: D1Database, a: string, b: string) =>
  (await db.prepare('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?').bind(a, b).first()) !== null;

export async function friendIds(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT friend_id FROM friendships WHERE user_id = ?').bind(userId).all<{ friend_id: string }>();
  return results.map((r) => r.friend_id);
}

/** Rows a single account may write per UTC day (sync + sharing). Plenty for real use, a wall for scripts. */
export const DAILY_WRITE_BUDGET = 5_000;

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Atomically takes `n` writes from today's budget. False when that would go over it. */
export async function spendWrites(db: D1Database, userId: string, n: number): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE users SET quota_used = CASE WHEN quota_day = ?2 THEN quota_used + ?3 ELSE ?3 END, quota_day = ?2
       WHERE id = ?1 AND (quota_day != ?2 OR quota_used + ?3 <= ?4)`,
    )
    .bind(userId, utcDay(), n, DAILY_WRITE_BUDGET)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Fixed-window counter: true while `key` has been hit at most `limit` times in this window. */
export async function underLimit(db: D1Database, key: string, window: string, limit: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, win, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET count = CASE WHEN win = ?2 THEN count + 1 ELSE 1 END, win = ?2
       RETURNING count`,
    )
    .bind(key, window)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

/**
 * Account requests carry `Authorization: Bearer <auth secret>`. The secret is derived on the
 * device from the account key; the server stores only its SHA-256, and never sees the key
 * that encrypts the user's data.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = authSecretSchema.safeParse(bearerToken(c.req.header('Authorization')));
  if (!secret.success) return c.json({ error: 'Sign in to use this.' }, 401);
  const user = await userByAuthHash(c.env.DB, await sha256Hex(secret.data));
  if (!user) return c.json({ error: 'No account found for this key.', code: 'unknown-account' }, 401);
  c.set('user', user);
  const now = Date.now();
  if (!user.last_seen_at || now - user.last_seen_at > 15 * 60_000) {
    c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, user.id).run());
  }
  await next();
};

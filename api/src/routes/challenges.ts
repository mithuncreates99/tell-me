import { Hono } from 'hono';
import { notifyUsers, pushToUser } from '../notify';
import { clip, normalizeSharedHabit, randomId, yesThisWeek, type SharedHabitRow } from '../social';
import { areFriends, requireUser, type AppEnv, type UserRow } from '../users';
import { challengeIdSchema, createChallengeSchema, inviteSchema, joinChallengeSchema } from '../validation';
import { removeIfEmpty } from './account';

export const MAX_CHALLENGES = 10;
export const MAX_MEMBERS = 20;

/**
 * Weekly challenges: "Gym 3× this week". Each member counts one of their shared habits;
 * progress is that habit's Yes answers in the member's own current week, so it resets every week.
 */
export const challenges = new Hono<AppEnv>();
challenges.use('/challenges/*', requireUser); // also matches /challenges

interface MemberRow {
  challenge_id: string;
  owner_id: string;
  name: string;
  emoji: string;
  target: number;
  created_at: number;
  user_id: string;
  habit_id: string | null;
  joined_at: number | null;
  member_name: string;
  member_emoji: string;
  time_zone: string;
}

export async function listChallenges(db: D1Database, userId: string, now: number) {
  const mine = 'SELECT challenge_id FROM challenge_members WHERE user_id = ?1';
  const [memberRows, habitRows] = await db.batch([
    db
      .prepare(
        `SELECT c.id AS challenge_id, c.owner_id, c.name, c.emoji, c.target, c.created_at,
                m.user_id, m.habit_id, m.joined_at, u.name AS member_name, u.emoji AS member_emoji, u.time_zone
         FROM challenges c
         JOIN challenge_members m ON m.challenge_id = c.id
         JOIN users u ON u.id = m.user_id
         WHERE c.id IN (${mine})
         ORDER BY c.created_at DESC, m.created_at`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT DISTINCT s.* FROM shared_habits s
         JOIN challenge_members m ON m.user_id = s.user_id AND m.habit_id = s.habit_id
         WHERE m.challenge_id IN (${mine})`,
      )
      .bind(userId),
  ]);
  const habits = new Map<string, SharedHabitRow>();
  for (const h of habitRows!.results as unknown as SharedHabitRow[]) habits.set(`${h.user_id}:${h.habit_id}`, h);

  const byId = new Map<string, { id: string; name: string; emoji: string; target: number; ownerId: string; createdAt: number; members: unknown[]; me: unknown }>();
  for (const r of memberRows!.results as unknown as MemberRow[]) {
    let ch = byId.get(r.challenge_id);
    if (!ch) {
      ch = { id: r.challenge_id, name: r.name, emoji: r.emoji, target: r.target, ownerId: r.owner_id, createdAt: r.created_at, members: [], me: null };
      byId.set(r.challenge_id, ch);
    }
    const row = r.habit_id ? habits.get(`${r.user_id}:${r.habit_id}`) : undefined;
    const habit = row ? normalizeSharedHabit(row, r.time_zone, now) : null;
    const yes = yesThisWeek(habit);
    const member = {
      userId: r.user_id,
      name: r.member_name,
      emoji: r.member_emoji,
      status: r.joined_at ? 'member' : 'invited',
      habit: habit ? { id: habit.id, name: habit.name, emoji: habit.emoji, color: habit.color, today: habit.today, week: habit.week } : null,
      yes,
      done: yes >= r.target,
    };
    ch.members.push(member);
    if (r.user_id === userId) ch.me = { status: member.status, habitId: r.habit_id };
  }
  for (const ch of byId.values()) {
    (ch.members as Array<{ yes: number; status: string }>).sort((a, b) => (a.status === b.status ? b.yes - a.yes : a.status === 'member' ? -1 : 1));
  }
  return [...byId.values()];
}

challenges.get('/challenges', async (c) => c.json({ challenges: await listChallenges(c.env.DB, c.get('user').id, Date.now()) }));

const isSharedBy = async (db: D1Database, userId: string, habitId: string) =>
  (await db.prepare('SELECT 1 AS ok FROM shared_habits WHERE user_id = ? AND habit_id = ?').bind(userId, habitId).first()) !== null;

async function onlyFriends(db: D1Database, userId: string, ids: string[]): Promise<boolean> {
  for (const id of ids) if (!(await areFriends(db, userId, id))) return false;
  return true;
}

function invitePush(from: UserRow, ch: { name: string; emoji: string; target: number }) {
  return {
    type: 'social' as const,
    title: `${from.emoji} ${clip(from.name, 30)} invited you to a challenge`,
    body: `${ch.emoji} ${clip(ch.name, 40)}: ${ch.target}× this week. Tap to join.`,
    path: '#/friends',
    tag: `challenge-${from.id}`,
  };
}

challenges.post('/challenges', async (c) => {
  const user = c.get('user');
  const body = createChallengeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid challenge', issues: body.error.issues.slice(0, 3) }, 400);
  const db = c.env.DB;
  const { name, emoji, target, habitId } = body.data;
  const invite = [...new Set(body.data.invite)].filter((id) => id !== user.id);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM challenge_members WHERE user_id = ?').bind(user.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_CHALLENGES) return c.json({ error: `You can be in up to ${MAX_CHALLENGES} challenges.` }, 400);
  if (!(await isSharedBy(db, user.id, habitId))) return c.json({ error: 'Share this habit with friends first.' }, 400);
  if (!(await onlyFriends(db, user.id, invite))) return c.json({ error: 'You can only invite friends.' }, 403);

  const id = randomId(12);
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO challenges (id, owner_id, name, emoji, target, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, user.id, name, emoji, target, now),
    db
      .prepare('INSERT INTO challenge_members (challenge_id, user_id, habit_id, invited_by, joined_at, created_at) VALUES (?, ?, ?, NULL, ?, ?)')
      .bind(id, user.id, habitId, now, now),
    ...invite.map((friendId, i) =>
      db
        .prepare('INSERT INTO challenge_members (challenge_id, user_id, habit_id, invited_by, joined_at, created_at) VALUES (?, ?, NULL, ?, NULL, ?)')
        .bind(id, friendId, user.id, now + i + 1),
    ),
  ]);
  c.executionCtx.waitUntil(
    Promise.all([
      notifyUsers(c.env, [user.id, ...invite], { t: 'challenges' }),
      ...invite.map((friendId) => pushToUser(c.env, friendId, invitePush(user, { name, emoji, target }))),
    ]),
  );
  return c.json({ id }, 201);
});

async function memberIds(db: D1Database, challengeId: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT user_id FROM challenge_members WHERE challenge_id = ?').bind(challengeId).all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

challenges.post('/challenges/:id/join', async (c) => {
  const user = c.get('user');
  const id = challengeIdSchema.safeParse(c.req.param('id'));
  const body = joinChallengeSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !body.success) return c.json({ error: 'Invalid request' }, 400);
  const db = c.env.DB;
  const row = await db
    .prepare('SELECT joined_at FROM challenge_members WHERE challenge_id = ? AND user_id = ?')
    .bind(id.data, user.id)
    .first<{ joined_at: number | null }>();
  if (!row) return c.json({ error: 'This invite is no longer available.' }, 404);
  if (!(await isSharedBy(db, user.id, body.data.habitId))) return c.json({ error: 'Share this habit with friends first.' }, 400);
  await db
    .prepare('UPDATE challenge_members SET habit_id = ?, joined_at = COALESCE(joined_at, ?) WHERE challenge_id = ? AND user_id = ?')
    .bind(body.data.habitId, Date.now(), id.data, user.id)
    .run();
  c.executionCtx.waitUntil(memberIds(db, id.data).then((ids) => notifyUsers(c.env, ids, { t: 'challenges' })));
  return c.json({ ok: true });
});

challenges.post('/challenges/:id/invite', async (c) => {
  const user = c.get('user');
  const id = challengeIdSchema.safeParse(c.req.param('id'));
  const body = inviteSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !body.success) return c.json({ error: 'Invalid request' }, 400);
  const db = c.env.DB;
  const ch = await db
    .prepare('SELECT * FROM challenges WHERE id = ?')
    .bind(id.data)
    .first<{ name: string; emoji: string; target: number; owner_id: string }>();
  const existing = await memberIds(db, id.data);
  if (!ch || !existing.includes(user.id)) return c.json({ error: 'Challenge not found.' }, 404);
  // Members agreed to share their habit with the people the organiser picks, so only they invite.
  if (ch.owner_id !== user.id) return c.json({ error: 'Only the person who started the challenge can invite.' }, 403);
  const invite = [...new Set(body.data.friendIds)].filter((f) => !existing.includes(f));
  if (!(await onlyFriends(db, user.id, invite))) return c.json({ error: 'You can only invite friends.' }, 403);
  if (existing.length + invite.length > MAX_MEMBERS) return c.json({ error: `A challenge can have up to ${MAX_MEMBERS} people.` }, 400);
  const now = Date.now();
  if (invite.length) {
    await db.batch(
      invite.map((friendId, i) =>
        db
          .prepare('INSERT OR IGNORE INTO challenge_members (challenge_id, user_id, habit_id, invited_by, joined_at, created_at) VALUES (?, ?, NULL, ?, NULL, ?)')
          .bind(id.data, friendId, user.id, now + i),
      ),
    );
    c.executionCtx.waitUntil(
      Promise.all([
        notifyUsers(c.env, [...existing, ...invite], { t: 'challenges' }),
        ...invite.map((friendId) => pushToUser(c.env, friendId, invitePush(user, ch))),
      ]),
    );
  }
  return c.json({ ok: true, invited: invite.length });
});

/** Leave a challenge, or decline an invite. The challenge disappears when nobody is left. */
challenges.delete('/challenges/:id/membership', async (c) => {
  const user = c.get('user');
  const id = challengeIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'Invalid request' }, 400);
  const db = c.env.DB;
  const others = (await memberIds(db, id.data)).filter((m) => m !== user.id);
  await db.batch([
    db.prepare('DELETE FROM challenge_members WHERE challenge_id = ? AND user_id = ?').bind(id.data, user.id),
    ...removeIfEmpty(db, id.data),
  ]);
  c.executionCtx.waitUntil(notifyUsers(c.env, [user.id, ...others], { t: 'challenges' }));
  return c.json({ ok: true });
});

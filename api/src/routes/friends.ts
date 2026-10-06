import { Hono } from 'hono';
import { sha256Hex } from '../auth';
import { notifyUsers, pushToUser } from '../notify';
import {
  addDays,
  clip,
  coarseLastSeen,
  daysBetween,
  normalizeSharedHabit,
  visibleShare,
  weekSummary,
  type SharedHabitRow,
  type SharedHabitView,
} from '../social';
import { daysToMask } from '../schedule';
import { localDate } from '../tz';
import { areFriends, friendIds, hourWindow, profileOf, requireUser, spendWrites, underLimit, userById, type AppEnv, type UserRow } from '../users';
import { addFriendSchema, friendCodeSchema, nudgeSchema, reactionSchema, shareSchema, userIdSchema } from '../validation';
import { removeIfEmpty } from './account';

export const MAX_FRIENDS = 100;
/** Friend codes are the key to your shared habits: guessing them is capped per account and per network. */
export const CODE_TRIES_PER_HOUR = 30;
export const INVITE_VIEWS_PER_HOUR = 60;

export const friends = new Hono<AppEnv>();
for (const path of ['/friends/*', '/share', '/nudges', '/reactions']) friends.use(path, requireUser); // /friends/* also matches /friends

const brief = (u: Pick<UserRow, 'id' | 'name' | 'emoji'>) => ({ id: u.id, name: u.name, emoji: u.emoji });

/** Everything the Friends screen shows, in one request. */
export async function buildFeed(db: D1Database, user: UserRow, now: number) {
  const since = addDays(localDate(now, user.time_zone), -7);
  const [friendRows, habitRows, reactionRows, nudgeRows] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.name, u.emoji, u.time_zone, u.last_seen_at, f.created_at AS since
         FROM friendships f JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = ? ORDER BY u.name COLLATE NOCASE`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT * FROM shared_habits
         WHERE user_id = ?1 OR user_id IN (SELECT friend_id FROM friendships WHERE user_id = ?1)
         ORDER BY position`,
      )
      .bind(user.id),
    db
      .prepare("SELECT from_id, to_id, habit_id, date, emoji, created_at FROM reactions WHERE (to_id = ?1 OR from_id = ?1) AND date >= ?2 AND emoji != ''")
      .bind(user.id, since),
    db
      .prepare('SELECT from_id, to_id, habit_id, date, created_at FROM nudges WHERE (to_id = ?1 OR from_id = ?1) AND date >= ?2')
      .bind(user.id, addDays(since, 5)),
  ]);

  const people = friendRows!.results as Array<Pick<UserRow, 'id' | 'name' | 'emoji' | 'time_zone' | 'last_seen_at'> & { since: number }>;
  const zones = new Map<string, string>([[user.id, user.time_zone], ...people.map((p) => [p.id, p.time_zone] as const)]);
  const habitsBy = new Map<string, SharedHabitView[]>();
  for (const row of habitRows!.results as unknown as SharedHabitRow[]) {
    const view = normalizeSharedHabit(row, zones.get(row.user_id) ?? 'UTC', now);
    habitsBy.set(row.user_id, [...(habitsBy.get(row.user_id) ?? []), view]);
  }
  const mine = habitsBy.get(user.id) ?? [];

  return {
    me: { ...profileOf(user), habits: mine, week: weekSummary(mine) },
    friends: people.map((p) => {
      const habits = habitsBy.get(p.id) ?? [];
      return { id: p.id, name: p.name, emoji: p.emoji, since: p.since, lastSeenAt: coarseLastSeen(p.last_seen_at), habits, week: weekSummary(habits) };
    }),
    reactions: (reactionRows!.results as Array<{ from_id: string; to_id: string; habit_id: string; date: string; emoji: string; created_at: number }>).map(
      (r) => ({ from: r.from_id, to: r.to_id, habitId: r.habit_id, date: r.date, emoji: r.emoji, at: r.created_at }),
    ),
    nudges: (nudgeRows!.results as Array<{ from_id: string; to_id: string; habit_id: string; date: string; created_at: number }>).map((n) => ({
      from: n.from_id,
      to: n.to_id,
      habitId: n.habit_id,
      date: n.date,
      at: n.created_at,
    })),
    serverTime: now,
  };
}

friends.get('/friends', async (c) => c.json(await buildFeed(c.env.DB, c.get('user'), Date.now())));

/** Public: the name on an invite link, so "Bea invited you" can show before you have an account. */
friends.get('/invite/:code', async (c) => {
  const code = friendCodeSchema.safeParse(c.req.param('code'));
  if (!code.success) return c.json({ error: "That invite link isn't valid." }, 400);
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  if (!(await underLimit(c.env.DB, `invite:${ip}`, hourWindow(), INVITE_VIEWS_PER_HOUR))) {
    return c.json({ error: 'Too many invite links opened from this network. Try again in an hour.' }, 429);
  }
  const owner = await c.env.DB.prepare('SELECT name, emoji FROM users WHERE friend_code = ?')
    .bind(code.data)
    .first<{ name: string; emoji: string }>();
  if (!owner) return c.json({ error: 'This invite link has expired.' }, 404);
  return c.json({ name: owner.name, emoji: owner.emoji });
});

const TOO_MANY_TRIES = 'Too many friend codes tried. Try again in an hour.';
const codeTriesLeft = (db: D1Database, userId: string) => underLimit(db, `codes:${userId}`, hourWindow(), CODE_TRIES_PER_HOUR);

/**
 * Who does this code belong to? (Shown before adding, so you know it's the right person.)
 * Same as an invite link: name and avatar only, until you're friends.
 */
friends.get('/friends/lookup/:code', async (c) => {
  const user = c.get('user');
  const code = friendCodeSchema.safeParse(c.req.param('code'));
  if (!code.success) return c.json({ error: "That code doesn't look right." }, 400);
  if (!(await codeTriesLeft(c.env.DB, user.id))) return c.json({ error: TOO_MANY_TRIES }, 429);
  const other = await c.env.DB.prepare('SELECT id, name, emoji FROM users WHERE friend_code = ?')
    .bind(code.data)
    .first<Pick<UserRow, 'id' | 'name' | 'emoji'>>();
  if (!other) return c.json({ error: 'No one has that code. It may have been changed.' }, 404);
  return c.json({ user: { name: other.name, emoji: other.emoji }, isSelf: other.id === user.id, isFriend: await areFriends(c.env.DB, user.id, other.id) });
});

friends.post('/friends', async (c) => {
  const user = c.get('user');
  const body = addFriendSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "That code doesn't look right." }, 400);
  const db = c.env.DB;
  if (!(await codeTriesLeft(db, user.id))) return c.json({ error: TOO_MANY_TRIES }, 429);
  const other = await db.prepare('SELECT * FROM users WHERE friend_code = ?').bind(body.data.code).first<UserRow>();
  if (!other) return c.json({ error: 'No one has that code. It may have been changed.' }, 404);
  if (other.id === user.id) return c.json({ error: "That's your own code. Send it to a friend instead." }, 400);
  if (await areFriends(db, user.id, other.id)) return c.json({ friend: brief(other), added: false });

  const counts = await db
    .prepare('SELECT (SELECT COUNT(*) FROM friendships WHERE user_id = ?1) AS mine, (SELECT COUNT(*) FROM friendships WHERE user_id = ?2) AS theirs')
    .bind(user.id, other.id)
    .first<{ mine: number; theirs: number }>();
  if ((counts?.mine ?? 0) >= MAX_FRIENDS || (counts?.theirs ?? 0) >= MAX_FRIENDS) {
    return c.json({ error: `Friend lists are limited to ${MAX_FRIENDS} people.` }, 400);
  }
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').bind(user.id, other.id, now),
    db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').bind(other.id, user.id, now),
  ]);
  c.executionCtx.waitUntil(
    Promise.all([
      notifyUsers(c.env, [user.id, other.id], { t: 'friends', from: user.id }),
      pushToUser(c.env, other.id, {
        type: 'social',
        title: `${user.emoji} ${clip(user.name, 30)} added you as a friend`,
        body: 'You can now see the habits you both share. Tap to say hi with a 🔥.',
        path: '#/friends',
        tag: `friend-${user.id}`,
      }),
    ]),
  );
  return c.json({ friend: brief(other), added: true }, 201);
});

/**
 * Remove a friend: neither of you sees the other's habits, reactions or nudges any more.
 * A challenge is made of its organiser's friends, so each of you also leaves the challenges the
 * other started (a challenge someone else started, you both stay in until you leave it).
 */
friends.delete('/friends/:id', async (c) => {
  const user = c.get('user');
  const id = userIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  // Not friends (or no such person): nothing to do, and nobody is told anything.
  if (!(await areFriends(db, user.id, id.data))) return c.json({ ok: true });

  const { results: theirChallenges } = await db
    .prepare(
      `SELECT m.challenge_id, m.user_id FROM challenge_members m JOIN challenges ch ON ch.id = m.challenge_id
       WHERE (ch.owner_id = ?1 AND m.user_id = ?2) OR (ch.owner_id = ?2 AND m.user_id = ?1)`,
    )
    .bind(user.id, id.data)
    .all<{ challenge_id: string; user_id: string }>();
  const challengeIds = [...new Set(theirChallenges.map((r) => r.challenge_id))];
  await db.batch([
    db.prepare('DELETE FROM friendships WHERE (user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)').bind(user.id, id.data),
    db.prepare('DELETE FROM reactions WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)').bind(user.id, id.data),
    db.prepare('DELETE FROM nudges WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)').bind(user.id, id.data),
    ...theirChallenges.map((r) => db.prepare('DELETE FROM challenge_members WHERE challenge_id = ? AND user_id = ?').bind(r.challenge_id, r.user_id)),
    ...challengeIds.flatMap((cid) => removeIfEmpty(db, cid)),
  ]);

  const events: Promise<unknown>[] = [notifyUsers(c.env, [user.id, id.data], { t: 'friends', from: user.id })];
  if (challengeIds.length) {
    const { results: members } = await db
      .prepare(`SELECT DISTINCT user_id FROM challenge_members WHERE challenge_id IN (${challengeIds.map(() => '?').join(',')})`)
      .bind(...challengeIds)
      .all<{ user_id: string }>();
    events.push(notifyUsers(c.env, [user.id, id.data, ...members.map((m) => m.user_id)], { t: 'challenges' }));
  }
  c.executionCtx.waitUntil(Promise.all(events));
  return c.json({ ok: true });
});

/**
 * Publish the habits this user shares with friends (declarative: the full list every time).
 * Called by the app after check-ins; unchanged snapshots are ignored.
 */
friends.put('/share', async (c) => {
  const user = c.get('user');
  const parsed = shareSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid share request', issues: parsed.error.issues.slice(0, 3) }, 400);
  const body = parsed.data;
  const db = c.env.DB;
  const now = Date.now();
  // The snapshot must describe the owner's real "today" (this also bounds the catch-up work later).
  const ownerToday = localDate(now, body.timeZone);
  const offset = daysBetween(body.weekStart, body.date);
  if (Math.abs(daysBetween(body.date, ownerToday)) > 1 || offset < 0 || offset > 6) {
    return c.json({ error: "The snapshot's dates don't match today. Check the device clock." }, 400);
  }
  const hash = await sha256Hex(JSON.stringify({ d: body.date, w: body.weekStart, z: body.timeZone, h: body.habits }));
  const changed = hash !== user.share_hash;
  if (!changed) return c.json({ ok: true, changed });

  if (!(await spendWrites(db, user.id, body.habits.length + 2))) {
    return c.json({ error: 'Daily limit reached. It resets at midnight UTC.' }, 429);
  }
  // Only these columns are stored: nothing else in a request (notes, reasons, other habits) can be.
  const rows: SharedHabitRow[] = body.habits.map((h, position) => ({
    user_id: user.id,
    habit_id: h.id,
    name: h.name,
    emoji: h.emoji,
    color: h.color,
    days: daysToMask(h.days),
    time: h.time,
    ask_min: h.askMin,
    date: body.date,
    week_start: body.weekStart,
    week: h.week,
    streak: h.streak,
    best: 0, // older apps still send their best streak; it isn't shown to anyone, so it isn't kept
    position,
    updated_at: now,
  }));
  const { results: before } = await db.prepare('SELECT * FROM shared_habits WHERE user_id = ?').bind(user.id).all<SharedHabitRow>();
  await db.batch([
    db.prepare('DELETE FROM shared_habits WHERE user_id = ?').bind(user.id),
    ...rows.map((r) =>
      db
        .prepare(
          `INSERT INTO shared_habits (user_id, habit_id, name, emoji, color, days, time, ask_min, date, week_start, week, streak, best, position, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(r.user_id, r.habit_id, r.name, r.emoji, r.color, r.days, r.time, r.ask_min, r.date, r.week_start, r.week, r.streak, r.best, r.position, r.updated_at),
    ),
    db.prepare('UPDATE users SET share_hash = ?, time_zone = ? WHERE id = ?').bind(hash, body.timeZone, user.id),
  ]);

  // The account's own devices refresh. Friends only hear about it when something they can see
  // changed, so a new day or a re-sent snapshot doesn't tell them when you opened the app.
  const events: Promise<unknown>[] = [notifyUsers(c.env, [user.id], { t: 'friends', from: user.id })];
  if (visibleShare(before, user.time_zone, now) !== visibleShare(rows, body.timeZone, now)) {
    const habit = body.event ? body.habits.find((h) => h.id === body.event!.habitId) : undefined;
    const event =
      habit && body.event
        ? { t: 'checkin', from: brief(user), habit: { id: habit.id, name: habit.name, emoji: habit.emoji }, answer: body.event.answer }
        : { t: 'friends', from: user.id };
    events.push(friendIds(db, user.id).then((ids) => notifyUsers(c.env, ids, event)));
  }
  c.executionCtx.waitUntil(Promise.all(events));
  return c.json({ ok: true, changed });
});

async function sharedHabitOf(db: D1Database, ownerId: string, habitId: string, timeZone: string, now: number) {
  const row = await db.prepare('SELECT * FROM shared_habits WHERE user_id = ? AND habit_id = ?').bind(ownerId, habitId).first<SharedHabitRow>();
  return row ? normalizeSharedHabit(row, timeZone, now) : null;
}

/** "Did you go yet?" — at most once per friend, habit and day. */
friends.post('/nudges', async (c) => {
  const user = c.get('user');
  const body = nudgeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid nudge' }, 400);
  const db = c.env.DB;
  const now = Date.now();
  if (!(await areFriends(db, user.id, body.data.to))) return c.json({ error: "You're not friends with this person." }, 403);
  const friend = (await userById(db, body.data.to))!;
  const habit = await sharedHabitOf(db, friend.id, body.data.habitId, friend.time_zone, now);
  if (!habit) return c.json({ error: "They're not sharing that habit any more." }, 404);
  if (habit.today === 'yes' || habit.today === 'no') return c.json({ error: 'They already checked in.' }, 409);
  if (habit.today === 'rest') return c.json({ error: "It's not planned for today." }, 409);

  const date = localDate(now, friend.time_zone);
  const res = await db
    .prepare('INSERT OR IGNORE INTO nudges (from_id, to_id, habit_id, date, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, friend.id, habit.id, date, now)
    .run();
  if (!res.meta.changes) return c.json({ error: 'You already nudged them about this today.' }, 429);

  c.executionCtx.waitUntil(
    Promise.all([
      notifyUsers(c.env, [friend.id], { t: 'nudge', from: brief(user), habit: { id: habit.id, name: habit.name, emoji: habit.emoji } }),
      notifyUsers(c.env, [user.id], { t: 'friends', from: user.id }),
      pushToUser(c.env, friend.id, {
        type: 'social',
        title: `${user.emoji} ${clip(user.name, 30)} nudged you`,
        body: `${habit.emoji} ${clip(habit.name, 40)}: did you show up today?`,
        path: '#/',
        tag: `nudge-${habit.id}`,
      }),
    ]),
  );
  return c.json({ ok: true }, 201);
});

/** React to a friend's check-in with an emoji (null removes the reaction). */
friends.put('/reactions', async (c) => {
  const user = c.get('user');
  const body = reactionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid reaction' }, 400);
  const db = c.env.DB;
  const now = Date.now();
  const { to, habitId, date, emoji } = body.data;
  if (!(await areFriends(db, user.id, to))) return c.json({ error: "You're not friends with this person." }, 403);
  const friend = (await userById(db, to))!;
  const habit = await sharedHabitOf(db, friend.id, habitId, friend.time_zone, now);
  if (!habit) return c.json({ error: "They're not sharing that habit any more." }, 404);
  const today = localDate(now, friend.time_zone);
  if (date > today || date < addDays(today, -7)) return c.json({ error: 'You can react to the last 7 days.' }, 400);

  if (emoji === null) {
    // Kept as an empty row, so taking a reaction back and adding it again doesn't push again.
    await db.prepare("UPDATE reactions SET emoji = '' WHERE from_id = ? AND to_id = ? AND habit_id = ? AND date = ?").bind(user.id, to, habitId, date).run();
  } else {
    const before = await db
      .prepare('SELECT emoji FROM reactions WHERE from_id = ? AND to_id = ? AND habit_id = ? AND date = ?')
      .bind(user.id, to, habitId, date)
      .first<{ emoji: string }>();
    await db
      .prepare(
        `INSERT INTO reactions (from_id, to_id, habit_id, date, emoji, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (from_id, to_id, habit_id, date) DO UPDATE SET emoji = excluded.emoji`,
      )
      .bind(user.id, to, habitId, date, emoji, now)
      .run();
    const events: Promise<unknown>[] = [
      notifyUsers(c.env, [to], { t: 'reaction', from: brief(user), habit: { id: habit.id, name: habit.name, emoji: habit.emoji }, emoji, date }),
    ];
    if (!before) {
      events.push(
        pushToUser(c.env, to, {
          type: 'social',
          title: `${user.emoji} ${clip(user.name, 30)} reacted ${emoji}`,
          body: `to your ${habit.emoji} ${clip(habit.name, 40)}`,
          path: '#/friends',
          tag: `reaction-${user.id}-${habit.id}`,
        }),
      );
    }
    c.executionCtx.waitUntil(Promise.all(events));
  }
  c.executionCtx.waitUntil(notifyUsers(c.env, [user.id, to], { t: 'friends', from: user.id }));
  return c.json({ ok: true });
});

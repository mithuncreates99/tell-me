#!/usr/bin/env node
/**
 * Privacy tests for the Friends area, run against the real worker (wrangler dev + local D1 +
 * Durable Objects) and a mock push service that decrypts every notification.
 *
 * Six people. Arun and Bea are friends. Chen is Bea's friend but a stranger to Arun. Dee is
 * friends with both of them. Sam knows nobody, and Gus only tries to guess friend codes.
 * Every response, live event and notification each of them gets is recorded, and the last
 * section checks all of it for anything they shouldn't have seen.
 *
 *   npm run test:privacy
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { b64url, checklist, secret, sleep, startLocalServer } from './harness.mjs';

const server = await startLocalServer({ apiPort: 8795, pushPort: 8794 });
const { api, live, sql, sqlAll, received, newSubscription, waitFor } = server;
const checks = checklist();
const { section, step } = checks;

// ---------- dates: Europe/Paris, weeks start on Monday like in the app ----------
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayIdx = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
const weekStart = addDays(today, -todayIdx);
const weekWith = (todayChar) => Array.from({ length: 7 }, (_, i) => (i < todayIdx ? 'Y' : i === todayIdx ? todayChar : 'F')).join('');
/** A shared habit as the app sends it (planned every day; `todayChar` P = due, Y = done). */
const habit = (id, name, emoji, todayChar = 'P') => ({
  id, name, emoji, color: 'blue', days: [0, 1, 2, 3, 4, 5, 6], time: '18:00', askMin: 0, week: weekWith(todayChar), streak: todayIdx,
});

// ---------- what may be visible, field by field ----------
const keysOf = (o) => Object.keys(o).sort();
const FEED = ['friends', 'me', 'nudges', 'reactions', 'serverTime'];
const FRIEND = ['emoji', 'habits', 'id', 'lastSeenAt', 'name', 'since', 'week'];
const FRIEND_HABIT = ['color', 'date', 'days', 'emoji', 'id', 'name', 'streak', 'time', 'today', 'week', 'weekStart'];
const REACTION = ['at', 'date', 'emoji', 'from', 'habitId', 'to'];
const NUDGE = ['at', 'date', 'from', 'habitId', 'to'];
const CHALLENGE = ['createdAt', 'emoji', 'id', 'me', 'members', 'name', 'ownerId', 'target'];
const MEMBER = ['done', 'emoji', 'habit', 'name', 'status', 'userId', 'yes'];
const MEMBER_HABIT = ['color', 'emoji', 'id', 'name', 'today', 'week'];
const SOCIAL_PUSH = ['body', 'path', 'tag', 'title', 'type'];
const LIVE_EVENT = {
  hello: ['at', 't'],
  sync: ['seq', 't'],
  friends: ['from', 't'],
  challenges: ['t'],
  checkin: ['answer', 'from', 'habit', 't'],
  nudge: ['from', 'habit', 't'],
  reaction: ['date', 'emoji', 'from', 'habit', 't'],
  gone: ['t'],
};
/** Written into requests on purpose: must never come back to anyone or be stored. */
const TRAPS = ['hangover', 'felt awful', 'Therapy'];

// ---------- people and requests ----------
const everyone = [];
/** A request as `u` (null = signed out). Every response someone gets is kept in `u.seen`. */
async function call(u, method, path, body, headers) {
  const res = await api(path, { method, token: u?.token, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  u?.seen.push({ method, path, status: res.status, data });
  return { status: res.status, data };
}
const get = (u, path, headers) => call(u, 'GET', path, undefined, headers);
const post = (u, path, body = {}) => call(u, 'POST', path, body);
const put = (u, path, body) => call(u, 'PUT', path, body);
const del = (u, path) => call(u, 'DELETE', path);
const share = (u, habits, event, timeZone = 'Europe/Paris') => put(u, '/api/share', { timeZone, date: today, weekStart, habits, ...(event ? { event } : {}) });
const feed = async (u) => (await get(u, '/api/friends')).data;
const challengesOf = async (u) => (await get(u, '/api/challenges')).data.challenges;
const challenge = async (u, id) => (await challengesOf(u)).find((c) => c.id === id);
const pushesTo = (u) => (u.phone ? received.filter((r) => r.path === u.phone.path).map((r) => r.payload) : []);
const randomUserId = () => b64url(randomBytes(12)); // 16 characters, like a real one
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = () => {
  for (;;) {
    const code = Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!everyone.some((u) => u.code === code || u.oldCode === code)) return code;
  }
};

async function signUp(name, emoji) {
  const u = { name, token: secret(), seen: [] };
  const res = await call(u, 'POST', '/api/account', { name, emoji, timeZone: 'Europe/Paris' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  Object.assign(u, { profile: res.data.profile, id: res.data.profile.id, code: res.data.profile.friendCode });
  u.live = live(u.token);
  await u.live.opened;
  await u.live.next('hello');
  everyone.push(u);
  return u;
}

/** A phone with push reminders on, linked to the account so friends' notifications reach it. */
async function linkPhone(u) {
  const phone = { id: randomUUID().replace(/-/g, ''), token: secret(), ...newSubscription(`${u.name.toLowerCase()}-phone`) };
  const res = await api(`/api/devices/${phone.id}`, {
    method: 'PUT',
    token: phone.token,
    body: JSON.stringify({ subscription: phone.subscription, timeZone: 'Europe/Paris', reminders: [] }),
  });
  assert.equal(res.status, 200);
  assert.equal((await post(u, `/api/me/devices/${phone.id}`, { token: phone.token })).status, 200);
  u.phone = phone;
}

const befriend = async (a, b) => assert.equal((await post(a, '/api/friends', { code: b.code })).status, 201);

/** Lets events from earlier requests arrive, then forgets them. */
async function settle(people) {
  await sleep(300);
  for (const u of people) u.live.messages.length = 0;
}

/** Runs `action` and checks that none of `people` hears anything live because of it. */
async function silent(people, action) {
  await settle(people);
  const result = await action();
  await sleep(800);
  for (const u of people) assert.deepEqual(u.live.messages, [], `${u.name} should hear nothing, got ${JSON.stringify(u.live.messages)}`);
  return result;
}

const TABLES = ['users', 'sync_records', 'shared_habits', 'friendships', 'reactions', 'nudges', 'challenges', 'challenge_members', 'rate_limits', 'devices', 'reminders'];
/** Every row of every table, as one string. */
const databaseText = () => JSON.stringify(sqlAll(TABLES.map((t) => `SELECT * FROM ${t}`).join('; ')));

/** `promise`, or a failure after `ms` (so a missing event fails the check instead of hanging). */
const within = (promise, ms, what) =>
  Promise.race([promise, sleep(ms).then(() => Promise.reject(new Error(`timed out waiting for ${what}`)))]);

/** Hourly limits reset on the hour: don't start counting in the last seconds of one. */
async function avoidHourBoundary() {
  const left = 3_600_000 - (Date.now() % 3_600_000);
  if (left < 30_000) await sleep(left + 500);
}

/** A WebSocket handshake with these subprotocols: does the server let it in? */
const tryLive = (protocols) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.apiPort}/api/live`, protocols);
    ws.addEventListener('open', () => {
      ws.close();
      resolve('open');
    });
    ws.addEventListener('error', () => resolve('refused'));
    setTimeout(() => resolve('no answer'), 5000);
  });

let exitCode = 0;
try {
  let arun, bea, chen, dee, sam, gus;
  const ids = {}; // challenges

  section('Setup');
  await step('six people sign up, open the app (live connection) and link their phones', async () => {
    arun = await signUp('Arun', '🦊');
    bea = await signUp('Bea', '🐼');
    chen = await signUp('Chen', '🐯');
    dee = await signUp('Dee', '🦉');
    sam = await signUp('Sam', '🐙');
    gus = await signUp('Gus', '🦝');
    for (const u of [arun, bea, chen, sam]) await linkPhone(u);
  });

  // =====================================================================================
  section('1. The account key');

  await step('the server keeps only a hash of each auth secret, never the secret', async () => {
    const [row] = sql(`SELECT auth_hash FROM users WHERE id = '${arun.id}'`);
    assert.equal(row.auth_hash, createHash('sha256').update(arun.token).digest('hex'));
    const stored = databaseText();
    for (const u of everyone) assert.ok(!stored.includes(u.token), `${u.name}'s secret is stored`);
  });

  await step('every account route answers 401 without a valid key, and reveals nothing', async () => {
    const routes = [
      ['GET', '/api/me'], ['PATCH', '/api/me'], ['DELETE', '/api/me'], ['POST', '/api/me/friend-code'],
      ['POST', `/api/me/devices/${'a'.repeat(32)}`], ['GET', '/api/friends'], ['GET', `/api/friends/lookup/${bea.code}`],
      ['POST', '/api/friends'], ['DELETE', `/api/friends/${bea.id}`], ['PUT', '/api/share'], ['POST', '/api/nudges'],
      ['PUT', '/api/reactions'], ['GET', '/api/challenges'], ['POST', '/api/challenges'],
      ['POST', '/api/challenges/AAAAAAAAAAAA/join'], ['POST', '/api/challenges/AAAAAAAAAAAA/invite'],
      ['DELETE', '/api/challenges/AAAAAAAAAAAA/membership'], ['GET', '/api/sync'], ['POST', '/api/sync'],
    ];
    for (const [method, path] of routes) {
      for (const token of [undefined, secret(), 'not-a-key']) {
        const res = await api(path, { method, token, ...(method === 'GET' ? {} : { body: '{}' }) });
        assert.equal(res.status, 401, `${method} ${path}`);
        const body = await res.json();
        assert.deepEqual(Object.keys(body).filter((k) => k !== 'code'), ['error'], `${method} ${path}`);
      }
    }
    assert.equal((await get(bea, '/api/me')).status, 200, 'nothing was deleted');
    assert.equal((await feed(arun)).friends.length, 0);
  });

  await step('a live connection needs both the key and the app protocol', async () => {
    assert.equal(await tryLive(['tell-me.v1', `auth.${secret()}`]), 'refused');
    assert.equal(await tryLive([`auth.${arun.token}`]), 'refused');
    assert.equal(await tryLive(['tell-me.v1']), 'refused');
    assert.equal(await tryLive(['tell-me.v1', `auth.${arun.token}`]), 'open');
  });

  // =====================================================================================
  section('2. Invite links and friend codes');

  await step('an invite link shows a name and an avatar, nothing else', async () => {
    const res = await get(null, `/api/invite/${bea.code}`);
    assert.deepEqual(res.data, { name: 'Bea', emoji: '🐼' });
  });

  await step('looking up a code shows the same, not the account behind it', async () => {
    const res = await get(arun, `/api/friends/lookup/${bea.code.toLowerCase()}`);
    assert.deepEqual(res.data, { user: { name: 'Bea', emoji: '🐼' }, isSelf: false, isFriend: false });
  });

  await step("unknown and malformed codes don't reveal who exists", async () => {
    const unknown = randomCode();
    const viaInvite = await get(null, `/api/invite/${unknown}`);
    const viaLookup = await get(sam, `/api/friends/lookup/${unknown}`);
    const viaAdd = await post(sam, '/api/friends', { code: unknown });
    for (const r of [viaInvite, viaLookup, viaAdd]) {
      assert.equal(r.status, 404);
      assert.deepEqual(keysOf(r.data), ['error']);
    }
    for (const bad of ['short', 'IIIIIIII', '0O0O0O0O']) {
      const r = await get(null, `/api/invite/${bad}`);
      assert.equal(r.status, 400);
      assert.deepEqual(keysOf(r.data), ['error']);
    }
  });

  await step('friends are added with their code, both ways (and not with your own)', async () => {
    assert.equal((await post(arun, '/api/friends', { code: arun.code })).status, 400);
    await befriend(arun, bea);
    await befriend(chen, bea);
    await befriend(dee, arun);
    await befriend(dee, bea);
    const names = async (u) => (await feed(u)).friends.map((f) => f.name);
    assert.deepEqual(await names(arun), ['Bea', 'Dee']);
    assert.deepEqual(await names(bea), ['Arun', 'Chen', 'Dee']);
    assert.deepEqual(await names(chen), ['Bea']);
    assert.deepEqual(await names(dee), ['Arun', 'Bea']);
    assert.deepEqual(await names(sam), []);
  });

  await step('a new code makes old invite links useless, and keeps your friends', async () => {
    bea.oldCode = bea.code;
    const res = await post(bea, '/api/me/friend-code');
    bea.code = res.data.profile.friendCode;
    assert.notEqual(bea.code, bea.oldCode);
    assert.equal((await get(null, `/api/invite/${bea.oldCode}`)).status, 404);
    assert.equal((await get(sam, `/api/friends/lookup/${bea.oldCode}`)).status, 404);
    assert.equal((await post(sam, '/api/friends', { code: bea.oldCode })).status, 404);
    assert.equal((await get(null, `/api/invite/${bea.code}`)).status, 200);
    assert.ok((await feed(arun)).friends.some((f) => f.id === bea.id));
    assert.ok(!(await feed(sam)).friends.length);
  });

  // =====================================================================================
  section('3. What friends see');

  await step('people share some habits', async () => {
    for (const [u, habits] of [
      [bea, [habit('gym', 'Gym', '🏋️'), habit('read', 'Read', '📚')]],
      [arun, [habit('run', 'Run', '🏃')]],
      [chen, [habit('swim', 'Swim', '🏊')]],
      [dee, [habit('yoga', 'Yoga', '🧘')]],
    ]) {
      const res = await share(u, habits);
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.changed, true);
    }
  });

  await step('friends see only shared habits, with exactly the allowed fields', async () => {
    const f = await feed(arun);
    assert.deepEqual(keysOf(f), FEED);
    const b = f.friends.find((x) => x.id === bea.id);
    assert.deepEqual(b.habits.map((h) => h.id), ['gym', 'read']);
    for (const h of b.habits) assert.deepEqual(keysOf(h), FRIEND_HABIT);
  });

  await step("a friend's entry has a name, an avatar, last active (to 15 minutes) and habits, nothing else", async () => {
    const f = await feed(arun);
    for (const friend of f.friends) {
      assert.deepEqual(keysOf(friend), FRIEND);
      assert.equal(friend.lastSeenAt % (15 * 60_000), 0);
      assert.ok(Date.now() - friend.lastSeenAt < 16 * 60_000);
    }
    const text = JSON.stringify(f.friends);
    for (const other of [bea, dee]) {
      assert.ok(!text.includes(other.code), "a friend's code");
      assert.ok(!text.includes('Europe/Paris'), "a friend's time zone");
    }
  });

  await step('anything extra in a snapshot (notes, reasons) is dropped, never stored or shown', async () => {
    const res = await put(bea, '/api/share', {
      timeZone: 'Europe/Paris',
      date: today,
      weekStart,
      note: 'hangover',
      habits: [{ ...habit('gym', 'Gym', '🏋️'), reason: 'felt awful', note: 'hangover', private: 'Therapy' }, habit('read', 'Read', '📚')],
    });
    assert.equal(res.status, 200);
    const stored = JSON.stringify(sql(`SELECT * FROM shared_habits WHERE user_id = '${bea.id}'`));
    for (const t of TRAPS) assert.ok(!stored.includes(t), t);
    const seen = JSON.stringify([await feed(arun), await feed(chen)]);
    for (const t of TRAPS) assert.ok(!seen.includes(t), t);
  });

  await step("a friend's friend sees their mutual friend, and nothing of the other person", async () => {
    const f = await feed(chen);
    assert.deepEqual(f.friends.map((x) => x.name), ['Bea']);
    const text = JSON.stringify(f);
    assert.ok(!text.includes(arun.id) && !text.includes('Arun') && !text.includes('"run"'));
  });

  await step("one person's habits can't overwrite another's, even with the same id", async () => {
    await share(arun, [habit('run', 'Run', '🏃'), habit('gym', 'Boxing', '🥊')]);
    const forChen = (await feed(chen)).friends.find((x) => x.id === bea.id);
    assert.deepEqual(forChen.habits.map((h) => [h.id, h.name]), [['gym', 'Gym'], ['read', 'Read']]);
    const forBea = await feed(bea);
    assert.deepEqual(forBea.me.habits.map((h) => h.name), ['Gym', 'Read']);
    assert.deepEqual(forBea.friends.find((x) => x.id === arun.id).habits.map((h) => h.name), ['Run', 'Boxing']);
    await share(arun, [habit('run', 'Run', '🏃')]);
  });

  await step('a habit that stops being shared disappears for friends at once', async () => {
    await share(bea, [habit('gym', 'Gym', '🏋️')]);
    const b = (await feed(arun)).friends.find((x) => x.id === bea.id);
    assert.deepEqual(b.habits.map((h) => h.id), ['gym']);
    assert.equal((await post(arun, '/api/nudges', { to: bea.id, habitId: 'read' })).status, 404);
    assert.equal((await put(arun, '/api/reactions', { to: bea.id, habitId: 'read', date: today, emoji: '🔥' })).status, 404);
  });

  await step('sharing nothing shows nothing', async () => {
    await share(bea, []);
    const b = (await feed(dee)).friends.find((x) => x.id === bea.id);
    assert.deepEqual([b.habits, b.week], [[], { yes: 0, due: 0 }]);
    await share(bea, [habit('gym', 'Gym', '🏋️'), habit('read', 'Read', '📚')]);
  });

  // =====================================================================================
  section('4. Live updates');

  const beaAfterGym = [habit('gym', 'Gym', '🏋️', 'Y'), habit('read', 'Read', '📚')];

  await step('a check-in reaches friends instantly, and only friends', async () => {
    await settle(everyone);
    await share(bea, beaAfterGym, { habitId: 'gym', answer: 'yes' });
    for (const u of [arun, chen, dee]) {
      const e = await u.live.next('checkin');
      assert.deepEqual([e.from.name, e.habit.name, e.answer], ['Bea', 'Gym', 'yes']);
    }
    await sleep(600);
    assert.deepEqual([sam.live.messages, gus.live.messages], [[], []]);
  });

  await step('re-sending the same snapshot tells nobody anything (even with an answer to a habit that isn\'t shared)', async () => {
    await silent(everyone, async () => {
      const res = await share(bea, beaAfterGym, { habitId: 'diary', answer: 'no' });
      assert.equal(res.data.changed, false);
    });
  });

  await step("a new time zone with nothing new to see doesn't tell friends you opened the app", async () => {
    for (const tz of ['Europe/Berlin', 'Europe/Paris']) {
      await silent([arun, chen, dee, sam, gus], async () => {
        const res = await share(bea, beaAfterGym, undefined, tz);
        assert.equal(res.data.changed, true);
      });
    }
  });

  await step('a change friends can see reaches each of them once', async () => {
    await settle(everyone);
    await share(bea, [habit('gym', 'Gym 💪', '🏋️', 'Y'), habit('read', 'Read', '📚')]);
    for (const u of [arun, chen, dee]) await u.live.next('friends');
    await sleep(600);
    for (const u of [arun, chen, dee, sam]) assert.deepEqual(u.live.messages, [], u.name);
    await share(bea, beaAfterGym);
    for (const u of [arun, chen, dee]) await u.live.next('friends');
  });

  // =====================================================================================
  section('5. Reactions and nudges');

  await step("only friends can nudge or react, and others can't tell whether someone exists", async () => {
    // Sam is a stranger to Bea; Chen is a friend of Arun's friend, but not his.
    for (const [asker, target] of [[sam, bea], [chen, arun]]) {
      for (const ask of [
        (to) => post(asker, '/api/nudges', { to, habitId: 'read' }),
        (to) => put(asker, '/api/reactions', { to, habitId: 'gym', date: today, emoji: '🔥' }),
      ]) {
        const real = await ask(target.id);
        const nobody = await ask(randomUserId());
        assert.equal(real.status, 403);
        assert.deepEqual(real, nobody);
      }
    }
  });

  await step('a reaction or a nudge is seen only by the two people involved', async () => {
    await silent([chen, dee, sam, gus], async () => {
      assert.equal((await post(arun, '/api/nudges', { to: bea.id, habitId: 'read' })).status, 201);
      assert.equal((await put(arun, '/api/reactions', { to: bea.id, habitId: 'gym', date: today, emoji: '🔥' })).status, 200);
    });
    await bea.live.next('nudge');
    await bea.live.next('reaction');
    for (const u of [arun, bea]) {
      const f = await feed(u);
      assert.deepEqual(f.reactions.map((r) => [r.from, r.to, r.emoji]), [[arun.id, bea.id, '🔥']]);
      assert.deepEqual(f.nudges.map((n) => [n.from, n.to, n.habitId]), [[arun.id, bea.id, 'read']]);
      for (const r of f.reactions) assert.deepEqual(keysOf(r), REACTION);
      for (const n of f.nudges) assert.deepEqual(keysOf(n), NUDGE);
    }
    // Dee is friends with both of them, and still sees none of it.
    for (const u of [chen, dee]) assert.deepEqual([(await feed(u)).reactions, (await feed(u)).nudges], [[], []], u.name);
  });

  await step('notifications carry only what the person receiving them can already see', async () => {
    await waitFor(() => pushesTo(bea).some((p) => p.title.includes('nudged')) && pushesTo(bea).some((p) => p.title.includes('reacted')), 'pushes');
    for (const p of pushesTo(bea)) {
      assert.deepEqual(keysOf(p), SOCIAL_PUSH);
      assert.equal(p.type, 'social');
      assert.match(p.path, /^#\//);
    }
    const nudge = pushesTo(bea).find((p) => p.title.includes('nudged'));
    assert.deepEqual([nudge.title, nudge.body], ['🦊 Arun nudged you', '📚 Read: did you show up today?']);
    const reaction = pushesTo(bea).find((p) => p.title.includes('reacted'));
    assert.deepEqual([reaction.title, reaction.body], ['🦊 Arun reacted 🔥', 'to your 🏋️ Gym']);
    assert.deepEqual(pushesTo(sam), []);
    assert.ok(!pushesTo(chen).some((p) => JSON.stringify(p).includes('Arun')));
  });

  await step("push services can't see who is interacting with whom", async () => {
    const social = received.filter((r) => r.payload.type === 'social');
    assert.ok(social.length >= 5);
    for (const r of social) {
      assert.equal(r.headers.topic, undefined);
      const { authorization: _vapid, ...plain } = r.headers; // the VAPID signature is random-looking base64
      for (const u of everyone) {
        assert.ok(!JSON.stringify(r.headers).includes(u.id));
        assert.ok(!JSON.stringify(plain).includes(u.name));
      }
    }
  });

  // =====================================================================================
  section('6. Strangers');

  await step('someone who knows nobody sees nobody', async () => {
    const f = await feed(sam);
    assert.deepEqual([f.friends, f.reactions, f.nudges], [[], [], []]);
    assert.deepEqual(await challengesOf(sam), []);
  });

  await step("a stranger can't remove other people's friendships, or poke anyone by trying", async () => {
    await silent([arun, bea, chen, dee], async () => {
      assert.equal((await del(sam, `/api/friends/${bea.id}`)).status, 200);
      assert.equal((await del(sam, `/api/friends/${randomUserId()}`)).status, 200);
    });
    assert.ok((await feed(arun)).friends.some((f) => f.id === bea.id));
    assert.ok((await feed(bea)).friends.some((f) => f.id === arun.id));
  });

  await step("a stranger can't read or overwrite someone else's synced data", async () => {
    const id = b64url(randomBytes(16));
    const x = b64url(randomBytes(48));
    assert.equal((await post(arun, '/api/sync', { records: [{ k: 'h', id, u: 100, d: 0, x }] })).data.applied, 1);
    const theirs = b64url(randomBytes(48));
    assert.equal((await post(sam, '/api/sync', { records: [{ k: 'h', id, u: 999, d: 0, x: theirs }] })).data.applied, 1);
    const mine = (await get(arun, '/api/sync?since=0')).data.records.find((r) => r.id === id);
    assert.deepEqual([mine.u, mine.x], [100, x]);
    assert.deepEqual((await get(sam, '/api/sync?since=0')).data.records.map((r) => r.x), [theirs]);
  });

  // =====================================================================================
  section('7. Challenges');

  await step('only the organiser invites, and only their own friends', async () => {
    const start = (invite) => post(bea, '/api/challenges', { name: 'Gym 3×', emoji: '🏋️', target: 3, habitId: 'gym', invite });
    assert.equal((await start([arun.id, chen.id, sam.id])).status, 403);
    assert.equal((await start([arun.id, chen.id, randomUserId()])).status, 403);
    const res = await start([arun.id, chen.id]);
    assert.equal(res.status, 201);
    ids.X = res.data.id;
    assert.equal((await post(arun, `/api/challenges/${ids.X}/join`, { habitId: 'run' })).status, 200);
    assert.equal((await post(arun, `/api/challenges/${ids.X}/invite`, { friendIds: [dee.id] })).status, 403);
    assert.equal((await post(bea, `/api/challenges/${ids.X}/invite`, { friendIds: [sam.id] })).status, 403);
  });

  await step("people who were invited but haven't joined are shown only to the organiser", async () => {
    const forBea = await challenge(bea, ids.X);
    assert.deepEqual(forBea.members.map((m) => [m.name, m.status]).sort(), [['Arun', 'member'], ['Bea', 'member'], ['Chen', 'invited']]);
    const forArun = await challenge(arun, ids.X);
    assert.deepEqual(forArun.members.map((m) => m.name).sort(), ['Arun', 'Bea']);
    assert.ok(!JSON.stringify(forArun).includes(chen.id));
  });

  await step("until you join, you see who's in a challenge, not how they're doing", async () => {
    const forChen = await challenge(chen, ids.X);
    assert.deepEqual(keysOf(forChen), CHALLENGE);
    assert.equal(forChen.me.status, 'invited');
    for (const m of forChen.members.filter((m) => m.userId !== chen.id)) assert.deepEqual([m.habit, m.yes, m.done], [null, 0, false], m.name);
    assert.ok(!JSON.stringify(forChen).includes('Run'));
  });

  await step("members who aren't friends see each other's challenge habit, and nothing else", async () => {
    assert.equal((await post(chen, `/api/challenges/${ids.X}/join`, { habitId: 'swim' })).status, 200);
    const arunForChen = (await challenge(chen, ids.X)).members.find((m) => m.userId === arun.id);
    assert.deepEqual(keysOf(arunForChen), MEMBER);
    assert.deepEqual(keysOf(arunForChen.habit), MEMBER_HABIT);
    assert.equal(arunForChen.habit.name, 'Run');
    assert.ok(!(await feed(chen)).friends.some((f) => f.id === arun.id));
    assert.equal((await post(chen, '/api/nudges', { to: arun.id, habitId: 'run' })).status, 403);
  });

  await step("a stranger can't see, join, invite to or leave someone else's challenge", async () => {
    assert.deepEqual(await challengesOf(sam), []);
    assert.equal((await post(sam, `/api/challenges/${ids.X}/join`, { habitId: 'gym' })).status, 404);
    assert.equal((await post(sam, `/api/challenges/${ids.X}/invite`, { friendIds: [bea.id] })).status, 404);
    await silent([arun, bea, chen], async () => assert.equal((await del(sam, `/api/challenges/${ids.X}/membership`)).status, 200));
    assert.equal((await challenge(bea, ids.X)).members.length, 3);
  });

  await step('leaving a challenge takes your progress with you', async () => {
    assert.equal((await del(chen, `/api/challenges/${ids.X}/membership`)).status, 200);
    assert.ok(!(await challenge(arun, ids.X)).members.some((m) => m.userId === chen.id));
    assert.equal(await challenge(chen, ids.X), undefined);
  });

  await step('a habit that stops being shared stops showing in challenges too', async () => {
    await share(arun, []);
    const arunForBea = (await challenge(bea, ids.X)).members.find((m) => m.userId === arun.id);
    assert.deepEqual([arunForBea.habit, arunForBea.yes], [null, 0]);
    await share(arun, [habit('run', 'Run', '🏃')]);
  });

  await step('more challenges: Dee starts one with both of them, and a few invites wait for an answer', async () => {
    const start = async (u, body) => {
      const res = await post(u, '/api/challenges', body);
      assert.equal(res.status, 201, JSON.stringify(res.data));
      return res.data.id;
    };
    ids.Z = await start(dee, { name: 'Yoga week', emoji: '🧘', target: 3, habitId: 'yoga', invite: [arun.id, bea.id] });
    assert.equal((await post(arun, `/api/challenges/${ids.Z}/join`, { habitId: 'run' })).status, 200);
    assert.equal((await post(bea, `/api/challenges/${ids.Z}/join`, { habitId: 'gym' })).status, 200);
    ids.Y = await start(arun, { name: 'Run club', emoji: '🏃', target: 2, habitId: 'run', invite: [bea.id] });
    ids.V = await start(dee, { name: 'Plank', emoji: '💪', target: 5, habitId: 'yoga', invite: [bea.id] });
    ids.W = await start(dee, { name: 'Stretch', emoji: '🤸', target: 4, habitId: 'yoga', invite: [arun.id] });
  });

  // =====================================================================================
  section('8. Removing a friend');

  await step('removing a friend cuts both ways at once, reactions and nudges included', async () => {
    await settle([arun, bea]);
    assert.equal((await del(arun, `/api/friends/${bea.id}`)).status, 200);
    await bea.live.next('friends');
    assert.ok(!(await feed(arun)).friends.some((f) => f.id === bea.id));
    const f = await feed(bea);
    assert.ok(!f.friends.some((x) => x.id === arun.id));
    assert.deepEqual([f.reactions, f.nudges], [[], []]);
    const between = `(from_id = '${arun.id}' AND to_id = '${bea.id}') OR (from_id = '${bea.id}' AND to_id = '${arun.id}')`;
    assert.equal(sql(`SELECT COUNT(*) AS n FROM reactions WHERE ${between}`)[0].n, 0);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM nudges WHERE ${between}`)[0].n, 0);
  });

  await step("afterwards neither can nudge or react, and check-ins don't reach the other", async () => {
    assert.equal((await post(bea, '/api/nudges', { to: arun.id, habitId: 'run' })).status, 403);
    assert.equal((await put(arun, '/api/reactions', { to: bea.id, habitId: 'gym', date: today, emoji: '👏' })).status, 403);
    await settle(everyone);
    await share(bea, [habit('gym', 'Gym', '🏋️', 'Y'), habit('read', 'Read', '📚', 'Y')], { habitId: 'read', answer: 'yes' });
    assert.equal((await chen.live.next('checkin')).habit.name, 'Read');
    await sleep(600);
    assert.ok(!arun.live.messages.some((e) => e.t === 'checkin' || e.t === 'friends'));
  });

  await step('each leaves the challenges the other started; one a friend of both started stays', async () => {
    assert.equal(await challenge(arun, ids.X), undefined, "Arun left Bea's challenge");
    assert.deepEqual((await challenge(bea, ids.X)).members.map((m) => m.name), ['Bea']);
    assert.equal(await challenge(bea, ids.Y), undefined, "Bea's invite to Arun's challenge is gone");
    assert.deepEqual((await challenge(arun, ids.Y)).members.map((m) => m.name), ['Arun']);
    const z = await challenge(arun, ids.Z);
    assert.deepEqual(z.members.map((m) => m.name).sort(), ['Arun', 'Bea', 'Dee']);
  });

  await step("an old invite only works while you're still friends with the organiser", async () => {
    // Their friendship ends behind the app's back (say, a removal that raced the join).
    sql(`DELETE FROM friendships WHERE (user_id = '${arun.id}' AND friend_id = '${dee.id}') OR (user_id = '${dee.id}' AND friend_id = '${arun.id}')`);
    assert.equal((await post(arun, `/api/challenges/${ids.W}/join`, { habitId: 'run' })).status, 404);
    assert.equal(await challenge(arun, ids.W), undefined);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM challenge_members WHERE challenge_id = '${ids.W}' AND user_id = '${arun.id}'`)[0].n, 0);
    await befriend(arun, dee); // and they make up
  });

  await step("removing someone who isn't your friend changes nothing and tells them nothing", async () => {
    await silent([bea], async () => assert.equal((await del(arun, `/api/friends/${bea.id}`)).status, 200));
  });

  // =====================================================================================
  section('9. Phones');

  await step("linking a phone to an account needs that phone's own token", async () => {
    assert.equal((await post(sam, `/api/me/devices/${bea.phone.id}`, { token: secret() })).status, 403);
    assert.equal(sql(`SELECT user_id FROM devices WHERE id = '${bea.phone.id}'`)[0].user_id, bea.id);
  });

  await step("a phone nobody is signed in on stops getting friends' notifications", async () => {
    // Chen signed out while offline; the phone tells the server when it's back online.
    const res = await api(`/api/devices/${chen.phone.id}`, {
      method: 'PUT',
      token: chen.phone.token,
      body: JSON.stringify({ subscription: chen.phone.subscription, timeZone: 'Europe/Paris', reminders: [], signedIn: false }),
    });
    assert.equal(res.status, 200);
    assert.equal(sql(`SELECT user_id FROM devices WHERE id = '${chen.phone.id}'`)[0].user_id, null);
    const before = pushesTo(chen).length;
    assert.equal((await put(bea, '/api/reactions', { to: chen.id, habitId: 'swim', date: today, emoji: '👏' })).status, 200);
    await chen.live.next('reaction'); // the open app still hears it…
    await sleep(800);
    assert.equal(pushesTo(chen).length, before); // …but the phone gets no notification
  });

  // =====================================================================================
  section('10. Deleting an account');

  await step("deleting an account closes the account's live connections", async () => {
    await settle(everyone);
    assert.equal((await del(dee, '/api/me')).status, 200);
    await dee.live.next('gone'); // the open app is told at once…
    assert.equal((await within(dee.live.closed, 20_000, 'the server to close the connection')).code, 4001); // …then it's closed
  });

  await step('friends and challenge members stop seeing it at once; its challenge carries on without it', async () => {
    for (const u of [arun, bea]) {
      await u.live.next('friends');
      await u.live.next('challenges');
      assert.ok(!(await feed(u)).friends.some((f) => f.id === dee.id), u.name);
    }
    const z = await challenge(arun, ids.Z);
    assert.equal(z.ownerId, '');
    assert.deepEqual(z.members.map((m) => m.name).sort(), ['Arun', 'Bea']);
  });

  await step('invites it sent that nobody accepted disappear', async () => {
    assert.equal(await challenge(bea, ids.V), undefined);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM challenges WHERE id IN ('${ids.V}', '${ids.W}')`)[0].n, 0);
  });

  await step("the deleted account's id appears nowhere in the database", async () => {
    assert.ok(!databaseText().includes(dee.id));
  });

  await step('its key, invite link and code stop working, and signing up again starts from nothing', async () => {
    assert.equal((await get(dee, '/api/me')).status, 401);
    assert.equal((await get(null, `/api/invite/${dee.code}`)).status, 404);
    assert.equal((await post(arun, '/api/friends', { code: dee.code })).status, 404);
    assert.equal(await tryLive(['tell-me.v1', `auth.${dee.token}`]), 'refused');
    const again = await post(dee, '/api/account', { name: 'Dee', emoji: '🦉', timeZone: 'Europe/Paris' });
    assert.equal(again.status, 201);
    assert.notEqual(again.data.profile.id, dee.id);
    const fresh = { ...dee, token: dee.token };
    assert.deepEqual((await feed(fresh)).friends, []);
    assert.deepEqual(await challengesOf(fresh), []);
    assert.deepEqual((await get(fresh, '/api/sync?since=0')).data.records, []);
  });

  // =====================================================================================
  section('11. Guessing friend codes');

  await step('one account can only try a few codes an hour (even a right one is refused after that)', async () => {
    await avoidHourBoundary();
    for (let i = 0; i < 30; i++) assert.equal((await get(gus, `/api/friends/lookup/${randomCode()}`)).status, 404);
    const right = await get(gus, `/api/friends/lookup/${bea.code}`);
    assert.equal(right.status, 429);
    assert.ok(!JSON.stringify(right.data).includes('Bea'));
    assert.equal((await post(gus, '/api/friends', { code: bea.code })).status, 429);
    assert.ok(!(await feed(bea)).friends.some((f) => f.name === 'Gus'));
  });

  await step('one network can only open so many invite links an hour', async () => {
    const from = (ip) => ({ 'CF-Connecting-IP': ip });
    await avoidHourBoundary();
    for (let i = 0; i < 60; i++) assert.equal((await get(null, `/api/invite/${randomCode()}`, from('203.0.113.9'))).status, 404);
    const right = await get(null, `/api/invite/${bea.code}`, from('203.0.113.9'));
    assert.equal(right.status, 429);
    assert.ok(!JSON.stringify(right.data).includes('Bea'));
    assert.equal((await get(null, `/api/invite/${bea.code}`, from('203.0.113.10'))).status, 200);
  });

  // =====================================================================================
  section('12. Everything everyone received');

  /** Every response body, live event and notification `u` received (not what they asked for). */
  const everythingSeenBy = (u) => JSON.stringify([u.seen.map((r) => r.data), u.live.log, pushesTo(u)]);

  await step('someone who knows nobody never received anything about anyone', async () => {
    const saw = everythingSeenBy(sam);
    for (const u of [arun, bea, chen, dee, gus]) {
      assert.ok(!saw.includes(u.id), u.name);
      assert.ok(!saw.includes(`"${u.name}"`) && !saw.includes(` ${u.name} `), u.name);
    }
    assert.deepEqual([...new Set(sam.live.log.map((e) => e.t))].sort(), ['hello', 'sync']);
  });

  await step("nobody ever received someone else's key, friend code, or the notes nobody shares", async () => {
    for (const u of everyone) {
      const saw = everythingSeenBy(u);
      for (const other of everyone.filter((o) => o !== u)) {
        assert.ok(!saw.includes(other.token), `${u.name} got ${other.name}'s key`);
        for (const code of [other.code, other.oldCode].filter(Boolean)) assert.ok(!saw.includes(code), `${u.name} got ${other.name}'s code`);
      }
      for (const t of TRAPS) assert.ok(!saw.includes(t), `${u.name} got "${t}"`);
    }
    for (const t of TRAPS) assert.ok(!databaseText().includes(t), `"${t}" is stored`);
  });

  await step('Chen never learned anything about Arun outside the challenge they were both in', async () => {
    const outside = JSON.stringify([chen.seen.filter((r) => r.path !== '/api/challenges').map((r) => r.data), chen.live.log, pushesTo(chen)]);
    assert.ok(!outside.includes(arun.id) && !outside.includes('Arun'));
  });

  await step('live events only ever came from friends, with only the fields each kind allows', async () => {
    const friendsEver = { Arun: ['Bea', 'Dee'], Bea: ['Arun', 'Chen', 'Dee'], Chen: ['Bea'], Dee: ['Arun', 'Bea'], Sam: [], Gus: [] };
    for (const u of everyone) {
      for (const e of u.live.log) {
        assert.deepEqual(keysOf(e), LIVE_EVENT[e.t], `${u.name}: ${JSON.stringify(e)}`);
        if (typeof e.from === 'object') {
          assert.deepEqual(keysOf(e.from), ['emoji', 'id', 'name']);
          assert.ok(friendsEver[u.name].includes(e.from.name), `${u.name} heard from ${e.from.name}`);
        }
        if (e.habit) assert.deepEqual(keysOf(e.habit), ['emoji', 'id', 'name']);
      }
    }
  });

  for (const u of everyone) u.live.ws.close();
  if (checks.failed.length) throw new Error(`${checks.failed.length} failed: ${checks.failed.join('; ')}`);
  console.log(`\nPrivacy tests passed: ${checks.passed} checks.`);
} catch (err) {
  exitCode = 1;
  console.error('\nPrivacy tests FAILED:', err);
  console.error('\n--- wrangler dev output ---\n' + server.devLog().slice(-4000));
} finally {
  server.stop();
  setTimeout(() => process.exit(exitCode), 300);
}

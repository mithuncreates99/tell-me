#!/usr/bin/env node
/**
 * End-to-end test of the worker running locally (wrangler dev + local D1) against a mock push
 * service. The mock decrypts every push with the subscription's private key and verifies the
 * VAPID signature, exactly like a browser + push service would.
 *
 *   npm run test:integration
 */
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { b64url, checklist, secret, startLocalServer } from './harness.mjs';

const server = await startLocalServer({ apiPort: 8799, pushPort: 8798 });
const { api, authed, json, live, sql, tick, received, newSubscription, markGone, waitFor, vapidPublic } = server;
const checks = checklist();
const step = checks.step;

let exitCode = 0;
try {
  const deviceId = randomUUID().replace(/-/g, '');
  const token = b64url(randomBytes(32));
  const { path, subscription } = newSubscription('phone');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();

  await step('health + config expose the public VAPID key', async () => {
    assert.equal((await api('/api/health')).status, 200);
    const cfg = await (await api('/api/config')).json();
    assert.equal(cfg.vapidPublicKey, vapidPublic);
  });

  await step('PUT /api/devices/:id stores the subscription and schedules reminders', async () => {
    const res = await api(`/api/devices/${deviceId}`, {
      method: 'PUT',
      token,
      body: JSON.stringify({
        subscription,
        timeZone: 'Europe/Paris',
        reminders: [
          { id: 'gym', kind: 'checkin', title: 'Gym', emoji: '🏋️', days: [1, 3, 5], time: '18:00', offsetMin: 60 },
          { id: 'weekly-report', kind: 'weekly', title: 'Weekly report', days: [0], time: '19:00' },
        ],
      }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json();
    assert.equal(body.reminders.length, 2);
    assert.ok(Date.parse(body.reminders[0].nextFireAt) > Date.now());
    const rows = sql(`SELECT id, next_fire_at FROM reminders WHERE device_id = '${deviceId}' ORDER BY id`);
    assert.equal(rows.length, 2);
  });

  await step('a different token cannot overwrite or read the device', async () => {
    const other = b64url(randomBytes(32));
    const res = await api(`/api/devices/${deviceId}`, {
      method: 'PUT',
      token: other,
      body: JSON.stringify({ subscription, timeZone: 'Europe/Paris', reminders: [] }),
    });
    assert.equal(res.status, 403);
    assert.equal((await api(`/api/devices/${deviceId}/test`, { method: 'POST', token: other })).status, 403);
    assert.equal((await api(`/api/devices/${deviceId}/test`, { method: 'POST' })).status, 401);
  });

  await step('invalid payloads are rejected with 400', async () => {
    const res = await api(`/api/devices/${deviceId}`, {
      method: 'PUT',
      token,
      body: JSON.stringify({ subscription, timeZone: 'Not/AZone', reminders: [] }),
    });
    assert.equal(res.status, 400);
  });

  await step('cron tick sends a due "Did you go?" push the browser can decrypt', async () => {
    sql(`UPDATE reminders SET next_fire_at = ${Date.now() - 5_000}, next_date = '${today}' WHERE device_id = '${deviceId}' AND id = 'gym'`);
    received.length = 0;
    assert.equal((await tick()).status, 200);
    await waitFor(() => received.length === 1, 'check-in push');
    const [push] = received;
    assert.equal(push.path, path);
    assert.deepEqual(push.payload, { type: 'checkin', habitId: 'gym', date: today, title: 'Gym', emoji: '🏋️', time: '18:00' });
    assert.equal(push.headers.urgency, 'high');
    assert.equal(push.headers.topic, 'h-gym');
    const [row] = sql(`SELECT next_fire_at, next_date FROM reminders WHERE device_id = '${deviceId}' AND id = 'gym'`);
    assert.ok(row.next_fire_at > Date.now(), 'next push rescheduled into the future');
    assert.notEqual(row.next_date, today);
    const [dev] = sql(`SELECT last_push_at, failures FROM devices WHERE id = '${deviceId}'`);
    assert.ok(dev.last_push_at > 0);
  });

  await step('a second tick does not resend', async () => {
    received.length = 0;
    await tick();
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(received.length, 0);
  });

  await step('weekly report push', async () => {
    sql(`UPDATE reminders SET next_fire_at = ${Date.now() - 1_000}, next_date = '${today}' WHERE device_id = '${deviceId}' AND id = 'weekly-report'`);
    received.length = 0;
    await tick();
    await waitFor(() => received.length === 1, 'weekly push');
    assert.deepEqual(received[0].payload, { type: 'weekly', date: today });
  });

  await step('stale reminders (hours late) are skipped, not sent', async () => {
    sql(`UPDATE reminders SET next_fire_at = ${Date.now() - 5 * 3600_000} WHERE device_id = '${deviceId}' AND id = 'gym'`);
    received.length = 0;
    await tick();
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(received.length, 0);
    const [row] = sql(`SELECT next_fire_at FROM reminders WHERE device_id = '${deviceId}' AND id = 'gym'`);
    assert.ok(row.next_fire_at > Date.now());
  });

  await step('skipDates: answering early cancels today\'s push', async () => {
    const res = await api(`/api/devices/${deviceId}`, {
      method: 'PUT',
      token,
      body: JSON.stringify({
        subscription,
        timeZone: 'Europe/Paris',
        reminders: [{ id: 'daily', kind: 'checkin', title: 'Read', emoji: '📚', days: [0, 1, 2, 3, 4, 5, 6], time: '23:59', offsetMin: 0, skipDates: [today] }],
      }),
    });
    const body = await res.json();
    assert.notEqual(body.reminders[0].nextDate, today);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM reminders WHERE device_id = '${deviceId}'`)[0].n, 1, 'old reminders replaced');
  });

  await step('POST /test sends a test notification', async () => {
    received.length = 0;
    const res = await api(`/api/devices/${deviceId}/test`, { method: 'POST', token });
    assert.equal(res.status, 200);
    await waitFor(() => received.length === 1, 'test push');
    assert.deepEqual(received[0].payload, { type: 'test' });
  });

  await step('expired subscriptions (410) are deleted automatically', async () => {
    const goneId = randomUUID().replace(/-/g, '');
    const goneToken = b64url(randomBytes(32));
    const gone = newSubscription('old-phone');
    await api(`/api/devices/${goneId}`, {
      method: 'PUT',
      token: goneToken,
      body: JSON.stringify({
        subscription: gone.subscription,
        timeZone: 'Asia/Kolkata',
        reminders: [{ id: 'run', kind: 'checkin', title: 'Run', emoji: '🏃', days: [weekday], time: '07:00' }],
      }),
    });
    markGone(gone.path);
    sql(`UPDATE reminders SET next_fire_at = ${Date.now() - 1_000} WHERE device_id = '${goneId}'`);
    await tick();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(sql(`SELECT COUNT(*) AS n FROM devices WHERE id = '${goneId}'`)[0].n, 0);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM reminders WHERE device_id = '${goneId}'`)[0].n, 0);
  });

  await step('DELETE /api/devices/:id forgets the device', async () => {
    assert.equal((await api(`/api/devices/${deviceId}`, { method: 'DELETE', token })).status, 200);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM devices WHERE id = '${deviceId}'`)[0].n, 0);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM reminders WHERE device_id = '${deviceId}'`)[0].n, 0);
  });


  // ======================= accounts, sync, friends, live =======================
  const parisToday = today;
  const weekStart = (() => {
    const d = new Date(`${parisToday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  const todayIdx = (weekday + 6) % 7; // Monday-first index of today
  const weekWith = (todayChar) => Array.from({ length: 7 }, (_, i) => (i < todayIdx ? 'Y' : i === todayIdx ? todayChar : 'F')).join('');
  const habit = (id, name, emoji, todayChar, extra = {}) => ({
    id, name, emoji, color: 'blue', days: [0, 1, 2, 3, 4, 5, 6], time: null, askMin: 0, week: weekWith(todayChar), streak: todayIdx, best: 9, ...extra,
  });

  const A = { token: secret() };
  const B = { token: secret() };

  await step('accounts: create (idempotent), read, reject unknown keys', async () => {
    let res = await authed('/api/account', A.token, { method: 'POST', body: JSON.stringify({ name: 'Arun', emoji: '🦊', timeZone: 'Europe/Paris' }) });
    assert.equal(res.status, 201);
    A.profile = (await json(res)).profile;
    assert.match(A.profile.friendCode, /^[A-Z2-9]{8}$/);
    res = await authed('/api/account', A.token, { method: 'POST', body: JSON.stringify({ name: 'Arun', emoji: '🦊' }) });
    assert.equal(res.status, 200);
    assert.equal((await json(res)).profile.id, A.profile.id);
    res = await authed('/api/account', B.token, { method: 'POST', body: JSON.stringify({ name: 'Bea', emoji: '🐼', timeZone: 'Europe/Paris' }) });
    B.profile = (await json(res)).profile;
    assert.equal((await json(await authed('/api/me', B.token))).profile.name, 'Bea');
    assert.equal((await authed('/api/me', secret())).status, 401);
    assert.equal((await api('/api/me')).status, 401);
    res = await authed('/api/me', A.token, { method: 'PATCH', body: JSON.stringify({ name: 'Arun K' }) });
    assert.equal((await json(res)).profile.name, 'Arun K');
  });

  await step('live: a WebSocket per account; bad credentials are refused', async () => {
    A.live = live(A.token);
    A.live2 = live(A.token); // a second device of Arun
    B.live = live(B.token);
    await Promise.all([A.live.opened, A.live2.opened, B.live.opened]);
    await A.live.next('hello');
    const bad = live(secret());
    await assert.rejects(bad.opened);
  });

  const rec = (k, id, u, x, d = 0) => ({ k, id, u, d, x });
  const opaque = (n) => b64url(randomBytes(16)) + n;

  await step('sync: encrypted records, last writer wins, per-account sequence', async () => {
    const h = opaque('h');
    const c = opaque('c');
    let res = await authed('/api/sync', A.token, { method: 'POST', body: JSON.stringify({ records: [rec('h', h, 100, b64url(randomBytes(40))), rec('c', c, 100, b64url(randomBytes(40)))] }) });
    let body = await json(res);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual([body.seq, body.applied], [2, 2]);
    const evt = await A.live2.next('sync'); // the other device hears about it instantly
    assert.equal(evt.seq, 2);
    body = await json(await authed('/api/sync', A.token, { method: 'POST', body: JSON.stringify({ records: [rec('h', h, 50, 'b'.repeat(40))] }) }));
    assert.equal(body.applied, 0, 'older write ignored');
    body = await json(await authed('/api/sync', A.token, { method: 'POST', body: JSON.stringify({ records: [rec('h', h, 200, 'n'.repeat(40), 1)] }) }));
    assert.deepEqual([body.seq, body.applied], [4, 1]);
    let pull = await json(await authed('/api/sync?since=0', A.token));
    assert.deepEqual(pull.records.map((r) => [r.k, r.s, r.u, r.d]), [['c', 2, 100, 0], ['h', 4, 200, 1]]);
    assert.equal(pull.seq, 4);
    pull = await json(await authed('/api/sync?since=2', A.token));
    assert.equal(pull.records.length, 1);
    assert.equal((await json(await authed('/api/sync?since=0', B.token))).records.length, 0, 'accounts are isolated');
    assert.equal((await authed('/api/sync', A.token, { method: 'POST', body: JSON.stringify({ records: [rec('x', h, 1, 'a'.repeat(40))] }) })).status, 400);
  });

  await step('friends: look up a code, add (mutual), reject own and unknown codes', async () => {
    const invite = await json(await api(`/api/invite/${B.profile.friendCode}`));
    assert.deepEqual(invite, { name: 'Bea', emoji: '🐼' });
    assert.equal((await api('/api/invite/ZZZZZZZZ')).status, 404);
    const look = await json(await authed(`/api/friends/lookup/${B.profile.friendCode.toLowerCase()}`, A.token));
    assert.deepEqual([look.user.name, look.isFriend, look.isSelf], ['Bea', false, false]);
    let res = await authed('/api/friends', A.token, { method: 'POST', body: JSON.stringify({ code: B.profile.friendCode }) });
    assert.equal(res.status, 201);
    await B.live.next('friends');
    const feedB = await json(await authed('/api/friends', B.token));
    assert.deepEqual(feedB.friends.map((f) => f.name), ['Arun K']);
    res = await authed('/api/friends', A.token, { method: 'POST', body: JSON.stringify({ code: A.profile.friendCode }) });
    assert.equal(res.status, 400);
    res = await authed('/api/friends', A.token, { method: 'POST', body: JSON.stringify({ code: 'ZZZZ-ZZZZ' }) });
    assert.equal(res.status, 404);
  });

  // Bea turns on push reminders on her phone and links it to her account.
  const beaDevice = { id: randomUUID().replace(/-/g, ''), token: secret(), ...newSubscription('bea-phone') };
  await step('a push device can be linked to an account (only with its own token)', async () => {
    let res = await api(`/api/devices/${beaDevice.id}`, {
      method: 'PUT',
      token: beaDevice.token,
      body: JSON.stringify({
        subscription: beaDevice.subscription,
        timeZone: 'Europe/Paris',
        reminders: [{ id: 'read', kind: 'checkin', title: 'Read', emoji: '📚', days: [0, 1, 2, 3, 4, 5, 6], time: '23:58', offsetMin: 0 }],
      }),
    });
    assert.equal(res.status, 200);
    res = await authed(`/api/me/devices/${beaDevice.id}`, B.token, { method: 'POST', body: JSON.stringify({ token: secret() }) });
    assert.equal(res.status, 403);
    res = await authed(`/api/me/devices/${beaDevice.id}`, B.token, { method: 'POST', body: JSON.stringify({ token: beaDevice.token }) });
    assert.equal(res.status, 200);
  });

  await step('share: friends see the snapshot and a live check-in event', async () => {
    const body = {
      timeZone: 'Europe/Paris',
      date: parisToday,
      weekStart,
      habits: [habit('gym', 'Gym', '🏋️', 'Y'), habit('read', 'Read', '📚', 'P')],
      event: { habitId: 'gym', answer: 'yes' },
    };
    let res = await authed('/api/share', B.token, { method: 'PUT', body: JSON.stringify(body) });
    assert.equal((await json(res)).changed, true);
    const evt = await A.live.next('checkin');
    assert.deepEqual([evt.from.name, evt.habit.name, evt.answer], ['Bea', 'Gym', 'yes']);
    const feed = await json(await authed('/api/friends', A.token));
    const bea = feed.friends[0];
    assert.deepEqual(bea.habits.map((h) => [h.id, h.today]), [['gym', 'yes'], ['read', 'pending']]);
    assert.equal(bea.week.yes, todayIdx * 2 + 1);
    const { event: _e, ...again } = body;
    res = await authed('/api/share', B.token, { method: 'PUT', body: JSON.stringify(again) });
    assert.equal((await json(res)).changed, false, 'unchanged snapshots are ignored');
    res = await authed('/api/share', B.token, { method: 'PUT', body: JSON.stringify({ ...again, date: '2020-01-06', weekStart: '2020-01-06' }) });
    assert.equal(res.status, 400, 'snapshots must describe today');
    res = await authed('/api/share', B.token, { method: 'PUT', body: JSON.stringify({ ...again, habits: [{ ...again.habits[0], days: [] }] }) });
    assert.equal(res.status, 400, 'a shared habit is planned on at least one day');
  });

  await step('nudge: reaches the friend live and as a push, once per day', async () => {
    received.length = 0;
    let res = await authed('/api/nudges', A.token, { method: 'POST', body: JSON.stringify({ to: B.profile.id, habitId: 'read' }) });
    assert.equal(res.status, 201, await res.clone().text());
    const evt = await B.live.next('nudge');
    assert.equal(evt.habit.name, 'Read');
    await waitFor(() => received.some((r) => r.path === beaDevice.path), 'nudge push');
    const push = received.find((r) => r.path === beaDevice.path);
    assert.equal(push.payload.type, 'social');
    assert.match(push.payload.title, /Arun K nudged you/);
    res = await authed('/api/nudges', A.token, { method: 'POST', body: JSON.stringify({ to: B.profile.id, habitId: 'read' }) });
    assert.equal(res.status, 429);
    res = await authed('/api/nudges', A.token, { method: 'POST', body: JSON.stringify({ to: B.profile.id, habitId: 'gym' }) });
    assert.equal(res.status, 409, 'already checked in');
  });

  await step('reactions: live + push the first time, shown in the feed', async () => {
    received.length = 0;
    let res = await authed('/api/reactions', A.token, { method: 'PUT', body: JSON.stringify({ to: B.profile.id, habitId: 'gym', date: parisToday, emoji: '🔥' }) });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await B.live.next('reaction')).emoji, '🔥');
    await waitFor(() => received.length === 1, 'reaction push');
    assert.match(received[0].payload.title, /reacted 🔥/);
    res = await authed('/api/reactions', A.token, { method: 'PUT', body: JSON.stringify({ to: B.profile.id, habitId: 'gym', date: parisToday, emoji: '💪' }) });
    await B.live.next('reaction');
    await authed('/api/reactions', A.token, { method: 'PUT', body: JSON.stringify({ to: B.profile.id, habitId: 'gym', date: parisToday, emoji: null }) });
    res = await authed('/api/reactions', A.token, { method: 'PUT', body: JSON.stringify({ to: B.profile.id, habitId: 'gym', date: parisToday, emoji: '💪' }) });
    await B.live.next('reaction');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(received.length, 1, 'changing, removing or re-adding a reaction does not push again');
    const feed = await json(await authed('/api/friends', B.token));
    assert.deepEqual(feed.reactions.map((r) => [r.from, r.emoji]), [[A.profile.id, '💪']]);
    res = await authed('/api/reactions', A.token, { method: 'PUT', body: JSON.stringify({ to: B.profile.id, habitId: 'gym', date: parisToday, emoji: '👎' }) });
    assert.equal(res.status, 400);
  });

  await step('answered on one device: the account\'s other devices skip that reminder', async () => {
    const res = await authed('/api/sync', B.token, { method: 'POST', body: JSON.stringify({ answered: [{ habitId: 'read', date: parisToday }] }) });
    assert.equal(res.status, 200);
    const [r] = sql(`SELECT skip_dates, next_date FROM reminders WHERE device_id = '${beaDevice.id}' AND id = 'read'`);
    assert.ok(r.skip_dates.includes(parisToday));
    assert.notEqual(r.next_date, parisToday);
  });

  await step('challenges: create, invite, join with a shared habit, weekly progress, leave', async () => {
    let res = await authed('/api/challenges', B.token, {
      method: 'POST',
      body: JSON.stringify({ name: 'Gym 3x', emoji: '🏋️', target: 3, habitId: 'gym', invite: [A.profile.id] }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    const { id } = await json(res);
    await A.live.next('challenges');
    let list = (await json(await authed('/api/challenges', A.token))).challenges;
    assert.equal(list[0].me.status, 'invited');
    res = await authed(`/api/challenges/${id}/join`, A.token, { method: 'POST', body: JSON.stringify({ habitId: 'run' }) });
    assert.equal(res.status, 400, 'must share the habit first');
    await authed('/api/share', A.token, { method: 'PUT', body: JSON.stringify({ timeZone: 'Europe/Paris', date: parisToday, weekStart, habits: [habit('run', 'Run', '🏃', 'N')] }) });
    res = await authed(`/api/challenges/${id}/join`, A.token, { method: 'POST', body: JSON.stringify({ habitId: 'run' }) });
    assert.equal(res.status, 200);
    list = (await json(await authed('/api/challenges', B.token))).challenges;
    assert.deepEqual(list[0].members.map((m) => [m.name, m.status, m.yes]), [['Bea', 'member', todayIdx + 1], ['Arun K', 'member', todayIdx]]);
    res = await authed(`/api/challenges/${id}/invite`, A.token, { method: 'POST', body: JSON.stringify({ friendIds: [B.profile.id] }) });
    assert.equal(res.status, 403, 'only the organiser invites');
    assert.equal(list[0].members[0].done, todayIdx + 1 >= 3);
    await authed(`/api/challenges/${id}/membership`, A.token, { method: 'DELETE' });
    await authed(`/api/challenges/${id}/membership`, B.token, { method: 'DELETE' });
    assert.equal(sql(`SELECT COUNT(*) AS n FROM challenges WHERE id = '${id}'`)[0].n, 0, 'empty challenges disappear');
  });

  await step('delete account: everything about it is removed, friends are updated', async () => {
    const res = await authed('/api/me', A.token, { method: 'DELETE' });
    assert.equal(res.status, 200);
    await B.live.next('friends');
    assert.equal((await authed('/api/me', A.token)).status, 401);
    assert.equal((await json(await authed('/api/friends', B.token))).friends.length, 0);
    for (const table of ['sync_records', 'shared_habits']) {
      assert.equal(sql(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = '${A.profile.id}'`)[0].n, 0, table);
    }
    assert.equal(sql(`SELECT COUNT(*) AS n FROM reactions WHERE from_id = '${A.profile.id}' OR to_id = '${A.profile.id}'`)[0].n, 0);
    for (const l of [A.live, A.live2, B.live]) l.ws.close();
  });

  console.log(`\nIntegration test passed: ${checks.passed} checks.`);
} catch (err) {
  exitCode = 1;
  console.error('\nIntegration test FAILED:', err);
  console.error('\n--- wrangler dev output ---\n' + server.devLog().slice(-4000));
} finally {
  server.stop();
  setTimeout(() => process.exit(exitCode), 300);
}

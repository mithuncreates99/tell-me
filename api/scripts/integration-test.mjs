#!/usr/bin/env node
/**
 * End-to-end test of the worker running locally (wrangler dev + local D1) against a mock push
 * service. The mock decrypts every push with the subscription's private key and verifies the
 * VAPID signature, exactly like a browser + push service would.
 *
 *   npm run test:integration
 */
import { spawn, execFileSync } from 'node:child_process';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import ece from 'http_ece';

const API_PORT = 8799;
const PUSH_PORT = 8798;
const API = `http://127.0.0.1:${API_PORT}`;
const persistDir = mkdtempSync(join(tmpdir(), 'tell-me-d1-'));
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', WRANGLER_SEND_METRICS: 'false' };
const b64url = (b) => Buffer.from(b).toString('base64url');
let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

// ---------- VAPID keys for this run ----------
const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidPublic = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', vapidPair.publicKey)));
const vapidPrivate = (await crypto.subtle.exportKey('jwk', vapidPair.privateKey)).d;

// ---------- Mock push service ----------
const subscriptions = new Map(); // path -> { ecdh, auth }
const received = [];
const pushServer = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const sub = subscriptions.get(req.url);
    if (!sub || sub.gone) {
      res.writeHead(410).end('gone');
      return;
    }
    try {
      const [, jwt, k] = req.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
      const [h, p, s] = jwt.split('.');
      const ok = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        vapidPair.publicKey,
        Buffer.from(s, 'base64url'),
        new TextEncoder().encode(`${h}.${p}`),
      );
      assert.equal(ok, true, 'VAPID signature');
      assert.equal(k, vapidPublic);
      assert.equal(req.headers['content-encoding'], 'aes128gcm');
      const plain = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: sub.ecdh, authSecret: sub.auth });
      received.push({ path: req.url, headers: req.headers, payload: JSON.parse(plain.toString()) });
      res.writeHead(201).end();
    } catch (err) {
      console.error('mock push service rejected request:', err);
      res.writeHead(400).end(String(err));
    }
  });
});
await new Promise((r) => pushServer.listen(PUSH_PORT, '127.0.0.1', r));

function newSubscription(name) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const path = `/push/${name}`;
  subscriptions.set(path, { ecdh, auth });
  return {
    path,
    subscription: {
      endpoint: `http://127.0.0.1:${PUSH_PORT}${path}`,
      expirationTime: null,
      keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) },
    },
  };
}

// ---------- Local D1 + wrangler dev ----------
const wrangler = (args, opts = {}) =>
  execFileSync('npx', ['wrangler', ...args, '--persist-to', persistDir], { env, encoding: 'utf8', ...opts });
const sql = (command) => {
  const out = wrangler(['d1', 'execute', 'tell-me', '--local', '--json', '--command', command], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out)[0].results;
};

console.log('Applying migrations to a fresh local D1 database…');
wrangler(['d1', 'migrations', 'apply', 'tell-me', '--local'], { stdio: ['ignore', 'ignore', 'inherit'] });

console.log('Starting wrangler dev…');
const dev = spawn(
  'npx',
  [
    'wrangler', 'dev', '--port', String(API_PORT), '--ip', '127.0.0.1', '--persist-to', persistDir, '--test-scheduled',
    '--var', `VAPID_PUBLIC_KEY:${vapidPublic}`,
    '--var', `VAPID_PRIVATE_KEY:${vapidPrivate}`,
    '--var', 'VAPID_SUBJECT:mailto:test@example.com',
    '--var', 'ALLOW_ANY_PUSH_ENDPOINT:true',
  ],
  { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
);
let devLog = '';
dev.stdout.on('data', (d) => (devLog += d));
dev.stderr.on('data', (d) => (devLog += d));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${API}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not start:\n${devLog}`);
}

// wrangler dev occasionally drops a kept-alive socket between requests; retry once.
const fetchRetry = async (url, init) => {
  try {
    return await fetch(url, init);
  } catch {
    await new Promise((r) => setTimeout(r, 200));
    return fetch(url, init);
  }
};
const api = (path, { token, ...init } = {}) =>
  fetchRetry(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
const tick = () => fetchRetry(`${API}/__scheduled?cron=*+*+*+*+*`);
const waitFor = async (pred, what) => {
  for (let i = 0; i < 40; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

let exitCode = 0;
try {
  await waitForServer();
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
    subscriptions.get(gone.path).gone = true;
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

  console.log(`\nIntegration test passed: ${passed} checks.`);
} catch (err) {
  exitCode = 1;
  console.error('\nIntegration test FAILED:', err);
  console.error('\n--- wrangler dev output ---\n' + devLog.slice(-4000));
} finally {
  try {
    process.kill(-dev.pid, 'SIGTERM'); // the whole process group: npx -> wrangler -> workerd
  } catch {}
  pushServer.close();
  rmSync(persistDir, { recursive: true, force: true });
  setTimeout(() => process.exit(exitCode), 300);
}

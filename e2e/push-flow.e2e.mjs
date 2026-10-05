#!/usr/bin/env node
/**
 * Full push flow, end to end, on one machine:
 *
 *   browser (real app + real service worker)  ──PUT schedule──▶  worker (wrangler dev + local D1)
 *        ▲                                                          │ cron tick
 *        │ CDP delivers the push to the service worker               ▼
 *        └──────────────── mock push service (decrypts + verifies VAPID like FCM/APNs would)
 *
 * Only the browser's own push subscription is faked (headless Chromium has no push service),
 * using a key pair we control so the mock can decrypt exactly what a phone would receive.
 *
 *   node e2e/push-flow.e2e.mjs
 */
import assert from 'node:assert/strict';
import { check, loadPlaywright, sleep, startMockPushService, startWeb, startWorker, subscriptionKeys, vapidKeys } from './lib.mjs';

const API_PORT = 8799;
const PUSH_PORT = 8798;
const WEB_PORT = 4174;
const results = [];
const step = check(results);

const vapid = await vapidKeys();
const push = await startMockPushService(PUSH_PORT, vapid);
const sub = subscriptionKeys(PUSH_PORT, '/push/e2e-phone');
push.add(sub);

let worker, web, browser;
let failed = false;
try {
  console.log('Starting worker (wrangler dev + local D1)…');
  worker = await startWorker(API_PORT, vapid);
  console.log('Building and serving the web app…');
  web = await startWeb(WEB_PORT, { apiUrl: `http://127.0.0.1:${API_PORT}` });

  const { chromium } = await loadPlaywright();
  // The full Chromium build (not the headless shell) supports notifications in headless mode.
  browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({ timezoneId: 'Europe/Paris', locale: 'en-GB', viewport: { width: 420, height: 900 } });
  await context.grantPermissions(['notifications'], { origin: new URL(web.url).origin });
  // Headless Chromium has no push service: hand the app a subscription whose keys we own.
  await context.addInitScript(({ endpoint, p256dh, auth, vapidKey }) => {
    if (!('PushManager' in self)) return;
    const KEY = '__e2e_push_sub';
    const bytes = Uint8Array.from(atob(vapidKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (vapidKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const make = () => ({
      endpoint,
      expirationTime: null,
      options: { applicationServerKey: bytes.buffer, userVisibleOnly: true },
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
      unsubscribe: async () => {
        localStorage.removeItem(KEY);
        return true;
      },
    });
    PushManager.prototype.subscribe = async function () {
      localStorage.setItem(KEY, '1');
      return make();
    };
    PushManager.prototype.getSubscription = async function () {
      return localStorage.getItem(KEY) ? make() : null;
    };
  }, { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.authB64, vapidKey: vapid.publicKey });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let habitId;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

  await step('app loads and the service worker takes control', async () => {
    await page.goto(web.url);
    await page.waitForSelector('text=Did you show up today?');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  });

  await step('add a daily habit with quick add', async () => {
    await page.fill('#quick-add', 'Read daily 22:00');
    await page.keyboard.press('Enter');
    await page.waitForSelector('h3:has-text("Read")');
    habitId = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('tell-me');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return new Promise((res) => {
        const req = db.transaction('habits').objectStore('habits').getAll();
        req.onsuccess = () => res(req.result[0].id);
      });
    });
    assert.ok(habitId);
  });

  await step('turning reminders on registers the device and its schedule', async () => {
    await page.goto(web.url + '#/settings');
    await page.getByRole('button', { name: 'Turn on reminders' }).click();
    await page.waitForSelector('text=Reminders are on for this device', { timeout: 15000 });
    const devices = worker.sql('SELECT id, endpoint, time_zone FROM devices');
    assert.equal(devices.length, 1);
    assert.equal(devices[0].endpoint, sub.endpoint);
    assert.equal(devices[0].time_zone, 'Europe/Paris');
    const reminders = worker.sql('SELECT id, kind, title, days, time, offset_min FROM reminders ORDER BY kind');
    assert.deepEqual(
      reminders.map((r) => [r.id, r.kind, r.title, r.days, r.time, r.offset_min]),
      [
        [habitId, 'checkin', 'Read', 127, '22:00', 60],
        ['weekly-report', 'weekly', 'Weekly report', 1, '19:00', 0],
      ],
    );
  });

  await step('"Send a test" reaches the push service, encrypted and signed', async () => {
    push.received.length = 0;
    await page.getByRole('button', { name: 'Send a test' }).click();
    for (let i = 0; i < 40 && push.received.length === 0; i++) await sleep(100);
    assert.deepEqual(push.received[0]?.payload, { type: 'test' });
  });

  let checkinPayload;
  await step('the cron tick sends the "Did you show up?" push when it is due', async () => {
    push.received.length = 0;
    worker.sql(`UPDATE reminders SET next_fire_at = ${Date.now() - 5000}, next_date = '${today}' WHERE id = '${habitId}'`);
    await worker.tick();
    for (let i = 0; i < 40 && push.received.length === 0; i++) await sleep(100);
    checkinPayload = push.received[0]?.payload;
    assert.deepEqual(checkinPayload, { type: 'checkin', habitId, date: today, title: 'Read', emoji: '📚', time: '22:00' });
    assert.equal(push.received[0].headers.urgency, 'high');
  });

  await step('the service worker turns that push into a Yes/No notification', async () => {
    const cdp = await context.newCDPSession(page);
    const registrationId = await new Promise((resolve) => {
      cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const r = registrations.find((x) => !x.isDeleted && x.scopeURL.startsWith(web.url));
        if (r) resolve(r.registrationId);
      });
      cdp.send('ServiceWorker.enable');
    });
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: new URL(web.url).origin,
      registrationId,
      data: JSON.stringify(checkinPayload),
    });
    let notes = [];
    for (let i = 0; i < 50 && notes.length === 0; i++) {
      await sleep(100);
      notes = await page.evaluate(async () =>
        (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
          title: n.title,
          body: n.body,
          tag: n.tag,
          data: n.data,
          actions: (n.actions ?? []).map((a) => a.action),
        })),
      );
    }
    assert.equal(notes.length, 1, 'one notification shown');
    assert.equal(notes[0].title, '📚 Read: did you show up?');
    assert.equal(notes[0].tag, `checkin-${habitId}-${today}`);
    assert.deepEqual(notes[0].data, { kind: 'checkin', habitId, date: today, path: `#/checkin/${habitId}/${today}` });
    assert.match(notes[0].body, /Planned/);
  });

  await step('answering in the app syncs skipDates so no push goes out for it', async () => {
    await page.goto(web.url + '#/');
    await page.getByRole('button', { name: 'Yes, I showed up for Read' }).click();
    let skip = '';
    for (let i = 0; i < 40 && !skip.includes(today); i++) {
      await sleep(200);
      skip = worker.sql(`SELECT skip_dates FROM reminders WHERE id = '${habitId}'`)[0]?.skip_dates ?? '';
    }
    assert.ok(skip.split(',').includes(today), `skip_dates "${skip}" should include ${today}`);
  });

  await step('turning reminders off deletes the device on the server', async () => {
    await page.goto(web.url + '#/settings');
    await page.getByRole('button', { name: 'Turn off' }).click();
    await page.waitForSelector('text=Turn on reminders');
    assert.equal(worker.sql('SELECT COUNT(*) AS n FROM devices')[0].n, 0);
    assert.equal(worker.sql('SELECT COUNT(*) AS n FROM reminders')[0].n, 0);
  });

  assert.deepEqual(errors, [], 'no uncaught page errors');
  console.log(`\nPush flow E2E passed: ${results.length} checks.`);
} catch (err) {
  failed = true;
  console.error('\nPush flow E2E FAILED:', err?.message ?? err);
  if (worker) console.error('\n--- worker log (tail) ---\n' + worker.log().slice(-3000));
} finally {
  await browser?.close();
  web?.stop();
  worker?.stop();
  push.close();
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}

#!/usr/bin/env node
/**
 * Tests the iPhone-app code paths (Capacitor) in Chromium by pretending to be the native shell:
 * a fake bridge answers the plugin calls the way iOS would, records what gets scheduled, and lets
 * the test press notification buttons. It checks the app's side of the contract; the native side
 * is Capacitor's own, well-tested plugins.
 *
 *   node e2e/native.e2e.mjs
 */
import assert from 'node:assert/strict';
import { check, loadPlaywright, startWeb } from './lib.mjs';

const results = [];
const step = check(results);
const NOW = new Date('2026-10-05T12:00:00+02:00'); // Monday noon

// Injected before the app loads: makes Capacitor believe it runs inside the iOS app.
function fakeNativeShell() {
  const calls = [];
  const listeners = {};
  const prefs = JSON.parse(localStorage.getItem('__fake_prefs') ?? '{}');
  let pending = [];
  const methods = {
    LocalNotifications: ['requestPermissions', 'checkPermissions', 'registerActionTypes', 'schedule', 'getPending', 'cancel', 'cancelAll'],
    Preferences: ['get', 'set', 'remove'],
    Haptics: ['impact'],
    Share: ['share'],
    Filesystem: ['writeFile'],
  };
  window.CapacitorCustomPlatform = { name: 'ios', plugins: {} };
  window.Capacitor = {
    PluginHeaders: Object.entries(methods).map(([name, ms]) => ({
      name,
      methods: [...ms.map((m) => ({ name: m, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }],
    })),
    nativePromise: async (plugin, method, options) => {
      calls.push({ plugin, method, options: JSON.parse(JSON.stringify(options ?? {})) });
      const key = `${plugin}.${method}`;
      switch (key) {
        case 'LocalNotifications.requestPermissions':
        case 'LocalNotifications.checkPermissions':
          return { display: 'granted' };
        case 'LocalNotifications.schedule':
          pending = [...pending.filter((p) => !options.notifications.some((n) => n.id === p.id)), ...options.notifications];
          return { notifications: options.notifications.map((n) => ({ id: n.id })) };
        case 'LocalNotifications.cancelAll':
          pending = [];
          return {};
        case 'LocalNotifications.getPending':
          return { notifications: pending };
        case 'Preferences.set':
          prefs[options.key] = options.value;
          localStorage.setItem('__fake_prefs', JSON.stringify(prefs));
          return {};
        case 'Preferences.get':
          return { value: prefs[options.key] ?? null };
        case 'Filesystem.writeFile':
          return { uri: `file:///cache/${options.path}` };
        default:
          return {};
      }
    },
    nativeCallback: (plugin, method, options, callback) => {
      if (method === 'addListener') (listeners[`${plugin}.${options.eventName}`] ??= []).push(callback);
      return `cb-${Math.random()}`;
    },
  };
  window.__native = {
    calls,
    pending: () => pending,
    prefs,
    emit: (plugin, event, data) => (listeners[`${plugin}.${event}`] ?? []).forEach((cb) => cb(data)),
  };
}

const web = await startWeb(4179, { outDir: 'dist-e2e-ui' });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chromium' });
let failed = false;

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Paris', locale: 'en-GB', reducedMotion: 'reduce' });
  await context.addInitScript(fakeNativeShell);
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const native = (fn) => page.evaluate(fn);

  await step('runs as the iPhone app: no service worker, no web-only settings', async () => {
    await page.goto(web.url);
    await page.waitForSelector('text=Did you show up today?');
    await page.fill('#quick-add', 'Gym Mon Wed Fri 6pm');
    await page.keyboard.press('Enter');
    await page.waitForSelector('h3:has-text("Gym")');
    await page.goto(web.url + '#/settings');
    await page.waitForSelector('text=Everything stays on your phone');
    assert.equal(await page.locator('text=Download calendar file').count(), 0);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  });

  let plan;
  await step('turning reminders on schedules Yes/No notifications on the phone', async () => {
    await page.getByRole('button', { name: 'Turn on reminders' }).click();
    await page.waitForSelector('text=scheduled for the next 10 days');
    plan = await native(() => window.__native.pending());
    const gym = plan.filter((n) => n.extra?.kind === 'checkin');
    assert.ok(gym.length >= 4, `expected gym reminders, got ${gym.length}`);
    assert.equal(gym[0].title, '🏋️ Gym: did you show up?');
    assert.equal(gym[0].actionTypeId, 'CHECKIN');
    assert.equal(gym[0].extra.date, '2026-10-05');
    assert.ok(plan.some((n) => n.extra?.kind === 'weekly'), 'weekly report scheduled');
    const types = await native(() => window.__native.calls.find((c) => c.method === 'registerActionTypes')?.options.types);
    assert.deepEqual(types[0].actions.map((a) => a.id), ['yes', 'no']);
  });

  await step('pressing ✅ Yes on the notification records the answer', async () => {
    const n = plan.find((x) => x.extra?.kind === 'checkin');
    await page.evaluate((notification) => window.__native.emit('LocalNotifications', 'localNotificationActionPerformed', { actionId: 'yes', notification }), n);
    await page.waitForSelector('text=Showed up');
    await page.waitForSelector('text=Logged ✅');
  });

  await step('answering removes that day from the schedule', async () => {
    await page.waitForFunction(() => !window.__native.pending().some((p) => p.extra?.date === '2026-10-05' && p.extra?.kind === 'checkin'), null, { timeout: 5000 });
  });

  await step('pressing ❌ No opens "What got in the way?"', async () => {
    const wed = plan.find((x) => x.extra?.date === '2026-10-07');
    await page.evaluate((notification) => window.__native.emit('LocalNotifications', 'localNotificationActionPerformed', { actionId: 'no', notification }), wed);
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: /Too busy/ }).click();
  });

  await step('tapping the notification opens the big Yes/No screen', async () => {
    const fri = plan.find((x) => x.extra?.date === '2026-10-09');
    await page.evaluate((notification) => window.__native.emit('LocalNotifications', 'localNotificationActionPerformed', { actionId: 'tap', notification }), fri);
    await page.waitForSelector('text=Gym: did you show up?');
  });

  await step('data is mirrored to native storage and restored if the web view is wiped', async () => {
    await page.waitForFunction(() => (window.__native.prefs['tell-me-backup'] ?? '').includes('"Gym"'), null, { timeout: 5000 });
    // Simulate iOS clearing the web view's storage (IndexedDB) while the native copy survives.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase('tell-me');
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        }),
    );
    await page.goto(web.url + '#/');
    await page.reload();
    await page.waitForSelector('text=Restored your habits');
    await page.waitForSelector('h3:has-text("Gym")');
    await page.waitForSelector('text=Showed up'); // Monday's Yes survived too
  });

  await step('export backup uses the iOS share sheet', async () => {
    await page.goto(web.url + '#/settings');
    await page.getByRole('button', { name: 'Export backup' }).click();
    await page.waitForFunction(() => window.__native.calls.some((c) => c.plugin === 'Share' && c.method === 'share' && c.options.url?.includes('tell-me-backup')));
  });

  assert.deepEqual(errors, [], 'no uncaught page errors');
  console.log(`\niPhone app E2E passed: ${results.length} checks.`);
} catch (err) {
  failed = true;
  console.error('\niPhone app E2E FAILED:', err?.message ?? err);
} finally {
  await browser.close();
  web.stop();
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}

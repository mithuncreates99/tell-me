#!/usr/bin/env node
/**
 * Privacy in real browsers, against the real worker (wrangler dev + local D1 + Durable Objects).
 * Bea keeps a private habit next to a shared one; Arun is her friend; Sam is a stranger.
 * Every request, response and live message each browser handles is recorded and checked.
 *
 *   node e2e/privacy.e2e.mjs
 */
import assert from 'node:assert/strict';
import { check, loadPlaywright, startWeb, startWorker, vapidKeys } from './lib.mjs';

const API_PORT = 8793;
const WEB_PORT = 4178;
const API = `http://127.0.0.1:${API_PORT}`;
const results = [];
const step = check(results);

const PRIVATE_HABIT = 'Therapy';
const PRIVATE_NOTE = 'hangover after the party';

let worker, web, browser;
let failed = false;

try {
  console.log('Starting worker (wrangler dev + local D1 + Durable Objects)…');
  worker = await startWorker(API_PORT, await vapidKeys());
  console.log('Building and serving the web app…');
  web = await startWeb(WEB_PORT, { apiUrl: API, outDir: 'dist-e2e-privacy' });

  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ channel: 'chromium' });

  /** A phone whose traffic with the server is recorded: what it sent, received and heard live. */
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Europe/Paris', locale: 'en-GB', reducedMotion: 'reduce' });
    const page = await context.newPage();
    Object.assign(page, { errors: [], sent: [], received: [], sockets: [], heard: [] });
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.on('request', (r) => {
      if (r.url().startsWith(API)) page.sent.push({ method: r.method(), url: r.url(), headers: r.headers(), body: r.postData() ?? '' });
    });
    page.on('response', async (r) => {
      if (!r.url().startsWith(API)) return;
      try {
        page.received.push(await r.text());
      } catch {}
    });
    page.on('websocket', (ws) => {
      page.sockets.push(ws.url());
      ws.on('framereceived', (f) => page.heard.push(String(f.payload)));
    });
    return page;
  };
  const bea = await open();
  const arun = await open();
  const sam = await open();
  const go = (page, hash) => page.goto(web.url + hash);
  const toast = (page, text) => page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 8000 });
  /** Everything readable a page sent (encrypted payloads blanked: they're checked separately). */
  const readableSent = (page) =>
    JSON.stringify(
      page.sent.map((r) => {
        let body = r.body;
        try {
          const parsed = JSON.parse(r.body);
          for (const rec of parsed.records ?? []) rec.x = '<ciphertext>';
          body = parsed;
        } catch {}
        return { ...r, body };
      }),
    );
  const everythingReceived = (page) => JSON.stringify([page.received, page.heard]);

  async function createAccount(page, name, avatar) {
    await page.getByRole('button', { name: /Create free account/ }).click();
    await page.fill('input[placeholder="e.g. Mithun"]', name);
    await page.getByRole('radio', { name: `Avatar ${avatar}` }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const key = (await page.getByTestId('account-key').getAttribute('aria-label')).replace('Account key:', '').replace(/\s/g, '');
    await page.getByLabel(/I saved my key/).check();
    await page.getByRole('button', { name: 'Create account' }).click();
    return key;
  }
  const friendCode = async (page) =>
    (await page.getByRole('button', { name: /Your friend code/ }).getAttribute('aria-label')).match(/([A-Z2-9]{4}-[A-Z2-9]{4})/)[1].replace('-', '');

  let beaKey;

  await step('Bea keeps a private habit with a private note, and shares only Gym', async () => {
    await go(bea, '#/');
    await bea.fill('#quick-add', 'Gym daily 7am');
    await bea.keyboard.press('Enter');
    await bea.waitForSelector('h3:has-text("Gym")');
    await go(bea, '#/habits');
    await bea.fill('#quick-add', `${PRIVATE_HABIT} daily 7am`);
    await bea.keyboard.press('Enter');
    await bea.getByRole('button', { name: new RegExp(PRIVATE_HABIT) }).first().waitFor();
    await go(bea, '#/');
    await bea.waitForSelector(`h3:has-text("${PRIVATE_HABIT}")`);
    await bea.getByRole('button', { name: 'Yes, I showed up for Gym' }).click();
    await bea.getByRole('button', { name: `No, I missed ${PRIVATE_HABIT}` }).click();
    await bea.getByPlaceholder('e.g. late lecture').fill(PRIVATE_NOTE);
    await bea.getByRole('button', { name: /Too busy/ }).click();
    await go(bea, '#/friends');
    beaKey = await createAccount(bea, 'Bea', '🐼');
    await bea.getByText('Invite your first friend').waitFor();
    await bea.getByRole('button', { name: 'Choose' }).click();
    await bea.getByRole('switch', { name: /Gym/ }).click();
    await bea.getByRole('button', { name: 'Done' }).click();
    await bea.getByText(/Friends see/).waitFor();
  });

  await step('Arun accepts her invite link: he sees Gym, and never the private habit or note', async () => {
    const code = await friendCode(bea);
    await go(arun, `#/add/${code}`);
    await arun.getByText('Bea invited you to Tell Me').waitFor();
    await createAccount(arun, 'Arun', '🦊');
    await arun.getByRole('button', { name: 'Add friend' }).click();
    await toast(arun, 'You and 🐼 Bea are now friends!');
    const card = arun.getByRole('article', { name: 'Bea' });
    await card.getByText('Gym').waitFor({ timeout: 8000 });
    const screen = await arun.locator('body').innerText();
    for (const secret of [PRIVATE_HABIT, PRIVATE_NOTE]) {
      assert.ok(!screen.includes(secret), `on screen: ${secret}`);
      assert.ok(!everythingReceived(arun).includes(secret), `received: ${secret}`);
    }
  });

  await step("Bea's private habit, note and reason never left her phone readable", async () => {
    await bea.waitForTimeout(1500); // let the background sync finish
    assert.ok(bea.sent.some((r) => r.url.endsWith('/api/sync') && r.method === 'POST'), 'her data was synced');
    const sent = readableSent(bea);
    for (const secret of [PRIVATE_HABIT, PRIVATE_NOTE, '"busy"']) assert.ok(!sent.includes(secret), `sent readable: ${secret}`);
    const withCiphertext = JSON.stringify(bea.sent);
    for (const secret of [PRIVATE_HABIT, PRIVATE_NOTE]) assert.ok(!withCiphertext.includes(secret), `sent at all: ${secret}`);
    // Gym is readable only where it's meant to be: the snapshot for friends.
    const readableGym = bea.sent.filter((r) => r.body.includes('"Gym"'));
    assert.ok(readableGym.length > 0);
    assert.ok(readableGym.every((r) => r.url.endsWith('/api/share') && r.method === 'PUT'));
  });

  await step('her account key never left the phone (only a derived secret, never in a URL)', async () => {
    const everything = JSON.stringify([bea.sent, bea.sockets]);
    for (const form of [beaKey, beaKey.replace(/-/g, ''), beaKey.toLowerCase()]) assert.ok(!everything.includes(form));
    const auth = new Set(bea.sent.map((r) => r.headers.authorization).filter(Boolean));
    assert.ok(auth.size >= 1);
    for (const header of auth) {
      const secret = header.replace('Bearer ', '');
      assert.ok(!bea.sent.some((r) => r.url.includes(secret) || r.body.includes(secret)), 'secret only in the header');
      assert.ok(!bea.sockets.some((u) => u.includes(secret)), 'secret not in the live URL');
    }
  });

  await step('a stranger who signs up sees no one, and is sent nothing about anyone', async () => {
    await go(sam, '#/friends');
    await createAccount(sam, 'Sam', '🐙');
    await sam.getByText('Invite your first friend').waitFor();
    await sam.waitForTimeout(800);
    const screen = await sam.locator('body').innerText();
    const received = everythingReceived(sam);
    for (const secret of ['Bea', 'Arun', 'Gym', PRIVATE_HABIT]) {
      assert.ok(!screen.includes(secret), `on screen: ${secret}`);
      assert.ok(!received.includes(secret), `received: ${secret}`);
    }
  });

  await step('removing a friend says what happens, and takes effect on her phone live', async () => {
    await go(bea, '#/friends');
    await bea.getByRole('article', { name: 'Arun' }).waitFor({ timeout: 8000 });
    await go(arun, '#/friends');
    await arun.getByRole('button', { name: 'Options for Bea' }).click();
    await arun.getByText(/stop seeing each other's habits and leave the challenges the other started/).waitFor();
    await arun.getByRole('button', { name: 'Remove friend' }).click();
    await toast(arun, 'Removed Bea.');
    await bea.getByRole('article', { name: 'Arun' }).waitFor({ state: 'detached', timeout: 8000 });
    await arun.getByRole('article', { name: 'Bea' }).waitFor({ state: 'detached' });
  });

  await step('signing out leaves nothing of the account, its habits or friends on the phone', async () => {
    await go(bea, '#/settings');
    await bea.getByRole('button', { name: 'Sign out' }).click();
    await bea.getByRole('dialog').getByRole('button', { name: /Sign out/ }).click();
    await toast(bea, 'Signed out.');
    await bea.waitForSelector('text=Did you show up today?');
    const left = await bea.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('tell-me');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const read = (store, what) =>
        new Promise((resolve) => {
          const req = db.transaction(store).objectStore(store)[what]();
          req.onsuccess = () => resolve(req.result);
        });
      const out = {
        kvKeys: await read('kv', 'getAllKeys'),
        kv: await read('kv', 'getAll'),
        habits: await read('habits', 'getAll'),
        checkins: await read('checkins', 'getAll'),
        outbox: await read('outbox', 'getAll'),
        local: JSON.stringify({ ...localStorage }),
        session: JSON.stringify({ ...sessionStorage }),
      };
      db.close();
      return out;
    });
    for (const key of ['account', 'sync', 'share']) assert.ok(!left.kvKeys.includes(key), `still stored: ${key}`);
    assert.deepEqual([left.habits, left.checkins, left.outbox], [[], [], []]);
    const stored = JSON.stringify(left);
    for (const secret of ['Arun', 'Gym', PRIVATE_HABIT, PRIVATE_NOTE, beaKey, beaKey.replace(/-/g, '')]) assert.ok(!stored.includes(secret), `still stored: ${secret}`);
    await go(bea, '#/friends');
    await bea.getByText('Habits stick better with friends').waitFor();
    assert.ok(!(await bea.locator('body').innerText()).includes('Arun'));
  });

  for (const [name, page] of [['Bea', bea], ['Arun', arun], ['Sam', sam]]) assert.deepEqual(page.errors, [], `${name}: page errors`);
} catch (err) {
  failed = true;
  console.error(err);
  if (worker) console.error('\n--- worker log (tail) ---\n' + worker.log().slice(-1500));
} finally {
  await browser?.close();
  web?.stop();
  worker?.stop();
  const passed = results.filter((r) => r.ok).length;
  console.log(failed ? `\nPrivacy E2E FAILED (${passed} passed before the failure).` : `\nPrivacy E2E passed: ${passed} checks.`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}

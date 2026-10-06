#!/usr/bin/env node
/**
 * Accounts, end-to-end encrypted sync and friends, with real browsers against the real worker
 * (wrangler dev + local D1 + Durable Objects for the live WebSockets):
 *
 *   Mithun (phone)  ──┐
 *   Bea (phone)     ──┼──▶  worker  ──▶  live updates to every open app
 *   Mithun (laptop) ──┘
 *
 *   node e2e/social.e2e.mjs        (SHOTS_DIR=… also saves screenshots)
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, loadPlaywright, startWeb, startWorker, vapidKeys } from './lib.mjs';

const API_PORT = 8797;
const WEB_PORT = 4177;
const results = [];
const step = check(results);
const shotsDir = process.env.SHOTS_DIR;
/** DOCS_SHOTS=1: phone-sized retina screenshots for the README (390×844 @2x). */
const docs = Boolean(process.env.DOCS_SHOTS);
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

let worker, web, browser;
let failed = false;

const noOverflow = async (page, where) => {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(extra, 0, `${where}: page scrolls horizontally by ${extra}px`);
};
const unnamed = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], [role=switch], [role=radio]')]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => !(el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('title') || el.labels?.length))
      .map((el) => el.outerHTML.slice(0, 80)),
  );
const shot = async (page, name) => {
  if (!shotsDir) return;
  const hide = await page.addStyleTag({ content: '[role=status]{visibility:hidden!important}' });
  await page.waitForTimeout(docs ? 600 : 100);
  await page.screenshot({ path: join(shotsDir, `${name}.png`) });
  await hide.evaluate((el) => el.remove());
};

try {
  console.log('Starting worker (wrangler dev + local D1 + Durable Objects)…');
  worker = await startWorker(API_PORT, await vapidKeys());
  console.log('Building and serving the web app…');
  web = await startWeb(WEB_PORT, { apiUrl: `http://127.0.0.1:${API_PORT}`, outDir: 'dist-e2e-social' });

  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ channel: 'chromium' });
  const open = async (viewport) => {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: docs ? 2 : 1,
      timezoneId: 'Europe/Paris',
      locale: 'en-GB',
      reducedMotion: 'reduce',
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(web.url).origin });
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    return page;
  };
  const phone = docs ? { width: 390, height: 844 } : { width: 360, height: 780 };
  const A = await open(phone); // Mithun's phone
  const B = await open(phone); // Bea's phone
  const C = await open({ width: 1280, height: 860 }); // Mithun's laptop
  const go = (page, hash) => page.goto(web.url + hash);
  const toast = (page, text) => page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 8000 });

  let mithunKey;
  let mithunCode;

  async function createAccount(page, name, avatar, keyShot) {
    await page.getByRole('button', { name: /Create free account/ }).click();
    await page.fill('input[placeholder="e.g. Mithun"]', name);
    await page.getByRole('radio', { name: `Avatar ${avatar}` }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const label = await page.getByTestId('account-key').getAttribute('aria-label');
    const key = label.replace('Account key:', '').replace(/\s/g, '');
    assert.match(key, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    await page.getByLabel(/I saved my key/).check();
    if (keyShot) await shot(page, keyShot);
    await page.getByRole('button', { name: 'Create account' }).click();
    return key;
  }

  await step('Mithun adds a habit, then creates an account (no email, no password)', async () => {
    await go(A, '#/');
    await A.fill('#quick-add', 'Gym daily 7am');
    await A.keyboard.press('Enter');
    await A.waitForSelector('h3:has-text("Gym")');
    await go(A, '#/friends');
    await A.getByText('Habits stick better with friends').waitFor();
    await shot(A, '01-friends-intro');
    await noOverflow(A, 'friends intro');
    mithunKey = await createAccount(A, 'Mithun', '🦊', '08-account-key');
    await A.getByText('Invite your first friend').waitFor();
    const codeLabel = await A.getByRole('button', { name: /Your friend code/ }).getAttribute('aria-label');
    mithunCode = codeLabel.match(/([A-Z2-9]{4}-[A-Z2-9]{4})/)[1].replace('-', '');
    assert.deepEqual(await unnamed(A), []);
  });

  await step('he shares the Gym habit with friends', async () => {
    await A.getByRole('button', { name: 'Choose' }).click();
    await A.getByRole('switch', { name: /Gym/ }).click();
    await A.getByRole('button', { name: 'Done' }).click();
    await A.getByText(/Friends see/).waitFor();
  });

  await step('Bea opens his invite link, signs up and is connected', async () => {
    await go(B, `#/add/${mithunCode}`);
    await B.getByText('Mithun invited you to Tell Me').waitFor();
    await shot(B, '02-invite');
    await noOverflow(B, 'invite');
    await createAccount(B, 'Bea', '🐼');
    await B.getByRole('heading', { name: 'Add Mithun?' }).waitFor();
    await B.getByRole('button', { name: 'Add friend' }).click();
    await toast(B, 'You and 🦊 Mithun are now friends!');
    await B.getByRole('article', { name: 'Mithun' }).getByText('Gym').waitFor();
  });

  await step("Mithun's open app shows Bea live, without reloading", async () => {
    await A.getByRole('article', { name: 'Bea' }).waitFor({ timeout: 8000 });
    await A.getByLabel("This week's leaderboard").getByText('Bea').waitFor();
  });

  await step('a Yes on his phone appears on her screen instantly, with a toast', async () => {
    await go(A, '#/');
    await A.getByRole('button', { name: 'Yes, I showed up for Gym' }).click();
    const gym = B.getByRole('article', { name: 'Mithun' });
    await gym.getByText('Showed up').waitFor({ timeout: 8000 });
    await toast(B, 'Mithun just checked in');
  });

  await step('she reacts 🔥 and he sees it live on his check-in', async () => {
    await B.getByRole('button', { name: "React to Mithun's Gym" }).click();
    await B.getByRole('button', { name: 'React 🔥' }).click();
    await toast(A, 'Bea reacted 🔥');
    await A.getByLabel('Reactions from friends').getByText('Bea').waitFor({ timeout: 8000 });
    await shot(A, '03-today-reaction');
  });

  await step('Bea shares a habit she has not done yet; Mithun nudges her', async () => {
    await go(B, '#/');
    await B.fill('#quick-add', 'Read daily 11:30pm');
    await B.keyboard.press('Enter');
    await B.waitForSelector('h3:has-text("Read")');
    await go(B, '#/habits');
    await B.getByRole('button', { name: /Read/ }).first().click();
    await B.getByRole('switch', { name: 'Share with friends' }).click();
    await B.getByRole('button', { name: 'Save changes' }).click();
    await go(A, '#/friends');
    const nudge = A.getByRole('button', { name: 'Nudge Bea about Read' });
    await nudge.waitFor({ timeout: 8000 });
    await nudge.click();
    await toast(B, 'Mithun nudged you');
    await A.getByRole('button', { name: 'You nudged Bea about Read' }).waitFor();
  });

  await step('weekly challenge: Mithun starts it, Bea joins with her own habit', async () => {
    await A.getByRole('button', { name: 'New' }).click();
    await A.getByRole('button', { name: 'Start challenge' }).click();
    await toast(A, 'Challenge started');
    const card = A.getByRole('article', { name: /Challenge Gym 3×/ });
    await card.waitFor();
    await go(B, '#/friends');
    await B.getByText(/invited you to/).waitFor({ timeout: 8000 });
    await B.getByRole('button', { name: 'Join', exact: true }).click();
    await B.getByRole('dialog').getByRole('button', { name: /Read/ }).click();
    await toast(B, 'You joined');
    await card.getByText('2 people').waitFor({ timeout: 8000 });
    await shot(A, '04-friends-home');
    await shot(B, '05-friends-bea');
    await noOverflow(A, 'friends home');
    await noOverflow(B, 'friends home (Bea)');
    assert.deepEqual(await unnamed(A), []);
  });

  await step('Mithun signs in on his laptop with his key: everything syncs, decrypted', async () => {
    await go(C, '#/account/signin');
    await C.getByLabel('Account key').fill(mithunKey.toLowerCase().replace(/-/g, ' '));
    await C.getByRole('button', { name: 'Sign in' }).click();
    await toast(C, 'Signed in');
    await go(C, '#/');
    await C.getByRole('article', { name: /Gym/ }).getByText('Showed up').waitFor({ timeout: 8000 });
    await shot(C, '06-laptop-today');
  });

  await step('a change on the laptop reaches the phone live (no reload)', async () => {
    await go(A, '#/');
    await A.getByRole('article', { name: /Gym/ }).getByText('Showed up').waitFor();
    await C.getByRole('button', { name: 'Change answer for Gym' }).click();
    await A.getByRole('button', { name: 'Yes, I showed up for Gym' }).waitFor({ timeout: 8000 });
  });

  await step('settings show the account; signing out removes the data from that device', async () => {
    await go(C, '#/settings');
    await C.getByText('Friend code').waitFor();
    await shot(C, '07-settings-account');
    await C.getByRole('button', { name: 'Sign out' }).click();
    await C.getByRole('dialog').getByRole('button', { name: /Sign out/ }).click();
    await toast(C, 'Signed out.');
    await C.waitForSelector('text=Did you show up today?');
  });

  for (const [name, page] of [['Mithun', A], ['Bea', B], ['laptop', C]]) {
    assert.deepEqual(page.errors, [], `${name}: page errors`);
  }
} catch (err) {
  failed = true;
  console.error(err);
  if (worker) {
    console.error('\n--- worker log (tail) ---\n' + worker.log().slice(-1500));
    if (shotsDir) writeFileSync(join(shotsDir, 'worker.log'), worker.log());
  }
} finally {
  await browser?.close();
  web?.stop();
  worker?.stop();
  const passed = results.filter((r) => r.ok).length;
  console.log(failed ? `\nSocial E2E FAILED (${passed} passed before the failure).` : `\nSocial E2E passed: ${passed} checks.`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}

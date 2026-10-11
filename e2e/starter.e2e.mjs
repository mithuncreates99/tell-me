#!/usr/bin/env node
/**
 * The starter habits (three water check-ins, 4 L a day) in a real browser. This build has them
 * turned on; the other suites leave them out because they count habits. No server needed.
 *
 *   node e2e/starter.e2e.mjs
 */
import assert from 'node:assert/strict';
import { check, loadPlaywright, startWeb } from './lib.mjs';

const results = [];
const step = check(results);
const NOW = new Date('2026-10-12T08:30:00+02:00'); // a Monday morning
const WATER = ['Drink 1 L of water (morning)', 'Drink 1.5 L of water (noon)', 'Drink 1.5 L of water (evening)'];
const ADDED = 'Added water check-ins, 4 L a day';

const web = await startWeb(4177, { outDir: 'dist-e2e-starter', starter: true });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chromium' });
let failed = false;

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, timezoneId: 'Europe/Paris', locale: 'en-GB', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  return page;
}

const noOverflow = async (page, where) => {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(extra, 0, `${where}: page scrolls horizontally by ${extra}px`);
};

const card = (page, name) => page.locator('h3', { hasText: name });

try {
  const page = await newPage();
  const go = async (hash) => {
    await page.goto(web.url + hash);
    await page.waitForTimeout(150);
  };

  await step('a new user still starts on the welcome screen', async () => {
    await go('#/');
    await page.waitForSelector('text=Did you show up today?');
    assert.equal(await page.getByText(/of water/).count(), 0);
  });

  await step('the first habit brings the three water check-ins, and says so', async () => {
    await page.fill('#quick-add', 'Gym Mon Wed Fri 6pm');
    await page.keyboard.press('Enter');
    await page.getByRole('status').getByText(ADDED).waitFor();
    for (const name of WATER) await card(page, name).waitFor();
    await card(page, 'Gym').waitFor();
    await noOverflow(page, 'today with the water check-ins');
  });

  await step('they are ordinary habits with a stronger reminder', async () => {
    await go('#/habits');
    for (const name of WATER) await page.getByText(name).first().waitFor();
    await go('#/habits/water-noon');
    const strong = page.getByRole('switch', { name: /Stronger reminder/ });
    assert.equal(await strong.getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByRole('switch', { name: /Yes\/No reminder/ }).getAttribute('aria-checked'), 'true');
  });

  await step('a deleted one stays deleted, even after a reload', async () => {
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete forever' }).click();
    await go('#/habits');
    await page.reload();
    await page.getByText(WATER[0]).first().waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.getByText(WATER[1]).count(), 0);
  });

  await step('an existing user gets them the next time the app starts', async () => {
    const old = await newPage();
    await old.goto(web.url + '#/');
    await old.fill('#quick-add', 'Read daily 22:00');
    await old.keyboard.press('Enter');
    await card(old, WATER[0]).waitFor();
    // Make this device look like one set up before the starter habits existed.
    await old.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('tell-me');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['habits', 'kv'], 'readwrite');
        for (const id of ['water-morning', 'water-noon', 'water-evening']) tx.objectStore('habits').delete(id);
        const kv = tx.objectStore('kv');
        const req = kv.get('settings');
        req.onsuccess = () => {
          const { starter: _starter, ...settings } = req.result;
          kv.put(settings, 'settings');
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await old.reload();
    await old.getByRole('status').getByText(ADDED).waitFor();
    for (const name of WATER) await card(old, name).waitFor();
    await card(old, 'Read').waitFor();
    assert.deepEqual(old.errors, []);
  });

  await step('the sample data is left as it is', async () => {
    const demo = await newPage();
    await demo.goto(web.url + '#/demo');
    await demo.waitForSelector('text=Showed up');
    await demo.goto(web.url + '#/habits');
    await demo.getByText('Gym').first().waitFor();
    await demo.waitForTimeout(300);
    assert.equal(await demo.getByText(/of water/).count(), 0);
    assert.deepEqual(demo.errors, []);
  });

  assert.deepEqual(page.errors, [], 'no console errors');
  console.log(`\nStarter habits E2E passed: ${results.length} checks.`);
} catch (err) {
  failed = true;
  console.error('\nStarter habits E2E FAILED:', err?.message ?? err);
} finally {
  await browser.close();
  web.stop();
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}

#!/usr/bin/env node
/**
 * UI end-to-end test of the web app in a real browser (no server needed).
 * The clock is pinned to Monday 5 Oct 2026, 19:40 Paris time so schedules are deterministic.
 *
 *   node e2e/app.e2e.mjs
 */
import assert from 'node:assert/strict';
import { check, loadPlaywright, startWeb } from './lib.mjs';

const results = [];
const step = check(results);
const NOW = new Date('2026-10-05T19:40:00+02:00'); // a Monday

const web = await startWeb(4176, { outDir: 'dist-e2e-ui' });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chromium' });
let failed = false;

async function newPage(opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 }, // a small phone: nothing may overflow
    timezoneId: 'Europe/Paris',
    locale: 'en-GB',
    reducedMotion: 'reduce',
    ...opts,
  });
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

const unnamedButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], [role=switch], [role=radio]')]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => !(el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('title') || el.labels?.length))
      .map((el) => el.outerHTML.slice(0, 80)),
  );

try {
  const page = await newPage();
  const go = async (hash) => {
    await page.goto(web.url + hash);
    await page.waitForTimeout(150);
  };

  await step('first visit shows onboarding', async () => {
    await go('#/');
    await page.waitForSelector('text=Did you show up today?');
    await noOverflow(page, 'welcome');
  });

  await step('quick add understands plain English', async () => {
    await page.fill('#quick-add', 'Gym Mon Wed Fri 6pm');
    await page.waitForSelector('text=Mon, Wed, Fri');
    await page.waitForSelector('text=18:00');
    await page.keyboard.press('Enter');
    await page.waitForSelector('h3:has-text("Gym")');
    await page.waitForSelector('text=waiting for your answer'); // asked at 19:00, it's 19:40
  });

  await step('Yes is logged, shown and can be undone', async () => {
    await page.getByRole('button', { name: 'Yes, I showed up for Gym' }).click();
    await page.waitForSelector('text=Showed up');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Yes, I showed up for Gym' }).waitFor();
  });

  await step('No asks what got in the way and stores the reason', async () => {
    await page.getByRole('button', { name: 'No, I missed Gym' }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: /Too tired/ }).click();
    await page.waitForSelector('button:has-text("Too tired")');
    await noOverflow(page, 'today');
  });

  await step('editing a habit', async () => {
    await go('#/habits');
    await page.getByRole('button', { name: /^🏋️ Gym|Gym/ }).first().click();
    await page.waitForSelector('text=Edit habit');
    await noOverflow(page, 'editor');
    await page.fill('input[placeholder="e.g. Gym"]', 'Gym session');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForSelector('text=Gym session');
  });

  await step('importing a schedule adds several habits at once', async () => {
    await page.getByRole('button', { name: /Import a whole schedule/ }).click();
    await page.fill('textarea', 'French class Tue/Thu 19h30\nRead daily 22:00');
    await page.waitForSelector('text=2 found');
    await page.getByRole('button', { name: 'Add 2 habits' }).click();
    await page.waitForSelector('text=Active · 3');
    await noOverflow(page, 'habits');
  });

  await step('settings: theme switch and demo data', async () => {
    await go('#/settings');
    await noOverflow(page, 'settings');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.getByRole('radio', { name: 'Auto' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === undefined);
    await page.getByRole('button', { name: 'Load demo data' }).click();
    await page.getByRole('button', { name: 'Load demo', exact: true }).click();
    await page.waitForSelector('text=Demo data loaded.');
  });

  await step('weekly report: hero, insights, four charts with table views', async () => {
    await go('#/insights');
    await page.waitForSelector('text=Showed up');
    const insights = await page.locator('section:has-text("Insights") ~ div article, h2:has-text("Insights") ~ * article').count();
    const cards = await page.locator('article').count();
    assert.ok(cards >= 3, `expected insight cards, got ${cards} (${insights})`);
    assert.equal(await page.locator('figure').count(), 4);
    await page.locator('figure').first().getByRole('button', { name: 'Table' }).click();
    await page.locator('figure').first().locator('table').waitFor();
    await noOverflow(page, 'insights');
    await page.getByRole('button', { name: 'Previous week' }).click();
    await page.waitForSelector('text=28 Sept – 4 Oct');
  });

  await step('calendar: month heatmap and day details', async () => {
    await go('#/calendar');
    await page.getByRole('gridcell', { name: /Friday 2 October/ }).click();
    await page.getByRole('dialog').waitFor();
    assert.ok((await page.getByRole('dialog').locator('article').count()) >= 2);
    await page.keyboard.press('Escape');
    await noOverflow(page, 'calendar');
  });

  await step('notification deep link opens the big Yes/No screen', async () => {
    await go('#/checkin/demo-read/2026-10-04');
    await page.waitForSelector('text=Read 20 pages: did you show up?');
    await page.getByRole('button', { name: /^Yes/ }).click();
    await page.waitForSelector('text=Yes, logged.');
  });

  await step('#/demo does not overwrite existing habits', async () => {
    await go('#/demo');
    await page.waitForSelector('text=You already have habits');
  });

  await step('every visible control has an accessible name', async () => {
    for (const hash of ['#/', '#/calendar', '#/insights', '#/habits', '#/settings']) {
      await go(hash);
      assert.deepEqual(await unnamedButtons(page), [], `unnamed controls on ${hash}`);
    }
  });

  await step('erase everything returns to onboarding', async () => {
    await go('#/settings');
    await page.getByRole('button', { name: 'Erase everything' }).click();
    await page.getByRole('button', { name: 'Erase', exact: true }).click();
    await go('#/');
    await page.waitForSelector('text=Did you show up today?');
  });

  await step('dark mode and desktop layouts render without overflow', async () => {
    const dark = await newPage({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
    await dark.goto(web.url + '#/demo');
    await dark.waitForSelector('text=Showed up');
    await noOverflow(dark, 'desktop insights');
    assert.ok(await dark.locator('aside nav').isVisible(), 'sidebar visible on desktop');
    assert.deepEqual(dark.errors, []);
  });

  assert.deepEqual(page.errors, [], 'no console errors');
  console.log(`\nApp E2E passed: ${results.length} checks.`);
} catch (err) {
  failed = true;
  console.error('\nApp E2E FAILED:', err?.message ?? err);
} finally {
  await browser.close();
  web.stop();
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}

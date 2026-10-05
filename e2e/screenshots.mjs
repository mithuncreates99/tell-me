#!/usr/bin/env node
/**
 * Regenerates the README screenshots in docs/screenshots from the demo data.
 *   npm i --no-save sharp && node e2e/screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright, ROOT, startWeb } from './lib.mjs';

const OUT = join(ROOT, 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

const web = await startWeb(4178, { outDir: 'dist-e2e-ui' });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chromium' });

const only = process.env.ONLY_HERO === '1';
async function shoot({ name, at, hash, viewport = { width: 390, height: 844 }, scale = 2, dark = false, prepare }) {
  if (only) return;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    timezoneId: 'Europe/Paris',
    locale: 'en-GB',
    reducedMotion: 'reduce',
    colorScheme: dark ? 'dark' : 'light',
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(at));
  await page.goto(web.url + '#/demo');
  await page.waitForSelector('text=Showed up');
  await page.goto(web.url + hash);
  await page.waitForTimeout(400);
  // Product shots: hide the toast and the "Sample data" notice (the data in them is the demo set).
  await page.evaluate(() => document.querySelectorAll('[role=status], section[aria-label="Sample data"]').forEach((e) => e.remove()));
  if (prepare) await prepare(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await context.close();
  console.log('  saved', name);
}

const THURSDAY = '2026-10-08T19:40:00+02:00';
const SUNDAY = '2026-10-11T20:10:00+02:00';
const dismissPromo = async (page) => {
  const close = page.getByRole('button', { name: 'Dismiss' });
  if (await close.count()) await close.click();
};

await shoot({ name: 'today', at: THURSDAY, hash: '#/', prepare: dismissPromo });
await shoot({ name: 'report', at: SUNDAY, hash: '#/insights' });
await shoot({
  name: 'report-charts',
  at: SUNDAY,
  hash: '#/insights',
  prepare: (page) => page.evaluate(() => document.querySelector('figure')?.scrollIntoView({ block: 'start' })),
});
await shoot({ name: 'calendar', at: SUNDAY, hash: '#/calendar' });
await shoot({ name: 'checkin', at: THURSDAY, hash: '#/checkin/demo-french/2026-10-08' });
await shoot({
  name: 'quick-add',
  at: THURSDAY,
  hash: '#/habits',
  prepare: (page) => page.fill('#quick-add', 'Swim Tue Thu 7am'),
});
await shoot({ name: 'report-dark', at: SUNDAY, hash: '#/insights', dark: true });
await shoot({ name: 'desktop', at: SUNDAY, hash: '#/insights', viewport: { width: 1280, height: 820 }, scale: 1.5 });

await browser.close();
web.stop();

// Compose the README hero: three phones side by side.
const sharp = (await import(process.env.SHARP_PATH ?? 'sharp')).default;
const W = 780;
const H = 1688;
const radius = 64;
const mask = Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="${radius}" fill="#fff"/></svg>`);
const phone = async (file) =>
  sharp(join(OUT, file)).resize(W, H).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
const shots = await Promise.all(['today.png', 'checkin.png', 'report.png'].map(phone));
const gap = 90;
const pad = 120;
const canvasW = pad * 2 + W * 3 + gap * 2;
const canvasH = H + pad * 2;
const bg = Buffer.from(`<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ece9fd"/><stop offset="1" stop-color="#d9d3fb"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="28"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  ${[0, 1, 2].map((i) => `<rect x="${pad + i * (W + gap) + 10}" y="${pad + 36}" width="${W - 20}" height="${H - 20}" rx="${radius}" fill="rgba(46,24,140,0.28)" filter="url(#shadow)"/>`).join('')}
</svg>`);
const full = await sharp(bg)
  .composite(shots.map((input, i) => ({ input, left: pad + i * (W + gap), top: pad })))
  .png()
  .toBuffer();
// (sharp applies resize before composite inside one pipeline, so scale down in a second pass)
await sharp(full).resize(Math.round(canvasW / 2)).png().toFile(join(OUT, 'hero.png'));
console.log('  saved hero');
process.exit(0);

#!/usr/bin/env node
/**
 * An installed app is usually resumed, not reopened, so it must find new versions by itself.
 * Two builds (A and B) are served from one address: the app opens on A, the server switches to B,
 * the app goes to the background and comes back, and it has to end up running B without anyone
 * reloading it.
 *
 *   node e2e/update.e2e.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { check, env, loadPlaywright, sleep, WEB_DIR } from './lib.mjs';

const PORT = 4175;
const results = [];
const step = check(results);

/** Two builds that differ only in their source-code link, so their bundles (and service workers) differ. */
function build(outDir, repoUrl) {
  if (process.env.SKIP_WEB_BUILD && existsSync(join(WEB_DIR, outDir))) return join(WEB_DIR, outDir);
  execFileSync('npx', ['vite', 'build', '--outDir', outDir], {
    cwd: WEB_DIR,
    env: { ...env, VITE_API_URL: '', VITE_STARTER_HABITS: 'off', VITE_REPO_URL: repoUrl },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return join(WEB_DIR, outDir);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

console.log('Building two versions of the app…');
const versionA = build('dist-e2e-update-a', 'https://example.com/a');
const versionB = build('dist-e2e-update-b', 'https://example.com/b');
let root = versionA;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${PORT}/`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chromium' });
let failed = false;

const bundleOf = (dir) => readFileSync(join(dir, 'index.html'), 'utf8').match(/assets\/(index-[\w-]+\.js)/)[1];
const runningBundle = (page) => page.evaluate(() => document.querySelector('script[src*="assets/index-"]')?.getAttribute('src')?.split('/').pop() ?? null);
/** The app leaves the screen and comes back, the way a phone resumes an installed app. */
const resume = (page) =>
  page.evaluate(() => {
    const set = (state) => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    set('hidden');
    set('visible');
  });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await step('the app opens on version A and the service worker takes over', async () => {
    await page.goto(url);
    await page.waitForSelector('text=Did you show up today?');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    assert.equal(await runningBundle(page), bundleOf(versionA));
  });

  await step('version B is published while the app stays open: nothing changes yet', async () => {
    root = versionB;
    await sleep(1500);
    assert.equal(await runningBundle(page), bundleOf(versionA));
  });

  await step('coming back to the app finds version B and reloads into it by itself', async () => {
    await resume(page);
    for (let i = 0; i < 100 && (await runningBundle(page).catch(() => null)) !== bundleOf(versionB); i++) await sleep(200);
    assert.equal(await runningBundle(page), bundleOf(versionB));
    await page.waitForSelector('text=Did you show up today?');
  });

  assert.deepEqual(errors, [], 'no uncaught page errors');
  console.log(`\nUpdate E2E passed: ${results.length} checks.`);
} catch (err) {
  failed = true;
  console.error('\nUpdate E2E FAILED:', err?.message ?? err);
} finally {
  await browser.close();
  server.close();
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}

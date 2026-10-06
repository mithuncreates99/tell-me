#!/usr/bin/env node
/**
 * One-command deploy of the Tell Me server to Cloudflare (used by .github/workflows/deploy-api.yml,
 * also works locally with CLOUDFLARE_API_TOKEN set). Safe to run again and again:
 *
 *   1. finds the account (and registers a workers.dev subdomain if there is none yet)
 *   2. creates the D1 database "tell-me" if needed and applies migrations
 *   3. deploys the worker (cron trigger + LiveHub Durable Object)
 *   4. creates the VAPID key pair once and stores it as worker secrets
 *   5. checks /api/health and /api/config, and prints the server URL
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountId, cf, describe, workersSubdomain } from './cloudflare.mjs';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'tell-me-api';
const DB_NAME = 'tell-me';
const log = (msg) => console.log(`▸ ${msg}`);

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: API_DIR,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function main() {
  const account = await accountId();
  process.env.CLOUDFLARE_ACCOUNT_ID = account;
  log(`Cloudflare account ${account.slice(0, 6)}…`);

  // 1. workers.dev subdomain (new accounts may not have one yet)
  let subdomain = await workersSubdomain(account);
  if (!subdomain) {
    const owner = (process.env.GITHUB_REPOSITORY_OWNER || 'tell-me').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'tell-me';
    for (const candidate of [owner, `${owner}-tellme`, `tellme-${Math.random().toString(36).slice(2, 8)}`]) {
      const r = await cf(`/accounts/${account}/workers/subdomain`, { method: 'PUT', body: { subdomain: candidate } });
      if (r.ok) {
        subdomain = candidate;
        log(`Registered workers.dev subdomain "${candidate}"`);
        break;
      }
      log(`Subdomain "${candidate}" not available (${describe(r)})`);
    }
    if (!subdomain) throw new Error('Could not register a workers.dev subdomain. Open Workers & Pages in the Cloudflare dashboard once, then re-run.');
  }

  // 2. D1 database + migrations
  const list = await cf(`/accounts/${account}/d1/database?name=${DB_NAME}`);
  if (!list.ok) throw new Error(`Could not list D1 databases (${describe(list)}). Does the token have "D1: Edit"?`);
  let dbId = list.result.find((d) => d.name === DB_NAME)?.uuid;
  if (!dbId) {
    const created = await cf(`/accounts/${account}/d1/database`, { method: 'POST', body: { name: DB_NAME } });
    if (!created.ok) throw new Error(`Could not create the D1 database (${describe(created)})`);
    dbId = created.result.uuid;
    log(`Created D1 database ${DB_NAME}`);
  }
  const config = readFileSync(join(API_DIR, 'wrangler.toml'), 'utf8').replace(
    /database_id = "[^"]*"/,
    `database_id = "${dbId}"`,
  );
  writeFileSync(join(API_DIR, 'wrangler.deploy.toml'), config);
  log('Applying database migrations');
  wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote', '-c', 'wrangler.deploy.toml']);

  // 3. deploy the worker
  log('Deploying the worker');
  const out = wrangler(['deploy', '-c', 'wrangler.deploy.toml']);
  const url = out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0] ?? `https://${SCRIPT}.${subdomain}.workers.dev`;

  // 4. VAPID keys, created once (rotating them would break every existing push subscription)
  const secrets = await cf(`/accounts/${account}/workers/scripts/${SCRIPT}/secrets`);
  if (!secrets.ok) throw new Error(`Could not read the worker's secrets (${describe(secrets)}), so the VAPID keys were left alone.`);
  const names = new Set(secrets.result.map((s) => s.name));
  if (names.has('VAPID_PRIVATE_KEY') !== names.has('VAPID_PUBLIC_KEY')) {
    // Older setups kept the public key in wrangler.toml. A new pair would silently break every
    // existing push subscription, so ask for the missing half instead.
    throw new Error(
      'Only one of VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is set. Add the missing one with `npx wrangler secret put` (same key pair), then re-run.',
    );
  }
  if (!names.has('VAPID_PRIVATE_KEY')) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
    for (const [name, text] of [['VAPID_PUBLIC_KEY', publicKey], ['VAPID_PRIVATE_KEY', privateKey]]) {
      const r = await cf(`/accounts/${account}/workers/scripts/${SCRIPT}/secrets`, { method: 'PUT', body: { name, text, type: 'secret_text' } });
      if (!r.ok) throw new Error(`Could not store ${name} (${describe(r)})`);
    }
    log('Created the VAPID key pair (stored as worker secrets)');
  } else {
    log('VAPID keys already set');
  }

  // 5. smoke test (a brand-new workers.dev subdomain can take a few minutes to come online)
  let healthy = false;
  for (let i = 0; i < 36 && !healthy; i++) {
    try {
      const [health, cfg] = await Promise.all([fetch(`${url}/api/health`), fetch(`${url}/api/config`)]);
      healthy = health.ok && cfg.ok && Boolean((await cfg.json()).vapidPublicKey);
    } catch {
      /* not reachable yet */
    }
    if (!healthy) await new Promise((r) => setTimeout(r, 5000));
  }
  log(healthy ? `Server is up: ${url}` : `Deployed to ${url}, but it isn't answering yet (new subdomains can take a few minutes).`);

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Tell Me server deployed\n\n- URL: ${url}\n- Health: ${healthy ? '✅ up' : '⏳ not answering yet'}\n- Database: D1 \`${DB_NAME}\`, migrations applied\n`,
    );
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});

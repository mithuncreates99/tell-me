// Shared helpers for the end-to-end tests: local servers, a mock push service, and key material.
import { spawn, execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ece from '../api/node_modules/http_ece/ece.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const API_DIR = join(ROOT, 'api');
export const WEB_DIR = join(ROOT, 'web');
export const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', WRANGLER_SEND_METRICS: 'false' };
export const b64url = (b) => Buffer.from(b).toString('base64url');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadPlaywright() {
  const mod = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
  return mod.chromium ? mod : mod.default;
}

export async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d,
    verifyKey: pair.publicKey,
  };
}

/** A fake browser push subscription whose private key we hold, so we can decrypt what the server sends. */
export function subscriptionKeys(port, path) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, endpoint: `http://127.0.0.1:${port}${path}`, p256dh: b64url(ecdh.getPublicKey()), authB64: b64url(auth), path };
}

/** Mock push service: verifies VAPID, decrypts aes128gcm payloads and records them. */
export async function startMockPushService(port, vapid) {
  const subs = new Map();
  const received = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const sub = subs.get(req.url);
      if (!sub) return res.writeHead(410).end();
      try {
        const [, jwt] = req.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
        const [h, p, s] = jwt.split('.');
        const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.verifyKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
        if (!ok) throw new Error('bad VAPID signature');
        const plain = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: sub.ecdh, authSecret: sub.auth });
        received.push({ path: req.url, payload: JSON.parse(plain.toString()), headers: req.headers });
        res.writeHead(201).end();
      } catch (err) {
        console.error('mock push service rejected a request:', err);
        res.writeHead(400).end(String(err));
      }
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { add: (s) => subs.set(s.path, s), received, close: () => server.close() };
}

export function spawnGroup(cmd, args, opts) {
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return {
    child,
    log: () => log,
    kill: () => {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    },
  };
}

export async function waitForHttp(url, what, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`${what} did not start (${url})`);
}

/** Runs the worker locally with a fresh D1 database. */
export async function startWorker(port, vapid) {
  const persist = mkdtempSync(join(tmpdir(), 'tell-me-e2e-d1-'));
  const wrangler = (args) => execFileSync('npx', ['wrangler', ...args, '--persist-to', persist], { cwd: API_DIR, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  wrangler(['d1', 'migrations', 'apply', 'tell-me', '--local']);
  const proc = spawnGroup('npx', [
    'wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist, '--test-scheduled',
    '--var', `VAPID_PUBLIC_KEY:${vapid.publicKey}`,
    '--var', `VAPID_PRIVATE_KEY:${vapid.privateKey}`,
    '--var', 'VAPID_SUBJECT:mailto:e2e@example.com',
    '--var', 'ALLOW_ANY_PUSH_ENDPOINT:true',
  ], { cwd: API_DIR });
  await waitForHttp(`http://127.0.0.1:${port}/api/health`, 'wrangler dev');
  const sql = (command) => JSON.parse(wrangler(['d1', 'execute', 'tell-me', '--local', '--json', '--command', command]))[0].results;
  return {
    sql,
    tick: async () => {
      for (let i = 0; i < 2; i++) {
        try {
          return await fetch(`http://127.0.0.1:${port}/__scheduled?cron=*+*+*+*+*`);
        } catch {
          await sleep(200);
        }
      }
    },
    log: proc.log,
    stop: () => {
      proc.kill();
      rmSync(persist, { recursive: true, force: true });
    },
  };
}

/** Builds the web app (optionally pointing at an API) and serves it with `vite preview`. */
export async function startWeb(port, { apiUrl = '', outDir = 'dist-e2e', mode } = {}) {
  if (!process.env.SKIP_WEB_BUILD || !existsSync(join(WEB_DIR, outDir))) {
    execFileSync('npx', ['vite', 'build', '--outDir', outDir, ...(mode ? ['--mode', mode] : [])], {
      cwd: WEB_DIR,
      env: { ...env, VITE_API_URL: apiUrl },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  }
  const proc = spawnGroup('npx', ['vite', 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: WEB_DIR });
  await waitForHttp(`http://127.0.0.1:${port}/`, 'vite preview');
  return { url: `http://127.0.0.1:${port}/`, stop: proc.kill };
}

export function check(results) {
  return async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      results.push({ name, ok: false, err });
      console.log(`  ✗ ${name}\n    ${err?.stack ?? err}`);
      throw err;
    }
  };
}

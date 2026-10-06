/**
 * Runs the worker locally for tests: a fresh local D1 database with all migrations, `wrangler dev`
 * (Durable Objects included), and a mock push service that verifies VAPID and decrypts every push
 * with the subscription's private key, exactly like a browser + push service would.
 * Used by integration-test.mjs and privacy-test.mjs.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import ece from 'http_ece';

export const b64url = (b) => Buffer.from(b).toString('base64url');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A random auth secret, like the one an app derives from a new account key. */
export const secret = () => b64url(randomBytes(32));

/**
 * Checks with a pass count, printed as they go. A failure stops the run, unless KEEP_GOING=1:
 * then every check runs and `failed` lists the ones that didn't pass.
 */
export function checklist() {
  let passed = 0;
  const failed = [];
  return {
    get passed() {
      return passed;
    },
    failed,
    section: (title) => console.log(`\n${title}`),
    step: async (name, fn) => {
      try {
        await fn();
      } catch (err) {
        if (!process.env.KEEP_GOING) throw err;
        failed.push(name);
        console.log(`  ✗ ${name}\n      ${String(err?.message ?? err).split('\n')[0]}`);
        return;
      }
      passed++;
      console.log(`  ✓ ${name}`);
    },
  };
}

export async function startLocalServer({ apiPort, pushPort }) {
  const API = `http://127.0.0.1:${apiPort}`;
  const persistDir = mkdtempSync(join(tmpdir(), 'tell-me-d1-'));
  const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', WRANGLER_SEND_METRICS: 'false' };

  // ---------- VAPID keys for this run ----------
  const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapidPublic = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', vapidPair.publicKey)));
  const vapidPrivate = (await crypto.subtle.exportKey('jwk', vapidPair.privateKey)).d;

  // ---------- Mock push service ----------
  const subscriptions = new Map(); // path -> { ecdh, auth, gone }
  const received = [];
  const pushServer = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const sub = subscriptions.get(req.url);
      if (!sub || sub.gone) {
        res.writeHead(410).end('gone');
        return;
      }
      try {
        const [, jwt, k] = req.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
        const [h, p, s] = jwt.split('.');
        const ok = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          vapidPair.publicKey,
          Buffer.from(s, 'base64url'),
          new TextEncoder().encode(`${h}.${p}`),
        );
        assert.equal(ok, true, 'VAPID signature');
        assert.equal(k, vapidPublic);
        assert.equal(req.headers['content-encoding'], 'aes128gcm');
        const plain = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: sub.ecdh, authSecret: sub.auth });
        received.push({ path: req.url, headers: req.headers, payload: JSON.parse(plain.toString()) });
        res.writeHead(201).end();
      } catch (err) {
        console.error('mock push service rejected request:', err);
        res.writeHead(400).end(String(err));
      }
    });
  });
  await new Promise((r) => pushServer.listen(pushPort, '127.0.0.1', r));

  function newSubscription(name) {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = randomBytes(16);
    const path = `/push/${name}`;
    subscriptions.set(path, { ecdh, auth });
    return {
      path,
      subscription: {
        endpoint: `http://127.0.0.1:${pushPort}${path}`,
        expirationTime: null,
        keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) },
      },
    };
  }

  // ---------- Local D1 + wrangler dev ----------
  const wrangler = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args, '--persist-to', persistDir], { env, encoding: 'utf8', ...opts });
  /** Results of every statement in `command` (separated by semicolons). */
  const sqlAll = (command) => {
    const out = wrangler(['d1', 'execute', 'tell-me', '--local', '--json', '--command', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out).map((r) => r.results);
  };
  const sql = (command) => sqlAll(command)[0];

  console.log('Applying migrations to a fresh local D1 database…');
  wrangler(['d1', 'migrations', 'apply', 'tell-me', '--local'], { stdio: ['ignore', 'ignore', 'inherit'] });

  console.log('Starting wrangler dev…');
  const dev = spawn(
    'npx',
    [
      'wrangler', 'dev', '--port', String(apiPort), '--ip', '127.0.0.1', '--persist-to', persistDir, '--test-scheduled',
      '--var', `VAPID_PUBLIC_KEY:${vapidPublic}`,
      '--var', `VAPID_PRIVATE_KEY:${vapidPrivate}`,
      '--var', 'VAPID_SUBJECT:mailto:test@example.com',
      '--var', 'ALLOW_ANY_PUSH_ENDPOINT:true',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let devLog = '';
  dev.stdout.on('data', (d) => (devLog += d));
  dev.stderr.on('data', (d) => (devLog += d));

  const stop = () => {
    try {
      process.kill(-dev.pid, 'SIGTERM'); // the whole process group: npx -> wrangler -> workerd
    } catch {}
    pushServer.close();
    rmSync(persistDir, { recursive: true, force: true });
  };

  // wrangler dev occasionally drops a kept-alive socket between requests; retry once.
  const fetchRetry = async (url, init) => {
    try {
      return await fetch(url, init);
    } catch {
      await sleep(200);
      return fetch(url, init);
    }
  };
  const api = (path, { token, headers, ...init } = {}) =>
    fetchRetry(`${API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });

  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`${API}/api/health`)).ok) break;
      } catch {}
      if (i >= 120) throw new Error('wrangler dev did not start');
      await sleep(500);
    }
  } catch (err) {
    console.error(devLog);
    stop();
    throw err;
  }

  const json = async (res) => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`not JSON (${res.status}): ${text.slice(0, 200)}`);
    }
  };

  /** A live connection, like an open app. `log` keeps every event it ever received. */
  const live = (token) => {
    const messages = [];
    const log = [];
    const ws = new WebSocket(`ws://127.0.0.1:${apiPort}/api/live`, ['tell-me.v1', `auth.${token}`]);
    const opened = new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
    });
    const closed = new Promise((resolve) => ws.addEventListener('close', (e) => resolve({ code: e.code, reason: e.reason }), { once: true }));
    ws.addEventListener('message', (e) => {
      const event = JSON.parse(String(e.data));
      messages.push(event);
      log.push(event);
    });
    return {
      ws,
      messages,
      log,
      opened,
      closed,
      next: async (t) => {
        for (let i = 0; i < 60; i++) {
          const idx = messages.findIndex((m) => m.t === t);
          if (idx >= 0) return messages.splice(idx, 1)[0];
          await sleep(100);
        }
        throw new Error(`timed out waiting for live "${t}" event (got ${JSON.stringify(messages)})`);
      },
    };
  };

  const waitFor = async (pred, what) => {
    for (let i = 0; i < 40; i++) {
      if (pred()) return;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  return {
    API,
    apiPort,
    vapidPublic,
    api,
    authed: (path, token, init = {}) => api(path, { ...init, token }),
    json,
    live,
    sql,
    sqlAll,
    tick: () => fetchRetry(`${API}/__scheduled?cron=*+*+*+*+*`),
    received,
    newSubscription,
    markGone: (path) => (subscriptions.get(path).gone = true),
    waitFor,
    devLog: () => devLog,
    stop,
  };
}

import { createECDH, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Mozilla's reference implementation of HTTP Encrypted Content-Encoding, used here as an independent check.
// @ts-expect-error - no type definitions
import ece from 'http_ece';
import type { Env } from '../src/env';
import { classifyStatus, sendPush, topicFor } from '../src/push';

const b64url = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');

async function makeVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64url(raw), privateKey: jwk.d!, verifyKey: pair.publicKey };
}

function makeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, target: { endpoint, p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } };
}

afterEach(() => vi.unstubAllGlobals());

describe('sendPush', () => {
  it('encrypts with aes128gcm (RFC 8291) and signs a valid VAPID JWT (RFC 8292)', async () => {
    const vapid = await makeVapid();
    const sub = makeSubscription();
    const env = {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: 'mailto:test@example.com',
    } as Env;

    let captured: { url: string; headers: Headers; body: Uint8Array } | undefined;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, headers: new Headers(init.headers), body: new Uint8Array(init.body as ArrayBuffer) };
      return new Response(null, { status: 201 });
    });

    const payload = {
      type: 'checkin' as const,
      habitId: 'gym123',
      date: '2026-10-05',
      title: 'Gym',
      emoji: '🏋️',
      time: '18:00',
    };
    const result = await sendPush(env, sub.target, payload);
    expect(result.outcome).toBe('ok');
    expect(captured!.url).toBe(sub.target.endpoint);

    // Headers
    expect(captured!.headers.get('content-encoding')).toBe('aes128gcm');
    expect(captured!.headers.get('ttl')).toBe(String(4 * 60 * 60));
    expect(captured!.headers.get('urgency')).toBe('high');
    expect(captured!.headers.get('topic')).toBe('h-gym123');
    expect(captured!.body.byteLength).toBeLessThanOrEqual(4096);

    // The browser side (receiver) can decrypt it.
    const plaintext = ece.decrypt(Buffer.from(captured!.body), {
      version: 'aes128gcm',
      privateKey: sub.ecdh,
      authSecret: sub.auth,
    });
    expect(JSON.parse(plaintext.toString('utf8'))).toEqual(payload);

    // VAPID: "vapid t=<jwt>, k=<public key>" with an ES256 signature over header.payload
    const auth = captured!.headers.get('authorization')!;
    const match = auth.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(match).not.toBeNull();
    const [, jwt, k] = match!;
    expect(k).toBe(vapid.publicKey);
    const [h, p, s] = jwt!.split('.');
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:test@example.com');
    expect(claims.exp - Date.now() / 1000).toBeLessThanOrEqual(24 * 3600);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapid.verifyKey,
      Buffer.from(s!, 'base64url'),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(valid).toBe(true);
  });

  it('maps push-service responses to outcomes', async () => {
    expect(classifyStatus(201)).toBe('ok');
    expect(classifyStatus(410)).toBe('gone');
    expect(classifyStatus(404)).toBe('gone');
    expect(classifyStatus(429)).toBe('retry');
    expect(classifyStatus(503)).toBe('retry');
    expect(classifyStatus(403)).toBe('error');
    expect(classifyStatus(413)).toBe('error');
  });

  it('treats network failures as retryable and bad keys as errors', async () => {
    const vapid = await makeVapid();
    const env = {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: 'mailto:test@example.com',
    } as Env;
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });
    expect((await sendPush(env, makeSubscription().target, { type: 'test' })).outcome).toBe('retry');

    const broken = { ...makeSubscription().target, p256dh: 'not-a-key' };
    expect((await sendPush(env, broken, { type: 'test' })).outcome).toBe('error');
  });

  it('builds safe topic names', () => {
    expect(topicFor('abc_DEF-123')).toBe('h-abc_DEF-123');
    expect(topicFor('x'.repeat(50))).toHaveLength(32);
  });
});

import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - no type definitions
import ece from 'http_ece';
import { base64UrlDecode, base64UrlEncode, encryptPayload, vapidAuthorization } from '../src/webpush';

const b64url = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');

async function makeVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64url(raw), privateKey: jwk.d!, subject: 'mailto:test@example.com' };
}

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(randomBytes(77));
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    expect(base64UrlEncode(bytes)).toBe(b64url(bytes));
  });
});

describe('encryptPayload (RFC 8291)', () => {
  it.each([0, 1, 126, 127, 128, 500, 2900])('decrypts with the reference implementation (%i bytes)', async (n) => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = randomBytes(16);
    const message = new Uint8Array(randomBytes(n));
    const body = await encryptPayload(message, b64url(ecdh.getPublicKey()), b64url(auth));
    // header (86 bytes) + padded record (multiple of 128) + 16-byte tag
    expect((body.length - 86 - 16) % 128).toBe(0);
    const decrypted = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth });
    expect(new Uint8Array(decrypted)).toEqual(message);
  });

  it('uses a fresh salt and key for every message', async () => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const args = [new Uint8Array([1, 2, 3]), b64url(ecdh.getPublicKey()), b64url(randomBytes(16))] as const;
    const a = await encryptPayload(...args);
    const b = await encryptPayload(...args);
    expect(Buffer.from(a.subarray(0, 86)).equals(Buffer.from(b.subarray(0, 86)))).toBe(false);
  });

  it('rejects malformed subscription keys', async () => {
    await expect(encryptPayload(new Uint8Array(1), 'abc', b64url(randomBytes(16)))).rejects.toThrow();
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    await expect(encryptPayload(new Uint8Array(1), b64url(ecdh.getPublicKey()), 'short')).rejects.toThrow();
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  it('caches the JWT per push service and signs per audience', async () => {
    const vapid = await makeVapid();
    const now = Date.parse('2026-10-05T18:00:00Z');
    const a1 = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/1', vapid, now);
    const a2 = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/2', vapid, now + 60_000);
    const b = await vapidAuthorization('https://web.push.apple.com/abc', vapid, now);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    const claims = JSON.parse(Buffer.from(b.split('t=')[1]!.split('.')[1]!, 'base64url').toString());
    expect(claims.aud).toBe('https://web.push.apple.com');
    // refreshed once it is within an hour of expiring
    const later = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/1', vapid, now + 11.5 * 3600_000);
    expect(later).not.toBe(a1);
  });
});

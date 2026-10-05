/**
 * Web Push with nothing but the Web Crypto API.
 *
 *  - RFC 8291 (Message Encryption for Web Push, "aes128gcm"): the payload is encrypted so that
 *    only the user's browser can read it; push services only see ciphertext.
 *  - RFC 8292 (VAPID): a short-lived ES256 JWT proves the push comes from *this* server.
 *
 * Signed JWTs and the imported signing key are cached per isolate, so a cron run that sends
 * many pushes mostly pays for one ECDH key agreement + AES-GCM per message.
 */

export interface VapidConfig {
  /** base64url uncompressed P-256 public key (65 bytes) */
  publicKey: string;
  /** base64url private scalar "d" (32 bytes) */
  privateKey: string;
  /** "mailto:..." or "https://..." */
  subject: string;
}

export interface WebPushRequest {
  headers: Record<string, string>;
  body: Uint8Array;
}

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
const PAD_TO = 128; // pad plaintext to a multiple of this, so length leaks less

export function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** RFC 8291 §3: encrypt one message for one subscription as a single aes128gcm record. */
export async function encryptPayload(plaintext: Uint8Array, p256dh: string, authSecret: string): Promise<Uint8Array> {
  const uaPublic = base64UrlDecode(p256dh);
  const auth = base64UrlDecode(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('p256dh is not an uncompressed P-256 point');
  if (auth.length !== 16) throw new Error('auth secret must be 16 bytes');
  if (plaintext.length > 3000) throw new Error('payload too large');

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // A fresh ephemeral key pair for every message.
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  // (cast: workers-types names this field `$public`, but the runtime reads `public`)
  const ecdhParams = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, local.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const ikm = await hkdf(auth, ecdhSecret, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // plaintext || 0x02 (last-record delimiter) || zero padding
  const padding = (PAD_TO - ((plaintext.length + 1) % PAD_TO)) % PAD_TO;
  const record = new Uint8Array(plaintext.length + 1 + padding);
  record.set(plaintext);
  record[plaintext.length] = 0x02;

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  // RFC 8188 header: salt (16) | record size (uint32) | key id length (1) | key id = our public key (65)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

const signingKeys = new Map<string, Promise<CryptoKey>>();
const jwtCache = new Map<string, { token: string; exp: number }>();

function signingKey(vapid: VapidConfig): Promise<CryptoKey> {
  let key = signingKeys.get(vapid.privateKey);
  if (!key) {
    const pub = base64UrlDecode(vapid.publicKey);
    if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID public key must be an uncompressed P-256 point');
    key = crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: base64UrlEncode(pub.subarray(1, 33)),
        y: base64UrlEncode(pub.subarray(33, 65)),
        d: vapid.privateKey,
        ext: true,
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    key.catch(() => signingKeys.delete(vapid.privateKey));
    signingKeys.set(vapid.privateKey, key);
  }
  return key;
}

/** RFC 8292: `Authorization: vapid t=<ES256 JWT>, k=<public key>` for the endpoint's origin. */
export async function vapidAuthorization(endpoint: string, vapid: VapidConfig, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cacheKey = `${aud} ${vapid.subject} ${vapid.publicKey}`;
  const nowSec = Math.floor(now / 1000);
  let cached = jwtCache.get(cacheKey);
  if (!cached || cached.exp - nowSec < 60 * 60) {
    const exp = nowSec + 12 * 60 * 60; // must be < 24h
    const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = base64UrlEncode(encoder.encode(JSON.stringify({ aud, exp, sub: vapid.subject })));
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await signingKey(vapid),
      encoder.encode(`${header}.${claims}`),
    );
    cached = { token: `${header}.${claims}.${base64UrlEncode(signature)}`, exp };
    jwtCache.set(cacheKey, cached);
  }
  return `vapid t=${cached.token}, k=${vapid.publicKey}`;
}

export async function buildWebPushRequest(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: unknown,
  vapid: VapidConfig,
  options: { ttl: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string },
): Promise<WebPushRequest> {
  const body = await encryptPayload(encoder.encode(JSON.stringify(payload)), subscription.p256dh, subscription.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(subscription.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttl),
  };
  if (options.urgency) headers.Urgency = options.urgency;
  if (options.topic) headers.Topic = options.topic;
  return { headers, body };
}

/**
 * Accounts without emails or passwords.
 *
 * An account is a random 160-bit key that only the user's devices hold, shown as
 * 8 groups of 4 characters (ABCD-EFGH-…). Everything else is derived from it with HKDF:
 *
 *   auth  → sent to the server, which stores only its SHA-256 (identifies the account)
 *   enc   → AES-256-GCM key that encrypts every synced habit and check-in (never leaves the device)
 *   ids   → HMAC key that turns record ids into opaque ids, so the server can't even see dates
 *
 * Adding a device = entering the key there. Losing every device and the key = losing the account,
 * which is the price of the server never being able to read your data.
 */
import { deleteKV, getKV, setKV } from './db';

export interface Profile {
  id: string;
  name: string;
  emoji: string;
  friendCode: string;
  timeZone: string;
  createdAt: number;
}

export interface AccountRecord {
  /** The account key, 32 base32 characters without dashes. */
  key: string;
  profile: Profile;
  /** Push device linked to this account on the server (for friends' nudges). */
  linkedDeviceId?: string;
}

export interface AccountKeys {
  /** base64url, sent as `Authorization: Bearer …` */
  auth: string;
  enc: CryptoKey;
  ids: CryptoKey;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32
const KEY_BYTES = 20;
const enc = new TextEncoder();

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('invalid base32');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  bytes.set(out);
  return bytes;
}

export const toBase64Url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export function generateAccountKey(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/** "ABCDEFGH…" → "ABCD-EFGH-…" */
export const formatKey = (key: string) => key.match(/.{1,4}/g)!.join('-');

/** Accepts the key however it was copied: lower case, spaces, dashes, 0/1/8 for O/I/B. */
export function parseKey(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/8/g, 'B');
  if (cleaned.length !== 32 || [...cleaned].some((c) => !ALPHABET.includes(c))) return null;
  return cleaned;
}

const SALT = enc.encode('tell-me/v1');
const cache = new Map<string, Promise<AccountKeys>>();

export function deriveKeys(key: string): Promise<AccountKeys> {
  let keys = cache.get(key);
  if (!keys) {
    keys = (async () => {
      const ikm = await crypto.subtle.importKey('raw', base32Decode(key), 'HKDF', false, ['deriveBits', 'deriveKey']);
      const params = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) });
      const [auth, encKey, ids] = await Promise.all([
        crypto.subtle.deriveBits(params('auth'), ikm, 256),
        crypto.subtle.deriveKey(params('enc'), ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
        crypto.subtle.deriveKey(params('ids'), ikm, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
      ]);
      return { auth: toBase64Url(auth), enc: encKey, ids };
    })();
    cache.set(key, keys);
  }
  return keys;
}

/** Deterministic opaque id: the same record gets the same id on every device. */
export async function opaqueId(keys: AccountKeys, kind: string, id: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', keys.ids, enc.encode(`${kind}:${id}`));
  return toBase64Url(new Uint8Array(mac).slice(0, 16));
}

/** AES-256-GCM with a random IV; the record's identity is bound in as associated data. */
export async function seal(keys: AccountKeys, kind: string, opaque: string, payload: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(`${kind}:${opaque}`) },
    keys.enc,
    enc.encode(JSON.stringify(payload)),
  );
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return toBase64Url(out);
}

export async function open<T>(keys: AccountKeys, kind: string, opaque: string, blob: string): Promise<T> {
  const bytes = fromBase64Url(blob);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: enc.encode(`${kind}:${opaque}`) },
    keys.enc,
    bytes.slice(12),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ---------- storage ----------

export const loadAccount = () => getKV<AccountRecord>('account');
export const saveAccount = (account: AccountRecord) => setKV('account', account);
/** Forgets the account on this device (sync state included). */
export const forgetAccount = () => deleteKV('account', 'sync', 'share');

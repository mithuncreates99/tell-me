import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  deriveKeys,
  formatKey,
  generateAccountKey,
  open,
  opaqueId,
  parseKey,
  seal,
  toBase64Url,
} from '../src/lib/account';

describe('account key', () => {
  it('is 160 random bits as 32 base32 characters', () => {
    const key = generateAccountKey();
    expect(key).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(key)).toHaveLength(20);
    expect(generateAccountKey()).not.toBe(key);
  });

  it('round-trips base32', () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i * 13);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('is shown in groups of four and parsed however it was copied', () => {
    const key = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    expect(formatKey(key)).toBe('ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567');
    expect(parseKey('abcd-efgh-ijkl-mnop-qrst-uvwx-yz23-4567')).toBe(key);
    expect(parseKey(' ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567 ')).toBe(key);
    expect(parseKey('ABCD-EFGH-1JKL-MN0P-QRST-UVWX-YZ23-4567')).toBe(key); // 1 → I, 0 → O
    expect(parseKey('ABCD-EFGH')).toBeNull();
    expect(parseKey('ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-456!')).toBeNull();
  });
});

describe('key derivation and encryption', () => {
  const key = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  it('derives the auth secret with HKDF-SHA256 (matches an independent implementation)', async () => {
    const { auth } = await deriveKeys(key);
    const expected = hkdfSync('sha256', base32Decode(key), Buffer.from('tell-me/v1'), Buffer.from('auth'), 32);
    expect(auth).toBe(toBase64Url(new Uint8Array(expected)));
    expect(auth).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('makes deterministic opaque ids that hide the real id', async () => {
    const keys = await deriveKeys(key);
    const a = await opaqueId(keys, 'c', 'gym:2026-10-05');
    expect(a).toBe(await opaqueId(keys, 'c', 'gym:2026-10-05'));
    expect(a).not.toBe(await opaqueId(keys, 'h', 'gym:2026-10-05'));
    expect(a).not.toContain('gym');
    expect(a).toHaveLength(22);
  });

  it('encrypts records so only the same key, for the same record, can read them', async () => {
    const keys = await deriveKeys(key);
    const blob = await seal(keys, 'h', 'opaque-1', { name: 'Gym' });
    expect(blob).not.toContain('Gym');
    expect(await open(keys, 'h', 'opaque-1', blob)).toEqual({ name: 'Gym' });
    await expect(open(keys, 'h', 'opaque-2', blob)).rejects.toThrow(); // moved to another record
    const other = await deriveKeys(generateAccountKey());
    await expect(open(other, 'h', 'opaque-1', blob)).rejects.toThrow();
    expect(await seal(keys, 'h', 'opaque-1', { name: 'Gym' })).not.toBe(blob); // random IV
  });
});

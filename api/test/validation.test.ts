import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from '../src/endpoints';
import { bearerToken, sha256Hex, timingSafeEqual } from '../src/auth';
import { putDeviceSchema } from '../src/validation';

const validBody = {
  subscription: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    expirationTime: null,
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  },
  timeZone: 'Europe/Paris',
  reminders: [
    { id: 'gym', kind: 'checkin', title: 'Gym', emoji: '🏋️', days: [1, 3, 5], time: '18:00', offsetMin: 60 },
    { id: 'weekly-report', kind: 'weekly', title: 'Weekly report', days: [0], time: '19:00' },
  ],
};

describe('request validation', () => {
  it('accepts a well-formed sync request and fills defaults', () => {
    const parsed = putDeviceSchema.parse(validBody);
    expect(parsed.reminders[1]).toMatchObject({ emoji: '', offsetMin: 0, skipDates: [] });
  });

  it('rejects bad input', () => {
    expect(putDeviceSchema.safeParse({ ...validBody, timeZone: 'Nowhere/Land' }).success).toBe(false);
    const dup = { ...validBody, reminders: [validBody.reminders[0], validBody.reminders[0]] };
    expect(putDeviceSchema.safeParse(dup).success).toBe(false);
    const badTime = { ...validBody, reminders: [{ ...validBody.reminders[0], time: '25:00' }] };
    expect(putDeviceSchema.safeParse(badTime).success).toBe(false);
    const noDays = { ...validBody, reminders: [{ ...validBody.reminders[0], days: [] }] };
    expect(putDeviceSchema.safeParse(noDays).success).toBe(false);
  });
});

describe('push endpoint allowlist', () => {
  it('accepts real push services only', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QK1')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isAllowedPushEndpoint('https://evil.example.com/collect')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('http://localhost:9999/push', true)).toBe(true);
  });
});

describe('auth helpers', () => {
  it('hashes and compares tokens', async () => {
    const a = await sha256Hex('secret-token');
    expect(a).toHaveLength(64);
    expect(timingSafeEqual(a, await sha256Hex('secret-token'))).toBe(true);
    expect(timingSafeEqual(a, await sha256Hex('other-token'))).toBe(false);
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('Basic abc')).toBeNull();
  });
});

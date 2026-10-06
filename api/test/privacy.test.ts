/**
 * Privacy rules that live in pure functions: what a friend's copy of a shared habit contains,
 * when friends are told about an update, how precise "last active" is, what a push service can
 * read, and what the server accepts. The full flows run against the real worker in
 * scripts/privacy-test.mjs.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { sendPush } from '../src/push';
import { coarseLastSeen, LAST_SEEN_STEP_MS, normalizeSharedHabit, visibleShare, type SharedHabitRow } from '../src/social';
import { putDeviceSchema, shareSchema } from '../src/validation';

const MON = 1 << 1;
const WED = 1 << 3;
const FRI = 1 << 5;
const paris = (iso: string) => Date.parse(`${iso}+02:00`);

function row(patch: Partial<SharedHabitRow> = {}): SharedHabitRow {
  return {
    user_id: 'user-aaaaaaaaaaa',
    habit_id: 'gym',
    name: 'Gym',
    emoji: '🏋️',
    color: 'blue',
    days: MON | WED | FRI,
    time: '18:00',
    ask_min: 19 * 60,
    date: '2026-10-05',
    week_start: '2026-10-05',
    week: 'Y.F.F..',
    streak: 3,
    best: 41,
    position: 0,
    updated_at: 1_759_650_000_123,
    ...patch,
  };
}

/** Everything a friend (or a challenge member) can ever learn about one shared habit. */
const FRIEND_VISIBLE_FIELDS = ['date', 'days', 'emoji', 'color', 'id', 'name', 'streak', 'time', 'today', 'week', 'weekStart'].sort();

describe("a friend's copy of a shared habit", () => {
  it('has exactly the fields friends are meant to see', () => {
    const view = normalizeSharedHabit(row(), 'Europe/Paris', paris('2026-10-05T20:00:00'));
    expect(Object.keys(view).sort()).toEqual(FRIEND_VISIBLE_FIELDS);
  });

  it("doesn't carry the owner's id, best streak, check-in deadline, position or exact update time", () => {
    const view = normalizeSharedHabit(row(), 'Europe/Paris', paris('2026-10-05T20:00:00'));
    const text = JSON.stringify(view);
    expect(text).not.toContain('user-aaaaaaaaaaa');
    expect(text).not.toContain('41'); // best streak
    expect(text).not.toContain('1140'); // ask_min
    expect(text).not.toContain('1759650000123'); // updated_at
    expect(view).not.toHaveProperty('best');
    expect(view).not.toHaveProperty('updatedAt');
  });
});

describe('when friends hear about an update', () => {
  const tz = 'Europe/Paris';

  it("a new day with nothing new to see doesn't count as a change", () => {
    // Monday's snapshot, and Tuesday's re-sent one: same habit, same answers.
    const monday = [row()];
    const tuesday = [row({ date: '2026-10-06', updated_at: paris('2026-10-06T07:00:00') })];
    const now = paris('2026-10-06T07:00:00');
    expect(visibleShare(tuesday, tz, now)).toBe(visibleShare(monday, tz, now));
  });

  it("a new time zone with the same local day doesn't count either", () => {
    const now = paris('2026-10-05T20:00:00');
    expect(visibleShare([row()], 'Europe/Berlin', now)).toBe(visibleShare([row()], tz, now));
  });

  it('an answer, a rename, a new habit or a different order does', () => {
    const now = paris('2026-10-08T20:00:00'); // Wednesday evening
    const before = [row({ date: '2026-10-08', week: 'Y.P.F..' }), row({ habit_id: 'read', name: 'Read', position: 1 })];
    const base = visibleShare(before, tz, now);
    expect(visibleShare([row({ date: '2026-10-08', week: 'Y.Y.F..' }), before[1]!], tz, now)).not.toBe(base);
    expect(visibleShare([{ ...before[0]!, name: 'Gym 💪' }, before[1]!], tz, now)).not.toBe(base);
    expect(visibleShare([...before, row({ habit_id: 'run', name: 'Run', position: 2 })], tz, now)).not.toBe(base);
    expect(visibleShare([{ ...before[1]!, position: 0 }, { ...before[0]!, position: 1 }], tz, now)).not.toBe(base);
    expect(visibleShare([before[0]!], tz, now)).not.toBe(base); // stopped sharing one
  });

  it('only what friends can see is compared (a different best streak changes nothing)', () => {
    const now = paris('2026-10-05T20:00:00');
    expect(visibleShare([row({ best: 99 })], tz, now)).toBe(visibleShare([row({ best: 1 })], tz, now));
  });
});

describe('"last active"', () => {
  it('is rounded down to 15 minutes', () => {
    const at = Date.parse('2026-10-05T18:07:31.456Z');
    expect(coarseLastSeen(at)).toBe(Date.parse('2026-10-05T18:00:00Z'));
    expect(coarseLastSeen(Date.parse('2026-10-05T18:29:59.999Z'))).toBe(Date.parse('2026-10-05T18:15:00Z'));
    expect(coarseLastSeen(null)).toBeNull();
    for (let i = 0; i < 50; i++) {
      const t = 1_759_000_000_000 + Math.floor(Math.random() * 10_000_000);
      expect(coarseLastSeen(t)! % LAST_SEEN_STEP_MS).toBe(0);
      expect(t - coarseLastSeen(t)!).toBeLessThan(LAST_SEEN_STEP_MS);
    }
  });
});

describe('what a push service can read', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function capture(payload: Parameters<typeof sendPush>[2]) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const env = {
      VAPID_PUBLIC_KEY: Buffer.from(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))).toString('base64url'),
      VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d!,
      VAPID_SUBJECT: 'mailto:test@example.com',
    } as Env;
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
    let sent: { headers: Headers; body: Uint8Array } | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = { headers: new Headers(init.headers), body: new Uint8Array(init.body as ArrayBuffer) };
      return new Response(null, { status: 201 });
    });
    await sendPush(env, target, payload);
    return sent!;
  }

  it("friends' notifications carry no Topic header (it would name who's interacting)", async () => {
    const sent = await capture({ type: 'social', title: '🦊 Arun nudged you', body: '🏋️ Gym: did you show up today?', path: '#/', tag: 'nudge-gym' });
    expect(sent.headers.get('topic')).toBeNull();
    const visible = [...sent.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
    for (const secret of ['Arun', 'Gym', 'nudge', 'gym']) expect(visible).not.toContain(secret);
  });

  it('the notification text is only inside the encrypted body', async () => {
    const sent = await capture({ type: 'social', title: '🐼 Bea reacted 🔥', body: 'to your 📚 Read', path: '#/friends', tag: 'reaction-x-read' });
    const body = Buffer.from(sent.body).toString('latin1');
    for (const secret of ['Bea', 'Read', 'reacted', '#/friends']) expect(body).not.toContain(secret);
  });
});

describe('what the server accepts', () => {
  const snapshot = {
    timeZone: 'Europe/Paris',
    date: '2026-10-05',
    weekStart: '2026-10-05',
    habits: [{ id: 'gym', name: 'Gym', emoji: '🏋️', color: 'blue', days: [1, 3, 5], time: '18:00', askMin: 1140, week: 'Y.F.F..', streak: 3 }],
  };

  it("a shared habit can't smuggle extra fields (notes, reasons) into storage", () => {
    const parsed = shareSchema.parse({ ...snapshot, habits: [{ ...snapshot.habits[0], note: 'felt awful', reason: 'hangover' }] });
    expect(JSON.stringify(parsed)).not.toContain('hangover');
    expect(JSON.stringify(parsed)).not.toContain('felt awful');
  });

  it("doesn't need the best streak any more (older apps may still send it)", () => {
    expect(shareSchema.safeParse(snapshot).success).toBe(true);
    expect(shareSchema.safeParse({ ...snapshot, habits: [{ ...snapshot.habits[0], best: 12 }] }).success).toBe(true);
  });

  it('limits what a friend-visible habit can contain', () => {
    const bad = (patch: object) => shareSchema.safeParse({ ...snapshot, habits: [{ ...snapshot.habits[0], ...patch }] }).success;
    expect(bad({ name: 'x'.repeat(61) })).toBe(false);
    expect(bad({ color: '<script>' })).toBe(false);
    expect(bad({ week: 'YYYYYYYY' })).toBe(false);
    expect(bad({ days: [] })).toBe(false);
    expect(shareSchema.safeParse({ ...snapshot, habits: Array.from({ length: 21 }, (_, i) => ({ ...snapshot.habits[0], id: `h${i}` })) }).success).toBe(false);
    expect(shareSchema.safeParse({ ...snapshot, event: { habitId: 'gym', answer: 'maybe' } }).success).toBe(false);
  });

  it('a device can say nobody is signed in on it', () => {
    const device = {
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } },
      timeZone: 'Europe/Paris',
      reminders: [],
    };
    expect(putDeviceSchema.parse({ ...device, signedIn: false }).signedIn).toBe(false);
    expect(putDeviceSchema.parse(device).signedIn).toBeUndefined();
  });
});

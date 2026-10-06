import { z } from 'zod';
import { normalizeFriendCode, REACTIONS } from './social';
import { isValidTimeZone } from './tz';

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, 'must be base64url');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
const timeZone = z.string().max(64).refine(isValidTimeZone, 'unknown time zone');
const isUnique = (keys: string[]) => new Set(keys).size === keys.length;

export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'invalid device id');
export const tokenSchema = z.string().min(32).max(128);

export const subscriptionSchema = z.object({
  // https + known push-service host is enforced separately (see endpoints.ts)
  endpoint: z.url().max(1024),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: base64url.min(80).max(100),
    auth: base64url.min(16).max(32),
  }),
});

export const reminderSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  kind: z.enum(['checkin', 'weekly']),
  title: z.string().trim().min(1).max(80),
  emoji: z.string().max(16).default(''),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  time: hhmm,
  offsetMin: z.number().int().min(0).max(720).default(0),
  skipDates: z.array(isoDate).max(14).default([]),
});

export const putDeviceSchema = z.object({
  subscription: subscriptionSchema,
  timeZone,
  reminders: z
    .array(reminderSchema)
    .max(64)
    .refine((rs) => isUnique(rs.map((r) => r.id)), 'duplicate reminder ids'),
});

export type PutDeviceBody = z.infer<typeof putDeviceSchema>;
export type ReminderInput = z.infer<typeof reminderSchema>;

// ---------- accounts ----------

/** 32 bytes, base64url: derived on the device from the account key (HKDF "auth"). */
export const authSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'invalid credentials');
export const userIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16}$/, 'invalid user id');
export const habitIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'invalid habit id');
const displayName = z.string().trim().min(1).max(30);
const emoji = z.string().trim().min(1).max(16);

export const createAccountSchema = z.object({ name: displayName, emoji, timeZone: timeZone.optional() });
export const updateProfileSchema = z
  .object({ name: displayName.optional(), emoji: emoji.optional(), timeZone: timeZone.optional() })
  .refine((p) => p.name !== undefined || p.emoji !== undefined || p.timeZone !== undefined, 'nothing to update');
export const linkDeviceSchema = z.object({ token: tokenSchema });

// ---------- encrypted sync ----------

export const MAX_SYNC_BATCH = 200;
export const syncRecordSchema = z.object({
  k: z.enum(['h', 'c']),
  id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  u: z.number().int().min(0).max(1e15),
  d: z.union([z.literal(0), z.literal(1)]),
  x: base64url.min(16).max(4_000), // a habit or check-in is well under 1 KB
});
export const syncPushSchema = z
  .object({
    records: z
      .array(syncRecordSchema)
      .max(MAX_SYNC_BATCH)
      .refine((rs) => isUnique(rs.map((r) => `${r.k}:${r.id}`)), 'duplicate records')
      .default([]),
    /** Check-ins just answered, so other devices skip their reminder for that day. */
    answered: z.array(z.object({ habitId: habitIdSchema, date: isoDate })).max(50).default([]),
  })
  .refine((b) => b.records.length > 0 || b.answered.length > 0, 'nothing to sync');
export const syncPullSchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

// ---------- friends ----------

export const friendCodeSchema = z
  .string()
  .max(20)
  .transform((s, ctx) => {
    const code = normalizeFriendCode(s);
    if (!code) {
      ctx.addIssue({ code: 'custom', message: "That code doesn't look right" });
      return z.NEVER;
    }
    return code;
  });
export const addFriendSchema = z.object({ code: friendCodeSchema });

export const shareSchema = z.object({
  timeZone,
  date: isoDate,
  weekStart: isoDate,
  habits: z
    .array(
      z.object({
        id: habitIdSchema,
        name: z.string().trim().min(1).max(60),
        emoji,
        color: z.string().regex(/^[a-z]{1,12}$/),
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        time: hhmm.nullable(),
        askMin: z.number().int().min(0).max(2880),
        week: z.string().regex(/^[YNMPF.]{7}$/),
        streak: z.number().int().min(0).max(100_000),
        best: z.number().int().min(0).max(100_000),
      }),
    )
    .max(20)
    .refine((hs) => isUnique(hs.map((h) => h.id)), 'duplicate habits'),
  /** The check-in that triggered this update, for a live "Arun just went to the gym" toast. */
  event: z.object({ habitId: habitIdSchema, answer: z.enum(['yes', 'no']) }).optional(),
});
export type ShareBody = z.infer<typeof shareSchema>;

export const nudgeSchema = z.object({ to: userIdSchema, habitId: habitIdSchema });
export const reactionSchema = z.object({
  to: userIdSchema,
  habitId: habitIdSchema,
  date: isoDate,
  emoji: z.enum(REACTIONS).nullable(),
});

// ---------- challenges ----------

export const createChallengeSchema = z.object({
  name: z.string().trim().min(1).max(40),
  emoji,
  target: z.number().int().min(1).max(7),
  habitId: habitIdSchema,
  invite: z.array(userIdSchema).max(19).default([]),
});
export const joinChallengeSchema = z.object({ habitId: habitIdSchema });
export const inviteSchema = z.object({ friendIds: z.array(userIdSchema).min(1).max(19) });
export const challengeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12}$/);

import { z } from 'zod';
import { isValidTimeZone } from './tz';

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, 'must be base64url');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

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
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM'),
  offsetMin: z.number().int().min(0).max(720).default(0),
  skipDates: z.array(isoDate).max(14).default([]),
});

export const putDeviceSchema = z.object({
  subscription: subscriptionSchema,
  timeZone: z.string().max(64).refine(isValidTimeZone, 'unknown time zone'),
  reminders: z
    .array(reminderSchema)
    .max(64)
    .refine((rs) => new Set(rs.map((r) => r.id)).size === rs.length, 'duplicate reminder ids'),
});

export type PutDeviceBody = z.infer<typeof putDeviceSchema>;
export type ReminderInput = z.infer<typeof reminderSchema>;

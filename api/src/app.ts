import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bearerToken, sha256Hex, timingSafeEqual } from './auth';
import { isAllowedPushEndpoint } from './endpoints';
import type { Env } from './env';
import { sendPush } from './push';
import { deleteDevice, deleteReminders, getDevice, insertReminder, upsertDevice, type DeviceRow } from './repo';
import { computeNextFire, daysToMask } from './schedule';
import { deviceIdSchema, putDeviceSchema, tokenSchema } from './validation';

type AppContext = Context<{ Bindings: Env }>;

export const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? '*').split(',').map((o) => o.trim()).filter(Boolean);
  return cors({
    origin: allowed.includes('*') ? '*' : allowed,
    allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  })(c, next);
});

app.get('/', (c) => c.text('Tell Me API is running. Try GET /api/health'));

app.get('/api/health', (c) => c.json({ ok: true, service: 'tell-me-api', time: new Date().toISOString() }));

/** The browser needs the public VAPID key to create a push subscription. */
app.get('/api/config', (c) => {
  if (!c.env.VAPID_PUBLIC_KEY || c.env.VAPID_PUBLIC_KEY.startsWith('REPLACE')) {
    return c.json({ error: 'Server is missing its VAPID keys. See docs/DEPLOY.md.' }, 503);
  }
  return c.json({ vapidPublicKey: c.env.VAPID_PUBLIC_KEY });
});

/**
 * Create or replace a device's subscription and its full reminder list (declarative sync:
 * the app always sends the complete desired state, so the server never drifts).
 */
app.put('/api/devices/:id', async (c) => {
  const id = deviceIdSchema.safeParse(c.req.param('id'));
  const token = tokenSchema.safeParse(bearerToken(c.req.header('Authorization')));
  if (!id.success) return c.json({ error: 'Invalid device id' }, 400);
  if (!token.success) return c.json({ error: 'Missing or invalid token' }, 401);

  const parsed = putDeviceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
  }
  const body = parsed.data;
  if (!isAllowedPushEndpoint(body.subscription.endpoint, c.env.ALLOW_ANY_PUSH_ENDPOINT === 'true')) {
    return c.json({ error: 'Push endpoint is not a recognised browser push service' }, 400);
  }

  const tokenHash = await sha256Hex(token.data);
  const existing = await getDevice(c.env.DB, id.data);
  if (existing && !timingSafeEqual(existing.token_hash, tokenHash)) {
    return c.json({ error: 'Token does not match this device' }, 403);
  }

  const now = Date.now();
  const scheduled = body.reminders.map((r) => {
    const days = daysToMask(r.days);
    const next = computeNextFire(
      { days, time: r.time, offsetMin: r.offsetMin, skipDates: r.skipDates },
      body.timeZone,
      now,
    );
    return { r, days, next };
  });

  await c.env.DB.batch([
    upsertDevice(
      c.env.DB,
      {
        id: id.data,
        token_hash: tokenHash,
        endpoint: body.subscription.endpoint,
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
        time_zone: body.timeZone,
      },
      now,
    ),
    deleteReminders(c.env.DB, id.data),
    ...scheduled.map(({ r, days, next }) =>
      insertReminder(c.env.DB, {
        device_id: id.data,
        id: r.id,
        kind: r.kind,
        title: r.title,
        emoji: r.emoji,
        days,
        time: r.time,
        offset_min: r.offsetMin,
        skip_dates: r.skipDates.join(','),
        next_fire_at: next?.fireAt ?? null,
        next_date: next?.date ?? null,
      }),
    ),
  ]);

  return c.json({
    ok: true,
    reminders: scheduled.map(({ r, next }) => ({
      id: r.id,
      nextFireAt: next ? new Date(next.fireAt).toISOString() : null,
      nextDate: next?.date ?? null,
    })),
  });
});

/** Turn reminders off: forget the device and everything about it. */
app.delete('/api/devices/:id', async (c) => {
  const device = await authorize(c);
  if (device instanceof Response) return device;
  await c.env.DB.batch(deleteDevice(c.env.DB, device.id));
  return c.json({ ok: true });
});

/** Send a test notification right now. */
app.post('/api/devices/:id/test', async (c) => {
  const device = await authorize(c);
  if (device instanceof Response) return device;
  const result = await sendPush(c.env, device, { type: 'test' });
  if (result.outcome === 'gone') await c.env.DB.batch(deleteDevice(c.env.DB, device.id));
  return c.json({ ok: result.outcome === 'ok', outcome: result.outcome, status: result.status }, result.outcome === 'ok' ? 200 : 502);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

async function authorize(c: AppContext): Promise<DeviceRow | Response> {
  const id = deviceIdSchema.safeParse(c.req.param('id'));
  const token = bearerToken(c.req.header('Authorization'));
  if (!id.success || !token) return c.json({ error: 'Unauthorized' }, 401);
  const device = await getDevice(c.env.DB, id.data);
  if (!device) return c.json({ error: 'Unknown device' }, 404);
  if (!timingSafeEqual(device.token_hash, await sha256Hex(token))) return c.json({ error: 'Forbidden' }, 403);
  return device;
}

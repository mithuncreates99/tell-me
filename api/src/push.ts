import type { Env } from './env';
import { buildWebPushRequest } from './webpush';

/** What the service worker receives. Kept tiny on purpose: no habit history ever leaves the phone. */
export type PushPayload =
  | { type: 'checkin'; habitId: string; date: string; title: string; emoji: string; time: string }
  | { type: 'weekly'; date: string }
  | { type: 'test' }
  /** Friends: nudges, reactions, invites. Title and body are ready to show. */
  | { type: 'social'; title: string; body: string; path: string; tag: string };

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * ok    – delivered to the push service
 * gone  – subscription expired or was revoked (404/410): delete the device
 * retry – temporary problem (429, 5xx, network): try again shortly
 * error – request rejected (400/401/403/413): don't retry this push
 */
export type PushOutcome = 'ok' | 'gone' | 'retry' | 'error';

export interface PushResult {
  outcome: PushOutcome;
  status: number;
  detail?: string;
}

const TTL_SECONDS: Record<PushPayload['type'], number> = {
  checkin: 4 * 60 * 60, // a "Did you go?" is still useful a few hours late
  weekly: 12 * 60 * 60,
  test: 10 * 60,
  social: 3 * 60 * 60,
};

export function classifyStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404 || status === 410) return 'gone';
  if (status === 429 || status >= 500) return 'retry';
  return 'error';
}

export async function sendPush(env: Env, target: PushTarget, payload: PushPayload): Promise<PushResult> {
  let request: Awaited<ReturnType<typeof buildWebPushRequest>>;
  try {
    request = await buildWebPushRequest(
      target,
      payload,
      { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT },
      {
        ttl: TTL_SECONDS[payload.type],
        urgency: payload.type === 'checkin' ? 'high' : 'normal',
        topic: payload.type === 'checkin' ? topicFor(payload.habitId) : payload.type === 'social' ? topicFor(payload.tag, '') : undefined,
      },
    );
  } catch (err) {
    // Malformed subscription keys or VAPID configuration: retrying won't help.
    return { outcome: 'error', status: 0, detail: String(err) };
  }

  try {
    const res = await fetch(target.endpoint, { method: 'POST', headers: request.headers, body: request.body });
    const outcome = classifyStatus(res.status);
    const detail = outcome === 'ok' ? undefined : (await res.text()).slice(0, 300);
    return { outcome, status: res.status, detail };
  } catch (err) {
    return { outcome: 'retry', status: 0, detail: String(err) };
  }
}

/** Push "Topic" header: a newer undelivered reminder for the same habit replaces the older one. */
export function topicFor(id: string, prefix = 'h-'): string {
  return `${prefix}${id}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

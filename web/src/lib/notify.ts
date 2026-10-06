import { formatTime } from './dates';
import type { Checkin, Habit } from './types';

/** Payloads sent by the reminder server (see api/src/push.ts). */
export type PushPayload =
  | { type: 'checkin'; habitId: string; date: string; title: string; emoji: string; time: string }
  | { type: 'weekly'; date: string }
  | { type: 'test' }
  | { type: 'social'; title: string; body: string; path: string; tag: string };

export interface NotificationData {
  kind: 'checkin' | 'weekly' | 'test' | 'social';
  habitId?: string;
  date?: string;
  /** Path inside the app, e.g. "#/checkin/abc/2026-10-05". */
  path: string;
}

export interface NotificationSpec {
  title: string;
  options: NotificationOptions & { actions?: Array<{ action: string; title: string }>; data: NotificationData };
}

const ICON = 'icons/icon-192.png';
const BADGE = 'icons/badge-96.png';
const ACTIONS = [
  { action: 'yes', title: '✅ Yes' },
  { action: 'no', title: '❌ No' },
];

export function parsePushPayload(raw: unknown): PushPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.type === 'checkin' && typeof p.habitId === 'string' && typeof p.date === 'string') {
    return {
      type: 'checkin',
      habitId: p.habitId,
      date: p.date,
      title: String(p.title ?? 'Your habit'),
      emoji: String(p.emoji ?? ''),
      time: String(p.time ?? ''),
    };
  }
  if (p.type === 'weekly') return { type: 'weekly', date: String(p.date ?? '') };
  if (p.type === 'social' && typeof p.title === 'string') {
    const path = typeof p.path === 'string' && p.path.startsWith('#/') ? p.path : '#/friends';
    return { type: 'social', title: p.title.slice(0, 120), body: String(p.body ?? '').slice(0, 240), path, tag: String(p.tag ?? 'social').slice(0, 64) };
  }
  if (p.type === 'test') return { type: 'test' };
  return null;
}

export function checkinNotification(
  p: Extract<PushPayload, { type: 'checkin' }>,
  ctx: { habit?: Habit; existing?: Checkin; streak: number; today: string; canShowActions: boolean },
): NotificationSpec {
  const name = ctx.habit?.name ?? p.title;
  const emoji = ctx.habit?.emoji ?? p.emoji;
  const time = ctx.habit?.time ?? (p.time || null);
  const when = p.date === ctx.today ? '' : 'yesterday ';
  let body: string;
  if (ctx.existing) {
    body = `Already logged as ${ctx.existing.answer === 'yes' ? 'Yes' : 'No'}. Tap to change it.`;
  } else {
    const planned = time ? `Planned ${when}at ${formatTime(time)}. ` : '';
    const nudge = ctx.streak >= 2 ? `🔥 ${ctx.streak} in a row, keep it going!` : 'Yes or No?';
    body = `${planned}${nudge}${ctx.canShowActions ? '' : ' Tap to answer.'}`;
  }
  return {
    title: `${emoji ? `${emoji} ` : ''}${name}: did you show up?`,
    options: {
      body,
      tag: `checkin-${p.habitId}-${p.date}`,
      icon: ICON,
      badge: BADGE,
      actions: ctx.existing ? [] : ACTIONS,
      data: { kind: 'checkin', habitId: p.habitId, date: p.date, path: `#/checkin/${p.habitId}/${p.date}` },
    },
  };
}

export function weeklyNotification(summary: { due: number; yes: number; prevRate: number | null }): NotificationSpec {
  const rate = summary.due ? summary.yes / summary.due : null;
  let title = '📊 Your weekly report is ready';
  let body = 'Tap to see your insights.';
  if (rate !== null) {
    title = `📊 Your week: ${summary.yes} of ${summary.due} (${Math.round(rate * 100)}%)`;
    if (summary.prevRate !== null) {
      const diff = Math.round((rate - summary.prevRate) * 100);
      body =
        diff > 0
          ? `Up ${diff} points on last week. Tap for your insights.`
          : diff < 0
            ? `Down ${-diff} points from last week. Tap to see what changed.`
            : 'Same as last week. Tap for your insights.';
    }
  }
  return {
    title,
    options: { body, tag: 'weekly-report', icon: ICON, badge: BADGE, data: { kind: 'weekly', path: '#/insights' } },
  };
}

/** Friends: a nudge, a reaction, an invite. The server sends ready-made text. */
export function socialNotification(p: Extract<PushPayload, { type: 'social' }>): NotificationSpec {
  return {
    title: p.title,
    options: { body: p.body, tag: p.tag, icon: ICON, badge: BADGE, data: { kind: 'social', path: p.path } },
  };
}

export function testNotification(): NotificationSpec {
  return {
    title: '🔔 Reminders are on',
    options: {
      body: 'This is how Tell Me will check in: did you show up? Yes or No.',
      tag: 'test',
      icon: ICON,
      badge: BADGE,
      actions: ACTIONS,
      data: { kind: 'test', path: '#/' },
    },
  };
}

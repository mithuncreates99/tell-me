/// <reference lib="webworker" />
/**
 * Tell Me service worker
 *  - precaches the app so it works offline
 *  - turns server pushes into "Did you show up?" notifications (with live streaks from IndexedDB)
 *  - records Yes/No straight from the notification buttons, without opening the app
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { api } from './lib/api';
import { addDays, startOfWeek, todayISO } from './lib/dates';
import * as db from './lib/db';
import {
  checkinNotification,
  parsePushPayload,
  testNotification,
  weeklyNotification,
  type NotificationData,
  type NotificationSpec,
} from './lib/notify';
import { recordAnswerFromNotification } from './lib/notificationActions';
import { buildReminders } from './lib/reminders';
import { checkinKey, toCheckinMap } from './lib/schedule';
import { compareWithLastWeek, rateOf, streakFor } from './lib/stats';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

const show = (n: NotificationSpec) => self.registration.showNotification(n.title, n.options as NotificationOptions);

async function handlePush(data: PushMessageData | null): Promise<void> {
  let payload = null;
  try {
    payload = parsePushPayload(data?.json());
  } catch {
    /* not JSON */
  }
  if (!payload) {
    // Every push must show something (browsers revoke silent pushes).
    await self.registration.showNotification('Tell Me', { body: 'Time to check in.', icon: 'icons/icon-192.png', data: { kind: 'test', path: '#/' } });
    return;
  }
  if (payload.type === 'test') return show(testNotification());

  const { habits, checkins, settings } = await db.loadAll();
  const map = toCheckinMap(checkins);
  const now = new Date();
  const today = todayISO(now);

  if (payload.type === 'weekly') {
    // Report on the week that's ending; on the first day of a week, report on the previous one.
    let weekStart = startOfWeek(today, settings.weekStartsOn);
    if (weekStart === today) weekStart = startOfWeek(addDays(today, -1), settings.weekStartsOn);
    const cmp = compareWithLastWeek(habits, map, weekStart, settings, now);
    return show(weeklyNotification({ due: cmp.current.due, yes: cmp.current.yes, prevRate: rateOf(cmp.previous) }));
  }

  const habit = habits.find((h) => h.id === payload.habitId);
  const maxActions = (self as unknown as { Notification?: { maxActions?: number } }).Notification?.maxActions ?? 0;
  return show(
    checkinNotification(payload, {
      habit,
      existing: map.get(checkinKey(payload.habitId, payload.date)),
      streak: habit ? streakFor(habit, map, settings, now).current : 0,
      today,
      canShowActions: maxActions >= 2,
    }),
  );
}

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event.data));
});

async function broadcast(message: unknown) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) c.postMessage(message);
}

async function openApp(path: string) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) {
    if (c.url.startsWith(self.registration.scope)) {
      await (c as WindowClient).focus();
      c.postMessage({ type: 'navigate', path });
      return;
    }
  }
  const url = new URL(self.registration.scope);
  url.hash = path.replace(/^#/, '');
  await self.clients.openWindow(url.href);
}

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data as NotificationData | undefined;
  notification.close();
  event.waitUntil(
    (async () => {
      const action = event.action;
      // One tap on ✅ Yes / ❌ No: record the answer without opening the app.
      if (await recordAnswerFromNotification(data, action)) {
        db.announceChange();
        await broadcast({ type: 'data-changed' });
        return;
      }
      if (action === 'yes' || action === 'no') return; // test notification, or a deleted habit
      await openApp(data?.path ?? '#/');
    })(),
  );
});

/** The browser rotated our push subscription: re-register it with the reminder server. */
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null; waitUntil(p: Promise<unknown>): void };
  e.waitUntil(
    (async () => {
      const { habits, checkins, settings } = await db.loadAll();
      const { deviceId, token, enabled } = settings.push;
      if (!enabled || !deviceId || !token) return;
      let sub = e.newSubscription ?? null;
      if (!sub) {
        const key = e.oldSubscription?.options.applicationServerKey;
        const applicationServerKey = key ?? (await api.config()).vapidPublicKey;
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      }
      await api.putDevice(deviceId, token, {
        subscription: sub.toJSON(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reminders: buildReminders(habits, toCheckinMap(checkins), settings, new Date()),
      });
    })(),
  );
});

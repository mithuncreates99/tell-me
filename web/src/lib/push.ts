import { api, API_URL } from './api';
import { newId, newToken } from './ids';
import { IS_PREVIEW, isIOS, isStandalone } from './platform';
import { buildReminders } from './reminders';
import type { CheckinMap } from './schedule';
import type { Habit, PushState, Settings } from './types';

export { buildReminders };

export type PushBlocker = 'preview' | 'no-server' | 'insecure' | 'unsupported' | 'ios-install' | 'denied';

export function pushBlocker(): PushBlocker | null {
  if (IS_PREVIEW) return 'preview';
  if (!API_URL) return 'no-server';
  if (!window.isSecureContext) return 'insecure';
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // iPhone/iPad only allow web push for apps added to the Home Screen.
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!capable) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return null;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

/** FNV-1a hash of the sync body, so unchanged schedules aren't re-sent. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 8000)),
  ]);
  if (!reg) throw new Error('The app is still installing. Reload the page and try again.');
  return reg;
}

/** Asks for permission and creates a push subscription. */
export async function enablePush(current: PushState): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
        : 'Notifications were not allowed.',
    );
  }
  const reg = await registration();
  const { vapidPublicKey } = await api.config();
  const key = base64UrlToBytes(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe(); // the server's keys changed
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return {
    enabled: true,
    deviceId: current.deviceId ?? newId(22),
    token: current.token ?? newToken(),
    endpoint: sub.endpoint,
    lastError: null,
  };
}

/** Sends the full schedule to the server (skipped when nothing changed in the last 12 h). */
export async function syncPush(
  state: PushState,
  habits: Habit[],
  checkins: CheckinMap,
  settings: Settings,
  now: Date,
  force = false,
  signedIn = true,
): Promise<PushState> {
  if (!state.enabled || !state.deviceId || !state.token) return state;
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) {
    return { ...state, enabled: false, lastError: 'Your browser dropped the notification subscription. Turn reminders on again.' };
  }
  const body = {
    subscription: sub.toJSON(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reminders: buildReminders(habits, checkins, settings, now),
    // Nobody signed in here: friends' notifications must stop reaching this device, even if the
    // account couldn't be told when signing out (offline). The device unlinks itself.
    ...(signedIn ? {} : { signedIn: false }),
  };
  const fingerprint = hash(JSON.stringify(body));
  const fresh = state.lastSyncAt && now.getTime() - Date.parse(state.lastSyncAt) < 12 * 3600_000;
  if (!force && fingerprint === state.lastSyncHash && fresh) return state;
  await api.putDevice(state.deviceId, state.token, body);
  return { ...state, endpoint: sub.endpoint, lastSyncAt: now.toISOString(), lastSyncHash: fingerprint, lastError: null };
}

export async function disablePush(state: PushState): Promise<PushState> {
  if (state.deviceId && state.token) {
    try {
      await api.deleteDevice(state.deviceId, state.token);
    } catch {
      /* already gone on the server */
    }
  }
  try {
    const sub = await (await registration()).pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* no service worker */
  }
  return { enabled: false, deviceId: state.deviceId, token: state.token, lastError: null };
}

export async function sendTestPush(state: PushState): Promise<void> {
  if (!state.deviceId || !state.token) throw new Error('Reminders are not set up yet.');
  await api.testDevice(state.deviceId, state.token);
}

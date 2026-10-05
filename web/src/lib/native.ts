import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { interpretAction, planLocalNotifications, type NotificationTap } from './localReminders';

export type { NotificationTap };
import type { CheckinMap } from './schedule';
import type { BackupFile, Habit, Settings } from './types';

/**
 * Everything specific to the native iOS app (Capacitor). On the web these functions are never
 * called: every caller checks IS_NATIVE first.
 */
export const IS_NATIVE = Capacitor.isNativePlatform();

// ---------- Reminders: local notifications scheduled on the phone ----------

const CHECKIN_ACTIONS = {
  types: [
    {
      id: 'CHECKIN',
      actions: [
        // foreground: the app opens for a moment, records the answer and shows the result.
        { id: 'yes', title: '✅ Yes', foreground: true },
        { id: 'no', title: '❌ No', foreground: true, destructive: true },
      ],
    },
  ],
};

export async function enableLocalReminders(): Promise<boolean> {
  const { display } = await LocalNotifications.requestPermissions();
  if (display !== 'granted') return false;
  await LocalNotifications.registerActionTypes(CHECKIN_ACTIONS);
  return true;
}

export async function localReminderPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const { display } = await LocalNotifications.checkPermissions();
  return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
}

/** Replaces every pending reminder with a fresh plan for the next days. Returns how many are scheduled. */
export async function syncLocalReminders(
  habits: Habit[],
  checkins: CheckinMap,
  settings: Pick<Settings, 'defaultAskTime' | 'weeklyReport'>,
  now = new Date(),
): Promise<number> {
  const plan = planLocalNotifications(habits, checkins, settings, now);
  await LocalNotifications.registerActionTypes(CHECKIN_ACTIONS);
  await LocalNotifications.cancelAll();
  if (plan.length) {
    await LocalNotifications.schedule({
      notifications: plan.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: { at: n.at, allowWhileIdle: true },
        actionTypeId: n.actionTypeId,
        extra: n.extra,
      })),
    });
  }
  return plan.length;
}

export async function disableLocalReminders(): Promise<void> {
  await LocalNotifications.cancelAll();
}

export async function sendLocalTest(): Promise<void> {
  await LocalNotifications.registerActionTypes(CHECKIN_ACTIONS);
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 1,
        title: '🔔 Reminders are on',
        body: 'This is how Tell Me will check in. Press and hold to answer Yes or No.',
        schedule: { at: new Date(Date.now() + 3000) },
        actionTypeId: 'CHECKIN',
        extra: { kind: 'test' },
      },
    ],
  });
}

export function onNotificationAction(handler: (tap: NotificationTap) => void): () => void {
  const handle = LocalNotifications.addListener('localNotificationActionPerformed', (a) =>
    handler(interpretAction(a.actionId, a.notification.extra)),
  );
  return () => void handle.then((h) => h.remove());
}

// ---------- Data safety: a copy of everything in the iOS app's own storage ----------

const BACKUP_KEY = 'tell-me-backup';

/** iOS can clear a web view's storage when the phone is nearly full; keep a native copy too. */
export async function saveNativeBackup(backup: BackupFile): Promise<void> {
  await Preferences.set({ key: BACKUP_KEY, value: JSON.stringify(backup) });
}

export async function loadNativeBackup(): Promise<BackupFile | null> {
  const { value } = await Preferences.get({ key: BACKUP_KEY });
  if (!value) return null;
  try {
    return JSON.parse(value) as BackupFile;
  } catch {
    return null;
  }
}

/** Opens the iOS share sheet with the backup file (save to Files, AirDrop, Mail…). */
export async function shareBackupFile(backup: BackupFile): Promise<void> {
  const path = `tell-me-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const { uri } = await Filesystem.writeFile({
    path,
    data: JSON.stringify(backup, null, 2),
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({ title: 'Tell Me backup', url: uri });
}

export async function shareText(title: string, text: string): Promise<void> {
  await Share.share({ title, text });
}

export function tapFeedback(): void {
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

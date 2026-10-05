import { Bell, BellOff, CalendarPlus, CheckCircle2, Share, Smartphone, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { buildICS } from '../lib/ics';
import {
  disableLocalReminders,
  enableLocalReminders,
  IS_NATIVE,
  localReminderPermission,
  sendLocalTest,
  syncLocalReminders,
} from '../lib/native';
import { disablePush, enablePush, pushBlocker, sendTestPush, syncPush, type PushBlocker } from '../lib/push';
import { useStore } from '../store/useStore';
import { Button } from './ui';

export function downloadCalendar() {
  const { habits, settings } = useStore.getState();
  const appUrl = `${location.origin}${location.pathname}`;
  const blob = new Blob([buildICS(habits, settings, appUrl)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tell-me-habits.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const GUIDANCE: Record<PushBlocker, { title: string; body: ReactNode }> = {
  preview: {
    title: 'Reminders need the installed app',
    body: 'This is a preview, so it can\'t send notifications. Install Tell Me from its own website to get Yes/No pushes. You can still add check-in alarms to your calendar.',
  },
  'no-server': {
    title: 'No reminder server connected',
    body: 'This copy of Tell Me was built without a reminder server (VITE_API_URL). You can still add check-in alarms to your calendar.',
  },
  insecure: { title: 'Needs a secure connection', body: 'Push notifications only work on https:// pages.' },
  unsupported: {
    title: "This browser can't receive push notifications",
    body: 'Try Chrome, Edge, Firefox, or Safari 16.4 or newer. Or add check-in alarms to your calendar instead.',
  },
  'ios-install': {
    title: 'On iPhone, add Tell Me to your Home Screen first',
    body: (
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        <li>
          In Safari, tap <Share size={14} className="inline -translate-y-0.5" aria-label="Share" /> Share.
        </li>
        <li>Choose <b>Add to Home Screen</b>.</li>
        <li>Open Tell Me from your Home Screen and turn reminders on.</li>
      </ol>
    ),
  },
  denied: {
    title: 'Notifications are blocked',
    body: "Allow notifications for this site in your browser's settings (the lock or ⓘ icon in the address bar), then reload.",
  },
};

/** True when this device will get Yes/No reminders (web push, or local notifications in the iPhone app). */
export const useRemindersOn = () => useStore((s) => (IS_NATIVE ? s.settings.localReminders : s.settings.push.enabled));

export function PushPanel() {
  return IS_NATIVE ? <LocalRemindersPanel /> : <WebPushPanel />;
}

/** iPhone app: reminders are local notifications, scheduled on the phone. */
function LocalRemindersPanel() {
  const settings = useStore((s) => s.settings);
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const scheduled = useStore((s) => s.localScheduled);
  const setLocalScheduled = useStore((s) => s.setLocalScheduled);
  const updateSettings = useStore((s) => s.updateSettings);
  const showToast = useStore((s) => s.showToast);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void localReminderPermission().then(setPermission).catch(() => {});
  }, [settings.localReminders]);

  const turnOn = async () => {
    setBusy(true);
    try {
      if (!(await enableLocalReminders())) {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      await updateSettings({ localReminders: true });
      setLocalScheduled(await syncLocalReminders(habits, checkins, settings));
      showToast('Reminders are on. Send a test to see one.', { tone: 'good' });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not turn reminders on.', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  if (permission === 'denied') {
    return (
      <div className="flex items-start gap-3">
        <BellOff className="mt-0.5 shrink-0 text-ink-3" size={22} aria-hidden />
        <div className="text-[14px] text-ink-2">
          <p className="text-[15px] font-semibold text-ink">Notifications are off for Tell Me</p>
          <p className="mt-0.5">Open the iPhone <b>Settings</b> app → <b>Tell Me</b> → <b>Notifications</b> and turn on <b>Allow Notifications</b>, then come back.</p>
        </div>
      </div>
    );
  }

  if (settings.localReminders) {
    return (
      <div>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-yes" size={22} aria-hidden />
          <div>
            <p className="font-semibold">Reminders are on</p>
            <p className="mt-0.5 text-[14px] text-ink-3">
              {scheduled === null ? 'Scheduling…' : `${scheduled} check-in${scheduled === 1 ? '' : 's'} scheduled for the next 10 days.`} Press and hold a
              notification to answer Yes or No. Opening the app keeps the schedule topped up.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void sendLocalTest().then(() => showToast('Test coming in 3 seconds. Lock your phone to see it.'))}
          >
            <Bell size={16} aria-hidden /> Send a test
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await disableLocalReminders();
              await updateSettings({ localReminders: false });
              setLocalScheduled(0);
              showToast('Reminders turned off.');
            }}
          >
            <BellOff size={16} aria-hidden /> Turn off
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 shrink-0 text-brand" size={22} aria-hidden />
        <div>
          <p className="font-semibold">Get a Yes/No notification for every habit</p>
          <p className="mt-0.5 text-[14px] text-ink-3">
            At each habit's check-in time, Tell Me asks "Did you show up?" Press and hold the notification to answer. Everything
            stays on your phone.
          </p>
        </div>
      </div>
      <Button variant="primary" className="mt-4" onClick={() => void turnOn()} disabled={busy}>
        <Bell size={18} aria-hidden /> {busy ? 'Turning on…' : 'Turn on reminders'}
      </Button>
    </div>
  );
}

function WebPushPanel() {
  const settings = useStore((s) => s.settings);
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const updateSettings = useStore((s) => s.updateSettings);
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState<string | null>(null);
  const push = settings.push;
  const blocker = pushBlocker();
  const count = habits.filter((h) => !h.archivedAt && h.remind).length;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Something went wrong.', { tone: 'bad' });
    } finally {
      setBusy(null);
    }
  };

  const turnOn = () =>
    run('on', async () => {
      const enabled = await enablePush(push);
      const synced = await syncPush(enabled, habits, checkins, settings, new Date(), true);
      await updateSettings({ push: synced });
      showToast('Reminders are on. Send a test to see one.', { tone: 'good' });
    });

  const turnOff = () =>
    run('off', async () => {
      await updateSettings({ push: await disablePush(push) });
      showToast('Reminders turned off for this device.');
    });

  const test = () =>
    run('test', async () => {
      await sendTestPush(push);
      showToast('Test sent. It should arrive in a few seconds.');
    });

  if (push.enabled && !blocker) {
    return (
      <div>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-yes" size={22} aria-hidden />
          <div>
            <p className="font-semibold">Reminders are on for this device</p>
            <p className="mt-0.5 text-[14px] text-ink-3">
              {count} habit{count === 1 ? '' : 's'} will ask "Did you show up?"
              {settings.weeklyReport.enabled ? ', plus your weekly report' : ''}.
              {push.lastSyncAt && ` Synced ${new Date(push.lastSyncAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}.`}
            </p>
            {push.lastError && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[14px] text-no">
                <TriangleAlert size={15} aria-hidden /> {push.lastError}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={test} disabled={!!busy}>
            <Bell size={16} aria-hidden /> {busy === 'test' ? 'Sending…' : 'Send a test'}
          </Button>
          <Button variant="secondary" size="sm" onClick={turnOff} disabled={!!busy}>
            <BellOff size={16} aria-hidden /> Turn off
          </Button>
        </div>
      </div>
    );
  }

  if (blocker) {
    const g = GUIDANCE[blocker];
    return (
      <div>
        <div className="flex items-start gap-3">
          {blocker === 'ios-install' ? (
            <Smartphone className="mt-0.5 shrink-0 text-brand" size={22} aria-hidden />
          ) : (
            <BellOff className="mt-0.5 shrink-0 text-ink-3" size={22} aria-hidden />
          )}
          <div className="text-[14px] text-ink-2">
            <p className="text-[15px] font-semibold text-ink">{g.title}</p>
            <div className="mt-0.5">{g.body}</div>
          </div>
        </div>
        {blocker !== 'ios-install' && blocker !== 'insecure' && blocker !== 'preview' && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={downloadCalendar} disabled={habits.length === 0}>
            <CalendarPlus size={16} aria-hidden /> Add check-ins to my calendar
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 shrink-0 text-brand" size={22} aria-hidden />
        <div>
          <p className="font-semibold">Get a Yes/No notification for every habit</p>
          <p className="mt-0.5 text-[14px] text-ink-3">
            At each habit's check-in time Tell Me asks "Did you show up?" On Android and desktop you can answer right from the
            notification.
          </p>
        </div>
      </div>
      <Button variant="primary" className="mt-4" onClick={turnOn} disabled={!!busy}>
        <Bell size={18} aria-hidden /> {busy === 'on' ? 'Turning on…' : 'Turn on reminders'}
      </Button>
    </div>
  );
}

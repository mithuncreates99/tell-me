import { CalendarDays, ChartColumn, House, ListChecks, Settings as SettingsIcon, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ReasonSheet } from './components/Occurrence';
import { Toast } from './components/Toast';
import { Logo, cx } from './components/ui';
import { loadAccount } from './lib/account';
import { onExternalChange, onUpgradeBlocked } from './lib/db';
import { IS_NATIVE, loadNativeBackup, onNotificationAction, saveNativeBackup, syncLocalReminders } from './lib/native';
import { IS_PREVIEW } from './lib/platform';
import { pushBlocker, syncPush } from './lib/push';
import { UPDATE_READY_EVENT } from './registerSW';
import { navigate, useRoute, type Route } from './router';
import { CreateAccount, SignIn } from './screens/AccountSetup';
import { AddFriend } from './screens/AddFriend';
import { CalendarScreen } from './screens/CalendarScreen';
import { CheckinScreen } from './screens/CheckinScreen';
import { Friends } from './screens/Friends';
import { HabitEditor } from './screens/HabitEditor';
import { Habits } from './screens/Habits';
import { Insights } from './screens/Insights';
import { Privacy } from './screens/Privacy';
import { Settings } from './screens/Settings';
import { Today } from './screens/Today';
import { useSocial } from './store/useSocial';
import { onLocalChange, useStore } from './store/useStore';

type Tab = 'today' | 'friends' | 'calendar' | 'insights' | 'habits' | 'settings';

/** Calendar lives in the desktop sidebar; on phones it's a button on Today, so the bar keeps five tabs. */
const TABS: Array<{ id: Tab; path: string; label: string; icon: typeof House; mobile: boolean }> = [
  { id: 'today', path: '/', label: 'Today', icon: House, mobile: true },
  { id: 'friends', path: '/friends', label: 'Friends', icon: Users, mobile: true },
  { id: 'calendar', path: '/calendar', label: 'Calendar', icon: CalendarDays, mobile: false },
  { id: 'insights', path: '/insights', label: 'Report', icon: ChartColumn, mobile: true },
  { id: 'habits', path: '/habits', label: 'Habits', icon: ListChecks, mobile: true },
  { id: 'settings', path: '/settings', label: 'Settings', icon: SettingsIcon, mobile: true },
];

function tabFor(route: Route): Tab {
  switch (route.name) {
    case 'friends':
    case 'add-friend':
    case 'account-new':
    case 'account-signin':
      return 'friends';
    case 'calendar':
      return 'calendar';
    case 'insights':
    case 'demo':
      return 'insights';
    case 'habits':
    case 'habit-new':
    case 'habit-edit':
      return 'habits';
    case 'settings':
    case 'privacy':
      return 'settings';
    default:
      return 'today';
  }
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'calendar':
      return <CalendarScreen />;
    case 'insights':
    case 'demo':
      return <Insights />;
    case 'habits':
      return <Habits />;
    case 'habit-new':
      return <HabitEditor />;
    case 'habit-edit':
      return <HabitEditor key={route.id} id={route.id} />;
    case 'settings':
      return <Settings />;
    case 'checkin':
      return <CheckinScreen habitId={route.habitId} date={route.date} />;
    case 'friends':
      return <Friends />;
    case 'account-new':
      return <CreateAccount />;
    case 'account-signin':
      return <SignIn />;
    case 'add-friend':
      return <AddFriend key={route.code} code={route.code} />;
    case 'privacy':
      return <Privacy />;
    default:
      return <Today />;
  }
}

/** Keeps the reminder server's copy of the schedule in sync (debounced). */
function usePushSync() {
  const ready = useStore((s) => s.ready);
  const enabled = useStore((s) => s.settings.push.enabled);
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const weekly = useStore((s) => s.settings.weeklyReport);
  const askTime = useStore((s) => s.settings.defaultAskTime);
  const signedIn = useSocial((s) => !!s.account);

  useEffect(() => {
    if (!ready || !enabled || pushBlocker()) return;
    const timer = setTimeout(async () => {
      const { settings, habits, checkins, updateSettings } = useStore.getState();
      try {
        // Read from storage, not from memory: right after launch the account may not be loaded yet.
        const account = await loadAccount().catch(() => null);
        const next = await syncPush(settings.push, habits, checkins, settings, new Date(), false, !!account);
        if (next !== settings.push) await updateSettings({ push: next });
      } catch (err) {
        await updateSettings({ push: { ...settings.push, lastError: err instanceof Error ? err.message : 'Sync failed' } });
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [ready, enabled, habits, checkins, weekly, askTime, signedIn]);
}

/** iPhone app: keep the phone's own reminder schedule and a native backup of the data up to date. */
function useNativeApp() {
  const ready = useStore((s) => s.ready);
  const enabled = useStore((s) => s.settings.localReminders);
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const settings = useStore((s) => s.settings);

  // Reschedule local notifications whenever habits, answers or reminder settings change
  // (and on every app resume, because resuming reloads the data).
  useEffect(() => {
    if (!IS_NATIVE || !ready || !enabled) return;
    const timer = setTimeout(async () => {
      const { habits, checkins, settings, setLocalScheduled } = useStore.getState();
      try {
        setLocalScheduled(await syncLocalReminders(habits, checkins, settings));
      } catch (err) {
        console.warn('Could not schedule reminders', err);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [ready, enabled, habits, checkins, settings.weeklyReport, settings.defaultAskTime]);

  // Mirror everything into the app's native storage; restore from it if the web view was wiped.
  useEffect(() => {
    if (!IS_NATIVE || !ready) return;
    const timer = setTimeout(() => void saveNativeBackup(useStore.getState().exportBackup()).catch(() => {}), 1500);
    return () => clearTimeout(timer);
  }, [ready, habits, checkins, settings]);

  // Notification buttons and taps.
  useEffect(() => {
    if (!IS_NATIVE) return;
    return onNotificationAction(async (tap) => {
      // A tap can launch the app: wait until the data is loaded.
      while (!useStore.getState().ready) await new Promise((r) => setTimeout(r, 50));
      const store = useStore.getState();
      if (tap.kind === 'open-report') return navigate('/insights');
      if (tap.kind === 'open-checkin') return navigate(`/checkin/${tap.habitId}/${tap.date}`);
      if (tap.kind !== 'answer') return;
      const habit = store.habits.find((h) => h.id === tap.habitId);
      if (!habit) return;
      await store.answer(tap.habitId, tap.date, tap.answer);
      navigate('/');
      if (tap.answer === 'no') store.askReason({ habitId: tap.habitId, date: tap.date });
      else store.showToast(`Logged ✅ ${habit.emoji} ${habit.name}`, { tone: 'good' });
    });
  }, []);
}

/**
 * Accounts: load the account, sync after every local change, keep the live connection open
 * while the app is on screen, and link this device's push subscription for friends' nudges.
 */
function useSocialLayer() {
  const ready = useStore((s) => s.ready);
  const accountKey = useSocial((s) => s.account?.key);
  const pushEnabled = useStore((s) => s.settings.push.enabled);
  const pushDevice = useStore((s) => s.settings.push.deviceId);

  useEffect(() => {
    if (!ready) return;
    void useSocial.getState().load();
    onLocalChange(() => useSocial.getState().scheduleSync());
    return () => onLocalChange(null);
  }, [ready]);

  useEffect(() => {
    if (!accountKey) return;
    const social = useSocial.getState();
    const update = () => {
      if (document.visibilityState === 'visible') {
        void social.startLive();
        social.scheduleSync(300);
      } else {
        social.stopLive();
      }
    };
    update();
    const every5min = setInterval(() => document.visibilityState === 'visible' && social.scheduleSync(0), 5 * 60_000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    return () => {
      clearInterval(every5min);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      social.stopLive();
    };
  }, [accountKey]);

  useEffect(() => {
    if (accountKey) void useSocial.getState().linkPushDevice();
  }, [accountKey, pushEnabled, pushDevice]);
}

export function App() {
  const ready = useStore((s) => s.ready);
  const signedIn = useSocial((s) => !!s.account);
  const [upgradeBlocked, setUpgradeBlocked] = useState(false);
  const theme = useStore((s) => s.settings.theme);
  const route = useRoute();
  const tab = tabFor(route);

  useEffect(() => {
    onUpgradeBlocked(() => setUpgradeBlocked(true));
    const onUpdate = () =>
      useStore.getState().showToast('A new version of Tell Me is ready.', { action: { label: 'Reload', run: () => window.location.reload() } });
    window.addEventListener(UPDATE_READY_EVENT, onUpdate);
    void useStore
      .getState()
      .init()
      .then(async () => {
        // iPhone app: if iOS cleared the web view's storage, bring the data back from the native copy.
        if (!IS_NATIVE) return;
        const { habits, settings, importBackup, showToast } = useStore.getState();
        if (habits.length > 0 || settings.onboarded) return;
        const backup = await loadNativeBackup().catch(() => null);
        if (backup?.habits?.length) {
          await importBackup(backup);
          showToast('Restored your habits from the backup on this iPhone.');
        }
      });
    const tick = setInterval(() => useStore.getState().tick(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void useStore.getState().reloadFromDisk();
    };
    document.addEventListener('visibilitychange', onVisible);
    const offExternal = onExternalChange(() => void useStore.getState().reloadFromDisk());
    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.path === 'string') navigate(e.data.path.replace(/^#/, ''));
      if (e.data?.type === 'data-changed') void useStore.getState().reloadFromDisk();
    };
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    return () => {
      onUpgradeBlocked(null);
      window.removeEventListener(UPDATE_READY_EVENT, onUpdate);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      offExternal();
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, []);

  useEffect(() => {
    // Only touch data-theme when the user picked a theme here, so "Auto" never removes a host page's own setting.
    const root = document.documentElement;
    if (theme !== 'system') {
      root.dataset.theme = theme;
      root.dataset.themeSetBy = 'app';
    } else if (root.dataset.themeSetBy === 'app') {
      delete root.dataset.theme;
      delete root.dataset.themeSetBy;
    }
  }, [theme]);

  // The preview opens with sample data so the first screen shows what the app does.
  useEffect(() => {
    if (!ready || !IS_PREVIEW) return;
    const { habits, settings, loadDemo } = useStore.getState();
    if (habits.length === 0 && !settings.onboarded) void loadDemo();
  }, [ready]);

  // "#/demo" link (for portfolio visitors): load sample data unless real habits exist.
  useEffect(() => {
    if (!ready || route.name !== 'demo') return;
    const { habits, loadDemo, showToast } = useStore.getState();
    void (async () => {
      if (habits.length === 0) {
        try {
          await loadDemo();
          showToast('Demo loaded: 8 weeks of sample check-ins. Erase it any time in Settings.');
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'The demo could not be loaded.');
        }
      } else {
        showToast('You already have habits, so the demo was not loaded.');
      }
      navigate('/insights', true);
    })();
  }, [ready, route.name]);

  usePushSync();
  useNativeApp();
  useSocialLayer();

  if (!ready) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="animate-pulse">
          <Logo size={56} />
        </div>
        {upgradeBlocked && (
          <p className="max-w-xs text-[15px] text-ink-2" role="status">
            Tell Me was updated. Close any other Tell Me tabs or windows and this one will open.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-4 py-6 md:flex" aria-label="Main">
        <a href="#/" className="mb-8 flex items-center gap-2.5 px-2">
          <Logo size={34} />
          <span className="text-[19px] font-bold tracking-tight">Tell Me</span>
        </a>
        <nav className="grid grid-cols-1 gap-1">
          {TABS.map((t) => (
            <a
              key={t.id}
              href={`#${t.path}`}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cx(
                'flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition',
                tab === t.id ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2',
              )}
            >
              <t.icon size={19} aria-hidden /> {t.label}
            </a>
          ))}
        </nav>
        <p className="mt-auto flex items-start gap-2 px-2 text-[12px] leading-snug text-ink-3">
          <ShieldCheck size={15} className="mt-px shrink-0" aria-hidden />
          {signedIn ? 'Synced with end-to-end encryption.' : 'Your habits and answers stay on this device.'}
        </p>
      </aside>

      <main className="mx-auto w-full max-w-3xl px-4 pb-32 pt-[calc(env(safe-area-inset-top)+16px)] md:px-10 md:pb-16 md:pt-10">
        <Screen route={route} />
      </main>

      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.filter((t) => t.mobile).map((t) => (
            <a
              key={t.id}
              href={`#${t.path}`}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cx(
                'flex flex-col items-center gap-0.5 pb-1 pt-2 text-[11px] font-medium transition',
                tab === t.id ? 'text-brand' : 'text-ink-3',
              )}
            >
              <t.icon size={22} strokeWidth={tab === t.id ? 2.4 : 2} aria-hidden />
              {t.label}
            </a>
          ))}
        </div>
      </nav>

      <ReasonSheet />
      <Toast />
    </div>
  );
}

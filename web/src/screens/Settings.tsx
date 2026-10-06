import { CalendarPlus, Code, Download, ExternalLink, MonitorSmartphone, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccountPanel } from '../components/AccountPanel';
import { downloadCalendar, PushPanel } from '../components/PushPanel';
import { Button, PageHeader, Segmented, Sheet, Toggle } from '../components/ui';
import { orderedWeekdays, weekdayName } from '../lib/dates';
import { canInstall, onInstallAvailabilityChange, promptInstall } from '../lib/install';
import { IS_NATIVE, shareBackupFile } from '../lib/native';
import { APP_VERSION, IS_PREVIEW, isIOS, isStandalone, REPO_URL } from '../lib/platform';
import type { Weekday } from '../lib/types';
import { useSocial } from '../store/useSocial';
import { useStore } from '../store/useStore';

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2.5 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      <div className="card p-4">{children}</div>
      {footer && <p className="mt-2 px-1 text-[13px] text-ink-3">{footer}</p>}
    </section>
  );
}

const inputClass = 'h-11 rounded-xl border border-line bg-surface-2 px-3 text-[15px] outline-none focus:border-brand';

type Confirm = 'demo' | 'reset' | null;

export function Settings() {
  const settings = useStore((s) => s.settings);
  const habits = useStore((s) => s.habits);
  const updateSettings = useStore((s) => s.updateSettings);
  const exportBackup = useStore((s) => s.exportBackup);
  const importBackup = useStore((s) => s.importBackup);
  const loadDemo = useStore((s) => s.loadDemo);
  const resetAll = useStore((s) => s.resetAll);
  const showToast = useStore((s) => s.showToast);
  const signedIn = useSocial((s) => !!s.account);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [installable, setInstallable] = useState(canInstall());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => onInstallAvailabilityChange(() => setInstallable(canInstall())), []);

  const weekly = settings.weeklyReport;
  const setWeekly = (patch: Partial<typeof weekly>) => void updateSettings({ weeklyReport: { ...weekly, ...patch } });

  const download = () => {
    if (IS_NATIVE) {
      void shareBackupFile(exportBackup()).catch(() => {});
      return;
    }
    const blob = new Blob([JSON.stringify(exportBackup(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tell-me-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="pb-8">
      <PageHeader eyebrow="Settings" title="Make it yours" />

      <Section title="Account">
        <AccountPanel />
      </Section>

      <Section title="Reminders" footer="The reminder server only stores each habit's name, emoji and time. It never sees your Yes/No answers.">
        <PushPanel />
        <div className="mt-4 border-t border-line pt-1">
          <Toggle
            checked={weekly.enabled}
            onChange={(v) => setWeekly({ enabled: v })}
            label="Weekly report notification"
            description="A summary of your week with a link to your insights."
          />
          {weekly.enabled && (
            <div className="grid grid-cols-2 gap-3 pb-3">
              <label className="min-w-0">
                <span className="mb-1 block text-[13px] font-medium text-ink-3">Day</span>
                <select
                  value={weekly.day}
                  onChange={(e) => setWeekly({ day: Number(e.target.value) as Weekday })}
                  className={`${inputClass} w-full`}
                >
                  {orderedWeekdays(settings.weekStartsOn).map((d) => (
                    <option key={d} value={d}>
                      {weekdayName(d, 'long')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-[13px] font-medium text-ink-3">Time</span>
                <input type="time" value={weekly.time} onChange={(e) => e.target.value && setWeekly({ time: e.target.value })} className={`${inputClass} w-full`} />
              </label>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-line py-3">
            <span>
              <span className="block text-[15px] font-medium">Any-time habits</span>
              <span className="block text-[13px] text-ink-3">When to ask about habits without a set time</span>
            </span>
            <input
              type="time"
              aria-label="Ask about any-time habits at"
              value={settings.defaultAskTime}
              onChange={(e) => e.target.value && void updateSettings({ defaultAskTime: e.target.value })}
              className={`${inputClass} w-36 shrink-0`}
            />
          </div>
        </div>
      </Section>

      {!IS_PREVIEW && !IS_NATIVE && (
        <Section title="Calendar" footer="Adds every habit as a repeating event with an alarm at check-in time. Works with Apple, Google and Outlook calendars.">
          <Button variant="secondary" onClick={downloadCalendar} disabled={habits.length === 0}>
            <CalendarPlus size={18} aria-hidden /> Download calendar file (.ics)
          </Button>
        </Section>
      )}

      <Section title="Appearance">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <span className="text-[15px] font-medium">Theme</span>
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(theme) => void updateSettings({ theme })}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3">
          <span className="text-[15px] font-medium">Week starts on</span>
          <Segmented
            label="Week starts on"
            value={settings.weekStartsOn}
            onChange={(weekStartsOn) => void updateSettings({ weekStartsOn })}
            options={[
              { value: 1, label: 'Monday' },
              { value: 0, label: 'Sunday' },
            ]}
          />
        </div>
        <label className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-[15px] font-medium">Your name</span>
          <input
            value={settings.name}
            onChange={(e) => void updateSettings({ name: e.target.value.slice(0, 30) })}
            placeholder="For the greeting"
            className={`${inputClass} w-44`}
          />
        </label>
      </Section>

      {!IS_PREVIEW && !IS_NATIVE && !isStandalone() && (installable || isIOS()) && (
        <Section title="Install">
          {installable ? (
            <Button variant="primary" onClick={() => void promptInstall()}>
              <MonitorSmartphone size={18} aria-hidden /> Install Tell Me
            </Button>
          ) : (
            <p className="text-[15px] text-ink-2">
              In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. Tell Me opens full-screen and can send you reminders.
            </p>
          )}
        </Section>
      )}

      <Section
        title="Your data"
        footer={
          signedIn
            ? 'Synced to your account, end-to-end encrypted. You can still export a backup file any time.'
            : 'Everything is stored in this browser. Export a backup before clearing site data, or create an account to sync it.'
        }
      >
        <div className="flex flex-wrap gap-2">
          {!IS_PREVIEW && (
            <Button variant="secondary" size="sm" onClick={download}>
              <Download size={16} aria-hidden /> Export backup
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload size={16} aria-hidden /> Restore backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const n = await importBackup(JSON.parse(await file.text()));
                showToast(`Backup restored: ${n} habits.`, { tone: 'good' });
              } catch (err) {
                showToast(err instanceof Error ? err.message : "Couldn't read that file.", { tone: 'bad' });
              }
            }}
          />
          {!signedIn && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm('demo')}>
              <Sparkles size={16} aria-hidden /> Load demo data
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => setConfirm('reset')}>
            <Trash2 size={16} aria-hidden /> Erase everything
          </Button>
        </div>
      </Section>

      <Section title="About">
        <p className="text-[15px]">
          <b>Tell Me</b>, built by Mithun <span className="text-ink-3">· v{APP_VERSION}</span>
        </p>
        <p className="mt-1 text-[14px] text-ink-2">
          A habit tracker built around one question: did you show up? Local-first PWA (React + TypeScript) with end-to-end
          encrypted sync, live friends features and a push scheduler on Cloudflare Workers.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          <a href="#/privacy" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand">
            <ShieldCheck size={16} aria-hidden /> Privacy
          </a>
          {REPO_URL && (
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand">
              <Code size={16} aria-hidden /> Source code <ExternalLink size={13} aria-hidden />
            </a>
          )}
        </div>
      </Section>

      <Sheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'demo' ? 'Load demo data?' : 'Erase everything?'}
      >
        <p className="text-[15px] text-ink-2">
          {confirm === 'demo'
            ? 'This replaces your habits and history with 8 weeks of sample data, so you can explore the reports. Export a backup first if you want to keep your data.'
            : signedIn
              ? 'This deletes all habits and check-ins on every device signed in to your account. It cannot be undone.'
              : 'This deletes all habits and check-ins on this device. It cannot be undone.'}
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant={confirm === 'demo' ? 'primary' : 'danger'}
            className="flex-1"
            onClick={async () => {
              if (confirm === 'demo') {
                try {
                  await loadDemo();
                  showToast('Demo data loaded.');
                } catch (e) {
                  showToast(e instanceof Error ? e.message : 'Could not load the demo.', { tone: 'bad' });
                }
              } else {
                await resetAll();
                showToast('All data erased.');
              }
              setConfirm(null);
            }}
          >
            {confirm === 'demo' ? (
              <>
                <Sparkles size={16} aria-hidden /> Load demo
              </>
            ) : (
              <>
                <RotateCcw size={16} aria-hidden /> Erase
              </>
            )}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

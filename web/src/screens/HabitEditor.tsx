import { Archive, ArrowLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useRemindersOn } from '../components/PushPanel';
import { Button, Chip, EmptyState, HabitBadge, IconButton, Sheet, Toggle, cx } from '../components/ui';
import { habitColorVar, nextColor } from '../lib/colors';
import { formatTime, hhmm, minutesOf, orderedWeekdays, weekdayName } from '../lib/dates';
import { EMOJI_CHOICES, suggestEmoji } from '../lib/emoji';
import { HABIT_COLORS, type Habit, type HabitColor, type Weekday } from '../lib/types';
import { navigate } from '../router';
import { SOCIAL_AVAILABLE, useSocial } from '../store/useSocial';
import { useStore } from '../store/useStore';

interface Draft {
  name: string;
  emoji: string;
  color: HabitColor;
  days: Weekday[];
  hasTime: boolean;
  time: string;
  askAfterMin: number;
  remind: boolean;
  shared: boolean;
}

const ASK_OPTIONS = [0, 15, 30, 60, 90, 120, 180];
const askLabel = (m: number) => (m === 0 ? 'At the planned time' : m < 60 ? `${m} min after` : `${m / 60} h after`.replace('.5 h', '½ h'));

const PRESETS: Array<{ label: string; days: Weekday[] }> = [
  { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', days: [0, 6] },
  { label: 'Mon · Wed · Fri', days: [1, 3, 5] },
];

export function HabitEditor({ id }: { id?: string }) {
  const habits = useStore((s) => s.habits);
  const settings = useStore((s) => s.settings);
  const saveHabit = useStore((s) => s.saveHabit);
  const addHabits = useStore((s) => s.addHabits);
  const deleteHabit = useStore((s) => s.deleteHabit);
  const setArchived = useStore((s) => s.setArchived);
  const showToast = useStore((s) => s.showToast);
  const remindersOn = useRemindersOn();
  const signedIn = useSocial((s) => !!s.account);
  const existing = id ? habits.find((h) => h.id === id) : undefined;
  const [emojiTouched, setEmojiTouched] = useState(!!existing);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? {
          name: existing.name,
          emoji: existing.emoji,
          color: existing.color,
          days: existing.days,
          hasTime: existing.time !== null,
          time: existing.time ?? '18:00',
          askAfterMin: existing.askAfterMin,
          remind: existing.remind,
          shared: !!existing.shared,
        }
      : { name: '', emoji: '✅', color: nextColor(habits), days: [1, 3, 5], hasTime: true, time: '18:00', askAfterMin: 60, remind: true, shared: false },
  );

  if (id && !existing) {
    return (
      <EmptyState icon="🔍" title="Habit not found">
        <button type="button" className="font-semibold text-brand" onClick={() => navigate('/habits')}>
          Back to habits
        </button>
      </EmptyState>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleDay = (d: Weekday) =>
    set({ days: (draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d]).sort() as Weekday[] });
  const valid = draft.name.trim().length > 0 && draft.days.length > 0;
  const askAt = draft.hasTime ? formatTime(hhmm(minutesOf(draft.time) + draft.askAfterMin)) : formatTime(settings.defaultAskTime);

  const save = async () => {
    if (!valid) return;
    const fields = {
      name: draft.name.trim().slice(0, 60),
      emoji: draft.emoji,
      color: draft.color,
      days: draft.days,
      time: draft.hasTime ? draft.time : null,
      askAfterMin: draft.hasTime ? draft.askAfterMin : 0,
      remind: draft.remind,
      shared: draft.shared,
    };
    if (existing) {
      await saveHabit({ ...existing, ...fields } as Habit);
      showToast('Saved.', { tone: 'good' });
    } else {
      await addHabits([fields]);
      showToast(`Added ${fields.emoji} ${fields.name}.`, { tone: 'good' });
    }
    navigate('/habits');
  };

  return (
    <div className="pb-6">
      <header className="mb-4 flex items-center gap-2 pt-1">
        <IconButton label="Back" onClick={() => navigate('/habits')} className="-ml-2">
          <ArrowLeft size={21} />
        </IconButton>
        <h1 className="text-[22px] font-bold">{existing ? 'Edit habit' : 'New habit'}</h1>
      </header>

      <form
        className="grid grid-cols-1 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="card p-4">
          <div className="flex items-center gap-3">
            <HabitBadge emoji={draft.emoji} color={draft.color} size={52} />
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[13px] font-medium text-ink-3">Name</span>
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value, ...(emojiTouched ? {} : { emoji: suggestEmoji(e.target.value) }) })}
                placeholder="e.g. Gym"
                maxLength={60}
                required
                autoFocus={!existing}
                className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-[16px] outline-none focus:border-brand"
              />
            </label>
          </div>

          <p className="mb-2 mt-4 text-[13px] font-medium text-ink-3">Icon</p>
          <div className="grid grid-cols-8 gap-1.5">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`Icon ${e}`}
                aria-pressed={draft.emoji === e}
                onClick={() => {
                  setEmojiTouched(true);
                  set({ emoji: e });
                }}
                className={cx(
                  'flex aspect-square items-center justify-center rounded-xl text-xl transition',
                  draft.emoji === e ? 'bg-brand-soft ring-2 ring-brand' : 'hover:bg-surface-2',
                )}
              >
                {e}
              </button>
            ))}
          </div>

          <p className="mb-2 mt-4 text-[13px] font-medium text-ink-3">Color</p>
          <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Color">
            {HABIT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={draft.color === c}
                aria-label={c}
                onClick={() => set({ color: c })}
                className={cx('h-9 w-9 rounded-full transition', draft.color === c && 'ring-2 ring-offset-2 ring-offset-[var(--surface)]')}
                style={{ background: habitColorVar(c), ['--tw-ring-color' as string]: habitColorVar(c) }}
              />
            ))}
          </div>
        </section>

        <section className="card p-4">
          <p className="mb-2 text-[13px] font-medium text-ink-3">Which days?</p>
          <div className="grid grid-cols-7 gap-1.5">
            {orderedWeekdays(settings.weekStartsOn).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={draft.days.includes(d)}
                aria-label={weekdayName(d, 'long')}
                onClick={() => toggleDay(d)}
                className={cx(
                  'h-11 rounded-xl text-[14px] font-semibold transition',
                  draft.days.includes(d) ? 'bg-brand text-on-brand' : 'bg-surface-2 text-ink-2 hover:brightness-95',
                )}
              >
                {weekdayName(d, 'narrow')}
              </button>
            ))}
          </div>
          <div className="no-scrollbar -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1">
            {PRESETS.map((p) => (
              <Chip
                key={p.label}
                className="h-8 text-[13px]"
                active={p.days.join() === draft.days.join()}
                onClick={() => set({ days: p.days })}
              >
                {p.label}
              </Chip>
            ))}
          </div>
          {draft.days.length === 0 && <p className="mt-2 text-[13px] text-no">Pick at least one day.</p>}
        </section>

        <section className="card px-4 py-1">
          <Toggle
            checked={draft.hasTime}
            onChange={(v) => set({ hasTime: v })}
            label="At a set time"
            description={draft.hasTime ? undefined : `Any time of day. I'll ask at ${formatTime(settings.defaultAskTime)}.`}
          />
          {draft.hasTime && (
            <div className="grid grid-cols-2 gap-3 pb-4">
              <label className="min-w-0">
                <span className="mb-1 block text-[13px] font-medium text-ink-3">Planned time</span>
                <input
                  type="time"
                  value={draft.time}
                  onChange={(e) => e.target.value && set({ time: e.target.value })}
                  className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface-2 px-3 text-[16px] outline-none focus:border-brand"
                />
              </label>
              <label className="min-w-0">
                <span className="mb-1 block truncate text-[13px] font-medium text-ink-3">Ask "Did you show up?"</span>
                <select
                  value={draft.askAfterMin}
                  onChange={(e) => set({ askAfterMin: Number(e.target.value) })}
                  className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface-2 px-3 text-[15px] outline-none focus:border-brand"
                >
                  {ASK_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {askLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="border-t border-line">
            <Toggle
              checked={draft.remind}
              onChange={(v) => set({ remind: v })}
              label="Yes/No reminder"
              description={`Notification at ${askAt}${remindersOn ? '' : ' (turn reminders on in Settings)'}`}
            />
          </div>
          {SOCIAL_AVAILABLE && (
            <div className="border-t border-line">
              <Toggle
                checked={draft.shared}
                onChange={(v) => set({ shared: v })}
                disabled={!signedIn && !draft.shared}
                label="Share with friends"
                description={
                  signedIn
                    ? "Friends see this habit and this week's Yes/No. Reasons and notes stay private."
                    : 'Create an account in Friends to share habits.'
                }
              />
            </div>
          )}
        </section>

        <Button type="submit" variant="primary" size="lg" disabled={!valid} className="mt-1 w-full">
          {existing ? 'Save changes' : 'Add habit'}
        </Button>
      </form>

      {existing && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await setArchived(existing.id, !existing.archivedAt);
              showToast(existing.archivedAt ? 'Restored.' : 'Archived. Its history stays in your reports.');
              navigate('/habits');
            }}
          >
            <Archive size={16} aria-hidden /> {existing.archivedAt ? 'Restore' : 'Archive'}
          </Button>
          <Button variant="ghost" size="sm" className="!text-no" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} aria-hidden /> Delete
          </Button>
        </div>
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${existing?.name ?? 'habit'}?`}>
        <p className="text-[15px] text-ink-2">This removes the habit and all of its check-ins. If you only want to stop it, archive it instead.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={async () => {
              if (!existing) return;
              await deleteHabit(existing.id);
              setConfirmDelete(false);
              showToast('Deleted.');
              navigate('/habits');
            }}
          >
            Delete forever
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

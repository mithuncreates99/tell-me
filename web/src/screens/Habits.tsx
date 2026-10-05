import { Archive, ArrowDown, ArrowUp, Bell, BellOff, ChevronRight, FileUp, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { QuickAdd, daysLabel } from '../components/QuickAdd';
import { Button, EmptyState, HabitBadge, IconButton, PageHeader, SectionTitle, Sheet } from '../components/ui';
import { formatTime, weekdayName } from '../lib/dates';
import { parseSchedule, type ParsedHabit } from '../lib/parser';
import { scheduleSummary } from '../lib/schedule';
import { navigate } from '../router';
import { useStore } from '../store/useStore';

export const summary = (h: { days: number[]; time: string | null }) =>
  scheduleSummary(h as never, (d) => weekdayName(d as never, 'short'), formatTime);

export function Habits() {
  const habits = useStore((s) => s.habits);
  const moveHabit = useStore((s) => s.moveHabit);
  const setArchived = useStore((s) => s.setArchived);
  const [importOpen, setImportOpen] = useState(false);
  const active = useMemo(() => habits.filter((h) => !h.archivedAt).sort((a, b) => a.order - b.order), [habits]);
  const archived = useMemo(() => habits.filter((h) => h.archivedAt), [habits]);

  return (
    <div>
      <PageHeader
        eyebrow="Habits"
        title="Your habits"
        action={
          <Button variant="primary" size="sm" onClick={() => navigate('/habits/new')}>
            <Plus size={17} strokeWidth={2.5} aria-hidden /> New
          </Button>
        }
      />
      <QuickAdd />
      <button
        type="button"
        onClick={() => setImportOpen(true)}
        className="mt-2.5 inline-flex items-center gap-1.5 px-1 text-[14px] font-semibold text-brand"
      >
        <FileUp size={16} aria-hidden /> Import a whole schedule (paste or file)
      </button>

      <SectionTitle>Active · {active.length}</SectionTitle>
      {active.length === 0 ? (
        <EmptyState icon="✨" title="No habits yet">
          Type one above, like "Gym Mon Wed Fri 6pm".
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-[var(--line)] overflow-hidden">
          {active.map((h, i) => (
            <li key={h.id} className="flex items-center gap-1 pr-2">
              <button
                type="button"
                onClick={() => navigate(`/habits/${h.id}`)}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left hover:bg-surface-2/50"
              >
                <HabitBadge emoji={h.emoji} color={h.color} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{h.name}</span>
                  <span className="flex items-center gap-1.5 truncate text-[13px] text-ink-3">
                    {h.remind ? <Bell size={12} aria-label="Reminders on" /> : <BellOff size={12} aria-label="Reminders off" />}
                    {summary(h)}
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />
              </button>
              <div className="flex flex-col">
                <IconButton label={`Move ${h.name} up`} className="h-8 w-8" disabled={i === 0} onClick={() => void moveHabit(h.id, -1)}>
                  <ArrowUp size={15} />
                </IconButton>
                <IconButton
                  label={`Move ${h.name} down`}
                  className="h-8 w-8"
                  disabled={i === active.length - 1}
                  onClick={() => void moveHabit(h.id, 1)}
                >
                  <ArrowDown size={15} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              <Archive size={13} aria-hidden /> Archived · {archived.length}
            </span>
          </SectionTitle>
          <ul className="card divide-y divide-[var(--line)]">
            {archived.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-3 opacity-75">
                <HabitBadge emoji={h.emoji} color={h.color} size={36} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{h.name}</span>
                <Button size="sm" variant="ghost" onClick={() => void setArchived(h.id, false)}>
                  <RotateCcw size={15} aria-hidden /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [backup, setBackup] = useState<{ data: unknown; habits: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addHabits = useStore((s) => s.addHabits);
  const importBackup = useStore((s) => s.importBackup);
  const showToast = useStore((s) => s.showToast);
  const parsed: ParsedHabit[] = useMemo(() => parseSchedule(text), [text]);
  const chosen = parsed.filter((_, i) => !skip.has(i));

  const close = () => {
    setText('');
    setSkip(new Set());
    setBackup(null);
    onClose();
  };

  const onFile = async (file: File) => {
    const content = await file.text();
    if (file.name.endsWith('.json')) {
      try {
        const data = JSON.parse(content);
        if (data?.app === 'tell-me') {
          setBackup({ data, habits: Array.isArray(data.habits) ? data.habits.length : 0 });
          return;
        }
      } catch {
        /* fall through to text parsing */
      }
    }
    setText(content);
    setSkip(new Set());
  };

  return (
    <Sheet open={open} onClose={close} title="Import your schedule">
      <p className="-mt-1 mb-3 text-[14px] text-ink-2">
        One habit per line, written however you like. CSV rows (name, days, time) and Tell Me backups work too.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSkip(new Set());
        }}
        rows={5}
        placeholder={'Gym Mon Wed Fri 18:00\nFrench class Tue Thu 19h\nRead daily 22:00\nLong run Sat 9am'}
        className="w-full rounded-2xl border border-line bg-surface-2 p-3.5 text-[15px] leading-relaxed outline-none focus:border-brand"
        aria-label="Schedule, one habit per line"
      />
      <div className="mt-2 flex items-center justify-between">
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.json,text/plain,text/csv,application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
        />
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
          <FileUp size={16} aria-hidden /> Choose a file
        </Button>
        <span className="text-[13px] text-ink-3">{parsed.length ? `${parsed.length} found` : ''}</span>
      </div>

      {backup && (
        <div className="mt-3 rounded-2xl bg-brand-soft p-3.5 text-[14px]">
          <p className="font-semibold">This is a Tell Me backup ({backup.habits} habits).</p>
          <p className="mt-0.5 text-ink-2">Restoring replaces the habits and history on this device.</p>
          <Button
            size="sm"
            variant="primary"
            className="mt-3"
            onClick={async () => {
              try {
                const n = await importBackup(backup.data);
                showToast(`Backup restored: ${n} habits.`, { tone: 'good' });
                close();
              } catch (e) {
                showToast(e instanceof Error ? e.message : 'Could not restore that file.', { tone: 'bad' });
              }
            }}
          >
            Restore backup
          </Button>
        </div>
      )}

      {parsed.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-1.5">
          {parsed.map((h, i) => (
            <li key={`${i}-${h.name}`}>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={!skip.has(i)}
                  onChange={() => {
                    const next = new Set(skip);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    setSkip(next);
                  }}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                <span className="text-lg" aria-hidden>
                  {h.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{h.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {daysLabel(h.days)} · {h.time ? formatTime(h.time) : 'any time'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={close}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={chosen.length === 0}
          onClick={async () => {
            await addHabits(chosen.map((h) => ({ name: h.name, emoji: h.emoji, days: h.days, time: h.time })));
            showToast(`Added ${chosen.length} habit${chosen.length === 1 ? '' : 's'}.`, { tone: 'good' });
            close();
          }}
        >
          Add {chosen.length || ''} habit{chosen.length === 1 ? '' : 's'}
        </Button>
      </div>
    </Sheet>
  );
}

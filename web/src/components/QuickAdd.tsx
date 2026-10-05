import { CalendarDays, Clock, CornerDownLeft, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatTime, weekdayName } from '../lib/dates';
import { parseHabit } from '../lib/parser';
import { scheduleSummary } from '../lib/schedule';
import { useStore } from '../store/useStore';
import { Button } from './ui';

const EXAMPLES = ['Gym Mon Wed Fri 6pm', 'Read 20 pages daily 22:00', 'French class Tue/Thu 19h30', 'Run weekends 9am', 'Meditate weekdays 7:30'];

export const daysLabel = (days: number[]) =>
  scheduleSummary({ days: days as never, time: null }, (d) => weekdayName(d as never, 'short'), formatTime).replace(' · any time', '');

export function QuickAdd({ value, onValueChange, autoFocus, onAdded }: {
  value?: string;
  onValueChange?: (v: string) => void;
  autoFocus?: boolean;
  onAdded?: () => void;
}) {
  const [local, setLocal] = useState('');
  const text = value ?? local;
  const setText = onValueChange ?? setLocal;
  const parsed = useMemo(() => parseHabit(text), [text]);
  const addHabits = useStore((s) => s.addHabits);
  const showToast = useStore((s) => s.showToast);
  const [example, setExample] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    if (!parsed) return;
    const [habit] = await addHabits([{ name: parsed.name, emoji: parsed.emoji, days: parsed.days, time: parsed.time }]);
    setText('');
    showToast(`Added ${habit!.emoji} ${habit!.name}. I'll check in ${parsed.time ? `after ${formatTime(parsed.time)}` : 'every evening'}.`, {
      tone: 'good',
    });
    onAdded?.();
  };

  return (
    <form
      className="card p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="quick-add" className="sr-only">
          Add a habit
        </label>
        <input
          id="quick-add"
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Try "${EXAMPLES[example]}"`}
          autoComplete="off"
          enterKeyHint="done"
          className="h-12 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-[16px] outline-none placeholder:text-ink-3"
        />
        <Button type="submit" variant="primary" disabled={!parsed} aria-label="Add habit" className="h-11 w-11 shrink-0 !px-0 sm:w-auto sm:!px-5">
          <Plus size={20} strokeWidth={2.5} aria-hidden />
          <span className="hidden sm:inline">Add</span>
        </Button>
      </div>
      {parsed && (
        <div className="animate-fade flex flex-wrap items-center gap-1.5 px-2 pb-1.5 pt-2 text-[13px]" aria-live="polite">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 font-semibold">
            {parsed.emoji} {parsed.name}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-ink-2">
            <CalendarDays size={13} aria-hidden /> {daysLabel(parsed.days)}
            {parsed.daysDefaulted && <span className="text-ink-3">(default)</span>}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-ink-2">
            <Clock size={13} aria-hidden /> {parsed.time ? formatTime(parsed.time) : 'Any time'}
          </span>
          <span className="ml-auto hidden items-center gap-1 text-ink-3 sm:inline-flex">
            <CornerDownLeft size={13} aria-hidden /> to add
          </span>
        </div>
      )}
    </form>
  );
}

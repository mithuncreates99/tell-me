import { useMemo } from 'react';
import { addDays, orderedWeekdays, parseISODate, startOfWeek, todayISO, weekdayName } from '../lib/dates';
import { tallyRange } from '../lib/stats';
import { useStore } from '../store/useStore';
import { cx } from './ui';

/** Seven days of the current week; each ring fills with that day's share of "Yes". */
export function WeekStrip({ selected, onSelect }: { selected: string; onSelect: (date: string) => void }) {
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const today = todayISO(now);
  const start = startOfWeek(today, settings.weekStartsOn);
  const byDate = useMemo(
    () => tallyRange(habits, checkins, start, addDays(start, 6), settings, now).byDate,
    [habits, checkins, start, settings, now],
  );
  const labels = orderedWeekdays(settings.weekStartsOn);

  return (
    <div className="card grid grid-cols-7 gap-1 p-2.5" role="tablist" aria-label="This week">
      {labels.map((wd, i) => {
        const date = addDays(start, i);
        const t = byDate.get(date);
        const ratio = t && t.due ? t.yes / t.due : 0;
        const isToday = date === today;
        const isSelected = date === selected;
        const future = date > today;
        const r = 16;
        const c = 2 * Math.PI * r;
        return (
          <button
            key={date}
            type="button"
            role="tab"
            aria-selected={isSelected}
            disabled={future}
            onClick={() => onSelect(date)}
            aria-label={`${weekdayName(wd, 'long')}${t ? `, ${t.yes} of ${t.due} done` : ''}`}
            className={cx(
              'flex flex-col items-center gap-1 rounded-2xl py-1.5 transition',
              isSelected ? 'bg-brand-soft' : 'hover:bg-surface-2',
              future && 'opacity-40',
            )}
          >
            <span className={cx('text-[11px] font-semibold uppercase', isToday ? 'text-brand' : 'text-ink-3')}>
              {weekdayName(wd, 'narrow')}
            </span>
            <span className="relative flex h-10 w-10 items-center justify-center">
              <svg width="40" height="40" className="absolute -rotate-90" aria-hidden>
                <circle cx="20" cy="20" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="3.5" />
                {ratio > 0 && (
                  <circle
                    cx="20"
                    cy="20"
                    r={r}
                    fill="none"
                    stroke={ratio === 1 ? 'var(--yes)' : 'var(--brand)'}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={c * (1 - ratio)}
                  />
                )}
              </svg>
              <span className={cx('text-[14px] font-semibold tabular', isToday && 'text-brand')}>
                {parseISODate(date).getDate()}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { heatColor, HeatLegend } from '../charts/ChartKit';
import { OccurrenceCard } from '../components/Occurrence';
import { Chip, EmptyState, IconButton, PageHeader, Sheet, cx } from '../components/ui';
import { addDays, formatDate, orderedWeekdays, parseISODate, startOfWeek, todayISO, weekdayName } from '../lib/dates';
import { occurrencesOn } from '../lib/schedule';
import { pct, rateOf, tallyRange } from '../lib/stats';
import { useStore } from '../store/useStore';

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const addMonths = (first: string, n: number) => {
  const d = parseISODate(first);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

export function CalendarScreen() {
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const today = todayISO(now);
  const [month, setMonth] = useState(monthStart(today));
  const [filter, setFilter] = useState<string>('all');
  const [openDate, setOpenDate] = useState<string | null>(null);

  const shown = useMemo(() => (filter === 'all' ? habits : habits.filter((h) => h.id === filter)), [habits, filter]);
  const gridStart = startOfWeek(month, settings.weekStartsOn);
  const nextMonth = addMonths(month, 1);
  const weeks = Math.ceil((Math.round((parseISODate(nextMonth).getTime() - parseISODate(gridStart).getTime()) / 86_400_000)) / 7);
  const gridEnd = addDays(gridStart, weeks * 7 - 1);

  const { byDate } = useMemo(() => tallyRange(shown, checkins, gridStart, gridEnd, settings, now), [shown, checkins, gridStart, gridEnd, settings, now]);
  const monthTotal = useMemo(
    () => tallyRange(shown, checkins, month, addDays(nextMonth, -1), settings, now).total,
    [shown, checkins, month, nextMonth, settings, now],
  );
  const earliest = habits.reduce((min, h) => (h.createdAt < min ? h.createdAt : min), today);
  const dayOccurrences = openDate ? occurrencesOn(habits, openDate, checkins, settings, now) : [];

  return (
    <div>
      <PageHeader eyebrow="Calendar" title={formatDate(month, { month: 'long', year: 'numeric' })} />

      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filter by habit">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All habits
        </Chip>
        {habits
          .filter((h) => !h.archivedAt)
          .map((h) => (
            <Chip key={h.id} active={filter === h.id} onClick={() => setFilter(h.id)}>
              {h.emoji} {h.name}
            </Chip>
          ))}
      </div>

      <section className="card p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between">
          <IconButton label="Previous month" disabled={month <= monthStart(earliest)} onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft size={20} />
          </IconButton>
          <p className="text-[14px] text-ink-2">
            {monthTotal.due ? (
              <>
                <span className="font-bold text-ink">{pct(rateOf(monthTotal))}</span> · {monthTotal.yes} of {monthTotal.due}
              </>
            ) : (
              'No check-ins yet'
            )}
          </p>
          <IconButton label="Next month" disabled={nextMonth > today} onClick={() => setMonth(nextMonth)}>
            <ChevronRight size={20} />
          </IconButton>
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="grid" aria-label="Month">
          {orderedWeekdays(settings.weekStartsOn).map((wd) => (
            <div key={wd} role="columnheader" className="pb-1 text-center text-[11px] font-semibold uppercase text-ink-3">
              {weekdayName(wd, 'short')}
            </div>
          ))}
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const date = addDays(gridStart, i);
            const inMonth = date.slice(0, 7) === month.slice(0, 7);
            const t = byDate.get(date);
            const future = date > today;
            const occ = future || !inMonth ? [] : occurrencesOn(shown, date, checkins, settings, now);
            const bg = inMonth && t && t.due > 0 ? heatColor({ due: t.due, yes: t.yes, future }) : 'transparent';
            const dark = t && t.due > 0 && t.yes / t.due >= 0.5;
            return (
              <button
                key={date}
                type="button"
                role="gridcell"
                disabled={!inMonth || future}
                onClick={() => setOpenDate(date)}
                aria-label={`${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}${t ? `: ${t.yes} of ${t.due} done` : ''}`}
                className={cx(
                  'relative flex aspect-square flex-col items-center justify-center rounded-xl text-[14px] font-semibold transition sm:aspect-[1/0.9]',
                  !inMonth && 'invisible',
                  future && 'text-ink-3',
                  date === today && 'ring-2 ring-brand',
                  inMonth && !future && 'hover:brightness-95',
                )}
                style={{ background: bg, color: dark ? 'var(--heat-ink)' : undefined }}
              >
                <span className="tabular -mt-1.5">{parseISODate(date).getDate()}</span>
                {occ.length > 0 && (
                  <span className="absolute bottom-1 flex gap-[3px] rounded-full bg-surface px-1 py-[3px]" aria-hidden>
                    {occ.slice(0, 5).map((o) => (
                      <span
                        key={o.habit.id}
                        className="h-[5px] w-[5px] rounded-full"
                        style={{ background: o.state === 'yes' ? 'var(--yes)' : o.state === 'no' ? 'var(--no)' : 'var(--axis)' }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-4 space-y-1.5 px-1">
          <HeatLegend />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="h-[6px] w-[6px] rounded-full bg-yes" /> Yes
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[6px] w-[6px] rounded-full bg-no" /> No
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[6px] w-[6px] rounded-full bg-[var(--axis)]" /> Unanswered
            </span>
          </div>
        </div>
      </section>

      {habits.length === 0 && (
        <div className="mt-4">
          <EmptyState icon="🗓️" title="Your month will fill up here">
            Add habits on the Habits tab, then answer Yes or No each day.
          </EmptyState>
        </div>
      )}

      <Sheet
        open={!!openDate}
        onClose={() => setOpenDate(null)}
        title={openDate ? formatDate(openDate, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
      >
        {dayOccurrences.length === 0 ? (
          <p className="text-[15px] text-ink-3">Nothing was planned on this day.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {dayOccurrences.map((o) => (
              <OccurrenceCard key={o.habit.id} o={o} />
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

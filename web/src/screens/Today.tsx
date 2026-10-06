import { Bell, CalendarDays, ChevronRight, Flame, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DemoBanner } from '../components/DemoBanner';
import { OccurrenceCard } from '../components/Occurrence';
import { Button, EmptyState, IconButton, PageHeader, ProgressRing, SectionTitle } from '../components/ui';
import { WeekStrip } from '../components/WeekStrip';
import { addDays, formatDate, formatTime, hhmm, relativeDay, todayISO } from '../lib/dates';
import { useRemindersOn } from '../components/PushPanel';
import { IS_NATIVE } from '../lib/native';
import { pushBlocker } from '../lib/push';
import { askMinutes, occurrencesOn, pendingBeforeToday } from '../lib/schedule';
import { streakFor } from '../lib/stats';
import { navigate } from '../router';
import { useStore } from '../store/useStore';
import { Welcome } from './Welcome';

function greeting(hour: number) {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Today() {
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const updateSettings = useStore((s) => s.updateSettings);
  const remindersOn = useRemindersOn();
  const today = todayISO(now);
  const [selected, setSelected] = useState(today);

  useEffect(() => setSelected(today), [today]); // midnight rollover

  const todays = useMemo(() => occurrencesOn(habits, today, checkins, settings, now), [habits, today, checkins, settings, now]);
  const day = useMemo(
    () => (selected === today ? todays : occurrencesOn(habits, selected, checkins, settings, now)),
    [selected, today, todays, habits, checkins, settings, now],
  );
  const pending = useMemo(() => pendingBeforeToday(habits, checkins, settings, now, 7), [habits, checkins, settings, now]);
  const topStreak = useMemo(() => {
    let best: { name: string; emoji: string; n: number } | null = null;
    for (const h of habits) {
      if (h.archivedAt) continue;
      const n = streakFor(h, checkins, settings, now).current;
      if (n >= 2 && (!best || n > best.n)) best = { name: h.name, emoji: h.emoji, n };
    }
    return best;
  }, [habits, checkins, settings, now]);

  if (habits.length === 0) return <Welcome />;

  const done = todays.filter((o) => o.state === 'yes').length;
  const answered = todays.filter((o) => o.state === 'yes' || o.state === 'no').length;
  const next = todays.find((o) => o.state === 'upcoming');
  const showPushPromo = !remindersOn && !settings.dismissedPushPromo && (IS_NATIVE || pushBlocker() !== 'preview');

  let nextPlanned: string | null = null;
  if (todays.length === 0) {
    for (let i = 1; i <= 7 && !nextPlanned; i++) {
      const d = addDays(today, i);
      const o = occurrencesOn(habits, d, checkins, settings, now)[0];
      if (o) nextPlanned = `${relativeDay(d, today)}: ${o.habit.emoji} ${o.habit.name}`;
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`${greeting(now.getHours())}${settings.name ? `, ${settings.name}` : ''}`}
        action={
          <IconButton label="Calendar" onClick={() => navigate('/calendar')} className="md:hidden">
            <CalendarDays size={21} />
          </IconButton>
        }
      />
      <DemoBanner />

      <section className="card flex items-center gap-4 p-4" aria-label="Today's progress">
        <ProgressRing value={todays.length ? done / todays.length : 0} size={68} label={`${done} of ${todays.length} done today`}>
          <span className="text-[15px] font-bold">
            {done}/{todays.length}
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          {todays.length === 0 ? (
            <>
              <p className="text-[17px] font-semibold">Rest day 🌿</p>
              <p className="truncate text-[14px] text-ink-3">{nextPlanned ? `Next up ${nextPlanned}` : 'Nothing planned this week.'}</p>
            </>
          ) : (
            <>
              <p className="text-[17px] font-semibold">
                {done} of {todays.length} done today
              </p>
              <p className="line-clamp-2 text-[14px] leading-snug text-ink-3">
                {next
                  ? `Next: ${next.habit.emoji} ${next.habit.name}, I'll ask at ${formatTime(hhmm(askMinutes(next.habit, settings)))}`
                  : answered === todays.length
                    ? 'All answered. See you tomorrow 👋'
                    : 'Some check-ins are waiting for you below.'}
              </p>
            </>
          )}
          {topStreak && (
            <p className="mt-1 flex items-center gap-1 text-[13px] font-semibold text-flame">
              <Flame size={14} aria-hidden /> {topStreak.emoji} {topStreak.name}: {topStreak.n} in a row
            </p>
          )}
        </div>
      </section>

      {showPushPromo && (
        <section className="card mt-3 flex items-center gap-3 p-3.5 pl-4">
          <Bell size={20} className="shrink-0 text-brand" aria-hidden />
          <p className="min-w-0 flex-1 text-[14px]">
            <span className="font-semibold">Get a Yes/No ping</span>{' '}
            <span className="text-ink-3">when it's time to check in.</span>
          </p>
          <Button size="sm" variant="primary" onClick={() => navigate('/settings')}>
            Set up
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2"
            onClick={() => void updateSettings({ dismissedPushPromo: true })}
          >
            <X size={16} />
          </button>
        </section>
      )}

      <div className="mt-3">
        <WeekStrip selected={selected} onSelect={setSelected} />
      </div>

      {selected === today && pending.length > 0 && (
        <>
          <SectionTitle>Catch up · {pending.length}</SectionTitle>
          <div className="grid grid-cols-1 gap-2.5">
            {pending.slice(0, 5).map((o) => (
              <OccurrenceCard key={`${o.habit.id}:${o.date}`} o={o} showDate />
            ))}
            {pending.length > 5 && (
              <p className="px-1 text-[13px] text-ink-3">+{pending.length - 5} more from earlier this week. Answer these first.</p>
            )}
          </div>
        </>
      )}

      <SectionTitle
        action={
          selected !== today && (
            <button type="button" className="flex items-center text-[13px] font-semibold text-brand" onClick={() => setSelected(today)}>
              Back to today <ChevronRight size={15} />
            </button>
          )
        }
      >
        {selected === today ? 'Today' : formatDate(selected, { weekday: 'long', day: 'numeric', month: 'long' })}
      </SectionTitle>
      {day.length === 0 ? (
        <EmptyState icon="🌿" title="Nothing planned">
          {selected === today ? 'Enjoy the rest day.' : 'No habits were scheduled on this day.'}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {day.map((o) => (
            <OccurrenceCard key={`${o.habit.id}:${o.date}`} o={o} />
          ))}
        </div>
      )}
    </div>
  );
}

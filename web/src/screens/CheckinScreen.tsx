import { Check, Flame, X } from 'lucide-react';
import { useMemo } from 'react';
import { useAnswer } from '../components/Occurrence';
import { Button, EmptyState, HabitBadge } from '../components/ui';
import { addDays, formatDate, formatTime, relativeDay, todayISO } from '../lib/dates';
import { REASON_LABEL } from '../lib/labels';
import { isScheduledOn, occurrence } from '../lib/schedule';
import { streakFor } from '../lib/stats';
import { navigate } from '../router';
import { useStore } from '../store/useStore';

/** Focused Yes/No screen opened from a notification or a calendar alarm. */
export function CheckinScreen({ habitId, date }: { habitId: string; date?: string }) {
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const clearAnswer = useStore((s) => s.clearAnswer);
  const onAnswer = useAnswer();
  const habit = habits.find((h) => h.id === habitId);
  const today = todayISO(now);

  // Without a date (calendar links), use the most recent scheduled day up to today.
  const day = useMemo(() => {
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today) return date;
    if (!habit) return today;
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, -i);
      if (isScheduledOn(habit, d)) return d;
    }
    return today;
  }, [date, habit, today]);

  if (!habit) {
    return (
      <div className="pt-10">
        <EmptyState icon="🤷" title="That habit no longer exists">
          <button type="button" className="font-semibold text-brand" onClick={() => navigate('/')}>
            Go to Today
          </button>
        </EmptyState>
      </div>
    );
  }

  const o = occurrence(habit, day, checkins, settings, now);
  const streak = streakFor(habit, checkins, settings, now).current;
  const answered = o.state === 'yes' || o.state === 'no';

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center pt-6 text-center">
      <div className="animate-rise flex flex-col items-center">
        <HabitBadge emoji={habit.emoji} color={habit.color} size={88} />
        <p className="mt-5 text-[14px] font-semibold uppercase tracking-wide text-ink-3">
          {relativeDay(day, today)} · {formatDate(day, { day: 'numeric', month: 'long' })}
          {habit.time ? ` · ${formatTime(habit.time)}` : ''}
        </p>
        <h1 className="mt-2 text-[30px] font-bold leading-tight tracking-tight">
          {habit.name}: did you show up?
        </h1>
      </div>

      {answered ? (
        <div className="animate-rise mt-8 w-full">
          {o.state === 'yes' ? (
            <p className="text-[18px] font-semibold text-yes">
              <Check className="mr-1 inline" size={22} strokeWidth={3} aria-hidden />
              Yes, logged.
              {streak >= 2 && (
                <span className="mt-1 block text-[15px] text-flame">
                  <Flame size={16} className="inline -translate-y-0.5" aria-hidden /> {streak} in a row
                </span>
              )}
            </p>
          ) : (
            <p className="text-[18px] font-semibold text-no">
              <X className="mr-1 inline" size={22} strokeWidth={3} aria-hidden />
              Missed{o.checkin?.reason ? ` · ${REASON_LABEL[o.checkin.reason]}` : ''}. Tomorrow's a new day.
            </p>
          )}
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="ghost" onClick={() => void clearAnswer(habit.id, day)}>
              Change answer
            </Button>
            <Button variant="primary" onClick={() => navigate('/')}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="animate-rise mt-8 grid w-full grid-cols-2 gap-3">
          <Button variant="yes" size="lg" className="h-20 text-[20px]" onClick={() => void onAnswer(o, 'yes')}>
            <Check size={26} strokeWidth={3} aria-hidden /> Yes
          </Button>
          <Button variant="no" size="lg" className="h-20 text-[20px]" onClick={() => void onAnswer(o, 'no')}>
            <X size={26} strokeWidth={3} aria-hidden /> No
          </Button>
        </div>
      )}
    </div>
  );
}

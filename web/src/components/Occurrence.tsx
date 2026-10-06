import { Check, Flame, RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatTime, hhmm, relativeDay, todayISO } from '../lib/dates';
import { REASON_EMOJI, REASON_LABEL } from '../lib/labels';
import { IS_NATIVE, tapFeedback } from '../lib/native';
import { askMinutes, checkinKey, type Occurrence } from '../lib/schedule';
import { streakFor } from '../lib/stats';
import { MISS_REASONS, type MissReason } from '../lib/types';
import { useSocial } from '../store/useSocial';
import { useStore } from '../store/useStore';
import { Button, Chip, HabitBadge, Sheet, cx } from './ui';

/** Friends' reactions to this check-in ("🔥 Bea"). */
function FriendReactions({ habitId, date }: { habitId: string; date: string }) {
  const feed = useSocial((s) => s.feed);
  if (!feed) return null;
  const mine = feed.reactions.filter((r) => r.to === feed.me.id && r.habitId === habitId && r.date === date);
  if (mine.length === 0) return null;
  const names = new Map(feed.friends.map((f) => [f.id, f.name]));
  return (
    <p className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Reactions from friends">
      {mine.map((r) => (
        <span key={r.from} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-[13px] font-medium text-ink-2">
          <span aria-hidden>{r.emoji}</span> {names.get(r.from) ?? 'A friend'}
        </span>
      ))}
    </p>
  );
}

/** Records an answer with the right feedback: a streak toast for Yes, the reason sheet for No. */
export function useAnswer() {
  const answer = useStore((s) => s.answer);
  const clearAnswer = useStore((s) => s.clearAnswer);
  const showToast = useStore((s) => s.showToast);
  const askReason = useStore((s) => s.askReason);

  return async (o: Pick<Occurrence, 'habit' | 'date'>, value: 'yes' | 'no') => {
    if (IS_NATIVE) tapFeedback();
    await answer(o.habit.id, o.date, value);
    if (value === 'no') {
      askReason({ habitId: o.habit.id, date: o.date });
      return;
    }
    const { checkins, settings, now } = useStore.getState();
    const streak = streakFor(o.habit, checkins, settings, now).current;
    showToast(streak >= 2 ? `🔥 ${streak} in a row for ${o.habit.name}!` : `Nice! ${o.habit.emoji} ${o.habit.name} logged.`, {
      tone: 'good',
      action: { label: 'Undo', run: () => void clearAnswer(o.habit.id, o.date) },
    });
  };
}

export function OccurrenceCard({ o, showDate = false }: { o: Occurrence; showDate?: boolean }) {
  const onAnswer = useAnswer();
  const clearAnswer = useStore((s) => s.clearAnswer);
  const askReason = useStore((s) => s.askReason);
  const settings = useStore((s) => s.settings);
  const checkins = useStore((s) => s.checkins);
  const now = useStore((s) => s.now);
  const [popped, setPopped] = useState(false);
  const streak = useMemo(() => streakFor(o.habit, checkins, settings, now).current, [o.habit, checkins, settings, now]);
  const today = todayISO(now);

  const when = o.habit.time ? formatTime(o.habit.time) : 'Any time';
  const askLabel = formatTime(hhmm(askMinutes(o.habit, settings)));
  const caption =
    o.state === 'upcoming'
      ? `${when} · I'll ask at ${askLabel}`
      : o.state === 'pending'
        ? `${when} · waiting for your answer`
        : when;

  const answered = o.state === 'yes' || o.state === 'no';

  return (
    <article
      className={cx('card animate-rise min-w-0 p-4', popped && 'animate-pop')}
      onAnimationEnd={() => setPopped(false)}
      aria-label={`${o.habit.name}, ${relativeDay(o.date, today)}`}
    >
      <div className="flex items-center gap-3">
        <HabitBadge emoji={o.habit.emoji} color={o.habit.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[16px] font-semibold">{o.habit.name}</h3>
            {streak >= 2 && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-flame" title={`${streak} in a row`}>
                <Flame size={14} aria-hidden /> {streak}
              </span>
            )}
          </div>
          <p className="truncate text-[13px] text-ink-3">
            {showDate && <span className="font-medium text-ink-2">{relativeDay(o.date, today)} · </span>}
            {caption}
          </p>
        </div>
        {answered && (
          <div className="flex shrink-0 items-center gap-1">
            {o.state === 'yes' ? (
              <span className="inline-flex h-8 items-center gap-1 rounded-full bg-yes-soft px-3 text-[13px] font-semibold text-yes">
                <Check size={15} strokeWidth={3} aria-hidden /> Showed up
              </span>
            ) : (
              <button
                type="button"
                onClick={() => askReason({ habitId: o.habit.id, date: o.date })}
                className="inline-flex h-8 max-w-[150px] items-center gap-1 rounded-full bg-no-soft px-3 text-[13px] font-semibold text-no"
                title="Why did you miss it?"
              >
                <X size={15} strokeWidth={3} aria-hidden />
                <span className="truncate">{o.checkin?.reason ? REASON_LABEL[o.checkin.reason] : 'Missed'}</span>
              </button>
            )}
            <button
              type="button"
              aria-label={`Change answer for ${o.habit.name}`}
              title="Change answer"
              onClick={() => void clearAnswer(o.habit.id, o.date)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2"
            >
              <RotateCcw size={15} />
            </button>
          </div>
        )}
      </div>

      {answered && o.habit.shared && <FriendReactions habitId={o.habit.id} date={o.date} />}

      {!answered && (
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <Button
            variant="yes"
            size="md"
            className="w-full"
            onClick={() => {
              setPopped(true);
              void onAnswer(o, 'yes');
            }}
            aria-label={`Yes, I showed up for ${o.habit.name}`}
          >
            <Check size={18} strokeWidth={3} aria-hidden /> Yes
          </Button>
          <Button variant="no" size="md" className="w-full" onClick={() => void onAnswer(o, 'no')} aria-label={`No, I missed ${o.habit.name}`}>
            <X size={18} strokeWidth={3} aria-hidden /> No
          </Button>
        </div>
      )}
    </article>
  );
}

/** "What got in the way?" – optional, one tap. Feeds the "why you miss" insight. */
export function ReasonSheet() {
  const target = useStore((s) => s.reasonFor);
  const askReason = useStore((s) => s.askReason);
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const setReason = useStore((s) => s.setReason);
  const showToast = useStore((s) => s.showToast);
  const clearAnswer = useStore((s) => s.clearAnswer);
  const [note, setNote] = useState('');

  const habit = target ? habits.find((h) => h.id === target.habitId) : undefined;
  const existing = target ? checkins.get(checkinKey(target.habitId, target.date)) : undefined;
  const close = () => {
    askReason(null);
    setNote('');
  };

  const choose = async (reason: MissReason) => {
    if (!target) return;
    await setReason(target.habitId, target.date, reason, note || existing?.note);
    close();
    showToast('Got it. That helps your weekly insights.', {
      action: { label: 'Undo', run: () => void clearAnswer(target.habitId, target.date) },
    });
  };

  return (
    <Sheet open={!!target && !!habit} onClose={close} title={habit ? `${habit.emoji} ${habit.name}: what got in the way?` : ''}>
      <p className="-mt-2 mb-4 text-[14px] text-ink-3">Optional. It only takes a tap and powers your insights.</p>
      <div className="grid grid-cols-2 gap-2">
        {MISS_REASONS.map((r) => (
          <Chip key={r} active={existing?.reason === r} onClick={() => void choose(r)} className="h-12 justify-start text-[15px]">
            <span aria-hidden>{REASON_EMOJI[r]}</span> {REASON_LABEL[r]}
          </Chip>
        ))}
      </div>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink-3">Note (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder={existing?.note ?? 'e.g. late lecture'}
          className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-[15px] outline-none focus:border-brand"
        />
      </label>
      <div className="mt-5 flex gap-2">
        <Button className="flex-1" variant="ghost" onClick={close}>
          Skip
        </Button>
        {note && (
          <Button
            className="flex-1"
            variant="primary"
            onClick={() => target && void setReason(target.habitId, target.date, existing?.reason, note).then(close)}
          >
            Save note
          </Button>
        )}
      </div>
    </Sheet>
  );
}

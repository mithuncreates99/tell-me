import { addDays, todayISO, weekdayName } from './dates';
import { REASON_ADVICE, REASON_LABEL } from './labels';
import { askAt, checkinKey, forEachOccurrence, type CheckinMap } from './schedule';
import {
  bestPastWeekYes,
  compareWithLastWeek,
  dayPartTallies,
  pct,
  rateOf,
  reasonCounts,
  streakFor,
  tallyRange,
  weekdayTallies,
  weekStats,
} from './stats';
import type { Habit, ISODate, Settings, Weekday } from './types';

export interface Insight {
  id: string;
  tone: 'good' | 'bad' | 'neutral';
  icon: string;
  title: string;
  detail: string;
  /** Higher shows first. */
  priority: number;
  action?: 'answer-pending';
}

export interface InsightInput {
  habits: Habit[];
  checkins: CheckinMap;
  settings: Pick<Settings, 'defaultAskTime' | 'weekStartsOn'>;
  now: Date;
  weekStart: ISODate;
}

const MIN_DUE = 3;

/**
 * Turns raw check-ins into a handful of plain-language observations.
 * Every rule needs a minimum amount of data so it never "discovers" a pattern from two data points.
 */
export function buildInsights({ habits, checkins, settings, now, weekStart }: InsightInput): Insight[] {
  const out: Insight[] = [];
  const today = todayISO(now);
  const weekEnd = addDays(weekStart, 6);
  const inProgress = today >= weekStart && today <= weekEnd;
  const { current: week, previous: prev } = compareWithLastWeek(habits, checkins, weekStart, settings, now);
  const rate = rateOf(week);
  const prevRate = rateOf(prev);
  // History "as of" the end of the selected week, so past weeks read sensibly.
  const asOf = inProgress || weekEnd > today ? today : weekEnd;
  const history = tallyRange(habits, checkins, addDays(asOf, -55), asOf, settings, now).total;

  if (history.due === 0) {
    return [
      {
        id: 'empty',
        tone: 'neutral',
        icon: '🌱',
        title: 'Your insights will grow here',
        detail: 'Answer a few Yes/No check-ins and Tell Me will start spotting your patterns.',
        priority: 1,
      },
    ];
  }

  // 1. Perfect week
  if (week.due >= MIN_DUE && week.yes === week.due) {
    out.push({
      id: 'perfect',
      tone: 'good',
      icon: '🏆',
      title: inProgress ? `Perfect so far: ${week.yes} out of ${week.due}` : `Perfect week: ${week.yes} out of ${week.due}`,
      detail: 'You showed up every single time.',
      priority: 100,
    });
  }

  // 2. Week over week
  if (rate !== null && prevRate !== null && week.due >= MIN_DUE && prev.due >= MIN_DUE) {
    const diff = Math.round((rate - prevRate) * 100);
    if (diff >= 10) {
      out.push({
        id: 'week-up',
        tone: 'good',
        icon: '📈',
        title: inProgress ? `Up ${diff} points on this time last week` : `Up ${diff} points on last week`,
        detail: `${pct(rate)} vs ${pct(prevRate)}. Momentum is building.`,
        priority: 80,
      });
    } else if (diff <= -10) {
      out.push({
        id: 'week-down',
        tone: 'bad',
        icon: '📉',
        title: inProgress ? `Down ${-diff} points from this time last week` : `Down ${-diff} points from last week`,
        detail: `${pct(rate)} vs ${pct(prevRate)}.${worstHabitNote(habits, checkins, weekStart, settings, now)}`,
        priority: 85,
      });
    } else if (week.yes !== week.due) {
      out.push({
        id: 'week-steady',
        tone: 'neutral',
        icon: '➡️',
        title: 'A steady week',
        detail: `${pct(rate)}, within a few points of last week (${pct(prevRate)}).`,
        priority: 30,
      });
    }
  }

  // 3. Best week ever / almost there
  const best = bestPastWeekYes(habits, checkins, weekStart, settings, now);
  if (best.weeks >= 2 && week.yes > best.yes) {
    out.push({
      id: 'best-week',
      tone: 'good',
      icon: '⭐',
      title: inProgress ? 'On track for your best week yet' : 'Your best week yet',
      detail: `${week.yes} Yes answers, beating your previous best of ${best.yes}.`,
      priority: 90,
    });
  } else if (inProgress && best.weeks >= 2) {
    let remaining = 0;
    forEachOccurrence(habits, today, weekEnd, (h, date) => {
      if (!checkins.has(checkinKey(h.id, date)) && askAt(h, date, settings) > now) remaining++;
    });
    const need = best.yes + 1 - week.yes;
    if (need > 0 && need <= Math.min(3, remaining)) {
      out.push({
        id: 'almost-best',
        tone: 'neutral',
        icon: '🎯',
        title: `${need} more Yes ${need === 1 ? 'beats' : 'beat'} your best week`,
        detail: `You're at ${week.yes}; your record is ${best.yes}. ${remaining} check-in${remaining === 1 ? '' : 's'} left this week.`,
        priority: 60,
      });
    }
  }

  // 4. Weekday patterns (last 8 weeks)
  const byWeekday = [...weekdayTallies(habits, checkins, settings, now).entries()].filter(([, t]) => t.due >= 4);
  const overall = rateOf(history);
  if (byWeekday.length >= 3 && overall !== null) {
    const ranked = byWeekday.map(([d, t]) => ({ d, r: rateOf(t)! })).sort((a, b) => a.r - b.r);
    const weakest = ranked[0]!;
    const strongest = ranked[ranked.length - 1]!;
    if (weakest.r <= overall - 0.15) {
      out.push({
        id: 'weak-day',
        tone: 'bad',
        icon: '🗓️',
        title: `${plural(weakest.d)} are your weak spot`,
        detail: `${pct(weakest.r)} on ${plural(weakest.d)} vs ${pct(overall)} overall in the last 8 weeks.`,
        priority: 70,
      });
    }
    if (strongest.r >= 0.85 && strongest.d !== weakest.d) {
      out.push({
        id: 'strong-day',
        tone: 'good',
        icon: '💪',
        title: `${plural(strongest.d)} are rock solid`,
        detail: `${pct(strongest.r)} on ${plural(strongest.d)} over the last 8 weeks.`,
        priority: 40,
      });
    }
  }

  // 5. Why you miss (last 4 weeks)
  const reasons = reasonCounts(habits, checkins, addDays(today, -27), today);
  const topReason = [...reasons.counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const withReason = reasons.misses - reasons.withoutReason;
  if (topReason && reasons.misses >= 3 && topReason[1] >= 2 && topReason[1] / withReason >= 0.4) {
    out.push({
      id: 'top-reason',
      tone: 'neutral',
      icon: '💡',
      title: `"${REASON_LABEL[topReason[0]]}" is behind ${topReason[1]} of your ${reasons.misses} misses`,
      detail: REASON_ADVICE[topReason[0]],
      priority: 65,
    });
  }

  // 6. Streaks (only meaningful when looking at the current week)
  const active = habits.filter((h) => !h.archivedAt);
  const streaks = (inProgress ? active : [])
    .map((h) => ({ h, s: streakFor(h, checkins, settings, now) }))
    .sort((a, b) => b.s.current - a.s.current);
  const top = streaks[0];
  if (top && top.s.current >= 3) {
    const record = top.s.current >= top.s.best;
    out.push({
      id: 'streak',
      tone: 'good',
      icon: '🔥',
      title: record
        ? `New record: ${top.s.current} in a row for ${top.h.name}`
        : `${top.s.current} in a row for ${top.h.name}`,
      detail: record ? 'Your longest streak ever for this habit.' : `Your best is ${top.s.best}. Keep it going!`,
      priority: record ? 75 : 50,
    });
  }

  // 7. Morning vs evening (last 8 weeks)
  const parts = dayPartTallies(habits, checkins, settings, now);
  const morning = rateOf(parts.morning);
  const evening = rateOf(parts.evening);
  if (morning !== null && evening !== null && parts.morning.due >= 6 && parts.evening.due >= 6) {
    const diff = morning - evening;
    if (Math.abs(diff) >= 0.15) {
      const better = diff > 0 ? 'morning' : 'evening';
      out.push({
        id: 'day-part',
        tone: 'neutral',
        icon: diff > 0 ? '🌅' : '🌙',
        title: `You show up more in the ${better}`,
        detail: `${pct(morning)} for morning habits vs ${pct(evening)} for evening ones. Put the hardest habit in your strong slot.`,
        priority: 45,
      });
    }
  }

  // 8. Habit that needs attention (last 4 weeks)
  const recent = tallyRange(active, checkins, addDays(today, -27), today, settings, now).byHabit;
  const slipping = (inProgress ? active : [])
    .map((h) => ({ h, t: recent.get(h.id) }))
    .filter((x) => x.t && x.t.due >= 4)
    .map((x) => ({ h: x.h, r: rateOf(x.t!)! }))
    .sort((a, b) => a.r - b.r)[0];
  if (slipping && slipping.r < 0.5) {
    out.push({
      id: 'slipping',
      tone: 'bad',
      icon: '🧭',
      title: `${slipping.h.name} is slipping`,
      detail: `${pct(slipping.r)} over the last 4 weeks. Try a smaller version or a different time.`,
      priority: 72,
    });
  }

  // 9. Unanswered check-ins
  if (week.unanswered >= 2) {
    out.push({
      id: 'unanswered',
      tone: 'neutral',
      icon: '❔',
      title: `${week.unanswered} check-ins still unanswered`,
      detail: 'Unanswered counts as a miss. Answer them so your stats stay honest.',
      priority: 55,
      action: 'answer-pending',
    });
  }

  return out.sort((a, b) => b.priority - a.priority).slice(0, 6);
}

const plural = (d: Weekday) => `${weekdayName(d, 'long')}s`;

function worstHabitNote(
  habits: Habit[],
  checkins: CheckinMap,
  weekStart: ISODate,
  settings: Pick<Settings, 'defaultAskTime'>,
  now: Date,
): string {
  const { byHabit } = weekStats(habits, checkins, weekStart, settings, now);
  let worst: { name: string; missed: number } | null = null;
  for (const h of habits) {
    const t = byHabit.get(h.id);
    if (!t) continue;
    const missed = t.no + t.unanswered;
    if (missed > 0 && (!worst || missed > worst.missed)) worst = { name: h.name, missed };
  }
  return worst ? ` ${worst.name} had the most misses (${worst.missed}).` : '';
}

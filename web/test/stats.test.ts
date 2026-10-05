import { describe, expect, it } from 'vitest';
import {
  bestPastWeekYes,
  dayPartTallies,
  heatmapWeeks,
  rateOf,
  reasonCounts,
  streakFor,
  tallyRange,
  weekdayTallies,
  weeklySeries,
} from '../src/lib/stats';
import { at, checkin, habit, map, settings } from './helpers';

const gym = habit(); // Mon/Wed/Fri 18:00, asked 19:00, since Mon 31 Aug
// Week of Mon 28 Sep – Sun 4 Oct: Mon yes, Wed no (tired), Fri yes
const history = [
  checkin('gym', '2026-09-28', 'yes'),
  checkin('gym', '2026-09-30', 'no', 'tired'),
  checkin('gym', '2026-10-02', 'yes'),
];

describe('tallyRange', () => {
  it('counts answered and past-due occurrences, ignoring the future', () => {
    const now = at('2026-10-05T19:30:00+02:00'); // Monday evening, today's gym is pending
    const { total, byHabit } = tallyRange([gym], map(history), '2026-09-28', '2026-10-11', settings, now);
    expect(total).toEqual({ due: 4, yes: 2, no: 1, unanswered: 1 });
    expect(rateOf(total)).toBe(0.5);
    expect(byHabit.get('gym')?.due).toBe(4);
  });

  it('does not count an occurrence before its ask time', () => {
    const now = at('2026-10-05T12:00:00+02:00');
    expect(tallyRange([gym], map(history), '2026-10-05', '2026-10-05', settings, now).total.due).toBe(0);
  });
});

describe('streaks', () => {
  it('counts consecutive yes answers and keeps today in grace', () => {
    const list = [
      checkin('gym', '2026-09-21', 'no'),
      checkin('gym', '2026-09-23', 'yes'),
      checkin('gym', '2026-09-25', 'yes'),
      checkin('gym', '2026-09-28', 'yes'),
      checkin('gym', '2026-09-30', 'yes'),
      checkin('gym', '2026-10-02', 'yes'),
    ];
    const g = habit({ createdAt: '2026-09-21' });
    expect(streakFor(g, map(list), settings, at('2026-10-05T20:00:00+02:00'))).toEqual({ current: 5, best: 5 });
    // an unanswered past day breaks it
    expect(streakFor(g, map(list), settings, at('2026-10-06T09:00:00+02:00'))).toEqual({ current: 0, best: 5 });
  });
});

describe('aggregations', () => {
  const now = at('2026-10-05T20:00:00+02:00');

  it('weekly series is oldest-first and ends at the given week', () => {
    const series = weeklySeries([gym], map(history), '2026-09-28', settings, now, 3);
    expect(series.map((w) => w.weekStart)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
    expect(series[2]!.total).toMatchObject({ due: 3, yes: 2 });
  });

  it('weekday tallies', () => {
    const t = weekdayTallies([gym], map(history), settings, now, 14);
    expect(t.get(3)).toMatchObject({ due: 2, no: 1 }); // Wed 30 Sep (no) + Wed 23 Sep (unanswered)
  });

  it('reason counts', () => {
    expect(reasonCounts([gym], map(history), '2026-09-01', '2026-10-05')).toMatchObject({ misses: 1, withoutReason: 0 });
  });

  it('heatmap has full weeks starting on Monday', () => {
    const cols = heatmapWeeks([gym], map(history), settings, now, 2);
    expect(cols).toHaveLength(2);
    expect(cols[0]![0]!.date).toBe('2026-09-28');
    expect(cols[1]![6]).toMatchObject({ date: '2026-10-11', future: true });
    expect(cols[0]![0]).toMatchObject({ due: 1, yes: 1 });
  });

  it('day parts and best week', () => {
    expect(dayPartTallies([gym], map(history), settings, now, 14).evening.due).toBeGreaterThan(0);
    expect(bestPastWeekYes([gym], map(history), '2026-10-05', settings, now)).toMatchObject({ yes: 2 });
  });
});

describe('compareWithLastWeek', () => {
  it('compares an in-progress week with last week up to the same moment', async () => {
    const { compareWithLastWeek } = await import('../src/lib/stats');
    const g = habit({ createdAt: '2026-09-21' });
    const list = [
      checkin('gym', '2026-09-28', 'yes'), // last Monday
      checkin('gym', '2026-09-30', 'no'), // last Wednesday (after "the same moment")
      checkin('gym', '2026-10-05', 'yes'), // this Monday
    ];
    const now = at('2026-10-05T20:00:00+02:00'); // Monday evening
    const r = compareWithLastWeek([g], map(list), '2026-10-05', settings, now);
    expect(r.partial).toBe(true);
    expect(r.current).toMatchObject({ due: 1, yes: 1 });
    expect(r.previous).toMatchObject({ due: 1, yes: 1 }); // only last Monday counts
    const full = compareWithLastWeek([g], map(list), '2026-09-28', settings, now);
    expect(full.partial).toBe(false);
    expect(full.previous.due).toBe(3); // the whole week of 21 Sep (all unanswered)
  });
});

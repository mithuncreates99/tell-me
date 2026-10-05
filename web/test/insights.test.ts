import { describe, expect, it } from 'vitest';
import { startOfWeek, todayISO } from '../src/lib/dates';
import { buildDemoData } from '../src/lib/demo';
import { buildInsights } from '../src/lib/insights';
import { toCheckinMap } from '../src/lib/schedule';
import { at, checkin, habit, map, settings } from './helpers';

describe('insights', () => {
  it('explains how to get started when there is no data', () => {
    const list = buildInsights({ habits: [habit()], checkins: map([]), settings, now: at('2026-08-31T10:00:00+02:00'), weekStart: '2026-08-31' });
    expect(list.map((i) => i.id)).toEqual(['empty']);
  });

  it('celebrates a perfect week', () => {
    const now = at('2026-10-04T12:00:00+02:00');
    const g = habit({ createdAt: '2026-09-28' });
    const data = map(['2026-09-28', '2026-09-30', '2026-10-02'].map((d) => checkin('gym', d, 'yes')));
    const list = buildInsights({ habits: [g], checkins: data, settings, now, weekStart: '2026-09-28' });
    expect(list[0]!.id).toBe('perfect');
  });

  it('finds the patterns hidden in the demo data', () => {
    const now = at('2026-10-05T20:30:00+02:00');
    const demo = buildDemoData(settings, now);
    const list = buildInsights({
      habits: demo.habits,
      checkins: toCheckinMap(demo.checkins),
      settings,
      now,
      weekStart: startOfWeek(todayISO(now), 1),
    });
    const ids = list.map((i) => i.id);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.length).toBeLessThanOrEqual(6);
    // The demo has an evening reading habit that is slipping and "tired" as the main reason.
    expect(ids).toEqual(expect.arrayContaining(['slipping']));
    for (const i of list) {
      expect(i.title.length).toBeGreaterThan(5);
      expect(i.detail).not.toMatch(/NaN|undefined|null/);
    }
  });
});

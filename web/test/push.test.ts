import { describe, expect, it } from 'vitest';
import { buildReminders } from '../src/lib/push';
import { at, checkin, habit, map } from './helpers';

describe('buildReminders', () => {
  const now = at('2026-10-05T10:00:00+02:00');
  const s = { defaultAskTime: '21:00', weeklyReport: { enabled: true, day: 0 as const, time: '19:00' } };

  it('sends schedule only (no answers) and skips dates already answered', () => {
    const list = buildReminders(
      [habit(), habit({ id: 'water', name: 'Water', time: null, days: [0, 1, 2, 3, 4, 5, 6] }), habit({ id: 'off', remind: false }), habit({ id: 'old', archivedAt: '2026-09-01' })],
      map([checkin('gym', '2026-10-05', 'yes'), checkin('gym', '2026-09-01', 'yes')]),
      s,
      now,
    );
    expect(list.map((r) => r.id)).toEqual(['gym', 'water', 'weekly-report']);
    expect(list[0]).toMatchObject({ kind: 'checkin', days: [1, 3, 5], time: '18:00', offsetMin: 60, skipDates: ['2026-10-05'] });
    expect(list[1]).toMatchObject({ time: '21:00', offsetMin: 0 });
    expect(list[2]).toMatchObject({ kind: 'weekly', days: [0], time: '19:00' });
    expect(JSON.stringify(list)).not.toMatch(/"answer"|"yes"|"no"/);
  });

  it('omits the weekly report when disabled', () => {
    const list = buildReminders([habit()], map([]), { ...s, weeklyReport: { ...s.weeklyReport, enabled: false } }, now);
    expect(list.map((r) => r.id)).toEqual(['gym']);
  });
});

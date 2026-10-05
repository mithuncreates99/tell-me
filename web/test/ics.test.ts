import { describe, expect, it } from 'vitest';
import { buildICS } from '../src/lib/ics';
import { at, habit, settings } from './helpers';

describe('buildICS', () => {
  const ics = buildICS(
    [habit(), habit({ id: 'read', name: 'Read, then sleep; early', days: [0, 1, 2, 3, 4, 5, 6], time: null }), habit({ id: 'old', archivedAt: '2026-09-01' })],
    settings,
    'https://example.github.io/tell-me/',
    at('2026-10-05T10:00:00+02:00'),
  );

  it('creates a weekly event with an alarm at check-in time', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(ics).toContain('DTSTART:20261005T180000');
    expect(ics).toContain('TRIGGER:PT60M');
    expect(ics).toContain('URL:https://example.github.io/tell-me/#/checkin/gym');
  });

  it('escapes text, skips archived habits and folds long lines', () => {
    expect(ics).toContain(String.raw`Read\, then sleep\; early`);
    expect(ics).not.toContain('UID:old@tell-me');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

import { addDays, minutesOf, todayISO } from './dates';
import { isScheduledOn } from './schedule';
import type { Habit, Settings } from './types';

/**
 * Calendar fallback (RFC 5545): every habit becomes a weekly recurring event with an alarm
 * at check-in time that links back to the Yes/No screen. Works with Apple, Google and
 * Outlook calendars, no server needed.
 */
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded with CRLF + space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const localDateTime = (date: string, minutes: number) =>
  `${date.replace(/-/g, '')}T${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`;

export function buildICS(habits: Habit[], settings: Pick<Settings, 'defaultAskTime'>, appUrl: string, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tell Me//Habit check-ins//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Tell Me habits',
  ];
  const today = todayISO(now);
  for (const habit of habits) {
    if (habit.archivedAt || habit.days.length === 0) continue;
    let first = today;
    for (let i = 0; i < 7 && !isScheduledOn(habit, first); i++) first = addDays(first, 1);
    const start = habit.time ? minutesOf(habit.time) : minutesOf(settings.defaultAskTime);
    const duration = habit.time ? Math.max(15, habit.askAfterMin) : 15;
    const alarmAfter = habit.time ? habit.askAfterMin : 0;
    const url = `${appUrl}#/checkin/${habit.id}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${habit.id}@tell-me`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${localDateTime(first, start)}`,
      `DURATION:PT${duration}M`,
      `RRULE:FREQ=WEEKLY;BYDAY=${[...habit.days].sort().map((d) => BYDAY[d]).join(',')}`,
      `SUMMARY:${escapeText(`${habit.emoji} ${habit.name}`)}`,
      `DESCRIPTION:${escapeText(`Did you show up? Tap to answer Yes or No: ${url}`)}`,
      `URL:${url}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`${habit.emoji} ${habit.name}: did you show up?`)}`,
      `TRIGGER:PT${alarmAfter}M`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

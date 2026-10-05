import { describe, expect, it } from 'vitest';
import { parseHabit, parseSchedule } from '../src/lib/parser';

describe('parseHabit', () => {
  it.each([
    ['Gym Mon Wed Fri 6pm', 'Gym', [1, 3, 5], '18:00', '🏋️'],
    ['Gym every Monday, Wednesday and Friday at 18:00', 'Gym', [1, 3, 5], '18:00', '🏋️'],
    ['Read 20 pages daily 22:00', 'Read 20 pages', [0, 1, 2, 3, 4, 5, 6], '22:00', '📚'],
    ['French class Tue/Thu 19h30', 'French class', [2, 4], '19:30', '🇫🇷'],
    ['Run weekends 9am', 'Run', [0, 6], '09:00', '🏃'],
    ['Meditate weekdays 7:30', 'Meditate', [1, 2, 3, 4, 5], '07:30', '🧘'],
    ['Gym 3x a week', 'Gym', [1, 3, 5], null, '🏋️'],
    ['Swim twice a week at 7am', 'Swim', [2, 4], '07:00', '🏊'],
    ['LeetCode mon-fri 21:00', 'LeetCode', [1, 2, 3, 4, 5], '21:00', '💻'],
    ['Call mum Sunday 6 pm', 'Call mum', [0], '18:00', '📞'],
    ['Yoga mornings', 'Yoga', [0, 1, 2, 3, 4, 5, 6], '08:00', '🧘'],
    ['Football thu 20h', 'Football', [4], '20:00', '⚽'],
    ['Study at 7', 'Study', [0, 1, 2, 3, 4, 5, 6], '07:00', '🎓'],
    ['Walk at 5', 'Walk', [0, 1, 2, 3, 4, 5, 6], '17:00', '🚶'],
  ])('%s', (input, name, days, time, emoji) => {
    const parsed = parseHabit(input)!;
    expect(parsed.name).toBe(name);
    expect(parsed.days).toEqual(days);
    expect(parsed.time).toBe(time);
    expect(parsed.emoji).toBe(emoji);
  });

  it('defaults to every day and flags it', () => {
    expect(parseHabit('Drink water')).toMatchObject({ name: 'Drink water', days: [0, 1, 2, 3, 4, 5, 6], time: null, daysDefaulted: true, emoji: '💧' });
  });

  it('does not mistake words that contain day names', () => {
    expect(parseHabit('Sunrise walk Sat')).toMatchObject({ name: 'Sunrise walk', days: [6] });
    expect(parseHabit('Wedding planning Tue')).toMatchObject({ name: 'Wedding planning', days: [2] });
  });

  it('treats short "1h" as a duration, not a time', () => {
    expect(parseHabit('Piano 1h Mon')).toMatchObject({ name: 'Piano 1h', time: null, days: [1] });
  });

  it('ignores empty input', () => {
    expect(parseHabit('   ')).toBeNull();
    expect(parseHabit('Mon Wed 6pm')).toBeNull();
  });
});

describe('parseSchedule', () => {
  it('reads one habit per line and CSV rows, skipping headers and comments', () => {
    const list = parseSchedule(`name,days,time
Gym,Mon Wed Fri,18:00
# my evening routine
Read daily 22:00

Run Sat 9am`);
    expect(list.map((h) => h.name)).toEqual(['Gym', 'Read', 'Run']);
    expect(list[0]).toMatchObject({ days: [1, 3, 5], time: '18:00' });
  });
});
